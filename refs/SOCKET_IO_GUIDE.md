# Socket.IO Connection Guide

## Custom Path Configuration

### 1. Tại Sao Cần Custom Path?

- **Nginx không forward `/socket.io/`**: Server của bạn có thể không expose path mặc định
- **Reverse proxy config**: Nginx chỉ forward path cụ thể
- **Security**: Ẩn Socket.IO endpoint

### 2. Server Config

```javascript
// Socket.IO server với custom path
const io = require('socket.io')(server, {
  path: '/'  // Lắng nghe tại root path
});

// Hoặc custom path khác:
const io = require('socket.io')(server, {
  path: '/ws'  // Lắng nghe tại /ws
});
```

### 3. Client Config

```javascript
// Client connect với custom path
const socket = io('https://domain.com', {
  path: '/'  // Phải match với server
});
```

### 4. Nginx Config

```nginx
# Forward tất cả requests tới Socket.IO server
location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Hoặc chỉ forward path cụ thể:
location /ws {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # ... other headers
}
```

### 5. Test với Tool

Trong file `test-wss.html`, bạn có thể:
- Chọn **Socket Path** từ dropdown
- Click **Reconnect** để test với path mới
- Xem **Debug Info** để verify URL

### 6. Troubleshooting

- **404 Error**: Path không match giữa client và server
- **Handshake Fail**: Nginx không forward đúng headers
- **WebSocket Fail**: Missing `Upgrade` và `Connection` headers

## Kết Luận

**Custom path cho phép linh hoạt config** nhưng phải đảm bảo client và server match nhau. Root path (`/`) thường dễ config nhất với nginx.