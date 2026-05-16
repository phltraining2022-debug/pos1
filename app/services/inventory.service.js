// Inventory Management Service
angular.module('karaApp').service('InventoryService', ['StorageService', 'AuditService',
    function(StorageService, AuditService) {
        var inventory = [];
        var minStockWarnings = [];
        
        this.initInventory = function() {
            inventory = StorageService.get('inventory') || [];
            return inventory;
        };
        
        // Get inventory for an item
        this.getInventory = function(itemId) {
            return inventory.find(inv => inv.itemId == itemId);
        };
        
        // Stock in (Nhập kho)
        this.stockIn = function(itemId, quantity, cost, expiryDate, supplier, invoiceNumber, user) {
            var inv = this.getInventory(itemId);
            
            if (!inv) {
                inv = {
                    itemId: itemId,
                    totalStock: 0,
                    batches: [],
                    minStock: 10 // Default min stock warning level
                };
                inventory.push(inv);
            }
            
            // Add batch
            var batch = {
                id: 'BATCH-' + Date.now(),
                quantity: quantity,
                remainingQuantity: quantity,
                cost: cost,
                expiryDate: expiryDate,
                supplier: supplier,
                invoiceNumber: invoiceNumber,
                stockInDate: new Date(),
                stockInBy: user
            };
            
            inv.batches.push(batch);
            inv.totalStock += quantity;
            
            // Log audit
            AuditService.log('stock_in', {
                itemId: itemId,
                quantity: quantity,
                cost: cost,
                batchId: batch.id,
                user: user
            });
            
            this.saveInventory();
            this.checkMinStock();
            
            return batch;
        };
        
        // Stock out (Xuất kho - FIFO)
        this.stockOut = function(itemId, quantity, reason, user) {
            var inv = this.getInventory(itemId);
            if (!inv || inv.totalStock < quantity) {
                return { success: false, message: 'Không đủ hàng trong kho!' };
            }
            
            var remainingToDeduct = quantity;
            var deductedBatches = [];
            
            // FIFO - First In First Out
            inv.batches.sort((a, b) => new Date(a.stockInDate) - new Date(b.stockInDate));
            
            for (var i = 0; i < inv.batches.length && remainingToDeduct > 0; i++) {
                var batch = inv.batches[i];
                if (batch.remainingQuantity > 0) {
                    var deductFromBatch = Math.min(batch.remainingQuantity, remainingToDeduct);
                    batch.remainingQuantity -= deductFromBatch;
                    remainingToDeduct -= deductFromBatch;
                    
                    deductedBatches.push({
                        batchId: batch.id,
                        quantity: deductFromBatch
                    });
                }
            }
            
            inv.totalStock -= quantity;
            
            // Remove empty batches
            inv.batches = inv.batches.filter(b => b.remainingQuantity > 0);
            
            // Log audit
            AuditService.log('stock_out', {
                itemId: itemId,
                quantity: quantity,
                reason: reason,
                batches: deductedBatches,
                user: user
            });
            
            this.saveInventory();
            this.checkMinStock();
            
            return { success: true, deductedBatches: deductedBatches };
        };
        
        // Adjust stock (Kiểm kho)
        this.adjustStock = function(itemId, newQuantity, reason, user) {
            var inv = this.getInventory(itemId);
            if (!inv) {
                return { success: false, message: 'Item không tồn tại trong kho!' };
            }
            
            var oldQuantity = inv.totalStock;
            var difference = newQuantity - oldQuantity;
            
            inv.totalStock = newQuantity;
            
            // Adjust batches proportionally
            if (inv.batches.length > 0 && newQuantity > 0) {
                var ratio = newQuantity / oldQuantity;
                inv.batches.forEach(batch => {
                    batch.remainingQuantity = Math.floor(batch.remainingQuantity * ratio);
                });
            } else if (newQuantity === 0) {
                inv.batches = [];
            }
            
            // Log audit
            AuditService.log('stock_adjust', {
                itemId: itemId,
                oldQuantity: oldQuantity,
                newQuantity: newQuantity,
                difference: difference,
                reason: reason,
                user: user
            });
            
            this.saveInventory();
            this.checkMinStock();
            
            return { success: true, difference: difference };
        };
        
        // Set min stock warning level
        this.setMinStock = function(itemId, minStock) {
            var inv = this.getInventory(itemId);
            if (inv) {
                inv.minStock = minStock;
                this.saveInventory();
                this.checkMinStock();
            }
        };
        
        // Check min stock and create warnings
        this.checkMinStock = function() {
            minStockWarnings = [];
            
            inventory.forEach(inv => {
                if (inv.totalStock <= inv.minStock) {
                    minStockWarnings.push({
                        itemId: inv.itemId,
                        currentStock: inv.totalStock,
                        minStock: inv.minStock,
                        deficit: inv.minStock - inv.totalStock
                    });
                }
            });
            
            return minStockWarnings;
        };
        
        // Get warnings
        this.getMinStockWarnings = function() {
            return minStockWarnings;
        };
        
        // Get all inventory
        this.getAllInventory = function() {
            if (inventory.length === 0) {
                this.initInventory();
            }
            return inventory;
        };
        
        // Get expired batches
        this.getExpiredBatches = function() {
            var expired = [];
            var now = new Date();
            
            inventory.forEach(inv => {
                inv.batches.forEach(batch => {
                    if (batch.expiryDate && new Date(batch.expiryDate) <= now && batch.remainingQuantity > 0) {
                        expired.push({
                            itemId: inv.itemId,
                            batch: batch
                        });
                    }
                });
            });
            
            return expired;
        };
        
        // Get expiring soon batches (within 7 days)
        this.getExpiringSoonBatches = function() {
            var expiringSoon = [];
            var now = new Date();
            var sevenDaysLater = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
            
            inventory.forEach(inv => {
                inv.batches.forEach(batch => {
                    if (batch.expiryDate) {
                        var expiryDate = new Date(batch.expiryDate);
                        if (expiryDate > now && expiryDate <= sevenDaysLater && batch.remainingQuantity > 0) {
                            expiringSoon.push({
                                itemId: inv.itemId,
                                batch: batch,
                                daysRemaining: Math.ceil((expiryDate - now) / (24 * 60 * 60 * 1000))
                            });
                        }
                    }
                });
            });
            
            return expiringSoon;
        };
        
        this.saveInventory = function() {
            StorageService.set('inventory', inventory);
        };
        
        // Initialize on load
        this.initInventory();
        this.checkMinStock();
    }
]);
