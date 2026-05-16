# 🎤 HỆ THỐNG QUẢN LÝ KARAOKE - HƯỚNG DẪN SỬ DỤNG TIẾNG VIỆT

## 🎯 TỔNG QUAN

Hệ thống quản lý Karaoke hoàn chỉnh, web-based (không cần cài đặt), hoạt động được cả khi mất mạng.

## 🚀 KHỞI ĐỘNG NHANH

### Bước 1: Mở Terminal/Command Prompt
```bash
cd /Users/ben/Documents/ats-cdn/builder-1/kara2
python3 -m http.server 8000
```

### Bước 2: Mở trình duyệt
Truy cập: **http://localhost:8000**

### Bước 3: Đăng nhập
- Tất cả mật khẩu: **123456**

## 👥 VAI TRÒ NGƯỜI DÙNG

### 1️⃣ THU NGÂN (Cashier) - Dùng iPad xoay ngang

**Đăng nhập**: 
- User: `cashier`
- Pass: `123456`

**Màn hình chính có 3 cột**:
```
┌────────────┬──────────┬──────────┐
│ Sơ đồ phòng │ Hóa đơn  │ Thực đơn │
└────────────┴──────────┴──────────┘
```

**Chức năng**:

✅ **Mở phòng (Check-in)**:
1. Chạm vào phòng màu xanh (Trống)
2. Nhập thông tin khách
3. Chọn giờ bắt đầu (có thể chỉnh)
4. Xác nhận

✅ **Order món**:
1. Chạm phòng màu đỏ (Đang dùng)
2. Chọn danh mục món (Bia, Nước ngọt, Khô...)
3. Chạm món để thêm vào giỏ
4. Nhấn "Gửi order"

✅ **Thanh toán**:
1. Chọn phòng cần thanh toán
2. Nhấn "Thanh toán"
3. Chọn phương thức (Tiền mặt/Chuyển khoản/QR)
4. Nếu tiền mặt: nhập số tiền khách đưa
5. Xác nhận thanh toán
6. In bill (tự động)

✅ **Các chức năng khác**:
- **Đổi phòng**: Chuyển khách sang phòng khác
- **Sửa giờ**: Chỉnh giờ vào (phải ghi lý do)
- **Giảm giá**: Áp giảm giá cho bill

**Màu sắc phòng**:
- 🟢 Xanh = Trống (có thể mở)
- 🔴 Đỏ = Đang dùng
- 🟡 Vàng = Đang dọn
- ⚫ Đen = Bảo trì

---

### 2️⃣ KHÁCH HÀNG (Customer) - Điện thoại

**Truy cập**: 
- Quét QR hoặc vào link: `http://localhost:8000/#/customer/1`
- (Thay số 1 = số phòng)

**Không cần đăng nhập!**

**Chức năng**:

✅ **Xem menu & Order**:
1. Chọn danh mục món
2. Chạm "+" để thêm vào giỏ
3. Nhấn icon giỏ hàng (góc phải trên)
4. Kiểm tra giỏ hàng
5. Nhấn "Gửi order"

✅ **Gọi dịch vụ**:
- Nhấn "Gọi nhân viên" → Nhân viên được thông báo
- Nhấn "Yêu cầu thanh toán" → Thu ngân được thông báo

---

### 3️⃣ PHỤC VỤ (Waiter) - Điện thoại

**Đăng nhập**:
- User: `waiter`
- Pass: `123456`

**Có 3 tab**:

✅ **Tab 1: Phòng**
- Xem danh sách phòng đang dùng (màu đỏ)
- Xem phòng cần dọn (màu vàng)
- Chạm phòng đỏ → Order món
- Chạm phòng vàng → Dọn phòng

✅ **Tab 2: Order**
(Sau khi chọn phòng từ Tab 1)
1. Chọn danh mục
2. Chạm món để thêm
3. Điều chỉnh số lượng (+/-)
4. Nhấn "Gửi order"

✅ **Tab 3: Dọn phòng**
(Sau khi chọn phòng vàng từ Tab 1)
1. Thấy danh sách 10 việc cần làm:
   - Kiểm tra Micro
   - Kiểm tra Loa
   - Kiểm tra Màn hình
   - Dọn bàn ghế
   - Thu ly/chai
   - Lau bàn
   - Quét dọn
   - Vệ sinh WC
   - Xịt khử mùi
   - v.v.
2. Chạm vào mỗi mục để tích ✓
3. Sau khi tích đủ 10 mục
4. Nhấn "Hoàn tất dọn phòng"
5. Phòng tự động chuyển sang "Trống"

---

### 4️⃣ BẾP/BAR (Kitchen) - Màn hình hoặc Tablet xoay ngang

**Đăng nhập**:
- User: `kitchen`
- Pass: `123456`

**Chức năng**:

✅ **Xem đơn hàng**:
- Tất cả đơn hiện theo thứ tự thời gian
- Đơn nào đợi lâu >15 phút sẽ có viền đỏ
- Mỗi đơn hiển thị:
  - Số phòng
  - Thời gian đợi
  - Danh sách món + số lượng
  - Ghi chú (nếu có)

✅ **Xử lý đơn**:
1. Đơn mới → Nhấn "Bắt đầu làm"
2. Đang làm → Nhấn "Đã xong" khi hoàn thành
3. Hết nguyên liệu → Nhấn icon ⛔ → Món tự động ẩn khỏi menu

