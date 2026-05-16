// Cashier POS Controller
angular.module('karaApp').controller('CashierController', 
    ['$scope', '$interval', '$timeout', '$q', '$http', '$location', 'ApiService', 'RoomService', 'MenuService', 'OrderService', 'PaymentService', 'StaffService', 'AuditService', 'TimeBasedService', 'SyncService', 'StorageService', 'SocketService', 'AttendanceService', 'StaffPanelService',
    function($scope, $interval, $timeout, $q, $http, $location, ApiService, RoomService, MenuService, OrderService, PaymentService, StaffService, AuditService, TimeBasedService, SyncService, StorageService, SocketService, AttendanceService, StaffPanelService) {
        var currentUser = ApiService.getCurrentUser();
        if (!currentUser) {
            $location.path('/login');
            return;
        }
        
        // Make currentUser available to view
        $scope.currentUser = currentUser;

        // Track IDs recently sent by this machine to suppress echo socket events
        var _recentlySentIds = {};
        
        // Load rooms from server and sync
        initializeRooms();
        
        function initializeRooms() {
            // Load rooms - will load from localStorage first, then overwrite with server data
            RoomService.initRooms();
            $scope.rooms = RoomService.getRooms();
            
            // Load menu data
            MenuService.initMenu().then(function(loadedItems) {
                console.log('🍽️ Menu loaded:', loadedItems.length, 'items');
                // Delay to ensure async loading completes
                $timeout(function() {
                    $scope.categories = MenuService.getCategories();
                    console.log('📂 Categories loaded:', $scope.categories.length);
                    if ($scope.categories.length > 0) {
                        $scope.selectCategory($scope.categories[0]);
                    }
                    // Initialize menu items display
                    $scope.searchMenu();
                    // Also set all items initially
                    if (!$scope.selectedCategory) {
                        $scope.menuItems = MenuService.getMenuItems();
                        console.log('📋 Initial menu items set:', $scope.menuItems.length);
                    }
                }, 100);
            }).catch(function(error) {
                console.error('❌ Failed to load menu:', error);
            });
            
            // Note: Room data from server will automatically overwrite local
            // No sync logic needed - initRooms() handles server overwrite
        }
        
        // Expose sync status to view
        $scope.getSyncStatus = function() {
            return {
                isOnline: SyncService.isOnline(),
                pendingCount: SyncService.getPendingCount()
            };
        };
        
        // Helper function for modal management
        function showModal(modalId) {
            $timeout(function() {
                var modal = document.getElementById(modalId);
                if (modal) {
                    modal.classList.remove('hidden');
                }
            }, 0);
        }
        
        function hideModal(modalId) {
            var modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('hidden');
            }
        }
        
        // Initialize data
        $scope.rooms = RoomService.getRooms();
        $scope.categories = MenuService.getCategories();
        $scope.menuItems = [];
        $scope.selectedCategory = null;
        $scope.selectedRoom = null;
        $scope.currentBill = null;
        $scope.cart = [];
        $scope.search = { query: '' }; // Use object to avoid primitive binding issues
        $scope.view = 'pos'; // pos, bills, dashboard

        // ── Theme (dark / light) ─────────────────────────────────────
        var savedTheme = localStorage.getItem('cashier-theme') || 'dark';
        $scope.theme = savedTheme;
        if (savedTheme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }

        $scope.toggleTheme = function() {
            $scope.theme = $scope.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('cashier-theme', $scope.theme);
            if ($scope.theme === 'light') {
                document.body.classList.add('light-theme');
            } else {
                document.body.classList.remove('light-theme');
            }
        };

        // ── Mobile tab (rooms / bill / menu) ────────────────────────
        $scope.mobileTab = 'rooms';

        $scope.setMobileTab = function(tab) {
            $scope.mobileTab = tab;
        };

        $scope.bills = [];
        $scope.selectedBill = null;
        $scope.serverBillsSkip = 0;
        $scope.hasMoreBills = true;
        $scope.editBillMode = false; // Chế độ sửa bill
        
        // Daily summary data
        $scope.dailySummary = {
            totalRevenue: 0,
            totalOrders: 0,
            totalTransactions: 0,
            averageOrderValue: 0,
            paymentMethods: [],
            topItems: [],
            hourlyRevenue: {}
        };
        
        // Watch search.query for debugging
        $scope.$watch('search.query', function(newVal, oldVal) {
            if (newVal !== oldVal) {
                console.log('🔍 search.query changed:', { old: oldVal, new: newVal });
            }
        });
        
        // Timer for auto-updating surcharges
        var surchargeUpdateTimer = null;
        
        // Clock update
        $scope.currentTime = new Date();
        $interval(function() {
            $scope.currentTime = new Date();
            updateRoomTimers();
        }, 1000);

        // 15-second room status sync from server
        var roomStatusPollTimer = $interval(syncRoomStatusFromServer, 15000);

        // 20-second cart refresh (safety net khi socket miss) — silent, không flicker
        var cartPollTimer = $interval(function() {
            if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                silentRefreshCart($scope.selectedRoom.saleOrderId);
            }
        }, 20000);

        function syncRoomStatusFromServer() {
            ApiService.getAll('Rooms', null, true).then(function(serverRooms) {
                if (!serverRooms || !serverRooms.length) return;
                var localRooms = StorageService.get('rooms') || [];
                var anyChanged = false;
                serverRooms.forEach(function(serverRoom) {
                    // 1. Update RoomService internal array in-place (keeps $scope.rooms refs valid)
                    var serviceRoom = RoomService.getRoom(serverRoom.id);
                    if (serviceRoom) {
                        if (serviceRoom.status !== serverRoom.status) {
                            anyChanged = true;
                            // If cashier is viewing this room and it changed, clear selection
                            if ($scope.selectedRoom && $scope.selectedRoom.id === serverRoom.id) {
                                $scope.selectedRoom = null;
                                $scope.cart = [];
                                alert('Trạng thái phòng ' + (serverRoom.name || '') + ' đã thay đổi. Vui lòng kiểm tra lại.');
                            }
                        }
                        Object.assign(serviceRoom, serverRoom);
                        if (serviceRoom.startTime && typeof serviceRoom.startTime === 'string') {
                            serviceRoom.startTime = new Date(serviceRoom.startTime);
                        }
                    }
                    // 2. Also sync localStorage copy
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
                // Always refresh $scope.rooms from the (now-updated) service array
                if (anyChanged) {
                    $scope.rooms = RoomService.getRooms();
                }
            }).catch(function() {
                // Silent fail – no network
            });
        }

        $scope.$on('$destroy', function() {
            $interval.cancel(roomStatusPollTimer);
            $interval.cancel(cartPollTimer);
        });
        
        function updateRoomTimers() {
            $scope.rooms.forEach(function(room) {
                if (room.status === 'occupied' && room.saleOrderId) {
                    // Use room.startTime first, fallback to SaleOrder.orderDate
                    var startTime = null;
                    
                    if (room.startTime) {
                        // Room has startTime from check-in
                        startTime = room.startTime;
                        if (typeof startTime === 'string') {
                            startTime = new Date(startTime);
                        }
                    } else {
                        // Fallback to SaleOrder orderDate
                        var saleOrders = StorageService.get('saleorders') || [];
                        var saleOrder = saleOrders.find(function(o) { 
                            return o.id === room.saleOrderId; 
                        });
                        if (saleOrder && saleOrder.orderDate) {
                            startTime = new Date(saleOrder.orderDate);
                        }
                    }
                    
                    if (startTime) {
                        var now = new Date();
                        var diff = now - startTime;
                        var hours = Math.floor(diff / 3600000);
                        var minutes = Math.floor((diff % 3600000) / 60000);
                        room.timer = pad(hours) + ':' + pad(minutes);
                        
                        // Calculate current charge
                        var charge = PaymentService.calculateRoomCharge(room.type, startTime);
                        room.currentCharge = charge.totalCharge;

                        // Keep selectedRoom in sync if it's a stale reference (after rooms reassignment)
                        if ($scope.selectedRoom && $scope.selectedRoom.id === room.id) {
                            $scope.selectedRoom.timer = room.timer;
                            $scope.selectedRoom.currentCharge = room.currentCharge;
                        }
                    }
                }
            });
        }
        
        function pad(num) {
            return num < 10 ? '0' + num : num;
        }
        
        // WebSocket real-time event listeners
        $scope.$on('socket:update', function(event, data) {
            console.log('📡 Real-time update received:', data);

            if (data.model === 'SaleOrder' && data.event === 'updated') {
                // Handle SaleOrder updates
                console.log('📋 SaleOrder updated:', data.id, data.changes);

                // Update room status based on changes
                if (data.changes.paidAmount || data.changes.total) {
                    // Payment related changes - refresh rooms and current bill
                    $scope.rooms = RoomService.getRooms();
                    if ($scope.selectedRoom) {
                        $scope.calculateTotal();
                    }
                }

                // If viewing the room that was updated, refresh
                if ($scope.selectedRoom) {
                    var roomOrder = StorageService.get('room_' + $scope.selectedRoom.id);
                    if (roomOrder && roomOrder.id === data.id) {
                        $scope.calculateTotal();
                    }
                }
            } else if (data.model === 'SaleOrderItem' && (data.event === 'created' || data.event === 'updated')) {
                // Handle SaleOrderItem updates - reload bill if viewing the affected room
                console.log('📦 SaleOrderItem updated:', data.id, data.event);
                
                // Time-based items: skip 'updated' only (prevent re-adding deleted items)
                // but allow 'created' so other machines can see new timebased items
                var allItems = StorageService.get('saleorderitems') || [];
                var itemData = allItems.find(function(item) {
                    return item.id === data.id;
                });

                if (itemData && itemData.isTimeBased && data.event === 'updated') {
                    console.log('⏰ Skipping timebased item UPDATE to prevent re-adding deleted:', data.id);
                    return;
                }
                // Timebased 'created' from another machine → reload full cart to get proper state
                if (data.event === 'created' && (!itemData || itemData.isTimeBased) && $scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    ApiService.getById('saleorderitems', data.id).then(function(serverItem) {
                        if (!serverItem || !serverItem.isTimeBased) return;
                        if (serverItem.saleOrderId !== $scope.selectedRoom.saleOrderId) return;
                        // Check not already in cart
                        var exists = $scope.cart.find(function(c) { return c.id === data.id || c._saleOrderItemId === data.id; });
                        if (!exists) {
                            console.log('⏰ Timebased item created on another machine, reloading cart:', data.id);
                            loadSaleOrderItems($scope.selectedRoom.saleOrderId);
                        }
                    }).catch(function() {});
                    return;
                }

                // Fetch fresh item from server and update cart
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    // Skip echo: this machine just sent this update
                    if (data.event === 'updated' && _recentlySentIds[data.id]) {
                        console.log('⏭️ Skipping own echo for SaleOrderItem:', data.id);
                        return;
                    }

                    ApiService.getById('saleorderitems', data.id).then(function(serverItem) {
                        if (!serverItem || serverItem.isTimeBased) return;
                        if (serverItem.saleOrderId !== $scope.selectedRoom.saleOrderId) return;

                        var cartItem = $scope.cart.find(function(c) {
                            return c.id === data.id || c._saleOrderItemId === data.id;
                        });

                        if (data.event === 'created' && !cartItem) {
                            // Check if cart has a local- placeholder for this item (same machine, just promoted)
                            var localPlaceholder = $scope.cart.find(function(c) {
                                return c._saleOrderItemId && String(c._saleOrderItemId).startsWith('local-') &&
                                       c.itemId === serverItem.productId &&
                                       (c.note || '') === (serverItem.note || '');
                            });
                            if (!localPlaceholder) {
                                // Fallback: match by legacy cart.id field
                                localPlaceholder = $scope.cart.find(function(c) {
                                    return c.id && String(c.id).startsWith('local-') &&
                                           c.itemId === serverItem.productId &&
                                           (c.note || '') === (serverItem.note || '');
                                });
                            }
                            if (localPlaceholder) {
                                var oldLocalId = localPlaceholder._saleOrderItemId || localPlaceholder.id;
                                var newServerId = serverItem.id || serverItem._id;
                                // Promote local- ID to real server ID — no duplicate
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
                                console.log('🔁 Promoted local- cart item to server ID:', newServerId);
                                return;
                            }
                            // New item from another machine — add to cart
                            $scope.cart.push({
                                id: serverItem.id || serverItem._id,
                                itemId: serverItem.productId,
                                name: serverItem.name,
                                price: serverItem.unitPrice,
                                quantity: serverItem.quantity,
                                unit: serverItem.unitOfMeasure || serverItem.unit || 'phần',
                                note: serverItem.note || '',
                                status: serverItem.status || 'pending'
                            });
                            console.log('➕ Item added from another machine:', serverItem.name);
                        } else if (cartItem) {
                            // Update cart item using data.changes (mirrors waiter controller)
                            cartItem.name     = serverItem.name;
                            cartItem.price    = serverItem.unitPrice;
                            cartItem.quantity = serverItem.quantity;
                            cartItem.unit     = serverItem.unitOfMeasure || serverItem.unit || cartItem.unit;
                            cartItem.note     = serverItem.note || '';
                            cartItem.status   = serverItem.status || cartItem.status;

                            console.log('🔄 Cart item updated from another machine:', cartItem.name);
                        }

                        $scope.calculateTotal();
                    }).catch(function() {
                        $scope.calculateTotal();
                    });
                } else {
                    console.log('⚠️ Not viewing any room, no reload needed');
                }

            } else if (data.model === 'SaleOrderItem' && data.event === 'deleted') {
                // Item deleted on server (by waiter or another device) — remove from cart
                console.log('🗑️ [cashier] SaleOrderItem deleted:', data.id);
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    var delIdx = $scope.cart.findIndex(function(c) {
                        return c.id === data.id || c._saleOrderItemId === data.id;
                    });
                    if (delIdx >= 0) {
                        $scope.cart.splice(delIdx, 1);
                        $scope.calculateTotal();
                        console.log('🗑️ [cashier] Removed deleted item from cart:', data.id);
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

                // If currently viewing this room and status changed to available/cleaning, might need to clear selection
                if ($scope.selectedRoom && $scope.selectedRoom.id === data.id) {
                    var updatedRoom = $scope.rooms.find(r => r.id === data.id);
                    if (updatedRoom && (updatedRoom.status === 'available' || updatedRoom.status === 'cleaning')) {
                        // Room is now available or being cleaned, clear selection if it was occupied
                        if ($scope.selectedRoom.status === 'occupied') {
                            console.log('🔄 Room status changed from occupied, clearing selection');
                            $scope.selectedRoom = null;
                            $scope.cart = [];
                        }
                    }
                }
            }
        });
        $scope.getRoomClass = function(room) {
            if (!room.status) return 'room-empty'; // Default to empty if no status
            switch(room.status) {
                case 'available': return 'room-empty';
                case 'occupied': return 'room-occupied';
                case 'cleaning': return 'room-cleaning';
                case 'maintenance': return 'room-maintenance';
                default: return 'bg-gray-400';
            }
        };
        
        $scope.getRoomIcon = function(room) {
            switch(room.status) {
                case 'available': return 'fa-door-open';
                case 'occupied': return 'fa-music';
                case 'cleaning': return 'fa-broom';
                case 'maintenance': return 'fa-wrench';
                default: return 'fa-door-closed';
            }
        };
        
        $scope.selectRoom = function(room) {
            console.log('selectRoom clicked:', room);
            $scope.cart = [];
            $scope.selectedRoom = null;
            $scope.discount = 0;
            $scope.discountInput = 0;
            $scope.discountType = 'percentage';
            $scope.calculateTotal();

            ApiService.getById('Rooms', room.id, null, null, true).then(function(serverRoom) {
                if (!serverRoom) { _applyRoomLogic(room); return; }
                var rooms = StorageService.get('rooms') || [];
                var idx = rooms.findIndex(function(r) { return r.id === serverRoom.id; });
                if (idx !== -1) { rooms[idx] = serverRoom; } else { rooms.push(serverRoom); }
                StorageService.set('rooms', rooms);
                $scope.rooms = RoomService.getRooms();
                _applyRoomLogic(serverRoom);
            }).catch(function() {
                console.warn('Could not reach server, using local room data');
                _applyRoomLogic(room);
            });

            function _applyRoomLogic(r) {
                console.log('Applying room logic for status:', r.status);
                if (r.status === 'available') {
                    $scope.showCheckInModal(r);
                } else if (r.status === 'occupied') {
                    if (r.saleOrderId) {
                        ApiService.getById('saleorders', r.saleOrderId, null, null, true).then(function(order) {
                            if (order && order.state === 'paid') {
                                var rooms2 = StorageService.get('rooms') || [];
                                var idx2 = rooms2.findIndex(function(x) { return x.id === r.id; });
                                if (idx2 !== -1) {
                                    rooms2[idx2].status = 'available';
                                    rooms2[idx2].saleOrderId = null;
                                    StorageService.set('rooms', rooms2);
                                    $scope.rooms = RoomService.getRooms();
                                    var updatedRoom = rooms2[idx2];
                                    $scope.$applyAsync(function() { $scope.showCheckInModal(updatedRoom); });
                                }
                                return;
                            }
                            if (order) {
                                r.timeFrozen = !!(order.timeFrozen || order.printedAt);
                                var rooms3 = StorageService.get('rooms') || [];
                                var rIdx3 = rooms3.findIndex(function(x) { return x.id === r.id; });
                                if (rIdx3 >= 0) { rooms3[rIdx3].timeFrozen = r.timeFrozen; StorageService.set('rooms', rooms3); }
                                // Lưu saleorder vào localStorage để autoSaveOrder có thể update được
                                var allSaleOrders = StorageService.get('saleorders') || [];
                                var soIdx = allSaleOrders.findIndex(function(o) { return o.id === order.id; });
                                if (soIdx >= 0) { allSaleOrders[soIdx] = order; } else { allSaleOrders.push(order); }
                                StorageService.set('saleorders', allSaleOrders);
                                // Đọc discount thẳng từ order đã fetch về
                                $scope.discount = order.discount || 0;
                                $scope.discountInput = order.discountInput || order.discount || 0;
                                $scope.discountType = order.discountType || (order.discount ? 'amount' : 'percentage');
                            }
                            $scope.selectedRoom = r;
                            $scope.mobileTab = 'bill';
                            loadSaleOrderItems(r.saleOrderId);
                        }).catch(function() {
                            $scope.selectedRoom = r;
                            $scope.mobileTab = 'bill';
                            loadSaleOrderItems(r.saleOrderId);
                        });
                    } else {
                        $scope.selectedRoom = r;
                        $scope.mobileTab = 'bill';
                        $scope.calculateTotal();
                    }
                } else if (r.status === 'cleaning') {
                    alert('Phòng ' + (r.name || '') + ' đang được dọn dẹp.');
                } else if (r.status === 'maintenance') {
                    alert('Phòng ' + (r.name || '') + ' đang bảo trì.');
                }
            }
        };
        
        $scope.showCheckInModal = function(room) {
            $scope.checkInRoom = room;
            var now = new Date();
            
            $scope.checkInData = {
                startTime: now,
                customerName: '',
                customerPhone: '',
                numberOfGuests: 1
            };
            showModal('checkInModal');
        };
        
        $scope.closeCheckInModal = function() {
            hideModal('checkInModal');
        };
        
        $scope.confirmCheckIn = function() {
            var startTimeDate = $scope.checkInData.startTime;
            
            var room = RoomService.checkIn(
                $scope.checkInRoom.id,
                startTimeDate,
                {
                    name: $scope.checkInData.customerName,
                    phone: $scope.checkInData.customerPhone,
                    guests: $scope.checkInData.numberOfGuests
                }
            );
            
            if (room) {
                $scope.selectedRoom = room;
                // Refresh rooms list to update UI immediately
                $scope.rooms = RoomService.getRooms();
                // Load existing SaleOrder items if any
                if (room.saleOrderId) {
                    loadSaleOrderItems(room.saleOrderId);
                } else {
                    // Even if no items, still calculate totals
                    $scope.calculateTotal();
                }
                $scope.closeCheckInModal();
            }
        };
        
        // Load items from SaleOrder
        function loadSaleOrderItems(saleOrderId) {
            // Skip if no saleOrderId
            if (!saleOrderId) return;
            
            console.log('📦 Loading SaleOrderItems for:', saleOrderId);
            
            // For temp/local IDs, only load from localStorage
            if (saleOrderId.startsWith('temp-') || saleOrderId.startsWith('local-')) {
                console.log('📝 Loading from localStorage only for temp/local ID:', saleOrderId);
                var localItems = StorageService.get('saleorderitems') || [];
                var localOrderItems = localItems.filter(function(item) {
                    return item.saleOrderId === saleOrderId;
                });
                
                if (localOrderItems.length > 0) {
                    loadItemsIntoCart(localOrderItems);
                    $scope.calculateTotal();
                }
                return;
            }
            
            // For server-based IDs, load from server first (server is source of truth)
            ApiService.getAll('saleorderitems', {
                where: { saleOrderId: saleOrderId }
            }).then(function(serverItems) {
                console.log('🌐 Loaded server SaleOrderItems:', serverItems ? serverItems.length : 0);
                
                if (serverItems && serverItems.length > 0) {
                    // Update localStorage with server data
                    var localItems = StorageService.get('saleorderitems') || [];
                    
                    var serverIdSet = {};
                    serverItems.forEach(function(serverItem) {
                        var serverId = serverItem.id || serverItem._id;
                        serverIdSet[serverId] = true;
                        var localIndex = localItems.findIndex(function(item) {
                            return item.id === serverId;
                        });
                        
                        if (localIndex >= 0) {
                            // Update existing (already matched by real server ID)
                            serverItem._localOnly = false;
                            localItems[localIndex] = serverItem;
                        } else {
                            // No match by server ID — check if there's a local- placeholder
                            // for the same saleOrderId + productId + note that hasn't been
                            // replaced yet (sync ran but localStorage was never updated)
                            var placeholderIndex;
                            if (serverItem.isTimeBased) {
                                placeholderIndex = localItems.findIndex(function(item) {
                                    return item.saleOrderId === serverItem.saleOrderId &&
                                           item.productId === serverItem.productId &&
                                           item.isTimeBased === true &&
                                           item.id && String(item.id).startsWith('local-');
                                });
                            } else {
                                placeholderIndex = localItems.findIndex(function(item) {
                                    return item.saleOrderId === serverItem.saleOrderId &&
                                           item.productId === serverItem.productId &&
                                           (item.note || '') === (serverItem.note || '') &&
                                           item.id && String(item.id).startsWith('local-');
                                });
                            }
                            
                            if (placeholderIndex >= 0) {
                                // Replace local placeholder with real server data
                                console.log('🔄 [loadSaleOrderItems] Replacing local placeholder', localItems[placeholderIndex].id, '→ server ID', serverId);
                                serverItem._localOnly = false;
                                localItems[placeholderIndex] = serverItem;
                            } else {
                                // Brand-new server item not in localStorage at all
                                serverItem._localOnly = false;
                                localItems.push(serverItem);
                            }
                        }
                    });

                    // Prune stale items: remove any local entry for this saleOrder
                    // that has a real server ID but was not returned by the server (deleted elsewhere)
                    localItems = localItems.filter(function(item) {
                        if (item.saleOrderId !== saleOrderId) return true; // keep other orders
                        if (item.id && String(item.id).startsWith('local-')) return true; // keep pending creates
                        return !!serverIdSet[item.id]; // keep only what server returned
                    });

                    // Save to localStorage
                    StorageService.set('saleorderitems', localItems);
                    console.log('💾 Updated localStorage with server SaleOrderItems');
                    
                    // Load all items into cart from updated localStorage (consolidated source)
                    var allOrderItems = localItems.filter(function(item) {
                        return item.saleOrderId === saleOrderId;
                    });
                    
                    // Clear cart and load fresh
                    $scope.cart = [];
                    loadItemsIntoCart(allOrderItems);
                    $scope.calculateTotal();
                }
            }).catch(function(error) {
                console.warn('⚠️ Failed to load server SaleOrderItems (offline?):', error);
                
                // Fallback to localStorage when offline
                console.log('📡 Falling back to localStorage');
                var localItems = StorageService.get('saleorderitems') || [];
                var localOrderItems = localItems.filter(function(item) {
                    return item.saleOrderId === saleOrderId;
                });
                
                if (localOrderItems.length > 0) {
                    $scope.cart = [];
                    loadItemsIntoCart(localOrderItems);
                    $scope.calculateTotal();
                }
            });
        }
        
        // Silent background refresh — diff/patch cart without clearing (no flicker)
        function silentRefreshCart(saleOrderId) {
            if (!saleOrderId || saleOrderId.startsWith('temp-') || saleOrderId.startsWith('local-')) return;
            ApiService.getAll('saleorderitems', { where: { saleOrderId: saleOrderId } }).then(function(serverItems) {
                if (!serverItems || !serverItems.length) return;

                // Update localStorage silently
                var localItems = StorageService.get('saleorderitems') || [];
                var serverIdSet = {};
                serverItems.forEach(function(si) {
                    var sid = si.id || si._id;
                    serverIdSet[sid] = true;
                    var idx = localItems.findIndex(function(i) { return i.id === sid; });
                    if (idx >= 0) { localItems[idx] = si; } else { localItems.push(si); }
                });
                localItems = localItems.filter(function(i) {
                    if (i.saleOrderId !== saleOrderId) return true;
                    if (i.id && String(i.id).startsWith('local-')) return true;
                    return !!serverIdSet[i.id];
                });
                StorageService.set('saleorderitems', localItems);

                // Patch existing cart items in-place (no clear → no flicker)
                var cartChanged = false;
                serverItems.forEach(function(si) {
                    var sid = si.id || si._id;
                    var cartItem = $scope.cart.find(function(c) {
                        return c._saleOrderItemId === sid || c.id === sid;
                    });
                    if (cartItem) {
                        // Patch data only if actually changed
                        if (cartItem.quantity !== si.quantity ||
                            cartItem.price !== si.unitPrice ||
                            (cartItem.note || '') !== (si.note || '')) {
                            cartItem.quantity = si.quantity;
                            cartItem.price    = si.unitPrice;
                            cartItem.note     = si.note || '';
                            cartChanged = true;
                        }
                    } else if (!si.isTimeBased) {
                        // New non-timebased item from another machine — add it
                        $scope.cart.push({
                            itemId: si.productId,
                            name: si.name,
                            price: si.unitPrice,
                            quantity: si.quantity,
                            unit: si.unitOfMeasure || si.unit || 'phần',
                            note: si.note || '',
                            isTimeBased: false,
                            _saleOrderItemId: sid
                        });
                        cartChanged = true;
                    } else if (si.isTimeBased) {
                        // New timebased item from another machine — add it
                        $scope.cart.push({
                            itemId: si.productId,
                            name: si.name,
                            price: si.unitPrice,
                            quantity: si.quantity,
                            unit: si.unitOfMeasure || si.unit || 'phần',
                            note: si.note || '',
                            isTimeBased: true,
                            timeBasedConfig: si.timeBasedConfig || null,
                            startTime: si.startTime || si.createdAt,
                            _saleOrderItemId: sid,
                            _manualStartTime: si.startTime ? new Date(si.startTime) : null,
                            _manualEndTime:   si.endTime   ? new Date(si.endTime)   : null
                        });
                        cartChanged = true;
                    }
                });
                // Remove items deleted on server (not timebased — timebased managed separately)
                var sizeBefore = $scope.cart.length;
                $scope.cart = $scope.cart.filter(function(c) {
                    if (c.isTimeBased) return true; // don't auto-remove timebased
                    var sid = c._saleOrderItemId || c.id;
                    if (!sid || String(sid).startsWith('local-')) return true;
                    return !!serverIdSet[sid];
                });
                if ($scope.cart.length !== sizeBefore) cartChanged = true;

                if (cartChanged) {
                    $scope.calculateTotal();
                    console.log('🔄 [silentRefreshCart] Cart patched silently');
                }
            }).catch(function() { /* silent fail */ });
        }

        // Helper function to load items into cart
        function loadItemsIntoCart(orderItems) {
            // Group items by productId and note (similar to waiter displayItems)
            var groupedItems = {};
            orderItems.forEach(function(item) {
                // For time-based items, group by productId and isTimeBased only (ignore note since it changes)
                var key;
                if (item.isTimeBased) {
                    key = 'timebased_' + item.productId;
                } else {
                    key = item.productId + '|' + (item.note || '');
                }
                
                if (!groupedItems[key]) {
                    var cartEntry = {
                        itemId: item.productId,
                        name: item.name,
                        price: item.unitPrice,
                        quantity: 0,
                        unit: item.unitOfMeasure || item.unit || item.uomId || 'phần',
                        note: item.note || '',
                        isTimeBased: item.isTimeBased || false,
                        timeBasedConfig: item.timeBasedConfig || null,
                        createdAt: item.createdAt || item.updatedAt || new Date(),
                        startTime: item.startTime || item.createdAt || item.updatedAt,
                        _saleOrderItemId: item.id
                    };
                    // Restore manual time overrides saved by saveEditTimeBased so they
                    // survive a page reload (server stores them as startTime / endTime)
                    if (item.isTimeBased) {
                        if (item.startTime) cartEntry._manualStartTime = new Date(item.startTime);
                        if (item.endTime)   cartEntry._manualEndTime   = new Date(item.endTime);
                    }
                    groupedItems[key] = cartEntry;
                }
                groupedItems[key].quantity += item.quantity;
            });
            
            // Convert to cart format
            Object.values(groupedItems).forEach(function(item) {
                $scope.cart.push(item);
            });
            
            console.log('✅ Loaded', $scope.cart.length, 'grouped items into cart');
        }
        
        $scope.loadBill = function(room) {
            // Don't clear cart if it already has items (loaded from SaleOrderItems)
            var hadItems = $scope.cart.length > 0;
            if (!hadItems) {
                $scope.cart = [];
            }
            
            // Get SaleOrder for timing info
            var saleOrders = StorageService.get('saleorders') || [];
            var saleOrder = saleOrders.find(function(o) { 
                return o.id === room.saleOrderId; 
            });
            
            var startTime = saleOrder ? new Date(saleOrder.orderDate) : new Date();
            
            // Only load from OrderService if no items loaded yet
            if (!hadItems) {
                var orders = OrderService.getOrdersByRoom(room.id);
                
                // Merge items from all orders
                orders.forEach(function(order) {
                    order.items.forEach(function(item) {
                        // For time-based items, check if already exists by itemId only
                        if (item.isTimeBased) {
                            var existingTimeBased = $scope.cart.find(function(cartItem) {
                                return cartItem.isTimeBased === true && cartItem.itemId === item.itemId;
                            });
                            
                            if (!existingTimeBased) {
                                // Add time-based item (will be updated by timer)
                                var timeBasedItem = angular.copy(item);
                                if (timeBasedItem.startTime && typeof timeBasedItem.startTime === 'string') {
                                    timeBasedItem.startTime = new Date(timeBasedItem.startTime);
                                }
                                $scope.cart.push(timeBasedItem);
                            }
                            return; // Skip to next item
                        }
                        
                        // Check if non-time-based item already exists in cart (same itemId and note)
                        var existingItem = $scope.cart.find(function(cartItem) {
                            return cartItem.itemId === item.itemId && 
                                   cartItem.note === item.note &&
                                   !cartItem.isSurcharge; // Don't merge surcharges
                        });
                        
                        if (existingItem) {
                            // Merge quantities for non-time-based items
                            existingItem.quantity += item.quantity;
                        } else {
                            // Add as new item
                            var cartItem = angular.copy(item);
                            $scope.cart.push(cartItem);
                        }
                    });
                });
            }
            
            // Auto-add applicable surcharges
            if (startTime) {
                $scope.autoAddSurcharges(startTime);
                
                // Bỏ auto-add time-based products - user sẽ chọn thủ công
                // $scope.autoAddTimeBasedProducts(room.startTime);
            }
            
            $scope.calculateTotal();
            
            // Start auto-update timer for surcharges and time-based items
            startSurchargeTimer();
            
            // Start tracking time-based items
            if (startTime) {
                TimeBasedService.startTracking(room.id, startTime, $scope.cart);
            }
        };
        
        // Timer functions for auto-updating surcharges
        function startSurchargeTimer() {
            // Clear existing timer if any
            if (surchargeUpdateTimer) {
                $interval.cancel(surchargeUpdateTimer);
            }
            
            // Update surcharges every 30 seconds
            surchargeUpdateTimer = $interval(function() {
                if ($scope.selectedRoom && $scope.selectedRoom.status === 'occupied') {
                    $scope.calculateTotal(); // This updates surcharge quantities
                }
            }, 30000); // 30 seconds
        }
        
        function stopSurchargeTimer() {
            if (surchargeUpdateTimer) {
                $interval.cancel(surchargeUpdateTimer);
                surchargeUpdateTimer = null;
            }
        }
        
        // Auto-add surcharges that should apply
        $scope.autoAddSurcharges = function(startTime) {
            var autoSurcharges = MenuService.getAutoSurcharges(startTime, new Date());
            
            autoSurcharges.forEach(function(surcharge) {
                // Check if already in cart
                var existingIndex = $scope.cart.findIndex(function(item) {
                    return item.itemId === surcharge.item.id && item.isSurcharge;
                });
                
                if (existingIndex === -1 && surcharge.quantity > 0) {
                    // Add to cart
                    $scope.cart.push({
                        itemId: surcharge.item.id,
                        name: surcharge.item.name,
                        price: surcharge.item.price,
                        quantity: surcharge.quantity,
                        unit: surcharge.item.unit,
                        isSurcharge: true,
                        surchargeConfig: surcharge.item.surchargeConfig,
                        categoryId: surcharge.item.categoryId
                    });
                }
            });
        };
        
        // Auto-add time-based products that should apply
        $scope.autoAddTimeBasedProducts = function(startTime) {
            // Lấy tất cả sản phẩm isTimeBased từ menu
            var allItems = MenuService.getMenuItems();
            var timeBasedItems = allItems.filter(function(item) {
                return item.isTimeBased;
            });
            
            timeBasedItems.forEach(function(item) {
                // Kiểm tra xem đã có trong cart chưa
                var existingIndex = $scope.cart.findIndex(function(cartItem) {
                    return cartItem.itemId === item.id && cartItem.isTimeBased;
                });
                
                if (existingIndex === -1) {
                    // Thêm vào cart với số lượng tự động tính
                    TimeBasedService.addOrUpdateTimeBasedItem($scope.cart, item, startTime);
                }
            });
        };
        
        // Menu management
        $scope.selectCategory = function(category) {
            $scope.selectedCategory = category;
            $scope.menuItems = MenuService.getMenuItems(category.id);
        };
        
        $scope.searchMenu = function() {
            console.log('🔍 searchMenu called, query:', $scope.search.query, 'length:', $scope.search.query ? $scope.search.query.length : 0);
            if ($scope.search.query && $scope.search.query.trim()) {
                var allItems = MenuService.getMenuItems();
                $scope.menuItems = allItems.filter(function(item) {
                    return item.name.toLowerCase().includes($scope.search.query.toLowerCase());
                });
                console.log('📋 Filtered items:', $scope.menuItems.length, 'from', allItems.length);
            } else if ($scope.selectedCategory) {
                $scope.menuItems = MenuService.getMenuItems($scope.selectedCategory.id);
                console.log('📂 Category items:', $scope.menuItems.length);
            } else {
                // Show all items when no search and no category selected
                $scope.menuItems = MenuService.getMenuItems();
                console.log('📋 All items:', $scope.menuItems.length);
            }
            // Force digest cycle if not already in one
            if (!$scope.$$phase) {
                $scope.$apply();
            }
        };
        
        // ── Toast helper ──────────────────────────────────────────
        $scope.showToast = function(name) {
            var container = document.getElementById('cashier-toast-container');
            if (!container) return;
            var el = document.createElement('div');
            el.className = 'cashier-toast';
            el.innerHTML = '<i class="fas fa-check-circle toast-icon"></i><span class="toast-name">+ ' + name + '</span>';
            container.appendChild(el);
            // Remove after animation completes (2s total)
            $timeout(function() {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 2000);
        };

        $scope.addToCart = function(item) {
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng đang sử dụng!');
                return;
            }
            
            // Xử lý time-based products đặc biệt
            if (item.isTimeBased) {
                // Use current time as start time for the item (not room start time)
                var itemStartTime = new Date();
                TimeBasedService.addOrUpdateTimeBasedItem($scope.cart, item, itemStartTime);
                $scope.showToast(item.name);
                autoSaveOrder();
                $scope.calculateTotal();
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
                $scope.showToast(item.name);
                autoSaveOrder();
                $scope.calculateTotal();
                return;
            }
            
            // Case 2: Has item(s) with note -> ask user
            if (existingWithNote.length > 0) {
                var noteItem = existingWithNote[0];
                var message = 'Món "' + item.name + '" đã có trong giỏ với ghi chú: "' + noteItem.note + '"\n\nThêm vào món có ghi chú này?\n\n- OK: Tăng số lượng món có ghi chú\n- Cancel: Thêm món mới không có ghi chú';
                
                if (confirm(message)) {
                    // User chose to add to existing item with note
                    noteItem.quantity++;
                } else {
                    // User chose to add new item without note
                    var newCartItem = {
                        itemId: item.id,
                        name: item.name,
                        price: item.price,
                        quantity: 1,
                        unit: item.unit,
                        note: '',
                        isTimeBased: item.isTimeBased || false,
                        timeBasedConfig: item.timeBasedPricing || null,
                        createdAt: new Date()
                    };
                    
                    // Handle combo BOM
                    if (item.items && item.items.length > 0) {
                        newCartItem.isCombo = true;
                        newCartItem.bomItems = item.items;
                    }
                    
                    $scope.cart.push(newCartItem);
                }
                
                autoSaveOrder();
                $scope.calculateTotal();
                $scope.showToast(item.name);
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
                isTimeBased: item.isTimeBased || false,
                timeBasedConfig: item.timeBasedPricing || null,
                createdAt: new Date()
            };
            
            // Handle combo BOM
            if (item.items && item.items.length > 0) {
                cartItem.isCombo = true;
                cartItem.bomItems = item.items;
            }
            
            $scope.cart.push(cartItem);
            $scope.showToast(item.name);
            
            // Auto-save to order
            autoSaveOrder();
            $scope.calculateTotal();
        };
        
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
                    if (cartItem.isTimeBased) {
                        // For time-based items, find by productId only (ignore note since it changes with time)
                        existing = existingItems.find(function(item) {
                            return item.productId === cartItem.itemId && item.isTimeBased === true;
                        });
                    } else if (cartItem._saleOrderItemId) {
                        // Match by stored ID first — handles note edits correctly
                        existing = existingItems.find(function(item) {
                            return item.id === cartItem._saleOrderItemId;
                        });
                        // Fallback to productId+note if ID not found (e.g. stale reference)
                        if (!existing) {
                            existing = existingItems.find(function(item) {
                                return item.productId === cartItem.itemId &&
                                       (item.note || '') === (cartItem.note || '');
                            });
                        }
                    } else {
                        // No _saleOrderItemId — match by productId + old note (_prevNote) first,
                        // then fall back to new note, then productId alone
                        var lookupNote = (cartItem._prevNote !== undefined) ? cartItem._prevNote : (cartItem.note || '');
                        existing = existingItems.find(function(item) {
                            return item.productId === cartItem.itemId &&
                                   (item.note || '') === lookupNote;
                        });
                        if (!existing && cartItem._prevNote !== undefined) {
                            // Try with new note too (in case old note is gone)
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
                        timeBasedConfig: cartItem.timeBasedConfig || null,
                        createdAt: cartItem.createdAt ? new Date(cartItem.createdAt).toISOString() : new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    // Persist manual start/end times for time-based items so the server stores them
                    if (cartItem.isTimeBased) {
                        var tStart = cartItem._manualStartTime || cartItem.startTime || cartItem.createdAt;
                        var tEnd   = cartItem._manualEndTime || null;
                        if (tStart) itemData.startTime = new Date(tStart).toISOString();
                        // Luôn ghi endTime (kể cả null) để server xóa giờ kết thúc cũ khi user bấm "dùng giờ hiện tại"
                        itemData.endTime = tEnd ? new Date(tEnd).toISOString() : null;
                    }
                    
                    if (existing) {
                        // Update existing item in localStorage
                        itemData.id = existing.id;
                        itemData.createdAt = existing.createdAt;
                        // _localOnly: derive from ID, not from the existing flag (which can be stale)
                        itemData._localOnly = String(existing.id).startsWith('local-');
                        
                        // Stamp the cart item so future saves match by ID (survives note edits)
                        cartItem._saleOrderItemId = existing.id;

                        // Update in array
                        var index = allItems.findIndex(function(item) {
                            return item.id === existing.id;
                        });
                        if (index >= 0) {
                            allItems[index] = itemData;
                        }
                        
                        // Only sync update to server if item already has a real server ID
                        var isLocalId = itemData.id && String(itemData.id).startsWith('local-');
                        // Only queue update if something actually changed (avoid spamming all items)
                        var hasChanged = existing.quantity !== itemData.quantity ||
                                         (existing.note || '') !== (itemData.note || '') ||
                                         Number(existing.unitPrice) !== Number(itemData.unitPrice) ||
                                         (cartItem.isTimeBased && (
                                             (existing.startTime || null) !== (itemData.startTime || null) ||
                                             (existing.endTime   || null) !== (itemData.endTime   || null)
                                         ));
                        if (!isLocalId && hasChanged) {
                            console.log('📝 [autoSaveOrder] UPDATE saleorderitem id:', itemData.id, 'product:', cartItem.name);
                            SyncService.addToQueue('update', 'saleorderitems', itemData);
                            // Mark as locally-sent so the echo socket event is ignored
                            _recentlySentIds[itemData.id] = Date.now();
                            setTimeout(function(id) { delete _recentlySentIds[id]; }, 6000, itemData.id);
                        } else if (!isLocalId) {
                            console.log('📝 [autoSaveOrder] SKIP update (no change) id:', itemData.id, 'product:', cartItem.name);
                        } else {
                            console.log('📝 [autoSaveOrder] SKIP update for local- id (already queued create):', itemData.id, 'product:', cartItem.name);
                        }
                    } else {
                        // Create new item in localStorage
                        itemData.id = 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                        itemData.createdAt = new Date().toISOString();
                        itemData._localOnly = true; // Mark as not yet synced

                        // Stamp the cart item so future saves (e.g. note edits) match by ID
                        cartItem._saleOrderItemId = itemData.id;

                        // Add to array
                        allItems.push(itemData);
                        
                        console.log('📝 [autoSaveOrder] CREATE new saleorderitem local id:', itemData.id, 'product:', cartItem.name);
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
                    saleOrders[orderIndex].discount = $scope.discount || 0;
                    saleOrders[orderIndex].discountInput = $scope.discountInput || 0;
                    saleOrders[orderIndex].discountType = $scope.discountType || 'percentage';
                    saleOrders[orderIndex].updatedAt = new Date().toISOString();
                    StorageService.set('saleorders', saleOrders);
                    
                    console.log('💾 [autoSaveOrder] saleorder payload:', JSON.stringify({
                        id: saleOrders[orderIndex].id,
                        discount: saleOrders[orderIndex].discount,
                        discountInput: saleOrders[orderIndex].discountInput,
                        discountType: saleOrders[orderIndex].discountType,
                        total: saleOrders[orderIndex].total
                    }));
                    
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
        
        // Edit note for existing cart item
        $scope.editNote = function(item) {
            $scope.currentItemForNote = item;
            $scope.itemNote = item.note || '';
            // Save old note so autoSaveOrder can find the record even after note changes
            item._prevNote = item.note || '';
            showModal('noteModal');
        };
        
        $scope.saveItemNote = function() {
            var item = $scope.currentItemForNote;
            var note = $scope.itemNote;
            
            // Update note for existing item
            if (item && item.itemId) {
                item.note = note;
                autoSaveOrder(); // Save after note update
                delete item._prevNote; // clean up
            }
            
            $scope.closeNoteModal();
        };
        
        $scope.closeNoteModal = function() {
            hideModal('noteModal');
            $scope.currentItemForNote = null;
            $scope.itemNote = '';
        };

        // ===== Chỉnh giờ bắt đầu / kết thúc cho time-based cart item =====
        $scope.editTimeBasedItem = function(item) {
            $scope._editTimeItem = item;
            // AngularJS datetime-local input binds to Date objects, NOT strings.
            // Strip seconds & ms so the input shows clean hh:mm on Mac (no fractional seconds).
            function toMinutePrecision(d) {
                var t = new Date(d);
                t.setSeconds(0, 0);
                return t;
            }
            var rawStart = item._manualStartTime || item.createdAt || item.startTime;
            var rawEnd   = item._manualEndTime   || null;
            $scope._editTimeData = {
                startTime: rawStart ? toMinutePrecision(rawStart) : toMinutePrecision(new Date()),
                endTime:   rawEnd   ? toMinutePrecision(rawEnd)   : null
            };
            showModal('editTimeBasedItemModal');
        };

        $scope.closeEditTimeBasedModal = function() {
            hideModal('editTimeBasedItemModal');
            $scope._editTimeItem = null;
        };

        $scope.saveEditTimeBased = function() {
            var item = $scope._editTimeItem;
            if (!item) return;

            // Angular datetime-local ng-model gives back a Date object.
            // Strip seconds/ms to keep precision at minutes.
            function toMinute(v) {
                if (!v) return null;
                var d = (v instanceof Date) ? v : new Date(v);
                if (isNaN(d.getTime())) return null;
                d.setSeconds(0, 0);
                return d;
            }
            var start = toMinute($scope._editTimeData.startTime);
            var end   = toMinute($scope._editTimeData.endTime);

            item._manualStartTime = start; // null clears override → uses createdAt
            item._manualEndTime   = end;   // null = live (timer keeps updating)

            // Recalculate immediately — this also updates item.note with the new time range text
            TimeBasedService.calculateRealTimeQuantity(item);

            $scope.closeEditTimeBasedModal();

            // Persist to localStorage AND queue API update via SyncService
            autoSaveOrder();
            $scope.calculateTotal();
        };

        var _updateQtyTimer = null;
        $scope.updateQuantity = function(item, delta) {
            // Time-based items: quantity is auto-calculated, cannot be manually adjusted
            if (item.isTimeBased) return;

            // When decrementing from quantity 1, confirm deletion first
            if (delta < 0 && item.quantity <= 1) {
                $scope.removeFromCart(item);
                return;
            }

            // For surcharge items, increment by blocks instead of units
            item.quantity += delta;

            if (item.quantity < 1) {
                $scope.removeFromCart(item);
            } else {
                $scope.calculateTotal(); // Update UI immediately
                if (_updateQtyTimer) $timeout.cancel(_updateQtyTimer);
                _updateQtyTimer = $timeout(function() {
                    autoSaveOrder();
                    _updateQtyTimer = null;
                }, 1000);
            }
        };
        
        $scope.refreshCart = function() {
            if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                loadSaleOrderItems($scope.selectedRoom.saleOrderId);
            }
        };

        $scope.removeFromCart = function(item) {
            var index = $scope.cart.indexOf(item);
            if (index > -1 && confirm('Xóa món ' + item.name + '?')) {
                console.log('🗑️ [removeFromCart] START — cart item:', {
                    name: item.name,
                    itemId: item.itemId,
                    note: item.note,
                    isTimeBased: item.isTimeBased,
                    quantity: item.quantity
                });

                // Log audit
                AuditService.log('remove_item', {
                    room: $scope.selectedRoom.name,
                    item: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    reason: 'Xóa bởi thu ngân'
                });
                
                // Remove from localStorage and add to delete queue
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    var saleOrderId = $scope.selectedRoom.saleOrderId;
                    console.log('🗑️ [removeFromCart] saleOrderId:', saleOrderId);

                    var allItems = StorageService.get('saleorderitems') || [];
                    var orderItems = allItems.filter(function(i) { return i.saleOrderId === saleOrderId; });
                    console.log('🗑️ [removeFromCart] items in localStorage for this order:', orderItems.length);
                    orderItems.forEach(function(oi, idx) {
                        console.log('  [' + idx + ']', 'id:', oi.id, 'productId:', oi.productId, 'note:', JSON.stringify(oi.note), '_localOnly:', oi._localOnly, 'isTimeBased:', oi.isTimeBased);
                    });

                    var itemToDelete;
                    if (item.isTimeBased) {
                        itemToDelete = allItems.find(function(i) {
                            return i.productId === item.itemId && 
                                   i.saleOrderId === saleOrderId &&
                                   i.isTimeBased === true;
                        });
                        console.log('🗑️ [removeFromCart] timeBased lookup — productId:', item.itemId, '→ found:', !!itemToDelete);
                    } else {
                        itemToDelete = allItems.find(function(i) {
                            return i.productId === item.itemId && 
                                   i.saleOrderId === saleOrderId &&
                                   (i.note || '') === (item.note || '');
                        });
                        console.log('🗑️ [removeFromCart] regular lookup — productId:', item.itemId, 'note:', JSON.stringify(item.note || ''), '→ found:', !!itemToDelete);
                    }
                    
                    if (itemToDelete) {
                        console.log('🗑️ [removeFromCart] itemToDelete:', { id: itemToDelete.id, _localOnly: itemToDelete._localOnly, isTimeBased: itemToDelete.isTimeBased });

                        // Remove from localStorage
                        var itemIndex = allItems.indexOf(itemToDelete);
                        if (itemIndex > -1) {
                            allItems.splice(itemIndex, 1);
                            StorageService.set('saleorderitems', allItems);
                            console.log('🗑️ [removeFromCart] removed from localStorage');
                        }
                        
                        // Rely only on the ID prefix — _localOnly flag can be stale (server may echo it back)
                        var isLocalItem = itemToDelete.id && String(itemToDelete.id).startsWith('local-');
                        console.log('🗑️ [removeFromCart] isLocalItem:', isLocalItem, '| isOnline:', SyncService.isOnline());
                        
                        if (isLocalItem) {
                            console.log('🗑️ [removeFromCart] local-only item — cancelling pending create, no API call needed');
                            SyncService.cancelPendingCreate('saleorderitems', itemToDelete.id);
                        } else {
                            if (SyncService.isOnline()) {
                                console.log('🗑️ [removeFromCart] 🚀 calling ApiService.hardDelete SaleOrderItem id:', itemToDelete.id);
                                ApiService.hardDelete('SaleOrderItem', null, { id: itemToDelete.id }).then(function() {
                                    console.log('🗑️ [removeFromCart] ✅ API delete success for id:', itemToDelete.id);
                                }).catch(function(error) {
                                    console.warn('🗑️ [removeFromCart] ❌ API delete failed, queuing for retry:', error);
                                    SyncService.addToQueue('delete', 'saleorderitems', { id: itemToDelete.id });
                                });
                            } else {
                                console.log('🗑️ [removeFromCart] offline — queuing delete for id:', itemToDelete.id);
                                SyncService.addToQueue('delete', 'saleorderitems', { id: itemToDelete.id });
                            }
                        }
                    } else {
                        console.warn('🗑️ [removeFromCart] ⚠️ itemToDelete NOT FOUND in localStorage! Cannot call API. Cart item:', { itemId: item.itemId, note: item.note, isTimeBased: item.isTimeBased });
                    }
                } else {
                    console.warn('🗑️ [removeFromCart] ⚠️ No selectedRoom or no saleOrderId — skipping server delete. selectedRoom:', $scope.selectedRoom);
                }
                
                // Remove from cart
                $scope.cart.splice(index, 1);
                
                // Recalculate immediately without waiting for WebSocket update
                $scope.calculateTotal();
                
                console.log('🗑️ [removeFromCart] END — removed from cart UI, total recalculated');
                
                // Update SaleOrder total after removal
                if ($scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                    var total = $scope.cart.reduce(function(sum, i) {
                        return sum + (i.quantity * i.price);
                    }, 0);
                    
                    var saleOrders = StorageService.get('saleorders') || [];
                    var orderIndex = saleOrders.findIndex(function(o) {
                        return o.id === $scope.selectedRoom.saleOrderId;
                    });
                    
                    if (orderIndex >= 0) {
                        saleOrders[orderIndex].total = total;
                        saleOrders[orderIndex].updatedAt = new Date().toISOString();
                        StorageService.set('saleorders', saleOrders);
                        
                        // Add to sync queue
                        SyncService.addToQueue('update', 'saleorders', saleOrders[orderIndex]);
                    }
                }
                
                $scope.calculateTotal();
            }
        };
        
        // Return item with reason
        $scope.showReturnModal = function() {
            if (!$scope.selectedRoom || !$scope.cart || $scope.cart.length === 0) {
                alert('Không có món nào để trả!');
                return;
            }
            
            // Only show non-surcharge items
            $scope.returnableItems = $scope.cart.filter(function(item) {
                return !item.isSurcharge;
            });
            
            if ($scope.returnableItems.length === 0) {
                alert('Không có món nào có thể trả!');
                return;
            }
            
            $scope.selectedReturnItem = null;
            $scope.returnQuantity = 1;
            $scope.returnReason = '';
            showModal('returnModal');
        };
        
        $scope.selectReturnItem = function(item) {
            $scope.selectedReturnItem = item;
            $scope.returnQuantity = 1;
            $scope.maxReturnQuantity = item.quantity;
        };
        
        $scope.confirmReturn = function() {
            if (!$scope.selectedReturnItem) {
                alert('Vui lòng chọn món cần trả!');
                return;
            }
            
            if (!$scope.returnReason) {
                alert('Vui lòng chọn lý do trả món!');
                return;
            }
            
            var finalReason = $scope.returnReason === 'Khác' ? $scope.returnReasonOther : $scope.returnReason;
            if (!finalReason) {
                alert('Vui lòng nhập lý do cụ thể!');
                return;
            }
            
            var item = $scope.selectedReturnItem;
            var returnQty = parseInt($scope.returnQuantity) || 0;
            
            if (returnQty <= 0 || returnQty > item.quantity) {
                alert('Số lượng trả không hợp lệ!');
                return;
            }
            
            var index = $scope.cart.indexOf(item);
            if (index > -1) {
                // Log audit
                AuditService.log('return_item', {
                    room: $scope.selectedRoom.name,
                    item: item.name,
                    quantity: returnQty,
                    originalQuantity: item.quantity,
                    price: item.price,
                    reason: finalReason,
                    returnedAt: new Date()
                });
                
                // Return stock if combo
                if (item.isCombo && item.bomItems) {
                    item.bomItems.forEach(function(bomItem) {
                        MenuService.updateStock(bomItem.itemId, bomItem.quantity * returnQty);
                    });
                } else {
                    MenuService.updateStock(item.itemId, returnQty);
                }
                
                // Reduce quantity or remove if returning all
                if (returnQty >= item.quantity) {
                    $scope.cart.splice(index, 1);
                } else {
                    item.quantity -= returnQty;
                }
                
                autoSaveOrder(); // Save after return
                $scope.calculateTotal();
            }
            
            $scope.closeReturnModal();
        };
        
        $scope.closeReturnModal = function() {
            hideModal('returnModal');
            $scope.selectedReturnItem = null;
            $scope.returnableItems = [];
            $scope.returnQuantity = 1;
            $scope.returnReason = '';
            $scope.returnReasonOther = '';
        };
        
        $scope.calculateTotal = function() {
            // Get start time - prefer selectedRoom.startTime, fallback to SaleOrder.orderDate
            var startTime = null;
            if ($scope.selectedRoom) {
                if ($scope.selectedRoom.startTime) {
                    startTime = $scope.selectedRoom.startTime;
                    if (typeof startTime === 'string') {
                        startTime = new Date(startTime);
                    }
                } else if ($scope.selectedRoom.saleOrderId) {
                    var saleOrders = StorageService.get('saleorders') || [];
                    var saleOrder = saleOrders.find(function(o) { 
                        return o.id === $scope.selectedRoom.saleOrderId; 
                    });
                    if (saleOrder) {
                        startTime = new Date(saleOrder.orderDate);
                    }
                }
            }
            
            var frozen = $scope.selectedRoom && $scope.selectedRoom.timeFrozen;

            // Update time-based quantities (skip if frozen)
            if (!frozen && $scope.cart && $scope.cart.length > 0 && startTime) {
                TimeBasedService.calculateInitialQuantities($scope.cart, startTime);
            }
            
            // Update surcharge quantities in cart based on time (skip if frozen)
            if (!frozen && startTime) {
                $scope.cart.forEach(function(cartItem) {
                    if (cartItem.isSurcharge && cartItem.surchargeConfig && cartItem.surchargeConfig.autoCalculate) {
                        var newQuantity = MenuService.calculateSurchargeQuantity(
                            cartItem,
                            startTime,
                            new Date()
                        );
                        if (newQuantity !== cartItem.quantity) {
                            cartItem.quantity = newQuantity;
                        }
                    }
                });
            }
            
            $scope.foodTotal = $scope.cart.reduce(function(sum, item) {
                // Include all items except surcharges and time-based items in food total
                if (item.isSurcharge || item.isTimeBased) {
                    return sum;
                }
                return sum + (item.quantity * item.price);
            }, 0);
            
            $scope.timeBasedTotal = $scope.cart.reduce(function(sum, item) {
                // Include only time-based items in time-based total
                if (item.isTimeBased) {
                    return sum + (item.quantity * item.price);
                }
                return sum;
            }, 0);
            
            if (startTime) {
                var charge = PaymentService.calculateRoomCharge($scope.selectedRoom.type, startTime);
                $scope.roomCharge = charge.totalCharge + $scope.timeBasedTotal;
                $scope.subtotal = $scope.roomCharge + $scope.foodTotal;
            } else {
                $scope.roomCharge = $scope.timeBasedTotal;
                $scope.subtotal = $scope.roomCharge + $scope.foodTotal;
            }
            
            $scope.discount = $scope.discount || 0;
            // Nếu đang giảm giá %, tính lại theo subtotal mới (khi thêm/bớt món)
            if ($scope.discountInput > 0 && $scope.discountType === 'percentage') {
                var pct = Math.min(Math.max(parseFloat($scope.discountInput) || 0, 0), 100);
                $scope.discount = Math.floor($scope.subtotal * pct / 100);
            }
            $scope.total = $scope.subtotal - $scope.discount;
        };
        
        // Discount Management
        $scope.discountType = 'percentage'; // 'percentage' or 'amount'
        $scope.discountInput = 0;
        $scope.voucherCode = '';
        $scope.voucherMessage = null;
        
        $scope.applyDiscount = function() {
            if (!$scope.discountInput || $scope.discountInput < 0) {
                $scope.discount = 0;
            } else if ($scope.discountType === 'percentage') {
                var percent = Math.min(Math.max(parseFloat($scope.discountInput) || 0, 0), 100);
                $scope.discount = Math.floor($scope.subtotal * percent / 100);
            } else {
                var amount = parseFloat($scope.discountInput) || 0;
                $scope.discount = Math.min(amount, $scope.subtotal);
            }
            $scope.calculateTotal();
            // Không gọi autoSaveOrder() ở đây — ng-change gọi mỗi phím sẽ spam API
            // Lưu khi đóng modal (closeDiscountModal)
        };
        
        $scope.clearDiscount = function() {
            $scope.discount = 0;
            $scope.discountInput = 0;
            $scope.voucherCode = '';
            $scope.voucherMessage = null;
            $scope.calculateTotal();
            autoSaveOrder(); // persist discount đã xoá vào saleorder
        };
        
        $scope.showDiscountModal = function() {
            document.getElementById('discountModal').classList.remove('hidden');
        };
        
        $scope.closeDiscountModal = function() {
            document.getElementById('discountModal').classList.add('hidden');
            autoSaveOrder(); // Lưu discount vào saleorder 1 lần khi đóng modal
        };
        
        $scope.searchVoucher = function(event) {
            if (event && event.keyCode === 13) { // Enter key
                $scope.applyVoucher();
            }
        };
        
        $scope.applyVoucher = function() {
            if (!$scope.voucherCode || $scope.voucherCode.trim() === '') {
                $scope.voucherMessage = { success: false, text: 'Vui lòng nhập voucher code' };
                return;
            }
            
            // Search for voucher in promotions
            var promotions = StorageService.get('promotions') || [];
            var voucher = promotions.find(function(p) {
                return p.code && p.code.toLowerCase() === $scope.voucherCode.trim().toLowerCase();
            });
            
            if (!voucher) {
                // Try to fetch from API
                ApiService.getAll('promotions', {
                    where: { code: $scope.voucherCode.trim().toUpperCase() }
                }).then(function(results) {
                    if (results && results.length > 0) {
                        applyVoucherData(results[0]);
                    } else {
                        $scope.voucherMessage = { success: false, text: 'Voucher không tồn tại hoặc hết hạn' };
                    }
                }).catch(function() {
                    $scope.voucherMessage = { success: false, text: 'Lỗi khi tìm voucher' };
                });
            } else {
                applyVoucherData(voucher);
            }
            
            function applyVoucherData(promotion) {
                // Check if voucher is still valid
                var now = new Date();
                if (promotion.expiryDate && new Date(promotion.expiryDate) < now) {
                    $scope.voucherMessage = { success: false, text: 'Voucher đã hết hạn' };
                    return;
                }
                
                // Check if min order amount is met
                if (promotion.minOrderAmount && $scope.subtotal < promotion.minOrderAmount) {
                    $scope.voucherMessage = { 
                        success: false, 
                        text: 'Đơn hàng cần tối thiểu ' + promotion.minOrderAmount.toLocaleString('vi-VN') + 'đ' 
                    };
                    return;
                }
                
                // Apply discount based on voucher type
                if (promotion.discountType === 'percentage') {
                    $scope.discountType = 'percentage';
                    $scope.discountInput = promotion.discountValue || 0;
                } else {
                    $scope.discountType = 'amount';
                    $scope.discountInput = promotion.discountValue || 0;
                }
                
                $scope.applyDiscount();
                
                $scope.voucherMessage = { 
                    success: true, 
                    text: 'Áp dụng ' + (promotion.name || promotion.code) + ' thành công! Giảm ' + $scope.discount.toLocaleString('vi-VN') + 'đ'
                };
                
                console.log('✅ Voucher applied:', promotion);
            }
        };
        
        $scope.sendOrder = function() {
            if ($scope.cart.length === 0) {
                alert('Chưa có món nào để gửi!');
                return;
            }
            
            var order = OrderService.createOrder(
                $scope.selectedRoom.id,
                $scope.selectedRoom.billId,
                angular.copy($scope.cart),
                '',
                currentUser.username
            );
            
            if (order) {
                alert('Đã gửi order #' + order.id);
                // Clear cart after sending
                // $scope.cart = [];
                $scope.calculateTotal();
            }
        };
        
        // Payment functions
        $scope.showPaymentModal = function() {
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng để thanh toán!');
                return;
            }
            
            $scope.calculateTotal();
            $scope.paymentMethod = 'cash';
            $scope.paymentReceived = $scope.total;
            $scope.paymentChange = 0;
            
            showModal('paymentModal');
        };
        
        $scope.closePaymentModal = function() {
            hideModal('paymentModal');
        };
        
        $scope.calculateChange = function() {
            $scope.paymentChange = $scope.paymentReceived - $scope.total;
        };
        
        $scope.processPayment = function() {
            if ($scope.paymentMethod === 'cash' && $scope.paymentReceived < $scope.total) {
                alert('Số tiền nhận không đủ!');
                return;
            }
            
            // Stop surcharge timer before checkout
            stopSurchargeTimer();
            
            // Stop time-based tracking before checkout
            if ($scope.selectedRoom) {
                TimeBasedService.stopTracking($scope.selectedRoom.id);
            }
            
            // Get SaleOrder from server to create invoice
            if ($scope.selectedRoom.saleOrderId && !$scope.selectedRoom.saleOrderId.startsWith('temp-')) {
                ApiService.getById('saleorders', $scope.selectedRoom.saleOrderId).then(function(saleOrder) {
                    completePay(saleOrder);
                }).catch(function(error) {
                    console.warn('Failed to get SaleOrder, using local data:', error);
                    completePay(null);
                });
            } else {
                completePay(null);
            }
        };
        
        // Returns a promise that resolves to the next safe invoice number for today,
        // by querying the server for the current max then taking max(server, local) + 1.
        function _nextInvoiceNumber() {
            var now = new Date();
            var mmdd = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
            var prefix = 'HD' + mmdd;
            var localKey = 'invoice_sequential_' + mmdd;

            // Use createdAt date range (same approach as dashboard — known to work)
            var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            var endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

            return ApiService.getAll('invoices', {
                where: {
                    createdAt: { gte: startOfDay.toISOString(), lte: endOfDay.toISOString() }
                },
                order: 'invoiceNumber DESC',
                limit: 1
            }).then(function(results) {
                var serverNum = 0;
                if (results && results.length > 0) {
                    var latest = (results[0].invoiceNumber || '').replace(prefix, '');
                    var parsed = parseInt(latest, 10);
                    if (!isNaN(parsed) && parsed > 0) serverNum = parsed;
                }
                var localNum = parseInt(localStorage.getItem(localKey) || '0');
                var next = Math.max(serverNum, localNum) + 1;
                localStorage.setItem(localKey, next.toString());
                console.log('🔢 Invoice counter — server:', serverNum, 'local:', localNum, '→ next:', next);
                return prefix + String(next).padStart(3, '0');
            }).catch(function() {
                // Offline fallback: trust localStorage only
                var localNum = parseInt(localStorage.getItem(localKey) || '0') + 1;
                localStorage.setItem(localKey, localNum.toString());
                console.warn('🔢 Invoice counter offline fallback → next:', localNum);
                return prefix + String(localNum).padStart(3, '0');
            });
        }

        function completePay(saleOrder) {
            _nextInvoiceNumber().then(function(invoiceNumber) {
                _doCreateInvoice(invoiceNumber, saleOrder);
            });
        }

        function _doCreateInvoice(invoiceNumber, saleOrder) {

            // Create bill using backend data
            var billData = {
                invoiceNumber: invoiceNumber,
                invoiceDate: new Date(),
                customerId: saleOrder ? saleOrder.customerId : null,
                roomId: $scope.selectedRoom.id,
                startTime: $scope.selectedRoom.startTime
                    ? new Date($scope.selectedRoom.startTime).toISOString() : null,
                totalAmount: $scope.total,
                subtotal: $scope.subtotal,
                discount: $scope.discount || 0,
                discountType: $scope.discountType || 'amount',
                discountInput: $scope.discountInput || 0,
                status: 'paid',
                paidAmount: $scope.paymentReceived,
                remainingAmount: 0,
                paidBy: currentUser.username,
                cashierName: currentUser.username,
                roomCharge: $scope.roomCharge || 0,
                foodTotal: $scope.foodTotal || 0,
                paymentMethod: $scope.paymentMethod || 'cash',
                items: $scope.cart.map(function(item) {
                    var mapped = {
                        productId: item.itemId,
                        name: item.name,
                        quantity: item.quantity,
                        unit: item.unit || 'phần',
                        price: item.price,
                        total: item.quantity * item.price,
                        note: item.note || '',
                        isTimeBased: item.isTimeBased || false,
                        isSurcharge: item.isSurcharge || false
                    };
                    if (item.isTimeBased) {
                        var tStart = item._manualStartTime || item.startTime || item.createdAt;
                        if (tStart) mapped.startTime = new Date(tStart).toISOString();
                    }
                    return mapped;
                }),
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            // Create invoice via API
            ApiService.create('invoices', billData).then(function(invoice) {
                console.log('✓ Invoice created:', invoice.invoiceNumber || invoice.id);
                
                // Update SaleOrder status to completed
                if (saleOrder && saleOrder.id) {
                    ApiService.update('saleorders', saleOrder.id, {
                        status: 'completed',
                        paidAmount: $scope.total,
                        total: $scope.total,
                        updatedAt: new Date()
                    });
                }
                
                // Deduct stock for all items
                $scope.cart.forEach(function(item) {
                    if (item.isCombo && item.bomItems) {
                        item.bomItems.forEach(function(bomItem) {
                            MenuService.updateStock(bomItem.itemId, -bomItem.quantity * item.quantity);
                        });
                    } else {
                        MenuService.updateStock(item.itemId, -item.quantity);
                    }
                });
                
                // Check out room
                RoomService.checkOut($scope.selectedRoom);
                
                // Refresh rooms list to update UI immediately
                $scope.rooms = RoomService.getRooms();
                
                // Clear selection
                var invoiceNum = invoice.invoiceNumber || invoice.id;
                $scope.selectedRoom = null;
                $scope.cart = [];
                $scope.closePaymentModal();
                
                alert('Thanh toán thành công!\nHóa đơn: ' + invoiceNum + '\nTổng: ' + $scope.total.toLocaleString() + 'đ');
            }).catch(function(error) {
                console.error('Failed to create invoice:', error);
                alert('Lỗi tạo hóa đơn! Vui lòng thử lại.');
            });
        }  // end _doCreateInvoice
        
        // ── Private: chuẩn hoá bill rồi mở cửa sổ in ─────────────────
        function _openPrintWindow(bill) {
            if (!bill) { alert('Không có hóa đơn để in!'); return; }

            // Flatten items từ mọi cấu trúc: _allItems[], orders[], items[]
            var flatItems = [];
            if (bill._allItems && bill._allItems.length) {
                flatItems = bill._allItems;
            } else if (bill.orders && bill.orders.length) {
                bill.orders.forEach(function(order) {
                    (order.items || []).forEach(function(item) { flatItems.push(item); });
                });
            } else if (bill.items && bill.items.length) {
                flatItems = bill.items;
            }

            // Chuẩn hoá price (server trả unitPrice, cart dùng price)
            bill.items = flatItems.map(function(item) {
                var price = item.price || item.unitPrice || 0;
                return {
                    name:        item.name,
                    quantity:    item.quantity || 1,
                    price:       price,
                    total:       item.total || price * (item.quantity || 1),
                    note:        item.note || '',
                    isTimeBased: item.isTimeBased || false,
                    startTime:   item.startTime || item._manualStartTime || null
                };
            });
            if (bill.id && !bill.roomName) {
                bill.roomName = 'Phòng ' + (bill.roomId || '');
            }
            bill.printTime = bill.printTime || new Date();

            // Giờ bắt đầu hát = startTime của item time-based đầu tiên
            var firstTB = bill.items.find(function(i) { return i.isTimeBased && i.startTime; });
            var singStartTime = firstTB ? new Date(firstTB.startTime)
                              : (bill.startTime ? new Date(bill.startTime) : null);

            // Số hóa đơn
            var invoiceNumber = bill.invoiceNumber || bill.id;
            if (!invoiceNumber || !String(invoiceNumber).startsWith('HD')) {
                var roomLabel = bill.roomName || bill.roomId || '';
                var timeLabel = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                invoiceNumber = roomLabel + ' — ' + timeLabel;
            }

            var printWindow = window.open('', '_blank', 'width=440,height=650');
            var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Phiếu tính tiền</title><style>' +
                'body{font-family:Arial,"Helvetica Neue",sans-serif;font-size:12px;line-height:1.2;margin:0;padding:8px;max-width:420px;background:white}' +
                '.center{text-align:center}.bold{font-weight:bold}' +
                '.divider{border-top:1px dashed #000;margin:4px 0}' +
                '.double-divider{border-top:2px solid #000;margin:4px 0}' +
                '.item-header{display:flex;justify-content:space-between;font-weight:bold;font-size:11px}' +
                '.item-header .col-name{flex:1}.item-header .col-qty{width:30px;text-align:center}' +
                '.item-header .col-price{width:60px;text-align:right}.item-header .col-total{width:65px;text-align:right}' +
                '.item-block{margin:2px 0}' +
                '.item-line{display:flex;justify-content:space-between;align-items:baseline;font-size:12px}' +
                '.item-line .col-name{flex:1;word-break:break-word;padding-right:4px}' +
                '.item-line .col-qty{width:30px;text-align:center;white-space:nowrap}' +
                '.item-line .col-price{width:60px;text-align:right;white-space:nowrap}' +
                '.item-line .col-total{width:65px;text-align:right;white-space:nowrap;font-weight:bold}' +
                '.note{font-size:11px;font-style:italic;color:#444;margin:0 0 2px 6px}' +
                '.total-row{display:flex;justify-content:space-between;margin:2px 0;font-size:12px}' +
                '.total-final{font-size:14px;font-weight:bold;border-top:1px solid #000;padding-top:4px;margin-top:4px}' +
                '.item-row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}' +
                '.item-row span:last-child{text-align:right}' +
                '@media print{body{margin:0}.no-print{display:none}}' +
                '.no-print{margin-top:10px;text-align:center}' +
                '</style></head><body>';

            // Ngày trên hóa đơn = ngày khách bắt đầu hát (singStartTime),
            // nếu không có thì dùng bill.startTime (saleorder), cuối cùng mới dùng ngày thanh toán.
            var _refDate = singStartTime
                         || (bill.startTime  ? new Date(bill.startTime)  : null)
                         || (bill.paidAt     ? new Date(bill.paidAt)     : null)
                         || (bill.createdAt  ? new Date(bill.createdAt)  : null)
                         || new Date(bill.printTime);
            var dateStr  = _refDate.toLocaleDateString('vi-VN');
            var printTimeStr = new Date(bill.printTime).toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'});
            var cashier  = currentUser.name || currentUser.fullName || currentUser.username || '';

            html += '<div class="center">PHIẾU TÍNH TIỀN</div>';
            html += '<div class="center bold">' + invoiceNumber + '</div>';
            html += '<div class="divider"></div>';
            if (singStartTime) {
                var gioVaoDate = singStartTime.toLocaleDateString('vi-VN');
                var gioVaoTime = singStartTime.toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'});
                html += '<div class="item-row"><span>Giờ vào: ' + gioVaoDate + ' ' + gioVaoTime + '</span><span>Giờ in: ' + printTimeStr + '</span></div>';
            } else {
                html += '<div class="item-row"><span>Ngày:</span><span>' + dateStr + '</span></div>';
                html += '<div class="item-row"><span>Giờ in:</span><span>' + printTimeStr + '</span></div>';
            }
            html += '<div class="item-row"><span>Phòng:</span><span>' + (bill.roomName || bill.roomId || 'N/A') + '</span></div>';
            html += '<div class="item-row"><span>Nhân viên:</span><span>' + cashier + '</span></div>';
            html += '<div class="divider"></div>';
            html += '<div class="item-header">' +
                    '<span class="col-name">Tên món</span>' +
                    '<span class="col-qty">SL</span>' +
                    '<span class="col-price">Đơn giá</span>' +
                    '<span class="col-total">T.Tiền</span></div>';
            html += '<div class="divider"></div>';

            bill.items.forEach(function(item) {
                var rawNote = item.note || '';
                var note = '';
                if (rawNote) {
                    if (rawNote.startsWith('Từ ')) {
                        // Chỉ lấy phần "Từ ... đến ... (X giờ Y phút)", bỏ " - X block x Yp"
                        var dashIdx = rawNote.indexOf(' - ');
                        note = dashIdx > -1 ? rawNote.substring(0, dashIdx) : rawNote;
                    } else {
                        note = rawNote;
                    }
                }
                html += '<div class="item-block"><div class="item-line">' +
                        '<span class="col-name">' + item.name + '</span>' +
                        '<span class="col-qty">' + item.quantity + '</span>' +
                        '<span class="col-price">' + item.price.toLocaleString('vi-VN') + '</span>' +
                        '<span class="col-total">' + item.total.toLocaleString('vi-VN') + '</span>' +
                        '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
            });

            html += '<div class="double-divider"></div>';
            if (bill.subtotal > 0) {
                html += '<div class="total-row"><span>Tổng tiền hàng:</span><span>' + bill.subtotal.toLocaleString('vi-VN') + '</span></div>';
            }
            if (bill.discount > 0) {
                var discLabel = (bill.discountType === 'percentage' && bill.discountInput)
                    ? 'Chiết khấu (' + bill.discountInput + '%)' : 'Chiết khấu';
                html += '<div class="total-row"><span>' + discLabel + ':</span><span>-' + bill.discount.toLocaleString('vi-VN') + '</span></div>';
            }
            html += '<div class="total-row total-final"><span>TỔNG TIỀN:</span><span>' + (bill.total || 0).toLocaleString('vi-VN') + '</span></div>';
            html += '<div class="divider"></div>';
            html += '<div class="center">Cảm ơn quý khách và hẹn gặp lại!!!</div>';
            html += '<div class="no-print">' +
                    '<button onclick="window.print()" style="padding:5px 12px;font-size:10px;margin-right:3px">🖨️ In</button>' +
                    '<button onclick="window.close()" style="padding:5px 12px;font-size:10px">❌ Đóng</button></div>';
            html += '</body></html>';

            printWindow.document.write(html);
            printWindow.document.close();
        }

        $scope.printBill = function(bill) {
            // ── Trường hợp 1: in bill phòng hiện tại (không truyền bill) ──
            if (!bill && $scope.selectedRoom) {
                if ($scope.selectedRoom.status === 'occupied') {
                    var freezeTime = new Date();
                    $scope.selectedRoom.timeFrozen = true;
                    stopSurchargeTimer();
                    $scope.cart.forEach(function(item) {
                        if (item.isTimeBased && !item._manualEndTime) {
                            item._manualEndTime = freezeTime;
                            TimeBasedService.calculateRealTimeQuantity(item);
                        }
                    });
                    // Tính lại tổng tiền SAU KHI đã set _manualEndTime cho tất cả item
                    // để $scope.subtotal / $scope.total phản ánh đúng số lượng đã freeze
                    $scope.calculateTotal();
                    autoSaveOrder();
                    var allRooms = StorageService.get('rooms') || [];
                    var roomInStorage = allRooms.find(function(r) { return r.id === $scope.selectedRoom.id; });
                    if (roomInStorage) { roomInStorage.timeFrozen = true; StorageService.set('rooms', allRooms); }
                }
                bill = {
                    roomName:     $scope.selectedRoom.name,
                    roomId:       $scope.selectedRoom.id,
                    startTime:    $scope.selectedRoom.startTime,
                    customerInfo: $scope.selectedRoom.customerInfo || {},
                    items:        $scope.cart,
                    roomCharge:   $scope.roomCharge,
                    foodTotal:    $scope.foodTotal,
                    subtotal:     $scope.subtotal,
                    discount:     $scope.discount || 0,
                    discountType: $scope.discountType || 'amount',
                    discountInput:$scope.discountInput || 0,
                    total:        $scope.total,
                    printTime:    new Date()
                };
            }

            // ── Ghi nhận thời gian in bill ──────────────────────────────
            var printedAt = new Date().toISOString();
            // Trường hợp 1: cập nhật saleorder của phòng hiện tại
            if (!bill.id && $scope.selectedRoom && $scope.selectedRoom.saleOrderId) {
                var _soList = StorageService.get('saleorders') || [];
                var _soIdx  = _soList.findIndex(function(o) { return o.id === $scope.selectedRoom.saleOrderId; });
                if (_soIdx > -1) {
                    _soList[_soIdx].printedAt  = printedAt;
                    _soList[_soIdx].updatedAt  = printedAt;
                    StorageService.set('saleorders', _soList);
                    SyncService.addToQueue('update', 'saleorders', _soList[_soIdx]);
                }
            }
            // Trường hợp 2: cập nhật bills_cache và server nếu bill đã có id
            if (bill.id) {
                var _cache    = StorageService.get('bills_cache') || [];
                var _cacheIdx = _cache.findIndex(function(b) { return b.id === bill.id; });
                if (_cacheIdx > -1) {
                    _cache[_cacheIdx].printedAt = printedAt;
                    StorageService.set('bills_cache', _cache);
                }
                var _idStr = String(bill.id);
                if (!_idStr.startsWith('temp-') && !_idStr.startsWith('local-')) {
                    ApiService.update('invoices', bill.id, { printedAt: printedAt }).catch(function() {
                        console.warn('⚠ Không thể đồng bộ printedAt lên server');
                    });
                }
            }
            console.log('🖨 In bill lúc:', printedAt, bill.roomName || bill.id || '');

            // ── Ghi log sự kiện in bill lên server ──────────────────────
            ApiService.create('log', {
                event:       'print',
                model:       'invoice',
                objectId:    String(($scope.selectedRoom && $scope.selectedRoom.saleOrderId) || bill.saleOrderId || bill.id || ''),
                createdById: currentUser.id || currentUser.username || null,
                level:       'info',
                data: {
                    printedAt:     printedAt,
                    printedBy:     currentUser.name || currentUser.fullName || currentUser.username || '',
                    invoiceNumber: bill.invoiceNumber || bill.id || null,
                    roomName:      bill.roomName  || bill.roomId || null,
                    startTime:     bill.startTime || null,
                    items:         (bill.items || []).map(function(i) {
                        return { name: i.name, quantity: i.quantity, price: i.price, total: i.total };
                    }),
                    roomCharge:    bill.roomCharge   || 0,
                    foodTotal:     bill.foodTotal    || 0,
                    subtotal:      bill.subtotal     || 0,
                    discount:      bill.discount     || 0,
                    discountType:  bill.discountType || null,
                    total:         bill.total        || 0
                }
            }).catch(function() {
                console.warn('⚠ Không thể ghi log in bill lên server');
            });

            // ── Trường hợp 2: in bill lịch sử (bill được truyền vào) ──
            // Cả hai đều qua _openPrintWindow để render đồng nhất.
            _openPrintWindow(bill);
        };
        
        
        // Room operations
        $scope.showChangeRoomModal = function() {
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng đang sử dụng!');
                return;
            }
            
            $scope.availableRooms = $scope.rooms.filter(function(r) {
                return r.status === 'available' && r.id !== $scope.selectedRoom.id;
            });
            
            showModal('changeRoomModal');
        };
        
        $scope.closeChangeRoomModal = function() {
            hideModal('changeRoomModal');
        };
        
        $scope.changeRoom = function(newRoom) {
            if (confirm('Chuyển từ ' + $scope.selectedRoom.name + ' sang ' + newRoom.name + '?\nĐơn hàng và giờ vào sẽ được chuyển sang phòng mới.')) {
                var result = RoomService.changeRoom($scope.selectedRoom.id, newRoom.id, OrderService);
                if (result) {
                    // Log audit
                    AuditService.log('room_changed', {
                        from: $scope.selectedRoom.name,
                        to: newRoom.name,
                        startTime: result.toRoom.startTime,
                        customer: result.toRoom.customerInfo
                    });
                    
                    $scope.selectedRoom = result.toRoom;
                    $scope.calculateTotal();
                    $scope.closeChangeRoomModal();
                    alert('Đã chuyển phòng thành công!\nPhòng ' + newRoom.name + ' giờ vào: ' + new Date(result.toRoom.startTime).toLocaleString());
                }
            }
        };
        
        $scope.showPrintConfirmModal = function() {
            $scope.printBill();
        };

        $scope.closePrintConfirmModal = function() {};

        $scope.confirmPrintWithFreeze = function(freeze) {
            $scope.closePrintConfirmModal();
            if (freeze) {
                var freezeTime = new Date();
                $scope.selectedRoom.timeFrozen = true;
                stopSurchargeTimer();
                // Set endTime = giờ hiện tại cho tất cả time-based items chưa có endTime
                $scope.cart.forEach(function(item) {
                    if (item.isTimeBased && !item._manualEndTime) {
                        item._manualEndTime = freezeTime;
                        TimeBasedService.calculateRealTimeQuantity(item);
                    }
                });
                autoSaveOrder();
                // Persist frozen flag to room storage
                var allRooms = StorageService.get('rooms') || [];
                var roomInStorage = allRooms.find(function(r) { return r.id === $scope.selectedRoom.id; });
                if (roomInStorage) {
                    roomInStorage.timeFrozen = true;
                    StorageService.set('rooms', allRooms);
                }
            }
            $scope.printBill();
        };

        $scope.resumeTimeCounting = function() {
            if (!$scope.selectedRoom) return;
            $scope.selectedRoom.timeFrozen = false;
            // Xóa endTime của tất cả time-based items để tiếp tục tính theo giờ hiện tại
            $scope.cart.forEach(function(item) {
                if (item.isTimeBased) {
                    item._manualEndTime = null;
                    TimeBasedService.calculateRealTimeQuantity(item);
                }
            });
            autoSaveOrder();
            // Persist to storage
            var allRooms = StorageService.get('rooms') || [];
            var roomInStorage = allRooms.find(function(r) { return r.id === $scope.selectedRoom.id; });
            if (roomInStorage) {
                roomInStorage.timeFrozen = false;
                StorageService.set('rooms', allRooms);
            }
            startSurchargeTimer();
            $scope.calculateTotal();
        };

        $scope.showEditTimeModal = function() {
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng đang sử dụng!');
                return;
            }
            
            var startTime = new Date($scope.selectedRoom.startTime);
            
            $scope.editTimeData = {
                startTime: startTime,
                reason: ''
            };
            
            showModal('editTimeModal');
        };
        
        $scope.closeEditTimeModal = function() {
            hideModal('editTimeModal');
        };
        
        $scope.confirmEditTime = function() {
            if (!$scope.editTimeData.reason) {
                alert('Vui lòng nhập lý do!');
                return;
            }
            
            var newStartTime = $scope.editTimeData.startTime;
            // Ensure it's a proper Date object (datetime-local input can return a Date in AngularJS)
            if (!(newStartTime instanceof Date)) {
                newStartTime = new Date(newStartTime);
            }
            
            var oldTime = $scope.selectedRoom.startTime;

            // 1. Update the in-memory room object immediately (so UI + calculateTotal reflect it)
            $scope.selectedRoom.startTime = newStartTime;

            // 2. Persist the room to localStorage
            var allRooms = StorageService.get('rooms') || [];
            var roomInStorage = allRooms.find(function(r) { return r.id === $scope.selectedRoom.id; });
            if (roomInStorage) {
                roomInStorage.startTime = newStartTime;
                StorageService.set('rooms', allRooms);
            }

            // 3. Update SaleOrder orderDate
            if ($scope.selectedRoom.saleOrderId) {
                var saleOrders = StorageService.get('saleorders') || [];
                var saleOrder = saleOrders.find(function(o) { 
                    return o.id === $scope.selectedRoom.saleOrderId; 
                });
                
                if (saleOrder) {
                    saleOrder.orderDate = newStartTime;
                    saleOrder.deliveryDate = newStartTime;
                    saleOrder.updatedAt = new Date();
                    StorageService.set('saleorders', saleOrders);
                    
                    // Sync to server
                    SyncService.addToQueue('update', 'saleorders', {
                        id: saleOrder.id,
                        orderDate: newStartTime,
                        deliveryDate: newStartTime,
                        updatedAt: new Date()
                    });
                }
            }

            // 4. Log audit
            AuditService.log('edit_time', {
                room: $scope.selectedRoom.name,
                oldTime: oldTime,
                newTime: newStartTime,
                reason: $scope.editTimeData.reason,
                user: currentUser.username
            });

            $scope.calculateTotal();
            $scope.closeEditTimeModal();
            alert('Đã cập nhật giờ vào!');
        };
        
        // Merge Bills
        $scope.showMergeBillModal = function() {
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng hiện tại!');
                return;
            }
            
            $scope.mergableRooms = $scope.rooms.filter(function(r) {
                return r.status === 'occupied' && r.id !== $scope.selectedRoom.id;
            });
            
            showModal('mergeBillModal');
        };
        
        $scope.closeMergeBillModal = function() {
            hideModal('mergeBillModal');
        };
        
        $scope.mergeBill = function(fromRoom) {
            if (confirm('Gộp bill ' + fromRoom.name + ' vào ' + $scope.selectedRoom.name + '?')) {
                // Get orders from both rooms
                var fromOrders = OrderService.getOrdersByRoom(fromRoom.id);
                var toOrders = OrderService.getOrdersByRoom($scope.selectedRoom.id);
                
                // Merge orders
                fromOrders.forEach(function(order) {
                    order.roomId = $scope.selectedRoom.id;
                    order.billId = $scope.selectedRoom.billId;
                });
                
                // Log audit
                AuditService.log('merge_bill', {
                    fromRoom: fromRoom.name,
                    toRoom: $scope.selectedRoom.name,
                    fromBillId: fromRoom.billId,
                    toBillId: $scope.selectedRoom.billId,
                    user: currentUser.username
                });
                
                // Checkout from room
                RoomService.checkOut(fromRoom);π
                
                // Reload bill
                $scope.loadBill($scope.selectedRoom);
                $scope.closeMergeBillModal();
                
                alert('Đã gộp bill thành công!');
            }
        };
        
        // Split Bill
        $scope.showSplitBillModal = function() {
            if (!$scope.selectedRoom || $scope.selectedRoom.status !== 'occupied') {
                alert('Vui lòng chọn phòng hiện tại!');
                return;
            }
            
            if ($scope.cart.length === 0) {
                alert('Không có món để tách!');
                return;
            }
            
            $scope.availableRoomsForSplit = $scope.rooms.filter(function(r) {
                return r.status === 'available';
            });
            
            $scope.splitItems = $scope.cart.map(function(item) {
                return angular.extend({}, item, { toSplit: false });
            });
            
            showModal('splitBillModal');
        };
        
        $scope.closeSplitBillModal = function() {
            hideModal('splitBillModal');
        };
        
        $scope.splitBill = function(toRoom) {
            var itemsToSplit = $scope.splitItems.filter(function(item) {
                return item.toSplit;
            });
            
            if (itemsToSplit.length === 0) {
                alert('Vui lòng chọn món để tách!');
                return;
            }
            
            if (!toRoom) {
                alert('Vui lòng chọn phòng đích!');
                return;
            }
            
            if (confirm('Tách ' + itemsToSplit.length + ' món sang ' + toRoom.name + '?')) {
                // Check in new room
                var newRoom = RoomService.checkIn(
                    toRoom.id,
                    $scope.selectedRoom.startTime || new Date(), // Use original start time
                    { name: '', phone: '' } // Empty customer info
                );
                
                // Create order for new room
                var splitOrder = OrderService.createOrder(
                    newRoom.id,
                    newRoom.billId,
                    itemsToSplit,
                    'Tách từ ' + $scope.selectedRoom.name,
                    currentUser.username
                );
                
                // Remove split items from current cart
                itemsToSplit.forEach(function(splitItem) {
                    var index = $scope.cart.findIndex(function(cartItem) {
                        return cartItem.itemId === splitItem.itemId && cartItem.note === splitItem.note;
                    });
                    if (index > -1) {
                        $scope.cart.splice(index, 1);
                    }
                });
                
                // Log audit
                AuditService.log('split_bill', {
                    fromRoom: $scope.selectedRoom.name,
                    toRoom: newRoom.name,
                    itemCount: itemsToSplit.length,
                    user: currentUser.username
                });
                
                $scope.calculateTotal();
                $scope.closeSplitBillModal();
                
                alert('Đã tách bill thành công sang ' + newRoom.name + '!');
            }
        };
        
        // Bill History Management
        $scope.editBill = function(bill) {
            if (!bill) return;
            hideModal('billDetailModal');
            $scope.selectedBill = null;
            $scope.relatedAdjustments = [];

            // Flatten items từ bill (hỗ trợ cả cấu trúc orders[] và items[])
            var allItems = [];
            if (bill.orders && bill.orders.length) {
                bill.orders.forEach(function(order) {
                    (order.items || []).forEach(function(item) { allItems.push(item); });
                });
            } else if (bill.items && bill.items.length) {
                allItems = bill.items;
            }

            // Tạo cart trực tiếp từ bill items
            var cartItems = [];
            allItems.forEach(function(item) {
                cartItems.push({
                    itemId:          item.itemId || item.productId || item.id,
                    name:            item.name,
                    price:           item.price || item.unitPrice || 0,
                    quantity:        item.quantity || 1,
                    unit:            item.unit || 'phần',
                    note:            item.note || '',
                    isTimeBased:     item.isTimeBased || false,
                    isSurcharge:     item.isSurcharge || false,
                    _saleOrderItemId: item._saleOrderItemId || item.id || null,
                    _manualStartTime: item._manualStartTime ? new Date(item._manualStartTime) : (item.startTime ? new Date(item.startTime) : null),
                    _manualEndTime:   item._manualEndTime   ? new Date(item._manualEndTime)   : (item.endTime   ? new Date(item.endTime)   : null),
                    startTime:       item.startTime ? new Date(item.startTime) : undefined,
                    timeBasedConfig: item.timeBasedConfig || null,
                    createdAt:       item.createdAt || new Date()
                });
            });

            // Dựng selectedRoom giả từ thông tin bill để cart hiển thị đúng
            var fakeRoom = {
                id:           bill.roomId || null,
                name:         bill.roomName || ('Phòng ' + (bill.roomId || '')),
                status:       'occupied',
                startTime:    bill.startTime ? new Date(bill.startTime) : null,
                saleOrderId:  bill.saleOrderId || bill.id || null,
                customerInfo: bill.customerInfo || {}
            };

            // Chuyển sang POS
            $scope.view = 'pos';
            $scope.editBillMode = true;
            $scope.selectedRoom = fakeRoom;
            $scope.cart = cartItems;
            $scope.discount = bill.discount || 0;
            $scope.discountType = bill.discountType || 'amount';
            $scope.discountInput = bill.discountInput || bill.discount || 0;
            $scope.mobileTab = 'bill';
            $scope.calculateTotal();
        };

        $scope.exitEditBillMode = function() {
            $scope.editBillMode = false;
        };

        $scope.switchView = function(view) {
            $scope.editBillMode = false;
            $scope.view = view;
            if (view === 'bills') {
                loadBills();
            } else if (view === 'dashboard') {
                // Initialize date range to current business day on first open
                if (!$scope.dashboard.dateFrom) {
                    _initDashboardRange();
                }
                loadDailySummary();
            } else if (view === 'inventory') {
                $scope.inventoryTab = 'list';
                if ($scope.inventoryProducts.length === 0) _loadInventoryProducts();
            }
            // When switching back to POS on mobile, ensure a valid tab is active
            if (view === 'pos' && !$scope.mobileTab) {
                $scope.mobileTab = 'rooms';
            }
        };
        
        // Dashboard date range state — must be an object so ng-if child scope doesn't shadow primitives
        $scope.dashboard = {
            dateFrom: null,
            dateTo:   null,
            loading:  false,
            label:    ''
        };

        // Helper: extract { y, m, d } in VN time from either a Date object or 'YYYY-MM-DD' string
        function _vnDateParts(val) {
            if (val instanceof Date) {
                // Use local-time getters so VN timezone is respected naturally
                return { y: val.getFullYear(), m: val.getMonth() + 1, d: val.getDate() };
            }
            var parts = String(val).split('-');
            return { y: parseInt(parts[0]), m: parseInt(parts[1]), d: parseInt(parts[2]) };
        }

        // Helper: build noon→noon UTC range for a given day value (Date or 'YYYY-MM-DD')
        function _toUTCRange(val) {
            var p = _vnDateParts(val);
            // 12:00 VN = 05:00 UTC
            var startUTC = new Date(Date.UTC(p.y, p.m - 1, p.d,     5, 0, 0, 0));
            var endUTC   = new Date(Date.UTC(p.y, p.m - 1, p.d + 1, 5, 0, 0, 0));
            return { startUTC: startUTC, endUTC: endUTC };
        }

        // Helper: format a day value to 'dd/MM/yyyy' label
        function _toDayLabel(val) {
            var p = _vnDateParts(val);
            return pad(p.d) + '/' + pad(p.m) + '/' + p.y;
        }

        function _initDashboardRange() {
            var now    = new Date();
            var vnNow  = new Date(now.getTime() + 7 * 3600 * 1000);
            var vnHour = vnNow.getUTCHours();
            var y, mo, d;
            if (vnHour < 12) {
                // Before noon VN → still in previous business day
                var prev = new Date(vnNow.getTime() - 24 * 3600 * 1000);
                y = prev.getUTCFullYear(); mo = prev.getUTCMonth(); d = prev.getUTCDate();
            } else {
                y = vnNow.getUTCFullYear(); mo = vnNow.getUTCMonth(); d = vnNow.getUTCDate();
            }
            // UTC-midnight Date so AngularJS input[type=date] displays it correctly
            var dateObj = new Date(Date.UTC(y, mo, d));
            $scope.dashboard.dateFrom = dateObj;
            $scope.dashboard.dateTo   = dateObj;
        }

        $scope.applyDashboardRange = function() {
            loadDailySummary();
        };

        $scope.setDashboardToday = function() {
            _initDashboardRange();
            loadDailySummary();
        };

        // Load daily summary data from invoices API
        function loadDailySummary() {
            console.log('Loading daily summary from invoices...');

            if (!$scope.dashboard.dateFrom) _initDashboardRange();

            var dateFrom = $scope.dashboard.dateFrom;
            var dateTo   = $scope.dashboard.dateTo || $scope.dashboard.dateFrom;

            // Build UTC range: from start of dateFrom business day → end of dateTo business day
            var startUTC = _toUTCRange(dateFrom).startUTC;
            var endUTC   = _toUTCRange(dateTo).endUTC;

            // Label for display
            var fromLabel = _toDayLabel(dateFrom);
            var toLabel   = _toDayLabel(dateTo);
            $scope.dashboard.label = fromLabel === toLabel ? fromLabel : fromLabel + ' – ' + toLabel;

            console.log('Dashboard range:', startUTC.toISOString(), '→', endUTC.toISOString());

            $scope.dashboard.loading = true;

            // Build filter for API
            var filter = {
                where: {
                    createdAt: {
                        gte: startUTC.toISOString(),
                        lte: endUTC.toISOString()
                    },
                    status: 'paid'
                }
            };
            
            // Fetch from invoices API
            ApiService.getAll('invoices', filter)
                .then(function(invoices) {
                    console.log('Fetched invoices from server:', invoices.length);
                    calculateSummary(invoices || [], startUTC, endUTC);
                })
                .catch(function(error) {
                    console.warn('Failed to fetch invoices from server, using local data:', error);
                    var localBills = PaymentService.getBills(true);
                    calculateSummary(localBills, startUTC, endUTC);
                })
                .finally(function() {
                    $scope.dashboard.loading = false;
                });
            
            function calculateSummary(invoices, startUTC2, endUTC2) {
                var filtered = invoices.filter(function(invoice) {
                    var ts = new Date(invoice.paidAt || invoice.createdAt);
                    return ts >= startUTC2 && ts <= endUTC2 && invoice.status === 'paid';
                });
                
                var totalRevenue = 0;
                var totalOrders = 0;
                var transactionsList = [];
                var topItemsMap = {};
                var hourlyRevenueMap = {};
                
                filtered.forEach(function(invoice) {
                    totalRevenue += invoice.totalAmount || 0;
                    totalOrders++;
                    
                    var invoiceTs = new Date(invoice.paidAt || invoice.createdAt);

                    transactionsList.push({
                        invoiceNumber: invoice.invoiceNumber || invoice.id,
                        amount: invoice.totalAmount || 0,
                        paymentMethod: invoice.paymentMethod || 'Tiền mặt',
                        timestamp: invoiceTs,
                        time: invoiceTs.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                        _invoice: invoice  // keep full invoice for detail view
                    });
                    
                    if (invoice.items && Array.isArray(invoice.items)) {
                        invoice.items.forEach(function(item) {
                            var itemName = item.name || 'Sản phẩm';
                            if (!topItemsMap[itemName]) {
                                topItemsMap[itemName] = { name: itemName, quantity: 0, totalSales: 0, unit: item.unit || 'phần' };
                            }
                            topItemsMap[itemName].quantity += item.quantity || 1;
                            topItemsMap[itemName].totalSales += (item.total || item.price || 0);
                        });
                    }
                    
                    var hour = invoiceTs.getHours();
                    var hourKey = pad(hour) + ':00';
                    if (!hourlyRevenueMap[hourKey]) hourlyRevenueMap[hourKey] = 0;
                    hourlyRevenueMap[hourKey] += (invoice.totalAmount || 0);
                });
                
                transactionsList.sort(function(a, b) { return b.timestamp - a.timestamp; });

                var topItemsList = Object.values(topItemsMap).sort(function(a, b) { return b.quantity - a.quantity; });

                var hourlyRevenueList = Object.keys(hourlyRevenueMap)
                    .sort()
                    .map(function(h) { return { hour: h, amount: hourlyRevenueMap[h] }; });
                var maxHourly = hourlyRevenueList.reduce(function(m, x) { return Math.max(m, x.amount); }, 1);
                hourlyRevenueList.forEach(function(x) { x.pct = Math.round(x.amount / maxHourly * 100); });

                $scope.dailySummary = {
                    totalRevenue: totalRevenue,
                    totalOrders: totalOrders,
                    totalTransactions: filtered.length,
                    averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                    transactions: transactionsList,
                    topItems: topItemsList,
                    hourlyRevenue: hourlyRevenueList
                };
                
                console.log('Dashboard summary calculated:', $scope.dailySummary);
            }
        }
        
        function pad(n) {
            return n < 10 ? '0' + n : n;
        }
        
        
        function loadBills() {
            // Load bills from both local storage and server
            var localBills = PaymentService.getBills(true); // Skip demo data
            var serverBillsPromise = PaymentService.getServerBills($scope.serverBillsSkip);
            
            // Set sync status for local bills
            localBills.forEach(function(bill) {
                if (bill.status === 'paid' && !bill.syncStatus) {
                    bill.syncStatus = 'synced';
                }
                bill.source = 'local';
            });
            
            // Load adjustment bills
            var adjustmentBills = PaymentService.getAdjustmentBills();
            adjustmentBills.forEach(function(bill) {
                bill.source = 'local';
            });
            
            // Merge local and server bills
            serverBillsPromise.then(function(serverBills) {
                // Combine all bills
                var allBills = localBills.concat(serverBills).concat(adjustmentBills);
                
                // Remove duplicates based on ID
                var uniqueBills = [];
                var billIds = new Set();
                
                allBills.forEach(function(bill) {
                    if (!billIds.has(bill.id)) {
                        billIds.add(bill.id);
                        uniqueBills.push(bill);
                    }
                });
                
                // Sort by date descending
                uniqueBills.sort(function(a, b) {
                    var dateA = new Date(a.paidAt || a.createdAt);
                    var dateB = new Date(b.paidAt || b.createdAt);
                    return dateB - dateA;
                });
                
                $scope.bills = uniqueBills;

                // Cross-reference: attach _adjustments array onto each original bill
                uniqueBills.forEach(function(b) { b._adjustments = []; });
                uniqueBills.forEach(function(adj) {
                    if (adj.isAdjustment || adj.type === 'adjustment') {
                        var orig = uniqueBills.find(function(b) {
                            return b.id === adj.originalBillId ||
                                   (adj.originalInvoiceId &&
                                    (b.invoiceId === adj.originalInvoiceId || b._id === adj.originalInvoiceId));
                        });
                        if (orig) orig._adjustments.push(adj);
                    }
                });

                // Compute net total after adjustments for display in list
                uniqueBills.forEach(function(b) {
                    if (b._adjustments && b._adjustments.length) {
                        var adjSum = b._adjustments.reduce(function(s, a) {
                            return s + (a.refundAmount || a.totalAmount || 0);
                        }, 0);
                        b._adjustmentNetTotal = (b.total || 0) + adjSum;
                    }
                });

                // Display list: exclude adjustment invoices (they surface via _adjustments on originals)
                $scope.displayBills = uniqueBills.filter(function(b) {
                    return !b.isAdjustment && b.type !== 'adjustment';
                });

                // Cache merged list (including server bills) so they're available offline
                StorageService.set('bills_cache', uniqueBills);
                
                console.log('📊 Bills loaded:', {
                    local: localBills.length,
                    server: serverBills.length,
                    adjustments: adjustmentBills.length,
                    total: uniqueBills.length
                });
            }).catch(function(error) {
                console.warn('⚠ Failed to load server bills, using local only:', error);
                // Try cached bills first (includes previously fetched server bills)
                var cachedBills = StorageService.get('bills_cache') || [];
                var allBills = cachedBills.length > 0 ? cachedBills : localBills.concat(adjustmentBills);
                allBills.sort(function(a, b) {
                    var dateA = new Date(a.paidAt || a.createdAt);
                    var dateB = new Date(b.paidAt || b.createdAt);
                    return dateB - dateA;
                });
                $scope.bills = allBills;
                // Cross-reference adjustments for offline mode too
                allBills.forEach(function(b) { b._adjustments = []; });
                allBills.forEach(function(adj) {
                    if (adj.isAdjustment || adj.type === 'adjustment') {
                        var orig = allBills.find(function(b) {
                            return b.id === adj.originalBillId ||
                                   (adj.originalInvoiceId &&
                                    (b.invoiceId === adj.originalInvoiceId || b._id === adj.originalInvoiceId));
                        });
                        if (orig) orig._adjustments.push(adj);
                    }
                });
                allBills.forEach(function(b) {
                    if (b._adjustments && b._adjustments.length) {
                        var adjSum = b._adjustments.reduce(function(s, a) { return s + (a.refundAmount || a.totalAmount || 0); }, 0);
                        b._adjustmentNetTotal = (b.total || 0) + adjSum;
                    }
                });
                $scope.displayBills = allBills.filter(function(b) {
                    return !b.isAdjustment && b.type !== 'adjustment';
                });
                console.log('📴 Offline: showing', $scope.displayBills.length, 'bills (of', allBills.length, 'total)');
            });
        }
        
        $scope.viewTransactionDetail = function(transaction) {
            var inv = transaction._invoice;
            if (!inv) return;
            // Normalise to the shape viewBillDetail expects
            var bill = angular.extend({}, inv, {
                id:            inv.invoiceNumber || inv.id,
                invoiceNumber: inv.invoiceNumber || inv.id,
                total:         inv.totalAmount   || inv.total || 0,
                paidAt:        inv.paidAt        || inv.createdAt,
                orders:        inv.orders        || [],
                items:         inv.items         || []
            });
            $scope.viewBillDetail(bill);
        };

        $scope.viewBillDetail = function(bill) {
            $scope.selectedBill = bill;

            // Compute display fields
            bill._cashier = bill.cashierName || bill.paidBy || bill.createdBy || '—';

            // Compute roomCharge from isTimeBased items if not saved
            var tbTotal = 0;
            (bill.orders || []).forEach(function(order) {
                (order.items || []).forEach(function(item) {
                    if (item.isTimeBased || (item.unit && item.unit.toLowerCase().indexOf('gi') >= 0)) {
                        tbTotal += (item.price || 0) * (item.quantity || 0);
                    }
                });
            });
            (bill.items || []).forEach(function(item) {
                if (item.isTimeBased || (item.unit && item.unit.toLowerCase().indexOf('gi') >= 0)) {
                    tbTotal += (item.price || 0) * (item.quantity || 0);
                }
            });
            bill._roomCharge = (bill.roomCharge && bill.roomCharge > 0) ? bill.roomCharge : tbTotal;
            var rawTotal = (bill.total || 0) + (bill.discount || 0);
            bill._foodTotal = (bill.foodTotal && bill.foodTotal > 0) ? bill.foodTotal : (rawTotal - bill._roomCharge);

            // Flatten all items for display
            var allItems = [];
            if (bill.orders && bill.orders.length) {
                bill.orders.forEach(function(order) {
                    (order.items || []).forEach(function(item) { allItems.push(item); });
                });
            } else if (bill.items && bill.items.length) {
                allItems = bill.items;
            }
            bill._allItems = allItems;

            // Load related adjustment bills
            $scope.relatedAdjustments = [];
            if (bill.type === 'adjustment' || bill.isAdjustment) {
                // This is an adjustment bill — find the original by invoiceNumber or MongoDB _id
                var originalBill = $scope.bills.find(function(b) {
                    return b.id === bill.originalBillId ||
                           (bill.originalInvoiceId && (b.invoiceId === bill.originalInvoiceId || b._id === bill.originalInvoiceId));
                });
                if (originalBill) {
                    $scope.selectedBill.originalBill = originalBill;
                }
            } else {
                // This is an original bill — find all adjustments by invoiceNumber or server _id
                $scope.relatedAdjustments = PaymentService.getAdjustmentsByBill(bill.id, bill.invoiceId);
            }
            
            showModal('billDetailModal');
        };
        
        $scope.closeBillDetailModal = function() {
            hideModal('billDetailModal');
            $scope.selectedBill = null;
            $scope.relatedAdjustments = [];
        };
        
        // View adjustment bill detail
        $scope.viewAdjustmentDetail = function(adjustmentId) {
            var adjustment = $scope.bills.find(function(b) {
                return b.id === adjustmentId;
            });
            if (adjustment) {
                hideModal('billDetailModal');
                $timeout(function() {
                    $scope.viewBillDetail(adjustment);
                }, 300);
            }
        };
        
        // Return items from old bill
        $scope.showReturnBillModal = function(bill) {
            if (bill.status === 'refunded' || bill.status === 'cancelled') {
                alert('Hóa đơn này đã được xử lý trả hàng/hủy rồi!');
                return;
            }
            
            $scope.returnBill = bill;
            $scope.returnBillItems = bill.orders.flatMap(function(order) {
                return order.items.map(function(item) {
                    return angular.extend({}, item, { 
                        toReturn: false,
                        returnQuantity: 0,
                        maxQuantity: item.quantity
                    });
                });
            });
            $scope.returnBillReason = '';
            $scope.returnBillType = 'partial'; // partial or full
            
            hideModal('billDetailModal');
            showModal('returnBillModal');
        };
        
        $scope.closeReturnBillModal = function() {
            hideModal('returnBillModal');
            $scope.returnBill = null;
            $scope.returnBillItems = [];
        };
        
        $scope.confirmReturnBill = function() {
            if (!$scope.returnBillReason) {
                alert('Vui lòng nhập lý do trả hàng!');
                return;
            }
            
            var itemsToReturn = $scope.returnBillItems.filter(function(item) {
                return item.toReturn && item.returnQuantity > 0;
            });
            
            if (itemsToReturn.length === 0 && $scope.returnBillType === 'partial') {
                alert('Vui lòng chọn ít nhất 1 món để trả!');
                return;
            }
            
            // Calculate refund amount
            var refundAmount = 0;
            if ($scope.returnBillType === 'full') {
                refundAmount = $scope.returnBill.total;
            } else {
                itemsToReturn.forEach(function(item) {
                    refundAmount += item.price * item.returnQuantity;
                });
            }

            // Resolve final reason (support 'Khác' free-text)
            var finalReason = $scope.returnBillReason === 'Khác'
                ? ($scope.returnBillReasonOther || 'Khác')
                : $scope.returnBillReason;

            // Generate adjustment ID: [original]-DIEU-CHINH-[4 last digits of epoch]
            var adjustmentSuffix = String(Date.now()).slice(-4);
            var adjustmentId = $scope.returnBill.id + '-DIEU-CHINH-' + adjustmentSuffix;

            // Create adjustment bill (negative bill) — local representation
            var adjustmentBill = {
                id: adjustmentId,
                originalBillId: $scope.returnBill.id,
                type: 'adjustment',
                refundType: $scope.returnBillType,
                items: itemsToReturn,
                refundAmount: -refundAmount,
                reason: finalReason,
                createdBy: currentUser.username,
                createdAt: new Date(),
                status: 'completed',
                syncStatus: 'pending'
            };

            // Resolve the server-side MongoDB _id of the original invoice
            var originalServerId = $scope.returnBill.invoiceId || $scope.returnBill._id;
            if (!originalServerId) {
                console.warn('⚠ confirmReturnBill: originalInvoiceId unknown for bill', $scope.returnBill.id,
                    '— adjustment will be created without originalInvoiceId link on server.');
            }

            // Save adjustment bill locally (also store originalInvoiceId for UI linkage)
            adjustmentBill.originalInvoiceId = originalServerId || null;
            PaymentService.createAdjustmentBill(adjustmentBill);

            // Build invoice payload aligned with invoice.json model
            var adjustmentInvoiceData = {
                invoiceNumber: adjustmentId,
                invoiceDate: new Date(),
                isAdjustment: true,
                originalInvoiceId: originalServerId || undefined,
                adjustmentType: 'decrease',
                adjustmentReason: finalReason,
                customerId: $scope.returnBill.customerId || '69560638fb714a3aabb94714',
                roomId: $scope.returnBill.roomId,
                createdById: currentUser.id || currentUser.username,
                processedById: currentUser.id || currentUser.username,
                totalAmount: -refundAmount,
                status: 'paid',
                paidAmount: -refundAmount,
                remainingAmount: 0,
                items: itemsToReturn.map(function(item) {
                    return {
                        productId: item.itemId || item.productId,
                        name: item.name,
                        quantity: item.returnQuantity || item.quantity,
                        price: item.price,
                        total: -(item.price * (item.returnQuantity || item.quantity)),
                        note: item.note || ''
                    };
                }),
                note: 'Điều chỉnh/Hoàn trả: ' + finalReason,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            SyncService.addToQueue('create', 'invoices', adjustmentInvoiceData, {
                onSuccess: function(serverInvoice) {
                    console.log('✓ Adjustment invoice created on server:', serverInvoice.id);
                    adjustmentBill.invoiceId = serverInvoice.id;
                    adjustmentBill.syncStatus = 'synced';
                    StorageService.set('adjustmentBills', PaymentService.getAdjustmentBills());
                },
                onError: function(error) {
                    console.warn('⚠ Failed to create adjustment invoice on server:', error);
                }
            });

            // Update original bill status
            var refundedAt = new Date();
            if ($scope.returnBillType === 'full') {
                $scope.returnBill.status = 'refunded';
                $scope.returnBill.refundedAt = refundedAt;
                $scope.returnBill.refundedBy = currentUser.username;

                // Push refund status to server using MongoDB _id (not invoiceNumber)
                var returnBillServerId = $scope.returnBill.invoiceId || $scope.returnBill._id;
                if (returnBillServerId) {
                    SyncService.addToQueue('update', 'invoices', {
                        id:                   returnBillServerId,
                        status:               'refunded',
                        adjustedTotalAmount:  0,
                        updatedAt:            refundedAt.toISOString()
                    }, {
                        onSuccess: function() {
                            console.log('✓ Original bill refund status synced:', $scope.returnBill.id);
                        },
                        onError: function(err) {
                            console.warn('⚠ Failed to sync refund status for bill', $scope.returnBill.id, err);
                        }
                    });
                }
            } else {
                if (!$scope.returnBill.adjustments) {
                    $scope.returnBill.adjustments = [];
                }
                $scope.returnBill.adjustments.push(adjustmentBill.id);
            }
            
            // Return stock
            itemsToReturn.forEach(function(item) {
                if (item.isCombo && item.bomItems) {
                    item.bomItems.forEach(function(bomItem) {
                        MenuService.updateStock(bomItem.itemId, bomItem.quantity * item.returnQuantity);
                    });
                } else {
                    MenuService.updateStock(item.itemId, item.returnQuantity);
                }
            });
            
            // Log audit
            AuditService.log('refund_bill', {
                originalBillId: $scope.returnBill.id,
                adjustmentBillId: adjustmentBill.id,
                refundType: $scope.returnBillType,
                refundAmount: refundAmount,
                reason: finalReason,
                user: currentUser.username
            });
            
            PaymentService.saveBills();
            $scope.closeReturnBillModal();
            loadBills();
            
            alert('Đã tạo phiếu điều chỉnh!\nMã: ' + adjustmentBill.id + '\nSố tiền hoàn: ' + refundAmount.toLocaleString() + 'đ');
        };
        
        // Cancel entire bill
        $scope.cancelBill = function(bill) {
            if (bill.status === 'refunded' || bill.status === 'cancelled') {
                alert('Hóa đơn này đã được xử lý rồi!');
                return;
            }

            var reason = prompt('Nhập lý do hủy hóa đơn (bắt buộc):');
            if (!reason || !reason.trim()) return;
            reason = reason.trim();

            if (!confirm('Xác nhận HỦY hóa đơn ' + bill.id + '?\nSố tiền: ' + bill.total.toLocaleString() + 'đ\nLý do: ' + reason)) return;

            var cancelledAt = new Date();

            // 1. Update local bill state — do NOT zero out any amounts
            bill.status        = 'cancelled';
            bill.cancelledAt   = cancelledAt;
            bill.cancelledBy   = currentUser.username;
            bill.cancellationReason = reason;

            // 2. Push cancellation to server via SyncService
            // bill.invoiceId = MongoDB _id from server; bill.id = invoiceNumber (e.g. HD0322006)
            var serverBillId = bill.invoiceId || bill._id;
            if (serverBillId) {
            SyncService.addToQueue('update', 'invoices', {
                id:               serverBillId,
                status:           'cancelled',
                adjustmentReason: reason,
                processedById:    currentUser.id || currentUser.username,
                note:             'Huỷ lúc ' + cancelledAt.toISOString() + ' bởi ' + currentUser.username + '. Lý do: ' + reason,
                updatedAt:        cancelledAt.toISOString()
            }, {
                onSuccess: function(res) {
                    console.log('✓ Bill cancellation synced to server:', bill.id);
                    bill.syncStatus = 'synced';
                    StorageService.set('bills', PaymentService.getBills());
                },
                onError: function(err) {
                    console.warn('⚠ Failed to sync bill cancellation:', err);
                }
            });
            } else {
                console.warn('⚠ cancelBill: No server ID found for bill', bill.id, '— skipping server sync (local-only bill)');
            }

            // 3. Return stock for all items
            (bill.orders || []).forEach(function(order) {
                (order.items || []).forEach(function(item) {
                    if (item.isCombo && item.bomItems) {
                        item.bomItems.forEach(function(bomItem) {
                            MenuService.updateStock(bomItem.itemId, bomItem.quantity * item.quantity);
                        });
                    } else {
                        MenuService.updateStock(item.itemId, item.quantity);
                    }
                });
            });

            // 4. Audit log
            AuditService.log('cancel_bill', {
                billId:    bill.id,
                amount:    bill.total,
                reason:    reason,
                cancelledBy: currentUser.username,
                cancelledAt: cancelledAt.toISOString()
            });

            PaymentService.saveBills();
            hideModal('billDetailModal');
            loadBills();

            alert('Đã hủy hóa đơn ' + bill.id);
        };
        
        // Logout
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
            if (!confirm('Xóa cache JS/HTML và tải lại trang?')) return;
            // QUAN TRỌNG: window.location.reload(true) đã bị deprecated trên Chrome 90+, Firefox, Safari
            // và KHÔNG bypass được HTTP disk cache nữa. Phải dùng redirect với ?v=timestamp để
            // buộc browser request file mới (URL khác → không dùng cache cũ).
            var hardReload = function() {
                var base = window.location.origin + window.location.pathname;
                window.location.replace(base + '?v=' + Date.now());
            };
            // Bước 1: unregister service worker (xóa SW cache)
            // Bước 2: xóa Cache Storage API
            // Bước 3: redirect hard với cache-bust query
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
        StaffPanelService.init($scope, { accent: 'purple', loadPendingLeaves: false });

        // ── Inventory Management ─────────────────────────────────────────────
        $scope.inventoryTab = 'list';
        $scope.inventoryProducts = [];
        $scope.inventoryLoading = false;
        $scope.inventorySearch = '';
        $scope.importRows = [];
        $scope.importNote = '';
        $scope.importSubmitting = false;
        $scope.importSuccess = false;
        $scope.warehouses = [];
        $scope.selectedWarehouseId = '';

        function _loadInventoryProducts() {
            $scope.inventoryLoading = true;
            ApiService.getAll('Products', { limit: 500, order: 'name ASC' }).then(function(items) {
                $scope.inventoryProducts = items || [];
            }).catch(function(err) {
                console.warn('[Inventory] Load products failed:', err);
            }).finally(function() {
                $scope.inventoryLoading = false;
            });
        }
        $scope._loadInventoryProducts = _loadInventoryProducts;

        function _loadWarehouses() {
            if ($scope.warehouses.length > 0) return;
            ApiService.getAll('Warehouses', { limit: 100, order: 'name ASC' }).then(function(items) {
                $scope.warehouses = items || [];
                if (!$scope.selectedWarehouseId && $scope.warehouses.length > 0) {
                    $scope.selectedWarehouseId = $scope.warehouses[0].id;
                }
            }).catch(function(err) {
                console.warn('[Inventory] Load warehouses failed:', err);
            });
        }

        $scope.switchInventoryTab = function(tab) {
            $scope.inventoryTab = tab;
            if (tab === 'import') {
                _loadWarehouses();
                if ($scope.importRows.length === 0) $scope.addImportRow();
            }
            if (tab === 'history') {
                _loadImportHistory();
            }
        };

        $scope.addImportRow = function() {
            $scope.importRows.push({ product: null, unit: '', quantity: 1, unitCost: 0, _search: '', _filtered: [], _open: false });
        };

        $scope.onImportSearch = function(row) {
            var q = (row._search || '').toLowerCase();
            if (!q) { row._filtered = []; row._open = false; return; }
            row._filtered = $scope.inventoryProducts.filter(function(p) {
                return p.type === 'Hàng hóa' &&
                    ((p.name || '').toLowerCase().indexOf(q) > -1 ||
                     (p.code || '').toLowerCase().indexOf(q) > -1);
            });
            row._open = true;
        };

        $scope.selectImportProduct = function(row, p) {
            row.product = p;
            row._search = p.name;
            row._open = false;
            row._filtered = [];
            row.unit = p.unitOfMeasure || '';
            row.unitCost = p.unitCost || 0;
        };

        // ── Import History ────────────────────────────────────────────────────
        $scope.importHistory = [];
        $scope.importHistoryLoading = false;
        $scope.importHistoryError = '';

        function _loadImportHistory() {
            $scope.importHistoryLoading = true;
            $scope.importHistory = [];
            $scope.importHistoryError = '';
            var filter = JSON.stringify({ where: { type: 'adding' }, order: 'createdAt DESC', limit: 30 });
            var token = localStorage.getItem('$LoopBack$accessTokenId');
            $http.get(API_BASE_URL + 'StockMoves', {
                params: { filter: filter },
                headers: { Authorization: token }
            }).then(function(resp) {
                $scope.importHistory = Array.isArray(resp.data) ? resp.data :
                    (resp.data && resp.data.data) || [];
            }).catch(function(err) {
                var msg = (err.data && err.data.error && err.data.error.message) ||
                          err.statusText || 'Lỗi kết nối server';
                $scope.importHistoryError = msg;
                console.warn('[ImportHistory] load failed:', err);
            }).finally(function() {
                $scope.importHistoryLoading = false;
            });
        }
        $scope._loadImportHistory = _loadImportHistory;

        $scope.toggleHistoryDetail = function(sm) {
            sm._open = !sm._open;
            if (sm._open && !sm._items && !sm._loading) {
                sm._loading = true;
                ApiService.getAll('StockMoveItem', { where: { stockMoveId: sm.id }, include: ['product'] }).then(function(items) {
                    sm._items = items || [];
                }).finally(function() { sm._loading = false; });
            }
        };

        $scope.removeImportRow = function(idx) {
            $scope.importRows.splice(idx, 1);
        };

        $scope.onImportProductSelect = function(row) {
            if (row.product) {
                row.unit = row.product.unitOfMeasure || '';
                row.unitCost = row.product.unitCost || 0;
            }
        };

        $scope.getImportRowTotal = function(row) {
            return (parseFloat(row.quantity) || 0) * (parseFloat(row.unitCost) || 0);
        };

        $scope.getImportGrandTotal = function() {
            if (!$scope.importRows) return 0;
            return $scope.importRows.reduce(function(sum, r) {
                return sum + (parseFloat(r.quantity) || 0) * (parseFloat(r.unitCost) || 0);
            }, 0);
        };

        $scope.submitImport = function() {
            var validRows = $scope.importRows.filter(function(r) {
                return r.product && parseFloat(r.quantity) > 0;
            });
            if (validRows.length === 0) return;
            if (!$scope.selectedWarehouseId) {
                alert('Vui lòng chọn kho nhập hàng');
                return;
            }

            $scope.importSubmitting = true;
            $scope.importSuccess = false;

            var stockMove = {
                type: 'adding',
                status: 'completed',
                note: $scope.importNote || '',
                totalAmount: $scope.getImportGrandTotal(),
                completedAt: new Date().toISOString(),
                warehouseId: $scope.selectedWarehouseId
            };

            ApiService.create('StockMove', stockMove).then(function(sm) {
                return validRows.reduce(function(chain, row) {
                    return chain.then(function() {
                        return ApiService.create('StockMoveItem', {
                            stockMoveId: sm.id,
                            productId: row.product.id,
                            productName: row.product.name,
                            quantity: parseFloat(row.quantity),
                            unitCost: parseFloat(row.unitCost) || 0,
                            totalCost: (parseFloat(row.quantity) || 0) * (parseFloat(row.unitCost) || 0),
                            unit: row.unit,
                            warehouseId: $scope.selectedWarehouseId
                        });
                    });
                }, $q.when());
            }).then(function() {
                $scope.importRows = [];
                $scope.importNote = '';
                $scope.importSuccess = true;
                $scope.addImportRow();
                _loadInventoryProducts();
                $timeout(function() { $scope.importSuccess = false; }, 4000);
            }).catch(function(err) {
                console.error('[Inventory] Import failed:', err);
                alert('Lỗi nhập hàng: ' + (err.message || err || 'Không thể lưu'));
            }).finally(function() {
                $scope.importSubmitting = false;
            });
        };

        // Initialize - do nothing, all initialization happens above
    }
]);
