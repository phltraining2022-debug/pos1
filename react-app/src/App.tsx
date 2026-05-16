import { useState } from 'react'
import './App.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type RoomStatus = 'occupied' | 'available' | 'cleaning'
type View = 'rooms' | 'room-items' | 'cart' | 'cleaning'

interface Room {
  id: number
  name: string
  status: RoomStatus
  type: string
  capacity: number
  customerName: string
  timer?: string
  readyCount?: number
  totalCount?: number
}

interface Category {
  id: string
  name: string
  icon: string
}

interface MenuItem {
  id: number
  name: string
  price: number
  stock: number
  unit: string
  description?: string
  alcoholic?: boolean
  categoryId: string
}

interface CartItem {
  id: number
  name: string
  quantity: number
  unit: string
  price: number
  note: string
  status?: 'pending' | 'ready' | 'served'
  isNew?: boolean
}

interface ChecklistItem {
  id: number
  name: string
  checked: boolean
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const ROOMS: Room[] = [
  { id: 1, name: 'Phòng 201', status: 'occupied', type: 'VIP', capacity: 12, customerName: 'Anh Phong', timer: '01:24:18', readyCount: 2, totalCount: 5 },
  { id: 2, name: 'Phòng 108', status: 'occupied', type: 'Standard', capacity: 8, customerName: 'Khách lẻ', timer: '00:42:05', readyCount: 0, totalCount: 0 },
  { id: 3, name: 'Phòng 305', status: 'available', type: 'Standard', capacity: 10, customerName: '' },
  { id: 4, name: 'Phòng 402', status: 'available', type: 'VIP', capacity: 16, customerName: '' },
  { id: 5, name: 'Phòng VIP 01', status: 'cleaning', type: 'VIP', capacity: 20, customerName: '' },
]

const CATEGORIES: Category[] = [
  { id: 'all', name: 'Tất cả', icon: 'fas fa-th' },
  { id: 'food', name: 'Đồ ăn', icon: 'fas fa-utensils' },
  { id: 'drink', name: 'Đồ uống', icon: 'fas fa-glass-cheers' },
]

const MENU_ITEMS: MenuItem[] = [
  { id: 1, name: 'Combo trái cây lớn', price: 220000, stock: 12, unit: 'phần', categoryId: 'food', description: 'Dưa hấu, xoài, dứa' },
  { id: 2, name: '2 bia + 1 nước suối', price: 145000, stock: 32, unit: 'set', categoryId: 'drink', alcoholic: true },
  { id: 3, name: 'Khăn lạnh, đá, hạt điều', price: 85000, stock: 40, unit: 'set', categoryId: 'food' },
  { id: 4, name: 'Mực nướng sa tế', price: 180000, stock: 7, unit: 'phần', categoryId: 'food' },
  { id: 5, name: 'Pepsi lon', price: 25000, stock: 64, unit: 'lon', categoryId: 'drink' },
  { id: 6, name: 'Tiger bạc', price: 35000, stock: 80, unit: 'lon', categoryId: 'drink', alcoholic: true },
  { id: 7, name: 'Nước ngọt các loại', price: 20000, stock: 50, unit: 'lon', categoryId: 'drink' },
  { id: 8, name: 'Lạp xưởng nướng', price: 95000, stock: 10, unit: 'phần', categoryId: 'food' },
]

const INITIAL_CART: CartItem[] = [
  { id: 1, name: 'Combo trái cây lớn', quantity: 1, unit: 'phần', price: 220000, note: '', status: 'pending' },
  { id: 2, name: '2 bia + 1 nước suối', quantity: 2, unit: 'set', price: 145000, note: 'Ít đá', status: 'ready' },
]

const CHECKLIST: ChecklistItem[] = [
  { id: 1, name: 'Thu dọn ly, đĩa', checked: false },
  { id: 2, name: 'Lau bàn, ghế', checked: false },
  { id: 3, name: 'Vệ sinh sàn', checked: false },
  { id: 4, name: 'Kiểm tra thiết bị âm thanh', checked: false },
  { id: 5, name: 'Thay khăn trải bàn', checked: false },
]

const fmtVnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>('rooms')
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(ROOMS[0])
  const [cart, setCart] = useState<CartItem[]>(INITIAL_CART)
  const [selectedCategoryId, setSelectedCategoryId] = useState('all')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CHECKLIST)
  const [orderLocked] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [checkInModal, setCheckInModal] = useState<{ show: boolean; room: Room | null }>({ show: false, room: null })
  const [noteModal, setNoteModal] = useState<{ show: boolean; item: CartItem | null }>({ show: false, item: null })
  const [noteText, setNoteText] = useState('')

  const cleaningRoom = ROOMS.find(r => r.status === 'cleaning') ?? null

  const occupiedRooms = ROOMS.filter(r => r.status === 'occupied')
  const availableRooms = ROOMS.filter(r => r.status === 'available')
  const cleaningRooms = ROOMS.filter(r => r.status === 'cleaning')

  const filteredMenu = selectedCategoryId === 'all'
    ? MENU_ITEMS
    : MENU_ITEMS.filter(i => i.categoryId === selectedCategoryId)

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const found = prev.find(c => c.id === item.id)
      if (found) return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { id: item.id, name: item.name, quantity: 1, unit: item.unit, price: item.price, note: '', status: 'pending', isNew: true }]
    })
  }

  const updateQty = (id: number, delta: number) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0))
  }

  const removeItem = (id: number) => setCart(prev => prev.filter(c => c.id !== id))

  const openNote = (item: CartItem) => {
    setNoteText(item.note)
    setNoteModal({ show: true, item })
  }

  const saveNote = () => {
    if (!noteModal.item) return
    setCart(prev => prev.map(c => c.id === noteModal.item!.id ? { ...c, note: noteText } : c))
    setNoteModal({ show: false, item: null })
  }

  const toggleChecklist = (id: number) => {
    setChecklist(prev => prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c))
  }

  const switchView = (v: View) => {
    setOverflowOpen(false)
    setView(v)
  }

  return (
    <div className="app-root">
      {/* ── Header ── */}
      <div className="header">
        <div className="header-left">
          <h1>Phục vụ</h1>
          <p>nhanvien.a</p>
        </div>
        <div className="header-right">
          {/* Profile btn */}
          <button type="button" className="btn-header" title="Hồ sơ nhân viên">
            <i className="fas fa-user-circle" />
            <span className="online-dot" />
          </button>

          {/* Overflow */}
          {overflowOpen && <div className="overlay-click" onClick={() => setOverflowOpen(false)} />}
          <div className="relative">
            <button type="button" className="btn-header btn-square" onClick={() => setOverflowOpen(o => !o)}>
              <i className="fas fa-ellipsis-v" />
            </button>
            {overflowOpen && (
              <div className="dropdown-menu">
                <button type="button" className="dropdown-item" onClick={() => setOverflowOpen(false)}>
                  <i className="fas fa-sync-alt fa-fw text-green" />
                  <span>Tải lại dữ liệu</span>
                </button>
                <button type="button" className="dropdown-item text-yellow" onClick={() => setOverflowOpen(false)}>
                  <i className="fas fa-database fa-fw" />
                  <span>Cập nhật app</span>
                </button>
                <div className="dropdown-divider" />
                <button type="button" className="dropdown-item text-red">
                  <i className="fas fa-sign-out-alt fa-fw" />
                  <span>Đăng xuất</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── View Tabs ── */}
      <div className="view-tabs">
        <button type="button" className={view === 'rooms' ? 'tab-active' : 'tab'} onClick={() => switchView('rooms')}>
          <i className="fas fa-door-open" /> Phòng
        </button>
        <button type="button" className={view === 'room-items' ? 'tab-active' : 'tab'} disabled={!selectedRoom} onClick={() => switchView('room-items')}>
          <i className="fas fa-plus" /> Món
        </button>
        <button type="button" className={view === 'cart' ? 'tab-active' : 'tab'} disabled={!selectedRoom} onClick={() => switchView('cart')}>
          <i className="fas fa-shopping-cart" /> Đơn ({cart.length})
        </button>
        <button type="button" className={view === 'cleaning' ? 'tab-active' : 'tab'} disabled={!cleaningRoom} onClick={() => switchView('cleaning')}>
          <i className="fas fa-broom" /> Dọn
        </button>
      </div>

      {/* ══════════════════ ROOMS VIEW ══════════════════ */}
      {view === 'rooms' && (
        <div className="content-scroll">
          <div className="section-title-row">
            <h2>Chọn phòng</h2>
            <button type="button" className="btn-blue-sm">
              <i className="fas fa-sync-alt" /> Tải lại
            </button>
          </div>

          <div className="room-groups">
            {/* Occupied */}
            {occupiedRooms.length > 0 && (
              <div>
                <p className="group-label text-red"><i className="fas fa-music" /> Đang hát</p>
                {occupiedRooms.map(room => (
                  <div key={room.id}
                    className={`room-card border-red${selectedRoom?.id === room.id ? ' room-selected' : ''}`}
                    onClick={() => { setSelectedRoom(room); setView('cart') }}
                  >
                    <div className="room-card-top">
                      <div className="room-card-left">
                        <i className="fas fa-music icon-red" />
                        <div>
                          <h3>{room.name}</h3>
                          <p>{room.type} - {room.capacity} người</p>
                        </div>
                      </div>
                      <div className="room-card-right">
                        {(room.totalCount ?? 0) > 0 && (
                          <span className="badge-green">
                            <i className="fas fa-check-circle" /> {room.readyCount}/{room.totalCount}
                          </span>
                        )}
                        <i className="fas fa-chevron-right icon-gray" />
                      </div>
                    </div>
                    <p className="room-customer"><i className="fas fa-user" /> {room.customerName || 'Khách lẻ'}</p>
                    {room.timer && <span className="timer-badge">{room.timer}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Available */}
            {availableRooms.length > 0 && (
              <div>
                <p className="group-label text-green"><i className="fas fa-door-open" /> Phòng trống</p>
                {availableRooms.map(room => (
                  <div key={room.id}
                    className="room-card border-green"
                    onClick={() => setCheckInModal({ show: true, room })}
                  >
                    <div className="room-card-top">
                      <div className="room-card-left">
                        <i className="fas fa-door-open icon-green" />
                        <div>
                          <h3>{room.name}</h3>
                          <p>Trống — nhấn để mở phòng</p>
                        </div>
                      </div>
                      <i className="fas fa-plus-circle icon-green" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cleaning */}
            {cleaningRooms.length > 0 && (
              <div>
                <p className="group-label text-yellow"><i className="fas fa-broom" /> Cần dọn</p>
                {cleaningRooms.map(room => (
                  <div key={room.id}
                    className="room-card border-yellow"
                    onClick={() => switchView('cleaning')}
                  >
                    <div className="room-card-top">
                      <div className="room-card-left">
                        <i className="fas fa-broom icon-yellow" />
                        <div>
                          <h3>{room.name}</h3>
                          <p>Cần dọn dẹp</p>
                        </div>
                      </div>
                      <i className="fas fa-chevron-right icon-gray" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {ROOMS.length === 0 && (
              <div className="empty-state">
                <i className="fas fa-door-closed" />
                <p>Không có phòng nào</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════ ROOM-ITEMS VIEW ══════════════════ */}
      {view === 'room-items' && (
        <div className="content-flex">
          <div className="sub-header">
            <div className="sub-header-top">
              <h2>{selectedRoom?.name} - Thêm món</h2>
              <div className="sub-header-actions">
                <button type="button" className="btn-orange" onClick={() => switchView('cart')}>
                  <i className="fas fa-shopping-cart" /> Xem đơn
                </button>
                <span className="badge-blue">
                  <i className="fas fa-shopping-cart" /> {cart.length} món
                </span>
              </div>
            </div>
            <div className="category-strip">
              {CATEGORIES.map(cat => (
                <button key={cat.id} type="button"
                  className={selectedCategoryId === cat.id ? 'cat-active' : 'cat-btn'}
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  <i className={cat.icon} /> {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="menu-scroll">
            <div className="menu-grid">
              {filteredMenu.map(item => (
                <div key={item.id} className="menu-card">
                  <div className="menu-card-top">
                    <div className="menu-card-info">
                      <h3>{item.name}</h3>
                      <div className="menu-card-meta">
                        <span className="price">{fmtVnd(item.price)}</span>
                        <span className="stock">{item.stock} {item.unit}</span>
                      </div>
                    </div>
                    <button type="button" className="btn-add" onClick={() => addToCart(item)}>
                      <i className="fas fa-plus" />
                    </button>
                  </div>
                  {item.description && <p className="menu-desc">{item.description}</p>}
                  {item.alcoholic && <p className="alcohol-label"><i className="fas fa-wine-bottle" /> Rượu</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ CART VIEW ══════════════════ */}
      {view === 'cart' && (
        <div className="content-flex">
          <div className="sub-header">
            <div className="sub-header-top">
              <h2>{selectedRoom?.name}</h2>
              <div className="sub-header-actions">
                <button type="button" className="btn-green">
                  <i className="fas fa-bell" /> Báo TT
                </button>
                <button type="button" className="btn-icon-gray" title="Làm mới đơn">
                  <i className="fas fa-sync-alt" />
                </button>
                <button type="button"
                  className={orderLocked ? 'btn-disabled' : 'btn-blue-sm'}
                  disabled={orderLocked}
                  onClick={() => !orderLocked && switchView('room-items')}
                >
                  <i className="fas fa-plus" /> Món
                </button>
                <span className="badge-blue">{cart.length} món</span>
              </div>
            </div>
          </div>

          {orderLocked && (
            <div className="lock-banner">
              <i className="fas fa-lock icon-orange" />
              <div>
                <p className="lock-title">Đang tính tiền</p>
                <p className="lock-desc">Thu ngân đã in phiếu – đơn hàng bị khoá, không thể chỉnh sửa.</p>
              </div>
            </div>
          )}

          <div className="cart-scroll">
            {cart.length === 0 && (
              <div className="empty-state">
                <i className="fas fa-shopping-cart" />
                <p>Chưa có món nào trong đơn</p>
                <span>Thêm món từ tab "Món"</span>
              </div>
            )}

            {cart.map(item => (
              <div key={item.id} className="cart-item">
                {/* Row 1 */}
                <div className="cart-item-top">
                  <div className="cart-item-name">
                    <h3>{item.name}</h3>
                    {!orderLocked && (
                      <button type="button" className="btn-note" onClick={() => openNote(item)}>
                        <i className="fas fa-edit" />
                      </button>
                    )}
                    {item.note
                      ? <div className="note-text"><i className="fas fa-sticky-note" /> {item.note}</div>
                      : !orderLocked && <div className="note-placeholder" onClick={() => openNote(item)}>+ Thêm ghi chú</div>
                    }
                  </div>
                  {item.status === 'ready' && (
                    <button type="button" className="btn-serve">
                      <i className="fas fa-utensils" /> Lấy phục vụ
                    </button>
                  )}
                </div>
                {/* Row 2 */}
                <div className="cart-item-bottom">
                  {!orderLocked ? (
                    <div className="qty-controls">
                      <button type="button" className="qty-minus" onClick={() => updateQty(item.id, -1)}>
                        <i className="fas fa-minus" />
                      </button>
                      <span className="qty-value">{item.quantity}</span>
                      <button type="button" className="qty-plus" onClick={() => updateQty(item.id, 1)}>
                        <i className="fas fa-plus" />
                      </button>
                      <span className="qty-unit">{item.unit || 'phần'}</span>
                    </div>
                  ) : (
                    <span className="qty-locked">{item.quantity} {item.unit}</span>
                  )}
                  {!orderLocked && (
                    <button type="button" className="btn-delete" onClick={() => removeItem(item.id)}>
                      <i className="fas fa-trash" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════ CLEANING VIEW ══════════════════ */}
      {view === 'cleaning' && (
        <div className="content-flex">
          <div className="sub-header">
            <h2>Dọn phòng: {cleaningRoom?.name}</h2>
            <p className="sub-desc">Hoàn thành tất cả các mục kiểm tra</p>
          </div>

          <div className="cleaning-scroll">
            {checklist.map(item => (
              <div key={item.id}
                className={`checklist-item${item.checked ? ' checklist-done' : ''}`}
                onClick={() => toggleChecklist(item.id)}
              >
                <div className={`check-circle${item.checked ? ' checked' : ''}`}>
                  <i className={`fas ${item.checked ? 'fa-check' : 'fa-circle'}`} />
                </div>
                <span className={item.checked ? 'line-through' : ''}>{item.name}</span>
              </div>
            ))}
          </div>

          <div className="cleaning-footer">
            <button type="button" className="btn-complete">
              <i className="fas fa-check-circle" /> Hoàn tất dọn phòng
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════ CHECK-IN MODAL ══════════════════ */}
      {checkInModal.show && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-body">
              <h3 className="modal-title">
                <i className="fas fa-door-open icon-green" /> Mở phòng {checkInModal.room?.name}
              </h3>
              <div className="form-group">
                <label>Tên khách</label>
                <input type="text" placeholder="Khách lẻ" />
              </div>
              <div className="form-group">
                <label>Số điện thoại</label>
                <input type="tel" placeholder="(tuỳ chọn)" />
              </div>
              <div className="form-group">
                <label>Số khách</label>
                <input type="number" defaultValue={2} min={1} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-confirm"
                  onClick={() => { setSelectedRoom(checkInModal.room); setCheckInModal({ show: false, room: null }); setView('cart') }}
                >
                  <i className="fas fa-check" /> Mở phòng
                </button>
                <button type="button" className="btn-cancel" onClick={() => setCheckInModal({ show: false, room: null })}>
                  Huỷ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ NOTE MODAL ══════════════════ */}
      {noteModal.show && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-body">
              <h3 className="modal-title">Ghi chú cho món</h3>
              <p className="modal-sub">{noteModal.item?.name}</p>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Nhập ghi chú cho món này..."
                rows={3}
              />
              <div className="modal-actions">
                <button type="button" className="btn-confirm" onClick={saveNote}>Lưu</button>
                <button type="button" className="btn-cancel" onClick={() => setNoteModal({ show: false, item: null })}>Hủy</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
