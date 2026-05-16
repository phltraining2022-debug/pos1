// Payment Service
angular.module('karaApp').service('PaymentService', ['StorageService', 'AuditService', 'MenuService', 'ApiService', 'RoomService', 'SyncService',
    function(StorageService, AuditService, MenuService, ApiService, RoomService, SyncService) {
        var bills = [];
        var priceConfigs = [];
        
        this.initPriceConfig = function() {
            priceConfigs = StorageService.get('priceConfigs') || [
                // Room pricing by time blocks
                {
                    id: 1,
                    roomType: 'small',
                    timeSlot: 'morning', // 6am-12pm
                    blockMinutes: 30,
                    pricePerBlock: 50000,
                    startHour: 6,
                    endHour: 12
                },
                {
                    id: 2,
                    roomType: 'small',
                    timeSlot: 'afternoon', // 12pm-6pm
                    blockMinutes: 30,
                    pricePerBlock: 80000,
                    startHour: 12,
                    endHour: 18
                },
                {
                    id: 3,
                    roomType: 'small',
                    timeSlot: 'evening', // 6pm-12am
                    blockMinutes: 30,
                    pricePerBlock: 100000,
                    startHour: 18,
                    endHour: 24
                },
                {
                    id: 4,
                    roomType: 'medium',
                    timeSlot: 'morning',
                    blockMinutes: 30,
                    pricePerBlock: 80000,
                    startHour: 6,
                    endHour: 12
                },
                {
                    id: 5,
                    roomType: 'medium',
                    timeSlot: 'afternoon',
                    blockMinutes: 30,
                    pricePerBlock: 120000,
                    startHour: 12,
                    endHour: 18
                },
                {
                    id: 6,
                    roomType: 'medium',
                    timeSlot: 'evening',
                    blockMinutes: 30,
                    pricePerBlock: 150000,
                    startHour: 18,
                    endHour: 24
                },
                {
                    id: 7,
                    roomType: 'large',
                    timeSlot: 'morning',
                    blockMinutes: 30,
                    pricePerBlock: 120000,
                    startHour: 6,
                    endHour: 12
                },
                {
                    id: 8,
                    roomType: 'large',
                    timeSlot: 'afternoon',
                    blockMinutes: 30,
                    pricePerBlock: 180000,
                    startHour: 12,
                    endHour: 18
                },
                {
                    id: 9,
                    roomType: 'large',
                    timeSlot: 'evening',
                    blockMinutes: 30,
                    pricePerBlock: 220000,
                    startHour: 18,
                    endHour: 24
                }
            ];
            return priceConfigs;
        };
        
        this.calculateRoomCharge = function(roomType, startTime, endTime) {
            if (!endTime) endTime = new Date();
            
            var start = new Date(startTime);
            var end = new Date(endTime);
            var totalMinutes = Math.ceil((end - start) / (1000 * 60));
            var totalCharge = 0;
            var details = [];
            
            // Get applicable price config based on time
            var currentTime = new Date(start);
            while (currentTime < end) {
                var hour = currentTime.getHours();
                var config = priceConfigs.find(c => 
                    c.roomType === roomType && 
                    hour >= c.startHour && 
                    hour < c.endHour
                );
                
                if (config) {
                    var blockCharge = config.pricePerBlock;
                    var blocks = Math.ceil(config.blockMinutes / config.blockMinutes);
                    totalCharge += blockCharge;
                    
                    details.push({
                        timeSlot: config.timeSlot,
                        blocks: 1,
                        pricePerBlock: blockCharge,
                        subtotal: blockCharge
                    });
                    
                    currentTime = new Date(currentTime.getTime() + config.blockMinutes * 60 * 1000);
                } else {
                    // Default pricing if no config found
                    currentTime = new Date(currentTime.getTime() + 30 * 60 * 1000);
                }
            }
            
            return {
                totalMinutes: totalMinutes,
                totalCharge: totalCharge,
                details: details
            };
        };
        
        
        this.createBill = function(billId, roomId, roomType, startTime, orders) {
            var endTime = new Date();
            var roomCharge = this.calculateRoomCharge(roomType, startTime);
            var foodTotal = orders.reduce((sum, order) => sum + order.totalAmount, 0);
            
            var bill = {
                id: billId,
                roomId: roomId,
                roomType: roomType,
                startTime: startTime,
                endTime: endTime,
                roomCharge: roomCharge.totalCharge,
                roomChargeDetails: roomCharge.details,
                orders: orders,
                foodTotal: foodTotal,
                subtotal: roomCharge.totalCharge + foodTotal,
                discount: 0,
                tax: 0,
                total: roomCharge.totalCharge + foodTotal,
                status: 'unpaid',
                createdAt: new Date(),
                syncStatus: 'pending' // Thêm để sync lên server
            };
            
            return bill;
        };
        
        this.applyDiscount = function(bill, discountAmount, reason, appliedBy) {
            bill.discount = discountAmount;
            bill.total = bill.subtotal - discountAmount + bill.tax;
            bill.discountReason = reason;
            bill.discountAppliedBy = appliedBy;
            
            // Log audit
            AuditService.log('discount_applied', appliedBy, 
                'Discount applied to bill ' + bill.id + '. Amount: ' + discountAmount + '. Reason: ' + reason,
                { billId: bill.id, discount: discountAmount, reason: reason });
            
            return bill;
        };
        
        this.processPayment = function(bill, paymentMethod, paidBy) {
            // 1. Update bill locally first
            bill.status = 'paid';
            bill.paymentMethod = paymentMethod; // cash, transfer, qr
            bill.paidAt = new Date();
            bill.paidBy = paidBy;
            
            // Deduct BOM items from inventory for combos
            this.deductBOMInventory(bill.orders);
            
            bills.push(bill);
            this.saveBills();
            
            // 2. Log audit
            AuditService.log('payment_completed', paidBy, 
                'Payment completed for bill ' + bill.id + '. Method: ' + paymentMethod + '. Total: ' + bill.total,
                bill);
            
            // 3. Create Invoice and queue to server
            var room = RoomService.getRoom(bill.roomId);
            if (room && room.saleOrderId) {
                var saleOrderId = room.saleOrderId;
                
                // Get items from local storage first
                var saleOrderItems = StorageService.get('saleorderitems') || [];
                var orderItems = saleOrderItems.filter(function(item) {
                    return item.saleOrderId === saleOrderId;
                });
                
                if (orderItems && orderItems.length > 0) {
                    var invoiceData = {
                        invoiceNumber: bill.id,
                        invoiceDate: bill.createdAt || new Date(),
                        customerId: '69560638fb714a3aabb94714', // Default walk-in customer
                        roomId: bill.roomId,
                        createdById: bill.createdBy,
                        processedById: bill.processedBy || bill.createdBy,
                        totalAmount: bill.total,
                        status: 'paid',
                        paidAmount: bill.total,
                        remainingAmount: 0,
                        items: orderItems.map(function(item) {
                            return {
                                productId: item.productId,
                                name: item.name,
                                quantity: item.quantity,
                                price: item.unitPrice,
                                total: item.subtotal || (item.quantity * item.unitPrice),
                                note: item.note || ''
                            };
                        }),
                        relatedProductIds: orderItems.map(function(item) {
                            return item.productId;
                        }),
                        note: bill.note || '',
                        createdAt: bill.createdAt || new Date(),
                        updatedAt: new Date()
                    };
                    
                    // Queue invoice creation
                    SyncService.addToQueue('create', 'invoices', invoiceData, {
                        onSuccess: function(serverInvoice) {
                            console.log('✓ Invoice created:', serverInvoice.id);
                            bill.invoiceId = serverInvoice.id;
                            bill.syncStatus = 'synced';
                            StorageService.set('bills', bills);
                        },
                        onError: function(error) {
                            console.warn('⚠ Failed to create Invoice:', error);
                        }
                    });
                    
                    // Queue SaleOrder update
                    SyncService.addToQueue('update', 'saleorders', {
                        id: saleOrderId,
                        status: 'completed',
                        paidAmount: bill.total,
                        updatedAt: new Date()
                    });
                }
            }
            
            return bill;
        };
        
        this.splitBill = function(originalBill, itemsToSplit, reason, splitBy) {
            // Create new bill with split items
            var newBillId = 'BILL-' + Date.now();
            var splitOrders = itemsToSplit.map(item => ({
                id: 'ORD-' + Date.now() + '-' + item.itemId,
                items: [item],
                totalAmount: item.quantity * item.price
            }));
            
            var splitTotal = splitOrders.reduce((sum, o) => sum + o.totalAmount, 0);
            
            var newBill = {
                id: newBillId,
                roomId: originalBill.roomId,
                splitFrom: originalBill.id,
                roomCharge: 0,
                orders: splitOrders,
                foodTotal: splitTotal,
                subtotal: splitTotal,
                discount: 0,
                tax: 0,
                total: splitTotal,
                status: 'unpaid',
                splitReason: reason,
                splitBy: splitBy,
                createdAt: new Date()
            };
            
            // Update original bill
            originalBill.foodTotal -= splitTotal;
            originalBill.subtotal = originalBill.roomCharge + originalBill.foodTotal;
            originalBill.total = originalBill.subtotal - originalBill.discount + originalBill.tax;
            
            // Log audit
            AuditService.log('bill_split', splitBy, 
                'Bill split. Original: ' + originalBill.id + ', New: ' + newBillId + '. Reason: ' + reason,
                { originalBill: originalBill.id, newBill: newBillId, splitAmount: splitTotal, reason: reason });
            
            return { originalBill: originalBill, newBill: newBill };
        };
        
        this.mergeBills = function(bill1, bill2, mergedBy) {
            var mergedBill = {
                id: 'BILL-' + Date.now(),
                roomId: bill1.roomId,
                mergedFrom: [bill1.id, bill2.id],
                roomCharge: bill1.roomCharge + bill2.roomCharge,
                orders: bill1.orders.concat(bill2.orders),
                foodTotal: bill1.foodTotal + bill2.foodTotal,
                subtotal: bill1.subtotal + bill2.subtotal,
                discount: bill1.discount + bill2.discount,
                tax: bill1.tax + bill2.tax,
                total: bill1.total + bill2.total,
                status: 'unpaid',
                mergedBy: mergedBy,
                createdAt: new Date()
            };
            
            // Mark old bills as merged
            bill1.status = 'merged';
            bill2.status = 'merged';
            
            // Log audit
            AuditService.log('bills_merged', mergedBy, 
                'Bills merged: ' + bill1.id + ' + ' + bill2.id + ' → ' + mergedBill.id,
                { bill1: bill1.id, bill2: bill2.id, mergedBill: mergedBill.id });
            
            return mergedBill;
        };
        
        this.updateStartTime = function(bill, newStartTime, reason, updatedBy) {
            var oldStartTime = bill.startTime;
            bill.startTime = newStartTime;
            
            // Recalculate room charge
            var roomCharge = this.calculateRoomCharge(bill.roomType, newStartTime, bill.endTime);
            bill.roomCharge = roomCharge.totalCharge;
            bill.roomChargeDetails = roomCharge.details;
            bill.subtotal = bill.roomCharge + bill.foodTotal;
            bill.total = bill.subtotal - bill.discount + bill.tax;
            
            // Log audit
            AuditService.log('start_time_changed', updatedBy, 
                'Start time changed for bill ' + bill.id + '. Reason: ' + reason,
                { billId: bill.id, oldStartTime: oldStartTime, newStartTime: newStartTime, reason: reason });
            
            return bill;
        };
        
        this.saveBills = function() {
            StorageService.set('bills', bills);
        };
        
        this.getBills = function(skipDemoData) {
            if (bills.length === 0) {
                var savedBills = StorageService.get('bills');
                if (savedBills && savedBills.length > 0) {
                    bills = savedBills;
                } else if (!skipDemoData) {
                    // Initialize with demo data only if not skipping
                    bills = this.getInitialDemoBills();
                    this.saveBills();
                } else {
                    bills = [];
                }
            }
            return bills;
        };
        
        // Demo bills for initial setup
        this.getInitialDemoBills = function() {
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            return [
                // Bill 1: Completed bill from yesterday
                {
                    id: 'BILL-001',
                    roomId: 1,
                    roomType: 'small',
                    startTime: new Date(today.getTime() - 24*60*60*1000 + 14*60*60*1000), // Yesterday 2PM
                    endTime: new Date(today.getTime() - 24*60*60*1000 + 16*60*60*1000), // Yesterday 4PM
                    roomCharge: 320000, // 4 blocks × 80k
                    roomChargeDetails: [],
                    orders: [
                        {
                            id: 'ORD-001',
                            items: [
                                { itemId: 1, name: 'Heineken', price: 30000, quantity: 6, unit: 'lon' },
                                { itemId: 9, name: 'Khô bò', price: 80000, quantity: 1, unit: 'đĩa' },
                                { itemId: 12, name: 'Dưa hấu', price: 60000, quantity: 1, unit: 'đĩa' }
                            ],
                            totalAmount: 320000
                        }
                    ],
                    foodTotal: 320000,
                    subtotal: 640000,
                    discount: 0,
                    tax: 0,
                    total: 640000,
                    status: 'paid',
                    paymentMethod: 'cash',
                    paidAt: new Date(today.getTime() - 24*60*60*1000 + 16*60*60*1000),
                    paidBy: 'admin',
                    createdAt: new Date(today.getTime() - 24*60*60*1000 + 14*60*60*1000)
                },
                
                // Bill 2: Completed bill with surcharge (late night)
                {
                    id: 'BILL-002',
                    roomId: 3,
                    roomType: 'large',
                    startTime: new Date(today.getTime() - 24*60*60*1000 + 22*60*60*1000), // Yesterday 10PM
                    endTime: new Date(today.getTime() - 24*60*60*1000 + 24*60*60*1000), // Yesterday 12AM
                    roomCharge: 600000, // 4 blocks × 150k (large room evening)
                    roomChargeDetails: [],
                    orders: [
                        {
                            id: 'ORD-002',
                            items: [
                                { itemId: 1, name: 'Heineken', price: 30000, quantity: 10, unit: 'lon' },
                                { itemId: 2, name: 'Tiger', price: 28000, quantity: 10, unit: 'lon' },
                                { itemId: 9, name: 'Khô bò', price: 80000, quantity: 2, unit: 'đĩa' },
                                { itemId: 11, name: 'Mực nướng', price: 90000, quantity: 1, unit: 'đĩa' },
                                { itemId: 100, name: 'Phụ thu giờ khuya', price: 100000, quantity: 4, unit: 'block', isSurcharge: true }
                            ],
                            totalAmount: 1030000
                        }
                    ],
                    foodTotal: 1030000,
                    subtotal: 1630000,
                    discount: 50000,
                    tax: 0,
                    total: 1580000,
                    status: 'paid',
                    paymentMethod: 'transfer',
                    paidAt: new Date(today.getTime() - 24*60*60*1000 + 24*60*60*1000),
                    paidBy: 'admin',
                    discountReason: 'Khách quen',
                    discountAppliedBy: 'admin',
                    createdAt: new Date(today.getTime() - 24*60*60*1000 + 22*60*60*1000)
                },
                
                // Bill 3: Today morning completed
                {
                    id: 'BILL-003',
                    roomId: 2,
                    roomType: 'medium',
                    startTime: new Date(today.getTime() + 8*60*60*1000), // Today 8AM
                    endTime: new Date(today.getTime() + 10*60*60*1000), // Today 10AM
                    roomCharge: 240000, // 4 blocks × 60k (medium morning)
                    roomChargeDetails: [],
                    orders: [
                        {
                            id: 'ORD-003',
                            items: [
                                { itemId: 5, name: 'Coca Cola', price: 15000, quantity: 4, unit: 'lon' },
                                { itemId: 7, name: 'Sting', price: 12000, quantity: 4, unit: 'lon' },
                                { itemId: 13, name: 'Dứa', price: 50000, quantity: 2, unit: 'đĩa' }
                            ],
                            totalAmount: 208000
                        }
                    ],
                    foodTotal: 208000,
                    subtotal: 448000,
                    discount: 0,
                    tax: 0,
                    total: 448000,
                    status: 'paid',
                    paymentMethod: 'qr',
                    paidAt: new Date(today.getTime() + 10*60*60*1000),
                    paidBy: 'admin',
                    createdAt: new Date(today.getTime() + 8*60*60*1000)
                },
                
                // Bill 4: Combo bill
                {
                    id: 'BILL-004',
                    roomId: 4,
                    roomType: 'medium',
                    startTime: new Date(today.getTime() + 13*60*60*1000), // Today 1PM
                    endTime: new Date(today.getTime() + 15*60*60*1000), // Today 3PM
                    roomCharge: 320000, // 4 blocks × 80k
                    roomChargeDetails: [],
                    orders: [
                        {
                            id: 'ORD-004',
                            items: [
                                { itemId: 15, name: 'Combo VIP', price: 500000, quantity: 1, unit: 'set', isCombo: true },
                                { itemId: 5, name: 'Coca Cola', price: 15000, quantity: 2, unit: 'lon' }
                            ],
                            totalAmount: 530000
                        }
                    ],
                    foodTotal: 530000,
                    subtotal: 850000,
                    discount: 0,
                    tax: 0,
                    total: 850000,
                    status: 'paid',
                    paymentMethod: 'cash',
                    paidAt: new Date(today.getTime() + 15*60*60*1000),
                    paidBy: 'admin',
                    createdAt: new Date(today.getTime() + 13*60*60*1000)
                },
                
                // Bill 5: Weekend surcharge
                {
                    id: 'BILL-005',
                    roomId: 5,
                    roomType: 'large',
                    startTime: new Date(today.getTime() - 2*24*60*60*1000 + 19*60*60*1000), // 2 days ago 7PM (weekend)
                    endTime: new Date(today.getTime() - 2*24*60*60*1000 + 22*60*60*1000), // 2 days ago 10PM
                    roomCharge: 900000, // 6 blocks × 150k
                    roomChargeDetails: [],
                    orders: [
                        {
                            id: 'ORD-005',
                            items: [
                                { itemId: 1, name: 'Heineken', price: 30000, quantity: 12, unit: 'lon' },
                                { itemId: 4, name: 'Budweiser', price: 32000, quantity: 6, unit: 'lon' },
                                { itemId: 9, name: 'Khô bò', price: 80000, quantity: 2, unit: 'đĩa' },
                                { itemId: 10, name: 'Khô gà lá chanh', price: 70000, quantity: 2, unit: 'đĩa' },
                                { itemId: 11, name: 'Mực nướng', price: 90000, quantity: 2, unit: 'đĩa' },
                                { itemId: 101, name: 'Phụ thu cuối tuần', price: 50000, quantity: 6, unit: 'block', isSurcharge: true }
                            ],
                            totalAmount: 1212000
                        }
                    ],
                    foodTotal: 1212000,
                    subtotal: 2112000,
                    discount: 100000,
                    tax: 0,
                    total: 2012000,
                    status: 'paid',
                    paymentMethod: 'transfer',
                    paidAt: new Date(today.getTime() - 2*24*60*60*1000 + 22*60*60*1000),
                    paidBy: 'admin',
                    discountReason: 'Khách VIP',
                    discountAppliedBy: 'admin',
                    createdAt: new Date(today.getTime() - 2*24*60*60*1000 + 19*60*60*1000)
                }
            ];
        };
        
        // Adjustment bills (refund/cancellation)
        var adjustmentBills = [];
        
        this.createAdjustmentBill = function(adjustmentBill) {
            adjustmentBills.push(adjustmentBill);
            StorageService.set('adjustmentBills', adjustmentBills);
            
            // Log audit
            AuditService.log('adjustment_bill_created', adjustmentBill.createdBy,
                'Adjustment bill created: ' + adjustmentBill.id + ' for original bill: ' + adjustmentBill.originalBillId,
                adjustmentBill);
            
            return adjustmentBill;
        };
        
        this.getAdjustmentBills = function() {
            if (adjustmentBills.length === 0) {
                adjustmentBills = StorageService.get('adjustmentBills') || [];
            }
            return adjustmentBills;
        };
        
        this.getAdjustmentsByBill = function(billId, serverId) {
            var allAdjustments = this.getAdjustmentBills();
            return allAdjustments.filter(function(adj) {
                // Match by local invoiceNumber (originalBillId) or by MongoDB _id (originalInvoiceId)
                return adj.originalBillId === billId ||
                       (serverId && adj.originalInvoiceId === serverId);
            });
        };
        
        // Deduct BOM inventory when selling combos
        this.deductBOMInventory = function(orders) {
            if (!orders || orders.length === 0) return;
            
            orders.forEach(function(order) {
                if (!order.items) return;
                
                order.items.forEach(function(item) {
                    // Find the menu item to check if it has BOM
                    var menuItem = MenuService.getItem(item.itemId);
                    if (!menuItem || !menuItem.bomItems || menuItem.bomItems.length === 0) {
                        return;
                    }
                    
                    // Deduct each BOM component from inventory
                    menuItem.bomItems.forEach(function(bomItem) {
                        var component = MenuService.getItem(bomItem.itemId);
                        if (component) {
                            var deductQty = bomItem.quantity * item.quantity;
                            component.stock -= deductQty;
                            
                            if (component.stock < 0) component.stock = 0;
                            
                            console.log('Deducted BOM item:', {
                                component: component.name,
                                quantity: deductQty,
                                remainingStock: component.stock
                            });
                        }
                    });
                });
            });
            
            // Save menu to persist inventory changes
            MenuService.saveMenu();
        };
        
        // Fetch bills from server
        this.getServerBills = function(skip) {
            var filter = {
                limit: 100,
                order: 'createdAt DESC',
                include: 'adjustments'
            };
            if (skip) {
                filter.skip = skip;
            }
            return ApiService.getAll('Invoices', filter).then(function(serverInvoices) {
                console.log('📥 Fetched', serverInvoices.length, 'bills from server');
                return serverInvoices.reduce(function(acc, invoice) {
                    acc.push(mapServerInvoice(invoice));
                    // Include embedded adjustments returned by LoopBack 'include'
                    if (Array.isArray(invoice.adjustments)) {
                        invoice.adjustments.forEach(function(adj) {
                            acc.push(mapServerInvoice(adj));
                        });
                    }
                    return acc;
                }, []);
            });
        };

        function mapServerInvoice(invoice) {
            return {
                        id: invoice.invoiceNumber || invoice.id,
                        roomId: invoice.roomId,
                        roomType: invoice.roomType || 'unknown',
                        startTime: invoice.startTime ? new Date(invoice.startTime) : null,
                        endTime: invoice.endTime ? new Date(invoice.endTime) : null,
                        roomCharge: invoice.roomCharge || 0,
                        roomChargeDetails: invoice.roomChargeDetails || [],
                        orders: invoice.items ? [{
                            id: 'ORD-' + invoice.id,
                            items: invoice.items.map(function(item) {
                                var mapped = {
                                    itemId: item.productId,
                                    name: item.name,
                                    price: item.price,
                                    quantity: item.quantity,
                                    unit: item.unit || 'pcs',
                                    total: item.total,
                                    note: item.note || '',
                                    isTimeBased: item.isTimeBased || false,
                                    isSurcharge: item.isSurcharge || false
                                };
                                if (item.startTime) mapped.startTime = new Date(item.startTime);
                                return mapped;
                            }),
                            totalAmount: invoice.items.reduce((sum, item) => sum + item.total, 0)
                        }] : [],
                        foodTotal: (invoice.foodTotal > 0)
                            ? invoice.foodTotal
                            : (invoice.items
                                ? invoice.items.filter(function(i) { return !i.isTimeBased && !i.isSurcharge; }).reduce((sum, item) => sum + item.total, 0)
                                : 0),
                        subtotal: invoice.subtotal || invoice.totalAmount,
                        discount: invoice.discount || 0,
                        tax: invoice.tax || 0,
                        total: invoice.totalAmount,
                        status: invoice.status || 'unpaid',
                        paymentMethod: invoice.paymentMethod || 'cash',
                        paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
                        paidBy: invoice.cashierName || invoice.processedById,
                        cashierName: invoice.cashierName || invoice.processedById,
                        createdAt: new Date(invoice.createdAt),
                        invoiceId: invoice.id,
                        syncStatus: 'synced', // Server data is already synced
                        source: 'server',
                        // Adjustment fields (invoice.json model)
                        isAdjustment: invoice.isAdjustment || false,
                        originalInvoiceId: invoice.originalInvoiceId || null,
                        adjustmentType: invoice.adjustmentType || null,
                        adjustmentReason: invoice.adjustmentReason || null,
                        type: invoice.isAdjustment ? 'adjustment' : (invoice.type || 'normal')
            };
        }

        // Initialize on service load
        this.initPriceConfig();
    }
]);
