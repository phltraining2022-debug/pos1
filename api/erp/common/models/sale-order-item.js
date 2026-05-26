module.exports = function(SaleOrderItem) {
  function buildLockedError() {
    var err = new Error('Bill đã in hoặc đã khóa. Không thể tạo, sửa hoặc xóa món.');
    err.statusCode = 422;
    err.code = 'SALE_ORDER_LOCKED';
    return err;
  }

  function isSaleOrderLocked(saleOrder) {
    return !!(saleOrder && (
      saleOrder.status === 'completed' ||
      saleOrder.status === 'paid' ||
      (saleOrder.printedAt && !saleOrder.allowEditAfterPrint)
    ));
  }

  async function resolveSaleOrderIdForSave(ctx) {
    if (ctx.instance && ctx.instance.saleOrderId) return String(ctx.instance.saleOrderId);
    if (ctx.data && ctx.data.saleOrderId) return String(ctx.data.saleOrderId);
    if (ctx.currentInstance && ctx.currentInstance.saleOrderId) return String(ctx.currentInstance.saleOrderId);

    var itemId = ctx.instance && ctx.instance.id;
    if (!itemId && ctx.where && ctx.where.id) itemId = ctx.where.id;
    if (!itemId || typeof itemId === 'object') return null;

    var existing = await SaleOrderItem.findOne({ where: { id: String(itemId) } });
    return existing && existing.saleOrderId ? String(existing.saleOrderId) : null;
  }

  async function assertSaleOrderEditable(saleOrderId) {
    if (!saleOrderId) return;

    var SaleOrder = SaleOrderItem.app.models.SaleOrder;
    var saleOrder = await SaleOrder.findById(saleOrderId);
    if (isSaleOrderLocked(saleOrder)) {
      throw buildLockedError();
    }
  }

  SaleOrderItem.observe('before save', async function preventMutationOnLockedSaleOrder(ctx) {
    var saleOrderId = await resolveSaleOrderIdForSave(ctx);
    await assertSaleOrderEditable(saleOrderId);
  });

  SaleOrderItem.observe('before delete', async function preventDeleteOnLockedSaleOrder(ctx) {
    var items = [];

    if (ctx.instance) {
      items = [ctx.instance];
    } else if (ctx.where) {
      items = await SaleOrderItem.find({
        where: ctx.where,
        fields: { saleOrderId: true }
      });
    }

    var saleOrderIds = Array.from(new Set(items
      .map(function(item) { return item && item.saleOrderId ? String(item.saleOrderId) : null; })
      .filter(Boolean)));

    for (var index = 0; index < saleOrderIds.length; index++) {
      await assertSaleOrderEditable(saleOrderIds[index]);
    }
  });

  SaleOrderItem.observe('before save', async function preventDuplicateTimeBased(ctx) {
    // chỉ kiểm tra khi create
    if (!ctx.instance) return;
    if (!ctx.instance.isTimeBased) return;

    var saleOrderId = ctx.instance.saleOrderId;
    var productId = ctx.instance.productId;
    if (!saleOrderId || !productId) return;

    var existing = await SaleOrderItem.findOne({ where: { isTimeBased: true, saleOrderId: saleOrderId, productId: productId } });
    if (existing) {
      var err = new Error('Đã tồn tại một sale order item isTimeBased cho saleOrderId và productId này.');
      err.statusCode = 422;
      throw err;
    }
  });
};
