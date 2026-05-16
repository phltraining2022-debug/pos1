// Shared Staff Panel logic (attendance check-in/out + leave requests)
// Used by both CashierController and WaiterController via StaffPanelService.init($scope, config)
// config: { accent: 'purple'|'blue', loadPendingLeaves: true|false }
angular.module('karaApp').service('StaffPanelService', [
    'AttendanceService', 'ApiService',
    function(AttendanceService, ApiService) {

        // Map internal short codes ↔ API enum values
        var TYPE_TO_API = {
            annual:   'Annual Leave',
            sick:     'Sick Leave',
            personal: 'Personal Leave',
            unpaid:   'Unpaid Leave'
        };
        var TYPE_FROM_API = {};
        Object.keys(TYPE_TO_API).forEach(function(k) { TYPE_FROM_API[TYPE_TO_API[k]] = k; });

        function normalizeLeave(leave) {
            return angular.extend({}, leave, {
                type:   TYPE_FROM_API[leave.leaveType] || leave.type || leave.leaveType,
                status: leave.status ? leave.status.toLowerCase() : leave.status
            });
        }

        this.init = function($scope, config) {
            var currentUser = $scope.currentUser;

            $scope.staffPanel = { show: false, activeTab: 'attendance', accent: config.accent || 'blue' };
            $scope.leaveForm = { startDate: '', endDate: '', type: '', reason: '' };
            $scope.attendanceCapture = { photo: null, location: null, locationError: null, locationLoading: false };

            function refreshAttendance() {
                AttendanceService.getTodayRecord(currentUser.id).then(function(rec) {
                    $scope.attendanceTodayRecord = rec;
                });
            }

            function refreshLeaveData() {
                ApiService.getAll('LeaveRequest', { where: { userId: currentUser.id }, order: 'createdAt DESC' })
                    .then(function(res) {
                        $scope.myLeaves = (res || []).map(normalizeLeave);
                    });

                if (config.loadPendingLeaves) {
                    ApiService.getAll('LeaveRequest', { where: { status: 'pending' }, order: 'createdAt DESC' })
                        .then(function(res) {
                            $scope.pendingLeaves = (res || []).map(normalizeLeave);
                        });
                }
            }

            // Expose so controllers can call after approve/reject
            $scope.refreshLeaveData = refreshLeaveData;

            refreshAttendance();
            refreshLeaveData();

            $scope.toggleStaffTab = function(tab) {
                $scope.staffPanel.activeTab = $scope.staffPanel.activeTab === tab ? null : tab;
            };

            $scope.onPhotoCaptured = function(input) {
                var file = input.files && input.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function(e) {
                    $scope.$apply(function() {
                        $scope.attendanceCapture.photo = e.target.result;
                        $scope.attendanceCapture.status = 'capturing_gps';
                        _fetchGPSAndSubmit();
                    });
                };
                reader.readAsDataURL(file);
                input.value = '';
            };

            function _fetchGPSAndSubmit() {
                if (!navigator.geolocation) {
                    $scope.attendanceCapture.locationError = 'Thiết bị không hỗ trợ GPS';
                    $scope.attendanceCapture.status = 'error';
                    return;
                }
                navigator.geolocation.getCurrentPosition(
                    function(pos) {
                        $scope.$apply(function() {
                            $scope.attendanceCapture.location = {
                                lat: pos.coords.latitude,
                                lng: pos.coords.longitude,
                                accuracy: Math.round(pos.coords.accuracy)
                            };
                            _submitAttendance();
                        });
                    },
                    function() {
                        $scope.$apply(function() {
                            $scope.attendanceCapture.locationError = 'Không lấy được GPS. Vui lòng bật GPS và thử lại.';
                            $scope.attendanceCapture.status = 'error';
                        });
                    },
                    { timeout: 10000, enableHighAccuracy: true }
                );
            }

            function _submitAttendance() {
                var action = $scope.attendanceCapture.pendingAction;
                var extras = { photo: $scope.attendanceCapture.photo, location: $scope.attendanceCapture.location };
                if (action === 'checkIn') {
                    AttendanceService.checkIn(currentUser.id, currentUser.username, currentUser.role, extras)
                        .then(function(result) {
                            if (result.success) {
                                $scope.attendanceCapture = { photo: null, location: null, locationError: null, locationLoading: false, status: null, pendingAction: null };
                                $scope.attendanceTodayRecord = result.record;
                                alert('Chấm công vào thành công!');
                            } else {
                                $scope.attendanceCapture.status = 'error';
                                $scope.attendanceCapture.locationError = result.message;
                            }
                        }).catch(function(err) {
                            $scope.attendanceCapture.status = 'error';
                            $scope.attendanceCapture.locationError = 'Lỗi kết nối server. Vui lòng thử lại.';
                            console.error('checkIn error', err);
                        });
                } else if (action === 'checkOut') {
                    AttendanceService.checkOut(currentUser.id, currentUser.username, extras)
                        .then(function(result) {
                            if (result.success) {
                                $scope.attendanceCapture = { photo: null, location: null, locationError: null, locationLoading: false, status: null, pendingAction: null };
                                $scope.attendanceTodayRecord = result.record;
                                alert('Chấm công ra thành công! Tổng: ' + result.record.durationMinutes + ' phút');
                            } else {
                                $scope.attendanceCapture.status = 'error';
                                $scope.attendanceCapture.locationError = result.message;
                            }
                        }).catch(function(err) {
                            $scope.attendanceCapture.status = 'error';
                            $scope.attendanceCapture.locationError = 'Lỗi kết nối server. Vui lòng thử lại.';
                            console.error('checkOut error', err);
                        });
                }
            }

            $scope.checkIn = function() {
                $scope.attendanceCapture = { photo: null, location: null, locationError: null, locationLoading: false, status: 'capturing_photo', pendingAction: 'checkIn' };
                var el = document.getElementById('staffCameraInput');
                if (el) el.click();
            };

            $scope.checkOut = function() {
                if (!confirm('Xác nhận chấm công ra?')) return;
                $scope.attendanceCapture = { photo: null, location: null, locationError: null, locationLoading: false, status: 'capturing_photo', pendingAction: 'checkOut' };
                var el = document.getElementById('staffCameraInput');
                if (el) el.click();
            };

            $scope.getWorkingDuration = function() {
                if (!$scope.attendanceTodayRecord || !$scope.attendanceTodayRecord.checkInTime) return '';
                var mins = Math.round((Date.now() - new Date($scope.attendanceTodayRecord.checkInTime)) / 60000);
                var h = Math.floor(mins / 60);
                var m = mins % 60;
                return (h > 0 ? h + 'h ' : '') + m + ' phút';
            };

            $scope.submitLeaveRequest = function() {
                var form = $scope.leaveForm;
                if (!form.startDate || !form.endDate || !form.type) {
                    alert('Vui lòng nhập đầy đủ ngày và loại nghỉ.');
                    return;
                }
                if (form.startDate > form.endDate) {
                    alert('Ngày bắt đầu phải trước ngày kết thúc.');
                    return;
                }
                var payload = {
                    userId:    currentUser.id,
                    userName:  currentUser.username,
                    role:      currentUser.role,
                    leaveType: TYPE_TO_API[form.type] || form.type,
                    startDate: form.startDate,
                    endDate:   form.endDate,
                    reason:    form.reason || '',
                    status:    'pending'
                };
                ApiService.create('LeaveRequest', payload)
                    .then(function() {
                        $scope.leaveForm = { startDate: '', endDate: '', type: '', reason: '' };
                        refreshLeaveData();
                        alert('Đã gửi yêu cầu nghỉ phép!');
                    })
                    .catch(function(err) {
                        alert('Gửi yêu cầu thất bại. Vui lòng thử lại.');
                        console.error('submitLeaveRequest error', err);
                    });
            };
        };
    }
]);
