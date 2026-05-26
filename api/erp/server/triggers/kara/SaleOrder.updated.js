// Trigger: Đơn hàng hoàn thành / yêu cầu thanh toán
// Fired when: SaleOrder updated
module.exports = async function(instance) {
    if (!instance || !instance.data) return;

    const saleOrder = instance.data;
    const changes = instance.changes || {};

    // --- Thanh toán hoàn thành (status → completed) ---
    const statusToCompleted = changes.status && changes.status.to === 'completed';
    if (statusToCompleted) {
        if (saleOrder.status === 'completed') {
            const app = require('../../server');
            const { getUserIdsByRoles } = require('./_helpers');
            const { notification: Notification, Room } = app.models;

            let roomName = 'N/A';
            if (saleOrder.roomId) {
                const room = await Room.findById(saleOrder.roomId);
                if (room) roomName = room.name || room.code || 'Phòng không tên';
            }

            const paidAmount = saleOrder.paidAmount || saleOrder.total || 0;
            const paymentMethod = saleOrder.paymentMethod || 'Tiền mặt';
            const orderId = instance.objectId || '';
            const orderCode = saleOrder.code || orderId;

            // manager + cashier nhận thông báo thanh toán hoàn thành
            const allUserIds = await getUserIdsByRoles(app, ['cashier']);

            console.log(`[Trigger] SaleOrder.updated (completed) - ${orderCode}, Room: ${roomName}, Amount: ${paidAmount}`);

            await Notification.create({
                title: `[Thanh toán] - Phòng ${roomName}`,
                content: `Phòng ${roomName} đã thanh toán ${paidAmount.toLocaleString('vi-VN')} VNĐ qua ${paymentMethod}.`,
                receiverIds: allUserIds,
                createdAt: new Date(),
                data: {
                    url: `/xad2_/#!/karaoke/reports`,
                    objectId: orderId,
                    model: 'SaleOrder',
                    type: 'paymentCompleted',
                    roomName,
                    paidAmount,
                    paymentMethod,
                }
            });
        }
    }

    // --- Yêu cầu thanh toán ---
    if (saleOrder.paymentRequested === true) {
        const app = require('../../server');
        const { getUserIdsByRoles } = require('./_helpers');
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

        // cashier + manager nhận yêu cầu thanh toán
        const allUserIds = await getUserIdsByRoles(app, ['cashier']);
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
