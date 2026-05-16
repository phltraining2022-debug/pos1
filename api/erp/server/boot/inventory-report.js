module.exports = function (app) {
    const StockMove = app.models.StockMove;
    const StockMoveItem = app.models.StockMoveItem;
    const Warehouse = app.models.Warehouse;
    const Product = app.models.Product;

    app.get('/api/stock-report', async (req, res) => {
        try {
            const { warehouse, startDate, endDate } = req.query.filter ? JSON.parse(req.query.filter) : {};

            let whereClause = {};
            if (warehouse) {
                whereClause.warehouseId = warehouse;
            }

            // Lấy danh sách kho hàng
            const warehouses = warehouse
                ? await Warehouse.find({ where: { id: warehouse } })
                : await Warehouse.find();
            let totalWarehouses = warehouses.length;

            // Lấy tất cả StockMoveItems theo kho được chọn
            const stockMoveItems = await StockMoveItem.find({ where: whereClause });

            // Gom nhóm theo sản phẩm & kho để tính tồn kho
            let warehouseStockReport = {};
            stockMoveItems.forEach(item => {
                let warehouseId = item.warehouseId;
                if (!warehouseStockReport[warehouseId]) {
                    warehouseStockReport[warehouseId] = {};
                }
                if (!warehouseStockReport[warehouseId][item.productId]) {
                    warehouseStockReport[warehouseId][item.productId] = { quantity: 0, value: 0 };
                }
            });

            // Lấy tất cả các StockMove có liên quan
            let stockMoveWhere = { ...whereClause };
            if (startDate && endDate) {
                stockMoveWhere.completedAt = { between: [new Date(startDate), new Date(endDate)] };
            }
            const stockMoves = await StockMove.find({ where: stockMoveWhere });

            // Xác định danh sách nhập kho & xuất kho dựa trên type
            const stockMoveIds = stockMoves.map(m => m.id);
            const stockMoveItemsFull = await StockMoveItem.find({ where: { stockMoveId: { inq: stockMoveIds } } });

            let totalStockIn = 0, totalStockOut = 0;
            let totalStockInValue = 0, totalStockOutValue = 0;

            stockMoveItemsFull.forEach(item => {
                let stockMove = stockMoves.find(m => m.id === item.stockMoveId);
                if (!stockMove) return;

                let warehouseId = item.warehouseId;

                if (["adding", "return"].includes(stockMove.type)) {
                    // Nhập kho
                    totalStockIn += item.quantity;
                    totalStockInValue += item.quantity * item.buyingPrice;
                    warehouseStockReport[warehouseId][item.productId].quantity += item.quantity;
                    warehouseStockReport[warehouseId][item.productId].value += item.quantity * item.buyingPrice;
                }

                if (["online-sale", "offline-sale", "damaged", "expired"].includes(stockMove.type)) {
                    // Xuất kho
                    totalStockOut += item.quantity;
                    totalStockOutValue += item.quantity * item.price;
                    warehouseStockReport[warehouseId][item.productId].quantity -= item.quantity;
                }
            });

            // Lấy danh sách sản phẩm tồn kho
            let productIds = new Set();
            for (let warehouseId in warehouseStockReport) {
                for (let productId in warehouseStockReport[warehouseId]) {
                    productIds.add(productId);
                }
            }

            let products = productIds.size > 0
                ? await Product.find({ where: { id: { inq: Array.from(productIds) } } })
                : [];

            // Tạo danh sách sản phẩm tồn kho theo từng kho
            let warehouseStockList = [];
            for (let warehouseId in warehouseStockReport) {
                for (let productId in warehouseStockReport[warehouseId]) {
                    let product = products.find(p => p.id === productId);
                    if (!product) continue;

                    warehouseStockList.push({
                        warehouse: warehouses.find(w => w.id === warehouseId)?.name || "Không xác định",
                        product: product.name,
                        quantity: warehouseStockReport[warehouseId][productId].quantity,
                        value: warehouseStockReport[warehouseId][productId].value
                    });
                }
            }

            // Tính tổng tồn kho & giá trị tồn kho
            let totalStockQuantity = warehouseStockList.reduce((sum, p) => sum + p.quantity, 0);
            let totalStockValue = warehouseStockList.reduce((sum, p) => sum + p.value, 0);

            res.json({
                totalWarehouses,
                totalStockQuantity,
                totalStockValue,
                totalStockIn,
                totalStockInValue,
                totalStockOut,
                totalStockOutValue,
                warehouseStockReport: warehouseStockList
            });

        } catch (error) {
            res.status(500).json({ error: "Internal Server Error", details: error.message });
        }
    });
};
