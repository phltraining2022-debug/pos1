// Ví dụ sử dụng: Đẩy job Gemini vào queue
const { queues, QUEUES } = require('./queue-config');

/**
 * Hàm helper để đẩy Gemini prompt job vào queue
 * @param {string} prompt - Prompt text cần gửi tới Gemini
 * @param {string} systemPrompt - System prompt (optional)
 * @param {number} temperature - Temperature cho response (0-2)
 * @param {number} maxTokens - Max tokens cho response
 * @param {object} responseSchema - JSON schema cho structured output (optional)
 * @param {object} options - Options bổ sung (delay, priority, etc.)
 * @returns {Promise<Job>} - Job object
 */
async function submitGeminiPrompt(prompt, systemPrompt = '', temperature = 0.7, maxTokens = 2048, responseSchema = null, options = {}) {
    try {
        const jobData = {
            prompt: prompt,
            systemPrompt: systemPrompt,
            temperature: temperature,
            maxTokens: maxTokens,
            responseSchema: responseSchema
        };
        
        const defaultOptions = {
            attempts: 3, // Retry 3 times on failure
            backoff: {
                type: 'exponential',
                delay: 2000
            },
            removeOnComplete: false, // Keep job history
            removeOnFail: false // Keep failed job history
        };
        
        const jobOptions = { ...defaultOptions, ...options };
        
        console.log(`📤 Submitting Gemini prompt job...`);
        console.log(`   Prompt: ${prompt.substring(0, 100)}...`);
        if (responseSchema) console.log(`   With structured output schema`);
        
        const job = await queues.geminiPrompt.add(jobData, jobOptions);
        
        console.log(`✓ Job submitted (ID: ${job.id})`);
        
        return job;
        
    } catch (error) {
        console.error('Error submitting job:', error);
        throw error;
    }
}

/**
 * Hàm để chờ kết quả job
 * @param {Job} job - Job object từ submitGeminiPrompt
 * @param {number} timeout - Timeout in ms (default: 5 minutes)
 * @returns {Promise<object>} - Job result
 */
async function waitForGeminiResult(job, timeout = 300000) {
    try {
        console.log(`⏳ Waiting for job ${job.id} result...`);
        
        const result = await job.waitUntilFinished(queues.geminiPrompt.events, timeout);
        
        console.log(`✅ Got result for job ${job.id}`);
        return result;
        
    } catch (error) {
        console.error('Error waiting for result:', error);
        throw error;
    }
}

/**
 * Ví dụ 1: Sử dụng async/await
 */
async function example1_AsyncAwait() {
    console.log('\n=== Example 1: Async/Await ===');
    
    try {
        const prompt = 'Explain quantum computing in simple terms';
        
        const job = await submitGeminiPrompt(prompt);
        const result = await waitForGeminiResult(job);
        
        console.log('\n📌 Result:');
        console.log('Prompt:', result.prompt);
        console.log('Response:', result.response.substring(0, 200) + '...');
        console.log('Model:', result.model);
        
    } catch (error) {
        console.error('Example 1 failed:', error.message);
    }
}

/**
 * Ví dụ 2: Sử dụng callbacks
 */
async function example2_Callbacks() {
    console.log('\n=== Example 2: Callbacks ===');
    
    const prompt = 'Write a short poem about technology';
    
    submitGeminiPrompt(prompt, 'You are a poet', 0.8)
        .then(job => {
            console.log(`Job submitted: ${job.id}`);
            
            // Lắng nghe khi job hoàn thành
            job.waitUntilFinished(queues.geminiPrompt.events)
                .then(result => {
                    console.log('✅ Job completed:');
                    console.log(result.response);
                })
                .catch(error => {
                    console.error('Job failed:', error.message);
                });
        })
        .catch(error => {
            console.error('Failed to submit job:', error.message);
        });
}

/**
 * Ví dụ 3: Batch submit multiple prompts
 */
