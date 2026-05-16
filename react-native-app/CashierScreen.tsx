import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Alert,
  StyleSheet, Platform, KeyboardAvoidingView, useWindowDimensions, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import * as api from './api'

// ─── Types ─────────────────────────────────────────────────────────────────

type RoomStatus = 'occupied' | 'empty' | 'cleaning' | 'maintenance'
type CashierView = 'pos' | 'bills'
type MobileTab = 'rooms' | 'bill' | 'menu'

interface Room {
  id: string; name: string; status: RoomStatus
  type: string; capacity: number
  customerName: string; startTime?: Date; timer?: string
  saleOrderId?: string | null
}
interface Category { id: string; name: string }
interface MenuItem { id: string; name: string; price: number; stock: number; unit: string; categoryId: string; isTimeBased?: boolean; blockMinutes?: number }
interface CartItem {
  id: string; name: string; quantity: number; unit: string
  price: number; note: string
  productId?: string      // product id thực sự (dedup key)
  submittedQty?: number   // số lượng đã gửi server; undefined = chưa gửi lần nào
  isSurcharge?: boolean; isTimeBased?: boolean
  _manualStart?: string; _manualEnd?: string  // 'HH:MM' strings for manual time override
  _startTime?: string   // ISO string – thời điểm bắt đầu (dùng cho timebased)
  _blockMinutes?: number // block tính giờ (default 5)
}

// ─── Mock data ──────────────────────────────────────────────────────────────

const fmtVnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'

// Tính số giờ thực tế theo block (giống logic app Angular cũ)
const calcTimeBasedQty = (startIso: string, blockMinutes = 5): number => {
  const start = new Date(startIso)
  if (isNaN(start.getTime())) return 1
  const startFloor = new Date(Math.floor(start.getTime() / 60000) * 60000)
  const startMin = Math.floor(startFloor.getTime() / 60000)
  const endMin = Math.floor(Date.now() / 60000)
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
  return {
    id: p.id,
    name: p.name,
    price: p.sellingPrice > 0 ? p.sellingPrice : p.price,
    stock: 99,
    unit: p.isTimeBased ? 'giờ' : (p.unitOfMeasure || 'phần'),
    categoryId: p.categoryId,
    isTimeBased: !!p.isTimeBased,
    blockMinutes: p.timeBasedPricing?.blockMinutes ?? 5,
  }
}

