// Trigger: Nhập kho hoàn thành (StockMove type="adding", status → "completed")
// Fired when: StockMove updated → status = "completed"
module.exports = async function(instance) {
    if (!instance || !instance.changes || !instance.changes.status) return;
    if (instance.changes.status.to !== 'completed') return;

    const stockMove = instance.data;

    // Chỉ xử lý loại nhập kho (adding)
    if (stockMove.type !== 'adding') return;

    const app = require('../../server');
    const { User, notification: Notification, StockMoveItem, Product, Supplier, Employee } = app.models;

    const stockMoveId = instance.objectId || 'none';

    // Tên nhà cung cấp
    let supplierName = '';
    if (stockMove.supplierId) {
        const supplier = await Supplier.findById(stockMove.supplierId).catch(() => null);
        if (supplier) supplierName = supplier.name || supplier.fullName || '';
    }

    // Người nhận hàng
    let receiverName = '';
    if (stockMove.receivedById) {
        const receiver = await Employee.findById(stockMove.receivedById).catch(() => null);
        if (receiver) receiverName = receiver.fullName || receiver.name || '';
    }

    // Lấy danh sách hàng nhập từ StockMoveItem → resolve tên Product
    let itemLines = [];
    let totalQty = 0;
    try {
        const items = await StockMoveItem.find({ where: { stockMoveId: stockMoveId.toString() } });
        if (items && items.length) {
            const resolved = await Promise.all(items.map(async item => {
                let productName = `(ID: ${item.productId})`;
                if (item.productId) {
                    const product = await Product.findById(item.productId).catch(() => null);
                    if (product) productName = product.name || product.code || productName;
                }
                totalQty += item.quantity || 0;
                return `${productName}: ${item.quantity}`;
            }));
            itemLines = resolved;
        }
    } catch (err) {
        console.error('[Trigger] Error fetching StockMoveItems:', err.message);
    }

    const totalAmount = stockMove.totalAmount || 0;
    const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);

    const title = `[Nhập kho] - ${stockMove.code || stockMoveId}`;
    let content = `Phiếu nhập kho ${stockMove.code || stockMoveId} đã hoàn thành.`;
    if (supplierName) content += ` NCC: ${supplierName}.`;
    if (receiverName) content += ` Người nhận: ${receiverName}.`;
    if (itemLines.length) content += ` Hàng hoá (${itemLines.length} loại, ${totalQty} sp): ${itemLines.join(', ')}.`;
    if (totalAmount) content += ` Tổng tiền: ${totalAmount.toLocaleString('vi-VN')} VNĐ.`;

    console.log(`[Trigger] StockMove.updated (adding/completed) - ${stockMove.code}, items: ${itemLines.length}, qty: ${totalQty}`);

    await Notification.create({
        title,
        content,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/warehouse/stock-moves/${stockMoveId}`,
            objectId: stockMoveId,
            model: 'StockMove',
            status: 'completed',
            type: 'StockMoveAdding',
            itemCount: itemLines.length,
            totalQty
        }
    });
    // Web push được gửi tự động qua Notification.afterSave
};
