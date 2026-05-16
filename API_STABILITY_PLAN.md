# Kế hoạch Ổn định API & Backend

> Ngày review: 09/05/2026  
> Scope: AngularJS frontend (kara2) + LoopBack backend  
> Mục tiêu: Xác định các điểm lỗi ngầm, đề xuất API mới / refactor để hệ thống ổn định hơn khi mạng chậm hoặc đa thiết bị đồng thời

---

## 1. Tổng quan vấn đề

Hệ thống hiện tại dùng mô hình **optimistic local-first + sync queue**:
- Frontend cập nhật localStorage ngay lập tức
- Đẩy các thao tác vào `SyncService` để gửi lên server tuần tự
- Polling 15-30s + WebSocket để đồng bộ ngược lại

Vấn đề: **nhiều nghiệp vụ quan trọng được thực hiện bằng 2–4 lần gọi API riêng biệt**. Nếu mạng gián đoạn ở giữa luồng → dữ liệu trên server bị **partial/inconsistent**, rất khó phục hồi tự động.

---

## 2. Các điểm lỗi cụ thể đã phát hiện

### 2.1 Check-in phòng — 3 bước không atomic

**Code:** `room.service.js → checkIn()`

```
[B1] Tạo temp SaleOrder local   (localStorage)
[B2] Queue: POST /saleorders     → tạo SaleOrder thật
[B3] Queue: PATCH /rooms/{id}    → gán saleOrderId thật + status='occupied'
```

**Kịch bản lỗi:**
- B2 thành công, B3 thất bại (timeout) → Room trên server vẫn `available`, nhưng local là `occupied`
- Phòng hiển thị 2 trạng thái khác nhau trên cashier và waiter
- SaleOrder tồn tại nhưng không gắn với Room nào → dữ liệu orphan

**Nguy cơ thêm:**
- Waiter khác thấy phòng `available` trên server và check-in → 2 SaleOrder cho 1 phòng
- Không có server-side lock để ngăn race condition

---

### 2.2 Thanh toán — không gọi atomic checkout endpoint

**Code:** `payment.service.js → processPayment()`

```
[B1] Cập nhật bill local
[B2] Deduct BOM inventory (local)
[B3] Queue: POST /invoices         → tạo Invoice
[B4] Queue: PATCH /saleorders/{id} → status='completed'
[B5] Queue: PATCH /rooms/{id}      → status='cleaning'
```

> **Nghịch lý:** Backend ĐÃ CÓ endpoint `POST /api/Rooms/{id}/checkout` hoàn toàn atomic (tạo Invoice + update SaleOrder + update Room + emit Socket trong 1 transaction). Nhưng frontend **không gọi endpoint này**, thay vào đó tự chia 3 queue item riêng.

**Kịch bản lỗi:**
- B3 fail → Invoice không tạo được, nhưng local bill đã `paid`, room đã `cleaning`
- Thu ngân thấy đã xong, thực ra server không ghi nhận giao dịch
- Double-tap thanh toán → 2 Invoice cho 1 SaleOrder (mặc dù backend có idempotency check, frontend queue không có)

---

### 2.3 Đổi phòng — 3 queue item, không có rollback

**Code:** `room.service.js → changeRoom()`

```
[B1] Update local: fromRoom → cleaning, toRoom → occupied
[B2] Queue: PATCH /saleorders/{id}  → roomId = toRoomId
[B3] Queue: PATCH /rooms/{fromId}   → status='cleaning'
[B4] Queue: PATCH /rooms/{toId}     → status='occupied'
```

**Kịch bản lỗi:**
- B2 thành công, B3+B4 thất bại → SaleOrder đã đổi room trên server, nhưng Room status sai
- Khách hàng trên khác nhìn thấy 2 màn hình khác nhau hoàn toàn

---

### 2.4 Temp ID propagation

**Code:** `room.service.js → checkIn()` tạo `tempSaleOrderId = 'temp-so-{roomId}-{timestamp}'`

Sau khi B2 (POST /saleorders) thành công, `onSuccess` callback cập nhật:
- `localStorage.saleorders[].id` → real ID
- `room.saleOrderId` → real ID

