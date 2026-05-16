import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal,
  StatusBar, StyleSheet, Platform, KeyboardAvoidingView, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import * as api from './api'
import { useSocket } from './useSocket'

// ─── Types ─────────────────────────────────────────────────────────────────

type RoomStatus = 'occupied' | 'available' | 'cleaning'
type View2 = 'rooms' | 'room-items' | 'cart' | 'cleaning'

interface Room {
  id: string; name: string; status: RoomStatus; type: string
  capacity: number; customerName: string; timer?: string
  readyCount?: number; totalCount?: number
  saleOrderId?: string | null
}
interface Category { id: string; name: string; icon: string }
interface MenuItem {
  id: string; name: string; price: number; stock: number
  unit: string; description?: string; alcoholic?: boolean; categoryId: string
}
interface CartItem {
  id: string; name: string; quantity: number; unit: string
  price: number; note: string; status?: 'pending' | 'ready' | 'served'
}
interface ChecklistItem { id: number; name: string; checked: boolean }

const CHECKLIST_INIT: ChecklistItem[] = [
  { id: 1, name: 'Thu dọn ly, đĩa', checked: false },
  { id: 2, name: 'Lau bàn, ghế', checked: false },
  { id: 3, name: 'Vệ sinh sàn', checked: false },
  { id: 4, name: 'Kiểm tra thiết bị âm thanh', checked: false },
  { id: 5, name: 'Thay khăn trải bàn', checked: false },
]

function categoryIcon(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('bia') || n.includes('rượu') || n.includes('nước uống')) return 'glass-cheers'
  if (n.includes('ăn') || n.includes('món') || n.includes('food')) return 'utensils'
  if (n.includes('giờ') || n.includes('dịch vụ')) return 'clock'
  if (n.includes('thuốc')) return 'smoking'
  return 'tag'
}

function mapApiRoom(r: api.Room): Room {
  return {
    id: r.id,
    name: r.name,
    status: (r.status === 'occupied' ? 'occupied' : r.status === 'available' ? 'available' : 'cleaning') as RoomStatus,
    type: r.type,
    capacity: 0,
    customerName: (r.customerInfo as any)?.name ?? '',
    saleOrderId: r.saleOrderId,
  }
}

function mapApiProduct(p: api.Product): MenuItem {
  return {
    id: p.id,
    name: p.name,
    price: p.sellingPrice > 0 ? p.sellingPrice : p.price,
    stock: 99,
    unit: 'phần',
    categoryId: p.categoryId,
    description: p.type,
    alcoholic: false,
  }
}

const fmtVnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'

// ─── App ────────────────────────────────────────────────────────────────────

