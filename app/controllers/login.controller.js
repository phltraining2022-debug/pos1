// Login Controller
angular.module('karaApp').controller('LoginController', ['$scope', '$location', 'ApiService', 'MenuService', 'StorageService', 'SocketService', 'NotificationService',
    function ($scope, $location, ApiService, MenuService, StorageService, SocketService, NotificationService) {

        // ── Kiểm tra session trước khi hiện form login ──────────────────────
        // iOS PWA: khi mở lại app, URL về / → otherwise → /login
        // Nếu đã có token/user trong localStorage thì redirect luôn, không cần login lại
        (function checkExistingSession() {
            if (ApiService.isSessionExpired()) {
                ApiService.forceLogout('session-expired-on-login-page');
                return;
            }

            var existingUser = ApiService.getCurrentUser(); // đọc từ $LoopBack$user
            if (existingUser && ApiService.hasValidSession()) {
                var saved = StorageService.get('currentUser');
                var role = (saved && saved.role) || existingUser.role || 'user';
                var dest = _roleToRoute(role);
                console.log('[Session] Restored for', existingUser.username, '→', dest);
                // Socket init() chạy trước khi currentUser được set → cần resubscribe lại
                SocketService.resubscribe();
                $location.path(dest);
                return;
            }
            // Không có token nhưng có saved credentials → thử re-login im lặng
            if (localStorage.getItem('$LoopBack$rememberCreds')) {
                ApiService.restoreSession().then(function(user) {
                    var saved = StorageService.get('currentUser');
                    var role = (saved && saved.role) || user.role || 'user';
                    // Socket init() chạy trước khi currentUser được set → cần resubscribe lại
                    SocketService.resubscribe();
                    $location.path(_roleToRoute(role));
                }).catch(function() {
                    ApiService.forceLogout('restore-session-failed-on-login-page');
                });
            } else if (existingUser) {
                ApiService.forceLogout('invalid-session-on-login-page');
            }
        })();

        function _roleToRoute(role) {
            if (role === 'cashier' || role === 'admin' || role === 'manager') return '/cashier';
            if (role === 'waiter') return '/waiter';
            if (role === 'kitchen') return '/kitchen';
            return '/cashier';
        }
        // ────────────────────────────────────────────────────────────────────

        $scope.credentials = {
            username: '',
            password: ''
        };

        $scope.isLoading = false;
        $scope.error = '';

        $scope.login = function () {
            if ($scope.isLoading) return;

            $scope.isLoading = true;
            $scope.error = '';

            // Use ApiService for login
            ApiService.login('users', {
                username: $scope.credentials.username,
                password: $scope.credentials.password
            }).then(function (user) {
                console.log('Login successful:', user);

                // Lưu credentials để auto re-login khi iOS PWA mất session
                ApiService.saveRememberMe('users', {
                    username: $scope.credentials.username,
                    password: $scope.credentials.password
                });

                // Store current user in localStorage for WebSocket authentication
                var currentUser = {
                    id: user.id || user._id || Date.now(),
                    username: user.username || $scope.credentials.username,
                    role: user.role || 'user',
                    loginTime: new Date()
                };
                StorageService.set('currentUser', currentUser);

                // Resubscribe WebSocket with new user
                SocketService.resubscribe();

                // Get user profile to determine actual roles
                return ApiService.callGetMethod('users', 'profile');
            }).then(function (profileResponse) {
                console.log('User profile:', profileResponse);

                // Store user profile in localStorage for role checking
                if (profileResponse && profileResponse.data) {
                    localStorage.setItem('userProfile', JSON.stringify(profileResponse.data));
                }

                // Update currentUser with actual role from profile
                var currentUser = StorageService.get('currentUser');
                if (currentUser && profileResponse && profileResponse.data && profileResponse.data.roles) {
                    // Determine primary role for currentUser
                    var roles = profileResponse.data.roles.map(function (role) {
                        return role.name;
                    });
                    
                    var primaryRole = 'user'; // default
                    if (roles.includes('admin') || roles.includes('manager')) {
                        primaryRole = 'admin';
                    } else if (roles.includes('cashier')) {
                        primaryRole = 'cashier';
                    } else if (roles.includes('waiter')) {
                        primaryRole = 'waiter';
                    } else if (roles.includes('kitchen') || roles.includes('chef') || roles.includes('bartender')) {
                        primaryRole = 'kitchen';
                    }
                    
                    currentUser.role = primaryRole;
                    StorageService.set('currentUser', currentUser);
                    
                    // Resubscribe with updated role
                    SocketService.resubscribe();
                }

                // Extract roles from profile response
                var roles = [];
                if (profileResponse && profileResponse.data && profileResponse.data.roles) {
                    roles = profileResponse.data.roles.map(function (role) {
                        return role.name;
                    });
                }

                console.log('User roles:', roles);

                // Sync data from API after successful login
                return syncDataFromAPI().then(function () {
                    // Return roles for redirect logic
                    return roles;
                });
            }).then(function (roles) {
                // Redirect based on actual user roles from API
                // Priority: admin/manager > cashier > waiter > kitchen
                
                var redirectPath = '/login'; // Default fallback
                
                if (roles.includes('admin') || roles.includes('manager')) {
                    // Admins and managers can access any module, default to cashier
                    redirectPath = '/cashier';
                } else if (roles.includes('cashier')) {
                    redirectPath = '/cashier';
                } else if (roles.includes('waiter')) {
                    redirectPath = '/waiter';
                } else if (roles.includes('kitchen') || roles.includes('chef') || roles.includes('bartender')) {
                    redirectPath = '/kitchen';
                } else {
                    // No recognized roles found
                    console.warn('No recognized roles found for user. Available roles:', roles);
                    redirectPath = '/login'; // Stay on login or redirect to access denied
                }
                
                console.log('Redirecting to:', redirectPath, 'based on roles:', roles);
                $location.path(redirectPath);

                // Đăng ký Web Push subscription sau khi login thành công
                var loggedInUser = ApiService.getCurrentUser();
                var userId = loggedInUser && (loggedInUser.id || loggedInUser._id);
                if (userId) {
                    NotificationService.requestPermission().then(function (permission) {
                        if (permission === 'granted') {
                            NotificationService.subscribeToPush(userId).catch(function (err) {
                                console.warn('[Push] subscribeToPush failed:', err);
                            });
                        }
                    }).catch(function () { /* user denied – silent */ });
                }
            }).catch(function (error) {
                console.error('Login failed:', error);
                $scope.error = 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.';
            }).finally(function () {
                $scope.isLoading = false;
            });
        };

        // Function to sync data from API
        function syncDataFromAPI() {
            console.log('Starting data synchronization...');

            return Promise.all([
                // Sync products
                ApiService.getAll('products').then(function (products) {
                    console.log('Products synced:', products.length);
                    // Update MenuService with API data
                    if (products && products.length > 0) {
                        // Transform API data to match local format
                        var transformedProducts = products.map(function (p) {
                            return {
                                id: p.id || p._id,
                                categoryId: p.category || 'Khác',
                                name: p.name,
                                price: p.sellingPrice || p.price || 0,
                                cost: p.price || 0,
                                unit: p.unit || p.uomId || 'phần',
                                stock: 9999, // Unlimited stock for now
                                image: p.image || '',
                                code: p.code || '',
                                description: p.description || '',
                                alcoholic: p.alcoholic || false,
                                isTimeBased: p.isTimeBased || false,
                                type: p.type || 'Hàng hóa thường',
                                variants: p.variants || [],
                                isActive: p.isActive !== false,
                                originalData: p
                            };
                        });

                        // Save to localStorage
                        StorageService.set('menuItems', transformedProducts);

                        // Build categories from products
                        var catMap = {};
                        var catList = [];
                        products.forEach(function (p) {
                            var catName = p.category || 'Khác';
                            if (!catMap[catName]) {
                                catMap[catName] = true;
                                catList.push(catName);
                            }
                        });

                        var categories = catList.map(function (catName) {
                            var icon = '';
                            if (catName.toLowerCase().indexOf('bia') >= 0) icon = 'fa-beer-mug-empty';
                            else if (catName.toLowerCase().indexOf('nước') >= 0) icon = 'fa-bottle-droplet';
                            else if (catName.toLowerCase().indexOf('khô') >= 0) icon = 'fa-fish';
                            else if (catName.toLowerCase().indexOf('trái cây') >= 0) icon = 'fa-apple-whole';
                            else if (catName.toLowerCase().indexOf('giờ') >= 0) icon = 'fa-clock';
                            else if (catName.toLowerCase().indexOf('phí') >= 0 || catName.toLowerCase().indexOf('phụ thu') >= 0) icon = 'fa-clock';
                            else if (catName.toLowerCase().indexOf('thuốc') >= 0) icon = 'fa-smoking';
                            else if (catName.toLowerCase().indexOf('rượu') >= 0) icon = 'fa-wine-bottle';
                            else if (catName.toLowerCase().indexOf('đồ ăn') >= 0) icon = 'fa-utensils';
                            else icon = 'fa-box';

                            return {
                                id: catName,
                                name: catName,
                                icon: icon
                            };
                        });

                        StorageService.set('categories', categories);
                    }
                }).catch(function (error) {
                    console.warn('Failed to sync products:', error);
                }),

                // Sync rooms
                ApiService.getAll('rooms').then(function (rooms) {
                    console.log('Rooms synced:', rooms.length);
                    // Update RoomService with API data
                    if (rooms && rooms.length > 0) {

                        // Save to localStorage
                        StorageService.set('rooms', rooms);
                    }
                }).catch(function (error) {
                    console.warn('Failed to sync rooms:', error);
                })
            ]);
        };
    }
]);