**Nhưng không cập nhật:**
- `localStorage.saleorderitems[]` đã được tạo với `saleOrderId = tempId` trong khoảng thời gian chờ
- Waiter thêm món ngay sau check-in → các SaleOrderItem dùng tempId → khi sync lên server sẽ fail vì foreignKey không tồn tại

---

### 2.5 SyncService — queue xử lý tuần tự, không có circuit breaker

**Code:** `sync.service.js → processSyncQueue()`

- Chỉ xử lý **1 item mỗi lần**, đợi thành công mới xử lý tiếp
- `maxRetries: 3` → sau 3 lần fail, item bị bỏ hoàn toàn, **không có thông báo cho user**
- Nếu SaleOrder create đang trong trạng thái `syncing` và item mới arrive → `dedup` bỏ qua (vì status ≠ `pending`) → tạo duplicate update

---

### 2.6 Time-based pricing — frontend tự tính, không authoritative

**Code:** `timebased.service.js → calculateTimeBasedQuantity()`

- Mỗi client (waiter/cashier) tự tính quantity từ `startTime` trong localStorage
- Timer chạy mỗi 1 giây (waiter cart) và 5 giây (sent items)
- `startTime` được lấy từ localStorage — nếu device khác sửa SaleOrder, startTime không đồng bộ ngay

**Kịch bản lỗi:**
- Waiter mở màn hình lúc 20:00, tạm thoát app lúc 20:30, mở lại lúc 21:00
- `startTime` vẫn là thời điểm check-in, nhưng `endTime` bây giờ là lúc mở lại → quantity tính từ 20:00 đến 21:00 = đúng
- **Nhưng**: nếu SaleOrder đã được `timeFrozen` bởi cashier ở thiết bị khác lúc 20:45, waiter vẫn thấy timer chạy

---

### 2.7 Room polling overwrite in-flight changes

**Code:** `cashier.controller.js → syncRoomStatusFromServer()` — chạy mỗi 15s

```js
Object.assign(serviceRoom, serverRoom);
```

Nếu cashier đang thực hiện check-in (local đã `occupied`, chưa sync lên server), poll 15s trả về `available` từ server → **overwrite trạng thái local** → UI nhảy về `trống`, gây confuse.

---

### 2.8 Cart refresh vs SaleOrderItem chưa sync

**Code:** `cashier.controller.js → silentRefreshCart()` — chạy mỗi 20s

```js
ApiService.getAll('saleorderitems', { where: { saleOrderId: ... } })
```

Nếu waiter vừa thêm món (item đang pending trong syncQueue), cart refresh sẽ lấy dữ liệu server cũ → item vừa thêm biến mất khỏi giao diện cho đến khi sync thành công.

---

### 2.9 Split Bill — không có server-side endpoint

**Code:** `payment.service.js → splitBill()`

Toàn bộ logic tạo bill mới + trừ items khỏi bill cũ đều chạy **local**. Không có queue item nào được tạo để sync. Dữ liệu split chỉ tồn tại trong localStorage của máy cashier.

---

### 2.10 Inventory deduction không atomic

**Code:** `payment.service.js → deductBOMInventory()`

BOM inventory bị trừ local trước khi Invoice sync thành công. Nếu Invoice sync fail và cashier retry → BOM bị trừ lần 2 trong localStorage.

---

## 3. API Backend cần bổ sung

### 3.1 `POST /api/Rooms/{id}/checkin` ⭐ QUAN TRỌNG NHẤT

**Thay thế:** 3 queue item (create saleorder + 2 patch rooms)

```json
Request:
{
  "startTime": "2026-05-09T14:30:00Z",
  "customerName": "Anh Phong",
  "customerId": null,
  "note": ""
}

Response:
{
  "room": { "id": "...", "status": "occupied", "saleOrderId": "..." },
  "saleOrder": { "id": "...", "status": "pending", ... }
}
```

**Backend logic (trong 1 transaction):**
1. Lock room bằng `findOne({ where: { id, status: 'available' }, transaction })`
2. Create SaleOrder
3. Update Room: `status='occupied'`, `saleOrderId=newOrder.id`
4. Emit socket: `{model: 'Room', event: 'checkin', data: room}`
5. Return cả room + saleOrder

**Frontend chỉ gọi 1 API, không cần sync queue cho check-in.**

---

