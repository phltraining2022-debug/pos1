import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_SERVER_URL = 'https://kara.app.live1.vn';
const SERVER_URL_KEY = 'kara_server_url';

// URL động — đọc từ AsyncStorage, fallback về default
let _cachedServerUrl: string | null = null;
export async function getServerUrl(): Promise<string> {
  if (_cachedServerUrl) return _cachedServerUrl;
  const stored = await AsyncStorage.getItem(SERVER_URL_KEY);
  _cachedServerUrl = stored ?? DEFAULT_SERVER_URL;
  return _cachedServerUrl;
}
export async function setServerUrl(url: string) {
  const clean = url.replace(/\/+$/, ''); // bỏ trailing slash
  _cachedServerUrl = clean;
  await AsyncStorage.setItem(SERVER_URL_KEY, clean);
}

async function getBaseUrl(): Promise<string> {
  return (await getServerUrl()) + '/api';
}
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

// Auth error callback — App.tsx đăng ký để redirect về login khi token hết hạn
let _authErrorHandler: (() => void) | null = null;
export function setAuthErrorHandler(cb: () => void) {
  _authErrorHandler = cb;
}

const TOKEN_KEY = 'kara_access_token';
const USER_ID_KEY = 'kara_user_id';
const INSTALLATION_ID_KEY = 'kara_installation_id';

export async function saveToken(token: string, userId: string) {
  await AsyncStorage.multiSet([[TOKEN_KEY, token], [USER_ID_KEY, userId]]);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function clearToken() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_ID_KEY, INSTALLATION_ID_KEY]);
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  if (token) headers['Authorization'] = token;
  if (options?.headers) Object.assign(headers, options.headers);

  const url = (await getBaseUrl()) + path;
  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      // Token hết hạn hoặc không hợp lệ → về login
      if (res.status === 401 || res.status === 403) {
        await clearToken();
        _authErrorHandler?.();
      }
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  } catch (e: any) {
    console.error('[API] error', url, e?.message ?? e);
    throw e;
  }
}

// ─── Cache layer (30s TTL) ────────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const CACHE_TTL = 30000; // 30 seconds
const apiCache: Record<string, CacheEntry<any>> = {};

function getCached<T>(key: string): T | null {
  const entry = apiCache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    delete apiCache[key];
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T): void {
  apiCache[key] = { data, timestamp: Date.now() };
}

// Clear cache for rooms and products (call after operations like checkout, check-in)
export function invalidateCache(keys?: string[]): void {
  if (!keys) {
    // Clear all cache
    Object.keys(apiCache).forEach(key => delete apiCache[key]);
  } else {
    keys.forEach(key => delete apiCache[key]);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResult {
  token: string;
  userId: string;
  roles: string[];   // tất cả roles của user
  role: string;      // role chính (roles[0])
  fullName: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const data = await apiFetch<{ id: string; userId: string }>('/users/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  const token = data.id;
  const userId = data.userId;
  await saveToken(token, userId);

  // Fetch tất cả roles
  const rolesData = await apiFetch<Array<{ name: string }>>(`/users/${userId}/roles`);
  const roles = rolesData.map(r => r.name);
  const role = roles[0] ?? 'cashier';

  // Fetch user details
  const user = await apiFetch<{ fullName?: string; username: string }>(`/users/${userId}`);

  return { token, userId, roles, role, fullName: user.fullName ?? user.username };
}

// Kiểm tra token cũ trong AsyncStorage — gọi khi app khởi động
export async function restoreSession(): Promise<LoginResult | null> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const userId = await AsyncStorage.getItem(USER_ID_KEY);
  if (!token || !userId) return null;
  try {
    const rolesData = await apiFetch<Array<{ name: string }>>(`/users/${userId}/roles`);
    const roles = rolesData.map(r => r.name);
    const role = roles[0] ?? 'cashier';
    const user = await apiFetch<{ fullName?: string; username: string }>(`/users/${userId}`);
    return { token, userId, roles, role, fullName: user.fullName ?? user.username };
  } catch {
    await clearToken();
    return null;
  }
}

export async function logout() {
  const token = await getToken();
  if (token) {
    // Xóa installation record → device không nhận push nữa
    try {
      const installationId = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
      if (installationId) {
        await apiFetch(`/installations/${installationId}`, { method: 'DELETE' });
      }
    } catch {
      // ignore — installation có thể đã bị xóa trước đó
    }
    try {
      await apiFetch('/users/logout', { method: 'POST' });
    } catch {
      // ignore logout errors
    }
  }
  await clearToken();
}

export async function requestUserPasswordReset(identifier: string): Promise<void> {
  await apiFetch('/user/forgotPassword', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber: identifier }),
  });
}

