'use strict';

module.exports = function(Room) {

  /**
   * POST /api/Rooms/{id}/checkout
   * Atomic checkout: cập nhật SaleOrder → completed + Room → cleaning trong 1 request.
   * Idempotent: nếu phòng đã ở trạng thái cleaning thì trả về success luôn.
   *
   * Body: { totalAmount, paymentMethod, discount }
   * Returns: { success: true, room }
   */
  Room.checkout = async function(id, data) {
    const app = require('../../server/server');
    const SaleOrder    = app.models.SaleOrder;
    const now          = new Date();
    const totalAmount  = Number(data.totalAmount)  || 0;
    const discount     = Number(data.discount)     || 0;
    const paymentMethod = data.paymentMethod       || 'cash';

    // 1. Lấy thông tin phòng
    const room = await Room.findById(id);
    if (!room) {
      const err = new Error('Phòng không tồn tại');
      err.statusCode = 404;
      throw err;
    }

    // 2. Idempotent: nếu đã dọn rồi thì bỏ qua (tránh double-charge)
    if (room.status === 'cleaning' || room.status === 'empty') {
      return { success: true, room };
    }

    if (!room.saleOrderId) {
      const err = new Error('Phòng không có đơn hàng đang mở');
      err.statusCode = 400;
      throw err;
    }

    const saleOrderId = String(room.saleOrderId);

    // 3. Cập nhật SaleOrder → completed (trigger after save → tạo StockMove tự động)
    // Dùng findById + updateAttributes thay vì upsertWithWhere để:
    //   a) Không bao giờ tạo bản ghi trùng lặp
    //   b) Chỉ fire "after save" hook ĐÚNG MỘT LẦN
    //   c) Không có fallback catch có thể gây fire hook lần 2
    const saleOrder = await SaleOrder.findById(saleOrderId);
    if (!saleOrder) {
      const err = new Error('Đơn hàng không tồn tại');
      err.statusCode = 404;
      throw err;
    }
    if (saleOrder.status !== 'completed') {
      await saleOrder.updateAttributes({
        status:        'completed',
        paymentMethod: paymentMethod,
        paidAmount:    totalAmount - discount,
        total:         totalAmount,
        discount:      discount,
        updatedAt:     now,
      });
    }

    // 4. Cập nhật Room → cleaning, xoá saleOrderId + startTime
    const updatedRoom = await room.updateAttributes({
      status:      'cleaning',
      saleOrderId: null,
      startTime:   null,
      updatedAt:   now,
    });

    // 5. Emit WebSocket event (nếu có wss server)
    try {
      const wss = app.get('wss');
      if (wss && typeof wss.broadcast === 'function') {
        wss.broadcast({ model: 'Room', action: 'checkout', roomId: String(id) });
      }
    } catch (e) {
      // silent — không fail checkout vì lý do wss
    }

    return { success: true, room: updatedRoom };
  };

  Room.remoteMethod('checkout', {
    description: 'Thanh toán phòng: đổi SaleOrder → completed và Room → cleaning trong 1 request',
    accepts: [
      { arg: 'id',   type: 'string', required: true, http: { source: 'path' } },
      { arg: 'data', type: 'object', required: true, http: { source: 'body' },
        description: '{ totalAmount, paymentMethod, discount }' },
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http:    { path: '/:id/checkout', verb: 'post' },
  });

};
