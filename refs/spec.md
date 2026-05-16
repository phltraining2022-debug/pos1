# **TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM (SRS)**

Dự án: Hệ thống Quản lý Karaoke Thông minh  
Nền tảng: Web PWA (Tối ưu Responsive cho iPad & Mobile)  
Phiên bản: 1.2

## **1\. PHÂN QUYỀN NGƯỜI DÙNG (ACTORS)**

1. **Thu ngân (Cashier):** Sử dụng **iPad (Chế độ ngang)**. Thao tác mở phòng, điều phối, thanh toán, **quản lý đặt phòng, giao ca**.  
2. **Phục vụ (Waiter):** Sử dụng **Điện thoại**. Order món tại bàn, thực hiện checklist dọn phòng, **chấm công**.  
3. **Bếp/Bar (Kitchen):** Sử dụng **Tablet/Màn hình**. Nhận đơn, báo hết món, trả món.  
4. **Admin (Owner/Manager):** Sử dụng **PC/iPad**. Cấu hình giá, kho, khuyến mãi, nhân sự, xem báo cáo, kiểm tra nhật ký hệ thống (Audit).  
5. **Khách hàng (Guest):** Sử dụng **Điện thoại cá nhân**. Quét QR gọi món, xem ưu đãi, gọi nhân viên.

## **2\. CHỨC NĂNG CHI TIẾT THEO PHÂN HỆ**

### **2.1. PHÂN HỆ THU NGÂN (POS)**

Thiết bị: iPad (Landscape).  
Giao diện: Single-Page Dashboard (3 cột: Sơ đồ \- Bill \- Menu).

#### **A. Quản lý Sơ đồ phòng & Trạng thái (Cột 1\)**

* **Hiển thị:** Lưới phòng (Grid). Thông tin: Tên phòng, Loại phòng, Đồng hồ đếm giờ.  
* **Trạng thái màu sắc:**  
  * 🟢 **Trống:** Sẵn sàng nhận khách.  
  * 🔵 **Đã đặt (Booking):** Hiển thị giờ khách sẽ đến \+ Số tiền cọc.  
  * 🔴 **Đang dùng:** Hiển thị thời gian đã hát \+ Tổng tiền tạm tính.  
  * 🟡 **Đang dọn:** Hiển thị tên nhân viên đang thực hiện Checklist.  
  * ⚫ **Đang bảo trì:** Khóa thao tác, hiển thị lý do bảo trì.  
* **Thao tác nhanh:**  
  * Chạm phòng Trống → Mở Popup Check-in hoặc **Tạo Đặt phòng**.  
  * Chạm phòng Đang dùng → Load chi tiết sang Cột 2 (Bill).

#### **B. Xử lý Bill & Tính tiền (Cột 2\)**

* **Thông tin Bill:** Giờ bắt đầu, Giờ kết thúc dự kiến, Thông tin khách hàng (Tự động hiển thị hạng thành viên).  
* **Logic Tính tiền giờ (Time Engine):**  
  * **Block tính tiền:** Tính theo block cài đặt (15p, 30p, 60p).  
  * **Bảng giá động:** Tự động áp giá theo khung giờ (Sáng, Tối, Khuya, Lễ) và loại phòng.  
* **Thao tác nghiệp vụ:**  
  * **Chỉnh sửa giờ:** Cho phép sửa giờ bắt đầu (Bắt buộc nhập lý do → Ghi Log Audit).  
  * **Đổi phòng:** Chuyển bill sang phòng mới. Giữ nguyên thời gian bắt đầu. Áp giá phòng mới từ thời điểm chuyển.  
  * **Gộp/Tách Bill:** Gộp/Tách phòng, tách món linh hoạt.  
* **Thanh toán & Khuyến mãi:**  
  * **Áp dụng khuyến mãi:** Tự động (Giờ vàng, Hạng thẻ) hoặc Thủ công (Voucher).  
  * **Thanh toán:** Tiền mặt, Chuyển khoản, QR Động.  
  * **In bill:** Kết nối máy in LAN/Bluetooth. Sau khi in → Chuyển trạng thái phòng sang "Đang dọn".

#### **C. Order & Điều phối món (Cột 3\)**

* **Menu:** Danh sách món. Tìm kiếm nhanh.  
* **Thao tác:** Chạm món → Thêm vào Bill (hiệu ứng bay vào giỏ).  
* **Quản lý Trả/Hủy món:** Cho phép hủy/trả có lý do. Ghi nhận thời gian thực.

#### **D. Quản lý Đặt phòng & Giao ca (Mới)**

* **Quản lý Đặt phòng (Booking):**  
  * **Timeline View:** Xem lịch đặt phòng theo trục thời gian ngang.  
  * **Tạo Booking:** Ghi nhận Tên khách, SĐT, Giờ đến, Tiền cọc (nếu có).  
  * **Cảnh báo:** Tự động nhắc nhở khi sắp đến giờ khách đặt (trước 15p).  
