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
import { useStore } from './StoreContext'
import * as api from './api'
import { useSocket, SocketEvent } from './useSocket'

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

type DashTab = 'overview' | 'revenue' | 'analytics' | 'staff'

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
interface ProductAnalytics {
  name: string; qty: number; revenue: number; cost: number; profit: number; margin: number
}



const fmtVnd  = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'K'
const fmtFull = (n: number) => n.toLocaleString('vi-VN') + 'đ'

const statusColor = (s: StaffRow['status']) => s === 'online' ? '#34d399' : s === 'break' ? '#fbbf24' : '#6b7280'
const statusLabel = (s: StaffRow['status']) => s === 'online' ? 'Online' : s === 'break' ? 'Nghỉ giải lao' : 'Offline'

// Tính số giờ tạm tính cho time-based item (giống CashierScreen)
const calcTimeBasedQty = (startIso: string, blockMinutes = 5): number => {
  const start = new Date(startIso)
  if (isNaN(start.getTime())) return 1
  const startMin = Math.floor(start.getTime() / 60000)
  const endMin   = Math.floor(Date.now() / 60000)
  const diffMin  = Math.max(1, endMin - startMin + 1)
  const blocks   = Math.max(1, Math.ceil(diffMin / blockMinutes))
  return Math.round((blocks * blockMinutes / 60) * 1000) / 1000
}

// ─── Manager Screen ──────────────────────────────────────────────────────────

