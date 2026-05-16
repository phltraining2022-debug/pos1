import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Platform, Alert } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import WaiterScreen from './WaiterScreen'
import CashierScreen from './CashierScreen'
import ManagerScreen from './ManagerScreen'
import InventoryScreen from './InventoryScreen'
import LoginScreen from './LoginScreen'
import { ThemeProvider, useTheme } from './ThemeContext'
import { setAuthErrorHandler, restoreSession, registerInstallation } from './api'

const IOS_BUNDLE_ID = 'vn.vvs.pos1'
const ANDROID_PACKAGE = 'vn.vvs.pos1'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function showInstallationErrorOnDevice(reason: string) {
  Alert.alert(
    'Không đăng ký được thiết bị nhận thông báo',
    `${reason}\n\nVui lòng gửi ảnh màn hình này cho kỹ thuật để xử lý.`,
    [{ text: 'Đã hiểu' }]
  )
}

async function getNativePushTokenWithRetry(maxAttempts = 3): Promise<{ token: string; reason?: string }> {
  let lastReason = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const nativeTokenData = await Notifications.getDevicePushTokenAsync()
      const token = nativeTokenData?.data ? String(nativeTokenData.data) : ''
      if (token) return { token }
      console.warn(`[Push] Empty native token (attempt ${attempt}/${maxAttempts})`)
      lastReason = 'APNs trả về token rỗng.'
    } catch (e: any) {
      const message = String(e?.message ?? e ?? '')
      console.warn(`[Push] getDevicePushTokenAsync failed (attempt ${attempt}/${maxAttempts}):`, message)
      if (message.toLowerCase().includes('aps-environment')) {
        console.error('[Push] Missing aps-environment entitlement/profile. Enable Push Notifications capability for bundle vn.vvs.pos1 and regenerate provisioning profile.')
        lastReason = 'Thiếu entitlement aps-environment trong profile ký app.'
      } else {
        lastReason = message || 'Lỗi lấy device token từ APNs.'
      }
    }
    if (attempt < maxAttempts) await wait(1500)
  }
  return { token: '', reason: lastReason || 'Không lấy được device token sau nhiều lần thử.' }
}

