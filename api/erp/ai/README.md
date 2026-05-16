# BullMQ + Redis + Gemini Worker Setup

## 📋 Cấu trúc thư mục

```
ai/
├── queue-config.js           # Redis & Queue configuration
├── gemini-worker.js          # Worker processor
├── gemini-example.js         # Ví dụ sử dụng
├── gemini-integration.js     # Integration với Loopback
├── .env.example              # Environment variables
└── README.md                 # Documentation
```

## 🚀 Cài đặt

### 1. Install dependencies

```bash
cd ai
npm install bullmq ioredis @google/generative-ai
```

### 2. Redis setup

**Option A: Local Redis**
```bash
# macOS
brew install redis
brew services start redis

# Linux
sudo apt-get install redis-server
sudo systemctl start redis-server
```

**Option B: Docker**
```bash
docker run -d -p 6379:6379 redis:latest
```

### 3. Environment variables

Tạo file `.env`:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # Leave empty if no password

GEMINI_API_KEY=your_google_api_key_here
NODE_ENV=development
```

## 🎯 Cách sử dụng

### 1. Chạy Worker

```bash
node gemini-worker.js
```

Output:
```
🚀 Gemini Worker started, listening to queue: gemini-prompt
✓ Redis connected
```

### 2. Chạy Examples

```bash
# Example 1: Async/Await
node gemini-example.js 1

# Example 2: Callbacks
node gemini-example.js 2

# Example 3: Batch Submit
node gemini-example.js 3

# Example 4: Priority Job
node gemini-example.js 4

# Example 5: Delayed Job
node gemini-example.js 5
```

### 3. Sử dụng trong Loopback

```javascript
const { callGemini } = require('./gemini-integration');

// Trong model hook hoặc remote method
const result = await callGemini('Your prompt here', {
    systemPrompt: 'You are helpful assistant',
    temperature: 0.7,
    waitForResult: true,
    timeout: 300000
});

console.log(result.data.response);
```

## 📊 Architecture

```
┌─────────────┐
│  Loopback   │
│   Models    │
└──────┬──────┘
       │
       │ submitGeminiPrompt()
       │
┌──────▼──────────────────┐
│  BullMQ Queue           │
│ (gemini-prompt)         │
│                         │
│  Job Data:              │
│  - prompt               │
│  - systemPrompt         │
│  - temperature          │
│  - maxTokens            │
└──────┬──────────────────┘
       │
┌──────▼──────────────────┐
│  Redis                  │
│  (broker & storage)     │
└──────┬──────────────────┘
       │
┌──────▼──────────────────┐
│  Worker                 │
│ (processGeminiJob)      │
│                         │
│  Calls Gemini API       │
│  Returns Response       │
└──────┬──────────────────┘
       │
       │ result
       │
┌──────▼──────────────────┐
│  Job Completed          │
│  waitForGeminiResult()  │
└─────────────────────────┘
```

## 🔧 Configuration Options

### Queue Options

```javascript
{
    concurrency: 3,           // Process 3 jobs concurrently
    maxStalledCount: 2,       // Retry 2 times if stalled
    stalledInterval: 30000,   // Check every 30s
    lockDuration: 60000,      // Lock for 60s
    lockRenewTime: 30000      // Renew every 30s
}
```

### Job Options

```javascript
{
    attempts: 3,              // Retry 3 times
    backoff: {
        type: 'exponential',
        delay: 2000
    },
    priority: 1,              // 1 = highest
    delay: 5000,              // Start after 5s
    removeOnComplete: false,  // Keep history
    removeOnFail: false
}
```

### Gemini Options

```javascript
{
    systemPrompt: '',         // System context
    temperature: 0.7,         // 0 = deterministic, 2 = random
    maxTokens: 2048,          // Max response length
    waitForResult: true,      // Block until complete
    timeout: 300000           // 5 minute timeout
}
```

## 📡 API Examples

### Basic Prompt
```javascript
const result = await callGemini('Explain quantum computing');
```

### With Options
```javascript
const result = await callGemini(
    'Write a poem',
    {
        systemPrompt: 'You are a poet',
        temperature: 0.9,
        maxTokens: 1024
    }
);
```

### Non-blocking
```javascript
const result = await callGemini(prompt, {
    waitForResult: false
});
// Result: { jobId: 'xxx', status: 'processing' }
```

### Batch
```javascript
const jobs = await Promise.all([
    callGemini('Prompt 1'),
    callGemini('Prompt 2'),
    callGemini('Prompt 3')
]);
```

## 🐛 Debugging

### View Queue Status

```javascript
const { queues } = require('./queue-config');

// Count jobs
const count = await queues.geminiPrompt.count('active');
console.log('Active jobs:', count);

// Get job
const job = await queues.geminiPrompt.getJob('job-id');
console.log(job.data);
```

### Redis CLI

```bash
# Monitor Redis
redis-cli MONITOR

# View Queue data
redis-cli HGETALL "bull:gemini-prompt:job:job-id"

# Flush all
redis-cli FLUSHALL
```

## 🛠️ Troubleshooting

### Redis Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
**Solution:** Start Redis service

### Job Timeout
```
Error: Job timeout after 300000ms
```
**Solution:** Increase timeout hoặc check Gemini API response time

### API Key Error
```
Error: invalid API key
```
**Solution:** Check `GEMINI_API_KEY` environment variable

## 📚 References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Google Generative AI SDK](https://github.com/google/generative-ai-js)
- [Redis Documentation](https://redis.io/documentation)

## 🎓 Next Steps

1. ✅ Setup Redis
2. ✅ Configure environment variables
3. ✅ Start worker: `node gemini-worker.js`
4. ✅ Run examples: `node gemini-example.js 1`
5. ✅ Integrate with Loopback models
6. ✅ Monitor job progress in Redis

---

**Created:** 2025-11-15
**Status:** Production Ready
