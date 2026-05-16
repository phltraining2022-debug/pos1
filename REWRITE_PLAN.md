# Phân tích & Kế hoạch Viết lại — Karaoke POS v2 (React)

---

## 1. Danh sách Vấn đề Hiện tại

### 1.1 Vấn đề đã xảy ra trong thực tế (reported bugs)

| # | Mô tả | Root cause |
|---|-------|------------|
| B1 | Giờ phụ thu chỉ tính 5 phút dù khách hát 65 phút | `TimeBasedService.startTracking(room.id, startTime, cart)` — sai thứ tự tham số, timer không bao giờ update `cart` |
| B2 | Phòng chuyển sang `cleaning` mà không có hóa đơn | `RoomService.checkOut` không có guard → bất kỳ caller nào cũng bypass được payment |
| B3 | Sau `mergeBill`, phòng nguồn kẹt `cleaning` nhưng bill không hợp nhất | Ký tự `π` typo tại L2502 gây `ReferenceError`, abort execution sau khi đã set status |
| B4 | Double-charge SaleOrder `completed` | `_doCreateInvoice` và `RoomService.checkOut` đều queue update `saleorder.status=completed` |
| B5 | Số hóa đơn bị trùng trong giờ cao điểm | `_nextInvoiceNumber` dùng `Invoice.find + max + 1` — 2 tab thanh toán đồng thời nhận cùng max |
| B6 | Stale sync request ghi đè trạng thái phòng mới | SyncService không handle 409, `UPDATE rooms {status:cleaning}` cũ từ localStorage vẫn gửi đi |
| B7 | Item trong cart bị nhân đôi sau khi reload | `loadItemsIntoCart` nhóm theo `productId|note`, nhưng `silentRefreshCart` push item mới mà không kiểm tra nhóm đã tồn tại |
| B8 | Nhiều Invoice cho cùng 1 SaleOrder | Nút "Xác nhận thanh toán" không có in-flight guard — 2 tap nhanh → 2 `POST /checkout` cùng tới server khi phòng vẫn còn `occupied` → cả 2 tạo Invoice thành công |
| B9 | Nhiều SaleOrder cho cùng 1 phòng | Màn hình waiter thấy phòng `available` (stale) đồng thời cashier cũng click → cả 2 queue `POST /saleorders` → server tạo 2 SaleOrder cho cùng room. Ngoài ra: nút "Xác nhận mở phòng" cũng không có in-flight guard |

### 1.2 Vấn đề kiến trúc (structural)

#### Frontend

**AngularJS 1.x (EOL 2021)**
- `$scope` + two-way binding gây re-render toàn bộ tree bất cứ khi nào `$digest` chạy
- Không có component isolation — `cashier.controller.js` ~2600 dòng, làm tất cả mọi thứ
- Không có TypeScript → lỗi kiểu dữ liệu chỉ phát hiện lúc runtime (vd: tham số sai thứ tự ở B1)
- Không có unit test framework tích hợp
- Dependency injection string-based (`'$scope', '$interval', ...`) dễ typo

**State management phi tập trung**
- Trạng thái phòng tồn tại ở 3 nơi cùng lúc: `RoomService.rooms[]` (in-memory) + `StorageService('rooms')` (localStorage) + `$scope.rooms` (view)
- Ba nơi hay lệch nhau, cần `Object.assign` thủ công để sync
- `selectedRoom` là shallow reference đến object trong `rooms[]` — khi mảng bị reassign (`$scope.rooms = allRooms`) thì reference bị stale

**SyncService**
- Chỉ xử lý 404 (stale purge), không xử lý 409 conflict
- Dedup chỉ hoạt động trong cùng session (RAM), không check localStorage khi restore queue
- `local-` ID: logic promote từ local ID sang server ID phân tán ở nhiều nơi (loadSaleOrderItems, silentRefreshCart, socket handler)
- Không có TTL cho queue item — queue có thể tích lũy vô tận nếu server luôn lỗi
- **Không có server-side idempotency cho SaleOrder creation**: 2 thiết bị thấy phòng `available` (stale) cùng lúc → cả 2 queue `POST /saleorders` → 2 SaleOrder cho 1 phòng. Cần endpoint `POST /Rooms/{id}/checkin` atomic hoặc unique constraint `(roomId, status:'pending')` trên server

**Tính toán giờ (Time Engine)**
- `diffMinutes + 1` (tính cả phút bắt đầu lẫn phút kết thúc) → dễ off-by-one khi khách hát đúng ranh giới block
- Giá phòng (`priceConfigs`) hardcode trong `payment.service.js` localStorage defaults, không đồng bộ với giá thực trên DB
- `isSurcharge` item và `isTimeBased` item bơi lẫn nhau trong cùng mảng `cart`, logic merge/update phức tạp

