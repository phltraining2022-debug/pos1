// Attendance Service - Direct API only (no localStorage)
angular.module('karaApp').service('AttendanceService', ['$q', 'AuditService', 'ApiService',
    function($q, AuditService, ApiService) {
        // Normalize server field names to match what views expect
        function normalizeRecord(rec) {
            if (!rec) return null;
            if (rec.checkIn && !rec.checkInTime)   rec.checkInTime  = typeof rec.checkIn  === 'object' ? rec.checkIn.toISOString()  : rec.checkIn;
            if (rec.checkOut && !rec.checkOutTime) rec.checkOutTime = typeof rec.checkOut === 'object' ? rec.checkOut.toISOString() : rec.checkOut;
            if (rec.workHours && !rec.durationMinutes) rec.durationMinutes = Math.round(rec.workHours * 60);
            // Server saves photo URLs as checkInPhotoUrl/checkOutPhotoUrl after processing base64
            if (rec.checkInPhotoUrl && !rec.checkInPhoto)   rec.checkInPhoto  = rec.checkInPhotoUrl;
            if (rec.checkOutPhotoUrl && !rec.checkOutPhoto) rec.checkOutPhoto = rec.checkOutPhotoUrl;
            return rec;
        }

        // In-memory session cache only (cleared on page reload, never persisted)
        var _cache = {}; // keyed by userId, holds today's record

        function todayDateStr() {
            var d = new Date();
            return d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
        }

        // Returns a promise resolving to today's record or null
        this.getTodayRecord = function(userId) {
            if (_cache[userId] !== undefined) {
                return $q.resolve(_cache[userId]);
            }
            var today = todayDateStr();
            return ApiService.getAll('Attendance', { where: { userId: userId, date: today }, limit: 1 })
                .then(function(records) {
                    var rec = (records && records.length) ? normalizeRecord(records[0]) : null;
                    _cache[userId] = rec;
                    return rec;
                });
        };

        // Invalidate cache so next getTodayRecord re-fetches
        this.invalidateCache = function(userId) {
            delete _cache[userId];
        };

        // Returns a promise resolving to { success, record } or { success: false, message }
        this.checkIn = function(userId, userName, role, extras) {
            var self = this;
            var today = todayDateStr();
            return self.getTodayRecord(userId).then(function(existing) {
                if (existing && existing.checkIn) {
                    return { success: false, message: 'Bạn đã chấm công vào hôm nay.' };
                }
                var payload = {
                    userId: userId,
                    userName: userName,
                    role: role,
                    date: today,
                    checkIn: new Date().toISOString(),
                    checkInPhoto: (extras && extras.photo) || null,
                    checkInLocation: (extras && extras.location) || null,
                    status: 'present'
                };
                if (payload.checkInLocation) {
                    payload.checkInLocation = {
                        latitude: payload.checkInLocation.lat,
                        longitude: payload.checkInLocation.lng,
                        accuracy: payload.checkInLocation.accuracy
                    };
                }
                return ApiService.create('Attendance', payload).then(function(rec) {
                    normalizeRecord(rec);
                    _cache[userId] = rec;
                    AuditService.log('checkin', userName, userName + ' chấm công vào', {
                        userId: userId, role: role,
                        hasPhoto: !!(extras && extras.photo),
                        location: (extras && extras.location) || null
                    });
                    return { success: true, record: rec };
                });
            });
        };

        // Returns a promise resolving to { success, record } or { success: false, message }
        this.checkOut = function(userId, userName, extras) {
            var self = this;
            return self.getTodayRecord(userId).then(function(existing) {
                if (!existing || !existing.checkIn) {
                    return { success: false, message: 'Không tìm thấy bản ghi chấm công hôm nay.' };
                }
                if (existing.checkOut) {
                    return { success: false, message: 'Bạn đã chấm công ra hôm nay.' };
                }
                var now = new Date();
                var durationMinutes = Math.round((now - new Date(existing.checkIn)) / 60000);
                var payload = {
                    userId: userId,
                    date: existing.date,
                    checkOut: now.toISOString(),
                    checkOutPhoto: (extras && extras.photo) || null,
                    checkOutLocation: (extras && extras.location) || null,
                    workHours: +(durationMinutes / 60).toFixed(2)
                };
                if (payload.checkOutLocation) {
                    payload.checkOutLocation = {
                        latitude: payload.checkOutLocation.lat,
                        longitude: payload.checkOutLocation.lng,
                        accuracy: payload.checkOutLocation.accuracy
                    };
                }
                return ApiService.update('Attendance', existing.id, payload).then(function(rec) {
                    normalizeRecord(rec);
                    rec.durationMinutes = durationMinutes;
                    _cache[userId] = rec;
                    AuditService.log('checkout', userName, userName + ' chấm công ra', {
                        userId: userId,
                        durationMinutes: durationMinutes,
                        hasPhoto: !!(extras && extras.photo),
                        location: (extras && extras.location) || null
                    });
                    return { success: true, record: rec };
                });
            });
        };

        // Returns a promise resolving to array of records
        this.getHistory = function(userId, limit) {
            var filter = { where: { userId: userId }, order: 'date DESC' };
            if (limit) filter.limit = limit;
            return ApiService.getAll('Attendance', filter).then(function(recs) {
                return (recs || []).map(normalizeRecord);
            });
        };

        // Returns a promise resolving to today's records for all staff
        this.getAllTodayRecords = function() {
            var today = todayDateStr();
            return ApiService.getAll('Attendance', { where: { date: today } });
        };
    }
]);
