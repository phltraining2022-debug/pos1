import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Alert,
  StyleSheet, Platform, KeyboardAvoidingView, useWindowDimensions, StatusBar, ActivityIndicator, ImageBackground,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import { useStore } from './StoreContext'
import * as api from './api'
import { useSocket } from './useSocket'
import * as Print from 'expo-print'

// ─── Types ─────────────────────────────────────────────────────────────────

type RoomStatus = 'occupied' | 'empty' | 'cleaning' | 'maintenance'
type CashierView = 'pos' | 'bills' | 'dashboard'
type MobileTab = 'rooms' | 'bill' | 'menu' | 'history' | 'cleaning'

interface ChecklistItem { id: number; name: string; checked: boolean }
const CLEANING_CHECKLIST: ChecklistItem[] = [
  { id: 1, name: 'Thu dọn ly, đĩa', checked: false },
  { id: 2, name: 'Lau bàn, ghế', checked: false },
  { id: 3, name: 'Vệ sinh sàn', checked: false },
  { id: 4, name: 'Kiểm tra thiết bị âm thanh', checked: false },
  { id: 5, name: 'Thay khăn trải bàn', checked: false },
]

interface DashTx { time: string; code: string; paymentMethod: string; amount: number; order: api.SaleOrder }
interface DashTopItem { name: string; qty: number; totalSales: number; costTotal: number; profitTotal: number }
interface DashSummary {
  totalRevenue: number; totalOrders: number; avgOrder: number; label: string
  totalCost: number; totalProfit: number
  transactions: DashTx[]; topItems: DashTopItem[]
}

interface Room {
  id: string; name: string; status: RoomStatus
  type: string; capacity: number
  customerName: string; startTime?: Date; timer?: string
  saleOrderId?: string | null
}
interface Category { id: string; name: string }
interface MenuItem { id: string; name: string; price: number; stock: number; unit: string; categoryId: string; image?: string; isTimeBased?: boolean; blockMinutes?: number }
interface CartItem {
  id: string; name: string; quantity: number; unit: string
  price: number; note: string
  productId?: string      // product id thực sự (dedup key)
  submittedQty?: number   // số lượng đã gửi server; undefined = chưa gửi lần nào
  isSurcharge?: boolean; isTimeBased?: boolean
  _manualStart?: string; _manualEnd?: string  // 'HH:MM' strings for manual time override
  _startTime?: string   // ISO string – thời điểm bắt đầu (dùng cho timebased)
  _endTime?: string     // ISO string – thời điểm kết thúc thủ công (nếu có)
  _blockMinutes?: number // block tính giờ (default 5)
}

// ─── Mock data ──────────────────────────────────────────────────────────────

const fmtVnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

// Tính số giờ thực tế theo block (giống logic app Angular cũ)
const calcTimeBasedQty = (startIso: string, blockMinutes = 5, endTime?: Date): number => {
  const start = new Date(startIso)
  if (isNaN(start.getTime())) return 1
  const startFloor = new Date(Math.floor(start.getTime() / 60000) * 60000)
  const startMin = Math.floor(startFloor.getTime() / 60000)
  const endMs = endTime ? endTime.getTime() : Date.now()
  const endMin = Math.floor(endMs / 60000)
  const diffMin = Math.max(1, endMin - startMin + 1)
  const blocks = Math.max(1, Math.ceil(diffMin / blockMinutes))
  return Math.round((blocks * blockMinutes / 60) * 1000) / 1000
}

