// Trigger: Xin nghỉ phép mới
// Fired when: LeaveRequest created
module.exports = async function(instance) {
    if (!instance || !instance.data) return;

    const app = require('../../server');
    const { User, notification: Notification, Employee } = app.models;

    const req = instance.data;
    const reqId = instance.objectId || 'none';

    // Tên người xin nghỉ - ưu tiên userName có sẵn trong document
    let requesterName = req.userName || '';
    if (!requesterName && req.userId) {
        const user = await User.findById(req.userId);
        if (user) requesterName = user.fullName || user.username || '';
    }
    if (!requesterName && req.employeeId) {
        const emp = await Employee.findById(req.employeeId);
        if (emp) requesterName = emp.fullName || emp.name || '';
    }
    requesterName = requesterName || 'Nhân viên';

    // Loại nghỉ (map sang tiếng Việt dễ đọc)
    const leaveTypeMap = {
        'Annual Leave': 'Nghỉ năm',
        'Sick Leave': 'Nghỉ bệnh',
        'Maternity Leave': 'Nghỉ thai sản',
        'Paternity Leave': 'Nghỉ thai sản (cha)',
        'Parental Leave': 'Nghỉ cha/mẹ',
        'Bereavement Leave': 'Nghỉ tang',
        'Personal Leave': 'Nghỉ việc riêng',
        'Unpaid Leave': 'Nghỉ không lương',
        'Study Leave': 'Nghỉ học',
        'Public Holiday': 'Nghỉ lễ',
        'Other': 'Khác'
    };
    const leaveTypeLabel = leaveTypeMap[req.leaveType] || req.leaveType || 'Chưa rõ';

    // Format ngày
    const fmt = d => d ? new Date(d).toLocaleDateString('vi-VN') : '?';
    const startFmt = fmt(req.startDate);
    const endFmt = fmt(req.endDate);

    const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);

    const title = `[Xin nghỉ phép] - ${requesterName}`;
    let content = `${requesterName} xin nghỉ ${leaveTypeLabel} từ ${startFmt} đến ${endFmt}.`;
    if (req.reason) content += ` Lý do: ${req.reason}.`;
    if (req.code) content += ` Mã: ${req.code}.`;

    console.log(`[Trigger] LeaveRequest.created - ${requesterName}, ${leaveTypeLabel}, ${startFmt} → ${endFmt}`);

    await Notification.create({
        title,
        content,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/hr/leave-requests`,
            objectId: reqId,
            model: 'LeaveRequest',
            status: req.status,
            type: 'LeaveRequest'
        }
    });
    // Web push được gửi tự động qua Notification.afterSave
};
