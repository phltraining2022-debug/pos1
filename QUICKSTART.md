# 🚀 Quick Start Guide

## Bước 1: Khởi chạy Server

Chọn 1 trong các cách sau:

### Option 1: Python (Recommended)
```bash
cd /Users/ben/Documents/ats-cdn/builder-1/kara2
python3 -m http.server 8000
```

### Option 2: Node.js
```bash
npm install -g http-server
http-server -p 8000
```

### Option 3: PHP
```bash
php -S localhost:8000
```

## Bước 2: Truy cập ứng dụng

Mở trình duyệt và truy cập: **http://localhost:8000**

## Bước 3: Đăng nhập

### 👨‍💼 Thu ngân (iPad Landscape)
- Username: `cashier`
- Password: `123456`
- Route: `/cashier`

### 👥 Phục vụ (Mobile)
- Username: `waiter`
- Password: `123456`
- Route: `/waiter`

### 🍳 Bếp/Bar (Tablet)
- Username: `kitchen`
- Password: `123456`
- Route: `/kitchen`

###  Khách hàng (Mobile - Không cần login)
- Route: `/customer/1` (Phòng 1)
- Route: `/customer/2` (Phòng 2)
- ...

## 🎯 Demo Flow

### Quy trình hoàn chỉnh:

1. **Thu ngân mở phòng**
   - Login as cashier
   - Click phòng trống (màu xanh)
   - Nhập thông tin khách
   - Confirm check-in

2. **Khách order món**
   - Truy cập `/customer/[room-id]`
   - Chọn món từ menu
   - Thêm vào giỏ hàng
   - Gửi order

3. **Bếp nhận đơn**
   - Login as kitchen
   - Xem đơn hàng mới
   - Click "Bắt đầu làm"
   - Click "Đã xong" khi hoàn thành

4. **Thu ngân thanh toán**
   - Chọn phòng đang dùng (màu đỏ)
   - Kiểm tra bill
   - Click "Thanh toán"
   - Chọn phương thức
   - Xác nhận thanh toán

5. **Phục vụ dọn phòng**
   - Login as waiter
   - Chọn phòng "Đang dọn" (màu vàng)
   - Hoàn thành checklist
   - Confirm hoàn tất

## 📱 Test trên thiết bị thật

### iPad (Cashier):
1. Kết nối cùng mạng WiFi
2. Truy cập `http://[YOUR_IP]:8000`
3. Add to Home Screen
4. Xoay ngang để dùng layout 3 cột

### Mobile (Waiter/Customer):
1. Scan QR code hoặc nhập URL
2. Add to Home Screen
3. Dùng ở chế độ dọc

## 🔧 Troubleshooting

### Lỗi CORS:
Nếu gặp lỗi CORS, dùng Chrome với flag:
```bash
open -na "Google Chrome" --args --disable-web-security --user-data-dir=/tmp/chrome
```

### Clear Cache:
```bash
# Clear browser cache
# Chrome: Cmd+Shift+Delete
# Safari: Cmd+Option+E
```

### Reset Data:
Mở Console (F12) và chạy:
```javascript
localStorage.clear();
location.reload();
```

## 📊 Sample Data

Hệ thống đã có sẵn:
- 12 phòng (VIP 01-02, Phòng 01-10)
- 15 món ăn/đồ uống
- Bảng giá động 9 cấu hình

## 🎨 Customize

### Thay đổi màu chủ đạo:
Edit trong `index.html`:
```javascript
tailwind.config = {
    theme: {
        extend: {
            colors: {
                primary: '#3b82f6', // Đổi màu này
                secondary: '#8b5cf6',
            }
        }
    }
}
```

### Thêm phòng mới:
Edit trong `app/services/room.service.js`:
```javascript
this.initRooms = function() {
    rooms = [
        { id: 13, name: 'Phòng 11', type: 'small', status: 'empty', capacity: 6 },
        // ... thêm phòng mới
    ];
};
```

## 📞 Support

Nếu có vấn đề, check:
1. Console log (F12)
2. Network tab để xem request
3. Application > Local Storage để xem data

---

**Happy coding! 🎉**
