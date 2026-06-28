// WebSocket Service for real-time updates
angular.module('karaApp').service('SocketService', ['$rootScope', '$timeout', 'StorageService',
    function($rootScope, $timeout, StorageService) {
        var ws = null;
        var isConnected = false;
        var reconnectAttempts = 0;
        var reconnectDelay = 1000; // Start with 1 second
        var maxReconnectDelay = 30000; // Cap at 30 seconds

        // Configuration - can be overridden
        var config = {
            url: 'wss://kara.test.live1.vn/wss/',
            clinicShortName: 'kara'
        };

        // Initialize Socket.IO connection
        this.init = function(options) {
            if (options) {
                config = Object.assign(config, options);
            }

            console.log('🔌 Initializing Socket.IO connection to:', config.url);
            this.connect();

            // Khi tab/PWA trở lại foreground: reconnect + resubscribe nếu cần
            var self = this;
            document.addEventListener('visibilitychange', function() {
                if (document.visibilityState === 'visible') {
                    console.log('👁️ App visible — checking WebSocket...');
                    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                        reconnectAttempts = 0;
                        self.connect();
                    } else if (ws.readyState === WebSocket.OPEN) {
                        self.subscribe();
                    }
                }
            });

            // Khi mạng reconnect (mất WiFi/3G rồi có lại)
            window.addEventListener('online', function() {
                console.log('🌐 Network online — reconnecting WebSocket...');
                reconnectAttempts = 0;
                self.connect();
            });
        };

        // Connect to WebSocket server
        this.connect = function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                console.log('🔌 WebSocket already connected');
                return;
            }

            try {
                ws = new WebSocket(config.url);

                ws.onopen = () => {
                    console.log('✅ WebSocket connected!');
                    isConnected = true;
                    reconnectAttempts = 0;

                    // Subscribe to updates
                    this.subscribe();

                    // Notify controllers
                    $rootScope.$apply(() => {
                        $rootScope.$broadcast('socket:connected');
                    });
                };

                ws.onclose = (event) => {
                    console.log('❌ WebSocket disconnected:', event.reason);
                    isConnected = false;

                    $rootScope.$apply(() => {
                        $rootScope.$broadcast('socket:disconnected', event.reason);
                    });

                    // Auto reconnect với exponential backoff, không giới hạn số lần
                    reconnectAttempts++;
                    var delay = Math.min(reconnectDelay * reconnectAttempts, maxReconnectDelay);
                    console.log('🔄 Reconnecting in', delay + 'ms (attempt ' + reconnectAttempts + ')');
                    setTimeout(() => {
                        this.connect();
                    }, delay);
                };

                ws.onerror = (error) => {
                    console.error('🔴 WebSocket error:', error);
                    reconnectAttempts++;

                    $rootScope.$apply(() => {
                        $rootScope.$broadcast('socket:error', error);
                    });
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('📩 Received WebSocket message:', data);

                        // Handle different message types
                        if (data.action === 'subscribe_success') {
                            console.log('✅ Successfully subscribed to updates');
                        } else if (data.model && data.event) {
                            // This is an update message
                            $rootScope.$apply(() => {
                                $rootScope.$broadcast('socket:update', data);
                            });
                        }
                    } catch (err) {
                        console.error('❌ Error parsing WebSocket message:', err);
                    }
                };

            } catch (error) {
                console.error('❌ Failed to initialize WebSocket:', error);
            }
        };

        // Subscribe to updates
        this.subscribe = function() {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                console.warn('⚠️ Cannot subscribe - WebSocket not connected');
                return;
            }

            var currentUser = StorageService.get('currentUser');
            // Fallback: lấy từ userProfile nếu currentUser chưa được set
            if (!currentUser) {
                try {
                    var profileRaw = localStorage.getItem('userProfile');
                    if (profileRaw) {
                        var profile = JSON.parse(profileRaw);
                        if (profile && profile.user) {
                            currentUser = {
                                id: profile.user.id,
                                username: profile.user.username,
                                role: (profile.roles && profile.roles[0] && profile.roles[0].name) || 'user'
                            };
                        }
                    }
                } catch (e) { /* ignore */ }
            }
            if (!currentUser) {
                console.warn('⚠️ Cannot subscribe - no current user');
                return;
            }

            const subscribeMessage = {
                action: 'subscribe',
                filter: {
                    userId: currentUser.id,
                    clinicShortName: config.clinicShortName
                }
            };

            ws.send(JSON.stringify(subscribeMessage));
            console.log('📱 Subscribed to updates:', subscribeMessage.filter);
        };

        // Resubscribe with current user (call after login)
        this.resubscribe = function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                this.subscribe();
            }
        };

        // Disconnect
        this.disconnect = function() {
            if (ws) {
                ws.close();
                ws = null;
                isConnected = false;
                console.log('🔌 WebSocket manually disconnected');
            }
        };
    }]);