* **Quản lý Giao ca (Shift Handover):**  
  * **Đầu ca:** Nhập số tiền mặt đầu két (Float money).  
  * **Cuối ca:** Hệ thống tính tổng doanh thu tiền mặt dự kiến. Thu ngân nhập số tiền thực tế đang cầm.  
  * **Chênh lệch:** Hệ thống ghi nhận số tiền Thừa/Thiếu và yêu cầu giải trình nếu chênh lệch.

### **2.2. PHÂN HỆ KHÁCH HÀNG (MOBILE WEB)**

* **Truy cập:** Quét QR → Web App định danh theo Phòng.  
* **Chức năng:** Menu, Order, Gọi nhân viên, Yêu cầu thanh toán.  
* **Thành viên & Ưu đãi:** Đăng ký bằng SĐT, xem hạng thẻ, điểm tích lũy, voucher cá nhân.  
* **Đánh giá:** Gửi phản hồi chất lượng.

### **2.3. PHÂN HỆ PHỤC VỤ (STAFF APP)**

* **Chấm công (Mới):**  
  * Nhân viên đăng nhập app, bấm **Check-in** khi đến và **Check-out** khi về.  
  * Hệ thống ghi nhận GPS/Wifi quán để đảm bảo nhân viên đang ở tại quán.  
* **Nhận Order tại bàn:** Chọn phòng, thêm món, ghi chú.  
* **Quy trình Dọn phòng:** Nhận thông báo "Đang dọn", thực hiện Checklist, xác nhận "Hoàn tất".

### **2.4. PHÂN HỆ BẾP/BAR (KITCHEN DISPLAY)**

* **Hàng đợi (Queue):** Hiển thị món cần làm (FIFO).  
* **Thao tác:** Xác nhận "Đang làm", "Đã xong", báo "Hết hàng".

### **2.5. PHÂN HỆ ADMIN & QUẢN TRỊ (BACKEND)**

#### **A. Quản lý Kho & Hàng hóa**

* **Danh mục:** Định nghĩa món, giá, hình ảnh.  
* **Định lượng Combo (BOM):** Trừ kho chi tiết thành phần khi bán Combo.  
* **Nhập/Xuất/Tồn:** Nhập hàng (Date), Cảnh báo tồn kho thấp.  
* **Kiểm kho (Stocktake):**  
  * Tạo phiếu kiểm kho định kỳ.  
  * So sánh Tồn kho lý thuyết (System) vs Tồn kho thực tế (Count).  
  * Ghi nhận Lý do cân bằng kho (Hư hỏng, mất mát, mời khách...).

#### **B. Quản lý Doanh thu & Lợi nhuận**

* **Báo cáo Doanh thu:** Theo thời gian (Ngày/Tháng).  
* **Báo cáo Sản phẩm:** Top bán chạy.  
* **Báo cáo Lợi nhuận (P\&L):** Doanh thu \- (Giá vốn \+ Chi phí vận hành).

#### **C. Quản lý Nhân sự & Tiền lương (Mới)**

* **Quản lý Hồ sơ nhân viên:** Thông tin cá nhân, chức vụ, mức lương cơ bản/lương theo giờ.  
* **Bảng công (Timesheet):**  
  * Tự động tổng hợp từ dữ liệu Check-in/Check-out của Staff App.  
  * Tính tổng giờ làm việc thực tế, số ngày nghỉ, đi muộn/về sớm.  
* **Bảng lương (Payroll):**  
  * Công thức: (Tổng giờ làm \* Lương giờ) \+ Thưởng doanh số (từ KPI bán hàng/dọn phòng) \- Phạt \- Tạm ứng.  
  * Trạng thái chi lương: Chưa trả / Đã trả.

#### **D. Cấu hình & Bảo mật (Audit)**

* **Cấu hình giá giờ:** Bảng giá động.  
* **Audit Log:** Ghi lại hành động nhạy cảm.

#### **E. Quản lý Khuyến mãi & CRM**

* **Khuyến mãi:** Giờ vàng, Voucher, Combo.  
* **Loyalty:** Hạng thành viên, Tích điểm.

#### **F. Tích hợp Phần cứng (Hardware Interface \- Mới)**

* **Điều khiển điện (Smart Relay):**  
  * *Cơ chế:* Khi Thu ngân mở phòng trên phần mềm → Tự động bật điện nguồn thiết bị âm thanh phòng đó.  
  * *Mục đích:* Chống thất thoát doanh thu (Nhân viên không thể cho khách hát "chui" mà không mở phần mềm).

## **3\. YÊU CẦU PHI CHỨC NĂNG**

1. **PWA Offline-First:** Hoạt động khi mất mạng, tự động Sync.  
2. **Hiệu năng:** Phản hồi \< 1s.  
3. **Trải nghiệm:** Chặn zoom, pull-to-refresh. Tương thích đa thiết bị.