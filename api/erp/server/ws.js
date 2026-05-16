const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected clients and their filters
const clients = new Map();

// ─── Broadcast helper ─────────────────────────────────────────────────────────
function broadcastToClients(data) {
    let sent = 0;
    clients.forEach((filter, client) => {
        if (client.readyState !== WebSocket.OPEN) return;
        // Filter theo tenantId (restaurant) nếu có
        if (data.tenantId && filter.tenantId && data.tenantId !== filter.tenantId) return;
        // Filter theo clinicShortName (legacy) nếu có
        if (data.clinicShortName && filter.clinicShortName && data.clinicShortName !== filter.clinicShortName) return;
        // Filter theo toId nếu có
        if (data.toId && data.toId !== filter.userId) return;
        client.send(JSON.stringify(data));
        sent++;
    });
    return sent;
}

// ─── HTTP endpoint cho LoopBack gọi sau khi save ──────────────────────────────
app.post('/broadcast', (req, res) => {
    const sent = broadcastToClients(req.body);
    res.json({ ok: true, clients: clients.size, sent });
});

// ─── WebSocket server ─────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
    console.log('[WS] Client connected, total:', clients.size + 1);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.action === 'subscribe') {
                clients.set(ws, {
                    userId: data.filter.userId || '',
                    tenantId: data.filter.tenantId || '',
                    clinicShortName: data.filter.clinicShortName || '',
                });
                console.log('[WS] Subscribed:', data.filter);
                ws.send(JSON.stringify({ action: 'subscribe_success', filter: data.filter }));
            }
        } catch (err) {
            console.error('[WS] Invalid message:', err.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('[WS] Client disconnected, remaining:', clients.size);
    });
});

// ─── Redis (optional, bỏ qua nếu không chạy) ─────────────────────────────────
try {
    const redis = require('redis');
    const redisSubscriber = redis.createClient();
    redisSubscriber.on('error', (err) => console.warn('[Redis] error (skipping):', err.message));
    redisSubscriber.subscribe('updates');
    redisSubscriber.on('message', (channel, message) => {
        if (channel === 'updates') {
            try { broadcastToClients(JSON.parse(message)); } catch {}
        }
    });
    console.log('[Redis] Connected');
} catch (e) {
    console.warn('[Redis] Not available, using HTTP broadcast only');
}

const PORT = process.env.WS_PORT || 30000;
server.listen(PORT, () => console.log(`[WS] Server running on port ${PORT}`));