export async function resetUserPassword(
  identifier: string,
  verifyCode: string,
  password: string,
): Promise<void> {
  await apiFetch('/newPassword', {
    method: 'POST',
    body: JSON.stringify({
      phoneNumber: identifier,
      verifyCode,
      password,
      context: 'user',
    }),
  });
}

// ─── Push notification installation ──────────────────────────────────────────
// Gọi sau khi login thành công để đăng ký device nhận push notification
export interface InstallationPayload {
  userId: string;
  deviceToken: string;
  osVersion: string;
  deviceName: string;
  appId: string;
  platform: 'ios' | 'android';
  tokenType: 'apns' | 'fcm' | 'expo';
}

export async function registerInstallation(payload: InstallationPayload): Promise<void> {
  const { userId, deviceToken, osVersion, deviceName, appId, platform, tokenType } = payload;
  const basePayload = {
    userId,
    deviceToken,
    osVersion,
    deviceName,
    appId,
    platform,
    tokenType,
    lastLog: new Date().toISOString(),
  };

  try {
    // Upsert: tìm installation cũ của device này và cập nhật, hoặc tạo mới
    const existing = await apiFetch<Array<{ id: string }>>(
      `/installations?filter=${encodeURIComponent(JSON.stringify({ where: { userId, appId, deviceToken } }))}`
    );
    if (existing && existing.length > 0) {
      await apiFetch(`/installations/${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify(basePayload),
      });
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, existing[0].id);
      return;
    }

    const created = await apiFetch<{ id: string }>('/installations', {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, createdAt: new Date().toISOString() }),
    });
    if (created?.id) {
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, created.id);
    }
  } catch (err: any) {
    const reason = String(err?.message ?? err ?? 'Unknown error')
    const enriched = new Error(`Cannot register installation: ${reason}`)
    ;(enriched as any).cause = err
    ;(enriched as any).context = {
      userId,
      appId,
      platform,
      tokenType,
      tokenPrefix: deviceToken?.slice(0, 12),
    }
    throw enriched
  }
}



export interface Room {
  id: string;
  name: string;
  code: string;
  status: 'available' | 'occupied' | 'reserved' | string;
  type: string;
  saleOrderId: string | null;
  startTime: string | null;
  customerInfo: Record<string, unknown> | null;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  sellingPrice: number;
  category: string;
  categoryId: string;
  image: string;
  isActive: boolean;
  code: string;
  type: string;
  stock: number;
  minStockLevel: number;
  unitOfMeasure: string;
  isTimeBased?: boolean;  // sản phẩm tính theo giờ (thuê phòng)
  timeBasedPricing?: { blockMinutes?: number; pricePerHour?: number };
}

export interface ProductCategory {
  id: string;
  name: string;
  code: string;
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export async function getRooms(): Promise<Room[]> {
  const cached = getCached<Room[]>('rooms');
  if (cached) return cached;
  
  const rooms = await apiFetch<Room[]>('/Rooms');
  const filtered = rooms.filter(r => r.isActive !== false);
  setCached('rooms', filtered);
  return filtered;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const cached = getCached<Product[]>('products');
  if (cached) return cached;
  
  const products = await apiFetch<Product[]>('/Products');
  const filtered = products.filter(p => p.isActive !== false);
  setCached('products', filtered);
  return filtered;
}

export async function getProductCategories(): Promise<ProductCategory[]> {
  const cached = getCached<ProductCategory[]>('productCategories');
  if (cached) return cached;
  
  const categories = await apiFetch<ProductCategory[]>('/ProductCategories');
  setCached('productCategories', categories);
  return categories;
}

export async function getAllProducts(): Promise<Product[]> {
  return apiFetch<Product[]>('/Products');
}

export interface ProductInput {
  name: string;
  price: number;
  sellingPrice: number;
  categoryId?: string;
  code?: string;
  type?: string;
  isActive?: boolean;
}

export async function createProduct(data: ProductInput): Promise<Product> {
  return apiFetch<Product>('/Products', {
    method: 'POST',
    body: JSON.stringify({ ...data, isActive: true }),
  });
}

export async function updateProduct(id: string, data: Partial<ProductInput>): Promise<Product> {
  return apiFetch<Product>(`/Products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProduct(id: string): Promise<void> {
  await apiFetch(`/Products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: false }),
  });
}

// Nhập hàng: cộng thêm stock vào sản phẩm
export async function stockIn(
  productId: string,
  addQty: number,
  currentStock: number,
  unitPrice?: number,
  supplier?: string,
  note?: string,
  invoiceNumber?: string,
  expiredDate?: string,
): Promise<Product> {
  const newStock = (currentStock || 0) + addQty;
  return apiFetch<Product>(`/Products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ stock: newStock }),
  });
}

export async function adjustStock(
  productId: string,
  newStock: number,
  minStockLevel?: number,
): Promise<Product> {
  const body: Record<string, number> = { stock: newStock };
  if (minStockLevel !== undefined) body.minStockLevel = minStockLevel;
  return apiFetch<Product>(`/Products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ─── SaleOrders ───────────────────────────────────────────────────────────────

export interface SaleOrder {
  id: string;
  code: string;
  roomId: string;
  room?: { name: string; type: string; code?: string };
  status: 'open' | 'completed' | string;
  total: number;
  paidAmount: number;
  discount: number;
  discountPct?: number;   // % giảm giá (0 hoặc undefined = giảm cố định)
  deposit: number;
  paymentMethod?: string;
  isPrinted?: boolean;
  printedAt?: string;
  timeFrozen?: boolean;  // true = đã đóng băng giờ (chờ thanh toán)
  createdAt: string;
  updatedAt: string;
  customerId?: string;
  note?: string;
  isActive?: boolean;
}

export interface OrderItemInput {
  id?: string;          // cart item id: 'sol_xxx' = đã có server record, 'ci_xxx' = mới
  productId: string;
  name: string;
  quantity: number;     // total quantity trong cart
  submittedQty?: number; // số lượng đã submit trước (dùng tính delta khi POST)
  price: number;        // unitPrice on server
  unit?: string;
  note?: string;
}

/** Mở phòng: tạo SaleOrder + cập nhật Room status=occupied */
export async function checkIn(
  roomId: string,
  customerName: string,
  customerPhone?: string,
): Promise<SaleOrder> {
  const now = new Date().toISOString();
  const order = await apiFetch<SaleOrder>('/SaleOrders', {
    method: 'POST',
    body: JSON.stringify({
      roomId,
      orderDate: now,
      deliveryDate: now,
      type: 'W',
      status: 'pending',
      customerId: '69560638fb714a3aabb94714', // walk-in default
      deposit: 0,
      paidAmount: 0,
      discount: 0,
      discountPct: 0,
      total: 0,
      isPrinted: false,
      printedAt: null,
      timeFrozen: false,
      customerInfo: { name: customerName, phone: customerPhone ?? '' },
      note: `Check-in: ${roomId}${customerName ? ' - ' + customerName : ''}`,
      createdAt: now,
      updatedAt: now,
    }),
  });
  // Cập nhật Room: occupied + saleOrderId + startTime
  try {
    await apiFetch(`/Rooms/${encodeURIComponent(roomId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'occupied',
        saleOrderId: order.id,
        startTime: now,
      }),
    });
  } catch (e) {
    console.warn('[checkIn] Could not update Room status:', e);
  }
  return order;
}