### 3.2 `POST /api/Rooms/{id}/change-room` ⭐

```json
Request:
{
  "targetRoomId": "roomId-789",
  "reason": "Khách muốn phòng lớn hơn"
}

Response:
{
  "fromRoom": { "id": "...", "status": "cleaning" },
  "toRoom":   { "id": "...", "status": "occupied", "saleOrderId": "..." },
  "saleOrder": { "id": "...", "roomId": "toRoomId" }
}
```

**Backend logic:**
1. Validate fromRoom status = occupied
2. Validate toRoom status = available (với lock)
3. Update SaleOrder.roomId
4. Update fromRoom → cleaning
5. Update toRoom → occupied với saleOrderId
6. Emit socket cho cả 2 phòng

---

### 3.3 `POST /api/SaleOrders/{id}/freeze-time` ⭐

Khi cashier in bill → server tính quantity cuối cùng cho time-based items và lock lại.

```json
Request:
{
  "frozenAt": "2026-05-09T20:45:00Z",
  "items": [{ "saleOrderItemId": "...", "quantity": 2.083 }]
}

Response:
{
  "timeFrozen": true,
  "timeFrozenAt": "...",
  "items": [...] // items đã update quantity
}
```

Sau endpoint này:
- Frontend dừng timer cho phòng này
- Mọi client nhận socket event `{model: 'SaleOrder', event: 'timeFrozen'}`

---

### 3.4 `POST /api/SaleOrders/{id}/merge`

```json
Request:
{
  "sourceOrderId": "saleorder-abc",
  "reason": "Khách cùng bàn"
}

Response:
{
  "mergedOrder": { ...combined items... },
  "voidedOrder": { "id": "saleorder-abc", "status": "merged" }
}
```

---

### 3.5 `POST /api/SaleOrders/{id}/split`

```json
Request:
{
  "items": [{ "saleOrderItemId": "...", "quantity": 1 }],
  "reason": "Tách bill cho khách A"
}

Response:
{
  "originalOrder": { ...remaining items... },
  "newOrder": { "id": "...", "items": [...split items...] }
}
```

---

### 3.6 `POST /api/SaleOrders/{id}/apply-discount`

Thay vì chỉ PATCH saleOrder với discount field:

```json
Request:
{
  "discountAmount": 100000,
  "discountType": "amount",  // hoặc "percent"
  "reason": "Khách VIP",
  "appliedBy": "userId"
}

Response:
{
  "saleOrder": { "discount": 100000, "total": 950000, ... },
  "auditLog": { "id": "...", "action": "discount_applied" }
}
```

Kết hợp audit log vào 1 request thay vì 2 queue item riêng.

---

### 3.7 `GET /api/Rooms/with-active-orders` ⭐

Thay thế polling `/api/Rooms` + N queries SaleOrder riêng lẻ.

```json
Response: [
  {
    "id": "room-1",
    "name": "P.201",
    "status": "occupied",
    "activeOrder": {
      "id": "so-123",
      "startTime": "2026-05-09T18:30:00Z",
      "customerName": "Anh Phong",
      "estimatedTotal": 850000,
      "itemCount": 5,
      "timeFrozen": false
    }
  },
  ...
]
```

Frontend poll endpoint này mỗi 15s thay vì `/api/Rooms` (tiết kiệm N SaleOrder queries).

---

### 3.8 `GET /api/Dashboard/today` ⭐ cho Manager Screen

```json
Response:
{
  "revenue": {
    "today": 18450000,
    "yesterday": 16200000,
    "change_pct": 13.9
  },
  "rooms": {
    "total": 9, "occupied": 5, "empty": 3, "cleaning": 1, "maintenance": 0
  },
  "invoices": {
    "paid": 24, "open": 2, "total_paid_amount": 18450000
  },
  "payment_methods": {
    "cash": 6200000, "transfer": 8700000, "card": 3550000
  },
  "top_items": [
    { "name": "...", "qty": 32, "revenue": 4640000 }
  ],
  "hourly": [
    { "hour": 18, "revenue": 2100000 },
    { "hour": 19, "revenue": 4300000 }
  ]
}
```

Gọi 1 lần thay vì 5-6 query từ ManagerScreen.

---

### 3.9 `GET /api/Dashboard/realtime`

