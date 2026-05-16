module.exports = function(app) {
    var StockMove = app.models.StockMove;
    var StockMoveItem = app.models.StockMoveItem;
    var StockItem = app.models.StockItem;
    var Booking = app.models.Booking;
    var Product = app.models.Product;

    // ============================================
    // HELPER: Get Usage Type (PHỔ QUÁT)
    // ============================================
    function getUsageType(product) {
        if (product.inventoryUsageType && product.inventoryUsageType !== 'none') {
            return product.inventoryUsageType;
        }
        // Fallback for legacy field
        if (product.isConsumable) {
            return 'consumable';
        }
        return 'none';
    }

    // ============================================
    // HELPER FUNCTION: Get Session from Time
    // ============================================
    function getSessionFromTime(startTime) {
        if (!startTime) return 'afternoon';

        var date = new Date(startTime);
        var hour = date.getHours();

        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        return 'evening';
    }

    // ============================================
    // REMOTE METHOD 1: Check Inventory by Session (PHỔ QUÁT)
    // ============================================
    // Mô tả: Kiểm tra số lượng hàng còn lại cho một sản phẩm trong một buổi cụ thể
    // Xử lý PHỔ QUÁT cho: consumable, reusable, asset, none
    // Input: productId, date, session (morning/afternoon/evening)
    // Output: { usageType, totalStock?, maxConcurrentUsage?, reserved, available, unit }
    
    StockMove.checkInventoryBySession = function(productId, date, session, callback) {
        if (!productId || !date || !session) {
            return callback(new Error('Missing required parameters: productId, date, session'));
        }

        // Convert date to ISO string format (YYYY-MM-DD)
        var dateObj = new Date(date);
        var dateStr = dateObj.toISOString().split('T')[0];

        // 1. Lấy Product để biết loại quản lý tồn kho
        Product.findById(productId, function(err, product) {
            if (err) return callback(err);
            if (!product) return callback(new Error('Product not found'));

            var usageType = getUsageType(product);

            // 2. Tính tổng reserved cho ngày + buổi này
            StockMove.find({
                where: {
                    type: 'booking-reserve',
                    status: 'completed',
                    bookingDate: dateStr,
                    bookingSession: session
                },
                include: 'items'
            }, function(err, reserveMoves) {
                if (err) return callback(err);

                var reservedQty = 0;
                if (reserveMoves && reserveMoves.length > 0) {
                    reserveMoves.forEach(function(move) {
                        if (move.items && Array.isArray(move.items)) {
                            move.items.forEach(function(item) {
                                if (String(item.productId) === String(productId)) {
                                    reservedQty += (parseFloat(item.quantity) || 0);
                                }
                            });
                        }
                    });
                }

                // 3. XỬ LÝ PHỔ QUÁT THEO TỪNG LOẠI
                if (usageType === 'consumable') {
                    // HÀNG TIÊU HAO: Check tồn kho thực tế từ StockItem
                    StockItem.findOne({
                        where: { productId: productId }
                    }, function(err, stockItem) {
                        if (err) return callback(err);

                        var totalStock = stockItem ? (parseFloat(stockItem.quantity) || 0) : 0;
                        var available = Math.max(0, totalStock - reservedQty);

                        return callback(null, {
                            usageType: 'consumable',
                            totalStock: totalStock,
                            reserved: reservedQty,
                            available: available,
                            unit: product.unit || 'pcs',
                            trackInventory: true
                        });
                    });
                } 
                else if (usageType === 'reusable') {
                    // HÀNG DÙNG LẠI: Check số lượng tối đa đồng thời
                    // KHÔNG đụng tới StockItem.quantity
                    var maxConcurrent = parseFloat(product.maxConcurrentUsage) || 0;
                    var available = Math.max(0, maxConcurrent - reservedQty);

                    return callback(null, {
                        usageType: 'reusable',
                        maxConcurrentUsage: maxConcurrent,
                        reserved: reservedQty,
                        available: available,
                        unit: product.unit || 'pcs',
                        trackInventory: true
                    });
                }
                else if (usageType === 'asset') {
                    // TÀI SẢN: Tương tự reusable nhưng có thể thêm logic tracking riêng
                    var maxConcurrent = parseFloat(product.maxConcurrentUsage) || 1;
                    var available = Math.max(0, maxConcurrent - reservedQty);

                    return callback(null, {
                        usageType: 'asset',
                        maxConcurrentUsage: maxConcurrent,
                        reserved: reservedQty,
                        available: available,
                        unit: product.unit || 'item',
                        requiresSerialTracking: product.requiresSerialTracking || false,
                        trackInventory: true
                    });
                }
                else {
                    // KHÔNG THEO DÕI: Chỉ trả reserved, available = null
                    return callback(null, {
                        usageType: 'none',
                        reserved: reservedQty,
                        available: null,
                        unit: product.unit || 'pcs',
                        trackInventory: false,
                        message: 'Product does not track inventory'
                    });
                }
            });
        });
    };

    // ============================================
    // REMOTE METHOD 2: Reserve Stock for Booking (PHỔ QUÁT)
    // ============================================
    // Mô tả: Giữ hàng cho một booking (tạo StockMove type='booking-reserve')
    // Validation PHỔ QUÁT theo loại hàng
    // Input: bookingId, items [{ productId, quantity, session }]
    // Output: { success: true, reserved: number, moves: [] }
    
    StockMove.reserveStockForBooking = function(bookingId, items, callback) {
        if (!bookingId || !items || !Array.isArray(items) || items.length === 0) {
            return callback(new Error('Invalid parameters: bookingId and items are required'));
        }

        // 0. Xóa các booking-reserve cũ của booking này (tránh duplicate)
        // BƯỚC 1: Tìm tất cả StockMove cần xóa
        // Làm theo cách query warehouseId trong stock-move-item.js
        var bookingIdStr = String(bookingId || '').trim();
        console.log('[BookingInventory] Looking for old StockMove with bookingId:', bookingIdStr);
        
        // Build query đơn giản với OR để tìm cả string và ObjectID format (giống cách query productId)
        var whereClause = {
            bookingId: {
                regexp: bookingIdStr, // Chuỗi pattern, ví dụ: "^BOOK-2025"
                options: 'i'          // (Optional) 'i' để không phân biệt hoa thường
            }
        };


        StockMove.find({
            where: whereClause
        }, function(err, oldMoves) {
            if (err) {
                console.error('[BookingInventory] Error finding old StockMove:', err);
                return callback(err);
            }

            console.log('[BookingInventory] oldMoves:', JSON.stringify(oldMoves, null, 2));
            

            // Filter chỉ lấy những StockMove có type='booking-reserve' (sau khi query)
            var bookingReserveMoves = [];
            if (oldMoves && oldMoves.length > 0) {
                bookingReserveMoves = oldMoves.filter(function(move) {
                    return move.type === 'booking-reserve';
                });
            }

            // Debug: Log tất cả StockMove tìm thấy
            if (bookingReserveMoves && bookingReserveMoves.length > 0) {
                console.log('[BookingInventory] Found', bookingReserveMoves.length, 'old StockMove(s):', 
                    bookingReserveMoves.map(function(m) { 
                        return 'id=' + m.id + ', status=' + m.status + ', bookingId=' + m.bookingId; 
                    }).join('; '));
                processOldMoves(bookingReserveMoves);
            } else {
                console.log('[BookingInventory] No old StockMove found for booking:', bookingIdStr);
                return proceedWithReservation();
            }
        });

        // Helper function để xử lý xóa old moves
        function processOldMoves(oldMoves) {

            console.log('[BookingInventory] Found', oldMoves.length, 'old StockMove(s) to delete for booking:', bookingId);

            // BƯỚC 2: Lấy danh sách IDs của các StockMove
            var stockMoveIds = oldMoves.map(function(move) {
                return String(move.id);
            });

            console.log('[BookingInventory] StockMove IDs to delete:', stockMoveIds);

            // BƯỚC 3: Tìm và xóa tất cả StockMoveItems liên quan TRƯỚC
            // Tìm tất cả StockMoveItems có stockMoveId trong danh sách
            var orConditions = stockMoveIds.map(function(id) {
                return { stockMoveId: id };
            });

            StockMoveItem.find({
                where: {
                    or: orConditions
                }
            }, function(err, itemsToDelete) {
                if (err) return callback(err);

                console.log('[BookingInventory] Found', itemsToDelete ? itemsToDelete.length : 0, 'StockMoveItem(s) to delete');

                if (!itemsToDelete || itemsToDelete.length === 0) {
                    // Không có StockMoveItem nào, tiếp tục xóa StockMove
                    return deleteStockMoves();
                }

                // Xóa từng StockMoveItem
                var deleteItemPromises = itemsToDelete.map(function(item) {
                    return new Promise(function(resolve, reject) {
                        StockMoveItem.destroyById(item.id, function(err) {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                });

                Promise.all(deleteItemPromises)
                    .then(function() {
                        console.log('[BookingInventory] Successfully deleted', itemsToDelete.length, 'StockMoveItem(s)');
                        deleteStockMoves();
                    })
                    .catch(function(err) {
                        console.error('[BookingInventory] Error deleting StockMoveItems:', err);
                        return callback(err);
                    });
            });

            // Helper function để xóa StockMove
            function deleteStockMoves() {
                // BƯỚC 4: Xóa StockMove bằng cách xóa từng cái theo ID (đảm bảo xóa đúng)
                var deleteMovePromises = oldMoves.map(function(move) {
                    return new Promise(function(resolve, reject) {
                        StockMove.destroyById(move.id, function(err) {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                });

                Promise.all(deleteMovePromises)
                    .then(function() {
                        console.log('[BookingInventory] Successfully deleted', oldMoves.length, 'StockMove(s)');
                        proceedWithReservation();
                    })
                    .catch(function(err) {
                        console.error('[BookingInventory] Error deleting StockMove:', err);
                        return callback(err);
                    });
            }
        }

        // Helper function để tiếp tục logic tạo reserve mới
        function proceedWithReservation() {
            // 1. Get booking info
            Booking.findById(bookingId, function(err, booking) {
                if (err) return callback(err);
                if (!booking) return callback(new Error('Booking not found'));

                var dateStr = booking.date ? new Date(booking.date).toISOString().split('T')[0] : null;
                if (!dateStr) return callback(new Error('Booking date is required'));

                // 2. VALIDATE TỪNG ITEM THEO LOẠI (PHỔ QUÁT)
                var validationPromises = items.map(function(item) {
                    return new Promise(function(resolve, reject) {
                        Product.findById(item.productId, function(err, product) {
                            if (err) return reject(err);
                            if (!product) return reject(new Error('Product ' + item.productId + ' not found'));

                            var usageType = getUsageType(product);
                            var itemSession = item.session || getSessionFromTime(booking.startTime || booking.date);

                            // Check availability theo loại
                            StockMove.checkInventoryBySession(
                                item.productId,
                                dateStr,
                                itemSession,
                                function(err, result) {
                                    if (err) return reject(err);

                                    // PHỔ QUÁT: Validate theo usageType
                                    if (usageType === 'consumable' || usageType === 'reusable' || usageType === 'asset') {
                                        if (result.available !== null && result.available < item.quantity) {
                                            return reject(new Error(
                                                'Not enough ' + product.name + 
                                                ' for session ' + itemSession +
                                                ' (available: ' + result.available + 
                                                ', requested: ' + item.quantity + ')'
                                            ));
                                        }
                                    }
                                    // usageType === 'none' không cần validate

                                    resolve({
                                        product: product,
                                        item: item,
                                        usageType: usageType,
                                        session: itemSession
                                    });
                                }
                            );
                        });
                    });
                });

                Promise.all(validationPromises)
                    .then(function(validatedItems) {
                        // 3. Tạo StockMove cho từng session
                        var sessionGroups = {};
                        
                        validatedItems.forEach(function(v) {
                            var session = v.session;
                            if (!sessionGroups[session]) {
                                sessionGroups[session] = [];
                            }
                            sessionGroups[session].push(v);
                        });

                        var createMovePromises = Object.keys(sessionGroups).map(function(session) {
                            return new Promise(function(resolve, reject) {
                                StockMove.create({
                                    type: 'booking-reserve',
                                    status: 'completed',
                                    warehouseId: booking.warehouseId || null,
                                    moveDate: booking.date || new Date(),
                                    bookingId: bookingId,
                                    leadId: booking.leadId || null,
                                    bookingDate: dateStr,
                                    bookingSession: session,
                                    referenceOrderId: bookingId,
                                    referenceOrderType: 'booking',
                                    note: 'Reserve stock for booking #' + bookingId + ' - Session: ' + session
                                }, function(err, move) {
                                    if (err) return reject(err);

                                    // Tạo items cho move này
                                    var itemPromises = sessionGroups[session].map(function(v) {
                                        return new Promise(function(resolve2, reject2) {
                                            StockMoveItem.create({
                                                stockMoveId: move.id,
                                                productId: v.product.id,
                                                name: v.product.name,
                                                quantity: parseFloat(v.item.quantity) || 0,
                                                unit: v.product.unit || 'pcs',
                                                unitPrice: 0,
                                                warehouseId: move.warehouseId,
                                                note: 'Reserved for booking #' + bookingId + ' (' + v.usageType + ')'
                                            }, function(err, item) {
                                                if (err) return reject2(err);
                                                resolve2(item);
                                            });
                                        });
                                    });

                                    Promise.all(itemPromises)
                                        .then(function() { resolve(move); })
                                        .catch(reject);
                                });
                            });
                        });

                        return Promise.all(createMovePromises);
                    })
                    .then(function(moves) {
                        callback(null, {
                            success: true,
                            reserved: moves.length,
                            moves: moves
                        });
                    })
                    .catch(function(err) {
                        callback(err);
                    });
            });
        }
    };

    // ============================================
    // REMOTE METHOD 3: Release Stock for Booking
    // ============================================
    // Mô tả: Trả hàng về kho khi xóa booking (tạo StockMove type='booking-release')
    // Áp dụng cho TẤT CẢ loại hàng
    // Input: bookingId
    // Output: { released: number, releaseMoveId: string }
    
    StockMove.releaseStockForBooking = function(bookingId, callback) {
        if (!bookingId) {
            return callback(new Error('Missing required parameter: bookingId'));
        }

        // Find all StockMove type='booking-reserve' for this booking
        StockMove.find({
            where: {
                type: 'booking-reserve',
                bookingId: bookingId,
                status: 'completed'
            }
        }, function(err, reserveMoves) {
            if (err) return callback(err);

            if (!reserveMoves || reserveMoves.length === 0) {
                return callback(null, { released: 0, message: 'No stock to release' });
            }

            // Get first move for metadata
            var firstMove = reserveMoves[0];
            var totalReleased = 0;

            // Create StockMove type='booking-release'
            var releaseMoveData = {
                type: 'booking-release',
                status: 'completed',
                warehouseId: firstMove.warehouseId,
                moveDate: new Date(),
                bookingId: bookingId,
                leadId: firstMove.leadId,
                bookingDate: firstMove.bookingDate,
                bookingSession: firstMove.bookingSession,
                referenceOrderId: bookingId,
                referenceOrderType: 'booking',
                note: 'Release stock from booking #' + bookingId
            };

            StockMove.create(releaseMoveData, function(err, releaseMove) {
                if (err) return callback(err);

                // Copy StockMoveItems from reserve to release
                var allItemPromises = [];

                reserveMoves.forEach(function(reserveMove) {
                    var itemPromise = new Promise(function(resolve, reject) {
                        StockMoveItem.find({
                            where: { stockMoveId: reserveMove.id }
                        }, function(err, items) {
                            if (err) return reject(err);
                            if (!items || items.length === 0) return resolve([]);

                            var createPromises = items.map(function(item) {
                                return new Promise(function(resolveItem, rejectItem) {
                                    StockMoveItem.create({
                                        stockMoveId: releaseMove.id,
                                        productId: item.productId,
                                        name: item.name,
                                        quantity: item.quantity,
                                        unit: item.unit,
                                        unitPrice: 0,
                                        warehouseId: releaseMove.warehouseId,
                                        note: 'Released from booking #' + bookingId
                                    }, function(err) {
                                        if (err) rejectItem(err);
                                        else {
                                            totalReleased++;
                                            resolveItem();
                                        }
                                    });
                                });
                            });

                            Promise.all(createPromises)
                                .then(function() { resolve(); })
                                .catch(reject);
                        });
                    });

                    allItemPromises.push(itemPromise);
                });

                Promise.all(allItemPromises)
                    .then(function() {
                        callback(null, {
                            released: totalReleased,
                            releaseMoveId: releaseMove.id
                        });
                    })
                    .catch(callback);
            });
        });
    };

    // ============================================
    // REMOTE METHOD 4: Release Stock by Lead
    // ============================================
    // Mô tả: Trả tất cả hàng của một lead (sau khi hoàn thành event)
    // Input: leadId
    // Output: { released: number }
    
    StockMove.releaseStockByLead = function(leadId, callback) {
        if (!leadId) {
            return callback(new Error('Missing required parameter: leadId'));
        }

        // Find all bookings of this lead
        Booking.find({
            where: { leadId: leadId }
        }, function(err, bookings) {
            if (err) return callback(err);

            if (!bookings || bookings.length === 0) {
                return callback(null, { released: 0, message: 'No bookings found for lead' });
            }

            var bookingIds = bookings.map(function(b) { return b.id; });
            var totalReleased = 0;

            // Release stock for each booking
            var releasePromises = bookingIds.map(function(bookingId) {
                return new Promise(function(resolve, reject) {
                    StockMove.releaseStockForBooking(bookingId, function(err, result) {
                        if (err) return reject(err);
                        totalReleased += (result.released || 0);
                        resolve(result);
                    });
                });
            });

            Promise.all(releasePromises)
                .then(function() {
                    callback(null, { released: totalReleased });
                })
                .catch(callback);
        });
    };

    // ============================================
    // REGISTER REMOTE METHODS
    // ============================================
    
    StockMove.remoteMethod('checkInventoryBySession', {
        accepts: [
            { arg: 'productId', type: 'string', required: true },
            { arg: 'date', type: 'date', required: true },
            { arg: 'session', type: 'string', required: true }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/check-inventory-by-session', verb: 'get' },
        description: 'Check inventory availability by product, date and session (handles consumable/reusable/asset/none)'
    });

    StockMove.remoteMethod('reserveStockForBooking', {
        accepts: [
            { arg: 'bookingId', type: 'string', required: true },
            { arg: 'items', type: 'array', required: true }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/reserve-stock-for-booking', verb: 'post' },
        description: 'Reserve stock for a booking with validation for all inventory types'
    });

    StockMove.remoteMethod('releaseStockForBooking', {
        accepts: [
            { arg: 'bookingId', type: 'string', required: true }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/release-stock-for-booking', verb: 'post' },
        description: 'Release reserved stock for a booking (all inventory types)'
    });

    StockMove.remoteMethod('releaseStockByLead', {
        accepts: [
            { arg: 'leadId', type: 'string', required: true }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/release-stock-by-lead', verb: 'post' },
        description: 'Release all reserved stock for all bookings of a lead'
    });

    console.log('[BookingInventory] Remote methods initialized with generalized inventory handling');
};


