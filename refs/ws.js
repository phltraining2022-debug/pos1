const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const redis = require('redis');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Create Redis Publisher and Subscriber for Redis 2.8
const redisSubscriber = redis.createClient();
const redisPublisher = redis.createClient();

// Store connected clients and their filters
const clients = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'subscribe') {
                // Store the client's filter criteria (bao gồm clinicId để filter)
                clients.set(ws, {
                    userId: data.filter.userId,
                    clinicShortName: data.filter.clinicShortName  // Lưu clinicId để filter messages
                });
            
                console.log(`Client subscribed to userId: ${data.filter.userId}, clinicId: ${data.filter.clinicId || 'not set'}`);
                ws.send(JSON.stringify({
                    action: 'subscribe_success',
                    filter: data.filter
                }));
            }else if (data.action === 'message') {

            

            } else {
                console.log('Invalid action:', data.action
                );
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

// Subscribe to Redis channel
redisSubscriber.subscribe('updates');

redisSubscriber.on('message', (channel, message) => {
    console.log(`Received message from channel ${channel}: ${message}`);
    if (channel === 'updates') {
        const newData = JSON.parse(message);
        console.log('New data:', newData);
        // Send updates only to subscribed clients - Filter theo clinicId để tránh race condition
        clients.forEach((filter, client) => {
            if (client.readyState === WebSocket.OPEN) {
                // Filter theo clinicId trước - chỉ gửi message đến clients cùng clinic
                console.log('Filter:', filter);
                if (newData.clinicShortName) {
                    if (newData.clinicShortName !== filter.clinicShortName) {
                        console.log('ClinicShortName không match:', newData.clinicShortName, filter.clinicShortName);
                        return; // Skip nếu clinicShortName không match
                    }
               
                    // Nếu message không có clinicShortName nhưng client có filter clinicShortName, skip
                    // if (filter.clinicShortName) {
                    //     return; // Skip để tránh gửi message không có clinic đến client có filter
                    // }



                    
                }

                if (newData.toId) {
                    // Message có toId - gửi đến user cụ thể
                    if (newData.toId === filter.userId) {
                        console.log('Gửi message đến user cụ thể:', newData.toId, filter.userId);
                        client.send(JSON.stringify(newData));
                    }
                } else {
                    console.log('Gửi message đến tất cả user:', newData.toId, filter.userId);
                    client.send(JSON.stringify(newData));
                }
                
            }
        });
    }
});

server.listen(30000, () => console.log('WebSocket server running on port 3000'));