/** Gọi món: POST từng item vào /SaleOrderItems (theo old app) */
export async function submitOrderItems(
  saleOrderId: string,
  items: OrderItemInput[],
): Promise<void> {
  // 1 request thay vì N parallel calls
  const batchItems = items.map(item => {
    const serverItemId = item.id?.startsWith('sol_') ? item.id.slice(4) : null;
    if (serverItemId) {
      return { itemId: serverItemId, quantity: item.quantity, subtotal: item.quantity * item.price };
    }
    const delta = item.quantity - (item.submittedQty ?? 0);
    return {
      productId: item.productId,
      name: item.name,
      quantity: delta,
      unitPrice: item.price,
      unit: item.unit ?? 'phần',
      note: item.note ?? '',
      subtotal: delta * item.price,
    };
  });
  await apiFetch(`/SaleOrders/${encodeURIComponent(saleOrderId)}/batch-items`, {
    method: 'POST',
    body: JSON.stringify({ items: batchItems }),
  });
}

/** Cập nhật một số trường của SaleOrderItem (ví dụ: note, quantity) */
export async function patchSaleOrderItem(
  itemId: string,
  patch: Partial<{ note: string; quantity: number; subtotal: number }>,
): Promise<void> {
  await apiFetch(`/SaleOrderItems/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updatedAt: new Date().toISOString() }),
  });
}

/** Xóa SaleOrderItem khỏi server */
export async function deleteSaleOrderItem(itemId: string): Promise<void> {
  await apiFetch(`/SaleOrderItems/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
}

/** Lấy một SaleOrder theo id */
export async function getSaleOrder(saleOrderId: string): Promise<SaleOrder> {
  return apiFetch<SaleOrder>(`/SaleOrders/${encodeURIComponent(saleOrderId)}`);
}

/** Cập nhật SaleOrder (ví dụ: ghi printedAt khi in bill) */
export async function patchSaleOrder(saleOrderId: string, data: Record<string, unknown>): Promise<void> {
  await apiFetch(`/SaleOrders/${encodeURIComponent(saleOrderId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Đổi phòng: chuyển SaleOrder từ phòng cũ sang phòng mới */
export async function changeRoom(
  oldRoomId: string,
  newRoomId: string,
  saleOrderId: string,
  startTime: string,
): Promise<void> {
  await Promise.all([
    // Cập nhật SaleOrder → roomId mới
    apiFetch(`/SaleOrders/${encodeURIComponent(saleOrderId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ roomId: newRoomId, updatedAt: new Date().toISOString() }),
    }),
    // Phòng cũ → trống
    apiFetch(`/Rooms/${encodeURIComponent(oldRoomId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'available', saleOrderId: null, startTime: null }),
    }),
    // Phòng mới → occupied
    apiFetch(`/Rooms/${encodeURIComponent(newRoomId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'occupied', saleOrderId, startTime }),
    }),
  ]);
}

