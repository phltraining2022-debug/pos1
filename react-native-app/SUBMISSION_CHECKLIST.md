# App Store Submission Checklist — Kara POS

Use this checklist to ensure your app is ready for App Store review.

## ✅ App Metadata

- [x] **App Name:** "Kara POS"
- [x] **Description:** "Ứng dụng quản lý bàn, đặt món và thanh toán cho nhà hàng, quán ăn"
- [x] **Category:** Business
- [x] **Subtitle:** (Optional) — Not required
- [x] **Keywords:** pos, nhà hàng, quán ăn, đặt món, thanh toán, bàn, quản lý

## ✅ Build & Signing

- [x] **Bundle ID:** vn.vvs.pos1
- [x] **Team ID:** B94C8QTSJ8
- [x] **Provisioning Profile:** iOS Team Store Provisioning Profile (production)
- [x] **Code Signing Identity:** Apple Distribution
- [x] **APS Environment:** production
- [x] **Build Number:** Incremented before each submission
- [x] **Version Number:** 1.0.0 (increment for updates)

## ✅ Info.plist & Configuration

- [x] **Minimum iOS Version:** 15.1
- [x] **Device Orientations:** Portrait only (no landscape)
- [x] **Icon:** App icon 180x180px or larger
- [x] **Splash/Launch Screen:** Present and matches app branding
- [x] **ITSAppUsesNonExemptEncryption:** false (no encryption requiring ITSR)

## ✅ Permissions & Capabilities

### Usage Descriptions (Localized)
- [x] **NSCameraUsageDescription:** "Dùng camera để quét mã QR đặt món và thanh toán."
- [x] **NSPhotoLibraryUsageDescription:** "Dùng để lưu và tải ảnh sản phẩm."
- [x] **NSFaceIDUsageDescription:** "Dùng Face ID để đăng nhập nhanh."
- [x] **NSUserNotificationsUsageDescription:** "Nhận thông báo đơn hàng mới và cập nhật từ hệ thống."

### Capabilities
- [x] **Push Notifications:** Enabled with production APNs
- [x] **Sign in with Apple:** (Optional — not required if own auth system)

## ✅ Network & Security

- [x] **HTTPS Only:** All backend endpoints use HTTPS/TLS 1.2+
- [x] **Exception Domains:** Listed in NSExceptionDomains (kara.test.live1.vn, kara.app.live1.vn)
- [x] **No Arbitrary Loads:** NSAllowsArbitraryLoads = false
- [x] **No Hardcoded Secrets:** API keys moved to environment variables

## ✅ Functionality & Testing

- [x] **Login Flow:** Works without crashing
- [x] **Core Workflow:** Table selection → order → send to kitchen → payment → success
- [x] **Error Handling:** Network errors show Alert to user (not crashes)
- [x] **Push Notifications:** Permission request appears after login
- [x] **Offline Resilience:** App handles network disconnection gracefully
- [x] **Session Persistence:** User remains logged in after app restart (until logout)
- [x] **Demo Credentials:** Provided in APPLE_REVIEW_NOTES.md

## ✅ Code Quality

- [x] **No Console Logs:** Debug logs removed from production code
- [x] **No Placeholder Text:** "Coming soon" features removed
- [x] **No Hardcoded Test Data:** Test accounts provided in review notes, not in code
- [x] **Error Messages:** Localized in Vietnamese, user-friendly
- [x] **No Crashes:** App tested on iOS 15.1+ and does not crash on main flows

## ✅ Privacy & Legal

- [x] **Privacy Policy:** Exists and accessible (see PRIVACY_POLICY.md)
- [x] **Terms of Service:** Provided or noted as N/A for business tool
- [x] **Age Rating:** Set to 4+ (no objectionable content)
- [x] **Data Collection Disclosure:** Privacy Policy describes what data is collected

## ✅ Screenshots & Preview

- [ ] **5 Screenshots:** Recommended for each device size (6.5" iPhone)
  - Screenshot 1: Login screen
  - Screenshot 2: Table/room selection
  - Screenshot 3: Order item selection
  - Screenshot 4: Order summary & payment
  - Screenshot 5: Payment success confirmation

- [ ] **Preview:** Optional 15-30 second video showing app flow

## ✅ App Store Connect

### General Information
- [x] **Application Name:** Kara POS
- [x] **Bundle ID:** vn.vvs.pos1
- [x] **SKU:** pos1
- [x] **Primary Language:** Vietnamese

### Pricing & Availability
- [ ] **Price:** Free (or set pricing tier)
- [ ] **Availability:** Select countries where restaurant operates
- [ ] **Release Date:** Immediate or scheduled

### Review Information
- [x] **Review Notes:** See APPLE_REVIEW_NOTES.md
  - Demo backend URL
  - Test account credentials
  - Key features to test
  - Estimated testing time

### Contact Information
- [ ] **First Name:** (Your name)
- [ ] **Last Name:** (Your name)
- [ ] **Phone:** (Support phone)
- [ ] **Email:** (Support email)

## ✅ Pre-Submission

- [ ] Run `./run-tf.sh` and verify:
  - Archive succeeds with `** ARCHIVE SUCCEEDED **`
  - Export shows `aps-environment: production`
  - Export uploads to App Store successfully
  - No build warnings or errors

- [ ] **Final Testing:**
  - [ ] Login with demo account works
  - [ ] Navigate all main screens
  - [ ] Test order flow end-to-end
  - [ ] Verify push notification permission request appears
  - [ ] Check error handling with bad network (turn off WiFi briefly)
  - [ ] Review app does not crash or have "Coming Soon" screens

- [ ] **Code Review:**
  - [ ] No console.log debug statements
  - [ ] No hardcoded API keys or tokens
  - [ ] All error messages are user-friendly and actionable

---

## Common Rejection Reasons (Preventive Checklist)

- [ ] **Incomplete App:** Missing core features or "Coming Soon" placeholders — **Fixed: all core features implemented**
- [ ] **Reviewer Can't Test:** Missing demo account or unclear testing steps — **Fixed: see APPLE_REVIEW_NOTES.md**
- [ ] **Crashes on Launch:** App crashes or freezes during main flows — **Fixed: error handling implemented**
- [ ] **No Privacy Policy:** Unclear data collection practices — **Fixed: PRIVACY_POLICY.md created**
- [ ] **Misleading Metadata:** Screenshots don't match app UI — **Pending: create 5 screenshots**
- [ ] **Network Security:** Hardcoded secrets or insecure API calls — **Fixed: HTTPS only, env vars for secrets**
- [ ] **Unclear Permissions:** Reason text for camera/photo access is vague — **Fixed: clear Vietnamese descriptions**

---

**Last Updated:** May 16, 2026  
**App Version:** 1.0.0  
**Build:** 8 (or latest)
