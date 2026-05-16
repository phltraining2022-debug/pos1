module.exports = function(StockItem) {
  /**
   * Before save hook to auto-populate productName and productCode from Product
   */
  StockItem.observe('before save', function(ctx, next) {
    const app = require('../../server/server');
    const Product = app.models.Product;
    
    const data = ctx.instance || ctx.data;
    if (!data) return next();

    // Only populate if productId exists and name/code are missing
    if (data.productId && (!data.productName || !data.productCode)) {
      Product.findById(data.productId, function(err, product) {
        if (err) {
          console.error('Error fetching Product for StockItem:', err);
          return next(); // Continue without populating
        }

        if (product) {
          if (!data.productName) {
            data.productName = product.name || product.title || 'Unnamed Product';
          }
          if (!data.productCode) {
            data.productCode = product.code || product.sku || product.id;
          }
        }
        
        next();
      });
    } else {
      next();
    }
  });

  /**
   * Remote method to sync product names/codes for existing StockItems
   * Useful for backfilling data after adding these fields
   */
  StockItem.syncProductInfo = function(cb) {
    const app = require('../../server/server');
    const Product = app.models.Product;

    StockItem.find({}, function(err, stockItems) {
      if (err) return cb(err);

      let updated = 0;
      let processed = 0;
      const total = stockItems.length;

      if (total === 0) {
        return cb(null, { total: 0, updated: 0, message: 'No stock items found' });
      }

      stockItems.forEach(function(stockItem) {
        Product.findById(stockItem.productId, function(err, product) {
          processed++;

          if (!err && product) {
            const updates = {};
            if (!stockItem.productName && product.name) {
              updates.productName = product.name;
            }
            if (!stockItem.productCode && (product.code || product.sku)) {
              updates.productCode = product.code || product.sku;
            }

            if (Object.keys(updates).length > 0) {
              stockItem.updateAttributes(updates, function(err) {
                if (!err) updated++;
                
                if (processed === total) {
                  cb(null, { total: total, updated: updated, message: `Synced ${updated} of ${total} stock items` });
                }
              });
            } else {
              if (processed === total) {
                cb(null, { total: total, updated: updated, message: `Synced ${updated} of ${total} stock items` });
              }
            }
          } else {
            if (processed === total) {
              cb(null, { total: total, updated: updated, message: `Synced ${updated} of ${total} stock items` });
            }
          }
        });
      });
    });
  };

  StockItem.remoteMethod('syncProductInfo', {
    accepts: [],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/sync-product-info', verb: 'post' },
    description: 'Sync productName and productCode for all existing StockItems from Product records'
  });

  /**
   * After save hook: recalculate total stock across all warehouses and update Product.stock
   */
  StockItem.observe('after save', async function(ctx) {
    const app = require('../../server/server');
    const Product = app.models.Product;

    const data = ctx.instance || ctx.data;
    if (!data || !data.productId) return;

    try {
      // Sum quantity of all StockItems for this productId
      const allItems = await StockItem.find({
        where: { productId: data.productId },
        fields: { quantity: true }
      });

      const totalStock = allItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

      await Product.updateAll({ id: data.productId }, { stock: totalStock });
      console.log(`[StockItem] Updated Product ${data.productId} stock → ${totalStock}`);
    } catch (err) {
      console.error('[StockItem] Error updating Product.stock:', err.message);
    }
  });
};
