// Order Management Service
angular.module('karaApp').service('OrderService', ['StorageService', 'MenuService', 'AuditService', 'SyncService',
    function(StorageService, MenuService, AuditService, SyncService) {
        var orders = [];
        
        this.initOrders = function() {
            var savedOrders = StorageService.get('orders');
            if (savedOrders && savedOrders.length > 0) {
                orders = savedOrders;
            } else {
                // Initialize with demo orders (matching demo bills)
                orders = this.getInitialDemoOrders();
                this.saveOrders();
            }
            return orders;
        };
        
        // Demo orders matching the demo bills
        this.getInitialDemoOrders = function() {
            return [
                // No pending orders initially - all bills are completed
                // Orders will be created when cashier starts using the system
            ];
        };
        
        this.createOrder = function(roomId, billId, items, note, orderedBy) {
            // 1. Create and save to local first
            var order = {
                id: 'ORD-' + Date.now(),
                billId: billId,
                roomId: roomId,
                items: items, // [{itemId, name, quantity, price, note}]
                totalAmount: items.reduce((sum, item) => sum + (item.quantity * item.price), 0),
                note: note,
                status: 'pending', // pending, preparing, ready, served, cancelled
                orderedBy: orderedBy,
                orderedAt: new Date(),
                syncStatus: 'pending' // pending, synced
            };
            
            orders.push(order);
            this.saveOrders();
            
            // 2. Log audit
            AuditService.log('order_created', orderedBy, 'Order created: ' + order.id, order);
            
            // 3. Queue to server
            SyncService.addToQueue('create', 'orders', order);
            
            return order;
        };
        
        this.getOrdersByBill = function(billId) {
            if (orders.length === 0) {
                this.initOrders();
            }
            return orders.filter(o => o.billId === billId);
        };
        
        this.getOrdersByRoom = function(roomId) {
            if (orders.length === 0) {
                this.initOrders();
            }
            return orders.filter(o => o.roomId == roomId);
        };
        
        this.getPendingOrders = function() {
            if (orders.length === 0) {
                this.initOrders();
            }
            return orders.filter(o => o.status === 'pending' || o.status === 'preparing');
        };
        
        this.updateOrderStatus = function(orderId, status, updatedBy) {
            var order = orders.find(o => o.id === orderId);
            if (order) {
                var oldStatus = order.status;
                
                // 1. Update local first
                order.status = status;
                order.updatedAt = new Date();
                order.updatedBy = updatedBy;
                this.saveOrders();
                
                // 2. Log audit
                AuditService.log('order_status_changed', updatedBy, 
                    'Order ' + orderId + ' status: ' + oldStatus + ' → ' + status, 
                    { orderId: orderId, oldStatus: oldStatus, newStatus: status });
                
                // 3. Queue update to server
                SyncService.addToQueue('update', 'orders', {
                    id: orderId,
                    status: status,
                    updatedAt: order.updatedAt,
                    updatedBy: updatedBy
                });
                
                return order;
            }
            return null;
        };
        
        this.cancelOrder = function(orderId, reason, cancelledBy) {
            var order = orders.find(o => o.id === orderId);
            if (order && order.status === 'pending') {
                // 1. Update local first
                order.status = 'cancelled';
                order.cancelReason = reason;
                order.cancelledBy = cancelledBy;
                order.cancelledAt = new Date();
                
                // Return items to stock
                order.items.forEach(item => {
                    MenuService.updateStock(item.itemId, item.quantity);
                });
                
                this.saveOrders();
                
                // 2. Log audit
                AuditService.log('order_cancelled', cancelledBy, 
                    'Order cancelled: ' + orderId + '. Reason: ' + reason, order);
                
                // 3. Queue update to server
                SyncService.addToQueue('update', 'orders', {
                    id: orderId,
                    status: 'cancelled',
                    cancelReason: reason,
                    cancelledBy: cancelledBy,
                    cancelledAt: order.cancelledAt
                });
                
                return order;
            }
            return null;
        };
        
        this.transferOrdersToRoom = function(fromRoomId, toRoomId) {
            // Transfer all orders from one room to another
            var transferredCount = 0;
            orders.forEach(function(order) {
                if (order.roomId == fromRoomId && order.status !== 'cancelled' && order.status !== 'completed') {
                    order.roomId = toRoomId;
                    transferredCount++;
                }
            });
            
            if (transferredCount > 0) {
                this.saveOrders();
                
                // Log audit
                AuditService.log('orders_transferred', 'system', 
                    'Transferred ' + transferredCount + ' orders from room ' + fromRoomId + ' to room ' + toRoomId, 
                    { fromRoomId: fromRoomId, toRoomId: toRoomId, count: transferredCount });
            }
            
            return transferredCount;
        };
        
        this.returnItem = function(orderId, itemId, quantity, reason, returnedBy) {
            var order = orders.find(o => o.id === orderId);
            if (order) {
                var item = order.items.find(i => i.itemId == itemId);
                if (item && item.quantity >= quantity) {
                    // Create return record
                    if (!order.returns) order.returns = [];
                    order.returns.push({
                        itemId: itemId,
                        name: item.name,
                        quantity: quantity,
                        reason: reason,
                        returnedBy: returnedBy,
                        returnedAt: new Date()
                    });
                    
                    // Update item quantity
                    item.quantity -= quantity;
                    if (item.quantity === 0) {
                        order.items = order.items.filter(i => i.itemId !== itemId);
                    }
                    
                    // Recalculate total
                    order.totalAmount = order.items.reduce((sum, i) => sum + (i.quantity * i.price), 0);
                    
                    // Return to stock
                    MenuService.updateStock(itemId, quantity);
                    
                    this.saveOrders();
                    
                    // Log audit
                    AuditService.log('item_returned', returnedBy, 
                        'Item returned from order ' + orderId + '. Reason: ' + reason, 
                        { orderId: orderId, itemId: itemId, quantity: quantity, reason: reason });
                    
                    return order;
                }
            }
            return null;
        };
        
        this.deleteOrdersByRoom = function(roomId) {
            var deletedCount = orders.filter(o => o.roomId == roomId).length;
            orders = orders.filter(o => o.roomId != roomId);
            this.saveOrders();
            return deletedCount;
        };
        
        this.saveOrders = function() {
            StorageService.set('orders', orders);
        };
        
        // Initialize on service load
        this.initOrders();
    }
]);
