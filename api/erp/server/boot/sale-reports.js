module.exports = function (app) {
    const SaleOrder = app.models.SaleOrder;
    const SaleOrderItem = app.models.SaleOrderItem;
    const Customer = app.models.Customer;
    const Employee = app.models.Employee;
    const Payroll = app.models.Payroll;
    const Transaction = app.models.Transaction;
    const PurchaseOrder = app.models.PurchaseOrder;
    const moment = require('moment'); // Ensure moment.js is installed

    app.get('/api/sales-report', async (req, res) => {
        try {
            const { startDate, endDate, status } = req.query.filter ? JSON.parse(req.query.filter) : {};

            let whereClause = {};
            if (startDate && endDate) {
                whereClause.createdAt = { between: [new Date(startDate), new Date(endDate)] };
            }
            if (status) {
                whereClause.status = status;
            }

            // Fetch sale orders
            const saleOrders = await SaleOrder.find({
                where: whereClause,
                include: [
                    { relation: 'customer' },
                    { relation: 'salePerson' },
                    {
                        relation: 'items',
                        scope: { include: [{ relation: 'product' }] }
                    }
                ]
            });

            if (!saleOrders.length) {
                // just the emptrty response
                res.json({});
                return;
            }

            // Initialize report summary
            let totalRevenue = 0;
            let totalOrders = saleOrders.length;
            let totalProductsSold = 0;
            let totalCOGS = 0;
            let totalLaborCost = 0;
            let accountsReceivable = 0;
            let accountsPayable = 0;
            let salesByProduct = {};
            let salesByCategory = {};
            let salesBySalesperson = {};
            let salesByMonth = {};
            let newCustomers = 0;
            let returningCustomers = 0;

            // Fetch labor cost from Payroll
            const payrollData = await Payroll.find({
                where: { createdAt: { between: [new Date(startDate), new Date(endDate)] } }
            });
            totalLaborCost = payrollData.reduce((sum, payroll) => sum + payroll.salary, 0);

            // Fetch accounts payable from PurchaseOrder
            const purchaseOrders = await PurchaseOrder.find({
                where: { createdAt: { between: [new Date(startDate), new Date(endDate)] } }
            });
            accountsPayable = purchaseOrders.reduce((sum, po) => sum + (po.total - (po.paid || 0)), 0);

            // Fetch accounts receivable from SaleOrder transactions
            for (let order of saleOrders) {
                totalRevenue += order.total || 0;

                let monthKey = moment(order.createdAt).format('YYYY-MM');

                if (!salesByMonth[monthKey]) {
                    salesByMonth[monthKey] = { revenue: 0, totalOrders: 0 };
                }
                salesByMonth[monthKey].revenue += order.total || 0;
                salesByMonth[monthKey].totalOrders += 1;

                if (order.items && order.items.length) {
                    for (let item of order.items()) {
                        let product = item.product();
                        totalProductsSold += item.quantity;

                        if (product) {
                            if (!salesByProduct[product.name]) {
                                salesByProduct[product.name] = { quantity: 0, revenue: 0 };
                            }
                            salesByProduct[product.name].quantity += item.quantity;
                            salesByProduct[product.name].revenue += item.subtotal;
                        }

                        if (product?.category) {
                            if (!salesByCategory[product.category]) {
                                salesByCategory[product.category] = { quantity: 0, revenue: 0 };
                            }
                            salesByCategory[product.category].quantity += item.quantity;
                            salesByCategory[product.category].revenue += item.subtotal;
                        }

                        // Sum labor cost from services in SaleOrderItem
                        if (item.serviceId) {
                            totalLaborCost += item.unitPrice;
                        }
                    }
                }

                let salePerson = order.salePerson();
                if (salePerson) {
                    if (!salesBySalesperson[salePerson.name]) {
                        salesBySalesperson[salePerson.name] = { totalOrders: 0, revenue: 0 };
                    }
                    salesBySalesperson[salePerson.name].totalOrders += 1;
                    salesBySalesperson[salePerson.name].revenue += order.total;
                }

                let customer = order.customer();
                if (customer) {
                    if (customer.createdAt && new Date(customer.createdAt) > new Date(startDate)) {
                        newCustomers++;
                    } else {
                        returningCustomers++;
                    }
                }

                // Calculate accounts receivable from unpaid transactions
                const transactions = await Transaction.find({ where: { saleOrderId: order.id } });
                let totalPaid = transactions.reduce((sum, txn) => sum + txn.amount, 0);
                accountsReceivable += (order.total - totalPaid);
            }

            // Compute COGS from PurchaseOrders that match sold products
            for (let po of purchaseOrders) {
                totalCOGS += po.total;
            }

            // Compute profit
            let profit = totalRevenue - totalCOGS - accountsPayable - totalLaborCost;

            // Convert object data to arrays for JSON response
            let salesByProductArray = Object.keys(salesByProduct).map(key => ({
                product: key,
                quantity: salesByProduct[key].quantity,
                revenue: salesByProduct[key].revenue
            }));

            let salesByCategoryArray = Object.keys(salesByCategory).map(key => ({
                category: key,
                quantity: salesByCategory[key].quantity,
                revenue: salesByCategory[key].revenue
            }));

            let salesBySalespersonArray = Object.keys(salesBySalesperson).map(key => ({
                salesperson: key,
                totalOrders: salesBySalesperson[key].totalOrders,
                revenue: salesBySalesperson[key].revenue
            }));

            let salesByMonthArray = Object.keys(salesByMonth).map(key => ({
                month: key,
                revenue: salesByMonth[key].revenue,
                totalOrders: salesByMonth[key].totalOrders
            }));

            // Return Sales Report Data
            res.json({
                totalRevenue,
                totalOrders,
                totalProductsSold,
                averageOrderValue: totalOrders ? totalRevenue / totalOrders : 0,
                accountsReceivable,
                accountsPayable,
                totalCOGS,
                totalLaborCost,
                profit,
                salesByProduct: salesByProductArray,
                salesByCategory: salesByCategoryArray,
                salesBySalesperson: salesBySalespersonArray,
                salesByMonth: salesByMonthArray,
                newCustomers,
                returningCustomers
            });

        } catch (error) {
            res.status(500).json({ error: "Internal Server Error", details: error.message });
        }
    });
};
