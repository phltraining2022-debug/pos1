// Trigger: Huỷ hoá đơn đã thanh toán
// Fired when: Invoice updated → status from "paid" to "cancelled"
module.exports = async function(instance) {
    if (!instance || !instance.changes || !instance.changes.status) return;
    if (instance.changes.status.from !== 'paid' || instance.changes.status.to !== 'cancelled') return;

    const app = require('../../server');
    const { User, notification: Notification } = app.models;

    const invoice = instance.data;
    const invoiceId = instance.objectId || invoice.id || 'none';
    const invoiceCode = invoice.invoiceNumber || invoiceId;
    const finalAmount = invoice.totalAmount || invoice.totalToPay || invoice.amountToPay || 0;

    const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);

    console.log(`[Trigger] Invoice.updated (cancelled) - Invoice: ${invoiceCode}`);

    await Notification.create({
        title: `[CẢNH BÁO HUỶ] - Hoá đơn ${invoiceCode}`,
        content: `Hoá đơn ${invoiceCode} trị giá ${finalAmount.toLocaleString('vi-VN')} VNĐ vừa bị chuyển từ "Đã thanh toán" sang "Huỷ".`,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/karaoke/invoices/view/${invoiceCode}`,
            objectId: invoiceId,
            model: 'Invoice',
            status: 'cancelled',
            type: 'InvoiceCancelled'
        }
    });
    // Web push được gửi tự động qua Notification.afterSave
};
