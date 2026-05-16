// producer-node8-redis.js (Node8 compatible)
// uses "redis" v2.x (older redis client)
var redis = require('redis');

// Note: Redis client will be created/closed inside pushJob to avoid sharing a global connection

function pushJob(jobObj, cb) {
  // Create a dedicated Redis client per invocation to avoid sharing a global connection
  var client = redis.createClient({ host: jobObj.redisHost || '127.0.0.1', port: jobObj.redisPort || 6379 });
  client.on('error', function(err){ console.error('redis err', err); });
  // Ensure jobId and responseKey exist on the job object
  var jobId = jobObj.jobId || (Date.now().toString() + '-' + Math.random().toString(36).substr(2,6));
  var responseKey = jobObj.responseKey || ('gemini:response:' + jobId);
  jobObj.jobId = jobId;
  jobObj.responseKey = responseKey;

  var payload = JSON.stringify(jobObj);
  client.lpush('gemini:queue', payload, function(err, res) {
    if (err) {
      try { client.quit(); } catch (e) {}
      return cb(err);
    }
    // After pushing, block-wait on the responseKey for the worker's result
    var timeoutSecs = jobObj.timeoutSecs || 30; // seconds
    console.log('Pushed, list length:', res, 'waiting for response on', responseKey);
    client.brpop(responseKey, timeoutSecs, function(brErr, reply) {
      // If caller requested to keep connection open, do NOT quit; otherwise close it
      var keepOpen = !!jobObj.keepOpen;
      if (!keepOpen) {
        try { client.quit(); } catch (e) {}
      }

      if (brErr) return cb(brErr);
      if (!reply) return cb(new Error('Timed out waiting for response'));
      var value = reply[1];
      try {
        var parsed = JSON.parse(value);
        // If keepOpen, return an object with both response and client so caller can reuse/close it
        if (keepOpen) return cb(null, { response: parsed, client: client });
        return cb(null, parsed);
      } catch (e) {
        if (keepOpen) return cb(null, { response: value, client: client });
        return cb(null, value);
      }
    });
  });
}

// Promise/async version of pushJob
function pushJobAsync(jobObj, timeoutSecs) {
  return new Promise(function(resolve, reject) {
    if (typeof timeoutSecs === 'number') jobObj.timeoutSecs = timeoutSecs;
    pushJob(jobObj, function(err, result) {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

// Usage
// Usage: push job and wait for result (blocking BRPOP)
var example = process.argv[2] || '1';

// Prepare payload depending on example; support example 6 (structured output)
var jobId = Date.now().toString() + '-' + Math.random().toString(36).substr(2,6);
var responseKey = 'gemini:response:' + jobId;

var promptText = 'Explain quantum computing in simple terms';
var systemPrompt = '';
var temperature = 0.7;
var maxTokens = 4024;
var responseSchema = null;

if (String(example) === '6') {
  // Structured output example (from gemini-example.cjs)
  responseSchema = {
    type: "OBJECT",
    properties: {
      customer_profile: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Tên người liên hệ" },
          phone: { type: "STRING", description: "Số điện thoại" },
          type: { type: "STRING", enum: ["Cá nhân", "Doanh nghiệp"] }
        }
      },
      event_details: {
        type: "OBJECT",
        properties: {
          event_type: { type: "STRING", description: "Loại sự kiện" },
          guest_count_min: { type: "INTEGER" },
          guest_count_max: { type: "INTEGER" },
          potential_dates: { type: "ARRAY", items: { type: "STRING" }, description: "Danh sách ngày dự kiến (YYYY-MM-DD)" }
        }
      },
      sales_intelligence: {
        type: "OBJECT",
        properties: {
          intent_score: { type: "INTEGER", description: "Điểm tiềm năng 1-10" },
          buying_stage: { type: "STRING", enum: ["Tìm hiểu", "Cân nhắc", "Quyết định"] },
          suggested_action: { type: "STRING" }
        }
      }
    }
  };

  promptText = '\nChào, công ty mình tìm venue cho sự kiện YEP\n- Thời gian: 24/01/2026 hoặc 31/01/2026 (từ 18h30)\n- Quy mô: 30-40 người\n- Liên hệ: Trân - 0784855333\n';
  systemPrompt = 'Bạn là chuyên gia phân tích CRM. Trích xuất dữ liệu từ hội thoại.';
  temperature = 0.5;
  maxTokens = 2048;
}

// Submit job and receive response via callback
pushJob({ prompt: promptText, systemPrompt: systemPrompt, temperature: temperature, maxTokens: maxTokens, responseSchema: responseSchema }, function(err, result) {
  if (err) {
    console.error('Error:', err && err.message ? err.message : err);
    return;
  }
  console.log('Got response from worker:');
  console.log(result);
  // pushJob closes its own Redis client after receiving a response
});


(async () => {
  const res = await pushJobAsync({ prompt: 'Làm sao tính đường kính trái đất' }, 60); // default closes client
  // if keepOpen: res = { response, client }
  console.log(res);
})();