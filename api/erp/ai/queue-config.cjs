// BullMQ Queue Configuration (CommonJS)
const { Queue, QueueEvents } = require('bullmq');
const Redis = require('ioredis');

// Redis configuration
const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false
};

// Create Redis connection
const redisConnection = new Redis(redisConfig);

// Queue names
const QUEUES = {
    GEMINI_PROMPT: 'gemini-prompt',
    TEXT_GENERATION: 'text-generation',
    IMAGE_PROCESSING: 'image-processing'
};

// Create queues (pass plain config object to BullMQ so it creates its own client internally)
const queues = {
    geminiPrompt: new Queue(QUEUES.GEMINI_PROMPT, { connection: redisConfig }),
    textGeneration: new Queue(QUEUES.TEXT_GENERATION, { connection: redisConfig }),
    imageProcessing: new Queue(QUEUES.IMAGE_PROCESSING, { connection: redisConfig })
};

// Create QueueEvents instances for waitUntilFinished and listeners
const queueEvents = {
    geminiPrompt: new QueueEvents(QUEUES.GEMINI_PROMPT, { connection: redisConfig }),
    textGeneration: new QueueEvents(QUEUES.TEXT_GENERATION, { connection: redisConfig }),
    imageProcessing: new QueueEvents(QUEUES.IMAGE_PROCESSING, { connection: redisConfig })
};

// Test Redis connection
redisConnection.on('connect', () => {
    console.log('✓ Redis connected');
});

redisConnection.on('error', (err) => {
    console.error('✗ Redis connection error:', err);
});

module.exports = {
    redisConnection,
    redisConfig,
    queues,
    queueEvents,
    QUEUES
};
