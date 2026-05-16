const redis = require("redis");
const client = redis.createClient();

 client.rpush("message_queue", JSON.stringify(
    {
        model: 'visit',
        appName: 'tl',
        data: {
            id: '67c1a22d8d6a6c226d581ec6',
            message: 'Hello'
        }
    }), (err, reply) => {
 });
