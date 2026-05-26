/**
 * WaiterScreen — thin wrapper around CashierScreen với isWaiterMode=true.
 * Ẩn: thanh toán, giảm giá, hoá đơn, báo cáo.
 * Thêm: tab Dọn phòng (cleaning checklist).
 */
import CashierScreen from './CashierScreen'

export default function WaiterScreen({ onBack }: { onBack: () => void }) {
  return <CashierScreen onBack={onBack} isWaiterMode />
}
