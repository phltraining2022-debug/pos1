// Trigger: Nhân viên check-out
// Fired when: Attendance updated → checkOut field xuất hiện
module.exports = async function(instance) {
    if (!instance || !instance.changes) return;
    // Chỉ xử lý khi checkOut mới được ghi (từ null/undefined sang có giá trị)
    if (!instance.changes.checkOut || !instance.changes.checkOut.to) return;

    const app = require('../../server');
    const { User, notification: Notification } = app.models;

    const att = instance.data;
    const attId = instance.objectId || 'none';

    // Tên nhân viên
    let staffName = att.userName || '';
    if (!staffName && att.userId) {
        const user = await User.findById(att.userId).catch(() => null);
        if (user) staffName = user.fullName || user.username || '';
    }
    staffName = staffName || 'Nhân viên';

    // Format giờ theo UTC+7
    const fmtTime = d => d
        ? new Date(d).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
        : '?';
    const checkInTime = fmtTime(att.checkIn);
    const checkOutTime = fmtTime(att.checkOut);
    const dateStr = att.date
        ? new Date(att.date).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : new Date().toLocaleDateString('vi-VN');

    const workHours = att.workHours != null ? att.workHours.toFixed(1) : '?';

    const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);

    const title = `[Check-out] - ${staffName}`;
    let content = `${staffName} đã check-out lúc ${checkOutTime} ngày ${dateStr}. Check-in: ${checkInTime}, làm việc: ${workHours} giờ.`;
    if (att.isEarlyLeave && att.earlyLeaveMinutes > 0) content += ` Về sớm ${att.earlyLeaveMinutes} phút.`;

    console.log(`[Trigger] Attendance.updated (check-out) - ${staffName}, workHours: ${workHours}`);

    await Notification.create({
        title,
        content,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/hr/attendance`,
            objectId: attId,
            model: 'Attendance',
            type: 'CheckOut',
            userId: att.userId
        }
    });
};