export default function ManagerScreen({ onBack }: { onBack: () => void }) {
  const { colors: c, mode, toggle } = useTheme()
  const { selectedStore } = useStore()
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
  const [reportLoading, setReportLoading] = useState(false)
  const [openOrderItemsMap, setOpenOrderItemsMap] = useState<Record<string, api.SaleOrderItem[]>>({})
  const [liveTick, setLiveTick] = useState(0)

  // ── Real data state ──────────────────────────────────────────────────────
  const [reportData, setReportData] = useState<api.RevenueReport | null>(null)
  const [liveRoomsData, setLiveRoomsData] = useState<api.Room[]>([])
  const [liveUsersData, setLiveUsersData] = useState<Array<{ id: string; username: string; fullName?: string }>>([])
  const [dataLoaded, setDataLoaded] = useState(false)

  // Ngày kinh doanh tính từ 12:00 trưa → 12:00 trưa hôm sau
  const getTodayStart = () => {
    const now = new Date()
    const d = new Date(now)
    d.setHours(12, 0, 0, 0)
    if (now.getHours() < 12) d.setDate(d.getDate() - 1)
    return d
  }
  const todayStart = useMemo(getTodayStart, [dataLoaded]) // eslint-disable-line

  // ── Derived KPIs từ server report ───────────────────────────────────────
  const todayRevenue    = reportData?.totalRevenue ?? 0
  const todayOrderCount = reportData?.orderCount ?? 0
  const openOrderCount  = reportData?.openOrderCount ?? 0
  const rangeRevenue    = reportData?.totalRevenue ?? 0  // report = current range
  const occupiedRooms   = liveRoomsData.filter(r => r.status === 'occupied')
  const analyticsTotCost = useMemo(
    () => (reportData?.productAnalytics ?? []).reduce((s, i) => s + i.cost, 0),
    [reportData]
  )

  // rangeStart/rangeEnd/rangeLabel — vẫn cần cho chart + date picker
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

  // ── fetchReport: 1 API call → toàn bộ dữ liệu aggregated từ server ──────
  const fetchReport = async (from: Date, to?: Date, showLoading = false) => {
    if (showLoading) setReportLoading(true)
    try {
      const r = await api.getRevenueReport(from.toISOString(), to?.toISOString())
      setReportData(r)
    } catch (e) {
      console.error('fetchReport error:', e)
    } finally {
      if (showLoading) setReportLoading(false)
    }
  }

  const loadData = async () => {
    try {
      const todayS = getTodayStart()
      const [rooms, , users] = await Promise.all([
        api.getRooms(),
        fetchReport(todayS),
        api.getUsers(),
      ])
      setLiveRoomsData(rooms)
      setLiveUsersData(users)
      setDataLoaded(true)
      // Fetch items cho các phòng occupied (live revenue tiles)
      const occupied = rooms.filter(r => r.status === 'occupied' && r.saleOrderId)
      if (occupied.length > 0) {
        const itemsResults = await Promise.all(
          occupied.map(r => api.getSaleOrderItems(r.saleOrderId!).catch(() => [] as api.SaleOrderItem[]))
        )
        const itemsMap: Record<string, api.SaleOrderItem[]> = {}
        occupied.forEach((r, i) => { if (r.saleOrderId) itemsMap[r.saleOrderId] = itemsResults[i] })
        setOpenOrderItemsMap(itemsMap)
      }
    } catch (err) {
      console.error('ManagerScreen loadData error:', err)
    }
  }

  const isFirstRangeLoad = useRef(true)
  useEffect(() => { loadData() }, [])
  // Reload report khi user đổi date range (skip lần đầu — đã có từ loadData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dataLoaded) return
    if (isFirstRangeLoad.current) { isFirstRangeLoad.current = false; return }
    fetchReport(rangeStart, rangeEnd, true)
  }, [dateRange, customFromDate, customToDate, dataLoaded])

  // ── Refresh dữ liệu live: rooms + items + report (silent, không show loading) ──
  const refreshLiveData = async () => {
    try {
      const [rooms] = await Promise.all([
        api.getRooms(),
        fetchReport(rangeStart, rangeEnd),
      ])
      setLiveRoomsData(rooms)
      setLiveTick(t => t + 1)
      // Cập nhật items cho phòng occupied
      const occupied = rooms.filter((r: any) => r.status === 'occupied' && r.saleOrderId)
      if (occupied.length > 0) {
        const itemsResults = await Promise.all(
          occupied.map((r: any) => api.getSaleOrderItems(r.saleOrderId!).catch(() => [] as api.SaleOrderItem[]))
        )
        const itemsMap: Record<string, api.SaleOrderItem[]> = {}
        occupied.forEach((r: any, i: number) => { if (r.saleOrderId) itemsMap[r.saleOrderId] = itemsResults[i] })
        setOpenOrderItemsMap(prev => ({ ...prev, ...itemsMap }))
      }
    } catch (e) {
      // silent — không alert
    }
  }

  // ── Real-time WebSocket: reload toàn bộ khi có sự kiện ──────────────────
  useSocket((msg: SocketEvent) => {
    if (
      msg.event === 'saleOrder:updated' || msg.event === 'saleOrder:created' ||
      msg.event === 'room:updated' || msg.model === 'Room'
    ) {
      refreshLiveData()
    }
  })

  // ── Auto-refresh mỗi 30s để đảm bảo dữ liệu luôn mới nhất ──────────────
  useEffect(() => {
    const id = setInterval(() => refreshLiveData(), 30000)
    return () => clearInterval(id)
  }, [rangeStart, rangeEnd])

  const screenW = Dimensions.get('window').width
  const barMaxH = 80

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
        value: dataLoaded ? todayRevenue.toLocaleString('vi-VN') + 'đ' : '--',
        sub: `${todayOrderCount} hóa đơn đã thanh toán`,
        trend: 0,
      },
      {
        icon: 'door-open', iconColor: '#60a5fa', bg: '#1e3a5f',
        label: 'Phòng đang hoạt động',
        value: dataLoaded ? `${occupiedRooms.length} / ${liveRoomsData.length}` : '--',
        sub: `${liveRoomsData.filter(r => r.status === 'available').length} trống · ${liveRoomsData.filter(r => r.status === 'cleaning').length} đang dọn`,
        trend: 0,
      },
      {
        icon: 'receipt', iconColor: '#fbbf24', bg: '#451a03',
        label: 'Hóa đơn đã thanh toán',
        value: dataLoaded ? String(todayOrderCount) : '--',
        sub: `${openOrderCount} đang mở`,
        trend: 0,
      },
      {
        icon: 'users', iconColor: '#a78bfa', bg: '#2e1065',
        label: 'Nhân viên hệ thống',
        value: dataLoaded ? String(liveUsersData.length) : '--',
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
    // Dữ liệu giờ từ server (key = '0'..'23')
    const serverHour = reportData?.byHour ?? {}
    // Hiển thị 12h→23h (buổi tối) rồi 0h→11h (sáng hôm sau)
    const hours = [...Array.from({ length: 12 }, (_, i) => i + 12), ...Array.from({ length: 12 }, (_, i) => i)]
    const maxVal = Math.max(...hours.map(h => serverHour[String(h)] || 0), 1)
    const bars: HourlyBar[] = hours.map(h => ({
      hour: h === 12 ? '12h' : h === 0 ? '0h' : `${String(h).padStart(2, '0')}h`,
      value: (serverHour[String(h)] || 0) / maxVal,
    }))
    const data = bars
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
    // Dữ liệu ngày từ server (key = 'YYYY-MM-DD')
    const serverDay = reportData?.byDay ?? {}
    const days = Array.from({ length: nDays }, (_, i) => {
      const d = new Date(rangeStart); d.setDate(d.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      const labels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
      return { rev: serverDay[key] ?? 0, label: nDays <= 7 ? labels[d.getDay()] : `${d.getDate()}/${d.getMonth()+1}` }
    })
    const revData = days.map(d => d.rev)
    const labData = days.map(d => d.label)
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
          {dataLoaded ? rangeRevenue.toLocaleString('vi-VN') + 'đ' : '--'}
        </Text>
        <Text style={s.heroCompare}>{reportData?.orderCount ?? 0} hóa đơn đã thanh toán</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={s.heroSmLabel}>Trung bình / đơn</Text>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#60a5fa' }}>
          {(reportData?.orderCount ?? 0) > 0 ? Math.round(rangeRevenue / reportData!.orderCount).toLocaleString('vi-VN') + 'đ' : '--'}
        </Text>
      </View>
    </View>
  )

  // ── Top items ───────────────────────────────────────────────────────────────
  const TopItems = () => {
    const items = (reportData?.productAnalytics ?? []).slice(0, 5)
    return (
      <View style={s.tableBox}>
        <Text style={s.sectionTitle}>Top món bán chạy hôm nay</Text>
        {items.length > 0 ? items.map((item, i) => (
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
            <Text style={[s.kpiSub, { marginTop: 8, textAlign: 'center' }]}>{dataLoaded ? 'Không có dữ liệu hôm nay' : 'Đang tải...'}</Text>
          </View>
        )}
      </View>
    )
  }

  // ── Revenue breakdown ───────────────────────────────────────────────────────
  const RevenueBreakdown = () => {
    // Dùng byMethod từ server (keys là giá trị raw: 'cash', 'transfer', ...)
    const methodMap = reportData?.byMethod ?? {}
    const totalPaid = rangeRevenue
    const cash     = methodMap['cash'] ?? 0
    const transfer = methodMap['transfer'] ?? 0
    const card     = methodMap['card'] ?? 0
    const breakdown = [
      { label: 'Tiền mặt',      val: cash,     color: '#34d399', pct: totalPaid ? cash / totalPaid : 0 },
      { label: 'Chuyển khoản', val: transfer, color: '#60a5fa', pct: totalPaid ? transfer / totalPaid : 0 },
      { label: 'Thẻ',          val: card,     color: '#fbbf24', pct: totalPaid ? card / totalPaid : 0 },
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
    const txList: Transaction[] = (reportData?.recentTransactions ?? []).map(o => {
      const d = new Date(o.updatedAt)
      return {
        id: o.code,
        room: o.roomName || o.roomId,
        amount: o.paidAmount,
        method: o.paymentMethod,
        cashier: '',
        time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
        status: 'paid',
      } as Transaction
    })
    return (
      <View style={s.tableBox}>
        <Text style={s.sectionTitle}>Giao dịch gần nhất</Text>
        {txList.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <Text style={{ color: c.textMuted }}>{dataLoaded ? 'Chưa có giao dịch' : 'Đang tải...'}</Text>
          </View>
        ) : txList.map((tx, i) => (
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
    const roomsData = liveRoomsData
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
    const staffData: StaffRow[] = liveUsersData.map(u => ({
      name: u.fullName ?? u.username,
      role: (u as any).role ?? 'Nhân viên',
      status: 'online' as const,
      orders: 0,
      checkIn: '--:--',
      shift: 'S',
    }))
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
          {staffData.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <Text style={{ color: c.textMuted }}>{dataLoaded ? 'Không có tài khoản' : 'Đang tải...'}</Text>
            </View>
          ) : staffData.map((staff, i) => (
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
    const rev = todayRevenue
    // Dùng giá vốn thực nếu đã load analytics cho kỳ hôm nay; ngược lại ước tính 68%
    const hasRealCost = reportData !== null && analyticsTotCost > 0
    const profit = hasRealCost ? rev - analyticsTotCost : Math.round(rev * 0.68)
    const margin = hasRealCost
      ? (rev > 0 ? Math.round((rev - analyticsTotCost) / rev * 100) : 0)
      : 68
    const profitLabel = hasRealCost ? 'Lợi nhuận gộp' : 'Lợi nhuận ước tính'
    const profitPrefix = hasRealCost ? '' : '~'
    const marginNote = hasRealCost ? 'Sau khi trừ giá vốn' : 'ước tính, xem Phân tích'
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
            <Text style={s.heroCompare}>{todayOrderCount} đơn đã thanh toán hôm nay</Text>
          </View>
          <View style={s.heroDivider} />
          <View style={s.heroSide}>
            <Text style={s.heroSmLabel}>{profitLabel}</Text>
            <Text style={s.heroProfitVal}>{profitPrefix}{profit.toLocaleString('vi-VN')}đ</Text>
            <View style={s.heroProfitBadge}>
              <Text style={s.heroProfitBadgeText}>Biên {margin}%</Text>
            </View>
            <Text style={s.heroCompare}>{marginNote}</Text>
          </View>
        </View>
      </View>
    )
  }

  // ── Overview: Stat chips ───────────────────────────────────────────────────
  const OverviewStats = () => {
    const chips = [
      { icon: 'door-open',    color: '#7c3aed', val: dataLoaded ? `${occupiedRooms.length} / ${liveRoomsData.length}` : '--', label: 'Phòng mở' },
      { icon: 'receipt',      color: '#ea580c', val: dataLoaded ? String(todayOrderCount) : '--', label: 'HĐ hôm nay' },
      { icon: 'user-friends', color: '#0284c7', val: dataLoaded ? String(liveUsersData.length) : '--', label: 'Tài khoản NV' },
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
    void liveTick  // re-render mỗi phút để cập nhật thời gian + tiền time-based
    const roomsData = liveRoomsData

    // Tính totalLive từ items của các phòng occupied (dùng room.saleOrderId)
    const totalLive = liveRoomsData
          .filter(r => r.status === 'occupied' && r.saleOrderId)
          .reduce((sum, r) => {
            const items = openOrderItemsMap[r.saleOrderId!] ?? []
            return sum + items.reduce((s, item) => {
              if (item.unit === 'giờ') {
                const qty = r.startTime ? calcTimeBasedQty(r.startTime, item.timeBasedConfig?.blockMinutes ?? 5) : item.quantity
                return s + qty * item.unitPrice
              }
              return s + (item.subtotal || item.quantity * item.unitPrice)
            }, 0)
          }, 0)

    const occupiedCount = roomsData.filter(r => r.status === 'occupied').length
    const gap = 8
    const pad = 12
    const tileW = Math.floor((screenW - pad * 2 - gap) / 2)

    return (
      <>
        {/* Header tổng – nổi bật hơn */}
        <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={s.ovSectionTitle}>{occupiedCount} phòng đang mở / {roomsData.length} tổng</Text>
              <Text style={{ color: c.textMuted, fontSize: 10, marginTop: 1 }}>Tổng tiền tạm tính</Text>
            </View>
            <Text style={{ color: '#2563eb', fontSize: 22, fontWeight: '800' }}>{fmtFull(totalLive)}</Text>
          </View>
        </View>

        {/* Grid tile tất cả phòng */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, padding: pad, paddingTop: 8 }}>
          {roomsData.map((r, i) => {
            const isOccupied  = r.status === 'occupied'
            const isAvailable = r.status === 'available'
            const isVip = r.type === 'vip' || r.type === 'VIP'

            // Thời gian từ startTime phòng
            const elapsedStr = r.startTime ? (() => {
              const diff = Date.now() - new Date(r.startTime).getTime()
              const totalMin = Math.floor(diff / 60000)
              const h = Math.floor(totalMin / 60)
              const m = totalMin % 60
              return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
            })() : null

            // Doanh thu tạm tính từ items của phòng (dùng saleOrderId trực tiếp)
            const items = r.saleOrderId ? (openOrderItemsMap[r.saleOrderId] ?? []) : []
            const liveRev = items.reduce((sum, item) => {
              if (item.unit === 'giờ') {
                const qty = r.startTime ? calcTimeBasedQty(r.startTime, item.timeBasedConfig?.blockMinutes ?? 5) : item.quantity
                return sum + qty * item.unitPrice
              }
              return sum + (item.subtotal || item.quantity * item.unitPrice)
            }, 0)

            const bg   = isOccupied ? '#ef4444' : isAvailable ? '#10b981' : '#f59e0b'
            const icon = isOccupied ? 'music'   : isAvailable ? 'check-circle' : 'broom'

            return (
              <View key={r.id ?? i} style={{ width: tileW, backgroundColor: bg, borderRadius: 10, padding: 12, minHeight: 90, justifyContent: 'space-between' }}>
                {/* Top: icon + VIP badge */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <FontAwesome5 name={icon} size={16} color="rgba(255,255,255,0.85)" solid />
                  {isVip && (
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>VIP</Text>
                    </View>
                  )}
                </View>
                {/* Tên phòng */}
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{r.name}</Text>
                {/* Trạng thái */}
                {isOccupied ? (
                  <View style={{ marginTop: 4, gap: 2 }}>
                    {elapsedStr && <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>{elapsedStr}</Text>}
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{fmtFull(liveRev)}</Text>
                  </View>
                ) : (
                  <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 6 }}>
                    {isAvailable ? 'Trống' : 'Đang dọn'}
                  </Text>
                )}
              </View>
            )
          })}
        </View>
      </>
    )
  }

  // ── Analytics panel ─────────────────────────────────────────────────────────
  const AnalyticsPanel = () => {
    // Dùng rangeRevenue (paidAmount) làm chuẩn doanh thu — nhất quán với tab Tổng quan & Doanh thu
    // totCost/totMargin tính từ item-level data (ước tính giá vốn)
    const items = reportData?.productAnalytics ?? []
    const totCost    = items.reduce((s, i) => s + i.cost, 0)
    const totProfit  = rangeRevenue - totCost
    const totMargin  = rangeRevenue > 0 ? Math.round(totProfit / rangeRevenue * 100) : 0
    const orderCount = reportData?.orderCount ?? 0

    if (reportLoading) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <ActivityIndicator size="large" color="#fbbf24" />
          <Text style={{ color: c.textMuted, marginTop: 12 }}>Đang phân tích dữ liệu...</Text>
        </View>
      )
    }

    return (
      <>
        {/* KPI tổng hợp — dùng c.elevated để tương thích cả light/dark */}
        {items.length > 0 && (
          <View style={{ margin: 10, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, backgroundColor: c.elevated, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#16a34a' }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 4 }}>DOANH THU</Text>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{fmtFull(rangeRevenue)}</Text>
                <Text style={{ color: c.textMuted, fontSize: 10, marginTop: 3 }}>{orderCount} đơn · {rangeLabel}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: c.elevated, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#d97706' }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 4 }}>GIÁ VỐN</Text>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{fmtFull(totCost)}</Text>
                <Text style={{ color: c.textMuted, fontSize: 10, marginTop: 3 }}>Ước tính từ giá nhập</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, backgroundColor: c.elevated, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#7c3aed' }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 4 }}>LỢI NHUẬN GỘP</Text>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{fmtFull(totProfit)}</Text>
                <Text style={{ color: c.textMuted, fontSize: 10, marginTop: 3 }}>Sau khi trừ giá vốn</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: c.elevated, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#2563eb' }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 4 }}>BIÊN LỢI NHUẬN</Text>
                <Text style={{ color: totMargin >= 50 ? '#15803d' : totMargin >= 30 ? '#b45309' : '#b91c1c', fontSize: 24, fontWeight: '800' }}>{totMargin}%</Text>
                <Text style={{ color: c.textMuted, fontSize: 10, marginTop: 1 }}>{orderCount} đơn phân tích</Text>
              </View>
            </View>
          </View>
        )}

        {/* Bảng sản phẩm */}
        <View style={s.tableBox}>
          <Text style={s.sectionTitle}>
            Sản phẩm · {rangeLabel}
          </Text>
          {items.length === 0 ? (
            <View style={{ paddingVertical: 32, alignItems: 'center' }}>
              <FontAwesome5 name="box-open" size={36} color={c.textFaint} solid />
              <Text style={{ color: c.textMuted, marginTop: 12, textAlign: 'center' }}>
                {orderCount === 0 ? 'Không có đơn hàng trong kỳ này' : 'Chờ phân tích xong...'}
              </Text>
            </View>
          ) : (
            <>
              {/* Header row — align với row 2 của data */}
              <View style={{ flexDirection: 'row', paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4 }}>
                <View style={{ width: 28 }} />
                <Text style={{ flex: 1, color: c.textMuted, fontSize: 10, fontWeight: '600' }}>Doanh thu</Text>
                <Text style={{ flex: 1, color: c.textMuted, fontSize: 10, fontWeight: '600' }}>Giá vốn</Text>
                <Text style={{ flex: 1, color: c.textMuted, fontSize: 10, fontWeight: '600' }}>Lợi nhuận</Text>
                <Text style={{ width: 42, color: c.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'right' }}>Biên</Text>
              </View>
              {items.map((item, i) => (
                <View key={i} style={{ borderBottomWidth: 1, borderBottomColor: c.borderFaint, paddingVertical: 9 }}>
                  {/* Row 1: rank + tên + số lượng */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <View style={[s.rank, { backgroundColor: i < 3 ? '#7c3aed' : c.elevated, flexShrink: 0 }]}>
                      <Text style={[s.rankText, { color: i < 3 ? '#fff' : c.textSub }]}>{i + 1}</Text>
                    </View>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={2}>{item.name}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11, flexShrink: 0 }}>×{item.qty}</Text>
                  </View>
                  {/* Row 2: 4 cột số liệu — align với header */}
                  <View style={{ flexDirection: 'row', paddingLeft: 28 }}>
                    <Text style={{ flex: 1, color: '#16a34a', fontWeight: '700', fontSize: 12 }}>{fmtVnd(item.revenue)}</Text>
                    <Text style={{ flex: 1, color: '#b45309', fontWeight: '700', fontSize: 12 }}>{fmtVnd(item.cost)}</Text>
                    <Text style={{ flex: 1, color: '#7c3aed', fontWeight: '700', fontSize: 12 }}>{fmtVnd(item.profit)}</Text>
                    <Text style={{ width: 42, fontWeight: '800', fontSize: 13, textAlign: 'right', color: item.margin >= 50 ? '#15803d' : item.margin >= 30 ? '#b45309' : '#b91c1c' }}>{item.margin}%</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>
      </>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  const tabs: { key: DashTab; label: string; icon: string }[] = [
    { key: 'overview',  label: 'Tổng quan', icon: 'chart-line' },
    { key: 'revenue',   label: 'Doanh thu', icon: 'coins' },
    { key: 'analytics', label: 'Phân tích', icon: 'chart-pie' },
    { key: 'staff',     label: 'Nhân viên', icon: 'users' },
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
            <Text style={s.headerClock}>
              {selectedStore?.name ? `${selectedStore.name} • ${timeStr}` : timeStr}
            </Text>
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

          <RangeSummaryCard />
          {dateRange === 'today' ? <HourlyChart /> : <DayRangeChart />}
          <RevenueBreakdown />
          <RecentTx />
        </>}

        {/* Analytics tab */}
        {tab === 'analytics' && (
          <>
            {/* Date range selector (shared state with Revenue tab) */}
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
            <AnalyticsPanel />
          </>
        )}

        {/* Staff tab */}
        {tab === 'staff' && <StaffPanel />}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Custom date range modal — shared between Revenue & Analytics tabs */}
      <Modal visible={showCustomModal} transparent animationType="fade" onRequestClose={() => setShowCustomModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 20, width: 340, gap: 14 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Chọn khoảng thời gian</Text>

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
                <DateTimePicker value={customFromDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={customToDate} onChange={(_, d) => { setShowFromPicker(false); if (d) setCustomFromDate(d) }} />
              )}
            </View>

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
                <DateTimePicker value={customToDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  minimumDate={customFromDate} onChange={(_, d) => { setShowToPicker(false); if (d) setCustomToDate(d) }} />
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
