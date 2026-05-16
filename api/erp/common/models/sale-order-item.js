module.exports = function(SaleOrderItem) {
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
