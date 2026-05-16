// Gemini Prompt Worker
const { Worker } = require('bullmq');
const { GoogleGenAI } = require("@google/genai");
const { redisConnection, QUEUES } = require('./queue-config');
require('dotenv').config();

// Initialize Vertex AI (tham khảo test1.js)
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION
});

// Worker processor
const processGeminiJob = async (job) => {
    console.log(`\n📋 Processing Job ID: ${job.id}`);
    console.log(`   Data:`, job.data);
    
    try {
        const { 
            prompt, 
            systemPrompt = '', 
            temperature = 0.7, 
            maxTokens = 2048,
            responseSchema = null
        } = job.data;
        
        // Validate prompt
        if (!prompt) {
            throw new Error('Prompt is required');
        }
        
        console.log(`🔄 Sending to Gemini API (${modelName})...`);
        
        // Build request config
        const config = {
            systemInstruction: systemPrompt || undefined,
            temperature: temperature,
            maxOutputTokens: maxTokens
        };
        
        // Add response schema if provided (structured output)
        if (responseSchema) {
            config.responseMimeType = "application/json";
            config.responseSchema = responseSchema;
            console.log(`   Using structured output with JSON schema`);
        }
        
        // Call Gemini API via Vertex AI
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [prompt],
            config: config
        });
        
        const resultText = response.text;
        
        // Parse JSON if schema was used
        let result = resultText;
        if (responseSchema) {
            try {
                result = JSON.parse(resultText);
                console.log(`✓ Parsed structured JSON response`);
            } catch (parseError) {
                console.warn(`⚠️  Failed to parse JSON, returning raw text`);
                result = resultText;
            }
        }
        
        console.log(`✓ Gemini response received (${JSON.stringify(result).length} characters)`);
        
        // Return result
        return {
            success: true,
            prompt: prompt,
            response: result,
            model: modelName,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`✗ Error processing Gemini job:`, error.message);
        throw error;
    }
};

// Create worker
const worker = new Worker(QUEUES.GEMINI_PROMPT, processGeminiJob, {
    connection: redisConnection,
    concurrency: 3, // Process 3 jobs concurrently
    maxStalledCount: 2, // Retry max 2 times if stalled
    stalledInterval: 30000, // Check stalled jobs every 30s
    lockDuration: 60000, // Lock job for 60s
    lockRenewTime: 30000 // Renew lock every 30s
});

// Worker event handlers
worker.on('completed', (job, result) => {
    console.log(`✅ Job ${job.id} completed`);
    console.log(`   Result: ${result.response.substring(0, 100)}...`);
});

worker.on('failed', (job, error) => {
    console.error(`❌ Job ${job.id} failed:`, error.message);
});

worker.on('error', (error) => {
    console.error('Worker error:', error);
});

worker.on('stalled', (jobId) => {
    console.warn(`⚠️  Job ${jobId} stalled`);
});

console.log('🚀 Gemini Worker started, listening to queue:', QUEUES.GEMINI_PROMPT);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\n📴 Shutting down worker...');
    await worker.close();
    process.exit(0);
});

module.exports = worker;