// Tính thời gian đã dùng phòng từ startTime
const formatElapsed = (startTime: Date): string => {
  const diffMs = Date.now() - startTime.getTime()
  if (diffMs < 0) return '0m'
  const totalMin = Math.floor(diffMs / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

function mapApiRoomToCashier(r: api.Room): Room {
  const startTime = r.startTime ? new Date(r.startTime) : undefined
  return {
    id: r.id,
    name: r.name,
    status: r.status === 'occupied' ? 'occupied' : r.status === 'available' ? 'empty' : 'cleaning',
    type: r.type,
    capacity: 0,
    customerName: (r.customerInfo as any)?.name ?? '',
    startTime,
    timer: startTime && r.status === 'occupied' ? formatElapsed(startTime) : undefined,
    saleOrderId: r.saleOrderId,
  }
}

function mapApiProductToCashier(p: api.Product): MenuItem {
  const pAny = p as any
  const fallbackImage = Array.isArray(pAny?.images) && pAny.images.length > 0 ? pAny.images[0]?.url : undefined
  return {
    id: p.id,
    name: p.name,
    price: p.sellingPrice > 0 ? p.sellingPrice : p.price,
    stock: p.stock ?? 0,
    unit: p.isTimeBased ? 'giờ' : (p.unitOfMeasure || 'phần'),
    categoryId: p.categoryId,
    image: p.image || fallbackImage || undefined,
    isTimeBased: !!p.isTimeBased,
    blockMinutes: p.timeBasedPricing?.blockMinutes ?? 5,
  }
}

const roomColor = (status: RoomStatus) => {
  switch (status) {
    // Match AngularJS palette for room status colors.
    case 'occupied':    return { bg: '#ef4444', border: '#fca5a5' }
    case 'empty':       return { bg: '#10b981', border: '#6ee7b7' }
    case 'cleaning':    return { bg: '#f59e0b', border: '#fcd34d' }
    case 'maintenance': return { bg: '#6b7280', border: '#9ca3af' }
  }
}
const roomIcon = (status: RoomStatus) => {
  switch (status) {
    case 'occupied':    return 'music'
    case 'empty':       return 'check-circle'
    case 'cleaning':    return 'broom'
    case 'maintenance': return 'wrench'
  }
}

// ─── Cashier Screen ────────────────────────────────────────────────────────

const ROOM_GRID_THREE_COLS_THRESHOLD = 5
const MENU_GRID_THREE_COLS_THRESHOLD = 8

export default function CashierScreen({ onBack, onInventory, isWaiterMode = false }: { onBack: () => void; onInventory?: () => void; isWaiterMode?: boolean }) {
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  const { colors: c, mode, toggle } = useTheme()
  const { selectedStore } = useStore()
  const s = useMemo(() => makeStyles(c), [c])
  const _cartIdRef = React.useRef(0)
  const genCartId = () => `ci_${Date.now()}_${++_cartIdRef.current}`
  const wsDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedRoomRef = React.useRef<Room | null>(null)
  const [view, setView] = useState<CashierView>('pos')
  const [tab, setTab] = useState<MobileTab>('rooms')
  const [rooms, setRooms] = useState<Room[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([{ id: 'all', name: 'Tất cả' }])
  const [dataLoading, setDataLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [cashierName, setCashierName] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [draftCartOpen, setDraftCartOpen] = useState(false)
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CLEANING_CHECKLIST)
  const [selectedCleaningRoom, setSelectedCleaningRoom] = useState<Room | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedPayMethod, setSelectedPayMethod] = useState('Tiền mặt')
  const [billsList, setBillsList] = useState<api.SaleOrder[]>([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [billsLoadingMore, setBillsLoadingMore] = useState(false)
  const [billsDateFrom, setBillsDateFrom] = useState(todayStr)
  const [billsDateTo, setBillsDateTo] = useState(todayStr)
  const [billsOffset, setBillsOffset] = useState(0)
  const [billsHasMore, setBillsHasMore] = useState(true)
  const [billDetail, setBillDetail] = useState<{ show: boolean; order: api.SaleOrder | null; items: api.SaleOrderItem[]; loading: boolean }>({
    show: false, order: null, items: [], loading: false,
  })
  // Dashboard (Báo cáo) state
  const [dashDateFrom, setDashDateFrom] = useState(todayStr)
  const [dashDateTo, setDashDateTo] = useState(todayStr)
  const [dashLoading, setDashLoading] = useState(false)
  const [dashSummary, setDashSummary] = useState<DashSummary | null>(null)
  const [dashPickerType, setDashPickerType] = useState<'from' | 'to' | null>(null)
  const [dashPickerDate, setDashPickerDate] = useState(new Date())
  // Check-in modal
  const [checkInModal, setCheckInModal] = useState<{ show: boolean; room: Room | null }>({ show: false, room: null })
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [itemsLoading, setItemsLoading] = useState(false)
  // Luôn sync ref với state mới nhất (pattern an toàn cho interval/WS callback)
  selectedRoomRef.current = selectedRoom

  useEffect(() => {
    let active = true
    async function loadData() {
      try {
        const [apiRooms, apiProducts, apiCategories] = await Promise.all([
          api.getRooms(),
          api.getProducts(),
          api.getProductCategories(),
        ])
        if (!active) return
        const mappedRooms = apiRooms.map(mapApiRoomToCashier)
        setRooms(mappedRooms)
        const initialRoom = mappedRooms.find(r => r.status === 'occupied') ?? mappedRooms[0] ?? null
        setSelectedRoom(initialRoom)
        setMenuItems(apiProducts.map(mapApiProductToCashier))
        setCategories([
          { id: 'all', name: 'Tất cả' },
          ...apiCategories.map(cat => ({ id: cat.id, name: cat.name })),
        ])
        // Auto-load items cho phòng occupied được chọn ban đầu
        if (active && initialRoom?.status === 'occupied' && initialRoom.saleOrderId) {
          loadExistingItems(initialRoom)
        }
      } catch (err) {
        console.error('CashierScreen load error:', err)
      } finally {
        if (active) setDataLoading(false)
      }
    }
    loadData()
    // Load tên nhân viên để in bill
    api.restoreSession().then(s => { if (s?.fullName) setCashierName(s.fullName) }).catch(() => {})
    return () => { active = false }
  }, [])
  const [selectedCat, setSelectedCat] = useState('all')
  const [discount, setDiscount] = useState(0)
  const [discountPct, setDiscountPct] = useState(0)   // >0 = giảm theo %, 0 = giảm cố định
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount')
  const [payModal, setPayModal] = useState(false)
  const [discountModal, setDiscountModal] = useState(false)
  const [discountInput, setDiscountInput] = useState('')
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [billActionsOpen, setBillActionsOpen] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')

  // ── Đổi phòng / Gộp bill / Tách bill modals ─────────────────────────────
  const [changeRoomModal, setChangeRoomModal] = useState(false)
  const [mergeBillModal, setMergeBillModal] = useState(false)
  const [splitBillModal, setSplitBillModal] = useState<{ show: boolean; items: (CartItem & { toSplit: boolean })[] }>({ show: false, items: [] })
  const [noteModal, setNoteModal] = useState<{ show: boolean; item: CartItem | null; text: string }>({
    show: false, item: null, text: ''
  })
  const [editTimeModal, setEditTimeModal] = useState<{
    show: boolean; item: CartItem | null
    startHH: string; startMM: string; startDate: string; showDatePick: boolean
    endHH: string; endMM: string; endDate: string; showEndDatePick: boolean
  }>({ show: false, item: null, startHH: '', startMM: '', startDate: '', showDatePick: false, endHH: '', endMM: '', endDate: '', showEndDatePick: false })
  const [timeStr, setTimeStr] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTimeStr(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} - ${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`)
    }
    tick()
    const id = setInterval(tick, 10000)
    return () => clearInterval(id)
  }, [])

  // Cập nhật timer phòng occupied mỗi phút + tính lại timebased qty
  useEffect(() => {
    const id = setInterval(() => {
      setRooms(prev => prev.map(r =>
        r.status === 'occupied' && r.startTime
          ? { ...r, timer: formatElapsed(r.startTime) }
          : r
      ))
      // Tính lại số giờ của timebased items trong cart (bỏ qua nếu không có timebased)
      setCart(prev => {
        if (!prev.some(c => c.isTimeBased && c._startTime)) return prev
        return prev.map(c =>
          c.isTimeBased && c._startTime && !c._endTime
            ? { ...c, quantity: calcTimeBasedQty(c._startTime, c._blockMinutes ?? 5) }
            : c
        )
      })
    }, 60000)
    return () => clearInterval(id)
  }, [])

  // Tự động refresh danh sách phòng mỗi 30 giây để thấy thay đổi từ waiter
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const apiRooms = await api.getRooms()
        setRooms(apiRooms.map(mapApiRoomToCashier))
      } catch { /* silent */ }
    }, 30000)
    return () => clearInterval(id)
  }, [])

  // 20-giây safety-net: đồng bộ cart nếu WS bị miss
  useEffect(() => {
    const id = setInterval(() => {
      const room = selectedRoomRef.current
      if (room?.status === 'occupied' && room.saleOrderId) {
        silentPatchCart(room)
      }
    }, 20000)
    return () => clearInterval(id)
  }, [])

  const filteredMenu = useMemo(() =>
    menuItems
      .filter(i => selectedCat === 'all' || i.categoryId === selectedCat)
      .filter(i => i.name.toLowerCase().includes(menuSearch.toLowerCase()))
  , [menuItems, selectedCat, menuSearch])

  // ── Load existing order items khi chọn phòng đang occupied ────────────────
  // silent=true: không hiện spinner/alert (dùng cho WS background refresh)
  const loadExistingItems = async (room: Room, silent = false) => {
    if (!room.saleOrderId) return
    if (!silent) setItemsLoading(true)
    try {
      const [items, saleOrder] = await Promise.all([
        api.getSaleOrderItems(room.saleOrderId),
        api.getSaleOrder(room.saleOrderId).catch(() => null),
      ])
      // Restore discount + trạng thái đóng băng từ server
      const isFrozen    = saleOrder?.timeFrozen === true
      const freezeEndIso = saleOrder?.printedAt  // thời điểm freeze = lần in bill cuối
      if (saleOrder) {
        const savedDiscount = saleOrder.discount ?? 0
        const savedPct = saleOrder.discountPct ?? 0
        setDiscount(savedDiscount)
        setDiscountPct(savedPct)
      }
      // Group by productId+note (như AngularJS loadItemsIntoCart)
      // Nếu server có duplicate records cho cùng 1 món → gộp lại thành 1 row
      const grouped = new Map<string, CartItem>()
      for (const item of items) {
        const timeBased = item.unit === 'giờ'
        const startIso = room.startTime?.toISOString() ?? item.createdAt
        const bm = item.timeBasedConfig?.blockMinutes ?? menuItems.find(m => m.id === item.productId)?.blockMinutes ?? 5
        const key = timeBased ? `tb_${item.productId}` : `${item.productId}|${item.note ?? ''}`
        // Giờ cuối để hiện _manualEnd (dạng HH:MM)
        const endDate   = freezeEndIso ? new Date(freezeEndIso) : null
        const manualEnd = endDate
          ? `${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}`
          : undefined
        if (grouped.has(key)) {
          const ex = grouped.get(key)!
          // Cộng dồn quantity (timebased dùng timer / frozen value, không cộng)
          grouped.set(key, {
            ...ex,
            quantity: timeBased ? ex.quantity : ex.quantity + item.quantity,
            submittedQty: (ex.submittedQty ?? 0) + item.quantity,
          })
        } else {
          grouped.set(key, {
            id: 'sol_' + item.id,
            productId: item.productId,
            name: item.name,
            // Nếu đóng băng → tính lại từ startTime đến thời điểm freeze; nếu không → tính live từ startTime
            quantity: timeBased
              ? (isFrozen && freezeEndIso && startIso
                  ? calcTimeBasedQty(startIso, bm, new Date(freezeEndIso))
                  : (startIso ? calcTimeBasedQty(startIso, bm) : item.quantity))
              : item.quantity,
            submittedQty: item.quantity,
            unit: item.unit ?? 'phần',
            price: item.unitPrice,
            note: item.note ?? '',
            isTimeBased: timeBased,
            _startTime:   timeBased ? startIso    : undefined,
            _blockMinutes: timeBased ? bm         : undefined,
            // Restore trạng thái đóng băng → hiện banner + nút "Tiếp tục tính"
            _endTime:     timeBased && isFrozen   ? (freezeEndIso ?? new Date().toISOString()) : undefined,
            _manualEnd:   timeBased && isFrozen   ? manualEnd : undefined,
          })
        }
      }
      setCart([...grouped.values()])
    } catch (err) {
      if (!silent) {
        console.error('loadExistingItems error:', err)
        Alert.alert('Không tải được đơn hàng', 'Nhấn nút 🔄 để thử lại.')
        setCart([])
      }
    } finally {
      if (!silent) setItemsLoading(false)
    }
  }

  // ── Silent diff/patch cart (không clear, không flicker) ──────────────────────
  // Tham khảo lối AngularJS cũ: chỉ cập nhật đúng những item thay đổi,
  // trả về `prev` nếu không có gì mới → React skip re-render hoàn toàn.
  const silentPatchCart = async (room: Room) => {
    if (!room.saleOrderId) return
    try {
      const serverItems = await api.getSaleOrderItems(room.saleOrderId)
      setCart(prev => {
        if (prev.length === 0 && serverItems.length === 0) return prev
        const serverMap = new Map(serverItems.map(si => ['sol_' + si.id, si]))
        let changed = false
        const patched: CartItem[] = []

        // Patch / giữ / xóa item cũ
        for (const c of prev) {
          // 1. Match chính xác bằng sol_ id
          let si = serverMap.get(c.id)
          let matchKey = c.id

          // 2. Fallback: nếu là local placeholder (ci_), tìm theo productId+note
          //    → promote ci_ item lên sol_ id sau khi server xác nhận
          if (!si && !c.id.startsWith('sol_') && !c.isTimeBased) {
            for (const [key, candidate] of serverMap.entries()) {
              if (candidate.productId === c.productId && (candidate.note ?? '') === (c.note ?? '')) {
                si = candidate
                matchKey = key
                break
              }
            }
          }

          if (!si) {
            // Không còn trên server
            if (c.isTimeBased || !c.id.startsWith('sol_')) {
              patched.push(c)  // giữ timebased và item local chưa sync
            } else {
              changed = true   // item bị xóa bởi thiết bị khác
            }
            continue
          }

          // Kiểm tra có gì thay đổi không (kể cả id promotion ci_ → sol_)
          // Lưu ý: không so sánh note — note local được PATCH server ngay trong saveNote
          // Timebased: giữ quantity live-calculated, không override bằng server static value
          const targetId = 'sol_' + si.id
          if (
            c.id !== targetId ||
            c.price !== si.unitPrice ||
            (!c.isTimeBased && c.quantity !== si.quantity)
          ) {
            changed = true
            // submittedQty = si.quantity để tránh hiện nút gửi bếp khi thiết bị khác thêm món
            patched.push({ ...c, id: targetId, quantity: c.isTimeBased ? c.quantity : si.quantity, price: si.unitPrice, submittedQty: c.isTimeBased ? c.submittedQty : si.quantity })
          } else {
            patched.push(c)  // giữ nguyên tham chiếu cũ
          }
          serverMap.delete(matchKey)
        }

        // Thêm item mới từ server (do thiết bị khác thêm vào)
        for (const si of serverMap.values()) {
          changed = true
          const timeBased = si.unit === 'giờ'
          const startIso = room.startTime?.toISOString() ?? si.createdAt
          const bm = si.timeBasedConfig?.blockMinutes ?? menuItems.find(m => m.id === si.productId)?.blockMinutes ?? 5
          patched.push({
            id: 'sol_' + si.id,
            productId: si.productId,
            name: si.name,
            quantity: timeBased && startIso ? calcTimeBasedQty(startIso, bm) : si.quantity,
            submittedQty: si.quantity,
            unit: si.unit ?? 'phần',
            price: si.unitPrice,
            note: si.note ?? '',
            isTimeBased: timeBased,
            _startTime: timeBased ? startIso : undefined,
            _blockMinutes: timeBased ? bm : undefined,
          })
        }

        return changed ? patched : prev  // same ref → React bỏ qua re-render
      })
    } catch { /* silent */ }
  }

  // ── WebSocket: debounce 500ms, gọi silentPatchCart ──────────────────────
  useSocket((msg) => {
    if (!msg.model || !['SaleOrderItem', 'SaleOrder', 'Room'].includes(msg.model)) return
    if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current)
    const currentRoom = selectedRoom  // capture fresh value từ latest render
    wsDebounceRef.current = setTimeout(async () => {
      if (msg.model === 'Room') {
        try {
          api.invalidateCache(['rooms'])
          const apiRooms = await api.getRooms()
          const mapped = apiRooms.map(mapApiRoomToCashier)
          setRooms(mapped)
          // Cập nhật selectedRoom nếu status thay đổi
          setSelectedRoom(prev => prev ? (mapped.find(r => r.id === prev.id) ?? prev) : prev)
        } catch { /* silent */ }
      } else if (msg.model === 'SaleOrder') {
        // Nếu có đơn hoàn thành mới + đang xem dashboard + ngày hôm nay trong range → reload
        const today = todayStr()
        if (view === 'dashboard' && dashDateFrom <= today && today <= dashDateTo) {
          loadDashboard()
        }
      } else if (currentRoom?.status === 'occupied') {
        silentPatchCart(currentRoom)  // diff/patch, không flicker
      }
    }, 500)
  })

  // ── Chọn phòng ────────────────────────────────────────────────────────────
  const selectRoom = (room: Room) => {
    setSelectedRoom(room)
    setDiscount(0)
    setDiscountPct(0)
    if (room.status === 'occupied') {
      loadExistingItems(room)
    } else {
      setCart([])
    }
    setTab('bill')
  }

  // ── Mở phòng (check-in) ──────────────────────────────────────────────────
  const handleOpenRoom = useCallback(async () => {
    const room = checkInModal.room
    if (!room) return
    setActionLoading(true)
    try {
      await api.checkIn(room.id, guestName || 'Khách lẻ', guestPhone || undefined)
      api.invalidateCache(['rooms']) // Clear rooms cache after check-in
      const apiRooms = await api.getRooms()
      const mapped = apiRooms.map(mapApiRoomToCashier)
      setRooms(mapped)
      const updatedRoom = mapped.find(r => r.id === room.id) ?? null
      setSelectedRoom(updatedRoom)
      setCart([])
      setCheckInModal({ show: false, room: null })
      setGuestName('')
      setGuestPhone('')
      setTab('bill')
    } catch (err: any) {
      Alert.alert('Lỗi mở phòng', err?.message ?? 'Không thể mở phòng')
    } finally {
      setActionLoading(false)
    }
  }, [checkInModal.room, guestName, guestPhone])

  const addToCart = useCallback((item: MenuItem) => {
    if (item.isTimeBased) {
      // Timebased: không thêm trùng (check theo productId)
      if (cart.some(c => (c.productId ?? c.id) === item.id)) return
      const startIso = selectedRoom?.startTime?.toISOString() ?? new Date().toISOString()
      const bm = item.blockMinutes ?? 5
      const qty = calcTimeBasedQty(startIso, bm)
      // Thêm vào cart tức thì (optimistic)
      setCart(prev => {
        if (prev.some(c => (c.productId ?? c.id) === item.id)) return prev
        return [...prev, {
          id: genCartId(), productId: item.id, name: item.name,
          quantity: qty, unit: 'giờ', price: item.price, note: '', isTimeBased: true,
          _startTime: startIso, _blockMinutes: bm,
        }]
      })
      // POST ngay lên server → item không mất khi navigate đi về
      const room = selectedRoom
      if (room?.saleOrderId) {
        api.submitOrderItems(room.saleOrderId, [{
          productId: item.id, name: item.name,
          quantity: qty, submittedQty: 0, price: item.price, unit: 'giờ', note: '',
        }]).then(() => loadExistingItems(room, true))
          .catch(() => { /* silent — item vẫn ở cart local */ })
      }
      return
    }
    // Normal: tìm item cùng productId và không có ghi chú → tăng số lượng
    setCart(prev => {
      const found = prev.find(c => (c.productId ?? c.id) === item.id && c.note === '')
      if (found) return prev.map(c =>
        c.id === found.id ? { ...c, quantity: c.quantity + 1 } : c
      )
      // Không tìm thấy → thêm mới
      return [...prev, { id: genCartId(), productId: item.id, name: item.name, quantity: 1, unit: item.unit, price: item.price, note: '' }]
    })
  }, [selectedRoom, cart])
  
  const updateQty = useCallback((id: string, delta: number) => {
    const item = cart.find(c => c.id === id)
    // Khi giảm về 0 → gọi removeItem để hiện confirm và xóa server
    if (item && item.quantity + delta <= 0) {
      removeItem(id)
      return
    }
    const newQty = Math.max(0, (item?.quantity ?? 0) + delta)
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c
      // Nếu giảm số lượng item đã submit → cập nhật submittedQty để khỏi hiện "Gửi bếp"
      const newSubmitted = (delta < 0 && id.startsWith('sol_')) ? newQty : c.submittedQty
      return { ...c, quantity: newQty, submittedQty: newSubmitted }
    }))
    // Đồng bộ GIẢM xuống server (tăng thì đi qua flow "Gửi bếp")
    if (delta < 0 && id.startsWith('sol_') && item) {
      api.patchSaleOrderItem(id.slice(4), {
        quantity: newQty,
        subtotal: newQty * item.price,
      }).catch(() => {}) // silent — silentPatchCart đồng bộ lại nếu cần
    }
  }, [cart])
  
  const removeItem = useCallback((id: string) => {
    const item = cart.find(c => c.id === id)
    Alert.alert(
      'Xoá món?',
      item?.name ?? '',
      [
        { text: 'Giữ lại', style: 'cancel' },
        { text: 'Xoá', style: 'destructive', onPress: async () => {
          setCart(prev => prev.filter(c => c.id !== id))
          // Xoá trên server nếu item đã được submit (có sol_ prefix)
          if (id.startsWith('sol_')) {
            try { await api.deleteSaleOrderItem(id.slice(4)) }
            catch { /* silent — silentPatchCart sẽ đồng bộ lại */ }
          }
        }},
      ]
    )
  }, [cart])

  const roomCharge = cart.filter(c => c.isTimeBased).reduce((s, c) => s + c.price * c.quantity, 0)
  const foodTotal = cart.filter(c => !c.isTimeBased).reduce((s, c) => s + c.price * c.quantity, 0)
  const subtotal = roomCharge + foodTotal
  const total = subtotal - discount

  // Food items có delta chưa gửi bếp (quantity > submittedQty)
  const newFoodItems = cart.filter(c => !c.isTimeBased && c.quantity > (c.submittedQty ?? 0))
  // Tất cả items có delta (gồm timebased mới, dùng khi checkout)
  const newCartItems = cart.filter(c => c.quantity > (c.submittedQty ?? 0))
  // Phòng đang cần dọn
  const cleaningRooms = rooms.filter(r => r.status === 'cleaning')

  // ── Gửi bếp (submit new items) ────────────────────────────────────────────
  const handleSendToKitchen = useCallback(async () => {
    if (!selectedRoom?.saleOrderId) {
      Alert.alert('Chưa mở phòng', 'Phòng chưa có đơn hàng. Hãy mở phòng trước.')
      return
    }
    if (newFoodItems.length === 0) {
      Alert.alert('Không có món mới', 'Tất cả món đã được gửi bếp.')
      return
    }
    setActionLoading(true)
    try {
      // Chỉ gửi food items (không gửi timebased lên bếp)
      await api.submitOrderItems(selectedRoom.saleOrderId, newFoodItems.map(c => ({
        id: c.id,                        // sol_xxx → PATCH, ci_xxx → POST
        productId: c.productId ?? c.id,
        name: c.name,
        quantity: c.quantity,            // total (API tự tính delta cho POST)
        submittedQty: c.submittedQty,    // dùng để tính delta khi POST
        price: c.price,
        unit: c.unit,
        note: c.note,
      })))
      // Cập nhật submittedQty = quantity hiện tại
      const sentIds = new Set(newFoodItems.map(f => f.id))
      setCart(prev => prev.map(c => sentIds.has(c.id) ? { ...c, submittedQty: c.quantity } : c))
      Alert.alert('Đã gửi bếp ✓', `${newFoodItems.length} món đã được ghi vào đơn`)
    } catch (err: any) {
      Alert.alert('Lỗi gửi bếp', err?.message ?? 'Không thể ghi món')
    } finally {
      setActionLoading(false)
    }
  }, [selectedRoom?.saleOrderId, newFoodItems])

  const handleCheckout = useCallback(async () => {
    if (!selectedRoom?.saleOrderId) {
      Alert.alert('Chưa mở phòng', 'Phòng chưa được mở. Hãy nhấn "Mở phòng" trước.')
      return
    }
    if (cart.length === 0) {
      Alert.alert('Đơn trống', 'Chưa có món nào trong đơn.')
      return
    }
    setActionLoading(true)
    try {
      // 0. Freeze timebased items nếu chưa freeze (y hệt AngularJS printBill)
      await freezeTimeBased()
      // 1. Gửi các món chưa submit
      if (newCartItems.length > 0) {
        await api.submitOrderItems(selectedRoom.saleOrderId, newCartItems.map(c => ({
          id: c.id,
          productId: c.productId ?? c.id, name: c.name,
          quantity: c.quantity,          // total
          submittedQty: c.submittedQty,  // delta = quantity - submittedQty cho POST
          price: c.price, unit: c.unit, note: c.note,
        })))
      }
      // 2. Thanh toán + cập nhật room → cleaning
      await api.checkout(selectedRoom.saleOrderId, selectedRoom.id, total, selectedPayMethod, discount)
      api.invalidateCache(['rooms']) // Clear rooms cache after checkout
      Alert.alert('Thanh toán thành công ✓', `${fmtVnd(total)} — ${selectedPayMethod}\nPhòng ${selectedRoom.name} chuyển sang dọn dẹp`)
      setCart([])
      setDiscount(0)
      setDiscountPct(0)
      setPayModal(false)
      // 3. Refresh rooms
      const apiRooms = await api.getRooms()
      const mapped = apiRooms.map(mapApiRoomToCashier)
      setRooms(mapped)
      setSelectedRoom(mapped.find(r => r.status === 'empty') ?? mapped[0] ?? null)
      setTab('rooms')
    } catch (err: any) {
      Alert.alert('Lỗi thanh toán', err?.message ?? 'Không thể thanh toán')
    } finally {
      setActionLoading(false)
    }
  }, [selectedRoom, cart, newCartItems, total, selectedPayMethod, discount])

  const handleLogout = async () => {
    try { await api.logout() } catch {}
    onBack()
  }

  const handleRoomCleaned = async (room: Room) => {
    setActionLoading(true)
    try {
      await api.markRoomCleaned(room.id)
      setChecklist(CLEANING_CHECKLIST.map(i => ({ ...i, checked: false })))
      setSelectedCleaningRoom(null)
      api.invalidateCache(['rooms'])
      const apiRooms = await api.getRooms()
      setRooms(apiRooms.map(mapApiRoomToCashier))
      setTab('rooms')
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message ?? 'Không thể cập nhật trạng thái phòng')
    } finally {
      setActionLoading(false)
    }
  }

  const loadBills = async (from = billsDateFrom, to = billsDateTo, append = false) => {
    const isLoadMore = append
    if (!isLoadMore) setBillsLoading(true)
    else setBillsLoadingMore(true)
    try {
      const startISO = from + 'T00:00:00Z'
      const endISO   = to + 'T23:59:59.999Z'
      const offset = append ? billsOffset : 0
      const limit = 20
      const orders = await api.getSaleOrders({
        where: { status: 'completed', updatedAt: { gte: startISO, lte: endISO } },
        order: 'updatedAt DESC',
        limit,
        skip: offset,
      })
      if (append) {
        setBillsList(prev => [...prev, ...orders])
        setBillsOffset(prev => prev + limit)
        setBillsHasMore(orders.length === limit)
      } else {
        setBillsList(orders)
        setBillsOffset(limit)
        setBillsHasMore(orders.length === limit)
      }
    } catch (err) {
      console.error('loadBills error:', err)
    } finally {
      if (!isLoadMore) setBillsLoading(false)
      else setBillsLoadingMore(false)
    }
  }

  const handleLoadMoreBills = useCallback(() => {
    if (!billsLoadingMore && billsHasMore) loadBills(billsDateFrom, billsDateTo, true)
  }, [billsLoadingMore, billsHasMore, billsDateFrom, billsDateTo])

  // Tự động load bills khi switch sang view hoá đơn
  useEffect(() => {
    if (view === 'bills' && billsList.length === 0) loadBills()
  }, [view])

  // Reload bills khi thay đổi date filter
  useEffect(() => {
    if (view === 'bills') {
      setBillsList([])
      setBillsOffset(0)
      setBillsHasMore(true)
      loadBills(billsDateFrom, billsDateTo, false)
    }
  }, [billsDateFrom, billsDateTo, view])

  // Tự động load dashboard khi switch sang tab Báo cáo
  useEffect(() => {
    if (view === 'dashboard' && !dashSummary) loadDashboard()
  }, [view])

  const loadDashboard = async (from = dashDateFrom, to = dashDateTo) => {
    setDashLoading(true)
    setDashSummary(null)
    try {
      const startISO = from + 'T00:00:00Z'
      const endISO   = to + 'T23:59:59.999Z'
      const orders = await api.getSaleOrders({
        where: { status: 'completed', updatedAt: { gte: startISO, lte: endISO } },
        order: 'updatedAt DESC',
      })
      const totalRevenue = orders.reduce((s, o) => s + (o.paidAmount || o.total || 0), 0)
      const transactions: DashTx[] = orders.map(o => {
        const d = new Date(o.updatedAt)
        return {
          time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
          code: o.code,
          paymentMethod: o.paymentMethod ?? 'Tiền mặt',
          amount: o.paidAmount || o.total,
          order: o,
        }
      })
      const fromLabel = from === todayStr() ? 'Hôm nay' : from
      const toLabel   = to   === todayStr() ? 'Hôm nay' : to
      const label = from === to ? fromLabel : `${fromLabel} → ${toLabel}`
      const summary: DashSummary = {
        totalRevenue, totalOrders: orders.length,
        avgOrder: orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0,
        label, transactions, topItems: [],
        totalCost: 0, totalProfit: 0,
      }
      setDashSummary(summary)
      // Load items for top 20 orders to compute top items + cost/profit
      if (orders.length > 0) {
        const batch = orders.slice(0, 20)
        const allItems = (await Promise.all(batch.map(o => api.getSaleOrderItems(o.id).catch(() => [])))).flat()
        // Build product cost lookup: productId → costPrice (Product.price = giá vốn)
        // menuItems đã load sẵn; fallback fetch nếu cần
        let productMap: Record<string, number> = {}
        menuItems.forEach(p => { productMap[p.id] = p.price })
        if (Object.keys(productMap).length === 0) {
          try {
            const prods = await api.getProducts()
            prods.forEach(p => { productMap[p.id] = p.price })
          } catch { /* silent */ }
        }
        const map: Record<string, DashTopItem> = {}
        allItems.forEach(item => {
          if (!map[item.name]) map[item.name] = { name: item.name, qty: 0, totalSales: 0, costTotal: 0, profitTotal: 0 }
          const costPerUnit = item.productId ? (productMap[item.productId] ?? 0) : 0
          map[item.name].qty += item.quantity
          map[item.name].totalSales += item.quantity * item.unitPrice
          map[item.name].costTotal += item.quantity * costPerUnit
          map[item.name].profitTotal += item.quantity * (item.unitPrice - costPerUnit)
        })
        const topItems = Object.values(map).sort((a, b) => b.profitTotal - a.profitTotal).slice(0, 10)
        const totalCost = topItems.reduce((s, i) => s + i.costTotal, 0)
        const totalProfit = topItems.reduce((s, i) => s + i.profitTotal, 0)
        setDashSummary(prev => prev ? { ...prev, topItems, totalCost, totalProfit } : prev)
      }
    } catch (err) {
      console.error('loadDashboard error:', err)
    } finally {
      setDashLoading(false)
    }
  }

  const openBillDetail = useCallback(async (order: api.SaleOrder) => {
    setBillDetail({ show: true, order, items: [], loading: true })
    try {
      const items = await api.getSaleOrderItems(order.id)
      setBillDetail(prev => ({ ...prev, items, loading: false }))
    } catch {
      setBillDetail(prev => ({ ...prev, loading: false }))
    }
  }, [])

  // Freeze tất cả timebased items tại thời điểm hiện tại (khi in bill hoặc thanh toán)
  // Trả về CartItem[] đã freeze để caller dùng ngay (setCart async — không dùng closure cart)
  const freezeTimeBased = useCallback((): CartItem[] => {
    const freezeTime = new Date()
    const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const endDate = toYMD(freezeTime)
    const endHH = String(freezeTime.getHours()).padStart(2, '0')
    const endMM = String(freezeTime.getMinutes()).padStart(2, '0')
    const end = `${endHH}:${endMM}`
    let frozenCart: CartItem[] = []
    setCart(prev => {
      frozenCart = prev.map(c => {
        if (!c.isTimeBased || c._endTime) return c   // đã freeze hoặc không phải timebased → giữ nguyên
        const startIso = c._startTime ?? freezeTime.toISOString()
        const bm = c._blockMinutes ?? 5
        const hours = calcTimeBasedQty(startIso, bm)   // nhất quán với timer interval
        return { ...c, quantity: hours, _manualEnd: end, _endTime: freezeTime.toISOString() }
      })
      return frozenCart
    })
    // Ghi printedAt lên server (silent)
    if (selectedRoom?.saleOrderId) {
      api.patchSaleOrder(selectedRoom.saleOrderId, { printedAt: freezeTime.toISOString(), timeFrozen: true }).catch(() => {})
    }
    return frozenCart
  }, [selectedRoom?.saleOrderId])

  // Resume time counting — xóa freeze, tính lại giờ từ startTime đến now
  const resumeTimeCounting = useCallback(() => {
    let newSubtotal = 0
    setCart(prev => {
      const updated = prev.map(c => {
        if (!c.isTimeBased) return c
        // Dùng cùng calcTimeBasedQty như timer interval → không bị flash khi timer chạy lại
        const qty = calcTimeBasedQty(c._startTime ?? new Date().toISOString(), c._blockMinutes ?? 5)
        return { ...c, quantity: qty, _manualEnd: undefined, _endTime: undefined }
      })
      newSubtotal = updated.reduce((s, c) => s + c.price * c.quantity, 0)
      return updated
    })
    // Nếu đang giảm theo %, tính lại với subtotal mới sau khi giờ thay đổi
    const patch: Record<string, unknown> = { timeFrozen: false }
    if (discountPct > 0) {
      const recalc = Math.round(newSubtotal * discountPct / 100)
      setDiscount(recalc)
      patch.discount = recalc
    }
    if (selectedRoom?.saleOrderId) {
      api.patchSaleOrder(selectedRoom.saleOrderId, patch).catch(() => {})
    }
  }, [selectedRoom?.saleOrderId, discountPct])

  // ── Đổi phòng ─────────────────────────────────────────────────────────────
  const handleChangeRoom = useCallback(async (newRoom: Room) => {
    if (!selectedRoom?.saleOrderId) return
    try {
      await api.changeRoom(
        selectedRoom.id,
        newRoom.id,
        selectedRoom.saleOrderId,
        (selectedRoom.startTime instanceof Date ? selectedRoom.startTime.toISOString() : selectedRoom.startTime) ?? new Date().toISOString(),
      )
      // Cập nhật local state
      setRooms(prev => prev.map(r => {
        if (r.id === selectedRoom.id) return { ...r, status: 'empty' as RoomStatus, saleOrderId: null, startTime: undefined }
        if (r.id === newRoom.id) return { ...r, status: 'occupied' as RoomStatus, saleOrderId: selectedRoom.saleOrderId, startTime: selectedRoom.startTime }
        return r
      }))
      setSelectedRoom(prev => prev ? { ...prev, id: newRoom.id, name: newRoom.name } : prev)
      setChangeRoomModal(false)
      setBillActionsOpen(false)
      Alert.alert('Đổi phòng', `Đã chuyển sang ${newRoom.name}`)
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ?? 'Không thể đổi phòng')
    }
  }, [selectedRoom])

  // ── Gộp bill ──────────────────────────────────────────────────────────────
  const handleMergeBill = useCallback(async (fromRoom: Room) => {
    if (!selectedRoom?.saleOrderId || !fromRoom.saleOrderId) return
    try {
      // Lấy items từ fromRoom rồi load về cart hiện tại
      const fromItems = await api.getSaleOrderItems(fromRoom.saleOrderId)
      await api.mergeBill(fromRoom.saleOrderId, fromRoom.id, selectedRoom.saleOrderId)
      // Thêm items vào cart local
      setCart(prev => {
        const merged = [...prev]
        for (const si of fromItems) {
          const existing = merged.find(c => c.productId === si.productId && !c.isTimeBased)
          if (existing) {
            existing.quantity += si.quantity
            existing.submittedQty = (existing.submittedQty ?? 0) + si.quantity
          } else {
            merged.push({
              id: `sol_${si.id}`,
              productId: si.productId,
              name: si.name,
              quantity: si.quantity,
              submittedQty: si.quantity,
              price: si.unitPrice,
              unit: si.unit,
              note: si.note ?? '',
              isSurcharge: false,
              isTimeBased: !!(si.timeBasedConfig),
            })
          }
        }
        return merged
      })
      setRooms(prev => prev.map(r =>
        r.id === fromRoom.id ? { ...r, status: 'cleaning' as RoomStatus, saleOrderId: null } : r
      ))
      setMergeBillModal(false)
      setBillActionsOpen(false)
      Alert.alert('Gộp bill', `Đã gộp ${fromRoom.name} vào ${selectedRoom.name}`)
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ?? 'Không thể gộp bill')
    }
  }, [selectedRoom])

  // ── Tách bill ─────────────────────────────────────────────────────────────
  const handleSplitBill = useCallback(async (toRoom: Room) => {
    if (!selectedRoom?.saleOrderId) return
    const itemsToSplit = splitBillModal.items.filter(i => i.toSplit)
    if (itemsToSplit.length === 0) {
      Alert.alert('Tách bill', 'Vui lòng chọn ít nhất 1 món')
      return
    }
    try {
      // checkIn phòng mới
      const newOrder = await api.checkIn(toRoom.id, '')
      // POST items sang phòng mới
      await api.submitOrderItems(newOrder.id, itemsToSplit.map(i => ({
        id: i.id.startsWith('sol_') ? i.id : undefined,
        productId: i.productId ?? i.id,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        unit: i.unit,
        note: i.note,
      })))
      // Xóa items đã tách khỏi cart hiện tại (và server)
      const splitIds = new Set(itemsToSplit.map(i => i.id))
      for (const item of itemsToSplit) {
        if (item.id.startsWith('sol_')) {
          api.deleteSaleOrderItem(item.id.slice(4)).catch(() => {})
        }
      }
      setCart(prev => prev.filter(c => !splitIds.has(c.id)))
      setRooms(prev => prev.map(r =>
        r.id === toRoom.id ? { ...r, status: 'occupied' as RoomStatus, saleOrderId: newOrder.id } : r
      ))
      setSplitBillModal({ show: false, items: [] })
      setBillActionsOpen(false)
      Alert.alert('Tách bill', `Đã tách ${itemsToSplit.length} món sang ${toRoom.name}`)
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ?? 'Không thể tách bill')
    }
  }, [selectedRoom, splitBillModal.items])

  // Build bill HTML (y hệt template AngularJS)
  const buildBillHtml = useCallback((frozenCart: CartItem[]) => {
    const fmt = (n: number) => n.toLocaleString('vi-VN')
    const roomName = selectedRoom?.name ?? ''
    const cashier = cashierName
    const printTime = new Date()
    const printTimeStr = printTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

    // Giờ vào: lấy từ timebased item đầu tiên hoặc startTime phòng
    const firstTB = frozenCart.find(c => c.isTimeBased && c._startTime)
    const singStart = firstTB?._startTime
      ? new Date(firstTB._startTime)
      : (selectedRoom?.startTime ?? null)

    const dateStr = (singStart ?? printTime).toLocaleDateString('vi-VN')

    // Tổng
    const subtotal = frozenCart.reduce((s, c) => s + c.price * c.quantity, 0)
    const billTotal = subtotal - discount

    const css = `
      body{font-family:Arial,"Helvetica Neue",sans-serif;font-size:12px;line-height:1.2;margin:0;padding:8px;max-width:420px;background:white}
      .center{text-align:center}.bold{font-weight:bold}
      .divider{border-top:1px dashed #000;margin:4px 0}
      .double-divider{border-top:2px solid #000;margin:4px 0}
      .item-header{display:flex;justify-content:space-between;font-weight:bold;font-size:11px}
      .item-header .col-name{flex:1}.item-header .col-qty{width:30px;text-align:center}
      .item-header .col-price{width:60px;text-align:right}.item-header .col-total{width:65px;text-align:right}
      .item-block{margin:2px 0}
      .item-line{display:flex;justify-content:space-between;align-items:baseline;font-size:12px}
      .item-line .col-name{flex:1;word-break:break-word;padding-right:4px}
      .item-line .col-qty{width:30px;text-align:center;white-space:nowrap}
      .item-line .col-price{width:60px;text-align:right;white-space:nowrap}
      .item-line .col-total{width:65px;text-align:right;white-space:nowrap;font-weight:bold}
      .note{font-size:11px;font-style:italic;color:#444;margin:0 0 2px 6px}
      .total-row{display:flex;justify-content:space-between;margin:2px 0;font-size:12px}
      .total-final{font-size:14px;font-weight:bold;border-top:1px solid #000;padding-top:4px;margin-top:4px}
      .item-row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}
      .item-row span:last-child{text-align:right}
    `

    let itemsHtml = ''
    frozenCart.forEach(item => {
      const rawNote = item.note || ''
      let note = rawNote
      if (rawNote.startsWith('Từ ')) {
        const dashIdx = rawNote.indexOf(' - ')
        note = dashIdx > -1 ? rawNote.substring(0, dashIdx) : rawNote
      }
      const total = item.price * item.quantity
      itemsHtml += `<div class="item-block"><div class="item-line">
        <span class="col-name">${item.name}</span>
        <span class="col-qty">${item.quantity}</span>
        <span class="col-price">${fmt(item.price)}</span>
        <span class="col-total">${fmt(total)}</span>
      </div>${note ? `<div class="note">${note}</div>` : ''}</div>`
    })

    const headerTime = singStart
      ? `<div class="item-row"><span>Giờ vào: ${singStart.toLocaleDateString('vi-VN')} ${singStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span><span>Giờ in: ${printTimeStr}</span></div>`
      : `<div class="item-row"><span>Ngày:</span><span>${dateStr}</span></div><div class="item-row"><span>Giờ in:</span><span>${printTimeStr}</span></div>`

    const discHtml = discount > 0
      ? `<div class="total-row"><span>Chiết khấu${discountPct > 0 ? ` (${discountPct}%)` : ''}:</span><span>-${fmt(discount)}</span></div>`
      : ''

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Phiếu tính tiền</title>
      <style>${css}</style></head><body>
      <div class="center">PHIẾU TÍNH TIỀN</div>
      <div class="divider"></div>
      ${headerTime}
      <div class="item-row"><span>Phòng:</span><span>${roomName}</span></div>
      <div class="item-row"><span>Nhân viên:</span><span>${cashier}</span></div>
      <div class="divider"></div>
      <div class="item-header">
        <span class="col-name">Tên món</span>
        <span class="col-qty">SL</span>
        <span class="col-price">Đơn giá</span>
        <span class="col-total">T.Tiền</span>
      </div>
      <div class="divider"></div>
      ${itemsHtml}
      <div class="double-divider"></div>
      <div class="total-row"><span>Tổng tiền hàng:</span><span>${fmt(subtotal)}</span></div>
      ${discHtml}
      <div class="total-row total-final"><span>TỔNG TIỀN:</span><span>${fmt(billTotal)}</span></div>
      <div class="divider"></div>
      <div class="center">Cảm ơn quý khách và hẹn gặp lại!!!</div>
    </body></html>`
  }, [selectedRoom, cashierName, discount])

  const handlePrintBill = useCallback(async () => {
    // freezeTimeBased trả về frozen cart đồng bộ → dùng ngay, không chờ setCart commit
    const frozenItems = freezeTimeBased()
    const html = buildBillHtml(frozenItems)
    // Lưu trạng thái in bill + snapshot giá trị (trước khi in, không phụ thuộc kết quả in)
    if (selectedRoom?.saleOrderId) {
      api.patchSaleOrder(selectedRoom.saleOrderId, {
        isPrinted:  true,
        printedAt:  new Date().toISOString(),
        discount:   discount,
        total:      total,
      }).catch(() => {})
    }
    try {
      await Print.printAsync({ html })
    } catch (err: any) {
      if (!String(err?.message).includes('cancelled')) {
        Alert.alert('Lỗi in', err?.message ?? 'Không thể in')
      }
    }
  }, [freezeTimeBased, buildBillHtml, selectedRoom?.saleOrderId, discount, total])

  // Open edit-time modal for a time-based item
  const openEditTime = useCallback((item: CartItem) => {
    const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const defBase = selectedRoom?.startTime ?? new Date()
    let startHH: string, startMM: string, startDate: string
    if (item._manualStart && item._startTime) {
      ;[startHH, startMM] = item._manualStart.split(':')
      startDate = toYMD(new Date(item._startTime))
    } else {
      startHH = String(defBase.getHours()).padStart(2, '0')
      startMM = String(defBase.getMinutes()).padStart(2, '0')
      startDate = toYMD(defBase)
    }
    let endHH: string, endMM: string, endDate: string
    if (item._manualEnd && item._endTime) {
      ;[endHH, endMM] = item._manualEnd.split(':')
      endDate = toYMD(new Date(item._endTime))
    } else {
      const now = new Date()
      endHH = String(now.getHours()).padStart(2, '0')
      endMM = String(now.getMinutes()).padStart(2, '0')
      endDate = toYMD(now)
    }
    setEditTimeModal({ show: true, item, startHH, startMM, startDate, showDatePick: false, endHH, endMM, endDate, showEndDatePick: false })
  }, [selectedRoom])

  const saveEditTime = async () => {
    const { item, startHH, startMM, startDate, endHH, endMM, endDate } = editTimeModal
    if (!item) return
    const start = `${startHH}:${startMM}`
    const [sy, smo, sday] = startDate.split('-').map(Number)
    const startBase = new Date(sy, smo - 1, sday, parseInt(startHH), parseInt(startMM), 0, 0)

    const isFrozen = !!item._endTime
    let hours: number
    let endBase: Date | undefined
    let end: string | undefined

    if (isFrozen && endHH && endMM && endDate) {
      const [ey, emo, eday] = endDate.split('-').map(Number)
      endBase = new Date(ey, emo - 1, eday, parseInt(endHH), parseInt(endMM), 0, 0)
      end = `${endHH}:${endMM}`
      const diffMs = endBase.getTime() - startBase.getTime()
      hours = Math.max(0.5, Math.ceil(diffMs / (30 * 60 * 1000)) * 0.5)
    } else {
      // Chưa freeze: chỉ cập nhật giờ vào, tính lại qty từ start → now
      const now = new Date()
      const diffMs = now.getTime() - startBase.getTime()
      hours = Math.max(0.5, Math.ceil(diffMs / (30 * 60 * 1000)) * 0.5)
    }

    setCart(prev => prev.map(c =>
      (c.id === item.id || (c.productId ?? c.id) === item.id)
        ? {
            ...c,
            quantity: hours,
            _manualStart: start,
            _startTime: startBase.toISOString(),
            _manualEnd: end,
            _endTime: endBase?.toISOString(),
          }
        : c
    ))
    setEditTimeModal(s => ({ ...s, show: false, item: null }))
    const solId = item.id.startsWith('sol_')
      ? item.id
      : (cart.find(c => (c.productId ?? c.id) === item.id && c.id.startsWith('sol_'))?.id ?? null)
    if (solId) {
      try {
        await api.patchSaleOrderItem(solId.slice(4), {
          quantity: hours,
          subtotal: hours * item.price,
        })
      } catch { /* silent — sẽ được sync lại qua silentPatchCart */ }
    }
  }

  const saveNote = async () => {
    if (!noteModal.item) return
    const item = noteModal.item
    const newNote = noteModal.text
    setCart(prev => prev.map(c => c.id === item.id ? { ...c, note: newNote } : c))
    setNoteModal({ show: false, item: null, text: '' })
    // PATCH server ngay nếu item đã có server ID (tránh bị silentPatchCart ghi đè)
    if (item.id.startsWith('sol_')) {
      try { await api.patchSaleOrderItem(item.id.slice(4), { note: newNote }) }
      catch { /* silent — note được sync khi submit tiếp */ }
    }
  }

  const Ico = ({ name, size = 14, color = '#9ca3af' }: { name: any; size?: number; color?: string }) =>
    <FontAwesome5 name={name} size={size} color={color} solid />

  // ── Rooms panel ───────────────────────────────────────────────────────────
  const RoomsPanel = () => {
    const { width } = useWindowDimensions()
    const isMobile = width < 768
    const cols = isMobile
      ? (rooms.length > ROOM_GRID_THREE_COLS_THRESHOLD ? 3 : 2)
      : Math.max(3, Math.floor(width / 180))
    const gap = isMobile && cols === 3 ? 8 : 10
    const pad = 10
    const usableWidth = width - pad * 2
    const tileW = Math.floor((usableWidth - gap * (cols - 1)) / cols)
    return (
      <ScrollView style={s.panel} contentContainerStyle={[s.roomGrid, { flexDirection: 'row', flexWrap: 'wrap', gap }]}>
        {rooms.map(room => {
          const col = roomColor(room.status)
          return (
            <TouchableOpacity key={room.id}
              style={[s.roomTile, { width: tileW, backgroundColor: col.bg, borderColor: col.border }, selectedRoom?.id === room.id && s.roomTileSelected]}
              activeOpacity={0.75}
              onPress={() => {
                if (room.status === 'empty') {
                  // Phòng trống: mở modal check-in
                  setCheckInModal({ show: true, room })
                } else if (room.id === selectedRoom?.id) {
                  // Cùng phòng đang chọn: chuyển sang bill tab và refresh items
                  setTab('bill')
                  if (room.status === 'occupied') loadExistingItems(room)
                } else {
                  // Phòng khác: select và load items từ server
                  selectRoom(room)
                }
              }}
            >
              <Ico name={roomIcon(room.status)} size={22} color="rgba(255,255,255,0.85)" />
              <Text style={s.roomTileName}>{room.name}</Text>
              {room.status === 'occupied' && room.timer
                ? <Text style={s.roomTileTimer}>{room.timer}</Text>
                : <Text style={s.roomTileStatus}>
                    {room.status === 'empty' ? 'Nhấn mở phòng'
                      : room.status === 'occupied' ? (room.customerName || 'Đang sử dụng')
                      : room.status === 'cleaning' ? 'Đang dọn'
                      : 'Bảo trì'}
                  </Text>
              }
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    )
  }

  // ── Bill panel ────────────────────────────────────────────────────────────
  const BillPanel = () => (
    <View style={s.panel}>
      {!selectedRoom ? (
        <View style={s.emptyBill}>
          <Ico name="hand-pointer" size={48} color="#4b5563" />
          <Text style={s.emptyBillText}>Chọn phòng để xem đơn</Text>
        </View>
      ) : selectedRoom.status === 'empty' ? (
        /* ── Phòng trống: CTA mở phòng ── */
        <View style={s.emptyBill}>
          <Ico name="door-open" size={52} color="#065f46" />
          <Text style={[s.emptyBillText, { color: '#34d399', fontSize: 18, marginTop: 12 }]}>{selectedRoom.name}</Text>
          <Text style={{ color: '#6b7280', marginBottom: 24 }}>Phòng trống — chưa mở</Text>
          <TouchableOpacity
            style={{ backgroundColor: '#16a34a', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            onPress={() => setCheckInModal({ show: true, room: selectedRoom })}>
            <Ico name="door-open" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Mở phòng</Text>
          </TouchableOpacity>
        </View>
      ) : selectedRoom.status === 'cleaning' ? (
        /* ── Phòng đang dọn ── */
        <View style={s.emptyBill}>
          <Ico name="broom" size={48} color="#92400e" />
          <Text style={[s.emptyBillText, { color: '#fbbf24' }]}>{selectedRoom.name} — Đang dọn dẹp</Text>
          <Text style={{ color: '#6b7280' }}>Chờ nhân viên phục vụ hoàn thành dọn phòng</Text>
        </View>
      ) : (
        <>
          {/* Room info bar */}
          <View style={s.billInfoBar}>
            <Text style={s.billInfoText}>Phòng: <Text style={{ fontWeight: '700', color: '#a78bfa' }}>{selectedRoom.name}</Text></Text>
            <Text style={s.billInfoText}>Vào: <Text style={{ fontWeight: '700' }}>{selectedRoom.startTime ? `${String(selectedRoom.startTime.getHours()).padStart(2,'0')}:${String(selectedRoom.startTime.getMinutes()).padStart(2,'0')}` : '--:--'}</Text></Text>
            <Text style={s.billInfoText}><Text style={{ fontWeight: '700' }}>{selectedRoom.customerName || 'Khách lẻ'}</Text></Text>
            <TouchableOpacity onPress={() => loadExistingItems(selectedRoom!)} disabled={itemsLoading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ico name={itemsLoading ? 'spinner' : 'sync-alt'} size={13} color={itemsLoading ? c.textFaint : '#60a5fa'} />
            </TouchableOpacity>
          </View>

          {/* Cart */}
          {/* Loading existing items */}
          {itemsLoading && (
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <ActivityIndicator color="#7c3aed" size="small" />
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>Đang tải đơn hàng...</Text>
            </View>
          )}

          <ScrollView style={s.cartScroll} contentContainerStyle={{ padding: 8, paddingBottom: 8 }}>
            {!itemsLoading && cart.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <Ico name="shopping-cart" size={32} color="#4b5563" />
                <Text style={{ color: '#6b7280', marginTop: 8 }}>Chưa có món — chọn tab Thực đơn để thêm</Text>
              </View>
            )}
            {cart.map(item => {
              const isNew = item.quantity > (item.submittedQty ?? 0) && !item.isTimeBased  // có delta chưa gửi
              return (
              <View key={item.id} style={[
                s.cartItem,
                item.isSurcharge && s.cartItemSurcharge,
                item.isTimeBased && { borderLeftWidth: 3, borderLeftColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)' },
                !item.isTimeBased && isNew && { borderLeftWidth: 3, borderLeftColor: '#16a34a' },
              ]}>
                <View style={s.cartItemTop}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {item.isTimeBased
                      ? <View style={{ backgroundColor: '#7c3aed', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>TIỀN GIỜ</Text>
                        </View>
                      : isNew && <View style={{ backgroundColor: '#16a34a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>MỚI</Text>
                        </View>}
                    <Text style={[s.cartItemName, item.isSurcharge && { color: '#fde68a' }]} numberOfLines={1}>
                      {(item.isTimeBased || item.isSurcharge) && <Ico name="clock" size={11} color={item.isSurcharge ? '#fde68a' : '#a78bfa'} />}
                      {'  '}{item.name}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {!item.isTimeBased && !item.isSurcharge && (
                      <TouchableOpacity onPress={() => setNoteModal({ show: true, item, text: item.note })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ico name="sticky-note" size={13} color={item.note ? '#d97706' : c.textFaint} />
                      </TouchableOpacity>
                    )}
                    {item.isTimeBased && (
                      <TouchableOpacity onPress={() => openEditTime(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ico name="edit" size={13} color="#60a5fa" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => removeItem(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ico name="trash" size={13} color="#f87171" />
                    </TouchableOpacity>
                  </View>
                </View>
                {item.note
                  ? <TouchableOpacity onPress={() => setNoteModal({ show: true, item, text: item.note })}>
                      <Text style={s.cartItemNote}><Ico name="sticky-note" size={10} color="#fbbf24" /> {item.note}</Text>
                    </TouchableOpacity>
                  : null}
                <View style={s.cartItemBottom}>
                  {!item.isTimeBased ? (
                    <View style={s.qtyRow}>
                      <TouchableOpacity style={s.qtyBtnMinus} onPress={() => updateQty(item.id, -1)}>
                        <Ico name="minus" size={10} color="#dc2626" />
                      </TouchableOpacity>
                      <Text style={s.qtyVal}>{item.quantity}</Text>
                      <TouchableOpacity style={s.qtyBtnPlus} onPress={() => updateQty(item.id, 1)}>
                        <Ico name="plus" size={10} color="#2563eb" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ gap: 2 }}>
                      <Text style={{ color: '#2563eb', fontWeight: '700', fontSize: 13 }}>
                        <Ico name="clock" size={11} color="#2563eb" /> {item.quantity} giờ
                      </Text>
                      <Text style={{ color: c.textMuted, fontSize: 11 }}>
                        <Ico name="play-circle" size={10} color="#16a34a" />
                        {' '}{item._manualStart ?? (selectedRoom?.startTime
                          ? `${String(selectedRoom.startTime.getHours()).padStart(2,'0')}:${String(selectedRoom.startTime.getMinutes()).padStart(2,'0')}`
                          : '--:--')}
                        {' → '}
                        {item._manualEnd
                          ? <><Ico name="stop-circle" size={10} color="#dc2626" /> {item._manualEnd}</>
                          : <Text style={{ color: c.textMuted }}>hiện tại</Text>}
                      </Text>
                    </View>
                  )}
                  <Text style={[s.cartItemPrice, item.isSurcharge && { color: '#fbbf24' }]}>
                    {fmtVnd(item.price * item.quantity)}
                  </Text>
                </View>
              </View>
            )})}
          </ScrollView>

          {/* Gửi bếp — chỉ hiển thị khi có food items mới (không gồm tiền giờ) */}
          {newFoodItems.length > 0 && (
            <TouchableOpacity
              style={{ backgroundColor: '#1d4ed8', marginHorizontal: 8, marginBottom: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, gap: 8 }}
              onPress={handleSendToKitchen} disabled={actionLoading}>
              <Ico name="bell" size={13} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                Gửi bếp {newFoodItems.length} món
              </Text>
            </TouchableOpacity>
          )}

          {/* Totals */}
          <View style={s.totals}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Tiền giờ:</Text>
              <Text style={s.totalValue}>{fmtVnd(roomCharge)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Tiền món:</Text>
              <Text style={s.totalValue}>{fmtVnd(foodTotal)}</Text>
            </View>
            {discount > 0 && <>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>{discountPct > 0 ? `Giảm ${discountPct}%:` : 'Giảm giá:'}</Text>
                <Text style={[s.totalValue, { color: '#f87171' }]}>-{fmtVnd(discount)}</Text>
              </View>
            </>}
            <View style={[s.totalRow, { marginTop: 4 }]}>
              <Text style={[s.totalLabel, { fontSize: 15, fontWeight: '700', color: c.text }]}>Tổng cộng:</Text>
              <Text style={s.totalBig}>{fmtVnd(total)}</Text>
            </View>
          </View>

          {/* Frozen indicator — hiện khi đã in bill */}
          {!isWaiterMode && cart.some(c => c.isTimeBased && c._endTime) && (
            <View style={s.frozenBar}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <FontAwesome5 name="pause-circle" size={14} color="#93c5fd" solid />
                <Text style={s.frozenBarText}>Đang ngưng tính giờ</Text>
              </View>
              <TouchableOpacity style={s.frozenBarBtn} onPress={resumeTimeCounting}>
                <Text style={s.frozenBarBtnText}>Tiếp tục tính</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Action buttons — ẩn khi waiter mode (chỉ gửi bếp, không thanh toán) */}
          {!isWaiterMode && (
          <View style={[s.actionArea, { paddingBottom: insets.bottom + 8 }]}>
            <View style={s.actionGrid}>
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#4f46e5' }]} onPress={handlePrintBill}>
                <Ico name="print" size={12} color="#fff" /><Text style={s.actionBtnText}> In bill</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#16a34a' }]} onPress={() => setPayModal(true)}>
                <Ico name="credit-card" size={12} color="#fff" /><Text style={s.actionBtnText}> Thanh toán</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#ea580c' }]} onPress={() => { const m = discountPct > 0 ? 'percent' : 'amount'; setDiscountMode(m); setDiscountInput(m === 'percent' ? String(discountPct) : (discount > 0 ? String(discount) : '')); setDiscountModal(true) }}>
                <Ico name="tag" size={12} color="#fff" /><Text style={s.actionBtnText}> Giảm giá</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.actionBtnMore} onPress={() => setBillActionsOpen(true)}>
                <Ico name="ellipsis-h" size={14} color={c.textSub} />
                <Text style={[s.actionBtnText, { color: c.textSub }]}>Khác</Text>
              </TouchableOpacity>
            </View>
          </View>
          )}

          {/* More actions sheet */}
          <Modal visible={billActionsOpen} transparent animationType="slide" onRequestClose={() => setBillActionsOpen(false)}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setBillActionsOpen(false)} />
            <View style={s.moreActionsSheet}>
              <View style={s.moreActionsHandle} />
              <TouchableOpacity style={s.moreActionsItem} onPress={() => { setBillActionsOpen(false); setChangeRoomModal(true) }}>
                <View style={[s.moreActionsIcon, { backgroundColor: '#7c3aed' }]}><Ico name="exchange-alt" size={15} color="#fff" /></View>
                <Text style={s.moreActionsText}>Đổi phòng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.moreActionsItem} onPress={() => { setBillActionsOpen(false); setMergeBillModal(true) }}>
                <View style={[s.moreActionsIcon, { backgroundColor: '#be185d' }]}><Ico name="compress-alt" size={15} color="#fff" /></View>
                <Text style={s.moreActionsText}>Gộp bill</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.moreActionsItem} onPress={() => {
                if (cart.length === 0) { Alert.alert('Tách bill', 'Không có món để tách'); return }
                setSplitBillModal({ show: true, items: cart.map(i => ({ ...i, toSplit: false })) })
                setBillActionsOpen(false)
              }}>
                <View style={[s.moreActionsIcon, { backgroundColor: '#be185d' }]}><Ico name="expand-alt" size={15} color="#fff" /></View>
                <Text style={s.moreActionsText}>Tách bill</Text>
              </TouchableOpacity>
            </View>
          </Modal>

          {/* ── Modal Đổi phòng ─────────────────────────────────────────── */}
          <Modal visible={changeRoomModal} transparent animationType="slide" onRequestClose={() => setChangeRoomModal(false)}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setChangeRoomModal(false)} />
            <View style={s.roomPickSheet}>
              <View style={s.moreActionsHandle} />
              <Text style={s.roomPickTitle}><FontAwesome5 name="exchange-alt" size={13} color="#a78bfa" solid />{'  '}Đổi phòng</Text>
              <Text style={s.roomPickSub}>Chọn phòng trống để chuyển bill sang</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {rooms.filter(r => r.status === 'empty' && r.id !== selectedRoom?.id).map(r => (
                  <TouchableOpacity key={r.id} style={s.roomPickItem}
                    onPress={() => {
                      Alert.alert('Đổi phòng', `Chuyển từ ${selectedRoom?.name} sang ${r.name}?`, [
                        { text: 'Huỷ', style: 'cancel' },
                        { text: 'Xác nhận', onPress: () => handleChangeRoom(r) },
                      ])
                    }}>
                    <View style={[s.roomPickDot, { backgroundColor: '#22c55e' }]} />
                    <Text style={s.roomPickName}>{r.name}</Text>
                    <Text style={s.roomPickStatus}>Trống</Text>
                  </TouchableOpacity>
                ))}
                {rooms.filter(r => r.status === 'empty' && r.id !== selectedRoom?.id).length === 0 && (
                  <Text style={s.roomPickEmpty}>Không có phòng trống</Text>
                )}
              </ScrollView>
            </View>
          </Modal>

          {/* ── Modal Gộp bill ──────────────────────────────────────────── */}
          <Modal visible={mergeBillModal} transparent animationType="slide" onRequestClose={() => setMergeBillModal(false)}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setMergeBillModal(false)} />
            <View style={s.roomPickSheet}>
              <View style={s.moreActionsHandle} />
              <Text style={s.roomPickTitle}><FontAwesome5 name="compress-alt" size={13} color="#f472b6" solid />{'  '}Gộp bill</Text>
              <Text style={s.roomPickSub}>Chọn phòng đang sử dụng để gộp vào {selectedRoom?.name}</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {rooms.filter(r => r.status === 'occupied' && r.id !== selectedRoom?.id).map(r => (
                  <TouchableOpacity key={r.id} style={s.roomPickItem}
                    onPress={() => {
                      Alert.alert('Gộp bill', `Gộp bill ${r.name} vào ${selectedRoom?.name}?`, [
                        { text: 'Huỷ', style: 'cancel' },
                        { text: 'Xác nhận', onPress: () => handleMergeBill(r) },
                      ])
                    }}>
                    <View style={[s.roomPickDot, { backgroundColor: '#ef4444' }]} />
                    <Text style={s.roomPickName}>{r.name}</Text>
                    <Text style={s.roomPickStatus}>Đang dùng</Text>
                  </TouchableOpacity>
                ))}
                {rooms.filter(r => r.status === 'occupied' && r.id !== selectedRoom?.id).length === 0 && (
                  <Text style={s.roomPickEmpty}>Không có phòng nào đang sử dụng</Text>
                )}
              </ScrollView>
            </View>
          </Modal>

          {/* ── Modal Tách bill ─────────────────────────────────────────── */}
          <Modal visible={splitBillModal.show} transparent animationType="slide" onRequestClose={() => setSplitBillModal({ show: false, items: [] })}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSplitBillModal({ show: false, items: [] })} />
              <View style={[s.roomPickSheet, { maxHeight: '85%' }]}>
                <View style={s.moreActionsHandle} />
                <Text style={s.roomPickTitle}><FontAwesome5 name="expand-alt" size={13} color="#f472b6" solid />{'  '}Tách bill</Text>
                <Text style={s.roomPickSub}>Chọn món cần tách, sau đó chọn phòng đích</Text>

                {/* Danh sách món để chọn */}
                <ScrollView style={{ maxHeight: 200, marginBottom: 10 }}>
                  {splitBillModal.items.map((item, idx) => (
                    <TouchableOpacity key={item.id} style={s.splitItemRow}
                      onPress={() => setSplitBillModal(prev => ({
                        ...prev,
                        items: prev.items.map((i, j) => j === idx ? { ...i, toSplit: !i.toSplit } : i)
                      }))}>
                      <View style={[s.splitCheckbox, item.toSplit && s.splitCheckboxChecked]}>
                        {item.toSplit && <FontAwesome5 name="check" size={10} color="#fff" solid />}
                      </View>
                      <Text style={[s.splitItemName, item.toSplit && { color: '#f0abfc' }]} numberOfLines={1}>{item.name}</Text>
                      <Text style={s.splitItemQty}>x{item.quantity}</Text>
                      <Text style={s.splitItemPrice}>{(item.quantity * item.price).toLocaleString('vi-VN')}đ</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={{ height: 1, backgroundColor: '#374151', marginBottom: 8 }} />
                <Text style={[s.roomPickSub, { marginBottom: 6 }]}>Chọn phòng đích (trống)</Text>
                <ScrollView style={{ maxHeight: 180 }}>
                  {rooms.filter(r => r.status === 'empty').map(r => (
                    <TouchableOpacity key={r.id} style={s.roomPickItem}
                      onPress={() => {
                        const cnt = splitBillModal.items.filter(i => i.toSplit).length
                        if (cnt === 0) { Alert.alert('Tách bill', 'Chọn ít nhất 1 món'); return }
                        Alert.alert('Tách bill', `Tách ${cnt} món sang ${r.name}?`, [
                          { text: 'Huỷ', style: 'cancel' },
                          { text: 'Xác nhận', onPress: () => handleSplitBill(r) },
                        ])
                      }}>
                      <View style={[s.roomPickDot, { backgroundColor: '#22c55e' }]} />
                      <Text style={s.roomPickName}>{r.name}</Text>
                      <Text style={s.roomPickStatus}>Trống</Text>
                    </TouchableOpacity>
                  ))}
                  {rooms.filter(r => r.status === 'empty').length === 0 && (
                    <Text style={s.roomPickEmpty}>Không có phòng trống</Text>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      )}
    </View>
  )

  // ── Menu panel ────────────────────────────────────────────────────────────
  const MenuPanel = () => {
    const { width } = useWindowDimensions()
    const isMobile = width < 760
    const hasManyMenuItems = filteredMenu.length > MENU_GRID_THREE_COLS_THRESHOLD
    const cols = isMobile
      ? (hasManyMenuItems ? (width >= 360 ? 3 : 2) : (width >= 380 ? 2 : 1))
      : (width >= 980 ? 4 : 3)
    const gap = 10
    const pad = 10
    const usableWidth = width - pad * 2
    const cardW = Math.floor((usableWidth - gap * (cols - 1)) / cols)

    return (
    <View style={s.panel}>
      {/* Search bar */}
      <View style={s.menuSearchBar}>
        <FontAwesome5 name="search" size={13} color="#6b7280" solid />
        <TextInput
          style={s.menuSearchInput}
          placeholder="Tìm món..."
          placeholderTextColor="#6b7280"
          value={menuSearch}
          onChangeText={setMenuSearch}
          returnKeyType="search"
        />
        {menuSearch.length > 0 && (
          <TouchableOpacity onPress={() => setMenuSearch('')}>
            <FontAwesome5 name="times-circle" size={14} color="#6b7280" solid />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catStrip} contentContainerStyle={{ paddingHorizontal: 8, gap: 8, paddingVertical: 6 }}>
        {categories.map(cat => (
          <TouchableOpacity key={cat.id} style={selectedCat === cat.id ? s.catActive : s.catBtn} onPress={() => setSelectedCat(cat.id)}>
            <Text style={selectedCat === cat.id ? s.catActiveText : s.catBtnText}>{cat.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.menuGrid, { gap }]}>
        {filteredMenu.map(item => (
          <TouchableOpacity key={item.id} style={[s.menuCard, { width: cardW }, !!item.image && s.menuCardWithImage, item.isTimeBased && !item.image && { borderWidth: 1, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' }]} activeOpacity={0.75}
            onPress={() => {
              addToCart(item)
              if (item.isTimeBased) {
                // Mở modal chỉnh giờ cho time-based item
                const existing = cart.find(c => c.id === item.id)
                if (!existing) {
                  setTimeout(() => {
                    const newItem: CartItem = { id: item.id, name: item.name, quantity: 1, unit: 'giờ', price: item.price, note: '', isTimeBased: true }
                    openEditTime(newItem)
                  }, 50)
                }
              } else {
                // Chỉ thêm vào cart, không tự mở draft cart
                // User tự mở bằng cách nhấn vào thanh ở dưới
              }
            }}>
            {!!item.image ? (
              <ImageBackground source={{ uri: item.image }} style={s.menuBgImage} imageStyle={s.menuBgImageInner}>
                <View style={s.menuImageOverlay} />
                <View style={s.menuCardContent}>
                  <Text style={[s.menuName, { color: '#fff' }]} numberOfLines={2}>
                    {item.isTimeBased && <><Ico name="clock" size={11} color="#ffffff" />{'  '}</>}{item.name}
                  </Text>
                  <Text style={[s.menuPrice, { color: '#fff' }]}>{fmtVnd(item.price)}<Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>{item.isTimeBased ? '/giờ' : ''}</Text></Text>
                  <View style={s.menuFooter}>
                    <Text style={[s.menuStock, { color: '#e2e8f0' }]}>{item.isTimeBased ? 'Tính giờ' : `${item.stock} ${item.unit}`}</Text>
                    <View style={[s.menuAddBtn, item.isTimeBased && { backgroundColor: '#7c3aed' }]}><Ico name={item.isTimeBased ? 'clock' : 'plus'} size={11} color="#fff" /></View>
                  </View>
                </View>
              </ImageBackground>
            ) : (
              <View style={s.menuCardContent}>
                <Text style={[s.menuName, item.isTimeBased && { color: '#a78bfa' }]} numberOfLines={2}>
                  {item.isTimeBased && <><Ico name="clock" size={11} color="#a78bfa" />{'  '}</>}{item.name}
                </Text>
                <Text style={s.menuPrice}>{fmtVnd(item.price)}<Text style={{ fontSize: 10, color: '#6b7280' }}>{item.isTimeBased ? '/giờ' : ''}</Text></Text>
                <View style={s.menuFooter}>
                  <Text style={s.menuStock}>{item.isTimeBased ? 'Tính giờ' : `${item.stock} ${item.unit}`}</Text>
                  <View style={[s.menuAddBtn, item.isTimeBased && { backgroundColor: '#7c3aed' }]}><Ico name={item.isTimeBased ? 'clock' : 'plus'} size={11} color="#fff" /></View>
                </View>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Floating draft cart bar ── */}
      {newFoodItems.length > 0 && (
        <TouchableOpacity
          style={{ backgroundColor: '#1d4ed8', margin: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 6 }}
          activeOpacity={0.85}
          onPress={() => setDraftCartOpen(true)}
        >
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{newFoodItems.reduce((s, c) => s + (c.quantity - (c.submittedQty ?? 0)), 0)}</Text>
          </View>
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13, flex: 1 }}>
            {newFoodItems.length} món chưa gửi bếp{'  '}
            <Text style={{ fontWeight: '400', fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
              {fmtVnd(newFoodItems.reduce((s, ci) => s + ci.price * (ci.quantity - (ci.submittedQty ?? 0)), 0))}
            </Text>
          </Text>
          <Ico name="chevron-up" size={12} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      )}

      {/* ── Draft cart sheet (Modal) ── */}
      <Modal visible={draftCartOpen} transparent animationType="slide" onRequestClose={() => setDraftCartOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setDraftCartOpen(false)} />
        <View style={{ backgroundColor: c.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '75%' }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border }} />
          </View>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <Ico name="shopping-cart" size={14} color="#7c3aed" />
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, flex: 1, marginLeft: 8 }}>
              Giỏ nháp — {newFoodItems.length} loại
            </Text>
            <TouchableOpacity onPress={() => setDraftCartOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ico name="chevron-down" size={16} color={c.textMuted} />
            </TouchableOpacity>
          </View>
          {/* Items list */}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
            {newFoodItems.map(item => {
              const pendingQty = item.quantity - (item.submittedQty ?? 0)
              return (
                <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderFaint }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>{item.name}</Text>
                    {!!item.note && <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 1 }}>📝 {item.note}</Text>}
                    <Text style={{ color: '#7c3aed', fontSize: 12, marginTop: 2 }}>
                      {fmtVnd(item.price)} × {pendingQty} = {fmtVnd(item.price * pendingQty)}
                    </Text>
                  </View>
                  {/* Note button */}
                  <TouchableOpacity
                    onPress={() => setNoteModal({ show: true, item, text: item.note ?? '' })}
                    style={{ padding: 8 }}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Ico name="edit" size={13} color={item.note ? '#60a5fa' : c.textMuted} />
                  </TouchableOpacity>
                  {/* Qty controls */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => updateQty(item.id, -1)}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.elevated, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Ico name="minus" size={10} color={c.text} />
                    </TouchableOpacity>
                    <Text style={{ color: c.text, fontWeight: '700', minWidth: 24, textAlign: 'center', fontSize: 14 }}>
                      {item.quantity}
                    </Text>
                    <TouchableOpacity
                      onPress={() => updateQty(item.id, 1)}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Ico name="plus" size={10} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })}
          </ScrollView>
          {/* Send to kitchen */}
          <View style={{ padding: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: c.border }}>
            <TouchableOpacity
              style={{ backgroundColor: '#1d4ed8', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, gap: 8 }}
              onPress={() => { setDraftCartOpen(false); handleSendToKitchen() }}
              disabled={actionLoading}
            >
              <Ico name="bell" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                Gửi bếp {newFoodItems.length} món
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )}

  // ── Cleaning panel (waiter mode only) ─────────────────────────────────────
  const CleaningPanel = () => {
    const allDone = checklist.every(i => i.checked)

    // ── Sub-view 1: Danh sách phòng cần dọn ──────────────────────────────
    if (!selectedCleaningRoom) {
      return (
        <View style={s.panel}>
          {cleaningRooms.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <FontAwesome5 name="check-circle" size={52} color="#22c55e" solid />
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 18 }}>Không có phòng cần dọn</Text>
              <Text style={{ color: c.textMuted }}>Tất cả phòng đã sạch sẽ!</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
              <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
                {cleaningRooms.length} phòng cần dọn
              </Text>
              {cleaningRooms.map(room => (
                <TouchableOpacity
                  key={room.id}
                  style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderLeftWidth: 4, borderLeftColor: '#f59e0b', flexDirection: 'row', alignItems: 'center', gap: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 }}
                  activeOpacity={0.75}
                  onPress={() => {
                    setSelectedCleaningRoom(room)
                    setChecklist(CLEANING_CHECKLIST.map(i => ({ ...i, checked: false })))
                  }}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(245,158,11,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                    <FontAwesome5 name="broom" size={20} color="#f59e0b" solid />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{room.name}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>Nhấn để bắt đầu dọn</Text>
                  </View>
                  <FontAwesome5 name="chevron-right" size={14} color={c.textFaint} solid />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )
    }

    // ── Sub-view 2: Checklist của phòng đã chọn ──────────────────────────
    return (
      <View style={s.panel}>
        {/* Sub-header: tên phòng + nút back */}
        <View style={{ backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: c.border, gap: 12 }}>
          <TouchableOpacity onPress={() => setSelectedCleaningRoom(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <FontAwesome5 name="arrow-left" size={15} color={c.textSub} solid />
          </TouchableOpacity>
          <FontAwesome5 name="broom" size={15} color="#f59e0b" solid />
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 16, flex: 1 }}>{selectedCleaningRoom.name}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>
            {checklist.filter(i => i.checked).length}/{checklist.length}
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          {checklist.map(item => (
            <TouchableOpacity
              key={item.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 2, borderColor: item.checked ? '#22c55e' : c.border }}
              activeOpacity={0.75}
              onPress={() => setChecklist(prev => prev.map(ci => ci.id === item.id ? { ...ci, checked: !ci.checked } : ci))}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: item.checked ? '#22c55e' : c.elevated, alignItems: 'center', justifyContent: 'center' }}>
                <FontAwesome5 name={item.checked ? 'check' : 'circle'} size={14} color={item.checked ? '#fff' : '#9ca3af'} solid />
              </View>
              <Text style={{ flex: 1, fontSize: 15, color: item.checked ? c.textFaint : c.text, textDecorationLine: item.checked ? 'line-through' : 'none' }}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16, borderTopWidth: 1, borderTopColor: c.border }}>
          <TouchableOpacity
            style={{ backgroundColor: allDone ? '#16a34a' : c.elevated, borderRadius: 12, paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 }}
            activeOpacity={0.8}
            onPress={() => handleRoomCleaned(selectedCleaningRoom)}
            disabled={actionLoading || !allDone}
          >
            <FontAwesome5 name="check-circle" size={18} color={allDone ? '#fff' : c.textFaint} solid />
            <Text style={{ color: allDone ? '#fff' : c.textFaint, fontSize: 16, fontWeight: '700' }}>
              {actionLoading ? 'Đang lưu...' : allDone ? 'Hoàn tất dọn phòng' : `Còn ${checklist.filter(i => !i.checked).length} mục chưa xong`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={{ color: c.textMuted, marginTop: 12 }}>Đang tải dữ liệu...</Text>
        </View>
      </SafeAreaView>
    )
  }

  const isDark = mode === 'dark'
  const billsCardBg = isDark ? '#1f2937' : '#ffffff'
  const billsCardBorder = isDark ? '#374151' : '#dbe4f0'
  const billStatusBg = isDark ? '#14532d' : '#dcfce7'
  const billStatusText = isDark ? '#4ade80' : '#166534'
  const detailBg = isDark ? '#111827' : '#ffffff'
  const detailBorder = isDark ? '#1f2937' : '#e2e8f0'

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.headerLeft}>
          <FontAwesome5 name="arrow-left" size={13} color="rgba(255,255,255,0.6)" solid />
          <View style={s.headerTextWrap}>
            <Text style={s.headerTitle} numberOfLines={1}>{isWaiterMode ? 'Phục vụ - Kara Pos' : 'Thu Ngân - Kara Pos'}</Text>
            <Text style={s.headerSub} numberOfLines={1}>
              {selectedStore?.name ? `${selectedStore.name} • ${timeStr}` : timeStr}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={s.headerRight}>
          {!isWaiterMode && (
            <TouchableOpacity
              style={[s.headerTab, view === 'bills' && s.headerTabActive]}
              onPress={() => setView('bills')}
            >
              <Text style={[s.headerTabText, view === 'bills' && { color: '#fff' }]}>Xem hoá đơn</Text>
            </TouchableOpacity>
          )}
          {/* Overflow */}
          {overflowOpen && (
            <Modal transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
              <TouchableOpacity style={s.overlayFull} activeOpacity={1} onPress={() => setOverflowOpen(false)}>
                <View style={s.dropdown}>
                  <TouchableOpacity style={s.dropdownItem} onPress={() => { toggle(); setOverflowOpen(false) }}>
                    <Ico name={mode === 'dark' ? 'sun' : 'moon'} size={13} color="#fbbf24" />
                    <Text style={s.dropdownText}>{mode === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}</Text>
                  </TouchableOpacity>
                  <View style={s.dropdownDivider} />
                  <TouchableOpacity style={s.dropdownItem} onPress={() => { handleLogout() }}>
                    <Ico name="sign-out-alt" size={13} color="#f87171" />
                    <Text style={[s.dropdownText, { color: '#f87171' }]}>Đăng xuất</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </Modal>
          )}
          <TouchableOpacity style={[s.headerTab, { width: 32, justifyContent: 'center' }]} onPress={() => setOverflowOpen(o => !o)}>
            <Ico name="ellipsis-v" size={14} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Mobile tab bar (always visible) ── */}
      <View style={s.mobileTabs}>
        {(isWaiterMode
          ? [['rooms','Phòng','door-open'],['bill','Đơn','receipt'],['menu','Thực đơn','utensils'],['cleaning','Dọn','broom']] as const
          : [['rooms','Phòng','door-open'],['bill','Hóa đơn','receipt'],['menu','Thực đơn','utensils'],['history','Báo cáo','chart-bar']] as const
        ).map(([key, label, icon]) => {
          const isActive = key === 'history' ? view === 'dashboard' : (view === 'pos' && tab === key)
          const badge = key === 'cleaning' && cleaningRooms.length > 0 ? cleaningRooms.length : undefined
          return (
            <TouchableOpacity key={key} style={[s.mobileTab, isActive && s.mobileTabActive]}
              onPress={() => {
                if (key === 'history') { setView('dashboard') }
                else { setView('pos'); setTab(key as MobileTab) }
              }}>
              <View style={{ position: 'relative' }}>
                <Ico name={icon} size={13} color={isActive ? '#a78bfa' : '#6b7280'} />
                {badge != null && (
                  <View style={{ position: 'absolute', top: -5, right: -8, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[s.mobileTabText, isActive && { color: '#a78bfa' }]}>{label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* ── POS view ── */}
      {view === 'pos' && (
        <>
          {tab === 'rooms'    && <RoomsPanel />}
          {tab === 'bill'     && BillPanel()}
          {tab === 'menu'     && <MenuPanel />}
          {tab === 'cleaning' && CleaningPanel()}
        </>
      )}

      {/* ── Bills view ── */}
      {view === 'bills' && (
        <View style={{ flex: 1 }}>
          <View style={{ backgroundColor: s.root.backgroundColor, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: c.textMuted, fontWeight: '700', fontSize: 13 }}>Lịch sử hoá đơn</Text>
              <TouchableOpacity onPress={() => { setBillsDateFrom(todayStr()); setBillsDateTo(todayStr()) }} style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.elevated, borderRadius: 6 }}>
                <Text style={{ color: c.textMuted, fontSize: 11 }}>Hôm nay</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.textMuted, fontSize: 10 }}>Từ</Text>
                <TextInput style={{ flex: 1, color: c.text, fontSize: 11 }} value={billsDateFrom} onChangeText={setBillsDateFrom}
                  placeholder="YYYY-MM-DD" placeholderTextColor={c.textFaint} keyboardType="numbers-and-punctuation" />
              </View>
              <Text style={{ color: c.textMuted }}>→</Text>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.textMuted, fontSize: 10 }}>Đến</Text>
                <TextInput style={{ flex: 1, color: c.text, fontSize: 11 }} value={billsDateTo} onChangeText={setBillsDateTo}
                  placeholder="YYYY-MM-DD" placeholderTextColor={c.textFaint} keyboardType="numbers-and-punctuation" />
              </View>
            </View>
          </View>
          {billsLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#7c3aed" />
            </View>
          ) : billsList.length === 0 ? (
            <View style={s.comingSoon}>
              <FontAwesome5 name="receipt" size={40} color={c.textFaint} solid />
              <Text style={{ color: c.textMuted, marginTop: 12, fontSize: 16 }}>Chưa có hoá đơn</Text>
              <TouchableOpacity onPress={() => loadBills()} style={{ marginTop: 12, backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Tải hoá đơn</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, gap: 8, paddingBottom: 20 }}
              onScroll={(e) => {
                const offsetY = e.nativeEvent.contentOffset.y
                const contentHeight = e.nativeEvent.contentSize.height
                const scrollViewHeight = e.nativeEvent.layoutMeasurement.height
                if (offsetY + scrollViewHeight >= contentHeight - 100) handleLoadMoreBills()
              }}
              scrollEventThrottle={300}>
              {billsList.map(order => {
                const d = new Date(order.updatedAt)
                const billTime = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
                return (
                  <TouchableOpacity
                    key={order.id}
                    activeOpacity={0.75}
                    style={{ backgroundColor: billsCardBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: billsCardBorder, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                    onPress={() => openBillDetail(order)}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{order.code}</Text>
                        <View style={{ backgroundColor: billStatusBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: billStatusText, fontSize: 10, fontWeight: '700' }}>HT</Text>
                        </View>
                      </View>
                      <Text style={{ color: c.textMuted, fontSize: 11 }}>{order.room?.name ?? order.roomId} · {order.paymentMethod ?? 'N/A'} · {billTime}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 14 }}>{fmtVnd(order.paidAmount || order.total)}</Text>
                      <FontAwesome5 name="chevron-right" size={11} color={c.textFaint} solid />
                    </View>
                  </TouchableOpacity>
                )
              })}
              {billsLoadingMore && (
                <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                  <ActivityIndicator color="#7c3aed" />
                </View>
              )}
              {!billsHasMore && billsList.length > 0 && (
                <Text style={{ color: c.textFaint, fontSize: 12, textAlign: 'center', paddingVertical: 16 }}>Hết dữ liệu</Text>
              )}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Dashboard / Báo cáo view ── */}
      {view === 'dashboard' && (
        <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
          {/* Date range picker */}
          <View style={s.dashCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={s.dashSectionTitle}>Tổng hợp thu ngân</Text>
              <TouchableOpacity style={s.dashTodayBtn} onPress={() => {
                const t = todayStr(); setDashDateFrom(t); setDashDateTo(t); loadDashboard(t, t)
              }}>
                <FontAwesome5 name="calendar-day" size={11} color="#fff" solid />
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', marginLeft: 4 }}>Hôm nay</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity style={s.dashDateBox} onPress={() => {
                const [y, m, d] = dashDateFrom.split('-').map(Number)
                setDashPickerDate(new Date(y, m - 1, d))
                setDashPickerType('from')
              }}>
                <Text style={s.dashDateLabel}>Từ</Text>
                <Text style={[s.dashDateInput, { paddingTop: 6 }]}>{dashDateFrom}</Text>
              </TouchableOpacity>
              <Text style={{ color: c.textMuted }}>→</Text>
              <TouchableOpacity style={s.dashDateBox} onPress={() => {
                const [y, m, d] = dashDateTo.split('-').map(Number)
                setDashPickerDate(new Date(y, m - 1, d))
                setDashPickerType('to')
              }}>
                <Text style={s.dashDateLabel}>Đến</Text>
                <Text style={[s.dashDateInput, { paddingTop: 6 }]}>{dashDateTo}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dashSearchBtn} onPress={() => loadDashboard()} disabled={dashLoading}>
                {dashLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <FontAwesome5 name="search" size={13} color="#fff" solid />}
              </TouchableOpacity>
            </View>
            {dashSummary?.label ? (
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 8 }}>
                <FontAwesome5 name="calendar-alt" size={11} color={c.textMuted} />  {dashSummary.label}
              </Text>
            ) : null}
          </View>

          {/* KPI cards */}
          {dashLoading && !dashSummary ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}><ActivityIndicator color="#7c3aed" /></View>
          ) : dashSummary ? (
            <>
              {/* Row 1: Doanh thu + Số đơn */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={[s.kpiCard, { backgroundColor: '#16a34a', flex: 1, position: 'relative' }]}>
                  <View style={{ position: 'absolute', top: 12, right: 12 }}>
                    <FontAwesome5 name="money-bill-wave" size={18} color="rgba(255,255,255,0.25)" solid />
                  </View>
                  <Text style={s.kpiLabel}>Tổng thu ngân</Text>
                  <Text style={s.kpiValue}>{fmtVnd(dashSummary.totalRevenue)}</Text>
                </View>
                <View style={[s.kpiCard, { backgroundColor: '#2563eb', flex: 1, position: 'relative' }]}>
                  <View style={{ position: 'absolute', top: 12, right: 12 }}>
                    <FontAwesome5 name="shopping-cart" size={18} color="rgba(255,255,255,0.25)" solid />
                  </View>
                  <Text style={s.kpiLabel}>Tổng # đơn</Text>
                  <Text style={s.kpiValue}>{dashSummary.totalOrders}</Text>
                </View>
              </View>
              {/* Row 2: Giá vốn + Lợi nhuận (chỉ hiện khi có topItems data) */}
              {dashSummary.topItems.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={[s.kpiCard, { backgroundColor: '#b45309', flex: 1, position: 'relative' }]}>
                    <View style={{ position: 'absolute', top: 12, right: 12 }}>
                      <FontAwesome5 name="box-open" size={18} color="rgba(255,255,255,0.25)" solid />
                    </View>
                    <Text style={s.kpiLabel}>Giá vốn (ước tính)</Text>
                    <Text style={s.kpiValue}>{fmtVnd(dashSummary.totalCost)}</Text>
                  </View>
                  <View style={[s.kpiCard, { backgroundColor: '#7c3aed', flex: 1, position: 'relative' }]}>
                    <View style={{ position: 'absolute', top: 12, right: 12 }}>
                      <FontAwesome5 name="chart-line" size={18} color="rgba(255,255,255,0.25)" solid />
                    </View>
                    <Text style={s.kpiLabel}>Lợi nhuận</Text>
                    <Text style={s.kpiValue}>{fmtVnd(dashSummary.totalProfit)}</Text>
                    {dashSummary.totalRevenue > 0 && (
                      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 }}>
                        Biên {Math.round(dashSummary.totalProfit / dashSummary.totalRevenue * 100)}%
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* Danh sách giao dịch */}
              <View style={s.dashCard}>
                <Text style={[s.dashSectionTitle, { marginBottom: 10 }]}>
                  <FontAwesome5 name="list" size={13} color="#60a5fa" />  Giao dịch ({dashSummary.transactions.length})
                </Text>
                {dashSummary.transactions.length === 0 ? (
                  <Text style={{ color: c.textMuted, textAlign: 'center', paddingVertical: 16 }}>Chưa có giao dịch</Text>
                ) : dashSummary.transactions.map((tx, i) => (
                  <TouchableOpacity key={i} style={s.dashTxRow} activeOpacity={0.75}
                    onPress={() => openBillDetail(tx.order)}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <View style={s.dashTimeBadge}><Text style={s.dashTimeBadgeText}>{tx.time}</Text></View>
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>{tx.code}</Text>
                        <View style={s.dashMethodBadge}><Text style={s.dashMethodBadgeText}>{tx.paymentMethod}</Text></View>
                      </View>
                      <Text style={{ color: c.textMuted, fontSize: 11 }}>{tx.order.room?.name ?? tx.order.roomId}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 13 }}>{fmtVnd(tx.amount)}</Text>
                      <FontAwesome5 name="chevron-right" size={10} color={c.textFaint} solid />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Top sản phẩm bán chạy */}
              <View style={s.dashCard}>
                <Text style={[s.dashSectionTitle, { marginBottom: 10 }]}>
                  <FontAwesome5 name="star" size={13} color="#fbbf24" />  Top sản phẩm (theo lợi nhuận)
                </Text>
                {dashLoading && dashSummary.topItems.length === 0 ? (
                  <ActivityIndicator color="#7c3aed" style={{ paddingVertical: 12 }} />
                ) : dashSummary.topItems.length === 0 ? (
                  <Text style={{ color: c.textMuted, textAlign: 'center', paddingVertical: 12 }}>Chưa có dữ liệu</Text>
                ) : dashSummary.topItems.map((item, i) => {
                  const margin = item.totalSales > 0 ? Math.round(item.profitTotal / item.totalSales * 100) : 0
                  return (
                    <View key={i} style={[s.dashTopItemRow, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={s.dashTopRank}><Text style={s.dashTopRankText}>{i + 1}</Text></View>
                        <Text style={{ color: c.text, fontSize: 13, flex: 1, fontWeight: '600' }}>{item.name}</Text>
                        <Text style={{ color: c.textMuted, fontSize: 12 }}>x{item.qty}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 36 }}>
                        <View style={{ flex: 1, backgroundColor: 'rgba(22,163,74,0.12)', borderRadius: 6, padding: 6 }}>
                          <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 2 }}>Doanh thu</Text>
                          <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 12 }}>{fmtVnd(item.totalSales)}</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: 'rgba(180,83,9,0.12)', borderRadius: 6, padding: 6 }}>
                          <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 2 }}>Giá vốn</Text>
                          <Text style={{ color: '#b45309', fontWeight: '700', fontSize: 12 }}>{fmtVnd(item.costTotal)}</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: 'rgba(124,58,237,0.12)', borderRadius: 6, padding: 6 }}>
                          <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 2 }}>Lợi nhuận</Text>
                          <Text style={{ color: '#7c3aed', fontWeight: '700', fontSize: 12 }}>{fmtVnd(item.profitTotal)}</Text>
                          <Text style={{ color: '#a78bfa', fontSize: 10 }}>Biên {margin}%</Text>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <FontAwesome5 name="chart-bar" size={40} color={c.textFaint} solid />
              <Text style={{ color: c.textMuted, marginTop: 12 }}>Chọn khoảng ngày và nhấn tìm kiếm</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Date Picker Modal (Dashboard) ── */}
      <Modal visible={!!dashPickerType} transparent animationType="fade" onRequestClose={() => setDashPickerType(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setDashPickerType(null)} />
        <View style={{ backgroundColor: c.surface, paddingTop: 12, paddingBottom: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{dashPickerType === 'from' ? 'Từ ngày' : 'Đến ngày'}</Text>
            <TouchableOpacity onPress={() => setDashPickerType(null)}>
              <Text style={{ fontSize: 14, color: '#7c3aed', fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={dashPickerDate}
            mode="date"
            display="spinner"
            onChange={(event: any, selectedDate?: Date) => {
              if (selectedDate) {
                setDashPickerDate(selectedDate)
              }
            }}
            textColor={c.text}
          />
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 10 }}>
            <TouchableOpacity style={{ flex: 1, paddingVertical: 10, backgroundColor: c.elevated, borderRadius: 8 }} onPress={() => setDashPickerType(null)}>
              <Text style={{ textAlign: 'center', color: c.textSub, fontWeight: '600' }}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, paddingVertical: 10, backgroundColor: '#7c3aed', borderRadius: 8 }} onPress={() => {
              const dateStr = `${dashPickerDate.getFullYear()}-${String(dashPickerDate.getMonth()+1).padStart(2,'0')}-${String(dashPickerDate.getDate()).padStart(2,'0')}`
              if (dashPickerType === 'from') setDashDateFrom(dateStr)
              else setDashDateTo(dateStr)
              setDashPickerType(null)
            }}>
              <Text style={{ textAlign: 'center', color: '#fff', fontWeight: '600' }}>Xác nhận</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Check-in Modal ── */}
      <Modal visible={checkInModal.show} transparent animationType="slide" onRequestClose={() => setCheckInModal({ show: false, room: null })}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}><Ico name="door-open" size={16} color="#34d399" />  Mở phòng</Text>
            <Text style={s.modalRoom}>{checkInModal.room?.name} — {checkInModal.room?.type}</Text>
            <Text style={[s.payLabel, { marginTop: 8 }]}>Tên khách (tuỳ chọn)</Text>
            <TextInput
              style={s.input}
              placeholder="Khách lẻ"
              placeholderTextColor="#6b7280"
              value={guestName}
              onChangeText={setGuestName}
              autoFocus
            />
            <Text style={s.payLabel}>Số điện thoại (tuỳ chọn)</Text>
            <TextInput
              style={s.input}
              placeholder="0909..."
              placeholderTextColor="#6b7280"
              keyboardType="phone-pad"
              value={guestPhone}
              onChangeText={setGuestPhone}
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={[s.btnConfirm, { backgroundColor: '#16a34a' }, actionLoading && { opacity: 0.6 }]}
                onPress={handleOpenRoom} disabled={actionLoading}>
                {actionLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnConfirmText}>Mở phòng</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} onPress={() => { setCheckInModal({ show: false, room: null }); setGuestName(''); setGuestPhone('') }}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Payment Modal ── */}
      <Modal visible={payModal} transparent animationType="slide" onRequestClose={() => setPayModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}><Ico name="credit-card" size={16} color="#4ade80" />  Thanh toán</Text>
            <Text style={s.modalRoom}>{selectedRoom?.name} · {selectedRoom?.customerName || 'Khách lẻ'}</Text>
            <View style={s.payRow}>
              <Text style={s.payLabel}>Tạm tính</Text>
              <Text style={s.payAmount}>{fmtVnd(subtotal)}</Text>
            </View>
            {discount > 0 && (
              <View style={s.payRow}>
                <Text style={s.payLabel}>Giảm giá</Text>
                <Text style={[s.payAmount, { color: '#f87171' }]}>-{fmtVnd(discount)}</Text>
              </View>
            )}
            {discount > 0 && (
              <View style={[s.payRow, { borderTopWidth: 1, borderTopColor: '#374151', marginTop: 4, paddingTop: 8 }]}>
                <Text style={[s.payLabel, { fontWeight: '700', color: c.text }]}>Thực thu</Text>
                <Text style={[s.payAmount, { color: '#4ade80', fontSize: 22 }]}>{fmtVnd(total)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              {(['Tiền mặt','Chuyển khoản','Thẻ'] as const).map(m => (
                <TouchableOpacity key={m} style={[s.payMethod, selectedPayMethod === m && { borderWidth: 2, borderColor: '#16a34a' }]} activeOpacity={0.7} onPress={() => setSelectedPayMethod(m)}>
                  <Text style={[s.payMethodText, selectedPayMethod === m && { color: '#16a34a', fontWeight: '700' }]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, { backgroundColor: '#16a34a' }, actionLoading && { opacity: 0.6 }]}
                onPress={handleCheckout} disabled={actionLoading}>
                {actionLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnConfirmText}>Xác nhận thanh toán</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} onPress={() => setPayModal(false)}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Discount Modal ── */}
      <Modal visible={discountModal} transparent animationType="fade" onRequestClose={() => setDiscountModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Giảm giá</Text>
            {/* Toggle % / đ */}
            <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ea580c', marginBottom: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: discountMode === 'amount' ? '#ea580c' : 'transparent' }}
                onPress={() => { setDiscountMode('amount'); setDiscountInput('') }}>
                <Text style={{ color: discountMode === 'amount' ? '#fff' : '#ea580c', fontWeight: '700' }}>Số tiền (đ)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: discountMode === 'percent' ? '#ea580c' : 'transparent' }}
                onPress={() => { setDiscountMode('percent'); setDiscountInput('') }}>
                <Text style={{ color: discountMode === 'percent' ? '#fff' : '#ea580c', fontWeight: '700' }}>Phần trăm (%)</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={discountInput}
              onChangeText={setDiscountInput}
              placeholder={discountMode === 'percent' ? '0 – 100' : '0'}
              placeholderTextColor="#6b7280"
            />
            {/* Preview */}
            {discountMode === 'percent' && subtotal > 0 && (() => {
              const pct = Math.min(100, Math.max(0, parseFloat(discountInput) || 0))
              const amt = Math.round(subtotal * pct / 100)
              return amt > 0 ? <Text style={{ color: '#f87171', fontSize: 13, marginBottom: 8, textAlign: 'right' }}>= -{fmtVnd(amt)}</Text> : null
            })()}
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, { backgroundColor: '#ea580c' }]}
                onPress={async () => {
                  let finalDiscount: number
                  if (discountMode === 'percent') {
                    const pct = Math.min(100, Math.max(0, parseFloat(discountInput) || 0))
                    setDiscountPct(pct)
                    finalDiscount = Math.round(subtotal * pct / 100)
                  } else {
                    const amt = parseInt(discountInput.replace(/\D/g, '')) || 0
                    setDiscountPct(0)
                    finalDiscount = Math.min(subtotal, amt)
                  }
                  setDiscount(finalDiscount)
                  setDiscountModal(false)
                  // Lưu discount + discountPct lên SaleOrder ngay lập tức
                  if (selectedRoom?.saleOrderId) {
                    const pct = discountMode === 'percent' ? (Math.min(100, Math.max(0, parseFloat(discountInput) || 0))) : 0
                    try {
                      await api.patchSaleOrder(selectedRoom.saleOrderId, { discount: finalDiscount, discountPct: pct })
                    } catch { /* silent — sẽ đồng bộ lại khi checkout */ }
                  }
                }}>
                <Text style={s.btnConfirmText}>Áp dụng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} onPress={() => setDiscountModal(false)}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Note Modal ── */}
      <Modal visible={noteModal.show} transparent animationType="fade" onRequestClose={() => setNoteModal({ show: false, item: null, text: '' })}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}><FontAwesome5 name="sticky-note" size={14} color="#fbbf24" solid />{'  '}Ghi chú món</Text>
            <Text style={s.modalRoom}>{noteModal.item?.name}</Text>
            <TextInput
              style={[s.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Nhập ghi chú (VD: ít đá, không hành)..."
              placeholderTextColor="#6b7280"
              value={noteModal.text}
              onChangeText={t => setNoteModal(p => ({ ...p, text: t }))}
              multiline
              autoFocus
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, { backgroundColor: '#fbbf24' }]} onPress={saveNote}>
                <Text style={[s.btnConfirmText, { color: '#1f2937' }]}>Lưu ghi chú</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} onPress={() => setNoteModal({ show: false, item: null, text: '' })}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Bill Detail Modal ── */}
      <Modal visible={billDetail.show} transparent animationType="slide" onRequestClose={() => setBillDetail(p => ({ ...p, show: false }))}>
        <View style={{ flex: 1, backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(15,23,42,0.22)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: detailBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: detailBorder }}>
              <View>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{billDetail.order?.code}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
                  {billDetail.order?.room?.name ?? billDetail.order?.roomId}
                  {' · '}{billDetail.order?.paymentMethod ?? 'N/A'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setBillDetail(p => ({ ...p, show: false }))} style={{ padding: 8 }}>
                <FontAwesome5 name="times" size={18} color={c.textMuted} solid />
              </TouchableOpacity>
            </View>

            {/* Items */}
            {billDetail.loading ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <ActivityIndicator color="#7c3aed" />
                <Text style={{ color: c.textMuted, marginTop: 8 }}>Đang tải...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {billDetail.items.length === 0 ? (
                  <Text style={{ color: c.textMuted, textAlign: 'center', paddingVertical: 16 }}>Không có dữ liệu món</Text>
                ) : (
                  billDetail.items.map((item, idx) => (
                    <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: idx < billDetail.items.length - 1 ? 1 : 0, borderBottomColor: detailBorder }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontSize: 14 }} numberOfLines={1}>{item.name}</Text>
                        <Text style={{ color: c.textMuted, fontSize: 12 }}>{fmtVnd(item.unitPrice)} × {item.quantity} {item.unit}</Text>
                        {item.note ? <Text style={{ color: '#fbbf24', fontSize: 11 }}>ℙ {item.note}</Text> : null}
                      </View>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 14, marginLeft: 12 }}>{fmtVnd(item.subtotal || item.unitPrice * item.quantity)}</Text>
                    </View>
                  ))
                )}

                {/* Summary */}
                <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: detailBorder, paddingTop: 12, gap: 6 }}>
                  {billDetail.order?.discount ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: c.textMuted }}>Giảm giá</Text>
                      <Text style={{ color: '#f87171' }}>-{fmtVnd(billDetail.order.discount)}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: c.textMuted }}>Phương thức</Text>
                    <Text style={{ color: c.text, fontWeight: '600' }}>{billDetail.order?.paymentMethod ?? 'N/A'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>Thực thu</Text>
                    <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 18 }}>{fmtVnd(billDetail.order?.paidAmount || billDetail.order?.total || 0)}</Text>
                  </View>
                  <Text style={{ color: c.textFaint, fontSize: 11, marginTop: 8, textAlign: 'right' }}>
                    {billDetail.order?.updatedAt ? new Date(billDetail.order.updatedAt).toLocaleString('vi-VN') : ''}
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Edit Time Modal ── */}
      <Modal visible={editTimeModal.show} transparent animationType="fade" onRequestClose={() => setEditTimeModal(s => ({ ...s, show: false, item: null }))}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}><FontAwesome5 name="clock" size={15} color="#93c5fd" solid />{'  '}{editTimeModal.item?._endTime ? 'Chỉnh giờ vào / ra' : 'Chỉnh giờ vào'}</Text>
            <Text style={s.modalRoom}>{editTimeModal.item?.name}</Text>

            {/* ── Giờ vào ── */}
            <Text style={[s.payLabel, { marginBottom: 4 }]}>Ngày vào</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.elevated, borderRadius: 8, paddingVertical: 9, marginBottom: 10 }}
              onPress={() => setEditTimeModal(p => ({ ...p, showDatePick: !p.showDatePick, showEndDatePick: false }))}
            >
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
                {editTimeModal.startDate ? (() => { const [y,mo,d] = editTimeModal.startDate.split('-'); return `${d}/${mo}/${y}` })() : '--'}
              </Text>
            </TouchableOpacity>
            {editTimeModal.showDatePick && (
              <DateTimePicker
                value={editTimeModal.startDate ? (() => { const [y,mo,d] = editTimeModal.startDate.split('-').map(Number); return new Date(y, mo-1, d, 12, 0, 0) })() : new Date()}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={(_: any, selectedDate?: Date) => {
                  const toYMD = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
                  setEditTimeModal(p => ({ ...p, startDate: selectedDate ? toYMD(selectedDate) : p.startDate, showDatePick: false }))
                }}
                textColor={c.text}
              />
            )}
            <Text style={[s.payLabel, { marginBottom: 6 }]}>Giờ vào</Text>
            <View style={s.timeInputRow}>
              <TextInput style={s.timeInput} keyboardType="number-pad" maxLength={2} placeholder="HH" placeholderTextColor="#4b5563"
                value={editTimeModal.startHH}
                onChangeText={v => setEditTimeModal(p => ({ ...p, startHH: v.replace(/\D/g,'').slice(0,2) }))} />
              <Text style={s.timeColon}>:</Text>
              <TextInput style={s.timeInput} keyboardType="number-pad" maxLength={2} placeholder="MM" placeholderTextColor="#4b5563"
                value={editTimeModal.startMM}
                onChangeText={v => setEditTimeModal(p => ({ ...p, startMM: v.replace(/\D/g,'').slice(0,2) }))} />
            </View>

            {/* ── Giờ ra — chỉ hiện khi item đã bị freeze (_endTime tồn tại) ── */}
            {!!editTimeModal.item?._endTime && (<>
              <View style={{ height: 1, backgroundColor: c.border, marginVertical: 10 }} />
              <Text style={[s.payLabel, { marginBottom: 4 }]}>Ngày ra</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.elevated, borderRadius: 8, paddingVertical: 9, marginBottom: 10 }}
                onPress={() => setEditTimeModal(p => ({ ...p, showEndDatePick: !p.showEndDatePick, showDatePick: false }))}
              >
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
                  {editTimeModal.endDate ? (() => { const [y,mo,d] = editTimeModal.endDate.split('-'); return `${d}/${mo}/${y}` })() : '--'}
                </Text>
              </TouchableOpacity>
              {editTimeModal.showEndDatePick && (
                <DateTimePicker
                  value={editTimeModal.endDate ? (() => { const [y,mo,d] = editTimeModal.endDate.split('-').map(Number); return new Date(y, mo-1, d, 12, 0, 0) })() : new Date()}
                  mode="date"
                  display="spinner"
                  onChange={(_: any, selectedDate?: Date) => {
                    const toYMD = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
                    setEditTimeModal(p => ({ ...p, endDate: selectedDate ? toYMD(selectedDate) : p.endDate, showEndDatePick: false }))
                  }}
                  textColor={c.text}
                />
              )}
              <Text style={[s.payLabel, { marginBottom: 6 }]}>Giờ ra</Text>
              <View style={s.timeInputRow}>
                <TextInput style={s.timeInput} keyboardType="number-pad" maxLength={2} placeholder="HH" placeholderTextColor="#4b5563"
                  value={editTimeModal.endHH}
                  onChangeText={v => setEditTimeModal(p => ({ ...p, endHH: v.replace(/\D/g,'').slice(0,2) }))} />
                <Text style={s.timeColon}>:</Text>
                <TextInput style={s.timeInput} keyboardType="number-pad" maxLength={2} placeholder="MM" placeholderTextColor="#4b5563"
                  value={editTimeModal.endMM}
                  onChangeText={v => setEditTimeModal(p => ({ ...p, endMM: v.replace(/\D/g,'').slice(0,2) }))} />
              </View>
            </>)}

            {editTimeModal.startHH && editTimeModal.startMM && editTimeModal.startDate &&
             editTimeModal.item?._endTime && editTimeModal.endHH && editTimeModal.endMM && editTimeModal.endDate && (() => {
              const [sy, smo, sd] = editTimeModal.startDate.split('-').map(Number)
              const startBase = new Date(sy, smo - 1, sd, parseInt(editTimeModal.startHH), parseInt(editTimeModal.startMM), 0, 0)
              const [ey, emo, ed] = editTimeModal.endDate.split('-').map(Number)
              const endBase = new Date(ey, emo - 1, ed, parseInt(editTimeModal.endHH), parseInt(editTimeModal.endMM), 0, 0)
              const diffMs = endBase.getTime() - startBase.getTime()
              const h = Math.max(0.5, Math.ceil(diffMs / (30 * 60 * 1000)) * 0.5)
              return <Text style={s.timeSummary}>{h} giờ · {(h * (editTimeModal.item?.price ?? 0)).toLocaleString('vi-VN')}đ</Text>
            })()}
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, { backgroundColor: '#7c3aed' }]} onPress={saveEditTime}>
                <Text style={s.btnConfirmText}>Lưu</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} onPress={() => setEditTimeModal(p => ({ ...p, show: false, item: null }))}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────
