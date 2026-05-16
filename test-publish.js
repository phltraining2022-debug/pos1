const redis = require('redis');

// Create Redis publisher
const redisPublisher = redis.createClient();

// Test message
const testMessage = {
    model: 'SaleOrder',
    id: '69633502b8dfc70d343950d4',
    logId: '69634af1374a8f591823f15c',
    event: 'updated',
    changes: {
        paidAmount: { from: 0, to: 472500 },
        total: { from: 0, to: 472500 },
        room: { from: {} },
        deposit: { from: 0, to: null },
        discount: { from: 0, to: null }
    },
    clinicShortName: 'kara'
};

redisPublisher.publish('updates', JSON.stringify(testMessage), function(err, reply) {
    if (err) {
        console.error('Error publishing:', err);
    } else {
        console.log('Published message to Redis channel "updates"');
    }
    redisPublisher.quit();
});