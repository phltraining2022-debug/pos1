const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store connected clients by app/room
const connectedApps = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Handle joining an app/room
    socket.on('join_app', (appName) => {
        socket.join(appName);
        if (!connectedApps.has(appName)) {
            connectedApps.set(appName, new Set());
        }
        connectedApps.get(appName).add(socket.id);

        console.log(`📱 ${socket.id} joined app: ${appName}`);
        console.log(`📊 Total clients in ${appName}: ${connectedApps.get(appName).size}`);

        // Notify others in the app
        socket.to(appName).emit('app_sync_data', {
            type: 'user_joined',
            socketId: socket.id,
            app: appName,
            timestamp: Date.now()
        });
    });

    // Handle app updates (cart changes, orders, etc.)
    socket.on('app_update', (data) => {
        console.log(`📤 Update from ${socket.id}:`, data);

        // Broadcast to all clients in the same app/room
        socket.to(data.app).emit('app_sync_data', {
            ...data,
            from: socket.id,
            timestamp: Date.now()
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);

        // Remove from all apps
        for (const [appName, clients] of connectedApps.entries()) {
            if (clients.has(socket.id)) {
                clients.delete(socket.id);
                console.log(`📱 ${socket.id} left app: ${appName}`);
                console.log(`📊 Remaining clients in ${appName}: ${clients.size}`);

                // Notify others
                socket.to(appName).emit('app_sync_data', {
                    type: 'user_left',
                    socketId: socket.id,
                    app: appName,
                    timestamp: Date.now()
                });

                // Clean up empty apps
                if (clients.size === 0) {
                    connectedApps.delete(appName);
                }
            }
        }
    });
});

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        connectedApps: Array.from(connectedApps.keys()),
        totalClients: io.engine.clientsCount
    });
});

// Start server
const PORT = 39001;
server.listen(PORT, () => {
    console.log(`🚀 Socket.IO server running on port ${PORT}`);
    console.log(`🔗 WebSocket endpoint: ws://localhost:${PORT}/socket.io/`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down server...');
    io.close(() => {
        console.log('✅ Socket.IO server closed');
        process.exit(0);
    });
});