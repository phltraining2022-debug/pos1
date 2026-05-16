// Leave Request Service
angular.module('karaApp').service('LeaveService', ['StorageService', 'AuditService',
    function(StorageService, AuditService) {
        var STORAGE_KEY = 'leaveRequests';

        function getAllLeaves() {
            return StorageService.get(STORAGE_KEY) || [];
        }

        function saveAllLeaves(leaves) {
            StorageService.set(STORAGE_KEY, leaves);
        }

        this.submitLeave = function(userId, userName, role, data) {
            if (!data.startDate || !data.endDate || !data.type) {
                return { success: false, message: 'Vui lòng nhập đầy đủ ngày và loại nghỉ.' };
            }
            if (data.startDate > data.endDate) {
                return { success: false, message: 'Ngày bắt đầu phải trước ngày kết thúc.' };
            }
            var leaves = getAllLeaves();
            var leave = {
                id: 'leave_' + Date.now() + '_' + userId,
                userId: userId,
                userName: userName,
                role: role,
                type: data.type,
                startDate: data.startDate,
                endDate: data.endDate,
                reason: data.reason || '',
                status: 'pending',
                createdAt: new Date().toISOString(),
                reviewedBy: null,
                reviewedAt: null,
                reviewNote: ''
            };
            leaves.push(leave);
            saveAllLeaves(leaves);
            AuditService.log('leave_request', userName, userName + ' gửi yêu cầu nghỉ phép', {
                leaveId: leave.id, type: data.type
            });
            return { success: true, leave: leave };
        };

        this.getMyLeaves = function(userId) {
            return getAllLeaves()
                .filter(function(l) { return l.userId === userId; })
                .sort(function(a, b) { return b.createdAt > a.createdAt ? 1 : -1; });
        };

        this.getPendingLeaves = function() {
            return getAllLeaves()
                .filter(function(l) { return l.status === 'pending'; })
                .sort(function(a, b) { return b.createdAt > a.createdAt ? 1 : -1; });
        };

        this.approveLeave = function(leaveId, reviewerName) {
            var leaves = getAllLeaves();
            var idx = leaves.findIndex(function(l) { return l.id === leaveId; });
            if (idx === -1) return { success: false };
            leaves[idx].status = 'approved';
            leaves[idx].reviewedBy = reviewerName;
            leaves[idx].reviewedAt = new Date().toISOString();
            saveAllLeaves(leaves);
            AuditService.log('leave_approved', reviewerName, 'Duyệt phép: ' + leaves[idx].userName, { leaveId: leaveId });
            return { success: true, leave: leaves[idx] };
        };

        this.rejectLeave = function(leaveId, reviewerName, note) {
            var leaves = getAllLeaves();
            var idx = leaves.findIndex(function(l) { return l.id === leaveId; });
            if (idx === -1) return { success: false };
            leaves[idx].status = 'rejected';
            leaves[idx].reviewedBy = reviewerName;
            leaves[idx].reviewedAt = new Date().toISOString();
            leaves[idx].reviewNote = note || '';
            saveAllLeaves(leaves);
            AuditService.log('leave_rejected', reviewerName, 'Từ chối phép: ' + leaves[idx].userName, { leaveId: leaveId });
            return { success: true, leave: leaves[idx] };
        };
    }
]);
