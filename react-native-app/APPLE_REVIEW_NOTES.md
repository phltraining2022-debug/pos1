# App Store Review Notes — Kara POS

## App Description
Kara POS is a **multi-location point-of-sale (POS) application** designed for restaurants, cafes, and food service businesses. It allows staff at different restaurant locations to manage tables, take orders, and process payments efficiently in real-time.

**Key Differentiator:** This is NOT a single-restaurant app. The platform supports multiple restaurant/cafe locations, each with their own staff, inventory, and operations. Reviewers can test with demo stores to see the multi-location capability.

## Demo Account for Reviewer
To test the app, please use the following credentials:

**Production Demo Server:** `https://kara.app.live1.vn`

**Test Accounts:**

1. **Cashier Role**
   - Username: `cashier_demo`
   - Password: `demo123456`
   - Functions: View bills, process payments, manage checkout

2. **Waiter Role**
   - Username: `waiter_demo`
   - Password: `demo123456`
   - Functions: Select tables, manage orders, send orders to kitchen

3. **Manager/Admin Role**
   - Username: `manager_demo`
   - Password: `demo123456`
   - Functions: View dashboard, inventory management, system reports, multi-location oversight

## Store Selection
After successful login, you will be prompted to **select a restaurant/location** from the available list:
- **Karaoke Luxury** — Demo karaoke venue
- **Nhà hàng Kara** — Demo restaurant
- **Quán ăn Kara Central** — Demo central dining location

This demonstrates the **multi-location support** of the platform. Each store can operate independently with separate staff, inventory, and billing.

## Key Features to Test

### 1. Login & Store Selection
- Tap the **logo** to change backend URL if needed (long-press logo in login screen)
- Enter demo credentials and tap "Đăng nhập"
- **Select a restaurant** from the list
- App routes to appropriate role screen with store name displayed in header

### 2. Waiter Flow (Recommended Test Path)
- **Login** as waiter for a selected store
- **Header displays:** "Phục vụ • [Selected Store Name]"
- **Select table** (e.g., "Bàn 1")
- **Add items** to order (tap dishes, select quantity, tap ✓)
- **Send to kitchen** (tap "Gửi bếp")
- **See order status** in the kitchen display area
- **Proceed to payment** (tap "Thanh toán")
- **Confirm table closure** (table moves to "Dọn dẹp")

### 3. Cashier Flow
- **Login** as cashier for a selected store
- **Header displays:** "Thu Ngân - POS • [Selected Store Name]"
- **View open bills** from all waiters in the store
- **Review order details** (select bill)
- **Process payment** (select payment method, confirm)
- **Verify receipt** appears

### 4. Manager Dashboard
- **Login** as manager
- **View daily sales** summary
- **Check inventory** (if available in demo)
- **Navigate between screens** using tab icons

### 5. Push Notifications & Device Registration
- After login, app automatically requests notification permission
- If permission is granted, device token is registered
- Notifications for order updates will appear when orders are sent to kitchen

### 6. Network Resilience
- Close app and reopen while restaurant data is loading — app should not crash
- Dismiss network errors — app should allow retry or graceful degradation

## Technical Details

**Bundle ID:** `vn.vvs.pos1`  
**Minimum iOS Version:** 15.1  
**Supported Orientations:** Portrait only  
**Push Notifications:** Enabled (APNs production environment)  
**Encryption:** No exempt encryption used  

## Known Limitations
- App is designed for restaurant use (table-based ordering)
- Inventory module may be in beta and incomplete
- Demo backend may reset daily

## Support & Testing Duration
- Estimated testing time: **5–10 minutes**
- If any issues occur, the app displays error alerts with actionable messages
- Backend is stable and available 24/7 for testing

---

**Version:** 1.0  
**Build Date:** 2026-05-16  
**Team:** Vastbit Company Limited
