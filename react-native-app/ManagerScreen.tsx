import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, RefreshControl, ActivityIndicator,
  Modal, Platform,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import * as api from './api'

// ─── Types ──────────────────────────────────────────────────────────────────

type DateRangeKey = 'today' | 'yesterday' | '7days' | 'last-week' | '30days' | 'last-month' | 'custom'

const DATE_RANGE_PRESETS: { key: DateRangeKey; label: string }[] = [
  { key: 'today',      label: 'Hôm nay' },
  { key: 'yesterday',  label: 'Hôm qua' },
  { key: 'last-week',  label: 'Tuần trước' },
  { key: 'last-month', label: 'Tháng trước' },
  { key: 'custom',     label: 'Tùy chỉnh' },
]

// Tính from/to cho từng preset
function getPresetRange(key: DateRangeKey, todayStart: Date): { from: Date; to: Date; label: string } {
  const now = new Date()
  const startOf = (d: Date) => { const r = new Date(d); r.setHours(0,0,0,0); return r }
  const endOf   = (d: Date) => { const r = new Date(d); r.setHours(23,59,59,999); return r }
  switch (key) {
    case 'today':      return { from: todayStart, to: now, label: 'Hôm nay' }
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1)
      return { from: startOf(y), to: endOf(y), label: 'Hôm qua' }
    }
    case '7days': {
      const d = new Date(now); d.setDate(d.getDate() - 6)
      return { from: startOf(d), to: now, label: '7 ngày qua' }
    }
    case 'last-week': {
      const dow = now.getDay() === 0 ? 7 : now.getDay()
      const mon = new Date(now); mon.setDate(mon.getDate() - dow - 6)
      const sun = new Date(mon); sun.setDate(sun.getDate() + 6)
      return { from: startOf(mon), to: endOf(sun), label: 'Tuần trước' }
    }
    case '30days': {
      const d = new Date(now); d.setDate(d.getDate() - 29)
      return { from: startOf(d), to: now, label: '30 ngày qua' }
    }
    case 'last-month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last  = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: startOf(first), to: endOf(last), label: 'Tháng trước' }
    }
    default:           return { from: todayStart, to: now, label: 'Hôm nay' }
  }
}

type DashTab = 'overview' | 'revenue' | 'rooms' | 'staff'

interface KpiCard {
  icon: string; iconColor: string; bg: string
  label: string; value: string; sub: string; trend: number
}

interface HourlyBar { hour: string; value: number }
interface TopItem  { name: string; qty: number; revenue: number }
interface Transaction {
  id: string; room: string; amount: number; method: string
  cashier: string; time: string; status: 'paid' | 'open'
}
interface StaffRow {
  name: string; role: string; status: 'online' | 'offline' | 'break'
  orders: number; checkIn: string; shift: string
}

// ─── Mock data (thay bằng API sau) ──────────────────────────────────────────

const TODAY_KPI: KpiCard[] = [
  { icon: 'money-bill-wave', iconColor: '#34d399', bg: '#064e3b', label: 'Doanh thu hôm nay', value: '18.450.000đ', sub: 'vs hôm qua: 16.200.000đ', trend: 13.9 },
  { icon: 'door-open',       iconColor: '#60a5fa', bg: '#1e3a5f', label: 'Phòng đang hoạt động', value: '5 / 9',    sub: '3 trống · 1 đang dọn',  trend: 0 },
  { icon: 'receipt',         iconColor: '#fbbf24', bg: '#451a03', label: 'Hóa đơn đã thanh toán', value: '24',      sub: '2 đang mở',              trend: 4 },
  { icon: 'users',           iconColor: '#a78bfa', bg: '#2e1065', label: 'Nhân viên online', value: '6',            sub: 'Phục vụ: 4 · Thu ngân: 2', trend: 0 },
]

const HOURLY: HourlyBar[] = [
  { hour: '08h', value: 0.05 }, { hour: '09h', value: 0.10 }, { hour: '10h', value: 0.22 },
  { hour: '11h', value: 0.48 }, { hour: '12h', value: 0.65 }, { hour: '13h', value: 0.55 },
  { hour: '14h', value: 0.42 }, { hour: '15h', value: 0.38 }, { hour: '16h', value: 0.50 },
  { hour: '17h', value: 0.72 }, { hour: '18h', value: 0.85 }, { hour: '19h', value: 1.00 },
  { hour: '20h', value: 0.92 }, { hour: '21h', value: 0.70 }, { hour: '22h', value: 0.45 },
]

const TOP_ITEMS: TopItem[] = [
  { name: 'Combo trái cây lớn', qty: 18, revenue: 3960000 },
  { name: '2 bia + 1 nước suối', qty: 32, revenue: 4640000 },
  { name: 'Tiger bạc', qty: 80, revenue: 2800000 },
  { name: 'Mực nướng sa tế', qty: 9, revenue: 1620000 },
  { name: 'Lạp xưởng nướng', qty: 12, revenue: 1140000 },
]

const TRANSACTIONS: Transaction[] = [
  { id: 'HD001', room: 'VIP 01', amount: 1850000, method: 'Chuyển khoản', cashier: 'Hà Linh', time: '21:14', status: 'paid' },
  { id: 'HD002', room: 'P.201',  amount: 2140000, method: 'Tiền mặt',     cashier: 'Hà Linh', time: '20:42', status: 'paid' },
  { id: 'HD003', room: 'VIP 02', amount: 3200000, method: '',              cashier: 'Hà Linh', time: '20:00', status: 'open' },
  { id: 'HD004', room: 'P.108',  amount: 980000,  method: 'Thẻ',          cashier: 'Hà Linh', time: '19:35', status: 'paid' },
  { id: 'HD005', room: 'P.204',  amount: 1560000, method: '',              cashier: 'Minh Thu', time: '19:00', status: 'open' },
  { id: 'HD006', room: 'P.305',  amount: 760000,  method: 'Tiền mặt',     cashier: 'Minh Thu', time: '18:15', status: 'paid' },
]

