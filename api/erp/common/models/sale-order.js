
var _ = require('lodash');
var moment = require('moment');
var app = require('../../server/server');
var LoopBackContext = require('loopback-context');

function getCurrentUserId(ctx) {
    if (ctx && ctx.options && ctx.options.accessToken && ctx.options.accessToken.userId) {
        return String(ctx.options.accessToken.userId);
    }

    var lbCtx = LoopBackContext.getCurrentContext();
    if (!lbCtx) return null;

    var currentUser = lbCtx.get('currentUser');
    var currentUserId = lbCtx.get('currentUserId') || (currentUser && currentUser.id);
    return currentUserId ? String(currentUserId) : null;
}

module.exports = function (AppModel) {

    AppModel.observe('before save', function stampActor(ctx, next) {
        var inst = ctx.instance || ctx.data;
        if (!inst) return next();

        var currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) return next();

        inst.updatedById = currentUserId;
        if (ctx.isNewInstance) {
            if (!inst.createdById) inst.createdById = currentUserId;
            if (!inst.executedById) inst.executedById = currentUserId;
        }

        next();
    });

    AppModel.estimateMaterials = function (saleOrderId, cb) {
        var SaleOrder = app.models.SaleOrder;

        SaleOrder.findById(saleOrderId, {
        }, (err, saleOrder) => {
            if (err) {
                console.error(err);
                cb(err, null);
                // Handle error
            } else {
                if (saleOrder) {
                    var so = JSON.parse(JSON.stringify(saleOrder));


                    let productItems = [];
                    let materialItems = [];
                    let getProductItems = function (orderItems, items) {
                        orderItems && orderItems.forEach(i => {
                            i && i.product && i.product.boms && i.product.boms.forEach(b => {
                                b.components && b.components.forEach(c => {
                                    items.push({
                                        quantity: i.quantity * c.quantity,
                                        product: c.product
                                    });
                                });
                            });
                        });
                    };

                    let getMaterialItems = function (productItems, items) {
                        productItems.forEach(i => {
                            i.product && i.product.boms && i.product.boms.forEach(b => {
                                b.components && b.components.forEach(c => {
                                    items.push({
                                        quantity: c.quantity * i.quantity, product: c.product
                                    });
                                });
                            });
                        });
                    };

                    getProductItems(so.banquetItems, productItems);
                    getMaterialItems(productItems, materialItems);

                    console.log("productItems ", productItems);
                    console.log("materialItems ", materialItems);
                    let groupedMaterialItems = _.groupBy(materialItems, "product.id");
                    console.log("group2  ", groupedMaterialItems);

                    let deliveryDate = moment(so.deliveryDate).add(-1, "days").format("DD/MM/YYYY");
                    so.materialItems = Object.keys(groupedMaterialItems).map(e => {
                        let i = groupedMaterialItems[e];
                        return {
                            product: i[0].product, deliveryDate: deliveryDate,
                            quantity: _.sum(_.pluck(i, 'quantity')).toFixed(2)  //_.sumBy(i, "quantity").toFixed(2)
                        };
                    });
                    so.materialItems = _.groupBy(so.materialItems, "product.subCategory.name");

                    so.materialItemsByDish = {};
                    productItems.forEach(p => {
                        var items = [];
                        if (p.product) {
                            so.materialItemsByDish[p.product.name] = items;
                            getMaterialItems([p], items);
                        }
                    });

                }

                cb(null, so);
            }
        });
    };

    AppModel.remoteMethod('estimateMaterials', {
        accepts: [
            { arg: 'saleOrderId', type: 'string', required: true },
        ],
        returns: { arg: 'materials', type: 'object', root: true },
        http: { verb: 'get', path: '/estimate-materials' },
    });

    // create a post method to clone a sale order from type "quotation" to "order"
    AppModel.clone = function (saleOrderId, cb) {
        var SaleOrder = app.models.SaleOrder;
        var SaleOrderItem = app.models.SaleOrderItem;
        // find the sale order include "items", create a new sale order with a clone of items 
        SaleOrder.findById(saleOrderId, 
            {
                include: "items"
            }, (err, saleOrder) => {
                if (err) {
                    console.error(err);
                    cb(err, null);
                    // Handle error
                } else {
                    if (saleOrder) {
                        var so = JSON.parse(JSON.stringify(saleOrder));
                        so.id = null;
                        so.type = "quotation";
                        so.quoteForSaleOrderId = saleOrderId;

                        SaleOrder.create(so, (err, newSo) => {
                            if (err) {
                                console.error(err);
                                cb(err, null);
                            } else {
                                so.items = so.items.map(i => {
                                    i.id = null;
                                    i.saleOrderId = newSo.id;
                                    return i;
                                });
                                // create so.items 
                                SaleOrderItem.create(so.items, (err, newItems) => {
                                    if (err) {
                                        console.error(err);
                                        cb(err, null);
                                    } else {
                                        so.items = newItems;
                                    }
                                });

                                cb(null, newSo);
                            }
                        });

                    } else {
                        cb(null, null);
                    }
                }
            });
    }

    AppModel.remoteMethod('clone', {
        accepts: [
            { arg: 'saleOrderId', type: 'string', required: true },
        ],
        returns: { arg: 'saleOrder', type: 'object', root: true },
        http: { verb: 'post', path: '/clone' },
    });


    
    const SaleOrderItem = app.models.SaleOrderItem;
    const Product = app.models.Product;
    // const SaleOrder = app.models.SaleOrder;

    // Function to generate the unique code
    async function generateSaleOrderCode() {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2); // 2-digit year
        const month = String(now.getMonth() + 1).padStart(2, '0'); // 2-digit month
        const prefix = `${year}${month}`; // Generate prefix
    
        const rangeStart = `${prefix}00000`; // e.g., 241200000
        const rangeEnd = `${prefix}99999`;  // e.g., 241299999
    
        console.log(`Querying for range: ${rangeStart} to ${rangeEnd}`);
    
        // Query the database for the highest code in the range
        const maxSaleOrder = await AppModel.findOne({
            where: {
                code: { gte: rangeStart, lte: rangeEnd },
            },
            order: 'code DESC', // Ensure descending order to fetch the highest code
            fields: { code: true },
        });
    
        console.log('Max Sale Order Found:', maxSaleOrder);
    
        let number;
    
        if (maxSaleOrder && maxSaleOrder.code) {
            const currentCode = maxSaleOrder.code;
            console.log('Current Max Code:', currentCode);
    
            // Parse the entire code and increment by 1
            const lastNumber = parseInt(currentCode, 10); // Parse the full code
            console.log('Last Number:', lastNumber);
    
            if (!isNaN(lastNumber)) {
                number = String(lastNumber + 1); // Increment the number
            } else {
                number = `${prefix}00001`; // Default to xxxx00001
            }
        } else {
            number = `${prefix}00001`; // Default to xxxx00001 if no matching code found
        }
    
        console.log('Generated Code:', number);
        return number;
    }
    
    
    
    

    // Remote Method for Submit Order
    AppModel.submitOrder = async function (data, req, callback) {
        // we need to get access token to get the user id
        

        // try {
        //     const { total, email, phone, fullName, items, shippingAddress } = data;

        //     if (!items || !items.length) {
        //         return callback(new Error('Items are required to create an order.'));
        //     }

        //     // Generate the unique code
        //     const code = await generateSaleOrderCode();

            
        //     // Step 1: Create SaleOrder
        //     var saleOrder = await AppModel.create({
        //         code, // Auto-generated code
        //         email,
        //         phone,
        //         fullName,
        //         status: 'pending',
        //         shippingAddress,
        //     });

            

        //     const Product = app.models.Product;

        //     // Step 2: Map Items and Retrieve Product IDs by serialNo
        //     const itemsWithDetails = await Promise.all(
        //         items.map(async (item) => {
        //             const product = await Product.findOne({ where: { serialNo: item.id } });
        //             if (!product) throw new Error(`Product not found for serialNo: ${item.id}`);

        //             return {
        //                 productId: product.id,
        //                 saleOrderId: saleOrder.id,
        //                 quantity: item.quantity || 1,
        //                 unitPrice: product.price || 0,
        //                 subtotal: (product.price || 0) * (item.quantity || 1),
        //                 discount: item.discount || 0,
        //             };
        //         })
        //     );

        //     var authorization = req.headers.authorization;
        //     if (authorization)   {
        //         var token = await app.models.AccessToken.findById(authorization);
        //         if (token) {
        //             saleOrder.customerId = token.userId;
        //         }
        //     }
           

        //     // calculate total 
        //     saleOrder.total = itemsWithDetails.reduce((acc, item) => acc + item.subtotal, 0);
        //     await saleOrder.save();

        //     const SaleOrderItem = app.models.SaleOrderItem;
            
        //     // Step 3: Create SaleOrderItems
        //     await SaleOrderItem.create(itemsWithDetails);

        //     // Step 4: Return Response
        //     return { success: true, message: 'Order submitted successfully', saleOrder };
        // } catch (error) {
        //     callback(error);
        // }

        try {
        const { 
            total, 
            email, 
            phone, 
            fullName, 
            items, 
            shippingAddress,
            originalTotal,
            voucherCode,
            voucherDiscount,
            voucherInfo
        } = data;

        if (!items || !items.length) {
            return callback(new Error('Items are required to create an order.'));
        }

        // Generate the unique code
        const code = await generateSaleOrderCode();

        
        // Step 1: Create SaleOrder
        var saleOrder = await AppModel.create({
            code, // Auto-generated code
            email,
            phone,
            fullName,
            status: 'pending',
            shippingAddress,
            total: total || 0, // Use the total from frontend (already calculated with discount)
            originalTotal: originalTotal || total, // Original total before discount
            voucherCode: voucherCode || null,
            voucherDiscount: voucherDiscount || 0,
            voucherInfo: voucherInfo ? voucherInfo : null, // Store as JSON string
        });

        

        const Product = app.models.Product;

        // Step 2: Map Items and Retrieve Product IDs by serialNo
        const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
                const product = await Product.findOne({ where: { serialNo: item.id } });
                if (!product) throw new Error(`Product not found for serialNo: ${item.id}`);

                return {
                    productId: product.id,
                    saleOrderId: saleOrder.id,
                    quantity: item.quantity || 1,
                    unitPrice: product.price || 0,
                    subtotal: (product.price || 0) * (item.quantity || 1),
                    discount: item.discount || 0,
                };
            })
        );

        var authorization = req.headers.authorization;
        if (authorization)   {
            var token = await app.models.AccessToken.findById(authorization);
            if (token) {
                saleOrder.customerId = token.userId;
            }
        }
       

        // If total is not provided from frontend, calculate it
        if (!total) {
            saleOrder.total = itemsWithDetails.reduce((acc, item) => acc + item.subtotal, 0);
        }
        
        // If originalTotal is not provided, use calculated total
        if (!originalTotal) {
            saleOrder.originalTotal = saleOrder.total;
        }
        
        await saleOrder.save();

        const SaleOrderItem = app.models.SaleOrderItem;
        
        // Step 3: Create SaleOrderItems
        await SaleOrderItem.create(itemsWithDetails);

        // Step 4: If voucher was used, update usage count
        if (voucherCode && voucherInfo) {
            try {
                const Promotion = app.models.Promotion;
                const promotion = await Promotion.findOne({
                    where: { id: voucherInfo.promotionId || voucherInfo.id },
                    include: ['promoCodes']
                });
                
                if (promotion && promotion.promoCodes) {
                    const promoCode = promotion.promoCodes.find(pc => pc.code === voucherCode);
                    if (promoCode) {
                        // Increment usage count
                        promoCode.usageCount = (promoCode.usageCount || 0) + 1;
                        await promoCode.save();
                    }
                }
            } catch (voucherError) {
                console.error('Error updating voucher usage:', voucherError);
                // Don't fail the order if voucher update fails
            }
        }

        // Step 5: Return Response
        return { success: true, message: 'Order submitted successfully', saleOrder };
    } catch (error) {
        callback(error);
    }
    };

    // Remote Method Definition
    AppModel.remoteMethod('submitOrder', {
        description: 'Submit an order and map products by serialNo',
        accepts: [
            { arg: 'data', type: 'object', required: true, http: { source: 'body' } },
            { arg: 'options', type: 'object', http: { source: 'req' } }
        ],
        returns: { arg: 'response', type: 'object' },
        http: { path: '/submit-order', verb: 'POST' }
    });
    
    

    // example using curl to clone a sale order
    // curl -X POST "http://localhost:3000/api/sale-orders/clone?saleOrderId=5b7d7f3f9e5b3e1c2c4d2e8f" -H "accept: application/json"

    /**
     * Khi SaleOrder chuyển sang status "completed":
     * Tự động tạo StockMove (offline-sale) + StockMoveItems để trừ kho
     */
    var _stockMoveProcessing = new Set(); // in-memory lock chống race condition
    var _paymentNotifSent = new Set();   // dedup notification

    AppModel.observe('after save', async function(ctx) {
        var instance = ctx.instance;
        // Chỉ xử lý khi update (có previousData) và status vừa đổi sang completed
        if (!instance) return;
        if (instance.status !== 'completed') return;

        // ── Gửi push notification cho manager + cashier (chạy 1 lần duy nhất) ──
        var notifKey = String(instance.id);
        if (!_paymentNotifSent.has(notifKey)) {
            _paymentNotifSent.add(notifKey);
            try {
                var { getUserIdsByRoles } = require('../../server/triggers/kara/_helpers');
                var Notification = app.models.notification;
                var Room = app.models.Room;
                var paidAmount = instance.paidAmount || instance.total || 0;
                var paymentMethod = instance.paymentMethod || 'cash';
                var pmLabel = paymentMethod === 'cash' ? 'Tiền mặt'
                    : paymentMethod === 'transfer' ? 'Chuyển khoản' : paymentMethod;
                var roomName = instance.roomId ? String(instance.roomId) : 'N/A';
                try {
                    var room = await Room.findById(instance.roomId);
                    if (room) roomName = room.name || room.code || roomName;
                } catch (_) {}
                var receiverIds = await getUserIdsByRoles(app, ['cashier']);
                await Notification.create({
                    title: '\u{1F4B0} [Thanh toán] - Phòng ' + roomName,
                    content: 'Phòng ' + roomName + ' đã thanh toán '
                        + paidAmount.toLocaleString('vi-VN') + ' VNĐ qua ' + pmLabel + '.',
                    receiverIds: receiverIds,
                    createdAt: new Date(),
                    data: {
                        type: 'paymentCompleted',
                        saleOrderId: notifKey,
                        roomName: roomName,
                        paidAmount: paidAmount,
                        paymentMethod: paymentMethod,
                    }
                });
                console.log('[SaleOrder] Payment notification sent - ' + (instance.code || notifKey) + ', Room: ' + roomName + ', Amount: ' + paidAmount);
            } catch (notifErr) {
                console.error('[SaleOrder] Payment notification error:', notifErr.message);
            }
        }

        // Tránh tạo trùng: kiểm tra xem đã có StockMove cho saleOrder này chưa
        var StockMove    = app.models.StockMove;
        var StockMoveItem = app.models.StockMoveItem;
        var SaleOrderItem = app.models.SaleOrderItem;
        var StockItem     = app.models.StockItem;

        try {
            var saleOrderKey = String(instance.id);

            // In-memory lock: nếu đang xử lý rồi thì bỏ qua (tránh race condition trong cùng process)
            if (_stockMoveProcessing.has(saleOrderKey)) return;
            _stockMoveProcessing.add(saleOrderKey);

            // Lấy các item của sale order (chỉ item có productId)
            var orderItems = await SaleOrderItem.find({
                where: { saleOrderId: String(instance.id) }
            });

            var productItems = orderItems.filter(function(i) {
                return i.productId && (Number(i.quantity) || 0) > 0;
            });

            if (!productItems.length) {
                _stockMoveProcessing.delete(saleOrderKey);
                return;
            }

            // Dùng findOrCreate thay vì findOne + create riêng lẻ:
            // - Giảm cửa sổ race condition giữa PM2 cluster workers
            // - Nếu worker khác đã tạo → created=false → bỏ qua, không tạo trùng
            var stockMoveData = {
                type: 'offline-sale',
                status: 'completed',
                completedAt: new Date(),
                saleOrderId: saleOrderKey,
                note: 'Xuất kho tự động từ đơn hàng ' + (instance.code || instance.id),
                totalAmount: instance.total || 0,
            };
            var findOrCreateResult = await StockMove.findOrCreate(
                { where: { saleOrderId: saleOrderKey } },
                stockMoveData
            );
            var stockMove = findOrCreateResult[0];
            var created   = findOrCreateResult[1];
            if (!created) {
                console.log('[SaleOrder complete] StockMove đã tồn tại (race condition bị chặn), bỏ qua:', saleOrderKey);
                _stockMoveProcessing.delete(saleOrderKey);
                return;
            }

            // Với mỗi sản phẩm, tìm warehouseId từ StockItem
            var moveItemPromises = productItems.map(async function(item) {
                var productId = String(item.productId);
                var quantity  = Number(item.quantity) || 0;

                // Tìm StockItem để lấy warehouseId
                var stockItem = await StockItem.findOne({
                    where: { productId: productId, quantity: { gt: 0 } } // Chỉ tìm stock item còn hàng
                });

                var warehouseId = stockItem ? String(stockItem.warehouseId) : null;
                if (!warehouseId) {
                    console.warn('[SaleOrder complete] Không tìm thấy kho cho productId:', productId);
                    return null;
                }

                return StockMoveItem.create({
                    stockMoveId: String(stockMove.id),
                    productId:   productId,
                    warehouseId: warehouseId,
                    quantity:    quantity,
                    price:       Number(item.unitPrice) || 0,
                    subTotal:    Number(item.subtotal)  || 0
                });
            });

            await Promise.all(moveItemPromises);
            console.log('[SaleOrder complete] Đã tạo StockMove xuất kho cho đơn:', instance.code || instance.id);
        } catch (err) {
            console.error('[SaleOrder complete] Lỗi tạo StockMove:', err);
        } finally {
            _stockMoveProcessing.delete(String(instance.id));
        }
    });

    // ─── Broadcast real-time qua WebSocket server ────────────────────────────
    AppModel.observe('after save', function wssBroadcast(ctx, next) {
        const instance = ctx.instance || ctx.data;
        if (!instance) return next();

        const payload = JSON.stringify({
            tenantId: 'kara',
            event: ctx.isNewInstance ? 'saleOrder:created' : 'saleOrder:updated',
            id: String(instance.id || ''),
            status: instance.status || '',
            roomId: String(instance.roomId || ''),
            code: instance.code || '',
        });

        const http = require('http');
        const req = http.request({
            hostname: '127.0.0.1',
            port: process.env.WS_PORT || 30000,
            path: '/broadcast',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: 1000,
        });
        req.on('error', () => {}); // ws.js có thể chưa chạy, bỏ qua
        req.write(payload);
        req.end();

        return next();
    });

    // ─── Revenue Report: server-side aggregation ──────────────────────────────
    AppModel.revenueReport = async function(from, to) {
        const app = AppModel.app;
        const SaleOrderItem = app.models.SaleOrderItem;
        const Product       = app.models.Product;
        const Room          = app.models.Room;

        const fromDate = new Date(from);
        const toDate   = to ? new Date(to) : new Date();

        // 1. Completed orders in range
        const orders = await AppModel.find({
            where: { status: 'completed', updatedAt: { gte: fromDate, lte: toDate } },
            fields: { id: true, paidAmount: true, total: true, paymentMethod: true, updatedAt: true, code: true, roomId: true },
        });

        const totalRevenue = orders.reduce((s, o) => s + (o.paidAmount || o.total || 0), 0);
        const orderCount   = orders.length;

        // Revenue by payment method (dùng giá trị thô: 'cash', 'transfer', ...)
        const byMethod = {};
        orders.forEach(o => {
            const m = o.paymentMethod || 'other';
            byMethod[m] = (byMethod[m] || 0) + (o.paidAmount || o.total || 0);
        });

        // Revenue by day: key = 'YYYY-MM-DD'
        const byDay = {};
        orders.forEach(o => {
            const key = new Date(o.updatedAt).toISOString().slice(0, 10);
            byDay[key] = (byDay[key] || 0) + (o.paidAmount || o.total || 0);
        });

        // Revenue by hour (0–23) — cho biểu đồ theo giờ
        const byHour = {};
        orders.forEach(o => {
            const h = String(new Date(o.updatedAt).getHours());
            byHour[h] = (byHour[h] || 0) + (o.paidAmount || o.total || 0);
        });

        // Open orders count (tất cả đơn chưa completed/cancelled)
        const openOrderCount = await AppModel.count({ status: { nin: ['completed', 'cancelled'] } });

        // Recent 15 transactions
        const sorted = orders.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        const recentRaw = sorted.slice(0, 15).map(o => ({
            code: o.code || '', roomId: String(o.roomId || ''),
            paidAmount: o.paidAmount || o.total || 0,
            paymentMethod: o.paymentMethod || '', updatedAt: o.updatedAt,
        }));
        const roomIds = [...new Set(recentRaw.map(o => o.roomId).filter(Boolean))];
        const rooms = roomIds.length
            ? await Room.find({ where: { id: { inq: roomIds } }, fields: { id: true, name: true, code: true } })
            : [];
        const roomNameMap = {};
        rooms.forEach(r => { roomNameMap[String(r.id)] = r.name || r.code || String(r.id); });
        const recentTransactions = recentRaw.map(o => ({ ...o, roomName: roomNameMap[o.roomId] || o.roomId }));

        // 2. SaleOrderItems → product analytics
        const orderIds = orders.map(o => String(o.id));
        const items = orderIds.length
            ? await SaleOrderItem.find({ where: { saleOrderId: { inq: orderIds } } })
            : [];

        // 3. Product cost map
        const productIds = [...new Set(items.map(i => String(i.productId)).filter(Boolean))];
        const products = productIds.length
            ? await Product.find({ where: { id: { inq: productIds } }, fields: { id: true, price: true } })
            : [];
        const costMap = {};
        products.forEach(p => { costMap[String(p.id)] = p.price || 0; });

        // 4. Aggregate by product name
        const productMap = {};
        items.forEach(item => {
            const unitCost = item.productId ? (costMap[String(item.productId)] || 0) : 0;
            const rev  = (item.quantity || 0) * (item.unitPrice || 0);
            const cost = (item.quantity || 0) * unitCost;
            const key  = item.name || 'Unknown';
            if (!productMap[key]) productMap[key] = { name: key, qty: 0, revenue: 0, cost: 0, profit: 0 };
            productMap[key].qty     += item.quantity || 0;
            productMap[key].revenue += rev;
            productMap[key].cost    += cost;
            productMap[key].profit  += rev - cost;
        });
        const productAnalytics = Object.values(productMap)
            .map(p => ({ ...p, margin: p.revenue > 0 ? Math.round(p.profit / p.revenue * 100) : 0 }))
            .sort((a, b) => b.profit - a.profit);

        return { totalRevenue, orderCount, openOrderCount, byMethod, byDay, byHour, recentTransactions, productAnalytics };
    };

    AppModel.remoteMethod('revenueReport', {
        description: 'Revenue summary + product analytics for a date range',
        accepts: [
            { arg: 'from', type: 'string', required: true,  http: { source: 'query' } },
            { arg: 'to',   type: 'string', required: false, http: { source: 'query' } },
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/revenue-report', verb: 'get' },
    });

    // ── Batch upsert SaleOrderItems (1 request thay vì N parallel calls) ────
    AppModel.batchItems = async function(id, data) {
        const SaleOrderItem = AppModel.app.models.SaleOrderItem;
        const items = (data && data.items) || [];
        const now = new Date().toISOString();
        await Promise.all(items.map(async function(item) {
            if (item.itemId) {
                // Item đã có trên server → PATCH qty
                await SaleOrderItem.updateAll({ id: item.itemId }, {
                    quantity: item.quantity,
                    subtotal: item.subtotal,
                    updatedAt: now,
                });
            } else {
                // Item mới → POST (trigger after-save → push notification)
                await SaleOrderItem.create({
                    saleOrderId: id,
                    productId: item.productId,
                    name: item.name,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    unit: item.unit || 'phần',
                    discount: 0,
                    subtotal: item.subtotal,
                    note: item.note || '',
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }));
        return { ok: true, count: items.length };
    };

    AppModel.remoteMethod('batchItems', {
        description: 'Batch upsert SaleOrderItems for a SaleOrder (1 HTTP call)',
        accepts: [
            { arg: 'id',   type: 'string', required: true,  http: { source: 'path' } },
            { arg: 'data', type: 'object', required: true,  http: { source: 'body' } },
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/:id/batch-items', verb: 'post' },
    });

};
