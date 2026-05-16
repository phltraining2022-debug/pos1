# DANH SÁCH TÍNH NĂNG MỚI BỔ SUNG

## ✅ Đã hoàn thành 10/10 tính năng theo spec.md

---

### 1. GHI CHÚ MÓN ORDER ✅

**Chức năng:**
- Khi thêm món vào giỏ, hiện modal để nhập ghi chú
- Ghi chú hiển thị màu vàng dưới tên món trong giỏ hàng
- Ví dụ: "Thêm đá", "Không cay", "Nhiều rau, ít hành"

**Sử dụng:**
- Cashier: Click món → Nhập ghi chú → Thêm vào giỏ
- Waiter: Tương tự khi order tại phòng
- Bếp: Nhận ghi chú cùng order

**Files:**
- `/app/controllers/cashier.controller.js` - Thêm modal ghi chú
- `/app/views/cashier.html` - Modal noteModal và hiển thị note

---

### 2. CẤU HÌNH BOM CHO COMBO (Bill of Materials) ✅

**Chức năng:**
- Combo chứa danh sách món thành phần với số lượng
- Khi bán combo, tự động trừ kho từng món thành phần
- Hiển thị badge "Combo" trong giỏ hàng

**Cấu hình:**
- Menu item có thuộc tính `items` chứa array `[{itemId, quantity}]`
- VD: Combo VIP = 10 lon bia + 1 đĩa khô + 1 đĩa trái cây

**Sử dụng:**
- Cashier: Bán combo như món thường
- System: Auto trừ kho theo BOM khi thanh toán

**Files:**
- `/app/services/menu.service.js` - Sample combo với BOM
- `/app/controllers/cashier.controller.js` - Logic trừ kho combo

---

### 3. QUẢN LÝ KHO: NHẬP/XUẤT/TỒN ✅

**Chức năng:**
- **Nhập kho (Stock In)**: Nhập số lượng, giá vốn, HSD, nhà cung cấp, số hóa đơn
- **Xuất kho (Stock Out)**: FIFO (First In First Out) - xuất lô cũ trước
- **Kiểm kho (Adjust)**: Điều chỉnh số lượng thực tế với lý do
- **Cảnh báo tồn kho thấp**: Min stock warning
- **Theo dõi HSD**: Expired và Expiring Soon batches

**Tính năng nâng cao:**
- Quản lý theo lô (Batch) với tracking đầy đủ
- Tự động trừ kho khi thanh toán
- Audit log đầy đủ cho mọi giao dịch kho
- Báo cáo tồn kho, hàng hết hạn

**Sử dụng:**
- Xem cảnh báo tồn kho thấp và HSD
- System tự động trừ kho khi thanh toán

**Files:**
- `/app/services/inventory.service.js` - Service quản lý kho

---

### 4. CHỈNH SỬA GIỜ VÀO VỚI LÝ DO (Audit) ✅

**Chức năng:**
- Sửa giờ bắt đầu của phòng (datetime picker)
- Bắt buộc nhập lý do sửa giờ
- Ghi log audit đầy đủ: user, thời gian cũ/mới, lý do

**Sử dụng:**
- Cashier: Chọn phòng → "Sửa giờ" → Chọn giờ mới → Nhập lý do

**Files:**
- `/app/controllers/cashier.controller.js` - showEditTimeModal, confirmEditTime
- `/app/views/cashier.html` - Modal editTimeModal

---

### 5. GỘP/TÁCH BILL (Merge/Split) ✅

**Chức năng:**
- **Gộp bill**: Gộp 2 phòng thành 1 bill duy nhất
- **Tách bill**: Tách một số món sang phòng mới

**Gộp bill:**
1. Chọn phòng hiện tại
2. Click "Gộp bill" → Chọn phòng nguồn
3. Tất cả order của phòng nguồn chuyển sang phòng đích
4. Phòng nguồn checkout → Đang dọn

**Tách bill:**
1. Chọn phòng hiện tại
2. Click "Tách bill" → Chọn món cần tách + phòng đích (trống)
3. Món được tách sang phòng mới (auto check-in)
4. Log audit đầy đủ

**Sử dụng:**
- Cashier: 2 nút "Gộp bill" và "Tách bill" 
- Dùng khi khách đổi bàn hoặc tách bill riêng

**Files:**
- `/app/controllers/cashier.controller.js` - mergeBill, splitBill
- `/app/views/cashier.html` - Modals mergeBillModal, splitBillModal

---

### 6. ĐỔI PHÒNG VỚI LOGIC GIỮ GIỜ ✅

**Chức năng:**
- Chuyển phòng giữ nguyên thời gian bắt đầu
- Áp dụng giá phòng mới từ thời điểm chuyển
- Chuyển tất cả orders sang phòng mới

**Logic:**
- Giờ bắt đầu: GIỮ NGUYÊN (quan trọng cho tính tiền)
- Giá phòng: Áp dụng loại phòng MỚI
- Phòng cũ: Chuyển sang "Đang dọn"
- Phòng mới: Occupied với bill ID cũ

**Sử dụng:**
- Cashier: Chọn phòng → "Đổi phòng" → Chọn phòng trống
- System: Auto transfer data và log audit

**Files:**
- `/app/services/room.service.js` - changeRoom() function
- `/app/controllers/cashier.controller.js` - showChangeRoomModal

---

### 7. TRẢ MÓN VỚI LÝ DO VÀ GHI LOG ✅

**Chức năng:**
- Trả món khỏi bill với dropdown lý do
- Lý do: Khách đợi lâu, Đổi món, Không đúng yêu cầu, Hết hàng, Sai order, Khác
- Hoàn trả kho (FIFO reverse)
- Ghi log audit chi tiết

