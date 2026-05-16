// Kitchen Display Controller
angular.module('karaApp').controller('KitchenController', 
    ['$scope', '$location', '$interval', '$timeout', 'ApiService', 'RoomService', 'MenuService', 'OrderService', 'SocketService', 'StorageService',
    function($scope, $location, $interval, $timeout, ApiService, RoomService, MenuService, OrderService, SocketService, StorageService) {
        var currentUser = ApiService.getCurrentUser();
        if (!currentUser) {
            $location.path('/login');
            return;
        }
        
        $scope.currentUser = currentUser;
        $scope.rooms = RoomService.getRooms();
        $scope.orders = []; // All orders from all occupied rooms
        $scope.filter = 'all'; // all, pending, preparing, ready
        
        // Initialize - load all orders from all occupied rooms
        $scope.loadAllOrders = function() {
            console.log('👨‍🍳 Loading all orders for kitchen...');
            $scope.orders = [];
            
            var occupiedRooms = $scope.rooms.filter(function(room) {
                return room.status === 'occupied' && room.saleOrderId;
            });
            
            console.log('🏠 Found', occupiedRooms.length, 'occupied rooms');
            
            // Step 1: Load from localStorage first (for immediate display)
            loadOrdersFromLocal(occupiedRooms);
            
            // Step 2: Load from server and merge
            loadOrdersFromServer(occupiedRooms);
        };
        
        // Load orders from localStorage
        function loadOrdersFromLocal(occupiedRooms) {
            occupiedRooms.forEach(function(room) {
                var allItems = StorageService.get('saleorderitems') || [];
                var roomItems = allItems.filter(function(item) {
                    return item.saleOrderId === room.saleOrderId && !item.isTimeBased;
                });
                
                if (roomItems.length > 0) {
                    roomItems.forEach(function(item) {
                        $scope.orders.push({
                            id: item.id,
                            roomId: room.name,
                            roomType: room.type,
                            saleOrderId: room.saleOrderId,
                            productId: item.productId,
                            name: item.name,
                            quantity: item.quantity,
                            unit: item.uomId || 'phần',
                            price: item.unitPrice,
                            note: item.note || '',
                            status: item.status || 'pending',
                            orderedAt: new Date(item.createdAt || item.updatedAt),
                            orderedBy: 'Phục vụ',
                            urgent: false
                        });
                    });
                }
            });
            
            // Calculate wait times
            updateWaitTimes();
            
            console.log('📦 Loaded', $scope.orders.length, 'orders from localStorage');
        }
        
        // Load orders from server
        function loadOrdersFromServer(occupiedRooms) {
            if (occupiedRooms.length === 0) {
                console.log('ℹ️ No occupied rooms, skipping server load');
                return;
            }
            
            // Get all saleOrderIds from occupied rooms
            var saleOrderIds = occupiedRooms
                .map(function(room) { return room.saleOrderId; })
                .filter(function(id) { 
                    return id && !id.startsWith('temp-') && !id.startsWith('local-'); 
                });
            
            if (saleOrderIds.length === 0) {
                console.log('ℹ️ No server-based saleOrderIds, skipping server load');
                return;
            }
            
            console.log('🌐 Loading SaleOrderItems from server for', saleOrderIds.length, 'orders...');
            
            // Load all SaleOrderItems for these orders from server
            ApiService.getAll('saleorderitems', {
                where: { 
                    saleOrderId: { inq: saleOrderIds } 
                }
            }).then(function(serverItems) {
                if (serverItems && serverItems.length > 0) {
                    console.log('✅ Loaded', serverItems.length, 'SaleOrderItems from server');
                    
                    // Update localStorage with server data
                    var allLocalItems = StorageService.get('saleorderitems') || [];
                    
                    serverItems.forEach(function(serverItem) {
                        var serverId = serverItem.id || serverItem._id;
                        var localIndex = allLocalItems.findIndex(function(item) {
                            return item.id === serverId;
                        });
                        
                        if (localIndex >= 0) {
                            // Update existing
                            allLocalItems[localIndex] = serverItem;
                        } else {
                            // Add new
                            allLocalItems.push(serverItem);
                        }
                    });
                    
                    // Save to localStorage
                    StorageService.set('saleorderitems', allLocalItems);
                    console.log('💾 Updated localStorage with server SaleOrderItems');
                    
                    // Rebuild orders array with server data
                    $scope.orders = [];
                    occupiedRooms.forEach(function(room) {
                        var roomItems = allLocalItems.filter(function(item) {
                            return item.saleOrderId === room.saleOrderId && !item.isTimeBased;
                        });
                        
                        roomItems.forEach(function(item) {
                            $scope.orders.push({
                                id: item.id,
                                roomId: room.name,
                                roomType: room.type,
                                saleOrderId: room.saleOrderId,
                                productId: item.productId,
                                name: item.name,
                                quantity: item.quantity,
                                unit: item.uomId || 'phần',
                                price: item.unitPrice,
                                note: item.note || '',
                                status: item.status || 'pending',
                                orderedAt: new Date(item.createdAt || item.updatedAt),
                                orderedBy: 'Phục vụ',
                                urgent: false
                            });
                        });
                    });
                    
                    // Recalculate wait times
                    updateWaitTimes();
                    
                    console.log('🔄 Rebuilt orders with server data:', $scope.orders.length, 'total orders');
                    
                    // Trigger digest cycle to update UI
                    if (!$scope.$$phase) {
                        $scope.$apply();
                    }
                } else {
                    console.log('ℹ️ No server items returned, using local data only');
                }
            }).catch(function(error) {
                console.warn('⚠️ Failed to load from server, using local data only:', error);
            });
        }
        
        // Update wait times
        function updateWaitTimes() {
            var now = new Date();
            $scope.orders.forEach(function(order) {
                var diff = now - new Date(order.orderedAt);
                order.waitTime = Math.floor(diff / 60000); // minutes
                order.urgent = order.waitTime > 15; // Mark urgent if > 15 mins
            });
        }
        
        // Update periodically
        $interval(function() {
            $scope.rooms = RoomService.getRooms();
            updateWaitTimes();
        }, 30000); // Every 30 seconds
        
        // Load initial data
        $scope.loadAllOrders();
        
        // Listen for real-time updates
        $scope.$on('socket:update', function(event, data) {
            console.log('👨‍🍳 Kitchen received real-time update:', data);

            if (data.model === 'SaleOrder' && data.event === 'updated') {
                console.log('📋 SaleOrder updated:', data.id, data.changes);
                // Refresh rooms first, then load orders
                $scope.rooms = RoomService.getRooms();
                $timeout(function() {
                    $scope.loadAllOrders();
                }, 300);
            } else if (data.model === 'SaleOrderItem' && (data.event === 'created' || data.event === 'updated')) {
                console.log('📦 SaleOrderItem updated:', data.id, data.event);
                
                // Check if this is a time-based item - skip processing if it is
                var allItems = StorageService.get('saleorderitems') || [];
                var itemData = allItems.find(function(item) {
                    return item.id === data.id;
                });
                
                if (itemData && itemData.isTimeBased) {
                    console.log('⏰ Skipping time-based item update in kitchen:', data.id);
                    return;
                }
                
                // Refresh rooms first, then load orders with delay for server sync
                $scope.rooms = RoomService.getRooms();
                $timeout(function() {
                    $scope.loadAllOrders();
                }, 500);
            } else if (data.model === 'Room' && data.event === 'updated') {
                console.log('🏠 Room updated:', data.id, data.changes);
                
                // Update room in localStorage and memory
                var allRooms = StorageService.get('rooms') || [];
                var roomIndex = allRooms.findIndex(r => r.id === data.id);
                
                if (roomIndex >= 0) {
                    Object.keys(data.changes).forEach(function(key) {
                        if (data.changes[key] && typeof data.changes[key] === 'object' && data.changes[key].to !== undefined) {
                            allRooms[roomIndex][key] = data.changes[key].to;
                        }
                    });
                    StorageService.set('rooms', allRooms);
                    $scope.rooms = allRooms;
                } else {
                    $scope.rooms = RoomService.getRooms();
                }
                
                $scope.loadAllOrders();
            }
        });
        
        // Get filtered orders
        $scope.getFilteredOrders = function() {
            if ($scope.filter === 'all') {
                return $scope.orders;
            }
            return $scope.orders.filter(function(order) {
                return order.status === $scope.filter;
            });
        };
        
        // Update order status
        $scope.startPreparing = function(order) {
            order.status = 'preparing';
            order.updatedAt = new Date();
            
            ApiService.update('saleorderitems', order.id, {
                status: 'preparing',
                updatedAt: new Date().toISOString()
            }).then(function() {
                console.log('✅ Started preparing:', order.name);
                
                // Update in localStorage
                var allItems = StorageService.get('saleorderitems') || [];
                var itemIndex = allItems.findIndex(i => i.id === order.id);
                if (itemIndex >= 0) {
                    allItems[itemIndex].status = 'preparing';
                    allItems[itemIndex].updatedAt = new Date().toISOString();
                    StorageService.set('saleorderitems', allItems);
                }
            }).catch(function(error) {
                console.error('❌ Failed to update status:', error);
                alert('Lỗi cập nhật trạng thái!');
            });
        };
        
        $scope.markReady = function(order) {
            order.status = 'ready';
            order.updatedAt = new Date();
            
            ApiService.update('saleorderitems', order.id, {
                status: 'ready',
                updatedAt: new Date().toISOString()
            }).then(function() {
                console.log('✅ Marked ready:', order.name);
                
                // Update in localStorage
                var allItems = StorageService.get('saleorderitems') || [];
                var itemIndex = allItems.findIndex(i => i.id === order.id);
                if (itemIndex >= 0) {
                    allItems[itemIndex].status = 'ready';
                    allItems[itemIndex].updatedAt = new Date().toISOString();
                    StorageService.set('saleorderitems', allItems);
                }
            }).catch(function(error) {
                console.error('❌ Failed to update status:', error);
                alert('Lỗi cập nhật trạng thái!');
            });
        };
        
        $scope.markOutOfStock = function(order, item) {
            if (confirm('Báo hết món ' + item.name + '?')) {
                MenuService.setOutOfStock(item.productId);
                alert('Đã báo hết món ' + item.name + '. Món này sẽ bị ẩn khỏi menu.');
            }
        };
        
        // Get order card styling
        $scope.getOrderClass = function(order) {
            switch(order.status) {
                case 'pending': return 'bg-blue-50 border-blue-500';
                case 'preparing': return 'bg-yellow-50 border-yellow-500';
                case 'ready': return 'bg-green-50 border-green-500';
                default: return 'bg-white border-gray-300';
            }
        };
        
        $scope.getStatusBadgeClass = function(status) {
            switch(status) {
                case 'pending': return 'bg-blue-500';
                case 'preparing': return 'bg-yellow-500';
                case 'ready': return 'bg-green-500';
                default: return 'bg-gray-500';
            }
        };
        
        $scope.getStatusText = function(status) {
            switch(status) {
                case 'pending': return 'Chờ làm';
                case 'preparing': return 'Đang làm';
                case 'ready': return 'Đã xong';
                default: return status;
            }
        };
        
        $scope.logout = function() {
            if (confirm('Bạn có chắc muốn đăng xuất?')) {
                localStorage.removeItem('$LoopBack$accessTokenId');
                localStorage.removeItem('$LoopBack$user');
                localStorage.removeItem('userProfile');
                ApiService.clearCache();
                $location.path('/login');
            }
        };

        $scope.clearCache = function() {
            if (!confirm('Xóa cache JS/HTML và tải lại trang?')) return;
            // QUAN TRỌNG: window.location.reload(true) đã bị deprecated trên Chrome 90+, Firefox, Safari
            // và KHÔNG bypass được HTTP disk cache nữa. Phải dùng redirect với ?v=timestamp để
            // buộc browser request file mới (URL khác → không dùng cache cũ).
            var hardReload = function() {
                var base = window.location.origin + window.location.pathname;
                window.location.replace(base + '?v=' + Date.now());
            };
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                    return Promise.all(regs.map(function(r) { return r.unregister(); }));
                }).then(function() {
                    if ('caches' in window) {
                        return caches.keys().then(function(names) {
                            return Promise.all(names.map(function(n) { return caches.delete(n); }));
                        });
                    }
                }).then(hardReload).catch(hardReload);
            } else if ('caches' in window) {
                caches.keys().then(function(names) {
                    return Promise.all(names.map(function(n) { return caches.delete(n); }));
                }).then(hardReload).catch(hardReload);
            } else {
                hardReload();
            }
        };
    }
]);