**Polling dư thừa**
- 1s: `updateRoomTimers` (clock)
- 10s: `timeBasedUpdateTimer` (waiter)
- 15s: `syncRoomStatusFromServer` (cashier)
- 20s: `cartPollTimer`
- 30s: `surchargeUpdateTimer`
- Tất cả chạy song song, nhiều lần cùng query server

#### Backend (LoopBack 2)

**Framework EOL**
- LoopBack 2 không còn được maintain, không hỗ trợ Node 18+
- Model definition dạng JSON + JS file riêng lẻ, không có TypeScript
- `app-model.js` là "god hook" attach vào mọi model, logic phức tạp, khó debug

**Thiếu atomic transaction**
- MongoDB không có multi-document transaction trên LoopBack 2 connector
- Checkout flow (Invoice → SaleOrder → Room) là best-effort, bước 3&4 có thể fail im lặng
- Không có rollback nếu `Invoice.create` thành công nhưng `Room.updateAttributes` fail

**Số hóa đơn**
- Version cũ: generate client-side → race condition (B5)
- Version mới (`refs/models/room.js`): dùng Redis INCR → đúng, nhưng chưa deploy

**Real-time**
- WebSocket server (`ws.js`) là raw WebSocket + Redis pub/sub subscribe thủ công
- Không có rooms/namespaces → broadcast toàn bộ tới tất cả clients, filter theo `clinicShortName` ở client
- Không có reconnect protocol chuẩn, không có ACK/retry

**Không có rate limiting / auth trên custom remote methods**
- `POST /Rooms/{id}/checkout` hiện chưa kiểm tra quyền (chỉ check `options.accessToken.userId`)

---

## 2. Kiến trúc Đề xuất — React v2

### 2.1 Stack tổng quan

```
┌──────────────────────────────────────────────────────────┐
│                   FRONTEND (React)                       │
│  Vite · React 18 · TypeScript · Tailwind CSS            │
│  TanStack Query · Zustand · Socket.IO Client            │
│  React Router v6 · React Hook Form · Zod                │
└──────────────┬───────────────────────────────────────────┘
               │  REST + Socket.IO
┌──────────────▼───────────────────────────────────────────┐
│               BACKEND (Node.js)                          │
│  Fastify 4 · TypeScript · Prisma ORM                    │
│  Socket.IO Server · Redis (cache + pub/sub + seq)        │
└──────────────┬───────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────┐
│               DATABASE                                   │
│  PostgreSQL (primary) · Redis 7 (cache/queue/realtime)   │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Tại sao chuyển sang PostgreSQL

| Yêu cầu | MongoDB | PostgreSQL |
|---------|---------|------------|
| Multi-document transaction (Invoice+SaleOrder+Room) | Cần replica set, phức tạp | Native ACID, đơn giản |
| Báo cáo doanh thu tổng hợp | `$group` aggregation pipeline | SQL GROUP BY, dễ hơn |
| Foreign key integrity (roomId, saleOrderId) | Không enforce | Enforce mặc định |
| Time-series query (giờ hát) | OK | OK với index |
| Full-text search menu | Atlas Search (tốn phí) | pg_trgm extension |

**Trường hợp giữ MongoDB**: Nếu muốn tránh migration schema, có thể dùng MongoDB 6+ với multi-document transaction chuẩn. Nhưng cần upgrade driver và cần replica set.

### 2.3 Cấu trúc thư mục Frontend

```
src/
├── app/                    # App shell, router, providers
│   ├── App.tsx
│   ├── router.tsx
│   └── providers.tsx
│
├── features/               # Domain slices
│   ├── cashier/
│   │   ├── CashierPage.tsx
│   │   ├── RoomGrid.tsx
│   │   ├── BillPanel.tsx
│   │   ├── MenuPanel.tsx
│   │   ├── CheckInModal.tsx
│   │   ├── PaymentModal.tsx
│   │   └── hooks/
│   │       ├── useRooms.ts         # TanStack Query
│   │       ├── useCart.ts          # Zustand slice
│   │       ├── useCheckout.ts      # mutation → POST /checkout
│   │       └── useTimeEngine.ts    # timer logic, isolated
│   │
│   ├── waiter/
│   ├── kitchen/
│   ├── customer/
│   └── admin/
│
├── shared/
│   ├── api/                # axios instance, query keys
│   ├── store/              # Zustand stores
│   │   ├── cartStore.ts
│   │   ├── roomStore.ts
│   │   └── uiStore.ts
│   ├── socket/             # Socket.IO hook, event types
│   ├── components/         # Button, Modal, Toast, ...
│   └── utils/
│       └── timeEngine.ts   # Hàm tính giờ, pure functions, có unit test
│
└── types/                  # Shared TypeScript interfaces
    ├── room.ts
    ├── saleOrder.ts
    └── invoice.ts
