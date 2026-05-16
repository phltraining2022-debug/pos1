// Notification Service - Quản lý notifications từ API
(function () {
    'use strict';

    angular.module('karaApp').factory('NotificationService', ['$http', '$q', function ($http, $q) {

        // Tabs (UI structure - không phụ thuộc API)
        var allTabs = [
            { id: 'actions', label: 'Cần xử lý', icon: 'ph-bell-ringing', count: 0 },
            { id: 'all', label: 'Tất cả', icon: 'ph-stack', count: 0 },
            { id: 'orders', label: 'Đơn hàng', icon: 'ph-shopping-cart', count: 0 },
            { id: 'finance', label: 'Tài chính', icon: 'ph-currency-circle-dollar', count: 0 },
            { id: 'inventory', label: 'Kho hàng', icon: 'ph-package', count: 0 },
            { id: 'hr', label: 'Nhân sự', icon: 'ph-users', count: 0 },
            { id: 'purchasing', label: 'Mua hàng', icon: 'ph-shopping-bag', count: 0 },
            { id: 'system', label: 'Hệ thống', icon: 'ph-gear', count: 0 }
        ];

        // Mảng live – giữ reference cố định để ng-repeat binding hoạt động
        var notifications = [];

        // Map server record → UI object
        function mapNotification(item) {
            return {
                id: item.id,
                title: item.title || item.subject || '(Không có tiêu đề)',
                message: item.message || item.body || item.content || '',
                time: item.createdAt || item.time,
                icon: item.icon || _iconByType(item.type),
                type: item.type || 'info',
                module: item.module || item.category || 'system',
                actionable: !!(item.actionable || (item.actions && item.actions.length)),
                actions: item.actions || [],
                unread: item.read === false || item.unread === true || !item.read
            };
        }

        function _iconByType(type) {
            return { success: 'ph-check-circle', warning: 'ph-warning', error: 'ph-x-circle' }[type] || 'ph-bell';
        }

        function _refreshTabCounts() {
            allTabs.forEach(function (tab) {
                if (tab.id === 'all') {
                    tab.count = notifications.filter(function (n) { return n.unread; }).length;
                } else if (tab.id === 'actions') {
                    tab.count = notifications.filter(function (n) { return n.actionable && n.unread; }).length;
                } else {
                    tab.count = notifications.filter(function (n) { return n.module === tab.id && n.unread; }).length;
                }
            });
        }

        var filters = {
            'all': function (n) { return true; },
            'actions': function (n) { return n.actionable; },
            'orders': function (n) { return n.module === 'orders'; },
            'finance': function (n) { return n.module === 'finance'; },
            'inventory': function (n) { return n.module === 'inventory'; },
            'hr': function (n) { return n.module === 'hr'; },
            'purchasing': function (n) { return n.module === 'purchasing'; },
            'system': function (n) { return n.module === 'system'; }
        };

        return {
            getAllTabs: function () { return allTabs; },

            getNotifications: function () { return notifications; },

            // Gọi GET /api/notifications – trả về promise
            loadFromApi: function () {
                var filter = JSON.stringify({ order: 'createdAt DESC', limit: 50 });
                return $http.get(API_BASE_URL + 'notifications', { params: { filter: filter } })
                    .then(function (resp) {
                        var data = Array.isArray(resp.data) ? resp.data : (resp.data && resp.data.data) || [];
                        notifications.length = 0;
                        data.forEach(function (item) { notifications.push(mapNotification(item)); });
                        _refreshTabCounts();
                        return notifications;
                    })
                    .catch(function (err) {
                        console.warn('[NotificationService] API error:', err.status, err.statusText);
                        return notifications;
                    });
            },

            filterByTab: function (tabId) {
                var fn = filters[tabId];
                return fn ? notifications.filter(fn) : notifications;
            },

            markAsRead: function (notif) {
                notif.unread = false;
                _refreshTabCounts();
                if (notif.id) {
                    $http.patch(API_BASE_URL + 'notifications/' + notif.id, { read: true }).catch(function () { });
                }
            },

            getUnreadCount: function () {
                return notifications.filter(function (n) { return n.unread; }).length;
            },

            // ── Push Notification ────────────────────────────────────────────────

            isIOS: function () {
                return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            },

            needsUserGesture: function () {
                var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                return ios && Notification.permission !== 'granted';
            },

            // Xin quyền notification (hỗ trợ iOS 16.4+ PWA)
            requestPermission: function () {
                var deferred = $q.defer();
                var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

                if (isIOS) {
                    if ('serviceWorker' in navigator && 'PushManager' in window) {
                        if (Notification.permission === 'granted') {
                            deferred.resolve('granted');
                        } else if (Notification.permission !== 'denied') {
                            Notification.requestPermission().then(function (p) {
                                deferred.resolve(p);
                            }).catch(function (e) { deferred.reject(e); });
                        } else {
                            deferred.reject('Permission denied');
                        }
                    } else {
                        console.warn('[NotificationService] iOS < 16.4 hoặc chưa cài PWA – không hỗ trợ Web Push.');
                        deferred.reject('Web Push requires iOS 16.4+ and PWA installation');
                    }
                } else {
                    if (!('Notification' in window)) {
                        deferred.reject('Notifications not supported');
                        return deferred.promise;
                    }
                    if (Notification.permission === 'granted') {
                        deferred.resolve('granted');
                    } else if (Notification.permission !== 'denied') {
                        Notification.requestPermission().then(function (p) { deferred.resolve(p); });
                    } else {
                        deferred.reject('Permission denied');
                    }
                }
                return deferred.promise;
            },

            // Hiện local notification
            showNotification: function (title, options) {
                var deferred = $q.defer();
                var self = this;
                if (!('Notification' in window)) {
                    deferred.reject('Notifications not supported');
                    return deferred.promise;
                }
                function _show() {
                    var notif = new Notification(title, options || {});
                    notif.onclick = function (e) {
                        e.preventDefault();
                        window.focus();
                        if (options && options.data && options.data.url) {
                            window.location.href = options.data.url;
                        }
                    };
                    deferred.resolve(notif);
                }
                if (Notification.permission === 'granted') {
                    _show();
                } else {
                    self.requestPermission().then(function (p) {
                        if (p === 'granted') { _show(); }
                        else { deferred.reject('Permission denied'); }
                    });
                }
                return deferred.promise;
            },

            // Đăng ký Web Push subscription và lưu lên server
            subscribeToPush: function (userId) {
                var deferred = $q.defer();
                if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                    deferred.reject('Push notifications not supported');
                    return deferred.promise;
                }
                if (!userId) {
                    deferred.reject('User not authenticated');
                    return deferred.promise;
                }
                navigator.serviceWorker.ready.then(function (reg) {
                    return reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: _urlBase64ToUint8Array(
                            'BIGZUF2tfVeEvnRccCdeD_slfj6ymIhWhjEue5_lGZxYXRRkR1s9yO6ojy0QazJJ3eBl6c7C5CxRjkv8WKZBBcY'
                        )
                    });
                }).then(function (sub) {
                    var subData = {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: _arrayBufferToBase64(sub.getKey('p256dh')),
                            auth: _arrayBufferToBase64(sub.getKey('auth'))
                        }
                    };
                    var filterParam = JSON.stringify({ where: { userId: userId, endpoint: sub.endpoint } });
                    return $http.get(API_BASE_URL + 'installations', { params: { filter: filterParam } })
                        .then(function (resp) {
                            var existing = resp.data;
                            if (existing && existing.length > 0) { return; }
                            return $http.post(API_BASE_URL + 'installations', {
                                userId: userId,
                                deviceToken: subData.keys.p256dh,
                                endpoint: subData.endpoint,
                                osVersion: 'web-push',
                                keys: subData.keys,
                                platform: navigator.platform || 'unknown',
                                userAgent: navigator.userAgent,
                                createdAt: new Date().toISOString()
                            });
                        });
                }).then(function () {
                    deferred.resolve();
                }).catch(function (err) {
                    console.error('[NotificationService] subscribeToPush error:', err);
                    deferred.reject(err);
                });
                return deferred.promise;
            }
        };

        // ── Helpers ──────────────────────────────────────────────────────────────
        function _urlBase64ToUint8Array(base64String) {
            var padding = '='.repeat((4 - base64String.length % 4) % 4);
            var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
            var raw = window.atob(base64);
            var arr = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) { arr[i] = raw.charCodeAt(i); }
            return arr;
        }
        function _arrayBufferToBase64(buffer) {
            var bytes = new Uint8Array(buffer), binary = '';
            for (var i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
            return window.btoa(binary);
        }

    }]);

})();
