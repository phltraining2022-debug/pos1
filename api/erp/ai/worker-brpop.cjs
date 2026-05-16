// worker-brpop.cjs
// Simple Redis LIST based worker that is compatible with Node8 producers that LPUSH JSON strings.
// Run this worker on a machine/container with Node >=14/16/18 (it uses @google/genai and modern libs).
require('dotenv').config();
// Polyfill Promise.prototype.finally for very old Node versions
if (typeof Promise.prototype.finally !== 'function') {
  /* eslint-disable no-extend-native */
  Promise.prototype.finally = function (onFinally) {
    var P = this.constructor;
    return this.then(
      function (value) {
        return P.resolve(onFinally && onFinally()).then(function () { return value; });
      },
      function (reason) {
        return P.resolve(onFinally && onFinally()).then(function () { throw reason; });
      }
    );
  };
}

const IORedis = require('ioredis');
// Polyfill Array.prototype.flat for older Node versions (flat added in Node 11+)
if (!Array.prototype.flat) {
  /* eslint-disable no-extend-native */
  Array.prototype.flat = function (depth) {
    var d = typeof depth === 'undefined' ? 1 : Math.floor(depth) || 0;
    var res = [];
    (function flat(arr, depth) {
      for (var i = 0; i < arr.length; i++) {
        var val = arr[i];
        if (Array.isArray(val) && depth > 0) {
          flat(val, depth - 1);
        } else {
          res.push(val);
        }
      }
    })(this, d);
    return res;
  };
}
// @google/genai is ESM-only; dynamically import it at runtime to avoid SyntaxError in CommonJS
let aiClientInstance = null;
async function ensureAIClient() {
  if (aiClientInstance) return aiClientInstance;
  try {
    // Some older Node versions (or environments) will throw a SyntaxError when the
    // 'import(...)' token appears in source. To avoid parse-time errors, we use
    // eval() to perform a dynamic import at runtime and also guard by Node version.
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10) || 0;
    if (nodeMajor < 14) {
      throw new Error('Dynamic import not supported on Node ' + process.versions.node);
    }
    const mod = await eval("import('@google/genai')");
    const GoogleGenAI = mod.GoogleGenAI || (mod.default && mod.default.GoogleGenAI) || (mod.default || mod);
    aiClientInstance = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    return aiClientInstance;
  } catch (err) {
    console.error('Failed to import @google/genai dynamically:', err && err.message ? err.message : err);
    // If MOCK_GENAI=1, provide a lightweight mock client so the worker can run without the real SDK.
    if (process.env.MOCK_GENAI === '1') {
      console.warn('MOCK_GENAI enabled — using mocked Gemini client');
      aiClientInstance = {
        models: {
          generateContent: async ({ model, contents, config }) => ({ text: `MOCK: ${contents[0]}` })
        }
      };
      return aiClientInstance;
    }

    throw err;
  }
}

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
const LIST_KEY = process.env.GEMINI_LIST_KEY || 'gemini:queue';
const PROCESSING_KEY = process.env.GEMINI_PROCESSING_KEY || 'gemini:processing';
const DLQ_KEY = process.env.GEMINI_DLQ_KEY || 'gemini:dead';
const POLL_DELAY_MS = parseInt(process.env.GEMINI_POLL_DELAY_MS || '500', 10);
const MAX_ATTEMPTS = parseInt(process.env.GEMINI_MAX_ATTEMPTS || '5', 10);

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const redis = new IORedis({ host: REDIS_HOST, port: REDIS_PORT });

// AI client will be created lazily by ensureAIClient()

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processPayload(payload) {
  let job;
  try {
    job = JSON.parse(payload);
  } catch (err) {
    console.error('Invalid JSON payload, moving to DLQ:', payload.substring(0, 200));
    // Remove from processing list and move to DLQ
    await redis.lrem(PROCESSING_KEY, 1, payload);
    await redis.lpush(DLQ_KEY, payload);
    return;
  }

  job._attempts = (job._attempts || 0) + 1;

  if (job._attempts > MAX_ATTEMPTS) {
    console.warn(`Job exceeded attempts (${job._attempts}), moving to DLQ. Prompt: ${String(job.prompt).substring(0, 80)}`);
    await redis.lrem(PROCESSING_KEY, 1, payload);
    await redis.lpush(DLQ_KEY, JSON.stringify(job));
    return;
  }

  console.log('\n📋 Processing job (attempt ' + job._attempts + '):', String(job.prompt).substring(0, 120));

  try {
    const config = {
      systemInstruction: job.systemPrompt || undefined,
      temperature: job.temperature || 0.7,
      maxOutputTokens: job.maxTokens || 8192
    };
    console.log('Generation Config:', JSON.stringify(config));

    if (job.responseSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = job.responseSchema;
    }

    const aiInstance = await ensureAIClient();
    const response = await aiInstance.models.generateContent({ model: MODEL_NAME, contents: [job.prompt], config });
    // Debug: log full response object to inspect fields returned by the SDK (helpful when results seem truncated)
    try {
      console.log('Full AI response object:', JSON.stringify(response, null, 2));
    } catch (e) {
      // ignore logging errors
    }
    const resultText = response.text;

    let result = resultText;
    if (job.responseSchema) {
      try {
        result = JSON.parse(resultText);
      } catch (err) {
        console.warn('Failed to parse structured JSON response, keeping raw text');
        result = resultText;
      }
    }

    console.log('✓ Gemini response received. Length:', String(result).length || 0);

    // Job success: remove from processing list
    await redis.lrem(PROCESSING_KEY, 1, payload);

    // If producer provided a responseKey, push the result there so producer can block-wait for it
    try {
      if (job.responseKey) {
        // Ensure we send the full text and include its length for debugging
        const responseText = (typeof result === 'string') ? result : JSON.stringify(result);
        const outObj = {
          success: true,
          jobId: job.jobId || null,
          response: result,
          responseLength: responseText.length
        };
        const out = JSON.stringify(outObj);
        await redis.lpush(job.responseKey, out);
        // expire the response key in 60 seconds to avoid leftover keys
        await redis.expire(job.responseKey, 60);
        console.log('Pushed result to', job.responseKey, 'length=', responseText.length);
      }
    } catch (pushErr) {
      console.warn('Failed to push result to responseKey:', pushErr && pushErr.message ? pushErr.message : pushErr);
    }

    // Optional: push result to a results list or call a webhook here
    // e.g., await redis.lpush('gemini:results', JSON.stringify({ jobId: job.jobId || null, response: result }));

  } catch (err) {
    console.error('Processing error:', err && err.message ? err.message : err);
    // Re-enqueue with incremented attempt count
    const updated = JSON.stringify(job);
    // Remove old payload from processing list and push updated back to main queue
    await redis.lrem(PROCESSING_KEY, 1, payload);
    await redis.lpush(LIST_KEY, updated);
  }
}

async function mainLoop() {
  console.log('🚀 Redis LIST worker started. Listening on', LIST_KEY);
  while (true) {
    try {
      // Atomically move an item from LIST_KEY to PROCESSING_KEY
      const payload = await redis.rpoplpush(LIST_KEY, PROCESSING_KEY);
      if (!payload) {
        await sleep(POLL_DELAY_MS);
        continue;
      }

      // Process without blocking the loop
      await processPayload(payload);

    } catch (err) {
      console.error('Worker loop error:', err && err.message ? err.message : err);
      await sleep(2000);
    }
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down worker...');
  try { await redis.quit(); } catch (e) { }
  process.exit(0);
});

mainLoop().catch(err => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
