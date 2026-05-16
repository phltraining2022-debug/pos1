var ObjectID = require('bson').ObjectID;

// ─── Helpers dùng cho tính lại StockItem ──────────────────────────────────────

function roundFloat(value, decimals) {
  decimals = decimals !== undefined ? decimals : 3;
  var multiplier = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

var increaseTypes = ['adding', 'import', 'return', 'adjustment'];
var decreaseTypes = ['online-sale', 'export', 'offline-sale', 'transfer', 'damaged', 'expired', 'production'];

/**
 * Tính lại số lượng StockItem cho một cặp (productId, warehouseId)
 * bằng cách tổng hợp TẤT CẢ các StockMoveItem thuộc completed StockMoves.
 */
function recalcStockItem(app, productId, warehouseId, done) {
  var StockMove  = app.models.StockMove;
  var StockMoveItem = app.models.StockMoveItem;
  var StockItem  = app.models.StockItem;

  var productIdStr  = String(productId);
  var warehouseIdStr = String(warehouseId);

  // Bước 1: lấy tất cả completed StockMove
  StockMove.find({ where: { status: 'completed' }, fields: ['id', 'type'] }, function(err, completedMoves) {
    if (err) { console.error('[recalcStockItem] Lỗi lấy completed moves:', err); return done(); }

    var completedMoveIds = (completedMoves || []).map(function(m) { return String(m.id); });
    var moveTypeMap = {};
    (completedMoves || []).forEach(function(m) { moveTypeMap[String(m.id)] = m.type; });

    if (completedMoveIds.length === 0) {
      return upsertStockItem(StockItem, productId, productIdStr, warehouseIdStr, 0, done);
    }

    // Bước 2: lấy tất cả items của product+warehouse trong những moves đó
    StockMoveItem.find({
      where: {
        stockMoveId: { inq: completedMoveIds },
        warehouseId: warehouseIdStr,
        or: [{ productId: productId }, { productId: productIdStr }]
      }
    }, function(err, items) {
      if (err) { console.error('[recalcStockItem] Lỗi lấy StockMoveItems:', err); return done(); }

      // Bước 3: tính tổng
      var totalQty = 0;
      (items || []).forEach(function(item) {
        var type = moveTypeMap[String(item.stockMoveId)];
        var qty  = Number(item.quantity) || 0;
        if (increaseTypes.indexOf(type) !== -1)      totalQty += qty;
        else if (decreaseTypes.indexOf(type) !== -1) totalQty -= qty;
      });
      totalQty = roundFloat(Math.max(0, totalQty), 3);

      console.log('[recalcStockItem] productId=' + productIdStr +
        ', warehouseId=' + warehouseIdStr +
        ', total=' + totalQty + ' (từ ' + (items || []).length + ' items)');

      upsertStockItem(StockItem, productId, productIdStr, warehouseIdStr, totalQty, done);
    });
  });
}

function upsertStockItem(StockItem, productId, productIdStr, warehouseIdStr, totalQty, done) {
  StockItem.findOne({
    where: {
      warehouseId: warehouseIdStr,
      or: [{ productId: productId }, { productId: productIdStr }]
    }
  }, function(err, existing) {
    if (err) { console.error('[recalcStockItem] Lỗi tìm StockItem:', err); return done(); }

    if (existing) {
      existing.updateAttributes({ quantity: totalQty }, function(err) {
        if (err) console.error('[recalcStockItem] Lỗi update StockItem:', err);
        else console.log('[recalcStockItem] Updated: productId=' + productIdStr + ', qty=' + totalQty);
        done();
      });
    } else {
      StockItem.create({
        productId:         productId,
        warehouseId:       warehouseIdStr,
        quantity:          totalQty,
        openingQuantity:   0,
        allocatedQuantity: 0,
        orderedQuantity:   0,
        minLevel:          0
      }, function(err) {
        if (err) console.error('[recalcStockItem] Lỗi tạo StockItem:', err);
        else console.log('[recalcStockItem] Created: productId=' + productIdStr + ', qty=' + totalQty);
        done();
      });
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────

module.exports = function(StockMove) {


  StockMove.observe('before save', function filterProperties(ctx, next) {
    const app = require('../../server/server');
    const PurchaseOrder = app.models.PurchaseOrder;
    const instance = ctx.instance || ctx.currentInstance;
    console.log('StockMove before save hook triggered');

    async function assignSupplierIdIfNeeded(obj) {
      if (obj && obj.purchaseOrderId && !obj.supplierId) {
        try {
          obj.purchaseOrderId = new ObjectID(obj.purchaseOrderId);
        } catch (e) {}
        // Lấy supplierId từ PurchaseOrder
        try {
          const po = await PurchaseOrder.findById(obj.purchaseOrderId);
          if (po && po.supplierId) {
            obj.supplierId = po.supplierId;
            console.log('[StockMove before save] Gán supplierId từ PO:', po.supplierId);
          }
        } catch (e) {
          console.error('[StockMove before save] Lỗi lấy supplierId từ PO:', e);
        }
      }
    }

    (async () => {
      if (instance) {
        try {
          if (instance.purchaseOrderId) {
            instance.purchaseOrderId = new ObjectID(instance.purchaseOrderId);
          }
          if (instance.receivedById) {
            instance.receivedById = new ObjectID(instance.receivedById);
          }
          if (instance.pickedById) {
            instance.pickedById = new ObjectID(instance.pickedById);
          }
        } catch (e) {}
        await assignSupplierIdIfNeeded(instance);
      } else if (ctx.data) {
        if (ctx.data.purchaseOrderId) {
          try {
            ctx.data.purchaseOrderId = new ObjectID(ctx.data.purchaseOrderId);
          } catch (e) {}
        }
        await assignSupplierIdIfNeeded(ctx.data);
      }

      // ── Phát hiện chuyển trạng thái sang 'completed' để dùng trong after save ──
      ctx.options = ctx.options || {};
      const newStatus = ctx.data
        ? ctx.data.status
        : (ctx.instance ? ctx.instance.status : null);

      if (newStatus === 'completed') {
        if (ctx.currentInstance) { // && ctx.currentInstance.status !== 'completed') {
          // updateAttributes: ctx.currentInstance chứa data cũ trước khi save
          ctx.options.justBecameCompleted = true;
        } else if (ctx.isNewInstance) {
          // Tạo mới đã ở trạng thái completed
          ctx.options.justBecameCompleted = true;
        } else if (ctx.instance && !ctx.isNewInstance && ctx.instance.id) {
          // upsert / replaceById: cần kiểm tra trạng thái cũ từ DB
          try {
            const current = await StockMove.findById(ctx.instance.id);
            if (current && current.status !== 'completed') {
              ctx.options.justBecameCompleted = true;
            }
          } catch (e) {
            console.error('[StockMove before save] Lỗi kiểm tra trạng thái cũ:', e);
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      next();
    })();
  });
  /**
   * After save hook:
   * 1. Khi StockMove chuyển sang 'completed': tính lại StockItem từ tất cả StockMoveItems
   *    của những completed StockMoves (idempotent, tính từ đầu không dùng delta).
   * 2. Nếu type là 'adding' và có purchaseOrderId: kiểm tra thiếu hàng so với PO và tạo notification.
   */
  StockMove.observe('after save', function(ctx, next) {
    const app = require('../../server/server');
    const StockMoveItem = app.models.StockMoveItem;
    const PurchaseOrder = app.models.PurchaseOrder;
    const Notification  = app.models.notification;

    const instance = ctx.instance || ctx.currentInstance;
    if (!instance) return next();

    // Chỉ xử lý khi trạng thái vừa chuyển sang 'completed' (flag set ở before save)
    if (!ctx.options || !ctx.options.justBecameCompleted) return next();

    const stockMoveId   = instance.id;
    const stockMoveType = instance.type;

    console.log('[StockMove after save] Trạng thái vừa thành completed, tính lại StockItems cho stockMoveId=' + stockMoveId);

    // ── Bước 1: Lấy tất cả StockMoveItems của StockMove này ──────────────────
    StockMoveItem.find({ where: { stockMoveId: stockMoveId } }, function(err, moveItems) {
      if (err) {
        console.error('[StockMove after save] Lỗi lấy StockMoveItems:', err);
        return continueWithPOValidation();
      }

      if (!moveItems || moveItems.length === 0) {
        console.log('[StockMove after save] Không có StockMoveItems, bỏ qua tính lại StockItem');
        return continueWithPOValidation();
      }

      // ── Bước 2: Lấy các cặp productId+warehouseId duy nhất ─────────────────
      const pairs = {};
      moveItems.forEach(function(item) {
        if (item.productId && item.warehouseId) {
          const key = String(item.productId) + '::' + String(item.warehouseId);
          if (!pairs[key]) {
            pairs[key] = { productId: item.productId, warehouseId: String(item.warehouseId) };
          }
        }
      });

      const pairList = Object.values(pairs);
      if (pairList.length === 0) return continueWithPOValidation();

      console.log('[StockMove after save] Tính lại ' + pairList.length + ' cặp product-warehouse');

      // ── Bước 3: Tính lại từng cặp (song song) ────────────────────────────────
      let processed = 0;
      pairList.forEach(function(pair) {
        recalcStockItem(app, pair.productId, pair.warehouseId, function() {
          processed++;
          if (processed === pairList.length) continueWithPOValidation();
        });
      });
    });

    // ── Tiếp tục kiểm tra thiếu hàng PO (chỉ với type 'adding') ─────────────
    function continueWithPOValidation() {
      if (stockMoveType !== 'adding' || !instance.purchaseOrderId) {
        return next();
      }
      performPOValidation();
    }

    function performPOValidation() {
      PurchaseOrder.findById(instance.purchaseOrderId, function(err, po) {
        if (err) {
          console.error('Error fetching PurchaseOrder:', err);
          return next(err);
        }
        if (!po) {
          console.error('PurchaseOrder not found:', instance.purchaseOrderId);
          return next();
        }
        if (!po.items || !Array.isArray(po.items) || po.items.length === 0) {
          console.log('PurchaseOrder has no items to validate');
          return next();
        }

        StockMoveItem.find({ where: { stockMoveId: stockMoveId } }, function(err, moveItems) {
          if (err) {
            console.error('Error fetching StockMoveItems for PO validation:', err);
            return next(err);
          }

          const receivedMap = {};
          (moveItems || []).forEach(function(item) {
            const pid = String(item.productId);
            receivedMap[pid] = (receivedMap[pid] || 0) + (Number(item.quantity) || 0);
          });

          const shortages = [];
          po.items.forEach(function(poItem) {
            const pid        = String(poItem.productId);
            const orderedQty = Number(poItem.quantity) || 0;
            const receivedQty = receivedMap[pid] || 0;
            if (receivedQty < orderedQty) {
              shortages.push({
                productId:   pid,
                productName: poItem.productName || ('Product ' + pid),
                orderedQty:  orderedQty,
                receivedQty: receivedQty,
                shortageQty: orderedQty - receivedQty
              });
            }
          });

          if (shortages.length > 0) {
            createShortageNotification(po, instance, shortages, next);
          } else {
            console.log('Goods receipt completed successfully - no shortages detected');
            next();
          }
        });
      });
    }

    function createShortageNotification(po, stockMove, shortages, callback) {
      const shortageDetails = shortages.map(function(s) {
        return '- ' + s.productName + ': Đã đặt ' + s.orderedQty + ', Đã nhận ' + s.receivedQty + ', Thiếu ' + s.shortageQty;
      }).join('\n');

      const title   = 'Thiếu hàng: Phiếu nhập ' + (po.code || po.id);
      const content = 'Phiếu nhập (' + (stockMove.code || stockMove.id) + ') đã hoàn thành với thiếu hàng:\n\n' +
        shortageDetails + '\n\nVui lòng kiểm tra Phiếu nhập và thực hiện hành động thích hợp.';

      const notificationData = {
        title:         title,
        content:       content,
        type:          'alert',
        module:        'purchasing',
        referenceId:   po.id,
        referenceType: 'PurchaseOrder',
        metadata: {
          purchaseOrderId:   po.id,
          purchaseOrderCode: po.code,
          stockMoveId:       stockMove.id,
          stockMoveCode:     stockMove.code,
          shortages:         shortages
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      Notification.create(notificationData, function(err, notification) {
        if (err) {
          console.error('Error creating shortage notification:', err);
          return callback();
        }
        console.log('Shortage notification created:', {
          notificationId:  notification.id,
          purchaseOrderId: po.id,
          shortagesCount:  shortages.length
        });
        callback();
      });
    }
  });
};