const makeStyles = (c: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },

  // Header
  header: { backgroundColor: c.surface, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: c.textMuted, fontSize: 11 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  headerTab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: c.elevated },
  headerCompactSwitch: {},
  headerTabActive: { backgroundColor: '#7c3aed' },
  headerTabText: { color: c.textMuted, fontSize: 12, fontWeight: '500' },

  // Overflow
  overlayFull: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 90, paddingRight: 8 },
  dropdown: { backgroundColor: c.elevated, borderRadius: 10, minWidth: 180, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  dropdownText: { color: c.textSub, fontSize: 14 },
  dropdownDivider: { height: 1, backgroundColor: c.border },

  // Mobile tabs
  mobileTabs: { flexDirection: 'row', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  mobileTab: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 3 },
  mobileTabActive: { borderBottomWidth: 2, borderBottomColor: '#7c3aed' },
  mobileTabText: { color: c.textFaint, fontSize: 11, fontWeight: '500' },

  // Dashboard / Báo cáo styles
  dashCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, shadowColor: '#93c5fd', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 },
  dashSectionTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
  dashTodayBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#7c3aed', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  dashDateBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.elevated, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: c.border },
  dashDateLabel: { color: c.textMuted, fontSize: 11, flexShrink: 0 },
  dashDateInput: { flex: 1, color: c.text, fontSize: 12 },
  dashSearchBtn: { backgroundColor: '#7c3aed', borderRadius: 8, width: 38, height: 38, justifyContent: 'center', alignItems: 'center' },
  kpiCard: { borderRadius: 12, padding: 14, gap: 6 },
  kpiLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  kpiValue: { color: '#fff', fontWeight: '800', fontSize: 18 },
  dashTxRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  dashTimeBadge: { backgroundColor: c.borderFaint, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  dashTimeBadgeText: { color: c.textSub, fontSize: 10, fontVariant: ['tabular-nums'] as any },
  dashMethodBadge: { backgroundColor: c.borderFaint, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  dashMethodBadgeText: { color: c.textSub, fontSize: 10, fontWeight: '600' },
  dashTopItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border, gap: 10 },
  dashTopRank: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.elevated, justifyContent: 'center', alignItems: 'center' },
  dashTopRankText: { color: '#7c3aed', fontSize: 11, fontWeight: '700' },

  // Panels
  panel: { flex: 1, backgroundColor: c.bg },

  // Room grid
  roomGrid: { padding: 10 },
  roomTile: { borderRadius: 10, padding: 12, borderWidth: 1, minHeight: 100, justifyContent: 'space-between' },
  roomTileSelected: { borderWidth: 2, borderColor: '#fff' },
  roomTileName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  roomTileTimer: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  roomTileStatus: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },

  // Bill
  emptyBill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyBillText: { color: c.textFaint, fontSize: 16 },
  billInfoBar: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.surface, paddingHorizontal: 10, paddingVertical: 6 },
  billInfoText: { color: c.textMuted, fontSize: 12 },
  cartScroll: { flex: 1 },
  cartItem: { backgroundColor: c.surface, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: c.border },
  cartItemSurcharge: { backgroundColor: '#431407', borderWidth: 1, borderColor: '#92400e' },
  cartItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  cartItemName: { color: c.text, fontWeight: '600', fontSize: 14, flex: 1 },
  cartItemNote: { color: '#d97706', fontSize: 11, marginBottom: 4 },
  cartItemBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cartItemPrice: { color: '#2563eb', fontWeight: '700', fontSize: 14 },
  btnTrash: { padding: 4 },

  // Qty
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtnMinus: { backgroundColor: '#fee2e2', borderRadius: 7, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
  qtyBtnPlus: { backgroundColor: '#dbeafe', borderRadius: 7, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
  qtyVal: { color: c.text, fontWeight: '700', fontSize: 15, minWidth: 28, textAlign: 'center' },

  // Totals
  totals: { backgroundColor: c.surface, padding: 10, borderTopWidth: 1, borderTopColor: c.border },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  totalLabel: { color: c.textMuted, fontSize: 13 },
  totalValue: { color: c.textSub, fontWeight: '600', fontSize: 13 },
  totalBig: { color: '#16a34a', fontWeight: '700', fontSize: 17 },

  // Action buttons
  actionArea: { backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, padding: 8 },
  actionGrid: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 9, gap: 4 },
  actionBtnMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 9, gap: 4, backgroundColor: c.elevated, borderWidth: 1, borderColor: c.border },

  // Frozen indicator bar
  frozenBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e3a5f', borderTopWidth: 1, borderTopColor: '#3b82f6', paddingHorizontal: 12, paddingVertical: 8 },
  frozenBarText: { color: '#93c5fd', fontSize: 13, fontWeight: '600' },
  frozenBarBtn: { backgroundColor: '#2563eb', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 5 },
  frozenBarBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Room pick sheet (đổi phòng / gộp bill / tách bill)
  roomPickSheet: { backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 28 },
  roomPickTitle: { color: c.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  roomPickSub: { color: c.textMuted, fontSize: 12, marginBottom: 10 },
  roomPickItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 10 },
  roomPickDot: { width: 10, height: 10, borderRadius: 5 },
  roomPickName: { color: c.text, fontSize: 15, fontWeight: '600', flex: 1 },
  roomPickStatus: { color: c.textMuted, fontSize: 12 },
  roomPickEmpty: { color: c.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },

  // Split bill item row
  splitItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.border, gap: 8 },
  splitCheckbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#6b7280', alignItems: 'center', justifyContent: 'center' },
  splitCheckboxChecked: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  splitItemName: { flex: 1, color: c.text, fontSize: 13 },
  splitItemQty: { color: c.textMuted, fontSize: 12, minWidth: 30, textAlign: 'right' },
  splitItemPrice: { color: '#93c5fd', fontSize: 12, minWidth: 70, textAlign: 'right' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // More actions sheet
  moreActionsSheet: { backgroundColor: c.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, paddingTop: 8 },
  moreActionsHandle: { width: 40, height: 4, backgroundColor: c.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  moreActionsItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: c.border },
  moreActionsIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  moreActionsText: { color: c.text, fontSize: 15, fontWeight: '600' },

  // Menu search
  menuSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  menuSearchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 0 },

  // Time edit row (in cart item)
  timeEditRow: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  timeEditText: { color: '#93c5fd', fontSize: 12, flex: 1 },
  timeEditHours: { color: '#60a5fa', fontWeight: '700', fontSize: 12 },

  // Time input modal
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  timeInput: { backgroundColor: c.input, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 22, fontWeight: '700', textAlign: 'center', width: 64, fontVariant: ['tabular-nums'] },
  timeColon: { color: c.textMuted, fontSize: 22, fontWeight: '700' },
  timeSummary: { color: '#4ade80', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 14, backgroundColor: '#14532d', borderRadius: 8, paddingVertical: 8 },

  // Menu
  catStrip: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, flexGrow: 0 },
  catBtn: { backgroundColor: c.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5 },
  catBtnText: { color: c.textMuted, fontSize: 13 },
  catActive: { backgroundColor: '#7c3aed', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5 },
  catActiveText: { color: '#fff', fontSize: 13 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10 },
  menuCard: { backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  menuCardWithImage: { borderColor: '#334155', backgroundColor: '#0f172a' },
  menuBgImage: { minHeight: 100, justifyContent: 'space-between' },
  menuBgImageInner: { borderRadius: 10 },
  menuImageOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.48)' },
  menuCardContent: { minHeight: 100, justifyContent: 'space-between', padding: 10 },
  menuName: { color: c.text, fontWeight: '600', fontSize: 13, marginBottom: 4 },
  menuPrice: { color: '#a78bfa', fontWeight: '700', fontSize: 14, marginBottom: 6 },
  menuFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuStock: { color: c.textFaint, fontSize: 11 },
  menuAddBtn: { backgroundColor: '#7c3aed', borderRadius: 999, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalBox: { backgroundColor: c.surface, borderRadius: 14, padding: 20, width: '100%', maxWidth: 400, borderWidth: 1, borderColor: c.border },
  modalTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  modalRoom: { color: c.textMuted, fontSize: 13, marginBottom: 16 },
  payRow: { backgroundColor: c.bg, borderRadius: 8, padding: 12, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payLabel: { color: c.textMuted, fontSize: 13, marginBottom: 6 },
  payAmount: { color: '#16a34a', fontWeight: '700', fontSize: 20 },
  payMethod: { flex: 1, backgroundColor: c.elevated, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  payMethodText: { color: c.textSub, fontSize: 13, fontWeight: '500' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnConfirm: { flex: 1, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  btnConfirmText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnCancel: { flex: 1, backgroundColor: c.elevated, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  btnCancelText: { color: c.textSub, fontWeight: '500', fontSize: 14 },
  input: { backgroundColor: c.input, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: c.text, fontSize: 15, marginBottom: 12 },

  // Misc
  comingSoon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
