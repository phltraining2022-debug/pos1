# 🏗️ Kiến trúc Hệ thống

## 📐 Sơ đồ Tổng quan

```
┌─────────────────────────────────────────────────────────────┐
│                    KARAOKE POS SYSTEM                       │
│                         (PWA)                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │      AngularJS 1.8.2 + Tailwind     │
        │         Service Worker (PWA)         │
        └─────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌──────────────┐                           ┌──────────────┐
│   Frontend   │                           │   Storage    │
│  Components  │◄─────────────────────────►│ LocalStorage │
└──────────────┘                           └──────────────┘
        │
        ├── Controllers
        ├── Services
        └── Views
```

## 🎭 Phân Hệ Người Dùng

```
┌─────────────────────────────────────────────────────────┐
│                   USER ROLES                            │
└─────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CASHIER    │     │    WAITER    │     │   KITCHEN    │
│   (iPad)     │     │   (Mobile)   │     │  (Tablet)    │
│              │     │              │     │              │
│ • Check-in   │     │ • Take order │     │ • View queue │
│ • Order      │     │ • Cleaning   │     │ • Cook food  │
│ • Payment    │     │ • Checklist  │     │ • Out stock  │
│ • Room mgmt  │     │              │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                     ┌──────▼────────┐
                     │   CUSTOMER    │
                     │   (Mobile)    │
                     │               │
                     │ • QR Order    │
                     │ • View menu   │
                     │ • Call staff  │
                     │ • Request pay │
                     └───────────────┘
```

## 🔄 Luồng Dữ liệu

```
┌─────────────────────────────────────────────────────────┐
│                   DATA FLOW                             │
└─────────────────────────────────────────────────────────┘

    USER ACTION
         │
         ▼
    CONTROLLER
         │
         ▼
     SERVICE
         │
    ├────┼────┐
    ▼    ▼    ▼
  Room Order Payment
  Service Service Service
    │    │    │
    └────┼────┘
         ▼
   STORAGE SERVICE
         │
         ▼
   LOCAL STORAGE
         │
         ▼
   SYNC SERVICE
         │
         ▼
   [Backend API]  ← Future integration
```

## 📱 Màn hình theo Thiết bị

### iPad Landscape (Cashier) - 1024x768
```
┌─────────────────────────────────────────────────────┐
│  Header: Logo | Time | User | Logout                │
├───────────────┬──────────────┬──────────────────────┤
│               │              │                      │
│  ROOM MAP     │     BILL     │       MENU          │
│  (40%)        │     (30%)    │       (30%)         │
│               │              │                      │
│ ┌───┬───┬───┐ │ Room Info    │ Categories          │
│ │ 1 │ 2 │ 3 │ │              │ ┌────────┐          │
│ ├───┼───┼───┤ │ Cart Items   │ │  Bia   │          │
│ │ 4 │ 5 │ 6 │ │              │ └────────┘          │
│ ├───┼───┼───┤ │ Totals       │                     │
│ │ 7 │ 8 │ 9 │ │              │ Menu Items Grid     │
│ └───┴───┴───┘ │ Actions      │                     │
│               │              │                      │
└───────────────┴──────────────┴──────────────────────┘
```

### Mobile Portrait (Customer/Waiter) - 375x812
```
┌─────────────────────┐
│    Header           │
│  Room | Cart        │
├─────────────────────┤
│                     │
│   Search Bar        │
├─────────────────────┤
│ Categories →        │
├─────────────────────┤
│                     │
│                     │
│   Menu Items        │
│   (Scrollable)      │
│                     │
│   ┌─────────────┐   │
│   │  Item Card  │   │
│   └─────────────┘   │
│                     │
│   ┌─────────────┐   │
│   │  Item Card  │   │
│   └─────────────┘   │
│                     │
├─────────────────────┤
│  Quick Actions      │
└─────────────────────┘
```