Dành cho live badge — gọi mỗi 30s:

```json
Response:
{
  "open_rooms": 5,
  "pending_orders": 3,       // SaleOrderItem status=pending
  "open_invoices_amount": 6300000,
  "staff_online": 6,
  "timestamp": "2026-05-09T21:14:30Z"
}
```

---

### 3.10 `POST /api/SaleOrderItems/batch`

Waiter thêm nhiều món cùng lúc → 1 API call thay vì N call:

```json
Request:
{
  "saleOrderId": "...",
  "items": [
    { "productId": "...", "quantity": 2, "note": "Ít đá" },
    { "productId": "...", "quantity": 1 }
  ]
}

Response:
{
  "created": [...saleOrderItems],
  "saleOrder": { "total": ... }
}
```

---

## 4. Refactor Frontend cần làm

### 4.1 Check-in — gọi trực tiếp không qua queue

```js
// HIỆN TẠI (3 queue items, dễ lỗi):
SyncService.addToQueue('create', 'saleorders', ...)
// → onSuccess → SyncService.addToQueue('update', 'rooms', ...)

// MỚI (1 HTTP call, atomic):
ApiService.post('rooms/' + roomId + '/checkin', payload)
  .then(function(result) {
    room.status = result.room.status;
    room.saleOrderId = result.room.saleOrderId;
    // Không cần queue gì thêm — server đã handle
  });
```

### 4.2 Thanh toán — gọi atomic checkout endpoint đã có sẵn

```js
// HIỆN TẠI:
SyncService.addToQueue('create', 'invoices', invoiceData)
SyncService.addToQueue('update', 'saleorders', { status: 'completed' })
SyncService.addToQueue('update', 'rooms', { status: 'cleaning' })

// MỚI (backend /rooms/{id}/checkout đã có):
ApiService.post('rooms/' + roomId + '/checkout', {
  totalAmount: bill.total,
  paymentMethod: bill.paymentMethod,
  discount: bill.discount,
  items: bill.items,
  cashierName: currentUser.name
}).then(function(result) {
  // result.invoice, result.room đã được cập nhật
  // Socket event tự broadcast đến tất cả clients
});
```

### 4.3 Polling — giảm N requests xuống 1

```js
// HIỆN TẠI: poll /api/Rooms mỗi 15s (trả về rooms không có saleOrder info)
// → Phải fetch saleOrder riêng khi cần

// MỚI: poll /api/Rooms/with-active-orders mỗi 15s
// → Đủ thông tin để render màn hình rooms + bill summary
```

### 4.4 Time-based — server is authoritative at freeze point

```js
// Khi cashier bấm "In bill":
ApiService.post('saleorders/' + soId + '/freeze-time', {
  frozenAt: new Date(),
  items: cart.filter(i => i.isTimeBased).map(i => ({
    saleOrderItemId: i._saleOrderItemId,
    quantity: TimeBasedService.calculateTimeBasedQuantity(i, room.startTime).quantity
  }))
}).then(function(result) {
  // Server xác nhận và lock — tất cả client dừng timer
  $scope.orderLocked = true;
  stopTimeBasedTimer();
});
```

### 4.5 SyncService — thêm dead letter + user notification

```js
// Sau maxRetries, thay vì bỏ luôn:
if (item.retryCount >= item.maxRetries) {
  item.status = 'dead';
  _deadLetterQueue.push(item);
  // Hiển thị toast: "⚠ Có 1 thao tác chưa đồng bộ. Vui lòng kiểm tra kết nối."
  $rootScope.$broadcast('sync:dead-letter', { item: item });
}
```

### 4.6 Polling không overwrite trạng thái optimistic

```js
// HIỆN TẠI:
Object.assign(serviceRoom, serverRoom); // overwrite toàn bộ

// MỚI: chỉ update nếu không có pending sync item cho room này
serverRooms.forEach(function(serverRoom) {
  var hasPending = SyncService.hasPendingFor('rooms', serverRoom.id);
  if (!hasPending) {
    Object.assign(serviceRoom, serverRoom);
  }
});
```

---

## 5. Ma trận Ưu tiên

