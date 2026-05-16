// Trigger: Nhân viên check-in
// Fired when: Attendance created
module.exports = async function(instance) {
    if (!instance || !instance.data) return;

    const app = require('../../server');
    const { User, notification: Notification } = app.models;

    const att = instance.data;
    const attId = instance.objectId || 'none';

    // Tên nhân viên - dùng userName có sẵn trước, fallback query User
    let staffName = att.userName || '';
    if (!staffName && att.userId) {
        const user = await User.findById(att.userId).catch(() => null);
        if (user) staffName = user.fullName || user.username || '';
    }
    staffName = staffName || 'Nhân viên';

    // Format giờ theo UTC+7
    const checkInTime = att.checkIn
        ? new Date(att.checkIn).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
        : '?';
    const dateStr = att.date
        ? new Date(att.date).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : new Date().toLocaleDateString('vi-VN');

    // Chỉ thông báo cho quản lý/admin — hiện gửi toàn bộ, có thể filter sau
    const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);

    const title = `[Check-in] - ${staffName}`;
    let content = `${staffName} đã check-in lúc ${checkInTime} ngày ${dateStr}.`;
    if (att.isLate && att.lateMinutes > 0) content += ` Đi trễ ${att.lateMinutes} phút.`;

    console.log(`[Trigger] Attendance.created (check-in) - ${staffName} at ${checkInTime}`);

    await Notification.create({
        title,
        content,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/hr/attendance`,
            objectId: attId,
            model: 'Attendance',
            type: 'CheckIn',
            userId: att.userId
        }
    });
};