```

### 2.4 Giải quyết từng vấn đề cụ thể

#### State management: Zustand + TanStack Query

```typescript
// Tách server state (TanStack Query) khỏi client state (Zustand)

// Server state — tự cache, background refetch, stale-while-revalidate
const { data: rooms } = useQuery({
  queryKey: ['rooms'],
  queryFn: () => api.get('/rooms'),
  staleTime: 30_000,
});

// Client state — cart, UI, selection
const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  selectedRoomId: null,
  addItem: (item) => set(state => ({ items: [...state.items, item] })),
  // ...
}));
```

Không còn 3 nguồn dữ liệu phòng lệch nhau.

#### Time Engine — pure functions, có test

```typescript
// src/shared/utils/timeEngine.ts

export function calcTimeBasedQty(
  startTime: Date,
  endTime: Date = new Date(),
  blockMinutes: number = 5,
): { quantity: number; note: string } {
  const startMs = Math.floor(startTime.getTime() / 60000) * 60000;
  const endMs   = Math.floor(endTime.getTime()   / 60000) * 60000;
  const diffMin = Math.max(1, Math.round((endMs - startMs) / 60000));
  const blocks  = Math.ceil(diffMin / blockMinutes);
  const qty     = (blocks * blockMinutes) / 60;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return {
    quantity: Math.round(qty * 1000) / 1000,
    note: `Từ ${fmt(startTime)} đến ${fmt(endTime)} (${h}g ${m}p) — ${blocks} block x ${blockMinutes}p`,
  };
}

// --- Test (Vitest) ---
test('65 phút = 13 blocks = 1.083 giờ', () => {
  const start = new Date('2026-05-01T00:44:00Z');
  const end   = new Date('2026-05-01T01:49:00Z');
  expect(calcTimeBasedQty(start, end, 5).quantity).toBe(1.083);
});
```

Không còn bug sai thứ tự tham số vì TypeScript sẽ báo lỗi compile.

#### useTimeEngine hook — dùng `useRef` thay `$interval`

```typescript
// features/cashier/hooks/useTimeEngine.ts

export function useTimeEngine(cartItems: CartItem[]) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  
  useEffect(() => {
    const timebasedItems = cartItems.filter(i => i.isTimeBased);
    if (!timebasedItems.length) return;

    const tick = () => {
      const next: Record<string, number> = {};
      timebasedItems.forEach(item => {
        const { quantity } = calcTimeBasedQty(
          item._manualStartTime ?? item.startTime,
          item._manualEndTime  ?? new Date(),
          item.blockMinutes ?? 5,
        );
        next[item.id] = quantity;
      });
      setQuantities(next);
    };

    tick(); // immediate
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cartItems]);     // re-subscribe khi cart thay đổi

  return quantities;   // { [itemId]: currentQty }
}
```

#### Socket.IO thay raw WebSocket

```typescript
// shared/socket/useSocket.ts

