// Trigger: Đơn hàng hoàn thành
// Fired when: SaleOrder updated → status = "completed"
// Lưu ý: thông báo hoàn thành được gửi từ Invoice.created khi invoice được tạo
module.exports = async function(instance) {
    if (!instance || !instance.data) return;

    const saleOrder = instance.data;

    // --- Yêu cầu thanh toán ---
    if (saleOrder.paymentRequested === true) {
        const app = require('../../server');
        const { User, notification: Notification, Room } = app.models;

        let roomName = 'N/A';
        if (saleOrder.roomId) {
            const room = await Room.findById(saleOrder.roomId);
            if (room) roomName = room.name || room.code || 'Phòng không tên';
        }

        let requesterName = 'Không rõ';
        if (saleOrder.paymentRequestedById) {
            const requester = await User.findById(saleOrder.paymentRequestedById);
            if (requester) requesterName = requester.fullName || requester.username || 'Không rõ';
        }

        const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);
        const orderId = instance.objectId || '';

        console.log(`[Trigger] SaleOrder.updated (paymentRequested) - Room: ${roomName}, Requester: ${requesterName}`);

        await Notification.create({
            title: `[Yêu cầu thanh toán] - Phòng ${roomName}`,
            content: `Phòng ${roomName} yêu cầu thanh toán bởi ${requesterName}.`,
            receiverIds: allUserIds,
            createdAt: new Date(),
            data: {
                url: `/xad2_/#!/karaoke/reports`,
                objectId: orderId,
                model: 'SaleOrder',
                type: 'paymentRequested'
            }
        });
    }
};
