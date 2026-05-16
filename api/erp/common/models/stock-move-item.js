// module.exports = function(StockMoveItem) {
  
//   /**
//    * Helper function to handle float arithmetic precision issues
//    */
//   function roundFloat(value, decimals = 3) {
//     const multiplier = Math.pow(10, decimals);
//     return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
//   }

//   /**
//    * After save hook to create/update StockItem based on StockMoveItem changes.
//    * This ensures inventory levels are automatically adjusted when stock moves occur.
//    */
//   StockMoveItem.observe('after save', function(ctx, next) {
//     const app = require('../../server/server');
//     const StockItem = app.models.StockItem;
//     const StockMove = app.models.StockMove;

//     // Get the saved instance data
//     const instance = ctx.instance || ctx.currentInstance;
//     if (!instance) {
//       return next();
//     }

//     const stockMoveId = instance.stockMoveId;
//     const productId = instance.productId;
//     const warehouseId = instance.warehouseId;
//     const quantity = Number(instance.quantity) || 0;

//     if (!stockMoveId || !productId || !warehouseId) {
//       return next();
//     }

//     // Fetch the parent StockMove to determine operation type
//     StockMove.findById(stockMoveId, function(err, stockMove) {
//       if (err) {
//         console.error('Error fetching StockMove:', err);
//         return next(err);
//       }

//       if (!stockMove) {
//         console.error('StockMove not found:', stockMoveId);
//         return next();
//       }

//       // Determine if this is an increase or decrease based on type
//       const increaseTypes = ['adding', 'import', 'return', 'adjustment'];
//       const decreaseTypes = ['online-sale', 'export', 'offline-sale', 'transfer', 'damaged', 'expired', 'production'];
      
//       let quantityDelta = 0;
//       if (increaseTypes.includes(stockMove.type)) {
//         quantityDelta = quantity; // Add to stock
//       } else if (decreaseTypes.includes(stockMove.type)) {
//         quantityDelta = -quantity; // Subtract from stock
//       }

//       // Only proceed if StockMove status is 'completed'
//       if (stockMove.status !== 'completed') {
//         console.log('StockMove not completed yet, skipping StockItem update');
//         return next();
//       }

//       const ObjectID = require('mongodb').ObjectID;
      
//       // Normalize productId to ObjectID for query
//       let productIdForQuery = productId;
//       if (typeof productId === 'string') {
//         try {
//           productIdForQuery = new ObjectID(productId);
//         } catch (e) {
//           console.error('Error: Invalid productId ObjectID:', productId);
//           return next(new Error('Invalid productId format'));
//         }
//       }
      
//       // Normalize warehouseId to string
//       let normalizedWarehouseId;
//       if (warehouseId && typeof warehouseId === 'object' && warehouseId.toString) {
//         normalizedWarehouseId = warehouseId.toString().trim();
//       } else {
//         normalizedWarehouseId = String(warehouseId || '').trim();
//       }

//       // Find existing StockItem using MongoDB native query for exact match
//       function findStockItem(callback) {
//         const productIdStr = String(productId);
//         const ds = StockItem.dataSource;
//         const connector = ds.connector;
//         const collection = connector.collection('StockItem');
        
//         const mongoQuery = {
//           warehouseId: normalizedWarehouseId,
//           $or: [
//             { productId: productIdForQuery },
//             { productId: productIdStr }
//           ]
//         };
        
//         collection.findOne(mongoQuery, function(err, doc) {
//           if (err) {
//             return callback(err);
//           }
          
//           if (doc) {
//             StockItem.findById(doc._id, callback);
//           } else {
//             callback(null, null);
//           }
//         });
//       }

//       findStockItem(function(err, existingStockItem) {
//         if (err) {
//           console.error('Error finding StockItem:', err);
//           return next(err);
//         }

//         if (existingStockItem) {
//           // Update existing StockItem quantity with float precision handling
//           const currentQty = Number(existingStockItem.quantity) || 0;
//           const rawNewQuantity = currentQty + quantityDelta;
//           const newQuantity = roundFloat(Math.max(0, rawNewQuantity), 3);
          
