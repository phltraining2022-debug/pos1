// Integration Module - Use in your Loopback models/routes (CommonJS)
const { submitGeminiPrompt, waitForGeminiResult } = require('./gemini-example.cjs');

/**
 * Helper function để gọi Gemini từ Loopback models
 */
async function callGemini(prompt, options = {}) {
    const {
        systemPrompt = '',
        temperature = 0.7,
        maxTokens = 2048,
        waitForResult = true,
        timeout = 300000
    } = options;
    
    try {
        const job = await submitGeminiPrompt(
            prompt,
            systemPrompt,
            temperature,
            maxTokens
        );
        
        // Nếu không cần chờ kết quả, return job ID
        if (!waitForResult) {
            return {
                jobId: job.id,
                status: 'processing'
            };
        }
        
        // Chờ kết quả
        const result = await waitForGeminiResult(job, timeout);
        
        return {
            jobId: job.id,
            status: 'completed',
            data: result
        };
        
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

/**
 * Ví dụ: Integrate với Loopback Model
 */
async function integrationExample(app) {
    
    // Ví dụ 1: Remote method
    const Product = app.models.Product;
    
    Product.generateProductDescription = async function(productId, callback) {
        try {
            const product = await Product.findById(productId);
            
            if (!product) {
                return callback(new Error('Product not found'));
            }
            
            const prompt = `Generate a professional product description for: ${product.name} \n            Category: ${product.category}\n            Price: ${product.price}`;
            
            const result = await callGemini(prompt, {
                systemPrompt: 'You are an expert product copywriter',
                temperature: 0.7,
                waitForResult: true
            });
            
            if (result.status === 'completed') {
                // Lưu description
                product.description = result.data.response;
                await product.save();
                callback(null, result.data.response);
            } else {
                callback(new Error(result.error));
            }
            
        } catch (error) {
            callback(error);
        }
    };
    
    // Register remote method
    Product.remoteMethod('generateProductDescription', {
        accepts: { arg: 'productId', type: 'string', required: true },
        returns: { arg: 'description', type: 'string' },
        http: { verb: 'post', path: '/:productId/generate-description' }
    });
    
    // Ví dụ 2: Hook trước save
    Product.beforeSave(async function(next, instance) {
        if (instance.needsAIDescription && !instance.aiGeneratedDescription) {
            try {
                const prompt = `Create a catchy description for product: ${instance.name}`;
                const result = await callGemini(prompt, {
                    waitForResult: false // Non-blocking, background job
                });
                
                instance.aiDescriptionJobId = result.jobId;
                console.log(`AI description job queued: ${result.jobId}`);
                
            } catch (error) {
                console.error('Error queueing AI description:', error);
            }
        }
        next();
    });
}

module.exports = {
    callGemini,
    integrationExample
};
