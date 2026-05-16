# 📁 Project File Tree

```
kara2/
│
├── 📄 index.html                      # Main entry point - PWA shell
├── 📄 manifest.json                   # PWA manifest configuration
├── 📄 service-worker.js               # Service worker for offline support
├── 📄 offline.html                    # Offline fallback page
├── 📄 package.json                    # NPM configuration
│
├── 📚 Documentation/
│   ├── 📄 README.md                   # Main project documentation
│   ├── 📄 QUICKSTART.md               # Quick start guide
│   ├── 📄 ARCHITECTURE.md             # System architecture & diagrams
│   ├── 📄 CHANGELOG.md                # Version history & changes
│   └── 📄 PROJECT_SUMMARY.md          # Complete project summary
│
├── 📂 app/                            # Main application folder
│   │
│   ├── 📄 app.js                      # AngularJS main module & config
│   │
│   ├── 📂 config/                     # Configuration files
│   │   └── 📄 routes.js               # Route definitions
│   │
│   ├── 📂 controllers/                # AngularJS controllers (5)
│   │   ├── 📄 login.controller.js     # Login & authentication
│   │   ├── 📄 cashier.controller.js   # POS Dashboard (iPad)
│   │   ├── 📄 customer.controller.js  # QR Ordering (Mobile)
│   │   ├── 📄 waiter.controller.js    # Staff mobile app
│   │   ├── 📄 kitchen.controller.js   # Kitchen display system
│   │
│   ├── 📂 services/                   # AngularJS services (9)
│   │   ├── 📄 auth.service.js         # Authentication & authorization
│   │   ├── 📄 room.service.js         # Room management & status
│   │   ├── 📄 menu.service.js         # Menu & inventory
│   │   ├── 📄 order.service.js        # Order management
│   │   ├── 📄 payment.service.js      # Payment & pricing engine
│   │   ├── 📄 staff.service.js        # Staff & cleaning checklist
│   │   ├── 📄 storage.service.js      # LocalStorage wrapper
│   │   ├── 📄 sync.service.js         # Offline sync management
│   │   └── 📄 audit.service.js        # Audit logging
│   │
│   └── 📂 views/                      # HTML templates (6)
│       ├── 📄 login.html              # Login screen (all roles)
│       ├── 📄 cashier.html            # POS 3-column dashboard
│       ├── 📄 customer.html           # Mobile ordering interface
│       ├── 📄 waiter.html             # Staff mobile interface
│       ├── 📄 kitchen.html            # Kitchen display system
│
├── 📂 assets/                         # Static assets
│   └── 📄 README.md                   # Icon generation guide
│
└── 📂 refs/                           # Reference documents
    └── 📄 spec.md                     # Original specification

```

## 📊 File Statistics

### By Type
```
Controllers:    6 files
Services:       9 files
Views:          6 files
Config:         1 file
Documentation:  5 files
Core:           4 files (index, manifest, sw, offline)
Reference:      1 file
Assets:         1 file (readme)
----------------------------
Total:          33 files
```

### By Category

#### Frontend Code
```
JavaScript:     16 files (~2,500 LOC)
HTML:           7 files (~1,000 LOC)
JSON:           2 files
```

#### Documentation
```
Markdown:       7 files (~1,500 lines)
```

## 🎯 Key Files by Role

### 👨‍💼 Cashier (Thu ngân)
```
- app/controllers/cashier.controller.js
- app/views/cashier.html
- app/services/room.service.js
- app/services/payment.service.js
- app/services/order.service.js
```

### 📱 Customer (Khách hàng)
```
- app/controllers/customer.controller.js
- app/views/customer.html
- app/services/menu.service.js
- app/services/order.service.js
```

### 👔 Waiter (Phục vụ)
```
- app/controllers/waiter.controller.js
- app/views/waiter.html
- app/services/staff.service.js
- app/services/order.service.js
```

### 🍳 Kitchen (Bếp/Bar)
```
- app/controllers/kitchen.controller.js
- app/views/kitchen.html
- app/services/order.service.js
- app/services/menu.service.js
```

## 🔗 File Dependencies

### Core Dependencies
```
index.html
  ├── app.js (main module)
  ├── routes.js (routing config)
  ├── controllers/* (all 5)
  ├── services/* (all 9)
  └── views/* (loaded by routes)
```

### Service Dependencies
```
auth.service.js → storage.service.js
room.service.js → storage.service.js
menu.service.js → storage.service.js
order.service.js → storage.service.js, audit.service.js, menu.service.js
payment.service.js → storage.service.js, audit.service.js
staff.service.js → storage.service.js
sync.service.js → storage.service.js
```

### Controller Dependencies
```
login.controller.js → auth.service.js
cashier.controller.js → auth, room, menu, order, payment, staff
customer.controller.js → room, menu, order
waiter.controller.js → auth, room, menu, order, staff
kitchen.controller.js → auth, order, menu
```

## 📝 File Purposes

### Configuration Files
| File | Purpose |
|------|---------|
| manifest.json | PWA configuration |
| package.json | NPM dependencies |
| routes.js | URL routing config |

### Core Files
| File | Purpose |
|------|---------|
| index.html | Application shell |
| app.js | AngularJS bootstrap |
| service-worker.js | Offline support |
| offline.html | Offline fallback |

### Documentation Files
| File | Purpose |
|------|---------|
| README.md | Project overview |
| QUICKSTART.md | Getting started |
| ARCHITECTURE.md | Technical details |
| CHANGELOG.md | Version history |
| PROJECT_SUMMARY.md | Complete summary |
| spec.md | Original specification |

## 🎨 Code Structure

### AngularJS Pattern
```javascript
// Module Definition
angular.module('karaApp', ['ngRoute', 'ngAnimate'])

// Service Pattern
angular.module('karaApp').service('ServiceName', [dependencies, function() {
    // Service logic
}])

// Controller Pattern
angular.module('karaApp').controller('ControllerName', 
    ['$scope', dependencies, function($scope, deps) {
    // Controller logic
}])

// Config Pattern
angular.module('karaApp').config(['$routeProvider', function($routeProvider) {
    // Route configuration
}])
```

## 🔍 Navigation Guide

### Want to understand the system?
→ Start with `README.md`

### Want to run the app?
→ Read `QUICKSTART.md`

### Want to see the code structure?
→ Check `ARCHITECTURE.md`

### Want to modify a specific feature?
→ Find the relevant controller/service

### Want to add a new feature?
1. Add service in `app/services/`
2. Add controller in `app/controllers/`
3. Add view in `app/views/`
4. Register route in `app/config/routes.js`

### Want to change styling?
→ Edit Tailwind classes in view files

### Want to see what changed?
→ Read `CHANGELOG.md`

## 💡 Tips

### Adding New Rooms
Edit: `app/services/room.service.js` → `initRooms()`

### Adding New Menu Items
Edit: `app/services/menu.service.js` → `initMenu()`

### Changing Prices
Edit: `app/services/payment.service.js` → `initPriceConfig()`

### Debugging
Open browser console (F12) and check:
- Console logs
- LocalStorage (Application tab)
- Network requests

### Resetting Data
Open console: `localStorage.clear(); location.reload();`

---

**File Tree Generated**: December 17, 2025  
**Total Files**: 33  
**Total Lines**: ~5,000+