//           existingStockItem.updateAttributes({
//             quantity: newQuantity
//           }, function(err, updated) {
//             if (err) {
//               console.error('Error updating StockItem:', err);
//               return next(err);
//             }
//             console.log(`StockItem UPDATED: productId=${String(productIdForQuery)}, warehouseId=${normalizedWarehouseId}, qty=${existingStockItem.quantity} -> ${updated.quantity}`);
//             next();
//           });
//         } else {
//           // Create new StockItem with float precision handling
//           const newStockItemData = {
//             productId: productIdForQuery,
//             warehouseId: normalizedWarehouseId,
//             productName: instance.productName,
//             productCode: instance.productCode,
//             quantity: roundFloat(Math.max(0, quantityDelta), 3),
//             uomStorage: instance.uomStorage,
//             openingQuantity: 0,
//             allocatedQuantity: 0,
//             orderedQuantity: 0,
//             minLevel: 0
//           };

//           StockItem.create(newStockItemData, function(err, createdStockItem) {
//             if (err) {
//               console.error('Error creating StockItem:', err);
//               return next(err);
//             }
//             console.log(`StockItem CREATED: productId=${String(productIdForQuery)}, warehouseId=${normalizedWarehouseId}, qty=${createdStockItem.quantity}`);
//             next();
//           });
//         }
//       });
//     });
//   });
// };



