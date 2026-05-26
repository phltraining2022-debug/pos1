const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const redis = require('redis');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Redis pub/sub
const redisSubscriber = redis.createClient();
const redisPublisher = redis.createClient();

// Map: ws → { userId, tenantId }
const clients = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'subscribe') {
                clients.set(ws, {
                    userId: data.filter.userId,
                    clinicShortName: data.filter.clinicShortName,
                });
                console.log(`Client subscribed: userId=${data.filter.userId}, clinicShortName=${data.filter.clinicShortName}`);
                ws.send(JSON.stringify({ action: 'subscribe_success', filter: data.filter }));
            } else {
                console.log('Unknown action:', data.action);
            }
        } catch (err) {
            console.error('Invalid message format:', err);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
    });
});

// Subscribe to Redis channel "updates"
redisSubscriber.subscribe('updates');

redisSubscriber.on('message', (channel, message) => {
    if (channel !== 'updates') return;

    let newData;
    try {
        newData = JSON.parse(message);
    } catch (err) {
        console.error('Invalid Redis message:', err);
        return;
    }

    console.log('Received update:', newData);

    clients.forEach((filter, client) => {
        if (client.readyState !== WebSocket.OPEN) return;

        // Filter theo clinicShortName (tên datasource, vd: 'kara')
        if (newData.clinicShortName && newData.clinicShortName !== filter.clinicShortName) return;

        // Nếu có toId thì gửi riêng cho user đó
        if (newData.toId) {
            if (newData.toId === filter.userId) {
                client.send(JSON.stringify(newData));
            }
        } else {
            client.send(JSON.stringify(newData));
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', clients: clients.size, timestamp: new Date().toISOString() });
});

const PORT = 30000;
server.listen(PORT, () => console.log(`WebSocket server running on port ${PORT}`));