**Quy trình:**
1. Click nút "Trả món" (icon undo) trên item
2. Chọn lý do từ dropdown
3. Xác nhận → Món bị xóa + hoàn kho + log audit

**Sử dụng:**
- Cashier/Waiter: Trả món từ giỏ hàng
- System: Auto cộng lại số lượng vào kho

**Files:**
- `/app/controllers/cashier.controller.js` - returnItem, confirmReturn
- `/app/views/cashier.html` - Modal returnModal

---

### 8. BÁO HẾT MÓN TỪ BẾP → ẨN TRÊN MENU ✅

**Chức năng:**
- Bếp/Bar báo hết món → Món bị ẩn khỏi tất cả menu
- Set stock = 0
- Cashier/Waiter/Customer không thấy món đó nữa

**Sử dụng:**
- Kitchen: Chọn order → Click "Báo hết món" trên item
- Alert: "Đã báo hết món X. Món này sẽ bị ẩn khỏi menu"
- Menu filter: `MenuService.getMenuItems()` chỉ trả về `stock > 0`

**Files:**
- `/app/controllers/kitchen.controller.js` - markOutOfStock()
- `/app/services/menu.service.js` - setOutOfStock(), filter stock

---

### 9. CHECKLIST DỌN PHÒNG CHO WAITER ✅

**Chức năng:**
- Sau khi checkout, phòng chuyển "Đang dọn"
- Waiter nhận phòng → Mở checklist dọn phòng
- Checklist items: Mic, Loa, Màn hình, Vệ sinh, Bàn ghế, Remote, ...
- Tick từng mục → "Hoàn tất" → Phòng về "Trống"

**Quy trình:**
1. Cashier thanh toán → Phòng = "Đang dọn"
2. Waiter: Rooms → Click phòng "Đang dọn"
3. View checklist → Tick từng item
4. "Hoàn tất" (requires all checked) → Phòng = "Trống"

**Tính năng:**
- Tracking time: Bao lâu để dọn xong
- Assign staff: Ai đang dọn phòng nào
- History: Log audit hoàn tất dọn phòng

**Sử dụng:**
- Waiter App: Tab "Rooms" → Click phòng "Đang dọn"
- Complete checklist để mở phòng

**Files:**
- `/app/controllers/waiter.controller.js` - selectRoomForCleaning, completeCleaning
- `/app/services/staff.service.js` - startCleaning, updateChecklist
- `/app/views/waiter.html` - Cleaning checklist UI

---

### 10. QR CODE CHO PHÒNG - KHÁCH ORDER QUA MOBILE ✅

**Chức năng:**
- Tạo QR code cho từng phòng
- Khách quét QR → Mở Customer App (web) với room ID
- In QR code riêng lẻ hoặc tất cả phòng
- QR chứa deep link: `#/customer?room=1`

**Tính năng:**
- Generate QR sử dụng Google Charts API
- Print-friendly: Mở popup với QR + tên phòng
- Print all: In tất cả QR codes cùng lúc (grid layout)

**Sử dụng:**
- Click "In" trên từng phòng hoặc "In tất cả"
- Dán QR tại mỗi phòng/bàn

**Files:**
- `/app/services/qrcode.service.js` - Generate & Print QR

---

## TỔNG KẾT

### Files mới tạo:
1. `/app/services/inventory.service.js` - Quản lý kho hoàn chỉnh
2. `/app/services/qrcode.service.js` - Generate QR codes

### Files đã cập nhật:
1. `/app/controllers/cashier.controller.js` - Thêm 8 chức năng mới
2. `/app/views/cashier.html` - Thêm 5 modals mới
3. `/app/services/menu.service.js` - BOM combo support
4. `/index.html` - Load 2 services mới

### Tính năng đã có sẵn (không cần làm thêm):
- Kitchen báo hết món: ✅ Đã có trong kitchen.controller.js
- Waiter checklist: ✅ Đã có trong waiter.controller.js
- Audit logging: ✅ Đã có trong audit.service.js

---

## HƯỚNG DẪN SỬ DỤNG

### Cho Thu ngân (Cashier):
1. **Thêm món với ghi chú**: Click món → Nhập note → Thêm
2. **Trả món**: Click icon undo → Chọn lý do → Xác nhận
3. **Sửa giờ**: Click "Sửa giờ" → Chọn thời gian → Nhập lý do
4. **Đổi phòng**: Click "Đổi phòng" → Chọn phòng trống
5. **Gộp bill**: Click "Gộp bill" → Chọn phòng nguồn
6. **Tách bill**: Click "Tách bill" → Chọn món + phòng đích

### Cho Phục vụ (Waiter):
1. **Dọn phòng**: Rooms → Click phòng "Đang dọn" → Checklist → Hoàn tất

### Cho Bếp (Kitchen):
1. **Báo hết món**: Chọn order → Click "Báo hết món"

---

## KIỂM TRA TÍNH NĂNG

### Test Checklist:
- [ ] Thêm món có ghi chú
- [ ] Bán combo (kiểm tra trừ kho BOM)
- [ ] Nhập kho với HSD
- [ ] Sửa giờ vào (phải có lý do)
- [ ] Gộp 2 phòng thành 1
- [ ] Tách 3 món sang phòng mới
- [ ] Đổi phòng (giữ giờ cũ)
- [ ] Trả món với lý do
- [ ] Bếp báo hết món → Ẩn menu
- [ ] Waiter dọn phòng với checklist
- [ ] In QR code cho phòng
- [ ] Quét QR → Customer app mở đúng phòng

---

**Tất cả 10 tính năng đã được implement đầy đủ theo spec.md!** 🎉