module.exports = function(StockMoveItem) {
  
  function roundFloat(value, decimals = 3) {
    const multiplier = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }

  const increaseTypes = ['adding', 'import', 'return', 'adjustment'];
  const decreaseTypes = ['online-sale', 'export', 'offline-sale', 'transfer', 'damaged', 'expired', 'production'];

  StockMoveItem.observe('after save', function(ctx, next) {
    const instance = ctx.instance || ctx.currentInstance;
    if (!instance) return next();

    const stockMoveId = instance.stockMoveId;
    const productId   = instance.productId;
    const warehouseId = instance.warehouseId;

    if (!stockMoveId || !productId || !warehouseId) return next();

    const StockItem = StockMoveItem.app.models.StockItem;
    const StockMove = StockMoveItem.app.models.StockMove;

    // Chỉ xử lý khi StockMove cha đã completed
    StockMove.findById(stockMoveId, function(err, stockMove) {
      if (err) { console.error('Error fetching StockMove:', err); return next(err); }
      if (!stockMove) { console.error('StockMove not found:', stockMoveId); return next(); }
      if (stockMove.status !== 'completed') {
        console.log('StockMove not completed yet, skipping StockItem update');
        return next();
      }

      const normalizedWarehouseId = String(warehouseId || '').trim();
      const productIdStr = String(productId);

      // Bước 1: Lấy tất cả completed StockMove IDs
      StockMove.find({
        where: { status: 'completed' },
        fields: ['id', 'type']
      }, function(err, completedMoves) {
        if (err) { console.error('Error fetching completed StockMoves:', err); return next(err); }

        const completedMoveIds = completedMoves.map(function(m) { return String(m.id); });
        const moveTypeMap = {};
        completedMoves.forEach(function(m) { moveTypeMap[String(m.id)] = m.type; });

        // Bước 2: Tổng hợp tất cả StockMoveItem của product+warehouse này trong các move đã completed
        StockMoveItem.find({
          where: {
            stockMoveId: { inq: completedMoveIds },
            warehouseId: normalizedWarehouseId,
            or: [
              { productId: productId },
              { productId: productIdStr }
            ]
          }
        }, function(err, allItems) {
          if (err) { console.error('Error fetching StockMoveItems:', err); return next(err); }

          // Bước 3: Tính tổng từ đầu (không dùng delta)
          var totalQty = 0;
          allItems.forEach(function(item) {
            var type = moveTypeMap[String(item.stockMoveId)];
            var qty  = Number(item.quantity) || 0;
            if (increaseTypes.includes(type))      totalQty += qty;
            else if (decreaseTypes.includes(type)) totalQty -= qty;
          });
          totalQty = roundFloat(Math.max(0, totalQty), 3);

          console.log(`[StockItem recalc] productId=${productIdStr}, warehouseId=${normalizedWarehouseId}, total=${totalQty} (from ${allItems.length} move items)`);

          // Bước 4: Update hoặc create StockItem
          StockItem.findOne({
            where: {
              warehouseId: normalizedWarehouseId,
              or: [{ productId: productId }, { productId: productIdStr }]
            }
          }, function(err, existingStockItem) {
            if (err) { console.error('Error finding StockItem:', err); return next(err); }

            if (existingStockItem) {
              existingStockItem.updateAttributes({ quantity: totalQty }, function(err, updated) {
                if (err) { console.error('Error updating StockItem:', err); return next(err); }
                console.log(`StockItem UPDATED: productId=${productIdStr}, warehouseId=${normalizedWarehouseId}, qty=${updated.quantity}`);
                syncProductStock(productIdStr, next);
              });
            } else {
              StockItem.create({
                productId:       productId,
                warehouseId:     normalizedWarehouseId,
                productName:     instance.productName,
                productCode:     instance.productCode,
                quantity:        totalQty,
                uomStorage:      instance.uomStorage,
                openingQuantity: 0,
                allocatedQuantity: 0,
                orderedQuantity:   0,
                minLevel:          0
              }, function(err, createdStockItem) {
                if (err) { console.error('Error creating StockItem:', err); return next(err); }
                console.log(`StockItem CREATED: productId=${productIdStr}, warehouseId=${normalizedWarehouseId}, qty=${createdStockItem.quantity}`);
                syncProductStock(productIdStr, next);
              });
            }
          });
        });
      });
    });
  });

  /**
   * Sau khi StockItem thay đổi:
   * 1. Tính tổng stock của sản phẩm trên tất cả các kho
   * 2. Cập nhật Product.stock
   * 3. Nếu stock <= minStockLevel → tạo notification cảnh báo
   */
  function syncProductStock(productId, done) {
    const Product      = StockMoveItem.app.models.Product;
    const StockItem    = StockMoveItem.app.models.StockItem;
    const Notification = StockMoveItem.app.models.notification;

    const productIdStr = String(productId);

    // Tổng hợp tất cả StockItem của sản phẩm này
    StockItem.find({
      where: {
        or: [
          { productId: productId },
          { productId: productIdStr }
        ]
      }
    }, function(err, stockItems) {
      if (err) {
        console.error('[syncProductStock] Error finding StockItems:', err);
        return done();
      }

      var totalStock = stockItems.reduce(function(sum, si) {
        return sum + (Number(si.quantity) || 0);
      }, 0);
      totalStock = roundFloat(totalStock, 3);

      // Cập nhật Product.stock
      Product.findOne({
        where: {
          or: [
            { id: productId },
            { id: productIdStr }
          ]
        }
      }, function(err, product) {
        if (err || !product) {
          console.error('[syncProductStock] Product not found:', productIdStr, err);
          return done();
        }

        var minStockLevel = Number(product.minStockLevel) || 0;

        product.updateAttributes({ stock: totalStock }, function(err) {
          if (err) {
            console.error('[syncProductStock] Error updating Product.stock:', err);
            return done();
          }

          console.log(`[syncProductStock] Product ${productIdStr} stock updated: ${totalStock}`);

          // Kiểm tra cảnh báo tồn kho thấp
          if (minStockLevel > 0 && totalStock <= minStockLevel) {
            Notification.create({
              module: 'inventory',
              type: 'low-stock',
              title: 'Cảnh báo tồn kho thấp',
              content: 'Sản phẩm "' + (product.name || productIdStr) + '" có tồn kho ' + totalStock + ' ≤ mức tối thiểu ' + minStockLevel + '.',
              referenceId: productIdStr,
              referenceType: 'Product',
              time: new Date(),
              metadata: {
                productId: productIdStr,
                productName: product.name,
                productCode: product.code,
                totalStock: totalStock,
                minStockLevel: minStockLevel
              }
            }, function(err, noti) {
              if (err) {
                console.error('[syncProductStock] Error creating low-stock notification:', err);
              } else {
                console.log(`[syncProductStock] Low-stock notification created for product ${product.name || productIdStr}`);
              }
              done();
            });
          } else {
            done();
          }
        });
      });
    });
  }
};