/** Gộp bill: chuyển tất cả SaleOrderItems từ fromSaleOrderId → toSaleOrderId, rồi đóng fromRoom */
export async function mergeBill(
  fromSaleOrderId: string,
  fromRoomId: string,
  toSaleOrderId: string,
): Promise<void> {
  // 1. Lấy items của fromRoom
  const items = await getSaleOrderItems(fromSaleOrderId);
  // 2. PATCH từng item → toSaleOrderId
  await Promise.all(
    items.map(item =>
      apiFetch(`/SaleOrderItems/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ saleOrderId: toSaleOrderId }),
      })
    )
  );
  // 3. Đóng SaleOrder gốc (mark merged)
  await apiFetch(`/SaleOrders/${encodeURIComponent(fromSaleOrderId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'merged', updatedAt: new Date().toISOString() }),
  });
  // 4. Phòng nguồn → cleaning
  await apiFetch(`/Rooms/${encodeURIComponent(fromRoomId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cleaning', saleOrderId: null }),
  });
}

/** Thanh toán: PATCH SaleOrder → completed + cập nhật Room → cleaning */
export async function checkout(
  saleOrderId: string,
  roomId: string,
  total: number,
  paymentMethod: string,
  discount: number,
): Promise<void> {
  // Dùng atomic endpoint: SaleOrder + Room cập nhật trong 1 request
  await apiFetch(`/Rooms/${encodeURIComponent(roomId)}/checkout`, {
    method: 'POST',
    body: JSON.stringify({
      totalAmount: total,
      paymentMethod,
      discount,
    }),
  });
}

// ─── SaleOrderItems ───────────────────────────────────────────────────────────

export interface SaleOrderItem {
  id: string;
  saleOrderId: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  discount: number;
  subtotal: number;
  note: string;
  createdAt?: string;
  timeBasedConfig?: { blockMinutes?: number };
}

export async function getSaleOrderItems(saleOrderId: string): Promise<SaleOrderItem[]> {
  const filter = JSON.stringify({ where: { saleOrderId } });
  return apiFetch<SaleOrderItem[]>(`/SaleOrderItems?filter=${encodeURIComponent(filter)}`);
}

/** Đánh dấu phòng đã dọn xong → available */
export async function markRoomCleaned(roomId: string): Promise<void> {
  await apiFetch(`/Rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available' }),
  });
}

