// Waiter/Staff Controller
angular.module('karaApp').controller('WaiterController', 
    ['$scope', '$interval', '$timeout', '$location', 'ApiService', 'RoomService', 'MenuService', 'OrderService', 'StaffService', 'SocketService', 'StorageService', 'SyncService', 'TimeBasedService', 'AttendanceService', 'StaffPanelService',
    function($scope, $interval, $timeout, $location, ApiService, RoomService, MenuService, OrderService, StaffService, SocketService, StorageService, SyncService, TimeBasedService, AttendanceService, StaffPanelService) {
        var currentUser = ApiService.getCurrentUser();
        if (!currentUser) {
            $location.path('/login');
            return;
        }

        // Timer for real-time time-based quantity updates
        var timeBasedUpdateTimer = null;

        function startTimeBasedTimer() {
            if (timeBasedUpdateTimer) { $interval.cancel(timeBasedUpdateTimer); }
            timeBasedUpdateTimer = $interval(function() {
                var hasTimeBased = $scope.cart && $scope.cart.some(function(i) { return i.isTimeBased; });
                if (hasTimeBased) { $scope.calculateTotal(); }
            }, 10000); // refresh every 10s
        }

        function stopTimeBasedTimer() {
            if (timeBasedUpdateTimer) {
                $interval.cancel(timeBasedUpdateTimer);
                timeBasedUpdateTimer = null;
            }
        }

        // --- Room status polling & foreground recovery ---
        var roomStatusPollTimer = null;

        function syncRoomStatusFromServer() {
            ApiService.getAll('Rooms', null, true).then(function(serverRooms) {
                if (!serverRooms || !serverRooms.length) return;
                var localRooms = StorageService.get('rooms') || [];
                var anyChanged = false;
                serverRooms.forEach(function(serverRoom) {
                    var idx = localRooms.findIndex(function(r) { return r.id === serverRoom.id; });
                    if (idx >= 0) {
                        if (localRooms[idx].status !== serverRoom.status) { anyChanged = true; }
                        Object.assign(localRooms[idx], serverRoom);
                    } else {
                        localRooms.push(serverRoom);
                        anyChanged = true;
                    }
                });
                StorageService.set('rooms', localRooms);
                if (anyChanged) {
                    $scope.rooms = localRooms;
                    // Keep selectedRoom in sync if its status changed
                    if ($scope.selectedRoom) {
                        var fresh = localRooms.find(function(r) { return r.id === $scope.selectedRoom.id; });
                        if (fresh) { Object.assign($scope.selectedRoom, fresh); }
                    }
                }
            }).catch(function() { /* silent – offline */ });
        }

        roomStatusPollTimer = $interval(syncRoomStatusFromServer, 30000);
        syncRoomStatusFromServer(); // also run immediately on init

        function onVisibilityChange() {
            if (!document.hidden) {
                console.log('👁️ Waiter tab visible – syncing room status');
                syncRoomStatusFromServer();
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange);

        $scope.$on('$destroy', function() {
            stopTimeBasedTimer();
            if (roomStatusPollTimer) { $interval.cancel(roomStatusPollTimer); }
            document.removeEventListener('visibilitychange', onVisibilityChange);
        });

        
        $scope.currentUser = currentUser;
        $scope.view = 'rooms'; // rooms, room-items, đơn
        $scope.rooms = RoomService.getRooms();
        $scope.categories = MenuService.getCategories();
        $scope.selectedRoom = null;
        $scope.cart = [];
        $scope.orderTotal = 0;
        $scope.cleaningRoom = null;
        $scope.checklist = null;
        $scope.cartAnimation = false; // For cart button animation
        $scope.roomAnimations = {}; // Track room status animations
        $scope.previousReadyCounts = {}; // Track previous ready counts for rooms
        $scope.orderLocked = false; // True khi bill đã được in → không cho chỉnh sửa

        function refreshOrderLock() {
            $scope.orderLocked = false;
            if (!$scope.selectedRoom || !$scope.selectedRoom.saleOrderId) return;
            var saleOrderId = $scope.selectedRoom.saleOrderId;

            function applyLock(so) {
                var frozen = $scope.selectedRoom.timeFrozen || (so && (so.timeFrozen || so.printedAt));
                if (frozen) {
                    $scope.orderLocked = true;
                    // Dừng timer — server đã lưu quantity đúng, không cần tính lại
                    stopTimeBasedTimer();
                }
            }

            // Lấy từ server để có trạng thái mới nhất
            ApiService.getById('saleorders', saleOrderId).then(function(so) {
                if (so) {
                    // Cập nhật lại localStorage cho saleorder
                    var saleOrders = StorageService.get('saleorders') || [];
                    var idx = saleOrders.findIndex(function(o) { return o.id === saleOrderId; });
                    if (idx >= 0) { Object.assign(saleOrders[idx], so); StorageService.set('saleorders', saleOrders); }

                    // Pull SaleOrderItems mới nhất từ server, xóa cache cũ trước khi lưu
                    ApiService.getAll('saleorderitems', { where: { saleOrderId: saleOrderId } }).then(function(serverItems) {
                        if (!serverItems) return;
                        var allLocalItems = StorageService.get('saleorderitems') || [];
                        var pendingLocalIds = allLocalItems
                            .filter(function(i) {
                                return i.saleOrderId === saleOrderId && i.id && String(i.id).startsWith('local-');
                            })
                            .map(function(i) { return i.id; });
                        pendingLocalIds.forEach(function(localId) {
                            SyncService.cancelPendingCreate('saleorderitems', localId);
                        });
                        // Xóa tất cả items của saleOrder này (kể cả local-)
                        allLocalItems = allLocalItems.filter(function(i) { return i.saleOrderId !== saleOrderId; });
                        // Lưu lại items mới nhất từ server
                        serverItems.forEach(function(si) { allLocalItems.push(si); });
                        StorageService.set('saleorderitems', allLocalItems);
                        // Reload cart với data mới
                        $scope.cart = [];
                        serverItems.forEach(function(item) {
                            $scope.cart.push({
                                id: item.id,
                                _saleOrderItemId: item.id,
                                itemId: item.productId,
                                name: item.name || 'Unknown Item',
                                price: item.unitPrice,
                                quantity: item.quantity,
                                unit: item.unitOfMeasure || item.unit || 'phần',
                                note: item.note || '',
                                createdAt: item.createdAt,
                                fromServer: true,
                                isTimeBased: item.isTimeBased || false,
                                startTime: item.isTimeBased ? (item.startTime || item.createdAt) : undefined,
                                _manualEndTime: item.isTimeBased ? (item._manualEndTime || item.manualEndTime || (item.endTime ? new Date(item.endTime) : null)) : undefined,
                                timeBasedConfig: item.isTimeBased ? (item.timeBasedConfig || null) : undefined,
                                status: item.status || 'pending'
                            });
                        });
                        $scope.calculateTotal();
                    }).catch(function() { /* silent – offline */ });
                }
                applyLock(so);
            }).catch(function() {
                // Offline fallback: dùng localStorage
                var saleOrders = StorageService.get('saleorders') || [];
                var so = saleOrders.find(function(o) { return o.id === saleOrderId; });
                applyLock(so);
            });
        }
        
        // Search functionality
        $scope.searchText = '';
        $scope.allMenuItems = []; // Store all items for search
        
        // Room status is updated via WebSocket events + 30s poll + visibilitychange (see above)
        
        // Listen for real-time updates
        $scope.$on('socket:update', function(event, data) {
            console.log('🍽️ Waiter received real-time update:', data);

            if (data.model === 'SaleOrder' && data.event === 'updated') {
                // Handle SaleOrder updates
                console.log('📋 SaleOrder updated:', data.id, data.changes);

                // Update room status based on changes
                if (data.changes.paidAmount || data.changes.total) {
                    // Payment related changes - might indicate room status change
                    $scope.rooms = RoomService.getRooms(); // Refresh rooms
                }

                // Nếu saleorder đang mở vừa có printedAt → khoá đơn
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId === data.id) {
                    if (data.changes.printedAt || data.changes.timeFrozen) {
                        refreshOrderLock();
                    }
                }

                // If viewing the room that was updated, refresh items
                if ($scope.selectedRoom) {
                    // Check if this update affects the current room
                    var roomOrder = StorageService.get('room_' + $scope.selectedRoom.id);
                    if (roomOrder && roomOrder.id === data.id) {
                        // Room order updated - could refresh cart if needed
                    }
                }
            } else if (data.model === 'SaleOrderItem' && (data.event === 'created' || data.event === 'updated')) {
                // Handle SaleOrderItem updates - reload room items if viewing the affected room
                console.log('📦 SaleOrderItem updated:', data.id, data.event);

                // Check if this is a time-based item - skip processing if it is
                var allItems = StorageService.get('saleorderitems') || [];
                var itemData = allItems.find(function(item) {
                    return item.id === data.id;
                });
                
                if (itemData && itemData.isTimeBased) {
                    console.log('⏰ Skipping time-based item update:', data.id);
                    return;
                }

                // If currently viewing a room with an active order, update cart
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    // Fetch fresh item from server
                    ApiService.getById('saleorderitems', data.id).then(function(serverItem) {
                        if (!serverItem || serverItem.isTimeBased) return;
                        if (serverItem.saleOrderId !== $scope.selectedRoom.saleOrderId) return;

                        var cartItem = $scope.cart.find(function(c) {
                            return c.id === data.id || c._saleOrderItemId === data.id;
                        });

                        if (data.event === 'created' && !cartItem) {
                            // Check if this machine just added this item — it will have a local- placeholder
                            var newServerId = serverItem.id || serverItem._id;
                            var localPlaceholder = $scope.cart.find(function(c) {
                                return c._saleOrderItemId && String(c._saleOrderItemId).startsWith('local-') &&
                                       c.itemId === serverItem.productId &&
                                       (c.note || '') === (serverItem.note || '');
                            });
                            if (!localPlaceholder) {
                                // Fallback: match by c.id with local- prefix
                                localPlaceholder = $scope.cart.find(function(c) {
                                    return c.id && String(c.id).startsWith('local-') &&
                                           c.itemId === serverItem.productId &&
                                           (c.note || '') === (serverItem.note || '');
                                });
                            }
                            if (localPlaceholder) {
                                // Promote local placeholder to real server ID — no duplicate
                                var oldLocalId = localPlaceholder._saleOrderItemId || localPlaceholder.id;
                                localPlaceholder.id = newServerId;
                                localPlaceholder._saleOrderItemId = newServerId;
                                // Update localStorage too
                                var allStorageItems = StorageService.get('saleorderitems') || [];
                                var storageIdx = allStorageItems.findIndex(function(i) { return i.id === oldLocalId; });
                                if (storageIdx >= 0) {
                                    allStorageItems[storageIdx].id = newServerId;
                                    allStorageItems[storageIdx]._localOnly = false;
                                    StorageService.set('saleorderitems', allStorageItems);
                                }
                                console.log('🔁 [waiter] Promoted local- placeholder to server ID:', newServerId);
                                $scope.calculateTotal();
                                return;
                            }
                            // Truly new item from another machine (cashier) — add to cart
                            var newItem = {
                                id: newServerId,
                                itemId: serverItem.productId,
                                name: serverItem.name || 'Unknown Item',
                                price: serverItem.unitPrice,
                                quantity: serverItem.quantity,
                                unit: serverItem.unitOfMeasure || serverItem.unit || 'phần',
                                note: serverItem.note || '',
                                status: serverItem.status || 'pending',
                                isNew: true
                            };
                            $scope.cart.push(newItem);
                            $scope.calculateTotal();
                            console.log('➕ New item added to waiter cart (from cashier):', newItem.name);
                            setTimeout(function() { newItem.isNew = false; $scope.$applyAsync(); }, 1500);
                        } else if (cartItem) {
                            // Update existing cart item
                            if (data.changes) {
                                if (data.changes.quantity) cartItem.quantity = data.changes.quantity.to;
                                if (data.changes.unitPrice) cartItem.price = data.changes.unitPrice.to;
                                if (data.changes.status) {
                                    var oldStatus = cartItem.status;
                                    cartItem.status = data.changes.status.to;
                                    console.log('🔄 Updated cart item status:', cartItem.name, oldStatus, '→', cartItem.status);
                                    $scope.triggerStatusAnimation(cartItem.id);
                                    if (cartItem.status === 'ready') $scope.playNotificationSound('ready');
                                    var currentReadyCount = $scope.getReadyItemsCount($scope.selectedRoom);
                                    var previousReadyCount = $scope.previousReadyCounts[$scope.selectedRoom.id] || 0;
                                    if (currentReadyCount !== previousReadyCount && currentReadyCount > 0) {
                                        $scope.triggerRoomAnimation($scope.selectedRoom.id);
                                    }
                                    $scope.previousReadyCounts[$scope.selectedRoom.id] = currentReadyCount;
                                }
                            }
                            $scope.calculateTotal();
                        }
                    }).catch(function() {
                        // fallback: just recalculate
                        $scope.calculateTotal();
                    });
                }
            } else if (data.model === 'SaleOrderItem' && data.event === 'deleted') {
                // Item deleted on server (by cashier or another device) — remove from cart
                console.log('🗑️ [waiter] SaleOrderItem deleted:', data.id);
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    var delIdx = $scope.cart.findIndex(function(c) {
                        return c.id === data.id || c._saleOrderItemId === data.id;
                    });
                    if (delIdx >= 0) {
                        $scope.cart.splice(delIdx, 1);
                        $scope.calculateTotal();
                        console.log('🗑️ [waiter] Removed deleted item from cart:', data.id);
                    }
                    // Also purge from localStorage
                    var delStorage = StorageService.get('saleorderitems') || [];
                    var delStorageIdx = delStorage.findIndex(function(i) { return i.id === data.id; });
                    if (delStorageIdx >= 0) {
                        delStorage.splice(delStorageIdx, 1);
                        StorageService.set('saleorderitems', delStorage);
                    }
                }
            } else if (data.model === 'Room' && data.event === 'updated') {
                // Handle Room status updates (e.g., cleaning completed, status changes)
                console.log('🏠 Room updated:', data.id, data.changes);

                // Update room in localStorage and memory
                var allRooms = StorageService.get('rooms') || [];
                var roomIndex = allRooms.findIndex(r => r.id === data.id);
                
                if (roomIndex >= 0) {
                    // Apply changes to the room
                    Object.keys(data.changes).forEach(function(key) {
                        if (data.changes[key] && typeof data.changes[key] === 'object' && data.changes[key].to !== undefined) {
                            allRooms[roomIndex][key] = data.changes[key].to;
                        }
                    });
                    
                    // Save updated rooms to localStorage
                    StorageService.set('rooms', allRooms);
                    
                    // Update in current scope
                    $scope.rooms = allRooms;
                    
                    console.log('🔄 Room updated in localStorage:', data.id, data.changes);
                } else {
                    // Room not found, refresh from server
                    console.log('⚠️ Room not found locally, refreshing rooms list');
                    $scope.rooms = RoomService.getRooms();
                }

                // If currently viewing this room, update its status
                if ($scope.selectedRoom && $scope.selectedRoom.id === data.id) {
                    var updatedRoom = $scope.rooms.find(r => r.id === data.id);
                    if (updatedRoom) {
                        $scope.selectedRoom.status = updatedRoom.status;
                        console.log('🔄 Selected room status updated:', $scope.selectedRoom.name, $scope.selectedRoom.status);
                    }
                }
            }
        });
        
        // Watch for search text changes
        $scope.$watch('searchText', function(newValue, oldValue) {
            if (newValue !== oldValue) {
                $scope.updateFilteredMenuItems();
            }
        });
        
        // Status helper functions for display
        $scope.getItemStatusClass = function(item) {
            switch(item.status) {
                case 'pending': return 'bg-blue-100 text-blue-800';
                case 'preparing': return 'bg-yellow-100 text-yellow-800';
                case 'ready': return 'bg-green-100 text-green-800';
                case 'served': return 'bg-purple-100 text-purple-800';
                default: return 'bg-gray-100 text-gray-800';
            }
        };
        
        $scope.getItemStatusIcon = function(item) {
            switch(item.status) {
                case 'pending': return 'fa-clock';
                case 'preparing': return 'fa-fire';
                case 'ready': return 'fa-check-circle';
                case 'served': return 'fa-utensils';
                default: return 'fa-question';
            }
        };
        
        $scope.getItemStatusText = function(item) {
            switch(item.status) {
                case 'pending': return 'Chờ làm';
                case 'preparing': return 'Đang làm';
                case 'ready': return 'Đã xong';
                case 'served': return 'Đã phục vụ';
                default: return 'Chưa xác định';
            }
        };
        
        // Get ready items count for a room
        $scope.getReadyItemsCount = function(room) {
            if (!room.saleOrderId) return 0;
            
            var allItems = StorageService.get('saleorderitems') || [];
            var roomItems = allItems.filter(function(item) {
                return item.saleOrderId === room.saleOrderId && item.status === 'ready' && !item.isTimeBased;
            });
            
            return roomItems.length;
        };
        
        // Play notification sound
        $scope.playNotificationSound = function(type) {
            try {
                var audio = new Audio();
                if (type === 'ready') {
                    // Create a simple beep sound for ready items
                    var context = new (window.AudioContext || window.webkitAudioContext)();
                    var oscillator = context.createOscillator();
                    var gainNode = context.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(context.destination);
                    
                    oscillator.frequency.setValueAtTime(800, context.currentTime);
                    oscillator.frequency.setValueAtTime(600, context.currentTime + 0.1);
                    
                    gainNode.gain.setValueAtTime(0.3, context.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
                    
                    oscillator.start(context.currentTime);
                    oscillator.stop(context.currentTime + 0.3);
                }
            } catch (e) {
                console.log('Audio not supported');
            }
        };
        
        // Trigger status change animation
        $scope.triggerStatusAnimation = function(itemId) {
            $scope.statusAnimations[itemId] = true;
            setTimeout(function() {
                $scope.statusAnimations[itemId] = false;
                $scope.$apply();
            }, 800);
        };
        
        // Trigger room status animation
        $scope.triggerRoomAnimation = function(roomId) {
            if (!$scope.roomAnimations) $scope.roomAnimations = {};
            $scope.roomAnimations[roomId] = true;
            setTimeout(function() {
                $scope.roomAnimations[roomId] = false;
                $scope.$apply();
            }, 1000);
        };
        
        $scope.switchView = function(view) {
            $scope.view = view;
            if (view === 'rooms') {
                $scope.selectedRoom = null;
                $scope.cart = [];
            } else if (view === 'room-items' && $scope.selectedRoom) {
                // Load menu for adding items
                if ($scope.categories.length > 0) {
                    $scope.selectCategory($scope.categories[0]);
                }
            }
        };
        
        // Room selection for check-in (open empty room for customer)
        $scope.waiterCheckInModal = { show: false, room: {}, customerName: '', customerPhone: '', guests: 1 };

        $scope.selectRoomForCheckIn = function(room) {
            function proceed() {
                if (room.status !== 'available') {
                    alert('Phòng này không ở trạng thái trống!');
                    return;
                }
                $scope.waiterCheckInModal = {
                    show: true,
                    room: room,
                    customerName: '',
                    customerPhone: '',
                    guests: 1
                };
            }
            // Fetch latest room status from server before proceeding
            ApiService.getById('Rooms', room.id).then(function(serverRoom) {
                if (serverRoom) {
                    var localRooms = StorageService.get('rooms') || [];
                    var idx = localRooms.findIndex(function(r) { return r.id === serverRoom.id; });
                    if (idx >= 0) { Object.assign(localRooms[idx], serverRoom); }
                    StorageService.set('rooms', localRooms);
                    $scope.rooms = localRooms;
                    Object.assign(room, serverRoom);
                }
                proceed();
            }).catch(function() { proceed(); });
        };

        $scope.confirmWaiterCheckIn = function() {
            var modal = $scope.waiterCheckInModal;
            var checkedInRoom = RoomService.checkIn(
                modal.room.id,
                new Date(),
                {
                    name: modal.customerName || 'Khách lẻ',
                    phone: modal.customerPhone || '',
                    guests: modal.guests || 1
                }
            );
            if (checkedInRoom) {
                $scope.rooms = RoomService.getRooms();
                modal.show = false;
                $scope.selectedRoom = checkedInRoom;
                $scope.cart = [];
                $scope.view = 'cart';
                if (checkedInRoom.saleOrderId) {
                    loadRoomCart(checkedInRoom.saleOrderId);
                }
                if ($scope.categories.length > 0) {
                    $scope.selectCategory($scope.categories[0]);
                }
            } else {
                alert('Không thể mở phòng, vui lòng thử lại!');
            }
        };

        // Room selection for ordering
        $scope.selectRoomForOrder = function(room) {
            function proceed() {
                if (room.status !== 'occupied') {
                    alert('Phòng này chưa mở hoặc không khả dụng!');
                    return;
                }
                stopTimeBasedTimer();
                $scope.selectedRoom = room;
                $scope.view = 'cart'; // Go directly to cart view to show current order
                $scope.cart = []; // Reset cart before loading

                console.log('🏨 Selected room for ORDER:', room.name, '- Loading current order');

                // Load existing order items for this room (all non-time-based items)
                if (room.saleOrderId) {
                    loadRoomCart(room.saleOrderId);
                } else {
                    console.log('⚠️ Room has no saleOrderId yet');
                }

                // Load menu for adding items (in case user wants to add more)
                if ($scope.categories.length > 0) {
                    $scope.selectCategory($scope.categories[0]);
                }

                // Start real-time timer for time-based quantities
                startTimeBasedTimer();
                refreshOrderLock();
            }
            // Fetch latest room status from server before proceeding
            ApiService.getById('Rooms', room.id).then(function(serverRoom) {
                if (serverRoom) {
                    var localRooms = StorageService.get('rooms') || [];
                    var idx = localRooms.findIndex(function(r) { return r.id === serverRoom.id; });
                    if (idx >= 0) { Object.assign(localRooms[idx], serverRoom); }
                    StorageService.set('rooms', localRooms);
                    $scope.rooms = localRooms;
                    Object.assign(room, serverRoom);
                }
                proceed();
            }).catch(function() { proceed(); });
        };
        

        
        // Menu ordering
        $scope.selectCategory = function(category) {
            $scope.selectedCategory = category;
            // Load menu items for waiter (including time-based products)
            var allItems = MenuService.getMenuItems(category.id);
            $scope.allMenuItems = allItems;
            $scope.updateFilteredMenuItems();
        };
        
        // Search functionality
        $scope.updateFilteredMenuItems = function() {
            if (!$scope.searchText || $scope.searchText.trim() === '') {
                $scope.menuItems = $scope.allMenuItems;
            } else {
                var searchTerm = $scope.searchText.toLowerCase().trim();
                $scope.menuItems = $scope.allMenuItems.filter(function(item) {
                    return item.name.toLowerCase().includes(searchTerm);
                });
            }
        };
        
        $scope.clearSearch = function() {
            $scope.searchText = '';
            $scope.updateFilteredMenuItems();
        };
        
        $scope.addToCart = function(item) {
            if ($scope.orderLocked) { alert('Đơn hàng đang được tính tiền, không thể thêm món!'); return; }
            // Trigger button animation
            item.animating = true;
            setTimeout(function() {
                item.animating = false;
                $scope.$apply();
            }, 600);
            
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng đang sử dụng!');
                return;
            }
            
            // Handle time-based products (same as cashier)
            if (item.isTimeBased) {
                TimeBasedService.addOrUpdateTimeBasedItem($scope.cart, item, new Date());
                $scope.calculateTotal();
                autoSaveOrder();
                return;
            }
            
            // Check if item exists with or without note
            var existingWithoutNote = $scope.cart.find(function(i) {
                return i.itemId === item.id && !i.note;
            });
            
            var existingWithNote = $scope.cart.filter(function(i) {
                return i.itemId === item.id && i.note;
            });
            
            // Case 1: Has item without note -> just increase quantity
            if (existingWithoutNote) {
                existingWithoutNote.quantity++;
                existingWithoutNote.isNew = true; // Trigger animation
                setTimeout(function() {
                    existingWithoutNote.isNew = false;
                    $scope.$apply();
                }, 1000);
                $scope.calculateTotal();
                
                // Trigger cart animation
                $scope.cartAnimation = true;
                setTimeout(function() {
                    $scope.$apply(function() {
                        $scope.cartAnimation = false;
                    });
                }, 600);
                
                autoSaveOrder();
                return;
            }
            
            // Case 2: Has item(s) with note -> ask user
            if (existingWithNote.length > 0) {
                var noteItem = existingWithNote[0];
                var message = 'Món "' + item.name + '" đã có trong giỏ với ghi chú: "' + noteItem.note + '"\n\nThêm vào món có ghi chú này?\n\n- OK: Tăng số lượng món có ghi chú\n- Cancel: Thêm món mới không có ghi chú';
                
                if (confirm(message)) {
                    // User chose to add to existing item with note
                    noteItem.quantity++;
                    noteItem.isNew = true; // Trigger animation
                    setTimeout(function() {
                        noteItem.isNew = false;
                        $scope.$apply();
                    }, 1000);
                } else {
                    // User chose to add new item without note
                    var newCartItem = {
                        itemId: item.id,
                        name: item.name,
                        price: item.price,
                        quantity: 1,
                        unit: item.unit,
                        note: '',
                        createdAt: new Date(),
                        status: 'pending',
                        isNew: true // Mark as new for animation
                    };
                    
                    // Handle combo BOM
                    if (item.items && item.items.length > 0) {
                        newCartItem.isCombo = true;
                        newCartItem.bomItems = item.items;
                    }
                    
                    $scope.cart.push(newCartItem);
                    
                    // Trigger animation for new item
                    setTimeout(function() {
                        newCartItem.isNew = false;
                        $scope.$apply();
                    }, 1000);
                }
                
                $scope.calculateTotal();
                
                // Trigger cart animation
                $scope.cartAnimation = true;
                setTimeout(function() {
                    $scope.$apply(function() {
                        $scope.cartAnimation = false;
                    });
                }, 600);
                
                autoSaveOrder();
                return;
            }
            
            // Case 3: No existing item -> add new without note
            var cartItem = {
                itemId: item.id,
                name: item.name,
                price: item.price,
                quantity: 1,
                unit: item.unit,
                note: '',
                createdAt: new Date(),
                status: 'pending',
                isNew: true // Mark as new for animation
            };
            
            // Handle combo BOM
            if (item.items && item.items.length > 0) {
                cartItem.isCombo = true;
                cartItem.bomItems = item.items;
            }
            
            $scope.cart.push(cartItem);
            
            // Trigger animation for new item
            setTimeout(function() {
                cartItem.isNew = false;
                $scope.$apply();
            }, 1000);
            
            $scope.calculateTotal();
            
            // Trigger cart animation
            $scope.cartAnimation = true;
            setTimeout(function() {
                $scope.$apply(function() {
                    $scope.cartAnimation = false;
                });
            }, 600);
            
            // Auto-send to kitchen immediately when item is added
            autoSaveOrder();
        };
        
        $scope.markAsServed = function(item) {
            if (item.status !== 'ready') return;
            
            item.status = 'served';
            
            // Trigger animation for status change
            $scope.triggerStatusAnimation(item.id);
            
            // Update in localStorage
            var allItems = StorageService.get('saleorderitems') || [];
            var itemIndex = allItems.findIndex(function(i) {
                return i.id === item.id;
            });
            
            if (itemIndex >= 0) {
                allItems[itemIndex].status = 'served';
                allItems[itemIndex].updatedAt = new Date().toISOString();
                StorageService.set('saleorderitems', allItems);
                
                // Add to sync queue
                SyncService.addToQueue('update', 'saleorderitems', allItems[itemIndex]);
                
                console.log('✅ Marked item as served:', item.name);
                
                // Trigger room animation if this affects room status
                if ($scope.selectedRoom) {
                    var currentReadyCount = $scope.getReadyItemsCount($scope.selectedRoom);
                    $scope.previousReadyCounts[$scope.selectedRoom.id] = currentReadyCount;
                    $scope.triggerRoomAnimation($scope.selectedRoom.id);
                }
            }
        };
        
        var _updateQtyTimer = null;
        $scope.updateQuantity = function(item, delta) {
            if ($scope.orderLocked) return;
            // Time-based items: quantity is auto-calculated, cannot be manually adjusted
            if (item.isTimeBased) return;

            // When decrementing from quantity 1, confirm deletion first
            if (delta < 0 && item.quantity <= 1) {
                if (!confirm('Xóa món ' + item.name + ' khỏi đơn?')) return;
                item.quantity = 0;
            } else {
                item.quantity += delta;
            }

            if (item.quantity <= 0) {
                // Remove from cart — immediate, no debounce needed for deletes
                var idx = $scope.cart.indexOf(item);
                if (idx >= 0) $scope.cart.splice(idx, 1);

                // Remove from localStorage + queue delete/cancel create
                var allItems = StorageService.get('saleorderitems') || [];
                var localIdx = allItems.findIndex(function(i) { return i.id === item.id; });
                if (localIdx >= 0) {
                    var stored = allItems[localIdx];
                    if (stored.id && !String(stored.id).startsWith('local-')) {
                        SyncService.addToQueue('delete', 'saleorderitems', { id: stored.id });
                    } else if (stored.id) {
                        SyncService.cancelPendingCreate('saleorderitems', stored.id);
                    }
                    allItems.splice(localIdx, 1);
                    StorageService.set('saleorderitems', allItems);
                }
            } else {
                if (_updateQtyTimer) $timeout.cancel(_updateQtyTimer);
                _updateQtyTimer = $timeout(function() {
                    var itemId = item._saleOrderItemId || item.id;
                    if (itemId && !String(itemId).startsWith('local-')) {
                        // Item already on server — call API directly (same as setQuantity)
                        ApiService.update('saleorderitems', itemId, {
                            id: itemId,
                            quantity: item.quantity,
                            subtotal: item.quantity * item.price,
                            updatedAt: new Date().toISOString()
                        }).then(function() {
                            // Keep localStorage in sync
                            var allItems = StorageService.get('saleorderitems') || [];
                            var idx = allItems.findIndex(function(i) { return i.id === itemId; });
                            if (idx >= 0) {
                                allItems[idx].quantity = item.quantity;
                                allItems[idx].subtotal = item.quantity * item.price;
                                allItems[idx].updatedAt = new Date().toISOString();
                                StorageService.set('saleorderitems', allItems);
                            }
                            // Update SaleOrder total
                            if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                                var total = $scope.cart.reduce(function(s, i) { return s + (i.quantity * i.price); }, 0);
                                var saleOrders = StorageService.get('saleorders') || [];
                                var oi = saleOrders.findIndex(function(o) { return o.id === $scope.selectedRoom.saleOrderId; });
                                if (oi >= 0) {
                                    saleOrders[oi].total = total;
                                    saleOrders[oi].updatedAt = new Date().toISOString();
                                    StorageService.set('saleorders', saleOrders);
                                    SyncService.addToQueue('update', 'saleorders', saleOrders[oi]);
                                }
                            }
                        }).catch(function(err) {
                            console.error('❌ updateQuantity API failed:', err);
                            // Fallback to queue-based save
                            autoSaveOrder();
                        });
                    } else {
                        // Item not yet on server — use queue-based save
                        autoSaveOrder();
                    }
                    _updateQtyTimer = null;
                }, 1000);
            }
            $scope.calculateTotal();
        };

        var _setQtyTimer = null;
        $scope.setQuantity = function(item, newQty) {
            if ($scope.orderLocked || item.isTimeBased) return;
            newQty = parseInt(newQty, 10);
            if (isNaN(newQty) || newQty < 1) {
                item.quantity = 1;
                newQty = 1;
            }
            item.quantity = newQty;
            $scope.calculateTotal();

            // Debounce: chờ 600ms sau lần gõ cuối mới update server
            if (_setQtyTimer) clearTimeout(_setQtyTimer);
            _setQtyTimer = setTimeout(function() {
                var itemId = item._saleOrderItemId || item.id;
                if (itemId && !String(itemId).startsWith('local-')) {
                    // Gọi API trực tiếp
                    ApiService.update('saleorderitems', itemId, {
                        id: itemId,
                        quantity: item.quantity,
                        subtotal: item.quantity * item.price,
                        updatedAt: new Date().toISOString()
                    }).then(function() {
                        // Cập nhật localStorage
                        var allItems = StorageService.get('saleorderitems') || [];
                        var idx = allItems.findIndex(function(i) { return i.id === itemId; });
                        if (idx >= 0) {
                            allItems[idx].quantity = item.quantity;
                            allItems[idx].subtotal = item.quantity * item.price;
                            allItems[idx].updatedAt = new Date().toISOString();
                            StorageService.set('saleorderitems', allItems);
                        }
                        // Cập nhật total trên SaleOrder
                        if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                            var total = $scope.cart.reduce(function(sum, i) { return sum + (i.quantity * i.price); }, 0);
                            var saleOrders = StorageService.get('saleorders') || [];
                            var oi = saleOrders.findIndex(function(o) { return o.id === $scope.selectedRoom.saleOrderId; });
                            if (oi >= 0) {
                                saleOrders[oi].total = total;
                                saleOrders[oi].updatedAt = new Date().toISOString();
                                StorageService.set('saleorders', saleOrders);
                                SyncService.addToQueue('update', 'saleorders', saleOrders[oi]);
                            }
                        }
                    }).catch(function(err) {
                        console.error('❌ setQuantity update failed:', err);
                    });
                } else {
                    // Item chưa có server ID → dùng autoSaveOrder như bình thường
                    autoSaveOrder();
                }
            }, 600);
        };

        $scope.removeItem = function(item) {
            if ($scope.orderLocked) { alert('Đơn hàng đang được tính tiền, không thể xóa món!'); return; }
            if (!confirm('Xóa món ' + item.name + ' khỏi đơn?')) return;
            var idx = $scope.cart.indexOf(item);
            if (idx >= 0) $scope.cart.splice(idx, 1);
            var allItems = StorageService.get('saleorderitems') || [];
            var localIdx = allItems.findIndex(function(i) { return i.id === item.id; });
            if (localIdx >= 0) {
                var stored = allItems[localIdx];
                if (stored.id && !String(stored.id).startsWith('local-')) {
                    if (SyncService.isOnline()) {
                        ApiService.hardDelete('SaleOrderItem', null, { id: stored.id }).catch(function(err) {
                            console.warn('❌ removeItem delete failed, queuing for retry:', err);
                            SyncService.addToQueue('delete', 'saleorderitems', { id: stored.id });
                        });
                    } else {
                        SyncService.addToQueue('delete', 'saleorderitems', { id: stored.id });
                    }
                } else if (stored.id) {
                    SyncService.cancelPendingCreate('saleorderitems', stored.id);
                }
                allItems.splice(localIdx, 1);
                StorageService.set('saleorderitems', allItems);
            }
            $scope.calculateTotal();
        };

        $scope.editItemNote = function(item) {
            if ($scope.orderLocked) return;
            $scope.editingItem = item;
            $scope.editingItemOldNote = item.note || '';
            item._prevNote = item.note || '';  // used by autoSaveOrder to find correct record
            $scope.showEditNoteModal = true;
        };

        $scope.saveItemNote = function() {
            if ($scope.editingItem) {
                autoSaveOrder();
                delete $scope.editingItem._prevNote;
            }
            $scope.showEditNoteModal = false;
            $scope.editingItem = null;
        };

        $scope.cancelEditNote = function() {
            if ($scope.editingItem) {
                $scope.editingItem.note = $scope.editingItemOldNote;
                delete $scope.editingItem._prevNote;
            }
            $scope.showEditNoteModal = false;
            $scope.editingItem = null;
        };

        $scope.sendOrder = function() {
            if ($scope.cart.length === 0) {
                alert('Chưa có món nào để hoàn tất!');
                return;
            }
            
            if (!$scope.selectedRoom.saleOrderId) {
                alert('Phòng chưa có đơn hàng!');
                return;
            }
            
            console.log('✅ Completing order - clearing cart');
            
            // Clear cart after completing
            $scope.cart = [];
            $scope.calculateTotal();
        };
        
        // Cleaning management
        $scope.selectRoomForCleaning = function(room) {
            if (room.status !== 'cleaning') {
                alert('Phòng này không ở trạng thái "Đang dọn"!');
                return;
            }
            
            $scope.cleaningRoom = room;
            
            // Check if there's an active checklist
            var activeChecklist = StaffService.getActiveChecklist(room.id);
            if (activeChecklist) {
                $scope.checklist = activeChecklist;
            } else {
                $scope.checklist = StaffService.startCleaning(room.id, currentUser.username);
            }
            
            $scope.view = 'cleaning';
        };
        
        $scope.toggleChecklistItem = function(item) {
            item.checked = !item.checked;
            StaffService.updateChecklist($scope.cleaningRoom.id, item.id, item.checked);
        };
        
        // Load cart items for a room
        function loadRoomCart(saleOrderId) {
            if (!saleOrderId) return;
            
            console.log('📦 Loading all order items for room:', saleOrderId);
            
            // Load ALL SaleOrderItems for this room from localStorage first
            var allItems = StorageService.get('saleorderitems') || [];
            var orderItems = allItems.filter(function(item) {
                return item.saleOrderId === saleOrderId;
            });
            
            console.log('🔍 Found', orderItems.length, 'total SaleOrderItems in localStorage for this room');
            
            console.log('✅ Found', orderItems.length, 'items (including time-based)');

            if (orderItems.length > 0) {
                orderItems.forEach(function(item) {
                    var cartItem = {
                        id: item.id,
                        _saleOrderItemId: item.id,
                        itemId: item.productId,
                        name: item.name || 'Unknown Item',
                        price: item.unitPrice,
                        quantity: item.quantity,
                        unit: item.unitOfMeasure || item.unit || 'phần',
                        note: item.note || '',
                        createdAt: item.createdAt,
                        fromLocal: true,
                        isTimeBased: item.isTimeBased || false,
                        startTime: item.isTimeBased ? (item.startTime || item.createdAt) : undefined,
                        _manualEndTime: item.isTimeBased ? (item._manualEndTime || item.manualEndTime || (item.endTime ? new Date(item.endTime) : null)) : undefined,
                        timeBasedConfig: item.isTimeBased ? (item.timeBasedConfig || null) : undefined,
                        status: item.status || 'pending'
                    };
                    $scope.cart.push(cartItem);
                });
                $scope.calculateTotal();
            }
            var nonTimeBasedItems = orderItems.filter(function(i) { return !i.isTimeBased; });
            
            // Also try to load from server to sync data
            if (saleOrderId && !saleOrderId.startsWith('temp-') && !saleOrderId.startsWith('local-')) {
                console.log('🌐 Loading SaleOrderItems from server for:', saleOrderId);
                ApiService.getAll('saleorderitems', {
                    where: { saleOrderId: saleOrderId }
                }).then(function(serverItems) {
                    console.log('✅ Loaded', serverItems ? serverItems.length : 0, 'SaleOrderItems from server');
                    
                    if (serverItems) {
                        // Update localStorage with server data
                        var allLocalItems = StorageService.get('saleorderitems') || [];
                        var serverIdSet = {};

                        (serverItems || []).forEach(function(serverItem) {
                            var serverId = serverItem.id || serverItem._id;
                            serverIdSet[serverId] = true;
                            var localIndex = allLocalItems.findIndex(function(item) {
                                return item.id === serverId;
                            });
                            if (localIndex >= 0) {
                                allLocalItems[localIndex] = serverItem;
                            } else {
                                allLocalItems.push(serverItem);
                            }
                        });

                        // Prune stale items: remove local entries for this saleOrder
                        // that have a real server ID but were not returned by the server (deleted elsewhere)
                        allLocalItems = allLocalItems.filter(function(item) {
                            if (item.saleOrderId !== saleOrderId) return true;
                            if (item.id && String(item.id).startsWith('local-')) return true;
                            return !!serverIdSet[item.id];
                        });

                        // Save to localStorage
                        StorageService.set('saleorderitems', allLocalItems);
                        console.log('💾 Updated localStorage with server SaleOrderItems');
                        
                        // Always reload cart with authoritative server data
                        var updatedOrderItems = allLocalItems.filter(function(item) {
                            return item.saleOrderId === saleOrderId;
                        });

                        console.log('🔄 Reloading cart with server data:', updatedOrderItems.length, 'items');
                        $scope.cart = [];
                        updatedOrderItems.forEach(function(item) {
                            var cartItem = {
                                id: item.id,
                                _saleOrderItemId: item.id,
                                itemId: item.productId,
                                name: item.name || 'Unknown Item',
                                price: item.unitPrice,
                                quantity: item.quantity,
                                unit: item.unitOfMeasure || item.unit || 'phần',
                                note: item.note || '',
                                createdAt: item.createdAt,
                                fromServer: true,
                                isTimeBased: item.isTimeBased || false,
                                startTime: item.isTimeBased ? (item.startTime || item.createdAt) : undefined,
                                _manualEndTime: item.isTimeBased ? (item._manualEndTime || item.manualEndTime || (item.endTime ? new Date(item.endTime) : null)) : undefined,
                                timeBasedConfig: item.isTimeBased ? (item.timeBasedConfig || null) : undefined,
                                status: item.status || 'pending'
                            };
                            $scope.cart.push(cartItem);
                        });
                        $scope.calculateTotal();
                        // Re-evaluate lock after server data is loaded
                        refreshOrderLock();
                    }
                }).catch(function(error) {
                    console.warn('⚠️ Failed to load server SaleOrderItems:', error);
                });
            }
            
            console.log('🛒 Final cart length:', $scope.cart.length);
        }
        
        
        // Auto-save order when cart changes
        function autoSaveOrder() {
            if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                // Create/update SaleOrderItems for each cart item - LOCAL FIRST
                var saleOrderId = $scope.selectedRoom.saleOrderId;
                
                // Load existing items from localStorage
                var allItems = StorageService.get('saleorderitems') || [];
                var existingItems = allItems.filter(function(item) {
                    return item.saleOrderId === saleOrderId;
                });
                
                console.log('Existing SaleOrderItems in localStorage:', existingItems.length);
                
                // Process each cart item
                $scope.cart.forEach(function(cartItem) {
                    // Check if item already exists in localStorage
                    var existing;
                    if (cartItem._saleOrderItemId) {
                        // Match by stored ID first — handles note edits correctly
                        existing = existingItems.find(function(item) {
                            return item.id === cartItem._saleOrderItemId;
                        });
                    }
                    if (!existing) {
                        // Fallback: match by productId + old note (_prevNote) if note was just edited
                        var lookupNote = (cartItem._prevNote !== undefined) ? cartItem._prevNote : (cartItem.note || '');
                        existing = existingItems.find(function(item) {
                            return item.productId === cartItem.itemId &&
                                   (item.note || '') === lookupNote;
                        });
                        // If still not found and note was edited, try new note too
                        if (!existing && cartItem._prevNote !== undefined) {
                            existing = existingItems.find(function(item) {
                                return item.productId === cartItem.itemId &&
                                       (item.note || '') === (cartItem.note || '');
                            });
                        }
                    }
                    
                    var itemData = {
                        saleOrderId: saleOrderId,
                        productId: cartItem.itemId,
                        name: cartItem.name,
                        quantity: cartItem.quantity,
                        unitPrice: cartItem.price,
                        unit: cartItem.unit || 'phần',
                        discount: 0,
                        subtotal: cartItem.quantity * cartItem.price,
                        note: cartItem.note || '',
                        isTimeBased: cartItem.isTimeBased || false,
                        startTime: cartItem.isTimeBased ? (cartItem.startTime || cartItem.createdAt || new Date()).toISOString ? new Date(cartItem.startTime || cartItem.createdAt).toISOString() : cartItem.startTime : undefined,
                        timeBasedConfig: cartItem.isTimeBased ? (cartItem.timeBasedConfig || null) : undefined,
                        createdAt: cartItem.createdAt ? new Date(cartItem.createdAt).toISOString() : new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    
                    if (existing) {
                        // Update existing item in localStorage
                        itemData.id = existing.id;
                        itemData.createdAt = existing.createdAt;

                        // Stamp cart item so future saves match by ID
                        cartItem._saleOrderItemId = existing.id;
                        
                        // Update in array
                        var index = allItems.findIndex(function(item) {
                            return item.id === existing.id;
                        });
                        if (index >= 0) {
                            allItems[index] = itemData;
                        }
                        
                        // Add to sync queue
                        SyncService.addToQueue('update', 'saleorderitems', itemData);
                    } else {
                        // Create new item in localStorage
                        itemData.id = 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                        itemData.createdAt = new Date().toISOString();
                        itemData._localOnly = true;

                        // Stamp cart item ID for future saves
                        cartItem._saleOrderItemId = itemData.id;
                        cartItem.id = itemData.id;
                        
                        // Add to array
                        allItems.push(itemData);
                        
                        // Add to sync queue
                        SyncService.addToQueue('create', 'saleorderitems', itemData);
                    }
                });
                
                // Save back to localStorage
                StorageService.set('saleorderitems', allItems);
                console.log('✓ SaleOrderItems saved to localStorage:', allItems.length);
                
                // Update SaleOrder total in localStorage
                var total = $scope.cart.reduce(function(sum, item) {
                    return sum + (item.quantity * item.price);
                }, 0);
                
                var saleOrders = StorageService.get('saleorders') || [];
                var orderIndex = saleOrders.findIndex(function(o) {
                    return o.id === saleOrderId;
                });
                
                if (orderIndex >= 0) {
                    saleOrders[orderIndex].total = total;
                    saleOrders[orderIndex].updatedAt = new Date().toISOString();
                    StorageService.set('saleorders', saleOrders);
                    
                    // Add to sync queue
                    SyncService.addToQueue('update', 'saleorders', saleOrders[orderIndex]);
                }
            } else if ($scope.cart.length > 0 && $scope.selectedRoom) {
                // Fallback: tạo order local nếu chưa có SaleOrder
                var order = OrderService.createOrder(
                    $scope.selectedRoom.id,
                    $scope.selectedRoom.billId,
                    angular.copy($scope.cart),
                    'Auto-saved',
                    currentUser.username
                );
                
                // Sync lên server qua ApiService
                if (order) {
                    // Order đã được lưu local, sync sẽ được xử lý bởi queue
                }
            }
        }
        
        // Calculate total for display
        $scope.calculateTotal = function() {
            // Update time-based quantities in real-time before summing
            // Skip items that already have a manualEndTime (frozen by cashier)
            $scope.cart.forEach(function(item) {
                if (item.isTimeBased && !item._manualEndTime) {
                    TimeBasedService.calculateRealTimeQuantity(item);
                }
            });
            
            var total = 0;
            $scope.cart.forEach(function(item) {
                var itemTotal = item.quantity * item.price;
                total += itemTotal;
            }); 
            
            $scope.total = total;
            $scope.cartTotal = total;
        };
        
        $scope.requestPayment = function() {
            if (!$scope.selectedRoom || !$scope.selectedRoom.saleOrderId) {
                alert('Phòng chưa có đơn hàng.');
                return;
            }
            var saleOrderId = $scope.selectedRoom.saleOrderId;
            var newValue = true; // Always set to true when requesting payment
            // Update server directly
            ApiService.update('saleorders', saleOrderId, {
                id: saleOrderId,
                paymentRequested: newValue,
                paymentRequestedById: currentUser.id,
                updatedAt: new Date().toISOString()
            }).then(function() {
                // Update localStorage
                var saleOrders = StorageService.get('saleorders') || [];
                var orderIndex = saleOrders.findIndex(function(o) { return o.id === saleOrderId; });
                if (orderIndex >= 0) {
                    saleOrders[orderIndex].paymentRequested = newValue;
                    saleOrders[orderIndex].paymentRequestedById = currentUser.id;
                    saleOrders[orderIndex].updatedAt = new Date().toISOString();
                    StorageService.set('saleorders', saleOrders);
                }
                $scope.selectedRoom.paymentRequested = newValue;
                if (newValue) {
                    alert('Đã báo thanh toán cho ' + $scope.selectedRoom.name + '!');
                }
            }).catch(function(err) {
                console.error('❌ requestPayment failed:', err);
                alert('Báo thanh toán thất bại, vui lòng thử lại!');
            });
        };

        $scope.completeCleaning = function() {
            var allChecked = $scope.checklist.items.every(function(item) {
                return item.checked;
            });
            
            if (!allChecked) {
                alert('Vui lòng hoàn thành tất cả các mục kiểm tra!');
                return;
            }
            
            var completed = StaffService.completeCleaning($scope.cleaningRoom.id, currentUser.username);
            if (completed) {
                // Update room status to available, record who cleaned
                RoomService.updateRoomStatus($scope.cleaningRoom.id, 'available', {
                    cleanedById: currentUser.id,
                    cleanedAt: new Date().toISOString()
                });
                
                alert('Đã hoàn tất dọn phòng ' + $scope.cleaningRoom.name + '!\nThời gian: ' + completed.duration + ' phút');
                $scope.cleaningRoom = null;
                $scope.checklist = null;
                $scope.switchView('rooms');
            }
        };
        
        $scope.refreshCart = function() {
            if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                $scope.cart = [];
                loadRoomCart($scope.selectedRoom.saleOrderId);
            }
        };

        $scope.refreshData = function() {
            console.log('🔄 Refreshing data...');
            
            // Refresh rooms
            RoomService.initRooms();
            $scope.rooms = RoomService.getRooms();
            
            // Refresh menu
            MenuService.initMenu();
            $scope.categories = MenuService.getCategories();
            
            // Refresh current view
            if ($scope.selectedRoom) {
                if ($scope.view === 'room-items') {
                    if ($scope.categories.length > 0) {
                        $scope.selectCategory($scope.categories[0]);
                    }
                }
            }
            
            alert('Đã tải lại dữ liệu!');
        };
        
        $scope.logout = function() {
            if (confirm('Bạn có chắc muốn đăng xuất?')) {
                // Clear API authentication data
                localStorage.removeItem('$LoopBack$accessTokenId');
                localStorage.removeItem('$LoopBack$user');
                localStorage.removeItem('userProfile');
                ApiService.clearCache();
                $location.path('/login');
            }
        };

        $scope.clearCache = function() {
            // QUAN TRỌNG: window.location.reload(true) đã bị deprecated trên Chrome 90+, Firefox, Safari
            // và KHÔNG bypass được HTTP disk cache nữa. Phải dùng redirect với ?v=timestamp để
            // buộc browser request file mới (URL khác → không dùng cache cũ).
            var hardReload = function() {
                var base = window.location.origin + window.location.pathname;
                var hash = window.location.hash || '#!/waiter'; // preserve current route
                window.location.replace(base + '?v=' + Date.now() + hash);
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

        // ========== STAFF PANEL (Chấm công & Nghỉ phép) ==========
        StaffPanelService.init($scope, { accent: 'blue' });
    }
]);