export default function WaiterScreen({ onBack }: { onBack: () => void }) {
  const { colors: c, mode, toggle } = useTheme()
  const s = useMemo(() => makeStyles(c), [c])
  const [view, setView] = useState<View2>('rooms')
  const [rooms, setRooms] = useState<Room[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([{ id: 'all', name: 'Tất cả', icon: 'th' }])
  const [dataLoading, setDataLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCat, setSelectedCat] = useState('all')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CHECKLIST_INIT)
  const [actionLoading, setActionLoading] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [submittedItems, setSubmittedItems] = useState<CartItem[]>([])

  const selectOccupiedRoom = async (room: Room) => {
    setSelectedRoom(room)
    setCart([])
    setSubmittedItems([])
    setView('room-items')
    if (!room.saleOrderId) return
    setItemsLoading(true)
    try {
      const items = await api.getSaleOrderItems(room.saleOrderId)
      setSubmittedItems(items.map(item => ({
        id: item.productId || item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit ?? 'phần',
        price: item.unitPrice,
        note: item.note ?? '',
        status: 'served' as const,
      })))
    } catch (err) {
      console.error('loadExistingItems error:', err)
    } finally {
      setItemsLoading(false)
    }
  }

  const refreshRooms = useCallback(async () => {
    try {
      const apiRooms = await api.getRooms()
      setRooms(apiRooms.map(mapApiRoom))
    } catch (err) {
      console.error('refreshRooms error:', err)
    }
  }, [])

  // Lắng nghe WebSocket — tự refresh khi có order mới / cập nhật
  useSocket((msg) => {
    if (msg.event === 'saleOrder:created' || msg.event === 'saleOrder:updated') {
      refreshRooms()
    }
  })

  const handleCheckIn = async () => {
    if (!checkInModal.room) return
    setActionLoading(true)
    try {
      await api.checkIn(checkInModal.room.id, guestName || 'Khách lẻ', guestPhone)
      const apiRooms = await api.getRooms()
      const updated = apiRooms.map(mapApiRoom)
      setRooms(updated)
      const newRoom = updated.find(r => r.id === checkInModal.room!.id)
      setSelectedRoom(newRoom ?? checkInModal.room)
      setSubmittedItems([])
      setCart([])
      setCheckInModal({ show: false, room: null })
      setGuestName('')
      setGuestPhone('')
      setView('room-items')
    } catch (err: any) {
      Alert.alert('Lỗi mở phòng', err?.message ?? 'Không thể mở phòng')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSubmitOrder = async () => {
    if (!selectedRoom?.saleOrderId || cart.length === 0) {
      Alert.alert('Chú ý', selectedRoom?.saleOrderId ? 'Chưa có món nào' : 'Phòng chưa được mở (chưa có mã đơn)')
      return
    }
    setActionLoading(true)
    try {
      const count = cart.length
      await api.submitOrderItems(selectedRoom.saleOrderId, cart.map(c => ({
        productId: c.id,
        name: c.name,
        quantity: c.quantity,
        price: c.price,
        note: c.note,
      })))
      setSubmittedItems(prev => [...prev, ...cart.map(c => ({ ...c, status: 'served' as const }))])
      setCart([])
      Alert.alert('Đã gửi bếp ✓', `${count} món đã được lưu vào đơn hàng`)
    } catch (err: any) {
      Alert.alert('Lỗi gửi món', err?.message ?? 'Không thể gửi món')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRoomCleaned = async () => {
    const room = cleaningRooms[0]
    if (!room) return
    setActionLoading(true)
    try {
      await api.markRoomCleaned(room.id)
      setChecklist(CHECKLIST_INIT)
      await refreshRooms()
      setView('rooms')
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message ?? 'Không thể cập nhật trạng thái phòng')
    } finally {
      setActionLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await api.logout()
    } catch {}
    onBack()
  }

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
        const mappedRooms = apiRooms.map(mapApiRoom)
        setRooms(mappedRooms)
        // Pre-select first occupied room AND load existing items
        const firstOccupied = mappedRooms.find(r => r.status === 'occupied')
        const initialRoom = firstOccupied ?? mappedRooms[0] ?? null
        setSelectedRoom(initialRoom)
        if (firstOccupied?.saleOrderId) {
          try {
            const items = await api.getSaleOrderItems(firstOccupied.saleOrderId)
            if (active && items.length > 0) {
              setSubmittedItems(items.map(item => ({
                id: item.productId || item.id,
                name: item.name,
                quantity: item.quantity,
                unit: item.unit ?? 'phần',
                price: item.unitPrice,
                note: item.note ?? '',
                status: 'served' as const,
              })))
            }
          } catch { /* ignore */ }
        }
        setMenuItems(apiProducts.map(mapApiProduct))
        setCategories([
          { id: 'all', name: 'Tất cả', icon: 'th' },
          ...apiCategories.map(cat => ({ id: cat.id, name: cat.name, icon: categoryIcon(cat.name) })),
        ])
      } catch (err) {
        console.error('WaiterScreen load error:', err)
      } finally {
        if (active) setDataLoading(false)
      }
    }
    loadData()
    return () => { active = false }
  }, [])
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [checkInModal, setCheckInModal] = useState<{ show: boolean; room: Room | null }>({ show: false, room: null })
  const [noteModal, setNoteModal] = useState<{ show: boolean; item: CartItem | null }>({ show: false, item: null })
  const [noteText, setNoteText] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const cleaningRoom = rooms.find(r => r.status === 'cleaning') ?? null
  const occupiedRooms = rooms.filter(r => r.status === 'occupied')
  const availableRooms = rooms.filter(r => r.status === 'available')
  const cleaningRooms = rooms.filter(r => r.status === 'cleaning')
  const pendingCount = cart.filter(c => c.status === 'pending').length
  const readyCount = cart.filter(c => c.status === 'ready').length
  const filteredMenu = selectedCat === 'all' ? menuItems : menuItems.filter(i => i.categoryId === selectedCat)

  const addToCart = (item: MenuItem) =>
    setCart(prev => {
      const found = prev.find(c => c.id === item.id)
      if (found) return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { id: item.id, name: item.name, quantity: 1, unit: item.unit, price: item.price, note: '', status: 'pending' }]
    })

  const updateQty = (id: string, delta: number) =>
    setCart(prev => prev.map(c => c.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0))

  const removeItem = (id: string) => {
    setDeleteConfirm(null)
    setCart(prev => prev.filter(c => c.id !== id))
  }

  const saveNote = () => {
    if (!noteModal.item) return
    setCart(prev => prev.map(c => c.id === noteModal.item!.id ? { ...c, note: noteText } : c))
    setNoteModal({ show: false, item: null })
  }

  const switchView = (v: View2) => { setOverflowOpen(false); setView(v) }

  // ── Icon helper ────────────────────────────────────────────────────────────
  const Ico = ({ name, size = 16, color = '#6b7280' }: { name: any; size?: number; color?: string }) =>
    <FontAwesome5 name={name} size={size} color={color} solid />

  // ══════════════════════════════════════════════════════════════════════════
  if (dataLoading) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={{ color: c.textMuted, marginTop: 12 }}>Đang tải dữ liệu...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <FontAwesome5 name="arrow-left" size={14} color="rgba(255,255,255,0.7)" solid />
          <View>
            <Text style={s.headerTitle}>Phục vụ</Text>
            <Text style={s.headerSub}>nhanvien.a</Text>
          </View>
        </TouchableOpacity>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.btnHeader} activeOpacity={0.7}>
            <Ico name="user-circle" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={{ position: 'relative' }}>
            <TouchableOpacity style={[s.btnHeader, s.btnSquare]} activeOpacity={0.7} onPress={() => setOverflowOpen(o => !o)}>
              <Ico name="ellipsis-v" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Overflow dropdown */}
      {overflowOpen && (
        <Modal transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
          <TouchableOpacity style={s.overlayFull} activeOpacity={1} onPress={() => setOverflowOpen(false)}>
            <View style={s.dropdown}>
              <TouchableOpacity style={s.dropdownItem} onPress={() => { setOverflowOpen(false); refreshRooms() }}>
                <Ico name="sync-alt" size={14} color="#16a34a" /><Text style={s.dropdownText}>Tải lại dữ liệu</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dropdownItem} onPress={() => setOverflowOpen(false)}>
                <Ico name="database" size={14} color="#ca8a04" /><Text style={s.dropdownText}>Cập nhật app</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dropdownItem} onPress={() => { toggle(); setOverflowOpen(false) }}>
                <Ico name={mode === 'dark' ? 'sun' : 'moon'} size={14} color="#7c3aed" /><Text style={s.dropdownText}>{mode === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}</Text>
              </TouchableOpacity>
              <View style={s.divider} />
              <TouchableOpacity style={s.dropdownItem} onPress={() => { setOverflowOpen(false); handleLogout() }}>
                <Ico name="sign-out-alt" size={14} color="#dc2626" /><Text style={[s.dropdownText, { color: '#dc2626' }]}>Đăng xuất</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Tabs ── */}
      <View style={s.tabs}>
        <Tab label="Phòng" icon="door-open" active={view === 'rooms'} onPress={() => switchView('rooms')} styles={s} />
        <Tab label="Thêm món" icon="plus" active={view === 'room-items'} disabled={!selectedRoom} onPress={() => switchView('room-items')} styles={s} />
        <Tab label="Đơn" icon="shopping-cart" active={view === 'cart'} disabled={!selectedRoom} badge={pendingCount > 0 ? pendingCount : undefined} onPress={() => switchView('cart')} styles={s} />
        <Tab label={cleaningRooms.length > 0 ? `Dọn (${cleaningRooms.length})` : 'Dọn'} icon="broom" active={view === 'cleaning'} dimmed={cleaningRooms.length === 0} onPress={() => { if (cleaningRooms.length > 0) switchView('cleaning') }} styles={s} />
      </View>

      {/* ══════ ROOMS ══════ */}
      {view === 'rooms' && (
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>Chọn phòng</Text>
            <TouchableOpacity style={s.btnBlueSm} activeOpacity={0.7} onPress={refreshRooms}>
              <Ico name="sync-alt" size={12} color="#fff" /><Text style={s.btnBlueSmText}> Tải lại</Text>
            </TouchableOpacity>
          </View>

          {occupiedRooms.length > 0 && (
            <View style={s.group}>
              <Text style={[s.groupLabel, { color: '#ef4444' }]}><Ico name="music" size={10} color="#ef4444" />  ĐANG HÁT</Text>
              {occupiedRooms.map(room => (
                <TouchableOpacity key={room.id} style={[s.roomCard, s.borderRed, selectedRoom?.id === room.id && s.roomSelected]} activeOpacity={0.75}
                  onPress={() => {
                    if (room.id === selectedRoom?.id) {
                      setView('room-items')  // same room → chỉ switch view, giữ cart
                    } else {
                      selectOccupiedRoom(room)
                    }
                  }}>
                  <View style={s.roomCardTop}>
                    <View style={s.roomCardLeft}>
                      <Ico name="music" size={24} color="#ef4444" />
                      <View style={{ marginLeft: 10 }}>
                        <Text style={s.roomName}>{room.name}</Text>
                        <Text style={s.roomSub}>{room.type} · {room.capacity} người</Text>
                      </View>
                    </View>
                    <View style={s.roomCardRight}>
                      {(room.totalCount ?? 0) > 0 && (
                        <View style={s.badgeGreen}><Text style={s.badgeGreenText}>{room.readyCount}/{room.totalCount}</Text></View>
                      )}
                      <Ico name="chevron-right" size={14} color="#9ca3af" />
                    </View>
                  </View>
                  <Text style={s.roomCustomer}><Ico name="user" size={12} color="#4b5563" />  {room.customerName || 'Khách lẻ'}</Text>
                  {room.timer && <View style={s.timerBadge}><Text style={s.timerText}>{room.timer}</Text></View>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {availableRooms.length > 0 && (
            <View style={s.group}>
              <Text style={[s.groupLabel, { color: '#16a34a' }]}>  PHÒNG TRỐNG</Text>
              {availableRooms.map(room => (
                <TouchableOpacity key={room.id} style={[s.roomCard, s.borderGreen]} activeOpacity={0.75}
                  onPress={() => setCheckInModal({ show: true, room })}>
                  <View style={s.roomCardTop}>
                    <View style={s.roomCardLeft}>
                      <Ico name="door-open" size={24} color="#22c55e" />
                      <View style={{ marginLeft: 10 }}>
                        <Text style={s.roomName}>{room.name}</Text>
                        <Text style={s.roomSub}>Trống — nhấn để mở phòng</Text>
                      </View>
                    </View>
                    <Ico name="plus-circle" size={22} color="#22c55e" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {cleaningRooms.length > 0 && (
            <View style={s.group}>
              <Text style={[s.groupLabel, { color: '#ca8a04' }]}>  CẦN DỌN</Text>
              {cleaningRooms.map(room => (
                <TouchableOpacity key={room.id} style={[s.roomCard, s.borderYellow]} activeOpacity={0.75}
                  onPress={() => switchView('cleaning')}>
                  <View style={s.roomCardTop}>
                    <View style={s.roomCardLeft}>
                      <Ico name="broom" size={24} color="#eab308" />
                      <View style={{ marginLeft: 10 }}>
                        <Text style={s.roomName}>{room.name}</Text>
                        <Text style={s.roomSub}>Cần dọn dẹp</Text>
                      </View>
                    </View>
                    <Ico name="chevron-right" size={14} color="#9ca3af" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ══════ MENU ITEMS ══════ */}
      {view === 'room-items' && (
        <View style={s.flexCol}>
          <View style={s.subHeader}>
            <View style={s.subHeaderRow}>
              <Text style={s.subHeaderTitle}>{selectedRoom?.name} · Thêm món</Text>
              <View style={s.subHeaderActions}>
                <TouchableOpacity style={s.btnOrange} activeOpacity={0.7} onPress={() => switchView('cart')}>
                  <Text style={s.btnText}><Ico name="shopping-cart" size={12} color="#fff" /> Xem đơn</Text>
                </TouchableOpacity>
                <View style={s.badgeBlue}><Text style={s.badgeBlueText}>{cart.length} món</Text></View>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catStrip}>
              {categories.map(cat => (
                <TouchableOpacity key={cat.id} style={selectedCat === cat.id ? s.catActive : s.catBtn} activeOpacity={0.7} onPress={() => setSelectedCat(cat.id)}>
                  <Text style={selectedCat === cat.id ? s.catActiveText : s.catBtnText}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <ScrollView style={s.scroll} contentContainerStyle={s.menuGrid}>
            {filteredMenu.map(item => (
              <View key={item.id} style={s.menuCard}>
                <View style={s.menuCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.menuName}>{item.name}</Text>
                    <Text style={s.menuPrice}>{fmtVnd(item.price)}</Text>
                    <Text style={s.menuStock}>{item.stock} {item.unit}</Text>
                    {item.description ? <Text style={s.menuDesc}>{item.description}</Text> : null}
                  </View>
                  <TouchableOpacity style={s.btnAdd} activeOpacity={0.7} onPress={() => addToCart(item)}>
                    <Ico name="plus" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ══════ CART ══════ */}
      {view === 'cart' && (
        <View style={s.flexCol}>
          <View style={s.subHeader}>
            <View style={s.subHeaderRow}>
              <Text style={s.subHeaderTitle}>{selectedRoom?.name}</Text>
              <View style={s.subHeaderActions}>
                <TouchableOpacity style={s.btnGreen} activeOpacity={0.7} onPress={handleSubmitOrder} disabled={actionLoading}>
                  <Text style={s.btnText}><Ico name="paper-plane" size={12} color="#fff" /> {actionLoading ? 'Đang gửi...' : 'Gửi đơn'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnIconGray} activeOpacity={0.7}
                  onPress={() => selectedRoom && selectOccupiedRoom(selectedRoom)}>
                  <Ico name="sync-alt" size={14} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity style={s.btnBlueSm} activeOpacity={0.7} onPress={() => switchView('room-items')}>
                  <Text style={s.btnBlueSmText}><Ico name="plus" size={11} color="#fff" /> Món</Text>
                </TouchableOpacity>
                <View style={s.badgeBlue}><Text style={s.badgeBlueText}>{cart.length}</Text></View>
              </View>
            </View>
          </View>

          <ScrollView style={s.scroll} contentContainerStyle={{ padding: 16, gap: 12 }}>
            {itemsLoading && (
              <View style={{ alignItems: 'center', padding: 16 }}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={{ color: '#6b7280', marginTop: 8, fontSize: 13 }}>Đang tải đơn hàng...</Text>
              </View>
            )}
            {!itemsLoading && submittedItems.length > 0 && (
              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 8, textTransform: 'uppercase' }}>Đã gửi bếp</Text>
                {submittedItems.map((item, idx) => (
                  <View key={`${item.id}-${idx}`} style={[s.cartItem, { opacity: 0.65, backgroundColor: '#f9fafb', marginBottom: 8 }]}>
                    <View style={s.cartItemTop}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={s.cartName}>{item.name}</Text>
                          <View style={{ backgroundColor: '#6b7280', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Đã gửi</Text>
                          </View>
                        </View>
                        {item.note ? <Text style={s.noteText}>{item.note}</Text> : null}
                      </View>
                      <Text style={{ color: '#374151', fontWeight: '600', fontSize: 14 }}>x{item.quantity}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            {!itemsLoading && cart.length === 0 && submittedItems.length === 0 && (
              <View style={s.emptyState}>
                <Ico name="shopping-cart" size={40} color="#d1d5db" />
                <Text style={s.emptyTitle}>Chưa có món nào</Text>
                <Text style={s.emptyDesc}>Thêm món từ tab "Món"</Text>
              </View>
            )}
            {!itemsLoading && cart.length === 0 && submittedItems.length > 0 && (
              <Text style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 8 }}>Thêm món mới từ tab "Thêm món"</Text>
            )}
            {cart.length > 0 && (
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#2563eb', marginBottom: 8, textTransform: 'uppercase' }}>Món mới (chưa gửi)</Text>
            )}
            {cart.map(item => (
              <View key={item.id} style={s.cartItem}>
                {/* Row 1 */}
                <View style={s.cartItemTop}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.cartName}>{item.name}</Text>
                      <TouchableOpacity onPress={() => { setNoteText(item.note); setNoteModal({ show: true, item }) }}>
                        <Ico name="edit" size={12} color="#3b82f6" />
                      </TouchableOpacity>
                    </View>
                    {item.note
                      ? <Text style={s.noteText}>{item.note}</Text>
                      : <TouchableOpacity onPress={() => { setNoteText(''); setNoteModal({ show: true, item }) }}>
                          <Text style={s.notePlaceholder}>+ Thêm ghi chú</Text>
                        </TouchableOpacity>
                    }
                  </View>
                  {item.status === 'ready' && (
                    <TouchableOpacity style={s.btnServe} activeOpacity={0.7}>
                      <Text style={s.btnText}> Lấy phục vụ</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {/* Row 2 */}
                <View style={s.cartItemBottom}>
                  <View style={s.qtyRow}>
                    <TouchableOpacity style={s.qtyMinus} activeOpacity={0.7} onPress={() => updateQty(item.id, -1)}>
                      <Ico name="minus" size={12} color="#dc2626" />
                    </TouchableOpacity>
                    <Text style={s.qtyVal}>{item.quantity}</Text>
                    <TouchableOpacity style={s.qtyPlus} activeOpacity={0.7} onPress={() => updateQty(item.id, 1)}>
                      <Ico name="plus" size={12} color="#2563eb" />
                    </TouchableOpacity>
                    <Text style={s.qtyUnit}>{item.unit}</Text>
                  </View>
                  <TouchableOpacity style={s.btnDelete} activeOpacity={0.7} onPress={() => setDeleteConfirm(item.id)}>
                    <Ico name="trash" size={13} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ══════ CLEANING ══════ */}
      {view === 'cleaning' && (
        <View style={s.flexCol}>
          <View style={s.subHeader}>
            <Text style={s.subHeaderTitle}>Dọn phòng: {cleaningRoom?.name}</Text>
            <Text style={s.subDesc}>Hoàn thành tất cả các mục kiểm tra</Text>
          </View>
          <ScrollView style={s.scroll} contentContainerStyle={{ padding: 16, gap: 12 }}>
            {checklist.map(item => (
              <TouchableOpacity key={item.id} style={[s.checkItem, item.checked && s.checkItemDone]} activeOpacity={0.7} onPress={() => setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, checked: !c.checked } : c))}>
                <View style={[s.checkCircle, item.checked && s.checkCircleDone]}>
                  <Ico name={item.checked ? 'check' : 'circle'} size={14} color={item.checked ? '#fff' : '#9ca3af'} />
                </View>
                <Text style={[s.checkText, item.checked && s.checkTextDone]}>{item.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={s.cleaningFooter}>
            <TouchableOpacity style={s.btnComplete} activeOpacity={0.8} onPress={handleRoomCleaned} disabled={actionLoading}>
              <Ico name="check-circle" size={20} color="#fff" />
              <Text style={s.btnCompleteText}>  {actionLoading ? 'Đang lưu...' : 'Hoàn tất dọn phòng'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ══════ CHECK-IN MODAL ══════ */}
      <Modal visible={checkInModal.show} transparent animationType="fade" onRequestClose={() => setCheckInModal({ show: false, room: null })}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>
              Mở phòng {checkInModal.room?.name}
            </Text>
            <Text style={s.formLabel}>Tên khách</Text>
            <TextInput style={s.input} placeholder="Khách lẻ" value={guestName} onChangeText={setGuestName} />
            <Text style={s.formLabel}>Số điện thoại</Text>
            <TextInput style={s.input} placeholder="(tuỳ chọn)" value={guestPhone} onChangeText={setGuestPhone} keyboardType="phone-pad" />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, actionLoading && { opacity: 0.6 }]} activeOpacity={0.8}
                onPress={handleCheckIn} disabled={actionLoading}>
                <Text style={s.btnConfirmText}>{actionLoading ? 'Đang mở...' : 'Mở phòng'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} activeOpacity={0.7} onPress={() => setCheckInModal({ show: false, room: null })}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════ DELETE CONFIRM MODAL ══════ */}
      <Modal visible={deleteConfirm !== null} transparent animationType="fade" onRequestClose={() => setDeleteConfirm(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDeleteConfirm(null)}>
          <View style={[s.modalBox, { maxWidth: 320 }]}>
            <Text style={s.modalTitle}>Xoá món?</Text>
            <Text style={[s.formLabel, { fontWeight: '400', marginBottom: 16 }]}>
              {cart.find(c => c.id === deleteConfirm)?.name}
            </Text>
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btnConfirm, { backgroundColor: '#ef4444' }]} activeOpacity={0.8} onPress={() => deleteConfirm !== null && removeItem(deleteConfirm)}>
                <Text style={s.btnConfirmText}>Xoá</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} activeOpacity={0.7} onPress={() => setDeleteConfirm(null)}>
                <Text style={s.btnCancelText}>Giữ lại</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══════ NOTE MODAL ══════ */}
      <Modal visible={noteModal.show} transparent animationType="fade" onRequestClose={() => setNoteModal({ show: false, item: null })}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Ghi chú cho món</Text>
            <Text style={s.modalSub}>{noteModal.item?.name}</Text>
            <TextInput
              style={[s.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Nhập ghi chú..."
              value={noteText}
              onChangeText={setNoteText}
              multiline
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.btnConfirm} activeOpacity={0.8} onPress={saveNote}>
                <Text style={s.btnConfirmText}>Lưu</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} activeOpacity={0.7} onPress={() => setNoteModal({ show: false, item: null })}>
                <Text style={s.btnCancelText}>Hủy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Tab component ─────────────────────────────────────────────────────────
function Tab({ label, icon, active, disabled, dimmed, badge, onPress, styles }: { label: string; icon: any; active: boolean; disabled?: boolean; dimmed?: boolean; badge?: number; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <TouchableOpacity style={[styles.tab, active && styles.tabActive, (disabled || dimmed) && { opacity: 0.45 }]} activeOpacity={0.7} onPress={onPress} disabled={disabled}>
      <View style={{ position: 'relative' }}>
        <FontAwesome5 name={icon} size={12} color={active ? '#2563eb' : '#fff'} solid />
        {badge != null && badge > 0 && (
          <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{badge}</Text></View>
        )}
      </View>
      <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────
const makeStyles = (c: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },

  // Header
  header: { backgroundColor: '#2563eb', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, elevation: 4 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  headerRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btnHeader: { backgroundColor: '#3b82f6', borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  btnSquare: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },

  // Overflow
  overlayFull: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 100, paddingRight: 12 },
  dropdown: { backgroundColor: c.surface, borderRadius: 12, minWidth: 190, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  dropdownText: { fontSize: 14, color: c.text },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 4 },

  // Tabs
  tabs: { backgroundColor: '#2563eb', flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 10, gap: 6 },
  tab: { flex: 1, backgroundColor: '#3b82f6', borderRadius: 8, paddingVertical: 6, alignItems: 'center', gap: 2, opacity: 1 },
  tabActive: { backgroundColor: '#fff' },
  tabText: { color: '#fff', fontSize: 11, fontWeight: '500' },
  tabTextActive: { color: '#2563eb', fontWeight: '700' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  flexCol: { flex: 1, flexDirection: 'column' },

  // Section header
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: c.text },

  // Buttons
  btnBlueSm: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  btnBlueSmText: { color: '#fff', fontSize: 13 },
  btnOrange: { backgroundColor: '#f97316', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnGreen: { backgroundColor: '#22c55e', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnIconGray: { backgroundColor: c.elevated, borderRadius: 6, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  btnAdd: { backgroundColor: '#2563eb', borderRadius: 999, width: 40, height: 40, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  btnServe: { backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  btnDelete: { backgroundColor: '#ef4444', borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },

  // Badges
  badgeGreen: { backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeGreenText: { color: '#166534', fontSize: 12, fontWeight: '600' },
  badgeBlue: { backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeBlueText: { color: '#1e40af', fontSize: 13, fontWeight: '500' },

  // Sub-header
  subHeader: { backgroundColor: c.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2, padding: 12 },
  subHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  subHeaderTitle: { fontSize: 16, fontWeight: '700', color: c.text, flexShrink: 1 },
  subHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  subDesc: { fontSize: 13, color: c.textSub, marginTop: 2 },

  // Category strip
  catStrip: { marginTop: 4 },
  catBtn: { backgroundColor: c.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  catBtnText: { color: c.textSub, fontSize: 13 },
  catActive: { backgroundColor: '#2563eb', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  catActiveText: { color: '#fff', fontSize: 13 },

  // Menu grid
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  menuCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, width: '47%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: c.border },
  menuCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  menuName: { fontWeight: '700', color: c.text, fontSize: 14, marginBottom: 4 },
  menuPrice: { color: '#2563eb', fontWeight: '700', fontSize: 14 },
  menuStock: { color: c.textMuted, fontSize: 12 },
  menuDesc: { color: c.textMuted, fontSize: 12, marginTop: 4 },

  // Room card
  group: { marginBottom: 16 },
  groupLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  roomCard: { backgroundColor: c.surface, borderRadius: 12, padding: 16, marginBottom: 10, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  borderRed: { borderLeftColor: '#ef4444' },
  borderGreen: { borderLeftColor: '#22c55e' },
  borderYellow: { borderLeftColor: '#eab308' },
  roomSelected: { borderWidth: 2, borderColor: '#3b82f6' },
  roomCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  roomCardLeft: { flexDirection: 'row', alignItems: 'center' },
  roomCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roomName: { fontWeight: '700', fontSize: 16, color: c.text },
  roomSub: { fontSize: 13, color: c.textSub, marginTop: 1 },
  roomCustomer: { fontSize: 13, color: c.textSub, marginTop: 6 },
  timerBadge: { backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 6 },
  timerText: { color: '#166534', fontSize: 12, fontWeight: '600' },

  // Cart
  cartItem: { backgroundColor: c.surface, borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: c.border },
  cartItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cartName: { fontWeight: '700', color: c.text, fontSize: 15 },
  noteText: { fontSize: 12, color: c.textMuted, fontStyle: 'italic', marginTop: 3 },
  notePlaceholder: { fontSize: 12, color: c.textFaint, marginTop: 3 },
  cartItemBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyMinus: { backgroundColor: '#fee2e2', borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  qtyPlus: { backgroundColor: '#dbeafe', borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  qtyVal: { borderWidth: 1, borderColor: c.border, borderRadius: 8, width: 44, textAlign: 'center', paddingVertical: 4, fontSize: 14, color: c.text },
  qtyUnit: { fontSize: 12, color: c.textMuted },

  // Cleaning
  checkItem: { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 2, borderColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  checkItemDone: { borderColor: '#22c55e' },
  checkCircle: { width: 32, height: 32, borderRadius: 999, backgroundColor: c.elevated, justifyContent: 'center', alignItems: 'center' },
  checkCircleDone: { backgroundColor: '#22c55e' },
  checkText: { flex: 1, fontSize: 15, color: c.text },
  checkTextDone: { textDecorationLine: 'line-through', color: c.textFaint },
  cleaningFooter: { padding: 16, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border },
  btnComplete: { backgroundColor: '#16a34a', borderRadius: 12, paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  btnCompleteText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: c.textMuted },
  emptyDesc: { fontSize: 14, color: c.textFaint },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalBox: { backgroundColor: c.surface, borderRadius: 16, padding: 24, width: '100%', maxWidth: 400, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 16 },
  modalSub: { fontSize: 13, color: c.textSub, marginTop: -10, marginBottom: 12 },
  formLabel: { fontSize: 13, fontWeight: '500', color: c.textSub, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: c.text, marginBottom: 12, backgroundColor: c.input },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  btnConfirm: { flex: 1, backgroundColor: '#22c55e', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnCancel: { flex: 1, backgroundColor: c.elevated, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnCancelText: { color: c.textSub, fontWeight: '500', fontSize: 15 },

  // Tab badge
  tabBadge: { position: 'absolute', top: -5, right: -8, backgroundColor: '#ef4444', borderRadius: 999, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
})