const STAFF: StaffRow[] = [
  { name: 'Nguyễn Văn A', role: 'Phục vụ',  status: 'online',  orders: 14, checkIn: '08:00', shift: 'S' },
  { name: 'Trần Thị B',   role: 'Phục vụ',  status: 'online',  orders: 11, checkIn: '08:00', shift: 'S' },
  { name: 'Lê Văn C',     role: 'Phục vụ',  status: 'break',   orders: 8,  checkIn: '08:00', shift: 'S' },
  { name: 'Phạm Thị D',   role: 'Phục vụ',  status: 'online',  orders: 9,  checkIn: '14:00', shift: 'C' },
  { name: 'Hà Linh',      role: 'Thu ngân', status: 'online',  orders: 0,  checkIn: '08:00', shift: 'S' },
  { name: 'Minh Thu',     role: 'Thu ngân', status: 'online',  orders: 0,  checkIn: '14:00', shift: 'C' },
  { name: 'Hoàng Văn E',  role: 'Phục vụ',  status: 'offline', orders: 0,  checkIn: '--:--', shift: 'T' },
]

const WEEK_REVENUE = [12400000, 18200000, 15800000, 21000000, 16500000, 19800000, 18450000]
const WEEK_DAYS    = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

interface RoomLive {
  name: string; type: 'VIP' | 'Standard'; status: 'occupied' | 'available' | 'cleaning'
  revenue: number; time: string
}
const ALL_ROOMS: RoomLive[] = [
  { name: 'VIP 01', type: 'VIP',      status: 'occupied',  revenue: 3200000, time: '02:14' },
  { name: 'VIP 02', type: 'VIP',      status: 'occupied',  revenue: 2140000, time: '01:05' },
  { name: 'P.201',  type: 'Standard', status: 'occupied',  revenue: 1850000, time: '01:28' },
  { name: 'P.204',  type: 'Standard', status: 'occupied',  revenue: 980000,  time: '00:43' },
  { name: 'P.108',  type: 'Standard', status: 'occupied',  revenue: 560000,  time: '00:22' },
  { name: 'P.301',  type: 'Standard', status: 'available', revenue: 0,       time: '' },
  { name: 'P.302',  type: 'Standard', status: 'available', revenue: 0,       time: '' },
  { name: 'P.303',  type: 'Standard', status: 'available', revenue: 0,       time: '' },
  { name: 'VIP 03', type: 'VIP',      status: 'cleaning',  revenue: 0,       time: '' },
]

const fmtVnd  = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'K'
const fmtFull = (n: number) => n.toLocaleString('vi-VN') + 'đ'

const statusColor = (s: StaffRow['status']) => s === 'online' ? '#34d399' : s === 'break' ? '#fbbf24' : '#6b7280'
const statusLabel = (s: StaffRow['status']) => s === 'online' ? 'Online' : s === 'break' ? 'Nghỉ giải lao' : 'Offline'

// ─── Manager Screen ──────────────────────────────────────────────────────────

