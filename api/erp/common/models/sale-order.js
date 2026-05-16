
var _ = require('lodash');
var moment = require('moment');
var app = require('../../server/server');

module.exports = function (AppModel) {

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

    AppModel.observe('after save', async function(ctx) {
        var instance = ctx.instance;
        // Chỉ xử lý khi update (có previousData) và status vừa đổi sang completed
        if (!instance) return;
        if (instance.status !== 'completed') return;

        // Tránh tạo trùng: kiểm tra xem đã có StockMove cho saleOrder này chưa
        var StockMove    = app.models.StockMove;
        var StockMoveItem = app.models.StockMoveItem;
        var SaleOrderItem = app.models.SaleOrderItem;
        var StockItem     = app.models.StockItem;

        try {
            var saleOrderKey = String(instance.id);

            // In-memory lock: nếu đang xử lý rồi thì bỏ qua (tránh race condition)
            if (_stockMoveProcessing.has(saleOrderKey)) return;
            _stockMoveProcessing.add(saleOrderKey);

            var existingMove = await StockMove.findOne({
                where: { saleOrderId: saleOrderKey }
            });
            if (existingMove) {
                _stockMoveProcessing.delete(saleOrderKey);
                return; // Đã xử lý rồi, bỏ qua
            }

            // Lấy các item của sale order (chỉ item có productId)
            var orderItems = await SaleOrderItem.find({
                where: { saleOrderId: String(instance.id) }
            });

            var productItems = orderItems.filter(function(i) {
                return i.productId && (Number(i.quantity) || 0) > 0;
            });

            if (!productItems.length) return;

            // Tạo StockMove loại offline-sale, status completed
            var stockMove = await StockMove.create({
                type: 'offline-sale',
                status: 'completed',
                completedAt: new Date(),
                saleOrderId: String(instance.id),
                note: 'Xuất kho tự động từ đơn hàng ' + (instance.code || instance.id),
                totalAmount: instance.total || 0
            });

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

};