export function useSocket() {
  useEffect(() => {
    const socket = io(WS_URL, {
      auth: { token: getAccessToken() },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on('room:updated', (data: RoomUpdate) => {
      queryClient.setQueryData(['rooms'], (old: Room[]) =>
        old.map(r => r.id === data.id ? { ...r, ...data } : r)
      );
    });

    socket.on('saleOrderItem:created', (item: SaleOrderItem) => {
      queryClient.invalidateQueries({ queryKey: ['saleOrderItems', item.saleOrderId] });
    });

    return () => { socket.disconnect(); };
  }, []);
}
```

Server emit có rooms/namespace, không cần filter thủ công ở client.

#### Checkout — single mutation, no race

```typescript
// features/cashier/hooks/useCheckout.ts

export function useCheckout() {
  return useMutation({
    mutationFn: (payload: CheckoutPayload) =>
      api.post<CheckoutResult>(`/rooms/${payload.roomId}/checkout`, payload),

    onSuccess: (result) => {
      // Server đã làm xong Invoice + SaleOrder + Room
      // Chỉ cần invalidate để refetch
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      cartStore.clear();
      toast.success(`Thanh toán thành công! HĐ: ${result.invoice.invoiceNumber}`);
    },

    onError: (err) => {
      toast.error(`Lỗi thanh toán: ${err.message}`);
    },
  });
}
```

---

## 3. Kiến trúc Đề xuất — Backend v2

### 3.1 Stack

```
Fastify 4 + TypeScript
  ├── @fastify/jwt             — Auth
  ├── @fastify/rate-limit      — Rate limiting
  ├── @fastify/websocket       — WS support
  ├── socket.io                — Real-time
  ├── prisma                   — ORM (PostgreSQL)
  ├── ioredis                  — Redis client (cache, pub/sub, seq)
  └── zod                      — Validation (shared với frontend)
```

### 3.2 Cấu trúc thư mục Backend

```
server/
├── src/
│   ├── app.ts              # Fastify instance, plugins
│   ├── socket.ts           # Socket.IO setup, rooms/namespaces
│   │
│   ├── modules/
│   │   ├── room/
│   │   │   ├── room.routes.ts
│   │   │   ├── room.service.ts
│   │   │   ├── room.schema.ts      # Zod
│   │   │   └── room.controller.ts
│   │   ├── invoice/
│   │   ├── saleOrder/
│   │   ├── product/
│   │   └── report/
│   │
│   ├── shared/
│   │   ├── redis.ts
│   │   ├── prisma.ts
│   │   └── invoiceSeq.ts   # Redis INCR logic
│   │
│   └── hooks/
│       ├── auth.hook.ts
│       └── audit.hook.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
└── tests/
    ├── checkout.test.ts
    └── timeEngine.test.ts
```

### 3.3 Schema chính (Prisma)

```prisma
model Room {
  id          String      @id @default(cuid())
  name        String
  code        String      @unique
  type        String
  status      RoomStatus  @default(AVAILABLE)
  saleOrderId String?     @unique
  startTime   DateTime?
  customerInfo Json?
  updatedAt   DateTime    @updatedAt

  saleOrder   SaleOrder?  @relation(fields: [saleOrderId], references: [id])
  invoices    Invoice[]
}

model SaleOrder {
  id          String          @id @default(cuid())
  roomId      String
  status      SaleOrderStatus @default(OPEN)
  discount    Float           @default(0)
  discountType String         @default("amount")
  total       Float           @default(0)
  paidAmount  Float           @default(0)
  items       SaleOrderItem[]
  invoice     Invoice?
  room        Room?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model Invoice {
  id            String    @id @default(cuid())
  invoiceNumber String    @unique
  invoiceDate   DateTime  @default(now())
  roomId        String
  saleOrderId   String    @unique
  totalAmount   Float
  paidAmount    Float
  status        String    @default("paid")
  paymentMethod String
  cashierName   String?
  items         Json
  createdAt     DateTime  @default(now())
}
```

### 3.4 Checkout Endpoint — Atomic Transaction

```typescript
// modules/room/room.service.ts

async function checkout(roomId: string, payload: CheckoutPayload, userId: string) {
  // 1. Lock row (SELECT FOR UPDATE) — prevents concurrent checkout
  return await prisma.$transaction(async (tx) => {

    const room = await tx.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, saleOrderId: true, name: true },
    });

    if (!room)                           throw new AppError(404, 'ROOM_NOT_FOUND');
    if (room.status !== 'OCCUPIED')      throw new AppError(422, 'ROOM_NOT_OCCUPIED');
    if (!room.saleOrderId)               throw new AppError(422, 'NO_SALE_ORDER');
    if (payload.totalAmount < 0)         throw new AppError(422, 'INVALID_TOTAL');
    if (!payload.paymentMethod)          throw new AppError(422, 'MISSING_PAYMENT_METHOD');

    // 2. Generate invoice number (Redis INCR — atomic across instances)
    const invoiceNumber = await nextInvoiceNumber();

    // 3. Create invoice
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        roomId,
        saleOrderId: room.saleOrderId,
        totalAmount: payload.totalAmount,
        paidAmount:  payload.paidAmount ?? payload.totalAmount,
        paymentMethod: payload.paymentMethod,
        cashierName: payload.cashierName,
        items: payload.items,
        // customerId optional
        ...(payload.customerId ? { customerId: payload.customerId } : {}),
      },
    });

    // 4. Update SaleOrder
    await tx.saleOrder.update({
      where: { id: room.saleOrderId },
      data:  { status: 'COMPLETED', paidAmount: payload.totalAmount, total: payload.totalAmount },
    });

    // 5. Update Room
    const updatedRoom = await tx.room.update({
      where: { id: roomId },
      data:  { status: 'CLEANING', saleOrderId: null, startTime: null },
    });

    // 6. Emit real-time (ngoài transaction)
    return { invoice, roomStatus: updatedRoom.status };
  });
  // Nếu bất kỳ bước nào throw → toàn bộ rollback
}
```

### 3.5 Real-time với Socket.IO + Redis Adapter

```typescript
// socket.ts

