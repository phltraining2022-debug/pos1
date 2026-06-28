// Room Management Service
angular.module('karaApp').service('RoomService', ['StorageService', '$http', 'ApiService', 'SyncService',
    function(StorageService, $http, ApiService, SyncService) {
        var rooms = [];

        function clearRoomsCache() {
            rooms.length = 0;
            StorageService.set('rooms', []);
        }

        function handleAuthError(error, source) {
            if (!ApiService.isAuthError || !ApiService.isAuthError(error)) {
                return false;
            }

            ApiService.reportAuthExpired(error, source || 'room-service');
            clearRoomsCache();
            return true;
        }
        
        // Initialize rooms
        this.initRooms = function() {
            // Load from localStorage first for immediate UI render
            var saved = StorageService.get('rooms');
            if (saved && saved.length) {
                rooms = saved;
                // Convert startTime strings back to Date objects
                rooms.forEach(function(room) {
                    if (room.startTime && typeof room.startTime === 'string') {
                        room.startTime = new Date(room.startTime);
                    }
                });
            }

            // Then load from server and overwrite local (no sync logic)
            ApiService.getAll('Rooms').then(function(serverRooms) {
                if (serverRooms && serverRooms.length) {
                    console.log('📥 Loading rooms from server, overwriting local...');
                    var mapped = serverRooms.map(function(serverRoom) {
                        // Find existing local room data to preserve local state
                        var localRoom = rooms.find(r => r.id === (serverRoom.id || serverRoom._id));
                        
                        return {
                            id: serverRoom.id || serverRoom._id,
                            name: serverRoom.name,
                            code: serverRoom.code,
                            type: serverRoom.type,
                            status: serverRoom.status || 'available',
                            saleOrderId: serverRoom.saleOrderId || null,
                            // Preserve local startTime and customerInfo if room is occupied locally
                            startTime: (localRoom && localRoom.status === 'occupied' && localRoom.startTime) 
                                ? localRoom.startTime 
                                : (serverRoom.startTime ? new Date(serverRoom.startTime) : null),
                            customerInfo: (localRoom && localRoom.status === 'occupied' && localRoom.customerInfo) 
                                ? localRoom.customerInfo 
                                : (serverRoom.customerInfo || null),
                            images: serverRoom.images || [],
                            updatedAt: serverRoom.updatedAt ? new Date(serverRoom.updatedAt) : new Date(),
                            loadedFromServer: true
                        };
                    });
                    // Update in-place so any $scope.rooms reference stays live
                    rooms.length = 0;
                    mapped.forEach(function(r) { rooms.push(r); });
                    StorageService.set('rooms', rooms);
                    console.log('✓ Rooms loaded from server:', rooms.length);
                }
            }).catch(function(error) {
                if (handleAuthError(error, 'room-service-init')) {
                    return;
                }
                console.warn('⚠ Failed to load rooms from server:', error);
            });

            return rooms;
        };
        
        this.getRooms = function() {
            if (rooms.length === 0) {
                this.initRooms();
            }
            return rooms;
        };
        
        this.getRoom = function(roomId) {
            return rooms.find(r => r.id == roomId);
        };
        
        this.updateRoomStatus = function(roomId, status, data) {
            var room = this.getRoom(roomId);
            if (room) {
                // Update local first
                room.status = status;
                room.updatedAt = new Date();
                if (data) {
                    angular.extend(room, data);
                }
                this.saveRooms();
                
                // Then add to sync queue
                SyncService.addToQueue('update', 'rooms', 
                    { 
                        id: roomId, 
                        status: status,
                        updatedAt: room.updatedAt,
                        cleanedById: room.cleanedById || undefined,
                        cleanedAt: room.cleanedAt || undefined
                    }
                );
                
                return room;
            }
            return null;
        };
        
        this.checkIn = function(roomId, startTime, customerInfo) {
            var room = this.getRoom(roomId);
            if (room && room.status === 'available') {
                // 1. Update room status locally first
                room.status = 'occupied';
                room.startTime = startTime || new Date(); // Save start time to room
                room.customerInfo = customerInfo; // Save customer info
                room.updatedAt = new Date();
                
                // Generate temporary local saleOrderId
                var tempSaleOrderId = 'temp-so-' + roomId + '-' + Date.now();
                room.saleOrderId = tempSaleOrderId;
                
                this.saveRooms();
                
                // 2. Create SaleOrder data
                var saleOrderData = {
                    roomId: roomId,
                    orderDate: startTime || new Date(),
                    deliveryDate: startTime || new Date(),
                    type: 'W', // Walk-in
                    status: 'pending',
                    customerId: customerInfo.customerId || '69560638fb714a3aabb94714', // Default walk-in
                    deposit: 0,
                    paidAmount: 0,
                    discount: 0,
                    total: 0,
                    note: 'Check-in: ' + room.name + (customerInfo.name ? ' - ' + customerInfo.name : ''),
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                
                // 3. Save temp SaleOrder to local storage
                var localSaleOrders = StorageService.get('saleorders') || [];
                localSaleOrders.push({
                    id: tempSaleOrderId,
                    _localOnly: true,
                    ...saleOrderData
                });
                StorageService.set('saleorders', localSaleOrders);
                
                // 4. Add SaleOrder creation to queue
                SyncService.addToQueue('create', 'saleorders', saleOrderData, {
                    onSuccess: function(serverOrder) {
                        var realOrderId = serverOrder.id || serverOrder._id;
                        console.log('✓ SaleOrder created:', tempSaleOrderId, '->', realOrderId);
                        
                        // Update local storage with real ID
                        var orders = StorageService.get('saleorders') || [];
                        var localOrder = orders.find(function(o) { return o.id === tempSaleOrderId; });
                        if (localOrder) {
                            localOrder.id = realOrderId;
                            delete localOrder._localOnly;
                            StorageService.set('saleorders', orders);
                        }
                        
                        // Update room with real saleOrderId
                        room.saleOrderId = realOrderId;
                        room.updatedAt = new Date();
                        StorageService.set('rooms', rooms);
                        
                        // Queue room update to server
                        SyncService.addToQueue('update', 'rooms', {
                            id: roomId,
                            status: 'occupied',
                            saleOrderId: realOrderId,
                            startTime: room.startTime,
                            customerInfo: room.customerInfo,
                            updatedAt: new Date()
                        });
                    },
                    onError: function(error) {
                        console.warn('⚠ Failed to create SaleOrder:', error);
                    }
                });
                
                return room;
            }
            return null;
        };
        
        this.checkOut = function(room) {
            if (room) {
                var saleOrderId = room.saleOrderId;
                
                // 1. Update room status locally first
                room.status = 'cleaning';
                room.saleOrderId = null;
                room.startTime = null; // Clear start time
                room.customerInfo = null; // Clear customer info
                room.updatedAt = new Date();
                this.saveRooms();
                
                // 2. Queue SaleOrder update to completed
                if (saleOrderId && !saleOrderId.startsWith('temp-')) {
                    SyncService.addToQueue('update', 'saleorders', {
                        id: saleOrderId,
                        status: 'completed',
                        updatedAt: new Date()
                    });
                }
                
                // 3. Queue room status update to server
                SyncService.addToQueue('update', 'rooms', {
                    id: room.id,
                    status: 'cleaning',
                    saleOrderId: null,
                    startTime: null,
                    customerInfo: null,
                    updatedAt: new Date()
                });
                
                return room;
            }
            return null;
        };
        
        this.changeRoom = function(fromRoomId, toRoomId, OrderService) {
            var fromRoom = this.getRoom(fromRoomId);
            var toRoom = this.getRoom(toRoomId);
            
            if (fromRoom && toRoom && toRoom.status === 'available') {
                var saleOrderId = fromRoom.saleOrderId;
                
                // 1. Update local state first
                toRoom.status = 'occupied';
                toRoom.saleOrderId = saleOrderId;
                toRoom.startTime = fromRoom.startTime; // Transfer start time
                toRoom.customerInfo = fromRoom.customerInfo; // Transfer customer info
                toRoom.updatedAt = new Date();
                
                fromRoom.status = 'cleaning';
                fromRoom.saleOrderId = null;
                fromRoom.startTime = null; // Clear start time
                fromRoom.customerInfo = null; // Clear customer info
                fromRoom.updatedAt = new Date();
                
                this.saveRooms();
                
                // 2. Queue SaleOrder update
                if (saleOrderId) {
                    SyncService.addToQueue('update', 'saleorders', {
                        id: saleOrderId,
                        roomId: toRoomId,
                        note: 'Chuyển từ ' + fromRoom.name + ' sang ' + toRoom.name,
                        updatedAt: new Date()
                    });
                }
                
                // 3. Queue room updates
                SyncService.addToQueue('update', 'rooms', {
                    id: fromRoomId,
                    status: 'cleaning',
                    saleOrderId: null,
                    startTime: null,
                    customerInfo: null,
                    updatedAt: new Date()
                });
                
                SyncService.addToQueue('update', 'rooms', {
                    id: toRoomId,
                    status: 'occupied',
                    saleOrderId: saleOrderId,
                    startTime: toRoom.startTime,
                    customerInfo: toRoom.customerInfo,
                    updatedAt: new Date()
                });
                
                return { fromRoom: fromRoom, toRoom: toRoom };
            }
            return null;
        };
        
        this.saveRooms = function() {
            StorageService.set('rooms', rooms);
        };
        
        // CRUD operations for room management
        this.addRoom = function(room) {
            // 1. Add to local first
            rooms.push(room);
            this.saveRooms();
            
            // 2. Queue creation to server
            SyncService.addToQueue('create', 'rooms', room);
            
            return room;
        };
        
        this.updateRoom = function(updatedRoom) {
            var index = rooms.findIndex(function(r) {
                return r.id === updatedRoom.id;
            });
            if (index > -1) {
                // 1. Update local first
                rooms[index] = updatedRoom;
                rooms[index].updatedAt = new Date();
                this.saveRooms();
                
                // 2. Queue update to server
                SyncService.addToQueue('update', 'rooms', updatedRoom);
                
                return rooms[index];
            }
            return null;
        };
        
        this.deleteRoom = function(roomId) {
            var index = rooms.findIndex(function(r) {
                return r.id === roomId;
            });
            if (index > -1) {
                // 1. Remove from local first
                rooms.splice(index, 1);
                this.saveRooms();
                
                // 2. Queue deletion to server
                SyncService.addToQueue('delete', 'rooms', { id: roomId });
                
                return true;
            }
            return false;
        };
        
        // Add item to sale order
        this.addItemToSaleOrder = function(saleOrderId, item) {
            // 1. Save to local storage first
            var items = StorageService.get('saleorderitems') || [];
            var tempItemId = 'temp-item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            var localItem = {
                id: tempItemId,
                saleOrderId: saleOrderId,
                productId: item.productId || item.itemId,
                name: item.name,  // Add item name
                quantity: item.quantity || 1,
                unitPrice: item.price,
                uomId: item.unit || 'phần',
                discount: 0,
                subtotal: (item.quantity || 1) * item.price,
                note: item.note || '',
                createdAt: new Date(),
                updatedAt: new Date(),
                _localOnly: true
            };
            
            items.push(localItem);
            StorageService.set('saleorderitems', items);
            
            // 2. Queue to server
            var serverData = {
                saleOrderId: saleOrderId,
                productId: item.productId || item.itemId,
                name: item.name,  // Add item name for server too
                quantity: item.quantity || 1,
                unitPrice: item.price,
                uomId: item.unit || 'phần',
                discount: 0,
                subtotal: (item.quantity || 1) * item.price,
                note: item.note || '',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            SyncService.addToQueue('create', 'saleorderitems', serverData, {
                onSuccess: function(createdItem) {
                    console.log('✓ SaleOrderItem created:', tempItemId, '->', createdItem.id);
                    
                    // Update local with real ID
                    var items = StorageService.get('saleorderitems') || [];
                    var local = items.find(function(i) { return i.id === tempItemId; });
                    if (local) {
                        local.id = createdItem.id || createdItem._id;
                        delete local._localOnly;
                        StorageService.set('saleorderitems', items);
                    }
                },
                onError: function(error) {
                    console.warn('⚠ Failed to create SaleOrderItem:', error);
                }
            });
            
            return localItem;
        };
        
        // Get sale order with items for a room
        this.getSaleOrderWithItems = function(roomId) {
            var room = this.getRoom(roomId);
            if (!room || !room.saleOrderId) {
                return Promise.resolve(null);
            }
            
            var saleOrderId = room.saleOrderId;
            
            // Get sale order
            var saleOrderPromise = ApiService.getById('saleorders', saleOrderId);
            
            // Get sale order items
            var itemsPromise = ApiService.getAll('saleorderitems', {
                where: { saleOrderId: saleOrderId }
            });
            
            return Promise.all([saleOrderPromise, itemsPromise]).then(function(results) {
                var saleOrder = results[0];
                var items = results[1] || [];
                
                return {
                    saleOrder: saleOrder,
                    items: items
                };
            }).catch(function(error) {
                if (handleAuthError(error, 'room-service-get-saleorder-with-items')) {
                    return null;
                }
                console.warn('⚠ Failed to get sale order with items for room', roomId, error);
                return null;
            });
        };
        
        // Get room with its current sale order and items
        this.getRoomWithOrder = function(roomId) {
            var room = this.getRoom(roomId);
            if (!room) {
                return Promise.resolve(null);
            }
            
            if (room.saleOrderId) {
                return this.getSaleOrderWithItems(roomId).then(function(orderData) {
                    return {
                        room: room,
                        orderData: orderData
                    };
                });
            } else {
                return Promise.resolve({
                    room: room,
                    orderData: null
                });
            }
        };
    }
]);