const roomColor = (status: RoomStatus) => {
  switch (status) {
    case 'occupied':    return { bg: '#7c3aed', border: '#a78bfa' }
    case 'empty':       return { bg: '#065f46', border: '#34d399' }
    case 'cleaning':    return { bg: '#92400e', border: '#fbbf24' }
    case 'maintenance': return { bg: '#374151', border: '#6b7280' }
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

export default function CashierScreen({ onBack, onInventory }: { onBack: () => void; onInventory?: () => void }) {
  const insets = useSafeAreaInsets()
  const { colors: c, mode, toggle } = useTheme()
  const s = useMemo(() => makeStyles(c), [c])
  const _cartIdRef = React.useRef(0)
  const genCartId = () => `ci_${Date.now()}_${++_cartIdRef.current}`
  const [view, setView] = useState<CashierView>('pos')
  const [tab, setTab] = useState<MobileTab>('rooms')
  const [rooms, setRooms] = useState<Room[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([{ id: 'all', name: 'Tất cả' }])
  const [dataLoading, setDataLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedPayMethod, setSelectedPayMethod] = useState('Tiền mặt')
  const [billsList, setBillsList] = useState<api.SaleOrder[]>([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [billDetail, setBillDetail] = useState<{ show: boolean; order: api.SaleOrder | null; items: api.SaleOrderItem[]; loading: boolean }>({
    show: false, order: null, items: [], loading: false,
  })
  // Check-in modal
  const [checkInModal, setCheckInModal] = useState<{ show: boolean; room: Room | null }>({ show: false, room: null })
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [itemsLoading, setItemsLoading] = useState(false)

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
        setSelectedRoom(mappedRooms[0] ?? null)
        setMenuItems(apiProducts.map(mapApiProductToCashier))
        setCategories([
          { id: 'all', name: 'Tất cả' },
          ...apiCategories.map(cat => ({ id: cat.id, name: cat.name })),
        ])
      } catch (err) {
        console.error('CashierScreen load error:', err)
      } finally {
        if (active) setDataLoading(false)
      }
    }
    loadData()
    return () => { active = false }
  }, [])
  const [selectedCat, setSelectedCat] = useState('all')
  const [discount, setDiscount] = useState(0)
  const [payModal, setPayModal] = useState(false)
  const [discountModal, setDiscountModal] = useState(false)
  const [discountInput, setDiscountInput] = useState('')
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [billActionsOpen, setBillActionsOpen] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')
  const [noteModal, setNoteModal] = useState<{ show: boolean; item: CartItem | null; text: string }>({
    show: false, item: null, text: ''
  })
  const [editTimeModal, setEditTimeModal] = useState<{ show: boolean; item: CartItem | null; startHH: string; startMM: string }>({ show: false, item: null, startHH: '', startMM: '' })
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
      // Tính lại số giờ của timebased items trong cart
      setCart(prev => prev.map(c =>
        c.isTimeBased && c._startTime
          ? { ...c, quantity: calcTimeBasedQty(c._startTime, c._blockMinutes ?? 5) }
          : c
      ))
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

  const filteredMenu = menuItems
    .filter(i => selectedCat === 'all' || i.categoryId === selectedCat)
    .filter(i => i.name.toLowerCase().includes(menuSearch.toLowerCase()))

  // ── Load existing order items khi chọn phòng đang occupied ────────────────
  const loadExistingItems = async (room: Room) => {
    if (!room.saleOrderId) return
    setItemsLoading(true)
    try {
      const items = await api.getSaleOrderItems(room.saleOrderId)
      if (items.length > 0) {
        const cartItems: CartItem[] = items.map(item => {
          const timeBased = item.unit === 'giờ'
          const startIso = room.startTime?.toISOString() ?? item.createdAt
          const bm = item.timeBasedConfig?.blockMinutes ?? 5
          return {
            id: 'sol_' + item.id,
            productId: item.productId,
            name: item.name,
            quantity: timeBased && startIso ? calcTimeBasedQty(startIso, bm) : item.quantity,
            submittedQty: item.quantity,  // đã có trên server
            unit: item.unit ?? 'phần',
            price: item.unitPrice,
            note: item.note ?? '',
            isTimeBased: timeBased,
            _startTime: timeBased ? startIso : undefined,
            _blockMinutes: timeBased ? bm : undefined,
          }
        })
        setCart(cartItems)
      } else {
        setCart([])
      }
    } catch (err) {
      console.error('loadExistingItems error:', err)
      setCart([])
    } finally {
      setItemsLoading(false)
    }
  }

  // ── Chọn phòng ────────────────────────────────────────────────────────────
  const selectRoom = (room: Room) => {
    setSelectedRoom(room)
    setDiscount(0)
    if (room.status === 'occupied') {
      loadExistingItems(room)
    } else {
      setCart([])
    }
    setTab('bill')
  }

  // ── Mở phòng (check-in) ──────────────────────────────────────────────────
  const handleOpenRoom = async () => {
    const room = checkInModal.room
    if (!room) return
    setActionLoading(true)
    try {
      await api.checkIn(room.id, guestName || 'Khách lẻ', guestPhone || undefined)
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
  }

  const addToCart = (item: MenuItem) =>
    setCart(prev => {
      if (item.isTimeBased) {
        // Timebased: không thêm trùng (check theo productId)
        if (prev.some(c => (c.productId ?? c.id) === item.id)) return prev
        const startIso = selectedRoom?.startTime?.toISOString() ?? new Date().toISOString()
        const bm = item.blockMinutes ?? 5
        return [...prev, {
          id: genCartId(), productId: item.id, name: item.name,
          quantity: calcTimeBasedQty(startIso, bm),
          unit: 'giờ', price: item.price, note: '', isTimeBased: true,
          _startTime: startIso, _blockMinutes: bm,
        }]
      }
      // Normal: tìm item cùng productId và không có ghi chú → tăng số lượng
      const found = prev.find(c => (c.productId ?? c.id) === item.id && c.note === '')
      if (found) return prev.map(c =>
        c.id === found.id ? { ...c, quantity: c.quantity + 1 } : c
      )
      // Không tìm thấy → thêm mới
      return [...prev, { id: genCartId(), productId: item.id, name: item.name, quantity: 1, unit: item.unit, price: item.price, note: '' }]
    })
  const updateQty = (id: string, delta: number) =>
    setCart(prev => prev.map(c => c.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0))
  const removeItem = (id: string) => {
    const item = cart.find(c => c.id === id)
    Alert.alert(
      'Xoá món?',
      item?.name ?? '',
      [
        { text: 'Giữ lại', style: 'cancel' },
        { text: 'Xoá', style: 'destructive', onPress: () => setCart(prev => prev.filter(c => c.id !== id)) },
      ]
    )
  }

  const roomCharge = cart.filter(c => c.isTimeBased).reduce((s, c) => s + c.price * c.quantity, 0)
  const foodTotal = cart.filter(c => !c.isTimeBased).reduce((s, c) => s + c.price * c.quantity, 0)
  const subtotal = roomCharge + foodTotal
  const total = subtotal - discount

  // Food items có delta chưa gửi bếp (quantity > submittedQty)
  const newFoodItems = cart.filter(c => !c.isTimeBased && c.quantity > (c.submittedQty ?? 0))
  // Tất cả items có delta (gồm timebased mới, dùng khi checkout)
  const newCartItems = cart.filter(c => c.quantity > (c.submittedQty ?? 0))

  // ── Gửi bếp (submit new items) ────────────────────────────────────────────
  const handleSendToKitchen = async () => {
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
        productId: c.productId ?? c.id,
        name: c.name,
        quantity: c.quantity - (c.submittedQty ?? 0),  // chỉ gửi delta
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
  }

  const handleCheckout = async () => {
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
      // 1. Gửi các món chưa submit
      if (newCartItems.length > 0) {
        await api.submitOrderItems(selectedRoom.saleOrderId, newCartItems.map(c => ({
          productId: c.productId ?? c.id, name: c.name,
          quantity: c.quantity - (c.submittedQty ?? 0),  // chỉ gửi delta
          price: c.price, unit: c.unit, note: c.note,
        })))
      }
      // 2. Thanh toán + cập nhật room → cleaning
      await api.checkout(selectedRoom.saleOrderId, selectedRoom.id, total, selectedPayMethod, discount)
      Alert.alert('Thanh toán thành công ✓', `${fmtVnd(total)} — ${selectedPayMethod}\nPhòng ${selectedRoom.name} chuyển sang dọn dẹp`)
      setCart([])
      setDiscount(0)
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
  }

  const handleLogout = async () => {
    try { await api.logout() } catch {}
    onBack()
  }

  const loadBills = async () => {
    setBillsLoading(true)
    try {
      const orders = await api.getSaleOrders({
        where: { status: 'completed' },
        order: 'updatedAt DESC',
        limit: 50,
      })
      setBillsList(orders)
    } catch (err) {
      console.error('loadBills error:', err)
    } finally {
      setBillsLoading(false)
    }
  }

  // Tự động load bills khi switch sang tab HĐ
  useEffect(() => {
    if (view === 'bills' && billsList.length === 0) {
      loadBills()
    }
  }, [view])

  const openBillDetail = async (order: api.SaleOrder) => {
    setBillDetail({ show: true, order, items: [], loading: true })
    try {
      const items = await api.getSaleOrderItems(order.id)
      setBillDetail(prev => ({ ...prev, items, loading: false }))
    } catch {
      setBillDetail(prev => ({ ...prev, loading: false }))
    }
  }

  // Open edit-time modal for a time-based item
  const openEditTime = (item: CartItem) => {
    const now = new Date()
    const defHH = String(now.getHours()).padStart(2, '0')
    const defMM = String(now.getMinutes()).padStart(2, '0')
    const [startHH, startMM] = item._manualStart ? item._manualStart.split(':') : [
      selectedRoom?.startTime ? String(selectedRoom.startTime.getHours()).padStart(2, '0') : defHH,
      selectedRoom?.startTime ? String(selectedRoom.startTime.getMinutes()).padStart(2, '0') : defMM,
    ]
    setEditTimeModal({ show: true, item, startHH, startMM })
  }

  const saveEditTime = () => {
    const { item, startHH, startMM } = editTimeModal
    if (!item) return
    const start = `${startHH}:${startMM}`
    // Tính số giờ từ giờ vào đến hiện tại
    const startMin = parseInt(startHH) * 60 + parseInt(startMM)
    const now = new Date()
    let endMin = now.getHours() * 60 + now.getMinutes()
    if (endMin <= startMin) endMin += 24 * 60
    const hours = Math.max(0.5, Math.ceil((endMin - startMin) / 30) * 0.5)
    // Cập nhật _startTime ISO để interval có thể tính lại tự động
    const todayBase = new Date(); todayBase.setHours(parseInt(startHH), parseInt(startMM), 0, 0)
    setCart(prev => prev.map(c => c.id === item.id ? { ...c, quantity: hours, _manualStart: start, _startTime: todayBase.toISOString(), _manualEnd: undefined } : c))
    setEditTimeModal(s => ({ ...s, show: false, item: null }))
  }

  const saveNote = () => {
    if (!noteModal.item) return
    setCart(prev => prev.map(c => c.id === noteModal.item!.id ? { ...c, note: noteModal.text } : c))
    setNoteModal({ show: false, item: null, text: '' })
  }

  const Ico = ({ name, size = 14, color = '#9ca3af' }: { name: any; size?: number; color?: string }) =>
    <FontAwesome5 name={name} size={size} color={color} solid />

  // ── Rooms panel ───────────────────────────────────────────────────────────
  const RoomsPanel = () => {
    const { width } = useWindowDimensions()
    const cols = width >= 768 ? Math.floor(width / 180) : 2
    const gap = 10
    const pad = 10
    const tileW = (width - pad * 2 - gap * (cols - 1)) / cols
    return (
      <ScrollView style={s.panel} contentContainerStyle={[s.roomGrid, { flexDirection: 'row', flexWrap: 'wrap' }]}>
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
                  // Cùng phòng đang chọn: chỉ chuyển sang bill tab, không reload
                  setTab('bill')
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
                <Text style={s.totalLabel}>Giảm giá:</Text>
                <Text style={[s.totalValue, { color: '#f87171' }]}>-{fmtVnd(discount)}</Text>
              </View>
            </>}
            <View style={[s.totalRow, { marginTop: 4 }]}>
              <Text style={[s.totalLabel, { fontSize: 15, fontWeight: '700', color: c.text }]}>Tổng cộng:</Text>
              <Text style={s.totalBig}>{fmtVnd(total)}</Text>
            </View>
          </View>

          {/* Action buttons: 3 primary + overflow ⋯ */}
          <View style={[s.actionArea, { paddingBottom: insets.bottom + 8 }]}>
            <View style={s.actionGrid}>
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#4f46e5' }]}>
                <Ico name="print" size={12} color="#fff" /><Text style={s.actionBtnText}> In bill</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#16a34a' }]} onPress={() => setPayModal(true)}>
                <Ico name="credit-card" size={12} color="#fff" /><Text style={s.actionBtnText}> Thanh toán</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#ea580c' }]} onPress={() => { setDiscountInput(String(discount)); setDiscountModal(true) }}>
                <Ico name="tag" size={12} color="#fff" /><Text style={s.actionBtnText}> Giảm giá</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.actionBtnMore} onPress={() => setBillActionsOpen(true)}>
                <Ico name="ellipsis-h" size={14} color={c.textSub} />
                <Text style={[s.actionBtnText, { color: c.textSub }]}>Khác</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* More actions sheet */}
          <Modal visible={billActionsOpen} transparent animationType="slide" onRequestClose={() => setBillActionsOpen(false)}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setBillActionsOpen(false)} />
            <View style={s.moreActionsSheet}>
              <View style={s.moreActionsHandle} />
              <TouchableOpacity style={s.moreActionsItem} onPress={() => setBillActionsOpen(false)}>
                <View style={[s.moreActionsIcon, { backgroundColor: '#7c3aed' }]}><Ico name="exchange-alt" size={15} color="#fff" /></View>
                <Text style={s.moreActionsText}>Đổi phòng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.moreActionsItem} onPress={() => setBillActionsOpen(false)}>
                <View style={[s.moreActionsIcon, { backgroundColor: '#be185d' }]}><Ico name="compress-alt" size={15} color="#fff" /></View>
                <Text style={s.moreActionsText}>Gộp bill</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.moreActionsItem} onPress={() => setBillActionsOpen(false)}>
                <View style={[s.moreActionsIcon, { backgroundColor: '#be185d' }]}><Ico name="expand-alt" size={15} color="#fff" /></View>
                <Text style={s.moreActionsText}>Tách bill</Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </>
      )}
    </View>
  )

  // ── Menu panel ────────────────────────────────────────────────────────────
  const MenuPanel = () => (
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.menuGrid}>
        {filteredMenu.map(item => (
          <TouchableOpacity key={item.id} style={[s.menuCard, item.isTimeBased && { borderWidth: 1, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' }]} activeOpacity={0.75}
            onPress={() => {
              addToCart(item)
              if (item.isTimeBased) {
                // Mở thẳng modal chỉnh giờ sau khi thêm
                const existing = cart.find(c => c.id === item.id)
                if (!existing) {
                  // item vừa thêm — mở editTime sau khi state update
                  setTimeout(() => {
                    const newItem: CartItem = { id: item.id, name: item.name, quantity: 1, unit: 'giờ', price: item.price, note: '', isTimeBased: true }
                    openEditTime(newItem)
                  }, 50)
                }
                setTab('bill')
              } else {
                setTab('bill')
              }
            }}>
            <Text style={[s.menuName, item.isTimeBased && { color: '#a78bfa' }]} numberOfLines={2}>
              {item.isTimeBased && <><Ico name="clock" size={11} color="#a78bfa" />{'  '}</>}{item.name}
            </Text>
            <Text style={s.menuPrice}>{fmtVnd(item.price)}<Text style={{ fontSize: 10, color: '#6b7280' }}>{item.isTimeBased ? '/giờ' : ''}</Text></Text>
            <View style={s.menuFooter}>
              <Text style={s.menuStock}>{item.isTimeBased ? 'Tính giờ' : `${item.stock} ${item.unit}`}</Text>
              <View style={[s.menuAddBtn, item.isTimeBased && { backgroundColor: '#7c3aed' }]}><Ico name={item.isTimeBased ? 'clock' : 'plus'} size={11} color="#fff" /></View>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )

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

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <FontAwesome5 name="arrow-left" size={13} color="rgba(255,255,255,0.6)" solid />
          <Ico name="cash-register" size={20} color="#a78bfa" />
          <View>
            <Text style={s.headerTitle}>Thu Ngân - POS</Text>
            <Text style={s.headerSub}>{timeStr}</Text>
          </View>
        </TouchableOpacity>
        <View style={s.headerRight}>
          {/* View tabs */}
          <TouchableOpacity style={[s.headerTab, view === 'pos' && s.headerTabActive]} onPress={() => setView('pos')}>
            <Ico name="cash-register" size={13} color={view === 'pos' ? '#fff' : '#9ca3af'} />
            <Text style={[s.headerTabText, view === 'pos' && { color: '#fff' }]}>POS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.headerTab, view === 'bills' && s.headerTabActive]} onPress={() => setView('bills')}>
            <Ico name="receipt" size={13} color={view === 'bills' ? '#fff' : '#9ca3af'} />
            <Text style={[s.headerTabText, view === 'bills' && { color: '#fff' }]}>HĐ</Text>
          </TouchableOpacity>
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

      {/* ── POS view ── */}
      {view === 'pos' && (
        <>
          {/* Mobile tab bar */}
          <View style={s.mobileTabs}>
            {([['rooms','Phòng','door-open'],['bill','Hóa đơn','receipt'],['menu','Thực đơn','utensils']] as const).map(([key, label, icon]) => (
              <TouchableOpacity key={key} style={[s.mobileTab, tab === key && s.mobileTabActive]} onPress={() => setTab(key as MobileTab)}>
                <Ico name={icon} size={13} color={tab === key ? '#a78bfa' : '#6b7280'} />
                <Text style={[s.mobileTabText, tab === key && { color: '#a78bfa' }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tab === 'rooms' && <RoomsPanel />}
          {tab === 'bill'  && <BillPanel />}
          {tab === 'menu'  && <MenuPanel />}
        </>
      )}

      {/* ── Bills view ── */}
      {view === 'bills' && (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: s.root.backgroundColor }}>
            <Text style={{ color: '#9ca3af', fontWeight: '700', fontSize: 13 }}>LỊch sử hóa đơn (50 gần nhất)</Text>
            <TouchableOpacity onPress={loadBills} style={{ padding: 6 }}>
              <FontAwesome5 name="sync-alt" size={14} color="#7c3aed" solid />
            </TouchableOpacity>
          </View>
          {billsLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#7c3aed" />
            </View>
          ) : billsList.length === 0 ? (
            <View style={s.comingSoon}>
              <FontAwesome5 name="receipt" size={40} color="#4b5563" solid />
              <Text style={{ color: '#6b7280', marginTop: 12, fontSize: 16 }}>Chưa có hóa đơn</Text>
              <TouchableOpacity onPress={loadBills} style={{ marginTop: 12, backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Tải hóa đơn</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, gap: 8 }}>
              {billsList.map((order, i) => {
                const d = new Date(order.updatedAt)
                const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
                return (
                  <TouchableOpacity key={order.id} activeOpacity={0.75}
                    style={{ backgroundColor: '#1f2937', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#374151', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                    onPress={() => openBillDetail(order)}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 13 }}>{order.code}</Text>
                        <View style={{ backgroundColor: '#14532d', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: '#4ade80', fontSize: 10, fontWeight: '700' }}>HT</Text>
                        </View>
                      </View>
                      <Text style={{ color: '#9ca3af', fontSize: 11 }}>{order.room?.name ?? order.roomId} · {order.paymentMethod ?? 'N/A'} · {timeStr}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ color: '#4ade80', fontWeight: '700', fontSize: 14 }}>{fmtVnd(order.paidAmount || order.total)}</Text>
                      <FontAwesome5 name="chevron-right" size={11} color="#4b5563" solid />
                    </View>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}
        </View>
      )}

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
              <Text style={s.payLabel}>Tổng tiền</Text>
              <Text style={s.payAmount}>{fmtVnd(total)}</Text>
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
                <Text style={[s.payAmount, { color: '#4ade80', fontSize: 22 }]}>{fmtVnd(total - discount)}</Text>
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
            <Text style={s.payLabel}>Số tiền giảm (đ)</Text>
            <TextInput style={s.input} keyboardType="numeric" value={discountInput} onChangeText={setDiscountInput} placeholder="0" placeholderTextColor="#6b7280" />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, { backgroundColor: '#ea580c' }]}
                onPress={() => { setDiscount(parseInt(discountInput.replace(/\D/g,'')) || 0); setDiscountModal(false) }}>
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
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
              <View>
                <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 16 }}>{billDetail.order?.code}</Text>
                <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
                  {billDetail.order?.room?.name ?? billDetail.order?.roomId}
                  {' · '}{billDetail.order?.paymentMethod ?? 'N/A'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setBillDetail(p => ({ ...p, show: false }))} style={{ padding: 8 }}>
                <FontAwesome5 name="times" size={18} color="#9ca3af" solid />
              </TouchableOpacity>
            </View>

            {/* Items */}
            {billDetail.loading ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <ActivityIndicator color="#7c3aed" />
                <Text style={{ color: '#6b7280', marginTop: 8 }}>Đang tải...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {billDetail.items.length === 0 ? (
                  <Text style={{ color: '#6b7280', textAlign: 'center', paddingVertical: 16 }}>Không có dữ liệu món</Text>
                ) : (
                  billDetail.items.map((item, idx) => (
                    <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: idx < billDetail.items.length - 1 ? 1 : 0, borderBottomColor: '#1f2937' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#e5e7eb', fontSize: 14 }} numberOfLines={1}>{item.name}</Text>
                        <Text style={{ color: '#6b7280', fontSize: 12 }}>{fmtVnd(item.unitPrice)} × {item.quantity} {item.unit}</Text>
                        {item.note ? <Text style={{ color: '#fbbf24', fontSize: 11 }}>ℙ {item.note}</Text> : null}
                      </View>
                      <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 14, marginLeft: 12 }}>{fmtVnd(item.subtotal || item.unitPrice * item.quantity)}</Text>
                    </View>
                  ))
                )}

                {/* Summary */}
                <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 12, gap: 6 }}>
                  {billDetail.order?.discount ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: '#9ca3af' }}>Giảm giá</Text>
                      <Text style={{ color: '#f87171' }}>-{fmtVnd(billDetail.order.discount)}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: '#9ca3af' }}>Phương thức</Text>
                    <Text style={{ color: '#e5e7eb', fontWeight: '600' }}>{billDetail.order?.paymentMethod ?? 'N/A'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 15 }}>Thực thu</Text>
                    <Text style={{ color: '#4ade80', fontWeight: '700', fontSize: 18 }}>{fmtVnd(billDetail.order?.paidAmount || billDetail.order?.total || 0)}</Text>
                  </View>
                  <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 8, textAlign: 'right' }}>
                    {billDetail.order?.updatedAt ? new Date(billDetail.order.updatedAt).toLocaleString('vi-VN') : ''}
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Bill Detail Modal ── */}
      <Modal visible={billDetail.show} transparent animationType="slide" onRequestClose={() => setBillDetail(p => ({ ...p, show: false }))}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
              <View>
                <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 16 }}>{billDetail.order?.code}</Text>
                <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
                  {billDetail.order?.room?.name ?? billDetail.order?.roomId}
                  {' · '}{billDetail.order?.paymentMethod ?? 'N/A'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setBillDetail(p => ({ ...p, show: false }))} style={{ padding: 8 }}>
                <FontAwesome5 name="times" size={18} color="#9ca3af" solid />
              </TouchableOpacity>
            </View>

            {/* Items */}
            {billDetail.loading ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <ActivityIndicator color="#7c3aed" />
                <Text style={{ color: '#6b7280', marginTop: 8 }}>Đang tải...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {billDetail.items.length === 0 ? (
                  <Text style={{ color: '#6b7280', textAlign: 'center', paddingVertical: 16 }}>Không có dữ liệu món</Text>
                ) : (
                  billDetail.items.map((item, idx) => (
                    <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: idx < billDetail.items.length - 1 ? 1 : 0, borderBottomColor: '#1f2937' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#e5e7eb', fontSize: 14 }} numberOfLines={1}>{item.name}</Text>
                        <Text style={{ color: '#6b7280', fontSize: 12 }}>{fmtVnd(item.unitPrice)} × {item.quantity} {item.unit}</Text>
                        {item.note ? <Text style={{ color: '#fbbf24', fontSize: 11 }}>✎ {item.note}</Text> : null}
                      </View>
                      <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 14, marginLeft: 12 }}>{fmtVnd(item.subtotal || item.unitPrice * item.quantity)}</Text>
                    </View>
                  ))
                )}

                {/* Summary */}
                <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 12, gap: 6 }}>
                  {(billDetail.order?.discount ?? 0) > 0 ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: '#9ca3af' }}>Giảm giá</Text>
                      <Text style={{ color: '#f87171' }}>-{fmtVnd(billDetail.order!.discount)}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: '#9ca3af' }}>Phương thức</Text>
                    <Text style={{ color: '#e5e7eb', fontWeight: '600' }}>{billDetail.order?.paymentMethod ?? 'N/A'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ color: '#e5e7eb', fontWeight: '700', fontSize: 15 }}>Thực thu</Text>
                    <Text style={{ color: '#4ade80', fontWeight: '700', fontSize: 18 }}>{fmtVnd(billDetail.order?.paidAmount || billDetail.order?.total || 0)}</Text>
                  </View>
                  <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 8, textAlign: 'right' }}>
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
            <Text style={s.modalTitle}><FontAwesome5 name="clock" size={15} color="#93c5fd" solid />{'  '}Chỉnh giờ vào</Text>
            <Text style={s.modalRoom}>{editTimeModal.item?.name}</Text>
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
            {editTimeModal.startHH && editTimeModal.startMM && (() => {
              const startMin = parseInt(editTimeModal.startHH) * 60 + parseInt(editTimeModal.startMM)
              const now = new Date()
              let endMin = now.getHours() * 60 + now.getMinutes()
              if (endMin <= startMin) endMin += 24 * 60
              const h = Math.max(0.5, Math.ceil((endMin - startMin) / 30) * 0.5)
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
  header: { backgroundColor: c.surface, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  headerTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: c.textMuted, fontSize: 11 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: c.elevated },
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

  // Panels
  panel: { flex: 1, backgroundColor: c.bg },

  // Room grid
  roomGrid: { padding: 10, gap: 10 },
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
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 10 },
  menuCard: { width: '46%', backgroundColor: c.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.border },
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
