// Trigger: Gửi bếp - khách gọi món mới
// Fired when: SaleOrderItem created (waiter/cashier gửi món vào bếp)
module.exports = async function(instance) {
    if (!instance || !instance.data) return;

    const item = instance.data;
    if (!item.saleOrderId) return;

    const app = require('../../server');
    const { getUserIdsByRoles } = require('./_helpers');
    const { notification: Notification, SaleOrder, Room } = app.models;

    try {
        const saleOrder = await SaleOrder.findById(item.saleOrderId);
        if (!saleOrder || !saleOrder.roomId) return;

        const room = await Room.findById(saleOrder.roomId);
        const roomName = room ? (room.name || room.code || 'N/A') : 'N/A';
        const productName = item.name || item.productName || 'Món không tên';
        const quantity = item.quantity || 1;
        const orderId = String(item.saleOrderId);

        console.log(`[Trigger] SaleOrderItem.created - Room: ${roomName}, Item: ${productName} x${quantity}`);

        // waiter + kitchen + manager nhận thông báo gửi bếp
        const allUserIds = await getUserIdsByRoles(app, ['waiter', 'kitchen']);

        await Notification.create({
            title: `[Bếp] Phòng ${roomName}: Món mới`,
            content: `${productName} x${quantity} - Phòng ${roomName}`,
            receiverIds: allUserIds,
            createdAt: new Date(),
            data: {
                url: `/xad2_/#!/karaoke/kitchen`,
                objectId: orderId,
                model: 'SaleOrder',
                type: 'newKitchenItem',
                roomName,
                productName,
                quantity
            }
        });
    } catch (err) {
        console.error('[Trigger] SaleOrderItem.created error:', err);
    }
};
