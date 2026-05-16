'use strict';

module.exports = function(StockCountItem) {

    /**
     * Tính lại totalItems, completedItems, discrepancies trên StockCount cha
     */
    async function syncStockCountStats(stockCountId, StockCountModel) {
        const allItems = await StockCountItem.find({
            where: { stockCountId: stockCountId.toString() },
            fields: { countedQuantity: true, expectedQuantity: true }
        });

        const totalItems     = allItems.length;
        const completedItems = allItems.filter(i => i.countedQuantity != null).length;
        const discrepancies  = allItems.filter(i =>
            i.countedQuantity != null &&
            Number(i.countedQuantity) !== Number(i.expectedQuantity)
        ).length;

        await StockCountModel.updateAll(
            { id: stockCountId.toString() },
            { totalItems, completedItems, discrepancies }
        );
        console.log(`[StockCountItem] Stats updated for StockCount ${stockCountId}: total=${totalItems}, completed=${completedItems}, discrepancies=${discrepancies}`);
    }

    /**
     * After save hook: nếu countedQuantity thay đổi và phiếu kiểm kê đã "completed"
     * thì cập nhật StockItem.quantity = countedQuantity, sau đó sync Product.stock.
     * Luôn sync lại stats (totalItems, completedItems, discrepancies) trên StockCount.
     */
    StockCountItem.observe('after save', async function(ctx) {
        const data = ctx.instance || ctx.data;
        if (!data) return;

        const app = StockCountItem.app;
        const StockItem  = app.models.StockItem;
        const StockCount = app.models.StockCount;
        const Product    = app.models.Product;

        const stockCountId = data.stockCountId;
        if (!stockCountId) return;

        try {
            // Luôn sync stats trên StockCount cha (bất kể status)
            await syncStockCountStats(stockCountId, StockCount);

            // Chỉ cập nhật StockItem/Product.stock khi phiếu đã completed
            if (data.countedQuantity == null) return;

            const stockCount = await StockCount.findById(stockCountId);
            if (!stockCount || stockCount.status !== 'completed') return;

            const stockItemId = data.stockItemId;
            if (!stockItemId) return;

            const countedQty = Number(data.countedQuantity) || 0;

            // Cập nhật StockItem.quantity
            const stockItem = await StockItem.findById(stockItemId);
            if (!stockItem) {
                console.warn('[StockCountItem] StockItem không tồn tại:', stockItemId);
                return;
            }

            await stockItem.updateAttributes({ quantity: countedQty });
            console.log(`[StockCountItem] StockItem ${stockItemId} quantity → ${countedQty}`);

            // Sync tổng tồn kho về Product.stock
            const productId = data.productId || stockItem.productId;
            if (!productId) return;

            const allStockItems = await StockItem.find({
                where: { productId: productId.toString() },
                fields: { quantity: true }
            });

            const totalStock = allStockItems.reduce((sum, si) => sum + (Number(si.quantity) || 0), 0);

            await Product.updateAll({ id: productId.toString() }, { stock: totalStock });
            console.log(`[StockCountItem] Product ${productId} stock → ${totalStock}`);

        } catch (err) {
            console.error('[StockCountItem] Error syncing StockItem/Product.stock:', err.message);
        }
    });
};
