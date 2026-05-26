// Trigger: Invoice được tạo
// Fired when: Invoice created
// - Nếu là hoá đơn điều chỉnh (isAdjustment): thông báo điều chỉnh
// - Nếu là hoá đơn thường có saleOrderId: thông báo hoàn thành đơn hàng
module.exports = async function(instance) {
    const invoice = instance.data;
    if (!invoice) return;

    const app = require('../../server');
    const { getUserIdsByRoles } = require('./_helpers');
    const { Invoice, notification: Notification, Room } = app.models;
    // manager only nhận thông báo hóa đơn
    const allUserIds = await getUserIdsByRoles(app, []);
    const invoiceId = instance.objectId || '';
    const invoiceCode = invoice.invoiceNumber || invoiceId;

    // --- Hoá đơn thường: thông báo hoàn thành đơn hàng ---
    if (!invoice.isAdjustment) {
        let roomName = 'N/A';
        if (invoice.roomId) {
            const room = await Room.findById(invoice.roomId);
            if (room) roomName = room.name || room.code || 'Phòng không tên';
        }
        const finalAmount = invoice.totalAmount || invoice.totalToPay || invoice.amountToPay || 0;
        console.log(`[Trigger] Invoice.created (normal) - ${invoiceCode}, Room: ${roomName}, Amount: ${finalAmount}`);
        await Notification.create({
            title: `[Hoàn thành] - Phòng ${roomName}`,
            content: `Đơn hàng phòng ${roomName} đã hoàn tất. Tổng tiền: ${finalAmount.toLocaleString('vi-VN')} VNĐ.`,
            receiverIds: allUserIds,
            createdAt: new Date(),
            data: {
                url: `/xad2_/#!/karaoke/invoices/view/${invoiceId}`,
                model: 'Invoice',
                status: 'completed',
                invoiceId
            }
        });
        return;
    }

    // --- Hoá đơn điều chỉnh ---
    if (!invoice.isAdjustment || !invoice.originalInvoiceId) return;

    const originalInvoiceId = invoice.originalInvoiceId.toString();
    const original = await Invoice.findById(originalInvoiceId);
    if (!original) return;

    const adjustmentTypeMap = {
        increase: 'Tăng thêm',
        decrease: 'Giảm trừ',
        correction: 'Sửa lỗi'
    };
    const typeLabel = adjustmentTypeMap[invoice.adjustmentType] || invoice.adjustmentType || 'Điều chỉnh';
    const originalCode = original.invoiceNumber || originalInvoiceId;
    const adjustCode = invoice.invoiceNumber || instance.objectId || '';
    const adjustAmount = invoice.totalAmount || 0;
    const adjustedTotal = original.adjustedTotalAmount || (original.totalAmount || 0) + adjustAmount;
    const reason = invoice.adjustmentReason ? ` — Lý do: ${invoice.adjustmentReason}` : '';

    console.log(`[Trigger] Invoice.created (adjustment) - ${adjustCode} → ${originalCode}`);

    await Notification.create({
        title: `[ĐIỀU CHỈNH HĐ] ${originalCode} — ${typeLabel}`,
        content: `Hoá đơn điều chỉnh ${adjustCode} (${typeLabel}) ${adjustAmount.toLocaleString('vi-VN')} VNĐ đã được tạo cho hoá đơn gốc ${originalCode}. Tổng sau điều chỉnh: ${adjustedTotal.toLocaleString('vi-VN')} VNĐ.${reason}`,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/karaoke/invoices/view/${originalCode}`,
            objectId: originalInvoiceId,
            model: 'Invoice',
            type: 'InvoiceAdjustment',
            adjustmentType: invoice.adjustmentType
        }
    });
    // Web push được gửi tự động qua Notification.afterSave
};
