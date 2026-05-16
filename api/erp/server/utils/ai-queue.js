var redis = require('redis');

/**
 * Hàm gửi job cho AI Worker và chờ kết quả
 * @param {Object} jobObj - Dữ liệu job (prompt, systemPrompt, etc.)
 * @param {Function} cb - Callback (err, result)
 */
function pushJob(jobObj, cb) {
    // Tạo client redis mới cho mỗi request để tránh block connection chung
    var client = redis.createClient({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379
    });

    client.on('error', function (err) {
        console.error('AI Queue Redis Error:', err);
        try { client.quit(); } catch (e) { }
        if (cb) cb(err);
    });

    // Tạo ID và Key phản hồi
    var jobId = jobObj.jobId || (Date.now().toString() + '-' + Math.random().toString(36).substr(2, 6));
    var responseKey = jobObj.responseKey || ('gemini:response:' + jobId);

    jobObj.jobId = jobId;
    jobObj.responseKey = responseKey;

    var payload = JSON.stringify(jobObj);

    // 1. Đẩy job vào hàng đợi
    client.lpush('gemini:queue', payload, function (err, res) {
        if (err) {
            try { client.quit(); } catch (e) { }
            return cb(err);
        }

        // Nếu không cần chờ kết quả (fire-and-forget)
        if (jobObj.waitForResult === false) {
            try { client.quit(); } catch (e) { }
            return cb(null, { jobId: jobId, status: 'queued' });
        }

        // 2. Chờ kết quả trả về (timeout mặc định 5 phút)
        var timeoutSecs = jobObj.timeoutSecs || 300;

        client.brpop(responseKey, timeoutSecs, function (brErr, reply) {
            try { client.quit(); } catch (e) { }

            if (brErr) return cb(brErr);
            if (!reply) return cb(new Error('Timed out waiting for AI response'));

            // Parse kết quả
            var value = reply[1];
            try {
                var parsed = JSON.parse(value);
                return cb(null, parsed);
            } catch (e) {
                return cb(null, value);
            }
        });
    });
}

module.exports = {
    pushJob: pushJob
};