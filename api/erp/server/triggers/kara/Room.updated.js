// Trigger: Phòng dọn xong, sẵn sàng đón khách
// Fired when: Room updated → status from "cleaning" to "available"
module.exports = async function(instance) {
    if (!instance || !instance.changes || !instance.changes.status) return;
    if (instance.changes.status.from !== 'cleaning' || instance.changes.status.to !== 'available') return;

    const app = require('../../server');
    const { getUserIdsByRoles } = require('./_helpers');
    const { notification: Notification } = app.models;

    const room = instance.data;
    const roomId = instance.objectId || room.id || 'none';
    const roomName = room.name || room.code || 'Phòng không tên';

    // cashier + manager nhận thông báo phòng sẵn sàng
    const allUserIds = await getUserIdsByRoles(app, ['cashier']);

    console.log(`[Trigger] Room.updated (available) - Room: ${roomName}`);

    await Notification.create({
        title: `[Sẵn sàng] - Phòng ${roomName}`,
        content: `Phòng ${roomName} đã dọn dẹp xong và chuyển sang trạng thái trống.`,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/builder-1/me/#!/rooms/${roomId}`,
            objectId: roomId,
            model: 'Room',
            status: 'available',
            type: 'RoomStatusChange'
        }
    });
    // Web push được gửi tự động qua Notification.afterSave
};
