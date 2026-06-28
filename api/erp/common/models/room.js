'use strict';

module.exports = function(Room) {
  const ROOM_READY_SALE_ORDER_STATUSES = ['completed', 'canceled'];
  const finalizePaymentInFlight = new Map();

  function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async function assertRoomCanBecomeAvailable(ctx) {
    const nextStatus = ctx.instance && ctx.instance.status !== undefined
      ? ctx.instance.status
      : (ctx.data && ctx.data.status !== undefined ? ctx.data.status : undefined);

    if (nextStatus !== 'available') return;

    const currentRoom = ctx.currentInstance || (ctx.where && ctx.where.id
      ? await Room.findById(String(ctx.where.id))
      : null);

    const nextSaleOrderId = ctx.instance && ctx.instance.saleOrderId !== undefined
      ? ctx.instance.saleOrderId
      : (ctx.data && ctx.data.saleOrderId !== undefined
        ? ctx.data.saleOrderId
        : (currentRoom ? currentRoom.saleOrderId : null));

    if (!nextSaleOrderId) return;

    const SaleOrder = Room.app.models.SaleOrder;
    const saleOrder = await SaleOrder.findById(String(nextSaleOrderId));
    if (!saleOrder) return;

    if (ROOM_READY_SALE_ORDER_STATUSES.indexOf(saleOrder.status) === -1) {
      const err = new Error('Không thể chuyển phòng sang available khi SaleOrder chưa completed.');
      err.statusCode = 422;
      err.code = 'ROOM_SALE_ORDER_NOT_COMPLETED';
      throw err;
    }
  }

  Room.observe('before save', async function preventAvailableWhileSaleOrderOpen(ctx) {
    await assertRoomCanBecomeAvailable(ctx);
  });

  function buildInvoiceItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function(item) {
      const quantity = toNumber(item.quantity, 0);
      const price = toNumber(item.price != null ? item.price : item.unitPrice, 0);
      return {
        productId: item.productId || item.itemId || null,
        name: item.name || '',
        quantity: quantity,
        unit: item.unit || 'phần',
        price: price,
        total: toNumber(item.total, quantity * price),
        note: item.note || '',
        isTimeBased: !!item.isTimeBased,
        isSurcharge: !!item.isSurcharge,
        startTime: item.startTime || item._manualStartTime || null,
        endTime: item.endTime || item._manualEndTime || null,
      };
    });
  }

  function makeHttpError(message, statusCode, code) {
    const err = new Error(message);
    err.statusCode = statusCode;
    if (code) err.code = code;
    return err;
  }

  async function broadcastRoomCheckout(app, roomId) {
    try {
      const wss = app.get('wss');
      if (wss && typeof wss.broadcast === 'function') {
        wss.broadcast({ model: 'Room', action: 'checkout', roomId: String(roomId) });
      }
    } catch (e) {
      // silent — không fail payment vì lý do wss
    }
  }

  async function nextInvoiceNumber(Invoice, now) {
    const mmdd = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const prefix = 'HD' + mmdd;
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const latest = await Invoice.findOne({
      where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      order: 'invoiceNumber DESC',
      fields: { invoiceNumber: true },
    });

    let latestNum = 0;
    if (latest && latest.invoiceNumber) {
      const parsed = parseInt(String(latest.invoiceNumber).replace(prefix, ''), 10);
      if (!isNaN(parsed) && parsed > 0) latestNum = parsed;
    }

    return prefix + String(latestNum + 1).padStart(3, '0');
  }

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

    const previousSaleOrderData = {
      roomId: saleOrder.roomId,
      status: saleOrder.status,
      paymentMethod: saleOrder.paymentMethod,
      paidAmount: saleOrder.paidAmount,
      total: saleOrder.total,
      discount: saleOrder.discount,
      updatedAt: saleOrder.updatedAt,
    };

    let saleOrderUpdated = false;
    const normalizedRoomId = String(id);
    const saleOrderRoomId = saleOrder.roomId ? String(saleOrder.roomId) : null;
    const saleOrderNeedsUpdate =
      saleOrder.status !== 'completed' ||
      saleOrder.paymentMethod !== paymentMethod ||
      toNumber(saleOrder.paidAmount, 0) !== totalAmount ||
      toNumber(saleOrder.total, 0) !== totalAmount ||
      toNumber(saleOrder.discount, 0) !== discount ||
      saleOrderRoomId !== normalizedRoomId;

    if (saleOrderNeedsUpdate) {
      await saleOrder.updateAttributes({
        roomId: normalizedRoomId,
        status:        'completed',
        paymentMethod: paymentMethod,
        // totalAmount từ client là số tiền cuối cùng sau giảm giá.
        paidAmount:    totalAmount,
        total:         totalAmount,
        discount:      discount,
        updatedAt:     now,
      });
      saleOrderUpdated = true;
    }

    // 4. Cập nhật Room → cleaning, xoá saleOrderId + startTime
    let updatedRoom;
    try {
      updatedRoom = await room.updateAttributes({
        status:      'cleaning',
        saleOrderId: null,
        startTime:   null,
        updatedAt:   now,
      });
    } catch (roomUpdateErr) {
      if (saleOrderUpdated) {
        try {
          await saleOrder.updateAttributes(previousSaleOrderData);
        } catch (rollbackErr) {
          console.error('[Room.checkout] rollback SaleOrder failed:', rollbackErr);
        }
      }
      throw roomUpdateErr;
    }

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

  /**
   * POST /api/Rooms/{id}/finalize-payment
   * Atomic payment flow: create Invoice + complete SaleOrder + move Room to cleaning.
   * Backend handles all payment writes to avoid partial client-side updates.
   */
  Room.finalizePayment = async function(id, data) {
    const app = require('../../server/server');
    const SaleOrder = app.models.SaleOrder;
    const Invoice = app.models.Invoice;
    data = data || {};

    const room = await Room.findById(id);
    if (!room) {
      throw makeHttpError('Phòng không tồn tại', 404, 'ROOM_NOT_FOUND');
    }

    const roomSaleOrderId = room.saleOrderId ? String(room.saleOrderId) : null;
    const payloadSaleOrderId = data.saleOrderId ? String(data.saleOrderId) : null;
    if (roomSaleOrderId && payloadSaleOrderId && roomSaleOrderId !== payloadSaleOrderId) {
      throw makeHttpError('SaleOrder trong payload không khớp với phòng hiện tại', 409, 'SALE_ORDER_MISMATCH');
    }

    const saleOrderId = roomSaleOrderId || payloadSaleOrderId;
    if (!saleOrderId) {
      throw makeHttpError('Phòng không có đơn hàng đang mở', 400, 'ROOM_HAS_NO_OPEN_SALE_ORDER');
    }

    if (finalizePaymentInFlight.has(saleOrderId)) {
      return finalizePaymentInFlight.get(saleOrderId);
    }

    const finalizePromise = (async function() {
      const now = new Date();
      const saleOrder = await SaleOrder.findById(saleOrderId);
      if (!saleOrder) {
        throw makeHttpError('Đơn hàng không tồn tại', 404, 'SALE_ORDER_NOT_FOUND');
      }

      let existingInvoice = await Invoice.findOne({ where: { saleOrderId: saleOrderId } });
      const invoiceAlreadyExisted = !!existingInvoice;

      const totalAmount = toNumber(data.totalAmount, 0);
      const discount = toNumber(data.discount, 0);
      const paymentReceived = toNumber(data.paymentReceived, totalAmount);
      const paymentMethod = existingInvoice && existingInvoice.paymentMethod
        ? existingInvoice.paymentMethod
        : (data.paymentMethod || 'cash');
      const invoiceTotal = existingInvoice
        ? toNumber(existingInvoice.totalAmount, totalAmount)
        : totalAmount;
      const invoiceDiscount = existingInvoice
        ? toNumber(existingInvoice.discount, discount)
        : discount;
      const normalizedRoomId = String(id);
      const saleOrderRoomId = saleOrder.roomId ? String(saleOrder.roomId) : null;

      if (!existingInvoice) {
        const customerId = data.customerId != null ? data.customerId : (saleOrder.customerId || 0);
        const invoiceNumber = await nextInvoiceNumber(Invoice, now);

        existingInvoice = await Invoice.create({
          invoiceNumber: invoiceNumber,
          invoiceDate: now,
          customerId: customerId,
          saleOrderId: saleOrderId,
          roomId: String(id),
          startTime: data.startTime || room.startTime || saleOrder.orderDate || null,
          printedAt: data.printedAt || null,
          totalAmount: totalAmount,
          subtotal: toNumber(data.subtotal, totalAmount + discount),
          discount: discount,
          discountType: data.discountType || 'amount',
          discountInput: toNumber(data.discountInput, 0),
          status: 'paid',
          paidAmount: paymentReceived,
          remainingAmount: toNumber(data.remainingAmount, 0),
          paidBy: data.paidBy || null,
          cashierName: data.cashierName || data.paidBy || null,
          roomCharge: toNumber(data.roomCharge, 0),
          foodTotal: toNumber(data.foodTotal, 0),
          paymentMethod: paymentMethod,
          items: buildInvoiceItems(data.items),
          createdAt: now,
          updatedAt: now,
        });
      }

      const saleOrderNeedsUpdate =
        saleOrderRoomId !== normalizedRoomId ||
        saleOrder.status !== 'completed' ||
        saleOrder.paymentMethod !== paymentMethod ||
        toNumber(saleOrder.paidAmount, 0) !== invoiceTotal ||
        toNumber(saleOrder.total, 0) !== invoiceTotal ||
        toNumber(saleOrder.discount, 0) !== invoiceDiscount;

      if (saleOrderNeedsUpdate) {
        await saleOrder.updateAttributes({
          roomId: normalizedRoomId,
          status: 'completed',
          paymentMethod: paymentMethod,
          paidAmount: invoiceTotal,
          total: invoiceTotal,
          discount: invoiceDiscount,
          updatedAt: now,
        });
      }

      let updatedRoom = room;
      const shouldMoveRoomToCleaning =
        String(room.saleOrderId || '') === saleOrderId ||
        room.status === 'occupied';

      if (shouldMoveRoomToCleaning) {
        updatedRoom = await room.updateAttributes({
          status: 'cleaning',
          saleOrderId: null,
          startTime: null,
          customerInfo: null,
          updatedAt: now,
        });
      }

      await broadcastRoomCheckout(app, id);

      return {
        success: true,
        idempotent: invoiceAlreadyExisted,
        invoice: existingInvoice,
        room: updatedRoom,
        roomId: String(id),
        saleOrderId: saleOrderId,
      };
    })();

    finalizePaymentInFlight.set(saleOrderId, finalizePromise);
    try {
      return await finalizePromise;
    } finally {
      finalizePaymentInFlight.delete(saleOrderId);
    }
  };

  Room.remoteMethod('finalizePayment', {
    description: 'Thanh toán atomic: tạo Invoice + hoàn tất SaleOrder + chuyển Room sang cleaning',
    accepts: [
      { arg: 'id', type: 'string', required: true, http: { source: 'path' } },
      { arg: 'data', type: 'object', required: true, http: { source: 'body' },
        description: '{ totalAmount, paymentMethod, discount, paymentReceived, ...bill fields }' },
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/:id/finalize-payment', verb: 'post' },
  });

};