// ─── Đăng ký push token sau khi có userId ────────────────────────────────────
async function setupPushNotifications(userId: string) {
  if (!Device.isDevice) {
    console.log('[Push] Skip: running on simulator')
    return // Simulator không hỗ trợ push
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  console.log('[Push] permission status:', { existing, finalStatus })
  if (finalStatus !== 'granted') {
    console.log('[Push] Permission not granted')
    showInstallationErrorOnDevice('Bạn chưa cấp quyền nhận thông báo cho ứng dụng.')
    return
  }

  const tokenResult = await getNativePushTokenWithRetry(3)
  if (!tokenResult.token) {
    console.warn('[Push] Native device token is empty, skip installation registration')
    showInstallationErrorOnDevice(tokenResult.reason ?? 'Không lấy được device token từ hệ điều hành.')
    return
  }

  const osVersion = Platform.OS === 'ios' ? `ios-${Platform.Version}` : `android-${Platform.Version}`
  const deviceName = Device.deviceName ?? Device.modelName ?? 'unknown'
  const appId = Platform.OS === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE
  try {
    await registerInstallation({
      userId,
      deviceToken: tokenResult.token,
      osVersion,
      deviceName,
      appId,
      platform: Platform.OS,
      tokenType: Platform.OS === 'ios' ? 'apns' : 'fcm',
    })
    console.log('[Push] Registered native token:', tokenResult.token)
  } catch (e: any) {
    const message = String(e?.message ?? e ?? 'Không rõ nguyên nhân')
    console.error('[Push] registerInstallation failed:', message)
    showInstallationErrorOnDevice(message)
    return
  }

  // Android cần notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }
}

type Screen = 'waiter' | 'cashier' | 'manager' | 'inventory'
type AppState = 'login' | 'select' | Screen

// Danh sách screens được phép theo roles
function getAllowedScreens(roles: string[]): Screen[] {
  const set = new Set<Screen>()
  for (const r of roles) {
    if (r === 'manager') {
      // Manager thấy tất cả
      return ['waiter', 'cashier', 'manager', 'inventory']
    }
    if (r === 'cashier') { set.add('cashier'); set.add('inventory') }
    if (r === 'waiter' || r === 'kitchen') { set.add('waiter') }
  }
  return Array.from(set)
}

function AppInner() {
  const [appState, setAppState] = useState<AppState>('login')
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [booting, setBooting] = useState(true)
  const { mode, toggle } = useTheme()

  const allowedScreens = getAllowedScreens(userRoles)

  // Khi token expired/invalid → về login
  useEffect(() => {
    setAuthErrorHandler(() => { setAppState('login'); setUserRoles([]) })
    return () => setAuthErrorHandler(() => {})
  }, [])

  // Khôi phục session từ AsyncStorage khi app khởi động
  useEffect(() => {
    restoreSession().then(result => {
      if (result) {
        setUserRoles(result.roles)
        const screens = getAllowedScreens(result.roles)
        setAppState(screens.length === 1 ? screens[0] : 'select')
        setupPushNotifications(result.userId)
      }
      setBooting(false)
    })
  }, [])

  if (booting) return null

  function handleLogin(roles: string[], userId: string) {
    setUserRoles(roles)
    setupPushNotifications(userId)
    const screens = getAllowedScreens(roles)
    if (screens.length === 1) {
      // Chỉ 1 screen → vào thẳng
      setAppState(screens[0])
    } else {
      setAppState('select')
    }
  }

  function goBack() {
    if (allowedScreens.length === 1) {
      // Không có select screen → logout
      setAppState('login')
      setUserRoles([])
    } else {
      setAppState('select')
    }
  }

  if (appState === 'login')     return <LoginScreen onLogin={handleLogin} />
  if (appState === 'waiter')    return <WaiterScreen  onBack={goBack} />
  if (appState === 'cashier')   return <CashierScreen onBack={goBack} onInventory={() => setAppState('inventory')} />
  if (appState === 'manager')   return <ManagerScreen onBack={goBack} />
  if (appState === 'inventory') return <InventoryScreen onBack={goBack} />

  // Select screen — chỉ hiển thị cards được phép
  const isDark = mode === 'dark'
  const bg      = isDark ? '#0f172a' : '#f3f4f6'
  const surface = isDark ? '#0f172a' : '#ffffff'
  const text    = isDark ? '#ffffff' : '#111827'
  const sub     = isDark ? '#64748b' : '#6b7280'
  const border  = isDark ? { waiter: '#1e40af', cashier: '#5b21b6', manager: '#92400e' }
                         : { waiter: '#bfdbfe',  cashier: '#ddd6fe',  manager: '#fde68a' }

  const can = (s: Screen) => allowedScreens.includes(s)

  return (
    <SafeAreaView style={[s.root, { backgroundColor: bg }]} edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />

      {/* Header row */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        <TouchableOpacity style={s.themeToggle} onPress={toggle}>
          <FontAwesome5 name={isDark ? 'sun' : 'moon'} size={15} color={isDark ? '#fbbf24' : '#6b7280'} solid />
        </TouchableOpacity>
        <TouchableOpacity style={[s.themeToggle, { backgroundColor: 'rgba(239,68,68,0.12)' }]} onPress={() => { setAppState('login'); setUserRoles([]) }}>
          <FontAwesome5 name="sign-out-alt" size={14} color="#ef4444" solid />
        </TouchableOpacity>
      </View>

      <View style={s.center}>
        <FontAwesome5 name="music" size={40} color="#7c3aed" solid />
        <Text style={[s.brand, { color: text }]}>Kara POS</Text>
        <Text style={[s.sub, { color: sub }]}>Chọn chức năng</Text>

        {can('waiter') && (
          <TouchableOpacity style={[s.card, { backgroundColor: surface, borderColor: border.waiter }]} activeOpacity={0.8} onPress={() => setAppState('waiter')}>
            <FontAwesome5 name="concierge-bell" size={32} color="#2563eb" solid />
            <View style={s.cardText}>
              <Text style={[s.cardTitle, { color: text }]}>Phục vụ</Text>
              <Text style={[s.cardDesc, { color: sub }]}>Nhận món, quản lý phòng, dọn dẹp</Text>
            </View>
            <FontAwesome5 name="chevron-right" size={14} color={sub} solid />
          </TouchableOpacity>
        )}

        {can('cashier') && (
          <TouchableOpacity style={[s.card, { backgroundColor: surface, borderColor: border.cashier }]} activeOpacity={0.8} onPress={() => setAppState('cashier')}>
            <FontAwesome5 name="cash-register" size={32} color="#7c3aed" solid />
            <View style={s.cardText}>
              <Text style={[s.cardTitle, { color: text }]}>Thu ngân</Text>
              <Text style={[s.cardDesc, { color: sub }]}>POS, hóa đơn, thanh toán</Text>
            </View>
            <FontAwesome5 name="chevron-right" size={14} color={sub} solid />
          </TouchableOpacity>
        )}

        {can('manager') && (
          <TouchableOpacity style={[s.card, { backgroundColor: surface, borderColor: border.manager }]} activeOpacity={0.8} onPress={() => setAppState('manager')}>
            <FontAwesome5 name="crown" size={30} color="#fbbf24" solid />
            <View style={s.cardText}>
              <Text style={[s.cardTitle, { color: text }]}>Quản lý / CEO</Text>
              <Text style={[s.cardDesc, { color: sub }]}>Dashboard, báo cáo thời gian thực</Text>
            </View>
            <FontAwesome5 name="chevron-right" size={14} color={sub} solid />
          </TouchableOpacity>
        )}

        {can('inventory') && (
          <TouchableOpacity style={[s.card, { backgroundColor: surface, borderColor: '#d1d5db' }]} activeOpacity={0.8} onPress={() => setAppState('inventory')}>
            <FontAwesome5 name="boxes" size={28} color="#6b7280" solid />
            <View style={s.cardText}>
              <Text style={[s.cardTitle, { color: text }]}>Hàng hoá</Text>
              <Text style={[s.cardDesc, { color: sub }]}>Quản lý sản phẩm, giá bán, nhập hàng</Text>
            </View>
            <FontAwesome5 name="chevron-right" size={14} color={sub} solid />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  themeToggle: { position: 'absolute', top: 56, right: 20, zIndex: 10, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  brand: { fontSize: 28, fontWeight: '800', marginTop: 12 },
  sub: { fontSize: 15, marginBottom: 8 },
  card: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 16, borderWidth: 1 },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700' },
  cardDesc:  { fontSize: 13, marginTop: 2 },
})