| # | Vấn đề | Rủi ro | Độ khó | Ưu tiên |
|---|--------|--------|--------|---------|
| 1 | Thanh toán không dùng atomic /checkout | 🔴 Cao — mất dữ liệu hóa đơn | Thấp (API đã có) | **P0** |
| 2 | Check-in không atomic, temp ID vấn đề | 🔴 Cao — orphan SaleOrder | Trung bình | **P0** |
| 3 | Polling overwrite trạng thái optimistic | 🟠 Trung — confuse UI | Thấp | **P1** |
| 4 | SyncService không notify dead letter | 🟠 Trung — mất data thầm lặng | Thấp | **P1** |
| 5 | Đổi phòng không atomic | 🟠 Trung | Trung bình | **P1** |
| 6 | Time-based không authoritative | 🟡 Thấp — chỉ lệch vài phút | Cao | **P2** |
| 7 | Split/Merge không sync server | 🟡 Thấp — chỉ 1 máy | Cao | **P2** |
| 8 | BOM deduct double khi retry | 🟡 Thấp | Trung bình | **P2** |
| 9 | Cart refresh xóa item chưa sync | 🟡 Thấp — tự phục hồi | Thấp | **P3** |
| 10 | /api/Dashboard/today thiếu | — performance | Thấp | **P3** |

---

## 6. Thứ tự triển khai đề xuất

### Sprint 1 — Fix lỗi nghiêm trọng (P0)
1. **Backend:** `POST /api/Rooms/{id}/checkin` endpoint
2. **Frontend:** `checkIn()` gọi API trực tiếp, bỏ 3-queue-item pattern
3. **Frontend:** `processPayment()` gọi `/rooms/{id}/checkout` thay vì 3 queue item

### Sprint 2 — Ổn định hóa (P1)
4. **Backend:** `POST /api/Rooms/{id}/change-room`
5. **Frontend:** `changeRoom()` → 1 API call
6. **Frontend:** SyncService dead letter + toast notification
7. **Frontend:** Polling không overwrite khi có pending queue item

### Sprint 3 — Tính năng mới (P2)
8. **Backend:** `POST /api/SaleOrders/{id}/freeze-time`
9. **Backend:** `POST /api/SaleOrders/{id}/split` + `merge`
10. **Backend:** `GET /api/Rooms/with-active-orders`

### Sprint 4 — Dashboard & Performance (P3)
11. **Backend:** `GET /api/Dashboard/today`
12. **Backend:** `GET /api/Dashboard/realtime`
13. **Backend:** `POST /api/SaleOrderItems/batch`
14. **Frontend:** ManagerScreen connect API thật

---

## 7. Idempotency checklist cho các endpoint mới

| Endpoint | Idempotency key | Cách check |
|----------|----------------|------------|
| POST /rooms/{id}/checkin | roomId + date | findOne({ roomId, status: 'occupied' }) — nếu đã occupied với SO thì return SO cũ |
| POST /rooms/{id}/checkout | saleOrderId | findOne(Invoice, { saleOrderId }) — trả về invoice cũ nếu đã tồn tại (đã có sẵn) |
| POST /rooms/{id}/change-room | saleOrderId + targetRoomId | findOne(Room, { id: targetRoomId }) check status |
| POST /saleorders/{id}/freeze-time | saleOrderId | if timeFrozen == true return current state |
| POST /saleorderitems/batch | saleOrderId + productId | upsert theo (saleOrderId, productId) thay vì insert mới |

---

## 8. Ghi chú về React Native app

Khi gắn API vào React Native app (ManagerScreen, CashierScreen, WaiterScreen):

- Gọi `/api/Rooms/with-active-orders` để load màn hình rooms (thay mock ROOMS[])
- Thanh toán → gọi `POST /api/Rooms/{id}/checkout` trực tiếp (không qua SyncService)
- Check-in → gọi `POST /api/Rooms/{id}/checkin` trực tiếp
- ManagerScreen → gọi `/api/Dashboard/today` + `/api/Dashboard/realtime`
- WebSocket: subscribe vào `socket.service.js` events để update real-time thay vì polling

Tất cả API call trong RN app nên có:
```ts
// Timeout 10s cho các thao tác thường
// Timeout 30s cho các thao tác checkout/payment
// Retry 1 lần nếu timeout (không retry nếu 4xx)
// Hiển thị toast lỗi rõ ràng thay vì silent fail
```