/** Lấy danh sách SaleOrders theo filter LoopBack */
export async function getSaleOrders(filter?: object): Promise<SaleOrder[]> {
  const q = filter ? `?filter=${encodeURIComponent(JSON.stringify(filter))}` : '';
  return apiFetch<SaleOrder[]>(`/SaleOrders${q}`);
}

export async function getSaleOrderById(id: string): Promise<SaleOrder> {
  return apiFetch<SaleOrder>(`/SaleOrders/${encodeURIComponent(id)}`);
}

// ─── Revenue Report (server-side aggregation) ─────────────────────────────────

export interface RevenueReportTransaction {
  code: string; roomId: string; roomName: string;
  paidAmount: number; paymentMethod: string; updatedAt: string;
}

export interface ProductAnalyticsItem {
  name: string; qty: number; revenue: number; cost: number; profit: number; margin: number;
}

export interface RevenueReport {
  totalRevenue: number;
  orderCount: number;
  openOrderCount: number;
  byMethod: Record<string, number>;   // key = paymentMethod raw value ('cash','transfer',...)
  byDay: Record<string, number>;      // key = 'YYYY-MM-DD'
  byHour: Record<string, number>;     // key = '0'..'23'
  recentTransactions: RevenueReportTransaction[];
  productAnalytics: ProductAnalyticsItem[];
}

export async function getRevenueReport(from: string, to?: string): Promise<RevenueReport> {
  let q = `?from=${encodeURIComponent(from)}`;
  if (to) q += `&to=${encodeURIComponent(to)}`;
  return apiFetch<RevenueReport>(`/SaleOrders/revenue-report${q}`);
}

/** Lấy danh sách Users (nhân viên) */
export async function getUsers(): Promise<Array<{
  id: string; username: string; fullName?: string; role?: string;
}>> {
  return apiFetch<any[]>('/Users');
}

// ─── Stores / Locations ────────────────────────────────────────────────────────
// Hỗ trợ multi-store/multi-location (để pass Apple review)

export interface Store {
  id: string;
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  type?: string;
}

const SELECTED_STORE_KEY = 'kara_selected_store_id';
const SELECTED_STORE_NAME_KEY = 'kara_selected_store_name';

export async function getStores(): Promise<Store[]> {
  try {
    // Cố gắng fetch từ backend
    const stores = await apiFetch<Store[]>('/Locations');
    return stores && stores.length > 0 ? stores : getDefaultStores();
  } catch (e) {
    // Nếu endpoint không tồn tại, dùng mock data
    console.warn('[getStores] Endpoint error, using default stores:', e);
    return getDefaultStores();
  }
}

function getDefaultStores(): Store[] {
  // Mock stores nếu backend không hỗ trợ
  return [
    { id: 'store_1', name: 'Karaoke Luxury', code: 'KL-001', type: 'karaoke' },
    { id: 'store_2', name: 'Nhà hàng Kara', code: 'NH-001', type: 'restaurant' },
    { id: 'store_3', name: 'Quán ăn Kara Central', code: 'QA-001', type: 'restaurant' },
  ];
}

export async function saveSelectedStore(storeId: string, storeName: string): Promise<void> {
  await AsyncStorage.multiSet([
    [SELECTED_STORE_KEY, storeId],
    [SELECTED_STORE_NAME_KEY, storeName],
  ]);
}

export async function getSelectedStore(): Promise<{ id: string; name: string } | null> {
  const [id, name] = await AsyncStorage.multiGet([SELECTED_STORE_KEY, SELECTED_STORE_NAME_KEY]);
  const storeId = id[1];
  const storeName = name[1];
  return storeId && storeName ? { id: storeId, name: storeName } : null;
}

export async function clearSelectedStore(): Promise<void> {
  await AsyncStorage.multiRemove([SELECTED_STORE_KEY, SELECTED_STORE_NAME_KEY]);
}
