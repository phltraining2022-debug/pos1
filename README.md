# Hệ thống Quản lý Karaoke Thông minh

## 🎤 Giới thiệu

Hệ thống quản lý Karaoke chuyên nghiệp được xây dựng với AngularJS 1.8.2 và Tailwind CSS, tối ưu cho iPad (Thu ngân) và thiết bị di động (Nhân viên, Khách hàng).

## ✨ Tính năng chính

### 1. Thu Ngân (Cashier) - iPad Landscape
- **Giao diện 3 cột**: Sơ đồ phòng | Bill | Menu
- Quản lý phòng real-time với trạng thái màu sắc
- Tính tiền giờ động theo khung giờ và loại phòng
- Order món nhanh chóng
- Thanh toán đa phương thức (Tiền mặt, Chuyển khoản, QR)
- Chức năng: Đổi phòng, Sửa giờ, Gộp/Tách bill
- In hóa đơn tự động

### 2. Khách Hàng (Customer) - Mobile Web
- Quét QR để order món tại phòng
- Xem menu với hình ảnh và giá
- Giỏ hàng thông minh
- Gọi nhân viên, yêu cầu thanh toán
- Không cần cài đặt app

### 3. Phục Vụ (Waiter) - Mobile Portrait
- Order món tại bàn
- Checklist dọn phòng chi tiết
- Quản lý công việc theo phòng
- Ghi chú đặc biệt cho món ăn

### 4. Bếp/Bar (Kitchen) - Tablet Landscape
- Màn hình hiển thị queue đơn hàng (FIFO)
- Cảnh báo đơn quá hạn
- Cập nhật trạng thái món (Chờ làm → Đang làm → Đã xong)
- Báo hết nguyên liệu

## 🚀 Công nghệ

- **Frontend**: AngularJS 1.8.2
- **CSS Framework**: Tailwind CSS
- **PWA**: Service Worker, Offline-first
- **Icons**: Font Awesome 6
- **Storage**: LocalStorage (Offline support)

## 📦 Cấu trúc Project

```
kara2/
├── index.html                 # Entry point
├── manifest.json              # PWA manifest
├── service-worker.js          # Service worker cho offline
├── app/
│   ├── app.js                 # Main AngularJS module
│   ├── config/
│   │   └── routes.js          # Route configuration
│   ├── controllers/
│   │   ├── login.controller.js
│   │   ├── cashier.controller.js
│   │   ├── customer.controller.js
│   │   ├── waiter.controller.js
│   │   ├── kitchen.controller.js
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── room.service.js
│   │   ├── menu.service.js
│   │   ├── order.service.js
│   │   ├── payment.service.js
│   │   ├── staff.service.js
│   │   ├── storage.service.js
│   │   ├── sync.service.js
│   │   └── audit.service.js
│   └── views/
│       ├── login.html
│       ├── cashier.html
│       ├── customer.html
│       ├── waiter.html
│       ├── kitchen.html
└── refs/
    └── spec.md                # Đặc tả chi tiết
```

## 🔧 Cài đặt & Chạy

### 1. Chạy local với Python SimpleHTTPServer:

```bash
# Python 3
cd kara2
python3 -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

Truy cập: `http://localhost:8000`

### 2. Chạy với Node.js http-server:

```bash
npm install -g http-server
cd kara2
http-server -p 8000
```

### 3. Chạy với PHP:

```bash
cd kara2
php -S localhost:8000
```

## 👤 Tài khoản đăng nhập mặc định

| Vai trò | Username | Password | Chức năng |
|---------|----------|----------|-----------|
| Thu ngân | cashier | 123456 | POS Dashboard (iPad) |
| Phục vụ | waiter | 123456 | Order & Dọn phòng (Mobile) |
| Bếp/Bar | kitchen | 123456 | Kitchen Display (Tablet) |

## 📱 Hướng dẫn sử dụng

### Thu ngân (Cashier):
1. Đăng nhập với role "Thu ngân"
2. Chọn phòng trống để mở phòng (Check-in)
3. Thêm món từ menu vào bill
4. Gửi order để bếp nhận
5. Thanh toán khi khách yêu cầu
6. In bill và phòng chuyển sang trạng thái "Đang dọn"

### Khách hàng (Customer):
1. Quét QR code tại phòng (Format: /customer/ROOM_ID)
2. Chọn món từ menu
3. Thêm ghi chú nếu cần
4. Gửi order
5. Sử dụng nút "Gọi nhân viên" hoặc "Yêu cầu thanh toán"

### Phục vụ (Waiter):
1. Đăng nhập với role "Phục vụ"
2. **Tab Phòng**: Xem danh sách phòng đang dùng và cần dọn
3. **Tab Order**: Chọn phòng → Order món
4. **Tab Dọn phòng**: Thực hiện checklist dọn phòng

### Bếp/Bar (Kitchen):
1. Đăng nhập với role "Bếp/Bar"
2. Xem queue đơn hàng theo thời gian
3. Click "Bắt đầu làm" khi nhận đơn
4. Click "Đã xong" khi hoàn thành
5. Báo "Hết nguyên liệu" nếu cần

## 🎨 Responsive Design

- **iPad Landscape (1024x768)**: Cashier POS (3 cột)
- **Tablet Landscape (768x1024)**: Kitchen Display
- **Mobile Portrait (375x812)**: Customer, Waiter

## 🔒 Bảo mật

- Audit Log ghi lại mọi thao tác nhạy cảm
- Yêu cầu lý do khi sửa giờ vào, hủy món, giảm giá
- Phân quyền rõ ràng theo role

## 📊 Tính năng nổi bật

### Offline-First PWA
- Hoạt động khi mất mạng
- Tự động đồng bộ khi có mạng trở lại
- Service Worker cache assets

### Real-time Updates
- Đồng hồ đếm giờ phòng
- Tính tiền động theo khung giờ
- Cập nhật trạng thái real-time

### Smart Pricing Engine
- Tính tiền theo block (15p, 30p, 60p)
- Giá động theo khung giờ (Sáng, Chiều, Tối)
- Hỗ trợ giá ngày lễ

### Audit Trail
- Log mọi thao tác quan trọng
- Lưu giá trị cũ/mới
- Tracking người thực hiện

## 🛠️ Mở rộng

### Kết nối Backend API:
Thay thế mock data trong các service bằng API calls:

```javascript
// Example trong order.service.js
$http.post('/api/orders', order).then(response => {
    // Handle response
});
```

### Kết nối máy in:
Sử dụng Web Bluetooth API hoặc network printer:

```javascript
// Example print function
function printBill(bill) {
    // Use PrintJS, jsPDF, or hardware printer API
}
```

### Tích hợp Payment Gateway:
- Momo API
- ZaloPay API
- VNPAY QR Dynamic

## 📝 License

MIT License - Tự do sử dụng cho mục đích thương mại

## 👨‍💻 Tác giả

Phát triển bởi Builder-1 Team
Phiên bản: 1.0
Ngày: 2025

---

**Lưu ý**: Đây là bản demo với dữ liệu mock. Để sử dụng production, cần kết nối backend API và database thực tế.