### Tablet Landscape (Kitchen) - 768x1024
```
┌──────────────────────────────────────────────────┐
│  Header: Kitchen Display | Filters | Logout     │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Order 1  │  │ Order 2  │  │ Order 3  │      │
│  │ Room: 5  │  │ Room: 2  │  │ Room: 8  │      │
│  │ 15 mins  │  │ 8 mins   │  │ 25 mins! │      │
│  │          │  │          │  │          │      │
│  │ Items    │  │ Items    │  │ Items    │      │
│  │ [Start]  │  │[Ready]   │  │[Start]   │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                  │
│  ┌──────────┐  ┌──────────┐                    │
│  │ Order 4  │  │ Order 5  │                    │
│  └──────────┘  └──────────┘                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 🗄️ Cấu trúc Dữ liệu

### Room Object
```javascript
{
  id: 1,
  name: "VIP 01",
  type: "large", // small, medium, large
  status: "occupied", // empty, occupied, cleaning, maintenance
  capacity: 15,
  startTime: "2025-12-17T10:30:00",
  customerInfo: {
    name: "Nguyễn Văn A",
    phone: "0901234567",
    guests: 10
  },
  billId: "BILL-1734421800000"
}
```

### Order Object
```javascript
{
  id: "ORD-1734421800000",
  billId: "BILL-1734421800000",
  roomId: 1,
  items: [
    {
      itemId: 1,
      name: "Heineken",
      quantity: 10,
      price: 30000,
      unit: "lon",
      note: "Thêm đá"
    }
  ],
  totalAmount: 300000,
  status: "pending", // pending, preparing, ready, served, cancelled
  orderedBy: "waiter1",
  orderedAt: "2025-12-17T10:35:00"
}
```

### Bill Object
```javascript
{
  id: "BILL-1734421800000",
  roomId: 1,
  roomType: "large",
  startTime: "2025-12-17T10:30:00",
  endTime: "2025-12-17T14:30:00",
  roomCharge: 880000,
  foodTotal: 500000,
  subtotal: 1380000,
  discount: 0,
  tax: 0,
  total: 1380000,
  status: "paid", // unpaid, paid, merged
  paymentMethod: "cash", // cash, transfer, qr
  paidBy: "cashier1",
  paidAt: "2025-12-17T14:30:00"
}
```

## 🔐 Audit Log Structure
```javascript
{
  id: "LOG-1734421800000",
  action: "payment_completed",
  user: "cashier1",
  description: "Payment completed for bill BILL-1734421800000",
  data: { /* relevant data */ },
  timestamp: "2025-12-17T14:30:00"
}
```

## 🎯 Key Features Map

```
CASHIER (iPad)
├── Room Management
│   ├── Check-in with custom start time
│   ├── Real-time timer & charges
│   ├── Change room (transfer bill)
│   └── Edit start time (with reason)
├── Ordering
│   ├── Quick menu selection
│   ├── Add to cart with animation
│   └── Send to kitchen
└── Payment
    ├── Multiple payment methods
    ├── Apply discount
    ├── Split/Merge bills
    └── Print receipt

CUSTOMER (Mobile Web)
├── QR Code Access
├── Browse Menu
├── Shopping Cart
├── Send Orders
└── Service Requests
    ├── Call Staff
    └── Request Payment

WAITER (Mobile)
├── Take Orders
│   ├── Select room
│   ├── Add items
│   └── Add notes
└── Cleaning Checklist
    ├── 10-point checklist
    ├── Track completion time
    └── Update room status

KITCHEN (Tablet)
├── Order Queue (FIFO)
├── Status Management
│   ├── Pending → Preparing
│   └── Preparing → Ready
├── Urgency Alerts (>15 mins)
└── Out of Stock Report

---



## 🚀 Deployment Options

### Option 1: Static Hosting
- Netlify
- Vercel
- GitHub Pages

### Option 2: Self-hosted
- Nginx
- Apache
- Node.js server

### Option 3: Cloud
- AWS S3 + CloudFront
- Google Cloud Storage
- Azure Static Web Apps

## 📈 Future Enhancements

1. **Backend Integration**
   - REST API
   - Real-time WebSocket
   - Database sync

2. **Advanced Features**
   - Member loyalty system
   - SMS notifications
   - QR payment integration
   - Inventory forecasting

3. **Analytics**
   - Real-time dashboard
   - Heat maps
   - Customer insights

4. **Hardware Integration**
   - Thermal printer
   - Barcode scanner
   - Cash drawer