export default function ManagerScreen({ onBack }: { onBack: () => void }) {
  const { colors: c, mode, toggle } = useTheme()
  const s = useMemo(() => makeStyles(c), [c])
  const [tab, setTab] = useState<DashTab>('overview')
  const [dateRange, setDateRange] = useState<DateRangeKey>('today')
  const [customFromDate, setCustomFromDate] = useState<Date>(new Date())
  const [customToDate, setCustomToDate]     = useState<Date>(new Date())
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker]     = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [timeStr, setTimeStr] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // ── Real data state ──────────────────────────────────────────────────────
  const [liveOrders, setLiveOrders] = useState<api.SaleOrder[]>([])
  const [liveRoomsData, setLiveRoomsData] = useState<api.Room[]>([])
  const [liveUsersData, setLiveUsersData] = useState<Array<{ id: string; username: string; fullName?: string }>>([])
  const [dataLoaded, setDataLoaded] = useState(false)

  // ── Derived KPI values ───────────────────────────────────────────────────
  // Ngày kinh doanh tính từ 12:00 trưa → 12:00 trưa hôm sau
  const todayStart = useMemo(() => {
    const now = new Date()
    const d = new Date(now)
    d.setHours(12, 0, 0, 0)
    // Nếu hiện tại trước 12h trưa → ngày kinh doanh bắt đầu từ hôm qua 12h
    if (now.getHours() < 12) d.setDate(d.getDate() - 1)
    return d
  }, [dataLoaded]) // eslint-disable-line

  // old app: pending = đang mở, completed = đã thanh toán
  const todayOrders = liveOrders.filter(o => o.status === 'completed' && new Date(o.updatedAt) >= todayStart)
  const todayRevenue = todayOrders.reduce((s, o) => s + (o.paidAmount || o.total || 0), 0)
  const occupiedRooms = liveRoomsData.filter(r => r.status === 'occupied')
  const openOrders = liveOrders.filter(o => o.status === 'pending')  // pending = đang mở

  // Range orders theo dateRange selector (tab Doanh thu)
  const { from: rangeStart, to: rangeEnd, label: rangeLabel } = useMemo(() => {
    if (dateRange === 'custom') {
      const from = new Date(customFromDate)
      from.setHours(0, 0, 0, 0)
      const to = new Date(customToDate)
      to.setHours(23, 59, 59, 999)
      const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
      return { from, to, label: `${fmt(from)} – ${fmt(to)}` }
    }
    return getPresetRange(dateRange, todayStart)
  }, [dateRange, customFromDate, customToDate, todayStart])

  const rangeOrders = useMemo(() =>
    liveOrders.filter(o => {
      if (o.status !== 'completed') return false
      const t = new Date(o.updatedAt)
      return t >= rangeStart && t <= rangeEnd
    })
  , [liveOrders, rangeStart, rangeEnd])
  const rangeRevenue = rangeOrders.reduce((s, o) => s + (o.paidAmount || o.total || 0), 0)

  const loadData = async () => {
    try {
      const sixtyDaysAgo = new Date()
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
      const [rooms, orders, users] = await Promise.all([
        api.getRooms(),
        api.getSaleOrders({
          where: { updatedAt: { gte: sixtyDaysAgo.toISOString() } },
          order: 'updatedAt DESC',
          limit: 1000,
        }),
        api.getUsers(),
      ])
      setLiveRoomsData(rooms)
      setLiveOrders(orders)
      setLiveUsersData(users)
      setDataLoaded(true)
    } catch (err) {
      console.error('ManagerScreen loadData error:', err)
    }
  }

  useEffect(() => { loadData() }, [])
  const screenW = Dimensions.get('window').width
  const barMaxH = 80
  const weekMax  = Math.max(...WEEK_REVENUE)

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTimeStr(
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
        + ` — ${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const onRefresh = () => {
    setRefreshing(true)
    loadData().finally(() => setRefreshing(false))
  }

  const Ico = ({ name, size = 14, color = '#9ca3af' }: { name: any; size?: number; color?: string }) =>
    <FontAwesome5 name={name} size={size} color={color} solid />

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const KpiCards = () => {
    const cards: KpiCard[] = [
      {
        icon: 'money-bill-wave', iconColor: '#34d399', bg: '#064e3b',
        label: 'Doanh thu hôm nay',
        value: dataLoaded ? todayRevenue.toLocaleString('vi-VN') + 'đ' : TODAY_KPI[0].value,
        sub: `${todayOrders.length} hóa đơn đã thanh toán`,
        trend: 0,
      },
      {
        icon: 'door-open', iconColor: '#60a5fa', bg: '#1e3a5f',
        label: 'Phòng đang hoạt động',
        value: dataLoaded ? `${occupiedRooms.length} / ${liveRoomsData.length}` : TODAY_KPI[1].value,
        sub: `${liveRoomsData.filter(r => r.status === 'available').length} trống · ${liveRoomsData.filter(r => r.status === 'cleaning').length} đang dọn`,
        trend: 0,
      },
      {
        icon: 'receipt', iconColor: '#fbbf24', bg: '#451a03',
        label: 'Hóa đơn đã thanh toán',
        value: dataLoaded ? String(todayOrders.length) : TODAY_KPI[2].value,
        sub: `${openOrders.length} đang mở`,
        trend: 0,
      },
      {
        icon: 'users', iconColor: '#a78bfa', bg: '#2e1065',
        label: 'Nhân viên hệ thống',
        value: dataLoaded ? String(liveUsersData.length) : TODAY_KPI[3].value,
        sub: 'Tổng tài khoản',
        trend: 0,
      },
    ]
    return (
      <View style={s.kpiGrid}>
        {cards.map((k, i) => (
          <View key={i} style={[s.kpiCard, { backgroundColor: k.bg }]}>
            <View style={s.kpiTop}>
              <Ico name={k.icon} size={20} color={k.iconColor} />
              {k.trend !== 0 && (
                <View style={[s.badge, { backgroundColor: k.trend > 0 ? '#14532d' : '#7f1d1d' }]}>
                  <Ico name={k.trend > 0 ? 'arrow-up' : 'arrow-down'} size={8} color={k.trend > 0 ? '#4ade80' : '#f87171'} />
                  <Text style={[s.badgeText, { color: k.trend > 0 ? '#4ade80' : '#f87171' }]}> {Math.abs(k.trend)}%</Text>
                </View>
              )}
            </View>
            <Text style={s.kpiVal}>{k.value}</Text>
            <Text style={s.kpiLabel}>{k.label}</Text>
            <Text style={s.kpiSub}>{k.sub}</Text>
          </View>
        ))}
      </View>
    )
  }

  // ── Hourly bar chart ────────────────────────────────────────────────────────
  const HourlyChart = () => {
    // Group today's completed orders by hour
    const hourlyMap: Record<number, number> = {}
    todayOrders.forEach(o => {
      const h = new Date(o.updatedAt).getHours()
      hourlyMap[h] = (hourlyMap[h] || 0) + (o.paidAmount || o.total || 0)
    })
    // Hiển thị 12h→23h (buổi tối) rồi 0h→11h (sáng hôm sau)
    const hours = [...Array.from({ length: 12 }, (_, i) => i + 12), ...Array.from({ length: 12 }, (_, i) => i)]
    const maxVal = Math.max(...hours.map(h => hourlyMap[h] || 0), 1)
    const bars: HourlyBar[] = hours.map(h => ({
      hour: h === 12 ? '12h' : h === 0 ? '0h' : `${String(h).padStart(2, '0')}h`,
      value: (hourlyMap[h] || 0) / maxVal,
    }))
    const data = dataLoaded && todayOrders.length > 0 ? bars : HOURLY
    const startLabel = (() => { const d = new Date(todayStart); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} 12:00` })()
    return (
      <View style={s.chartBox}>
        <Text style={s.sectionTitle}>Doanh thu theo giờ · từ {startLabel}</Text>
        <View style={s.chartRow}>
          {data.map((h, i) => {
            const h2 = barMaxH * h.value
            return (
              <View key={h.hour} style={s.barWrap}>
                <View style={[s.barFill, {
                  height: h2 || 2,
                  backgroundColor: h.value > 0.8 ? '#7c3aed' : h.value > 0.5 ? '#6d28d9' : (mode === 'dark' ? '#1e3a5f' : '#c4b5fd'),
                }]} />
                <Text style={s.barLabel}>{h.hour}</Text>
              </View>
            )
          })}
        </View>
      </View>
    )
  }

  // ── Doanh thu chart (theo range) ─────────────────────────────────────────
  const DayRangeChart = () => {
    const diffMs = rangeEnd.getTime() - rangeStart.getTime()
    const nDays = Math.max(2, Math.min(60, Math.ceil(diffMs / 86400000) + 1))
    const dayMap: Record<string, number> = {}
    rangeOrders.forEach(o => {
      const d = new Date(o.updatedAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      dayMap[key] = (dayMap[key] || 0) + (o.paidAmount || o.total || 0)
    })
    const days = Array.from({ length: nDays }, (_, i) => {
      const d = new Date(rangeStart); d.setDate(d.getDate() + i)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const labels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
      return { rev: dayMap[key] ?? 0, label: nDays <= 7 ? labels[d.getDay()] : `${d.getDate()}/${d.getMonth()+1}` }
    })
    const revData = dataLoaded ? days.map(d => d.rev) : WEEK_REVENUE
    const labData = dataLoaded ? days.map(d => d.label) : WEEK_DAYS
    const wMax = Math.max(...revData, 1)
    return (
      <View style={s.chartBox}>
        <Text style={s.sectionTitle}>Doanh thu · {rangeLabel}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[s.chartRow, { width: Math.max(revData.length * 32, screenW - 44) }]}>
            {revData.map((rev, i) => {
              const h = (rev / wMax) * barMaxH
              const isLast = i === revData.length - 1
              return (
                <View key={i} style={s.barWrap}>
                  <Text style={[s.barTopLabel, isLast && { color: '#4ade80' }]}>{rev > 0 ? fmtVnd(rev) : ''}</Text>
                  <View style={[s.barFill, {
                    height: h || 2,
                    backgroundColor: isLast ? '#16a34a' : (mode === 'dark' ? '#1e3a5f' : '#c4b5fd'),
                  }]} />
                  <Text style={[s.barLabel, isLast && { color: '#4ade80', fontWeight: '700' }]}>{labData[i]}</Text>
                </View>
              )
            })}
          </View>
        </ScrollView>
      </View>
    )
  }

  // ── Range summary card (for revenue tab) ────────────────────────────────
  const RangeSummaryCard = () => (
    <View style={[s.heroCard, { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.heroSmLabel}>Doanh thu · {rangeLabel}</Text>
        <Text style={[s.heroRevVal, { fontSize: 24 }]}>
          {dataLoaded ? rangeRevenue.toLocaleString('vi-VN') + 'đ' : '...'}
        </Text>
        <Text style={s.heroCompare}>{rangeOrders.length} hóa đơn đã thanh toán</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={s.heroSmLabel}>Trung bình / đơn</Text>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#60a5fa' }}>
          {rangeOrders.length > 0 ? Math.round(rangeRevenue / rangeOrders.length).toLocaleString('vi-VN') + 'đ' : '--'}
        </Text>
      </View>
    </View>
  )

  // ── Top items ───────────────────────────────────────────────────────────────
  const TopItems = () => (
    <View style={s.tableBox}>
      <Text style={s.sectionTitle}>Top món bán chạy hôm nay</Text>
      {TOP_ITEMS.length > 0 ? TOP_ITEMS.map((item, i) => (
        <View key={i} style={s.tableRow}>
          <View style={[s.rank, { backgroundColor: i < 3 ? '#7c3aed' : '#374151' }]}>
            <Text style={s.rankText}>{i + 1}</Text>
          </View>
          <Text style={s.tableItemName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.tableQty}>×{item.qty}</Text>
          <Text style={s.tableRevenue}>{fmtVnd(item.revenue)}</Text>
        </View>
      )) : (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <FontAwesome5 name="box-open" size={28} color={c.textMuted} />
          <Text style={[s.kpiSub, { marginTop: 8, textAlign: 'center' }]}>Chưa có dữ liệu đơn hàng</Text>
        </View>
      )}
    </View>
  )

  // ── Revenue breakdown ───────────────────────────────────────────────────────
  const RevenueBreakdown = () => {
    const txList = dataLoaded ? rangeOrders : TRANSACTIONS.map(t => ({
      paidAmount: t.amount, total: t.amount, paymentMethod: t.method, status: 'completed',
    } as any))
    const totalPaid = txList.reduce((s: number, t: any) => s + (t.paidAmount || t.total || 0), 0)
    const byMethod = (method: string) => txList.filter((t: any) =>
      (t.paymentMethod ?? '') === method
    ).reduce((s: number, t: any) => s + (t.paidAmount || t.total || 0), 0)
    const cash = byMethod('Tiền mặt')
    const transfer = byMethod('Chuyển khoản')
    const card = byMethod('Thẻ')
    const breakdown = [
      { label: 'Tiền mặt', val: cash, color: '#34d399', pct: totalPaid ? cash / totalPaid : 0 },
      { label: 'Chuyển khoản', val: transfer, color: '#60a5fa', pct: totalPaid ? transfer / totalPaid : 0 },
      { label: 'Thẻ', val: card, color: '#fbbf24', pct: totalPaid ? card / totalPaid : 0 },
    ]
    return (
      <View style={s.tableBox}>
        <Text style={s.sectionTitle}>Phân bổ phương thức thanh toán</Text>
        <View style={s.breakdownBarWrap}>
          {breakdown.map((b, i) => (
            <View key={i} style={[s.breakdownSeg, { flex: b.pct || 0.001, backgroundColor: b.color }]} />
          ))}
        </View>
        {breakdown.map((b, i) => (
          <View key={i} style={s.breakdownRow}>
            <View style={[s.dot, { backgroundColor: b.color }]} />
            <Text style={s.breakdownLabel}>{b.label}</Text>
            <Text style={s.breakdownPct}>{(b.pct * 100).toFixed(0)}%</Text>
            <Text style={s.breakdownVal}>{fmtFull(b.val)}</Text>
          </View>
        ))}
        <View style={[s.breakdownRow, { marginTop: 6, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6 }]}>
          <View style={[s.dot, { backgroundColor: '#16a34a' }]} />
          <Text style={[s.breakdownLabel, { fontWeight: '700', color: c.text }]}>Tổng đã thu</Text>
          <Text style={s.breakdownPct}></Text>
          <Text style={[s.breakdownVal, { color: '#4ade80', fontSize: 15 }]}>{fmtFull(totalPaid)}</Text>
        </View>
      </View>
    )
  }

  // ── Recent transactions ─────────────────────────────────────────────────────
  const RecentTx = () => {
    const txList: Transaction[] = dataLoaded
      ? rangeOrders.slice(0, 15).map(o => {
          const d = new Date(o.updatedAt)
          return {
            id: o.code,
            room: o.room?.name ?? o.roomId,
            amount: o.paidAmount || o.total || 0,
            method: o.paymentMethod ?? '',
            cashier: '',
            time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
            // old app: pending=đang mở, completed=đã TT
            status: o.status === 'completed' ? 'paid' : 'open',
          } as Transaction
        })
      : TRANSACTIONS
    return (
      <View style={s.tableBox}>
        <Text style={s.sectionTitle}>Giao dịch gần nhất</Text>
        {txList.map((tx, i) => (
          <View key={i} style={[s.txRow, i % 2 === 1 && s.txRowAlt]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.txId}>{tx.id}</Text>
                <View style={[s.txBadge, { backgroundColor: tx.status === 'paid' ? (mode === 'dark' ? '#14532d' : '#dcfce7') : (mode === 'dark' ? '#451a03' : '#fef3c7') }]}>
                  <Text style={{ color: tx.status === 'paid' ? (mode === 'dark' ? '#4ade80' : '#15803d') : (mode === 'dark' ? '#fbbf24' : '#d97706'), fontSize: 10 }}>
                    {tx.status === 'paid' ? 'Đã TT' : 'Đang mở'}
                  </Text>
                </View>
              </View>
              <Text style={s.txSub}>{tx.room} · {tx.time}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[s.txAmount, tx.status === 'open' && { color: '#fbbf24' }]}>{fmtFull(tx.amount)}</Text>
              {tx.method ? <Text style={s.txMethod}>{tx.method}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    )
  }

  // ── Room occupancy ──────────────────────────────────────────────────────────
  const RoomsPanel = () => {
    const roomsData = dataLoaded ? liveRoomsData : ALL_ROOMS.map(r => ({
      id: r.name, name: r.name, status: r.status, type: r.type,
      isActive: true, code: '', saleOrderId: null, startTime: null, customerInfo: null,
    } as api.Room))
    const occupied  = roomsData.filter(r => r.status === 'occupied').length
    const available = roomsData.filter(r => r.status === 'available').length
    const cleaning  = roomsData.filter(r => r.status !== 'occupied' && r.status !== 'available').length
    const total = roomsData.length
    const stats = [
      { label: 'Đang hoạt động', count: occupied,  color: '#7c3aed', pct: total ? occupied / total : 0 },
      { label: 'Trống',          count: available, color: '#16a34a', pct: total ? available / total : 0 },
      { label: 'Đang dọn',       count: cleaning,  color: '#d97706', pct: total ? cleaning / total : 0 },
    ]
    return (
      <>
        <View style={s.tableBox}>
          <Text style={s.sectionTitle}>Tổng quan phòng ({total} phòng)</Text>
          <View style={s.occBarWrap}>
            {stats.map((st, i) => (
              <View key={i} style={[s.occSeg, { flex: st.pct || 0.001, backgroundColor: st.color }]} />
            ))}
          </View>
          {stats.map((st, i) => (
            <View key={i} style={s.breakdownRow}>
              <View style={[s.dot, { backgroundColor: st.color }]} />
              <Text style={s.breakdownLabel}>{st.label}</Text>
              <Text style={[s.breakdownVal, { color: st.color }]}>{st.count} phòng</Text>
            </View>
          ))}
        </View>

        <View style={s.tableBox}>
          <Text style={s.sectionTitle}>Danh sách phòng</Text>
          {roomsData.map((r, i) => {
            const col = r.status === 'occupied' ? '#7c3aed' : r.status === 'available' ? '#16a34a' : '#d97706'
            const label = r.status === 'occupied' ? 'Đang hát' : r.status === 'available' ? 'Trống' : 'Đang dọn'
            return (
              <View key={i} style={s.tableRow}>
                <View style={[s.rank, { backgroundColor: r.type === 'vip' || r.type === 'VIP' ? '#7c3aed' : '#1e3a5f', minWidth: 40 }]}>
                  <Text style={[s.rankText, { fontSize: 9 }]}>{r.type?.toUpperCase().slice(0, 3) ?? 'STD'}</Text>
                </View>
                <Text style={[s.tableItemName, { flex: 1.2 }]}>{r.name}</Text>
                <Text style={[s.tableQty, { color: col, fontSize: 11, minWidth: 60 }]}>{label}</Text>
              </View>
            )
          })}
        </View>
      </>
    )
  }

  // ── Staff panel ─────────────────────────────────────────────────────────────
  const StaffPanel = () => {
    const staffData: StaffRow[] = dataLoaded && liveUsersData.length > 0
      ? liveUsersData.map(u => ({
          name: u.fullName ?? u.username,
          role: u.role ?? 'Nhân viên',
          status: 'online' as const,
          orders: 0,
          checkIn: '--:--',
          shift: 'S',
        }))
      : STAFF
    const online  = staffData.filter(s => s.status === 'online').length
    const onBreak = staffData.filter(s => s.status === 'break').length
    const offline = staffData.filter(s => s.status === 'offline').length
    return (
      <>
        <View style={s.kpiGrid}>
          {[
            { label: 'Online', val: online,  color: '#16a34a', darkBg: '#064e3b', lightBg: '#f0fdf4' },
            { label: 'Nghỉ',   val: onBreak, color: '#d97706', darkBg: '#451a03', lightBg: '#fffbeb' },
            { label: 'Offline', val: offline, color: '#6b7280', darkBg: '#374151', lightBg: c.elevated },
          ].map((item, i) => (
            <View key={i} style={[s.miniKpi, { backgroundColor: mode === 'dark' ? item.darkBg : item.lightBg, borderColor: item.color }]}>
              <Text style={[s.miniKpiVal, { color: item.color }]}>{item.val}</Text>
              <Text style={s.miniKpiLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.tableBox}>
          <Text style={s.sectionTitle}>Danh sách nhân viên</Text>
          {staffData.map((staff, i) => (
            <View key={i} style={[s.txRow, i % 2 === 1 && s.txRowAlt, staff.status === 'offline' && { opacity: 0.45 }]}>
              <View style={[s.avatar, { backgroundColor: staff.role === 'Thu ngân' ? (mode === 'dark' ? '#2e1065' : '#ede9fe') : (mode === 'dark' ? '#1e3a5f' : '#dbeafe') }]}>
                <Text style={s.avatarText}>{staff.name.split(' ').pop()?.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.staffName}>{staff.name}</Text>
                <Text style={s.staffMeta}>{staff.role} · Ca {staff.shift} · Vào: {staff.checkIn}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={[s.statusDot, { backgroundColor: statusColor(staff.status) }]} />
                  <Text style={[s.statusText, { color: statusColor(staff.status) }]}>{statusLabel(staff.status)}</Text>
                </View>
                {staff.orders > 0 && <Text style={s.orderCount}>{staff.orders} đơn</Text>}
              </View>
            </View>
          ))}
        </View>
      </>
    )
  }

  // ── Overview: Revenue Hero ─────────────────────────────────────────────────
  const RevenueHero = () => {
    const rev = dataLoaded ? todayRevenue : 18450000
    const estimated = Math.round(rev * 0.68)
    return (
      <View style={s.heroCard}>
        <View style={s.heroRow}>
          <View style={s.heroSide}>
            <Text style={s.heroSmLabel}>Doanh thu hôm nay</Text>
            <Text style={s.heroRevVal}>{rev.toLocaleString('vi-VN')}đ</Text>
            {!dataLoaded && (
              <View style={s.heroTrendBadge}>
                <FontAwesome5 name="spinner" size={9} color="#9ca3af" solid />
                <Text style={[s.heroTrendText, { color: '#9ca3af' }]}> Đang tải...</Text>
              </View>
            )}
            <Text style={s.heroCompare}>{todayOrders.length} đơn đã thanh toán hôm nay</Text>
          </View>
          <View style={s.heroDivider} />
          <View style={s.heroSide}>
            <Text style={s.heroSmLabel}>Lợi nhuận ước tính</Text>
            <Text style={s.heroProfitVal}>~{estimated.toLocaleString('vi-VN')}đ</Text>
            <View style={s.heroProfitBadge}>
              <Text style={s.heroProfitBadgeText}>Biên 68%</Text>
            </View>
            <Text style={s.heroCompare}>Sau chi phí cố định</Text>
          </View>
        </View>
      </View>
    )
  }

  // ── Overview: Stat chips ───────────────────────────────────────────────────
  const OverviewStats = () => {
    const chips = [
      { icon: 'door-open',    color: '#7c3aed', val: dataLoaded ? `${occupiedRooms.length} / ${liveRoomsData.length}` : '5 / 9', label: 'Phòng mở' },
      { icon: 'receipt',      color: '#ea580c', val: dataLoaded ? String(todayOrders.length) : '24', label: 'HĐ hôm nay' },
      { icon: 'user-friends', color: '#0284c7', val: dataLoaded ? String(liveUsersData.length) : '6', label: 'Tài khoản NV' },
    ] as const
    return (
      <View style={s.statRow}>
        {chips.map((chip, i) => (
          <View key={i} style={s.statChip}>
            <FontAwesome5 name={chip.icon as any} size={18} color={chip.color} solid />
            <View>
              <Text style={s.statChipVal}>{chip.val}</Text>
              <Text style={s.statChipLabel}>{chip.label}</Text>
            </View>
          </View>
        ))}
      </View>
    )
  }

  // ── Overview: Live rooms ───────────────────────────────────────────────────
  const OverviewRooms = () => {
    const roomsData = dataLoaded ? liveRoomsData : ALL_ROOMS.map(r => ({
      id: r.name, name: r.name, status: r.status, type: r.type,
      isActive: true, code: '', saleOrderId: null, startTime: null, customerInfo: null,
    } as api.Room))
    const occupied = roomsData.filter(r => r.status === 'occupied')
    const others   = roomsData.filter(r => r.status !== 'occupied')
    const totalLive = dataLoaded
      ? liveOrders.filter(o => o.status === 'pending').reduce((s, o) => s + (o.total || 0), 0)
      : ALL_ROOMS.filter(r => r.status === 'occupied').reduce((s, r) => s + r.revenue, 0)
    return (
      <>
        <View style={s.ovSectionHeader}>
          <Text style={s.ovSectionTitle}>Phòng đang mở ({occupied.length})</Text>
          <Text style={[s.ovSectionTitle, { color: '#2563eb' }]}>{fmtFull(totalLive)}</Text>
        </View>
        {occupied.map((r, i) => {
          const order = liveOrders.find(o => o.roomId === r.id && o.status === 'pending')
          const timeStr2 = order?.createdAt
            ? (() => {
                const diff = Date.now() - new Date(order.createdAt).getTime()
                const h = Math.floor(diff / 3600000)
                const m = Math.floor((diff % 3600000) / 60000)
                return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
              })()
            : '--:--'
          const rev = order ? (order.total || 0) : 0
          const isVip = r.type === 'vip' || r.type === 'VIP'
          return (
            <View key={i} style={[s.ovRoomCard, isVip && { borderLeftWidth: 3, borderLeftColor: '#7c3aed' }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <Text style={s.ovRoomName}>{r.name}</Text>
                  <View style={[s.roomTypeBadge, { backgroundColor: isVip ? '#f5f3ff' : '#eff6ff' }]}>
                    <Text style={[s.roomTypeText, { color: isVip ? '#7c3aed' : '#2563eb' }]}>{r.type?.toUpperCase().slice(0,3)}</Text>
                  </View>
                </View>
                <Text style={s.ovRoomMeta}><Ico name="clock" size={10} color={c.textMuted} />{'  '}{timeStr2} đã mở</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={s.ovRoomAmount}>{fmtFull(rev)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <View style={[s.liveDot, { width: 6, height: 6 }]} />
                  <Text style={{ fontSize: 10, color: '#ef4444', fontWeight: '700' }}>LIVE</Text>
                </View>
              </View>
            </View>
          )
        })}
        <View style={[s.ovSectionHeader, { marginTop: 4 }]}>
          <Text style={s.ovSectionTitle}>Phòng khác ({others.length})</Text>
        </View>
        {others.map((r, i) => {
          const isVip = r.type === 'vip' || r.type === 'VIP'
          return (
            <View key={i} style={s.ovRoomCardOther}>
              <FontAwesome5
                name={r.status === 'available' ? 'check-circle' : 'broom'}
                size={14} color={r.status === 'available' ? '#16a34a' : '#d97706'} solid
              />
              <Text style={s.ovRoomName}>{r.name}</Text>
              <View style={[s.roomTypeBadge, { backgroundColor: isVip ? '#f5f3ff' : c.elevated, marginLeft: 4 }]}>
                <Text style={[s.roomTypeText, { color: isVip ? '#7c3aed' : c.textMuted }]}>{r.type?.toUpperCase().slice(0,3) ?? 'STD'}</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: r.status === 'available' ? '#16a34a' : '#d97706' }}>
                {r.status === 'available' ? 'Trống' : 'Đang dọn'}
              </Text>
            </View>
          )
        })}
        <View style={{ height: 8 }} />
      </>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  const tabs: { key: DashTab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Tổng quan', icon: 'chart-line' },
    { key: 'revenue',  label: 'Doanh thu', icon: 'coins' },
    { key: 'rooms',    label: 'Phòng',     icon: 'door-open' },
    { key: 'staff',    label: 'Nhân viên', icon: 'users' },
  ]

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.headerLeft}>
          <FontAwesome5 name="arrow-left" size={13} color={c.textMuted} solid />
          <FontAwesome5 name="crown" size={18} color="#fbbf24" solid />
          <View>
            <Text style={s.headerTitle}>Quản lý & CEO</Text>
            <Text style={s.headerClock}>{timeStr}</Text>
          </View>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={toggle} style={{ padding: 6 }}>
            <FontAwesome5 name={mode === 'dark' ? 'sun' : 'moon'} size={14} color="#fbbf24" solid />
          </TouchableOpacity>
          <View style={[s.liveTag]}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>LIVE</Text>
          </View>
        </View>
      </View>

      {/* ── Tab bar ── */}
      <View style={s.tabBar}>
        {tabs.map(t => (
          <TouchableOpacity key={t.key} style={[s.tabItem, tab === t.key && s.tabItemActive]} onPress={() => setTab(t.key)}>
            <Ico name={t.icon} size={13} color={tab === t.key ? '#fbbf24' : '#6b7280'} />
            <Text style={[s.tabText, tab === t.key && { color: '#fbbf24' }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Content ── */}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
      >
        {/* Overview tab */}
        {tab === 'overview' && <>
          <RevenueHero />
          <OverviewStats />
          <OverviewRooms />
        </>}

        {/* Revenue tab */}
        {tab === 'revenue' && <>
          {/* Date range selector */}
          <View style={s.dateRangeRow}>
            {DATE_RANGE_PRESETS.filter(p => p.key !== 'custom').map(p => (
              <TouchableOpacity
                key={p.key}
                style={[s.drBtn, dateRange === p.key && s.drBtnActive]}
                onPress={() => setDateRange(p.key)}
              >
                <Text style={[s.drBtnText, dateRange === p.key && { color: '#fbbf24' }]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.drBtn, dateRange === 'custom' && s.drBtnActive, { flexDirection: 'row', gap: 4 }]}
              onPress={() => { setShowCustomModal(true); setShowFromPicker(false); setShowToPicker(false) }}
            >
              <FontAwesome5 name="calendar-alt" size={11} color={dateRange === 'custom' ? '#fbbf24' : '#6b7280'} solid />
              <Text style={[s.drBtnText, dateRange === 'custom' && { color: '#fbbf24' }]}>
                {dateRange === 'custom' ? (() => { const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; return `${fmt(customFromDate)}–${fmt(customToDate)}` })() : 'Tùy chỉnh'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Custom date range modal */}
          <Modal visible={showCustomModal} transparent animationType="fade" onRequestClose={() => setShowCustomModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 20, width: 340, gap: 14 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Chọn khoảng thời gian</Text>

                {/* Từ ngày */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: c.textMuted, fontSize: 12 }}>Từ ngày</Text>
                  <TouchableOpacity
                    onPress={() => { setShowFromPicker(true); setShowToPicker(false) }}
                    style={{ backgroundColor: c.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: showFromPicker ? '#fbbf24' : c.border }}
                  >
                    <Text style={{ color: c.text, fontSize: 15 }}>
                      {`${String(customFromDate.getDate()).padStart(2,'0')}/${String(customFromDate.getMonth()+1).padStart(2,'0')}/${customFromDate.getFullYear()}`}
                    </Text>
                  </TouchableOpacity>
                  {showFromPicker && (
                    <DateTimePicker
                      value={customFromDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      maximumDate={customToDate}
                      onChange={(_, d) => { setShowFromPicker(false); if (d) setCustomFromDate(d) }}
                    />
                  )}
                </View>

                {/* Đến ngày */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: c.textMuted, fontSize: 12 }}>Đến ngày</Text>
                  <TouchableOpacity
                    onPress={() => { setShowToPicker(true); setShowFromPicker(false) }}
                    style={{ backgroundColor: c.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: showToPicker ? '#fbbf24' : c.border }}
                  >
                    <Text style={{ color: c.text, fontSize: 15 }}>
                      {`${String(customToDate.getDate()).padStart(2,'0')}/${String(customToDate.getMonth()+1).padStart(2,'0')}/${customToDate.getFullYear()}`}
                    </Text>
                  </TouchableOpacity>
                  {showToPicker && (
                    <DateTimePicker
                      value={customToDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      minimumDate={customFromDate}
                      onChange={(_, d) => { setShowToPicker(false); if (d) setCustomToDate(d) }}
                    />
                  )}
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: c.bg, alignItems: 'center', borderWidth: 1, borderColor: c.border }}
                    onPress={() => setShowCustomModal(false)}
                  >
                    <Text style={{ color: c.textMuted, fontWeight: '600' }}>Hủy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#451a03', alignItems: 'center', borderWidth: 1, borderColor: '#fbbf24' }}
                    onPress={() => { setDateRange('custom'); setShowCustomModal(false) }}
                  >
                    <Text style={{ color: '#fbbf24', fontWeight: '700' }}>Áp dụng</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <RangeSummaryCard />
          {dateRange === 'today' ? <HourlyChart /> : <DayRangeChart />}
          <RevenueBreakdown />
          <RecentTx />
        </>}

        {/* Rooms tab */}
        {tab === 'rooms' && <RoomsPanel />}

        {/* Staff tab */}
        {tab === 'staff' && <StaffPanel />}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const makeStyles = (c: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },

  // Header
  header: { backgroundColor: c.surface, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderFaint },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  headerClock: { color: c.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#450a0a', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#dc2626' },
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#ef4444' },
  liveText: { color: '#ef4444', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  // Tabs
  tabBar: { flexDirection: 'row', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderFaint },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 9, gap: 3 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: '#fbbf24' },
  tabText: { color: c.textFaint, fontSize: 11, fontWeight: '500' },

  // KPI cards
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 10 },
  kpiCard: { width: '46%', borderRadius: 12, padding: 12, gap: 4 },
  kpiTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  kpiVal: { color: c.text, fontSize: 20, fontWeight: '800' },
  kpiLabel: { color: c.textSub, fontSize: 12, fontWeight: '600' },
  kpiSub: { color: c.textMuted, fontSize: 11 },
  badge: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  // Mini KPI
  miniKpi: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1 },
  miniKpiVal: { fontSize: 28, fontWeight: '800' },
  miniKpiLabel: { color: c.textMuted, fontSize: 12, marginTop: 2 },

  // Charts
  chartBox: { backgroundColor: c.surface, margin: 10, marginTop: 0, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.borderFaint },
  sectionTitle: { color: c.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 },
  barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  barFill: { width: '100%', borderRadius: 3 },
  barLabel: { color: c.textFaint, fontSize: 9 },
  barTopLabel: { color: c.textMuted, fontSize: 9, marginBottom: 2 },

  // Tables
  tableBox: { backgroundColor: c.surface, margin: 10, marginTop: 0, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.borderFaint },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.borderFaint },
  rank: { borderRadius: 6, width: 26, height: 26, justifyContent: 'center', alignItems: 'center' },
  rankText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tableItemName: { flex: 1, color: c.textSub, fontSize: 13 },
  tableQty: { color: '#7c3aed', fontWeight: '700', fontSize: 13, minWidth: 28, textAlign: 'right' },
  tableRevenue: { color: '#fbbf24', fontWeight: '700', fontSize: 13, minWidth: 56, textAlign: 'right' },

  // Breakdown
  breakdownBarWrap: { flexDirection: 'row', height: 8, borderRadius: 999, overflow: 'hidden', marginBottom: 12, gap: 1 },
  breakdownSeg: { borderRadius: 0 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  breakdownLabel: { flex: 1, color: c.textSub, fontSize: 13 },
  breakdownPct: { color: c.textMuted, fontSize: 13, minWidth: 36, textAlign: 'right' },
  breakdownVal: { color: c.text, fontWeight: '700', fontSize: 13, minWidth: 90, textAlign: 'right' },

  // Occupancy bar
  occBarWrap: { flexDirection: 'row', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 12, gap: 1 },
  occSeg: {},

  // Transactions
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  txRowAlt: { backgroundColor: c.bg, borderRadius: 6 },
  txId: { color: c.text, fontWeight: '700', fontSize: 13 },
  txBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  txSub: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  txAmount: { color: '#4ade80', fontWeight: '700', fontSize: 13 },
  txMethod: { color: c.textMuted, fontSize: 11 },

  // Staff
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  staffName: { color: c.text, fontWeight: '600', fontSize: 13 },
  staffMeta: { color: c.textFaint, fontSize: 11, marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '600' },
  orderCount: { color: '#a78bfa', fontSize: 11 },

  // Date range selector
  dateRangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  drBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  drBtnActive: { backgroundColor: '#451a03', borderColor: '#fbbf24' },
  drBtnText: { color: c.textMuted, fontSize: 12, fontWeight: '600' },

  // Overview redesign
  heroCard: { margin: 12, marginBottom: 8, borderRadius: 14, padding: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  heroRow: { flexDirection: 'row', alignItems: 'stretch' },
  heroSide: { flex: 1, gap: 5 },
  heroSmLabel: { fontSize: 10, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroRevVal: { fontSize: 21, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
  heroProfitVal: { fontSize: 17, fontWeight: '700', color: '#16a34a' },
  heroDivider: { width: 1, backgroundColor: c.border, marginHorizontal: 14, alignSelf: 'stretch' },
  heroTrendBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  heroTrendText: { fontSize: 10, fontWeight: '700', color: '#15803d' },
  heroProfitBadge: { backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  heroProfitBadgeText: { fontSize: 10, fontWeight: '700', color: '#15803d' },
  heroCompare: { fontSize: 10, color: c.textFaint },
  statRow: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  statChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: c.border },
  statChipVal: { fontSize: 15, fontWeight: '800', color: c.text },
  statChipLabel: { fontSize: 10, color: c.textMuted },
  ovSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6 },
  ovSectionTitle: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  ovRoomCard: { marginHorizontal: 12, marginBottom: 7, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ovRoomCardOther: { marginHorizontal: 12, marginBottom: 6, backgroundColor: c.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ovRoomName: { fontSize: 14, fontWeight: '700', color: c.text },
  ovRoomMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  ovRoomAmount: { fontSize: 15, fontWeight: '800', color: '#2563eb' },
  roomTypeBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  roomTypeText: { fontSize: 10, fontWeight: '700' },
})