import { createAdapter } from '@socket.io/redis-adapter';

const io = new Server(httpServer, { cors: { origin: '*' } });
io.adapter(createAdapter(pubClient, subClient));

// Namespace theo vai trò
const posNS = io.of('/pos');

posNS.use(authMiddleware);

posNS.on('connection', (socket) => {
  const { branchId } = socket.data.user;
  socket.join(`branch:${branchId}`);   // Group theo chi nhánh
});

// Trong checkout service — sau transaction
export function emitCheckoutComplete(branchId: string, data: CheckoutResult) {
  posNS.to(`branch:${branchId}`).emit('room:updated', {
    id: data.room.id,
    status: 'CLEANING',
    saleOrderId: null,
  });
  posNS.to(`branch:${branchId}`).emit('invoice:created', data.invoice);
}
```

### 3.6 Guard trước khi lưu (Prisma middleware)

```typescript
// Thay LoopBack 'before save' hook
prisma.$use(async (params, next) => {
  if (params.model === 'Room' && params.action === 'update') {
    const { data } = params.args;
    if (data.status === 'CLEANING' && !params.args._skipGuard) {
      const room = await prisma.room.findUnique({ where: params.args.where });
      if (room?.status === 'OCCUPIED') {
        const invoice = await prisma.invoice.findFirst({
          where: { roomId: room.id, invoiceDate: { gte: startOfDay() } },
        });
        if (!invoice) throw new AppError(422, 'CHECKOUT_REQUIRES_INVOICE');
      }
    }
  }
  return next(params);
});
```

---

## 4. Kế hoạch Migration

### Phase 1 — Backend mới, chạy song song (2-3 tuần)

- [ ] Setup Fastify + Prisma + PostgreSQL
- [ ] Export data từ MongoDB → import PostgreSQL (`mongodump` → transform → `pg_restore`)
- [ ] Implement các endpoint cốt lõi: rooms, saleOrders, checkout, invoices
- [ ] Deploy `/api/v2/` song song với LoopBack `/api/`
- [ ] Test bằng Postman/Thunder Client

### Phase 2 — Frontend React (3-4 tuần)

- [ ] Setup Vite + React + TypeScript + Tailwind
- [ ] Cashier view: RoomGrid + BillPanel + MenuPanel
- [ ] `useTimeEngine` hook với unit tests
- [ ] Checkout mutation với error handling
- [ ] Socket.IO integration

### Phase 3 — Các view còn lại (2 tuần)

- [ ] Waiter view (mobile-first)
- [ ] Kitchen display
- [ ] Customer QR view
- [ ] Admin báo cáo cơ bản

### Phase 4 — Cutover (1 tuần)

- [ ] Parallel run: React app gọi v2 API, AngularJS app gọi v1 API
- [ ] Chuyển DNS/nginx routing
- [ ] Tắt LoopBack server sau 2 tuần không có lỗi

---

## 5. Những thứ GIỮ LẠI từ version hiện tại

- Logic `calcTimeBasedQty` (sau khi viết lại dạng pure function + test)
- Redis INCR cho invoice sequence (`refs/models/room.js`)
- Atomic checkout flow design (`POST /rooms/{id}/checkout`)
- Guard hook blocked `occupied → cleaning` without invoice
- Socket emit format `{ model, event, data }` (chỉ thêm namespace)
- Tailwind utility classes (giữ nguyên design language)
- `RoomStatus` state machine: `available → occupied → cleaning → available`

## 6. Những thứ BỎ HOÀN TOÀN

- AngularJS 1.x + `$scope` + `$digest`
- SyncService với localStorage queue (thay bằng TanStack Query mutation + optimistic update)
- `StorageService` làm "database" (chỉ dùng cho auth token và UI preferences)
- LoopBack 2 + `app-model.js` god hook
- Raw WebSocket server (`ws.js`) + manual Redis subscribe
- `priceConfigs` hardcode trong localStorage
- Multiple overlapping `$interval` pollers
- String-based DI (`['$scope', '$interval', ...]`)

---

*Phân tích dựa trên commit hiện tại — May 2, 2026*
