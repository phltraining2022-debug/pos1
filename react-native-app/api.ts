import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_SERVER_URL = 'https://kara.test.live1.vn';
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

export async function saveToken(token: string, userId: string) {
  await AsyncStorage.multiSet([[TOKEN_KEY, token], [USER_ID_KEY, userId]]);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function clearToken() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_ID_KEY]);
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  if (token) headers['Authorization'] = token;
  if (options?.headers) Object.assign(headers, options.headers);

  const url = (await getBaseUrl()) + path;
  console.log('[API] fetch', options?.method ?? 'GET', url);
  try {
    const res = await fetch(url, { ...options, headers });
    console.log('[API] response', res.status, url);
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
    try {
      await apiFetch('/users/logout', { method: 'POST' });
    } catch {
      // ignore logout errors
    }
  }
  await clearToken();
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
      return;
    }

    await apiFetch('/installations', {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, createdAt: new Date().toISOString() }),
    });
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
  const rooms = await apiFetch<Room[]>('/Rooms');
  return rooms.filter(r => r.isActive !== false);
}

// ─── Products ─────────────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const products = await apiFetch<Product[]>('/Products');
  return products.filter(p => p.isActive !== false);
}

export async function getProductCategories(): Promise<ProductCategory[]> {
  return apiFetch<ProductCategory[]>('/ProductCategories');
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
  deposit: number;
  paymentMethod?: string;
  createdAt: string;
  updatedAt: string;
  customerId?: string;
  note?: string;
  isActive?: boolean;
}

export interface OrderItemInput {
  productId: string;
  name: string;
  quantity: number;
  price: number;  // unitPrice on server
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
      total: 0,
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
  const now = new Date().toISOString();
  await Promise.all(
    items.map(item =>
      apiFetch('/SaleOrderItems', {
        method: 'POST',
        body: JSON.stringify({
          saleOrderId,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          unit: item.unit ?? 'phần',
          discount: 0,
          subtotal: item.quantity * item.price,
          note: item.note ?? '',
          createdAt: now,
          updatedAt: now,
        }),
      }),
    ),
  );
}

/** Thanh toán: PATCH SaleOrder → completed + cập nhật Room → cleaning */
export async function checkout(
  saleOrderId: string,
  roomId: string,
  total: number,
  paymentMethod: string,
  discount: number,
): Promise<void> {
  await apiFetch(`/SaleOrders/${encodeURIComponent(saleOrderId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'completed',
      paymentMethod,
      paidAmount: total - discount,
      total,
      discount,
      updatedAt: new Date().toISOString(),
    }),
  });
  // Cập nhật Room: cleaning + xoá saleOrderId
  try {
    await apiFetch(`/Rooms/${encodeURIComponent(roomId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'cleaning',
        saleOrderId: null,
        startTime: null,
      }),
    });
  } catch (e) {
    console.warn('[checkout] Could not update Room status:', e);
  }
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

/** Lấy danh sách Users (nhân viên) */
export async function getUsers(): Promise<Array<{
  id: string; username: string; fullName?: string; role?: string;
}>> {
  return apiFetch<any[]>('/Users');
}