async function example3_BatchSubmit() {
    console.log('\n=== Example 3: Batch Submit ===');
    
    const prompts = [
        { text: 'What is AI?', system: 'Be concise' },
        { text: 'Explain machine learning', system: 'Be detailed' },
        { text: 'What is blockchain?', system: 'Be simple' }
    ];
    
    try {
        const jobs = [];
        
        for (const item of prompts) {
            const job = await submitGeminiPrompt(item.text, item.system);
            jobs.push(job);
        }
        
        console.log(`\n📤 Submitted ${jobs.length} jobs`);
        
        // Chờ tất cả jobs hoàn thành
        const results = await Promise.all(
            jobs.map(job => waitForGeminiResult(job))
        );
        
        console.log(`\n📥 All ${results.length} jobs completed!`);
        results.forEach((result, index) => {
            console.log(`\n[${index + 1}] ${result.prompt.substring(0, 50)}...`);
            console.log(`    Response: ${result.response.substring(0, 100)}...`);
        });
        
    } catch (error) {
        console.error('Batch submit failed:', error.message);
    }
}

/**
 * Ví dụ 4: Priority job
 */
async function example4_PriorityJob() {
    console.log('\n=== Example 4: Priority Job ===');
    
    try {
        // Priority cao (1 = cao nhất)
        const job = await submitGeminiPrompt(
            'Urgent: Explain the latest AI breakthrough',
            'Be comprehensive',
            0.9,
            2048,
            {
                priority: 1, // Xử lý trước
                jobId: `urgent-${Date.now()}`
            }
        );
        
        console.log(`✓ Priority job submitted: ${job.id}`);
        
    } catch (error) {
        console.error('Priority job failed:', error.message);
    }
}

/**
 * Ví dụ 6: Structured Output (JSON Schema) - tham khảo test1.js
 */
async function example6_StructuredOutput() {
    console.log('\n=== Example 6: Structured Output (JSON Schema) ===');
    
    try {
        // Schema định nghĩa cấu trúc output
        const leadsSchema = {
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
                        potential_dates: { 
                            type: "ARRAY", 
                            items: { type: "STRING" },
                            description: "Danh sách ngày dự kiến (YYYY-MM-DD)"
                        }
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
        
        const conversation = `
        Chào, công ty mình tìm venue cho sự kiện YEP
        - Thời gian: 24/01/2026 hoặc 31/01/2026 (từ 18h30)
        - Quy mô: 30-40 người
        - Liên hệ: Trân - 0784855333
        `;
        
        const job = await submitGeminiPrompt(
            conversation,
            'Bạn là chuyên gia phân tích CRM. Trích xuất dữ liệu từ hội thoại.',
            0.5,  // Lower temp cho output ổn định
            2048,
            leadsSchema  // Pass schema
        );
        
        const result = await waitForGeminiResult(job);
        
        console.log('\n📌 Structured Output Result:');
        console.log(JSON.stringify(result.response, null, 2));
        
    } catch (error) {
        console.error('Example 6 failed:', error.message);
    }
}

// Main: chọn example để chạy
async function main() {
    console.log('🤖 Gemini Worker Examples\n');
    
    // Chọn example
    const example = process.argv[2] || '1';
    
    switch (example) {
        case '1':
            await example1_AsyncAwait();
            break;
        case '2':
            example2_Callbacks();
            break;
        case '3':
            await example3_BatchSubmit();
            break;
        case '4':
            await example4_PriorityJob();
            break;
        case '5':
            await example5_DelayedJob();
            break;
        case '6':
            await example6_StructuredOutput();
            break;
        default:
            console.log('Usage: node gemini-example.js [1-6]');
            console.log('  1: Async/Await');
            console.log('  2: Callbacks');
            console.log('  3: Batch Submit');
            console.log('  4: Priority Job');
            console.log('  5: Delayed Job');
            console.log('  6: Structured Output (JSON Schema)');
    }
}

// Nếu chạy trực tiếp
if (require.main === module) {
    main().then(() => {
        console.log('\n✓ Example completed');
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    submitGeminiPrompt,
    waitForGeminiResult
};
