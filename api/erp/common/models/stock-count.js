'use strict';

module.exports = function(StockCount) {

  function roundFloat(value, decimals) {
    decimals = decimals || 3;
    var multiplier = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }

  /**
   * Khi StockCount chuyển sang status "completed":
   * - Lấy tất cả StockCountItem của phiếu này
   * - Set StockItem.quantity = countedQuantity (số thực kiểm đếm, ghi đè hoàn toàn)
   * - Cập nhật Product.stock = tổng tất cả StockItem của sản phẩm đó
   * - Tạo notification nếu stock <= minStockLevel
   */
  StockCount.observe('after save', function(ctx, next) {
    var instance = ctx.instance;
    // Chỉ xử lý khi instance tồn tại và status = completed
    if (!instance || instance.status !== 'completed') return next();

    // Kiểm tra previousData để chỉ chạy khi vừa chuyển sang completed
    var prevStatus = ctx.options && ctx.options.previousData && ctx.options.previousData.status;
    if (prevStatus === 'completed') return next(); // Đã xử lý rồi

    var app         = StockCount.app;
    var StockCountItem = app.models.StockCountItem;
    var StockItem      = app.models.StockItem;
    var Product        = app.models.Product;
    var Notification   = app.models.notification;

    var stockCountId  = String(instance.id);
    var warehouseId   = String(instance.warehouseId || '').trim();

    console.log('[StockCount complete] Bắt đầu cập nhật StockItem cho stockCountId:', stockCountId);

    // Lấy toàn bộ StockCountItem của phiếu này
    StockCountItem.find({
      where: { stockCountId: stockCountId }
    }, function(err, countItems) {
      if (err) {
        console.error('[StockCount complete] Lỗi lấy StockCountItems:', err);
        return next(err);
      }

      if (!countItems || !countItems.length) {
        console.log('[StockCount complete] Không có StockCountItem nào, bỏ qua.');
        return next();
      }

      var pending = countItems.length;
      var updatedProductIds = [];

      function onItemDone(productId) {
        if (productId && updatedProductIds.indexOf(String(productId)) === -1) {
          updatedProductIds.push(String(productId));
        }
        pending--;
        if (pending === 0) {
          // Sau khi tất cả StockItem đã được cập nhật, sync Product.stock
          var productPending = updatedProductIds.length;
          if (productPending === 0) return next();

          updatedProductIds.forEach(function(pid) {
            syncProductStock(pid, app, function() {
              productPending--;
              if (productPending === 0) next();
            });
          });
        }
      }

      countItems.forEach(function(countItem) {
        var stockItemId    = countItem.stockItemId;
        var productId      = countItem.productId;
        var countedQty     = roundFloat(Number(countItem.countedQuantity) || 0, 3);

        if (!stockItemId) {
          console.warn('[StockCount complete] countItem thiếu stockItemId:', countItem.id);
          return onItemDone(productId);
        }

        // Set trực tiếp quantity = countedQuantity (kiểm kê thực tế, ghi đè)
        StockItem.findById(stockItemId, function(err, stockItem) {
          if (err || !stockItem) {
            console.error('[StockCount complete] Không tìm thấy StockItem:', stockItemId, err);
            return onItemDone(productId);
          }

          var resolvedProductId = productId || stockItem.productId;

          stockItem.updateAttributes({ quantity: countedQty }, function(err, updated) {
            if (err) {
              console.error('[StockCount complete] Lỗi update StockItem:', stockItemId, err);
            } else {
              console.log('[StockCount complete] StockItem updated:', stockItemId, '→ qty:', updated.quantity);
            }
            onItemDone(resolvedProductId);
          });
        });
      });
    });
  });

  /**
   * Kiểm tra low-stock và tạo notification nếu cần.
   * Phần update Product.stock đã được xử lý bởi StockItem.afterSave (stock-item.js).
   */
  function syncProductStock(productId, app, done) {
    var StockItem    = app.models.StockItem;
    var Product      = app.models.Product;
    var Notification = app.models.notification;
    var productIdStr = String(productId);

    // Chỉ cần tính tổng để check low-stock, không cần update Product.stock nữa
    // (stock-item.js afterSave đã xử lý rồi)
    StockItem.find({
      where: {
        or: [
          { productId: productId },
          { productId: productIdStr }
        ]
      },
      fields: { quantity: true }
    }, function(err, stockItems) {
      if (err) {
        console.error('[syncProductStock] Lỗi lấy StockItems:', err);
        return done();
      }

      var totalStock = 0;
      stockItems.forEach(function(si) { totalStock += Number(si.quantity) || 0; });
      totalStock = roundFloat(totalStock, 3);

      Product.findOne({
        where: {
          or: [
            { id: productId },
            { id: productIdStr }
          ]
        }
      }, function(err, product) {
        if (err || !product) {
          console.error('[syncProductStock] Không tìm thấy Product:', productIdStr);
          return done();
        }

        var minStockLevel = Number(product.minStockLevel) || 0;

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
              productId:     productIdStr,
              productName:   product.name,
              productCode:   product.code,
              totalStock:    totalStock,
              minStockLevel: minStockLevel
            }
          }, function(err) {
            if (err) console.error('[syncProductStock] Lỗi tạo notification:', err);
            else console.log('[syncProductStock] Low-stock notification tạo cho:', product.name || productIdStr);
            done();
          });
        } else {
          done();
        }
      });
    });
  }
};