✅ **Bộ lọc**:
- Tất cả: Xem tất cả đơn
- Chờ làm: Chỉ đơn mới
- Đang làm: Chỉ đơn đang xử lý

---

## 📊 QUY TRÌNH HOẠT ĐỘNG CHUẨN

### Quy trình hoàn chỉnh từ đầu đến cuối:

```
1. KHÁCH ĐẾN
   ↓
2. THU NGÂN MỞ PHÒNG
   ↓
3. KHÁCH ORDER (hoặc PHỤC VỤ ORDER)
   ↓
4. BẾP NHẬN ĐƠN & LÀM MÓN
   ↓
5. PHỤC VỤ MANG MÓN RA
   ↓
6. KHÁCH SỬ DỤNG DỊCH VỤ
   ↓
7. KHÁCH YÊU CẦU THANH TOÁN
   ↓
8. THU NGÂN THANH TOÁN & IN BILL
   ↓
9. PHÒNG CHUYỂN SANG "ĐANG DỌN"
   ↓
10. PHỤC VỤ DỌN PHÒNG (CHECKLIST)
    ↓
11. PHÒNG CHUYỂN VỀ "TRỐNG"
    ↓
12. SẴN SÀNG CHO KHÁCH TIẾP THEO
```

---

## 💡 MẸO SỬ DỤNG

### Thu ngân:
- **Đổi phòng nhanh**: Nhấn "Đổi phòng" → Chọn phòng trống → Xác nhận
- **Sửa giờ vào**: Nhấn "Sửa giờ" → Chọn giờ mới → Nhập lý do → Xác nhận
- **Giảm giá**: Trong màn thanh toán → Nhập số tiền giảm → Nhập lý do

### Khách hàng:
- **Thêm ghi chú**: Trong giỏ hàng → Ô "Ghi chú" → Gõ yêu cầu đặc biệt
- **Gọi nhân viên**: Khi cần thêm đá, ly, v.v.

### Phục vụ:
- **Order nhanh**: Học thuộc vị trí món trong menu để thêm nhanh
- **Dọn phòng**: Tích từ trên xuống theo thứ tự để không bỏ sót

### Bếp:
- **Ưu tiên đơn đỏ**: Đơn nào >15 phút xử lý trước
- **Báo hết hàng**: Nhấn ngay khi hết để khách không order nhầm

---

## 🔧 XỬ LÝ SỰ CỐ

### Nhầm order:
1. Thu ngân vào bill
2. Nhấn icon 🗑️ bên món cần xóa
3. Gửi order lại

### Khách đổi phòng:
1. Thu ngân nhấn "Đổi phòng"
2. Chọn phòng mới
3. Xác nhận → Bill tự động chuyển

### Tính giờ sai:
1. Thu ngân nhấn "Sửa giờ"
2. Chọn giờ đúng
3. Nhập lý do (bắt buộc)
4. Xác nhận → Tiền tự động tính lại

### Mất mạng:
- **Không sao!** Hệ thống vẫn hoạt động
- Tất cả thao tác lưu tạm trong máy
- Khi có mạng lại, tự động đồng bộ

### Quên mật khẩu:
- Mật khẩu demo: **123456** (tất cả user)
- Production: Liên hệ quản lý hệ thống

---

## 📱 YÊU CẦU THIẾT BỊ

### Tối thiểu:
- **Thu ngân**: iPad từ 2017 trở lên, màn hình ≥10 inch
- **Phục vụ**: iPhone 6 trở lên hoặc Android ≥5.0
- **Bếp**: Tablet ≥8 inch
- **Khách**: Điện thoại bất kỳ có camera (quét QR)

### Trình duyệt:
- Chrome/Safari/Edge (khuyến nghị Chrome)
- Phiên bản mới nhất

### Kết nối:
- WiFi ổn định (khuyến nghị)
- 4G/5G (dự phòng)
- Có thể hoạt động offline

---

## 🆘 HỖ TRỢ

### Cần trợ giúp?
1. Đọc file README.md
2. Đọc file QUICKSTART.md
3. Kiểm tra Console (F12)
4. Liên hệ IT

### Reset dữ liệu:
Mở Console (F12) → Gõ:
```javascript
localStorage.clear();
location.reload();
```

### Xem log:
Mở Console (F12) → Tab "Console"

---

## ✅ CHECKLIST CUỐI NGÀY

### Thu ngân:
- [ ] Kiểm tra tất cả phòng đã thanh toán
- [ ] Đối chiếu tiền mặt với hệ thống
- [ ] In báo cáo cuối ngày

### Phục vụ:
- [ ] Kiểm tra tất cả phòng đã dọn sạch
- [ ] Báo cáo đồ hỏng (nếu có)

### Bếp:
- [ ] Cập nhật món hết hàng cho ngày mai
- [ ] Báo cáo quản lý cần nhập thêm gì

---

## 🎉 KẾT LUẬN

Hệ thống đã sẵn sàng sử dụng với đầy đủ tính năng:
- ✅ Dễ dùng, không cần đào tạo lâu
- ✅ Hoạt động ổn định, nhanh chóng
- ✅ Hoạt động được cả khi mất mạng
- ✅ Theo dõi được mọi thao tác
- ✅ Báo cáo đầy đủ

**Chúc bạn kinh doanh thành công!** 🎤🎶

---

**Phiên bản**: 1.0.0  
**Ngày**: 17/12/2025  
**Liên hệ**: GitHub Issues
