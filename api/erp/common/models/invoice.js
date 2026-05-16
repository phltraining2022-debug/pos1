'use strict';

var moment = require('moment');
var app = require('../../server/server');

module.exports = function(Invoice) {

    /**
     * Helper function to get start date from period parameter
     */
    function getStartDateFromPeriod(period) {
        var dateRange = getDateRangeFromPeriod(period || '30days');
        return dateRange.startDate;
    }

    // Revenue Report - Báo cáo doanh thu
    Invoice.revenueReport = function(period, cb) {
        var startDate = getStartDateFromPeriod(period);

        var filter = {
            where: {
                invoiceDate: { gte: startDate },
                status: { neq: 'cancelled' }
            }
        };

        Invoice.find(filter, function(err, invoices) {
            if (err) return cb(err);

            var totalRevenue = 0;
            var totalInvoices = invoices.length;
            var avgInvoiceValue = 0;

            if (totalInvoices > 0) {
                totalRevenue = invoices.reduce(function(sum, invoice) {
                    return sum + (invoice.totalAmount || 0);
                }, 0);

                avgInvoiceValue = totalRevenue / totalInvoices;
            }

            var result = {
                totalRevenue: totalRevenue,
                totalInvoices: totalInvoices,
                avgInvoiceValue: avgInvoiceValue,
                period: period
            };

            cb(null, result);
        });
    };

    Invoice.remoteMethod('revenueReport', {
        accepts: [
            { arg: 'period', type: 'string', required: true, description: 'Period: 7days, 30days, 3months, 1year' }
        ],
        returns: { type: 'object', root: true },
        http: { path: '/revenue-report', verb: 'get' },
        description: 'Get revenue report for karaoke invoices'
    });

    // Customer Stats - Thống kê khách hàng
    Invoice.customerStats = function(period, cb) {
        var startDate = getStartDateFromPeriod(period);

        var filter = {
            where: {
                invoiceDate: { gte: startDate },
                status: { neq: 'cancelled' }
            },
            include: ['customer']
        };

        Invoice.find(filter, function(err, invoices) {
            if (err) return cb(err);

            var totalCustomers = new Set();
            var totalInvoices = invoices.length;
            var avgCustomersPerDay = 0;

            // Count unique customers
            invoices.forEach(function(invoice) {
                if (invoice.customerId) {
                    totalCustomers.add(invoice.customerId);
                }
            });

            // Calculate average customers per day
            var daysDiff = moment().diff(moment(startDate), 'days') + 1;
            avgCustomersPerDay = totalCustomers.size / daysDiff;

            var result = {
                totalCustomers: totalCustomers.size,
                totalInvoices: totalInvoices,
                avgCustomersPerDay: Math.round(avgCustomersPerDay * 100) / 100,
                period: period
            };

            cb(null, result);
        });
    };

    Invoice.remoteMethod('customerStats', {
        accepts: [
            { arg: 'period', type: 'string', required: true, description: 'Period: 7days, 30days, 3months, 1year' }
        ],
        returns: { type: 'object', root: true },
        http: { path: '/customer-stats', verb: 'get' },
        description: 'Get customer statistics for karaoke invoices'
    });

    // P&L Report - Báo cáo lãi lỗ
    Invoice.plReport = function(period, cb) {
        var startDate = getStartDateFromPeriod(period);

        var filter = {
            where: {
                invoiceDate: { gte: startDate },
                status: { neq: 'cancelled' }
            }
        };

        Invoice.find(filter, function(err, invoices) {
            if (err) return cb(err);

            var totalRevenue = 0;
            var totalCost = 0;
            var totalInvoices = invoices.length;

            invoices.forEach(function(invoice) {
                totalRevenue += invoice.totalAmount || 0;
                totalCost += invoice.totalCost || 0;
            });

            var grossProfit = totalRevenue - totalCost;
            var netProfit = grossProfit; // Simplified, can add more calculations

            var result = {
                totalRevenue: totalRevenue,
                totalCost: totalCost,
                grossProfit: grossProfit,
                netProfit: netProfit,
                totalInvoices: totalInvoices,
                profitMargin: totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0,
                period: period
            };

            cb(null, result);
        });
    };

    Invoice.remoteMethod('plReport', {
        accepts: [
            { arg: 'period', type: 'string', required: true, description: 'Period: 7days, 30days, 3months, 1year' }
        ],
        returns: { type: 'object', root: true },
        http: { path: '/pl-report', verb: 'get' },
        description: 'Get profit & loss report for karaoke invoices'
    });

    // Karaoke Room Utilization Report
    Invoice.roomUtilization = function(period, cb) {
        var startDate = getStartDateFromPeriod(period);

        var filter = {
            where: {
                invoiceDate: { gte: startDate },
                status: { neq: 'cancelled' },
                roomId: { neq: null }
            },
            include: ['room']
        };

        Invoice.find(filter, function(err, invoices) {
            if (err) return cb(err);

            var roomStats = {};
            var totalHours = 0;
            var totalRevenue = 0;

            invoices.forEach(function(invoice) {
                var roomId = invoice.roomId;
                if (roomId) {
                    if (!roomStats[roomId]) {
                        roomStats[roomId] = {
                            roomId: roomId,
                            roomName: invoice.room ? invoice.room.name : 'Unknown Room',
                            totalInvoices: 0,
                            totalRevenue: 0,
                            totalHours: 0
                        };
                    }

                    roomStats[roomId].totalInvoices += 1;
                    roomStats[roomId].totalRevenue += invoice.totalAmount || 0;
                    // Assuming 2 hours per booking, can be calculated from booking data
                    roomStats[roomId].totalHours += 2;

                    totalHours += 2;
                    totalRevenue += invoice.totalAmount || 0;
                }
            });

            var roomUtilization = Object.values(roomStats).map(function(stat) {
                stat.avgRevenuePerHour = stat.totalHours > 0 ? stat.totalRevenue / stat.totalHours : 0;
                return stat;
            });

            var result = {
                roomUtilization: roomUtilization,
                totalRooms: roomUtilization.length,
                totalHours: totalHours,
                totalRevenue: totalRevenue,
                avgRevenuePerHour: totalHours > 0 ? totalRevenue / totalHours : 0,
                period: period
            };

            cb(null, result);
        });
    };

    Invoice.remoteMethod('roomUtilization', {
        accepts: [
            { arg: 'period', type: 'string', required: true, description: 'Period: 7days, 30days, 3months, 1year' }
        ],
        returns: { type: 'object', root: true },
        http: { path: '/room-utilization', verb: 'get' },
        description: 'Get room utilization report for karaoke'
    });

    // Daily Revenue Trend
    Invoice.dailyRevenueTrend = function(period, cb) {
        var startDate = getStartDateFromPeriod(period);

        var filter = {
            where: {
                invoiceDate: { gte: startDate },
                status: { neq: 'cancelled' }
            },
            order: 'invoiceDate ASC'
        };

        Invoice.find(filter, function(err, invoices) {
            if (err) return cb(err);

            var dailyStats = {};
            var currentDate = moment(startDate);

            // Initialize all dates in period
            while (currentDate.isSameOrBefore(moment())) {
                var dateKey = currentDate.format('YYYY-MM-DD');
                dailyStats[dateKey] = {
                    date: dateKey,
                    revenue: 0,
                    invoiceCount: 0
                };
                currentDate.add(1, 'day');
            }

            // Aggregate invoice data
            invoices.forEach(function(invoice) {
                var dateKey = moment(invoice.invoiceDate).format('YYYY-MM-DD');
                if (dailyStats[dateKey]) {
                    dailyStats[dateKey].revenue += invoice.totalAmount || 0;
                    dailyStats[dateKey].invoiceCount += 1;
                }
            });

            var trend = Object.values(dailyStats);

            var result = {
                dailyTrend: trend,
                totalDays: trend.length,
                totalRevenue: trend.reduce(function(sum, day) { return sum + day.revenue; }, 0),
                avgDailyRevenue: trend.length > 0 ? trend.reduce(function(sum, day) { return sum + day.revenue; }, 0) / trend.length : 0,
                period: period
            };

            cb(null, result);
        });
    };

    Invoice.remoteMethod('dailyRevenueTrend', {
        accepts: [
            { arg: 'period', type: 'string', required: true, description: 'Period: 7days, 30days, 3months, 1year' }
        ],
        returns: { type: 'object', root: true },
        http: { path: '/daily-revenue-trend', verb: 'get' },
        description: 'Get daily revenue trend for karaoke'
    });

    // Payment Methods Analysis
    Invoice.paymentMethodsAnalysis = function(period, cb) {
        var startDate = getStartDateFromPeriod(period);

        var filter = {
            where: {
                invoiceDate: { gte: startDate },
                status: { neq: 'cancelled' }
            },
            include: ['transactions']
        };

        Invoice.find(filter, function(err, invoices) {
            if (err) return cb(err);

            var paymentStats = {};
            var totalRevenue = 0;

            invoices.forEach(function(invoice) {
                totalRevenue += invoice.totalAmount || 0;

                // Analyze transactions for payment methods
                if (invoice.transactions && Array.isArray(invoice.transactions)) {
                    invoice.transactions.forEach(function(transaction) {
                        var method = transaction.paymentMethod || 'cash'; // Default to cash
                        var amount = transaction.amount || 0;

                        if (!paymentStats[method]) {
                            paymentStats[method] = {
                                method: method,
                                totalAmount: 0,
                                transactionCount: 0
                            };
                        }

                        paymentStats[method].totalAmount += amount;
                        paymentStats[method].transactionCount += 1;
                    });
                } else {
                    // If no transactions, assume cash payment
                    var method = 'cash';
                    var amount = invoice.paidAmount || invoice.totalAmount || 0;

                    if (!paymentStats[method]) {
                        paymentStats[method] = {
                            method: method,
                            totalAmount: 0,
                            transactionCount: 0
                        };
                    }

                    paymentStats[method].totalAmount += amount;
                    paymentStats[method].transactionCount += 1;
                }
            });

            var paymentMethods = Object.values(paymentStats).map(function(stat) {
                stat.percentage = totalRevenue > 0 ? (stat.totalAmount / totalRevenue * 100) : 0;
                return stat;
            });

            var result = {
                paymentMethods: paymentMethods,
                totalRevenue: totalRevenue,
                period: period
            };

            cb(null, result);
        });
    };

    Invoice.remoteMethod('paymentMethodsAnalysis', {
        accepts: [
            { arg: 'period', type: 'string', required: true, description: 'Period: 7days, 30days, 3months, 1year' }
        ],
        returns: { type: 'object', root: true },
        http: { path: '/payment-methods-analysis', verb: 'get' },
        description: 'Get payment methods analysis for karaoke invoices'
    });

    // ==================== KARAOKE REPORT APIs ====================
    
    /**
     * Helper function to get date range from period parameter
     */
    function getDateRangeFromPeriod(period) {
        var endDate = moment().endOf('day');
        var startDate;

        // Handle custom date range format: custom:YYYY-MM-DD:YYYY-MM-DD
        // A "day" runs from 12:00 noon Vietnam time (05:00 UTC) to 12:00 noon next day
        if (period && period.startsWith('custom:')) {
            var parts = period.split(':');
            if (parts.length === 3) {
                // Business day = noon-to-noon Vietnam time (UTC+7, noon = 05:00 UTC)
                // If current VN time < 12:00 → window shifts back 1 day (yesterday noon → today noon)
                // If current VN time >= 12:00 → window is today noon → tomorrow noon
                var nowVNHour = moment().utcOffset(7).hour();
                if (nowVNHour < 12) {
                    startDate = moment.utc(parts[1], 'YYYY-MM-DD').subtract(1, 'day').add(5, 'hours');
                    endDate   = moment.utc(parts[2], 'YYYY-MM-DD').add(5, 'hours');
                } else {
                    startDate = moment.utc(parts[1], 'YYYY-MM-DD').add(5, 'hours');
                    endDate   = moment.utc(parts[2], 'YYYY-MM-DD').add(1, 'day').add(5, 'hours');
                }
                
                if (startDate.isValid() && endDate.isValid()) {
                    return {
                        startDate: startDate.toDate(),
                        endDate: endDate.toDate()
                    };
                }
            }
        }

        switch(period) {
            case '7days':
                startDate = moment().subtract(7, 'days').startOf('day');
                break;
            case '30days':
                startDate = moment().subtract(30, 'days').startOf('day');
                break;
            case '3months':
                startDate = moment().subtract(3, 'months').startOf('day');
                break;
            case '1year':
                startDate = moment().subtract(1, 'year').startOf('day');
                break;
            default:
                startDate = moment().subtract(30, 'days').startOf('day');
        }

        return {
            startDate: startDate.toDate(),
            endDate: endDate.toDate()
        };
    }

    /**
     * Daily Revenue Trend - Xu hướng doanh thu theo ngày
     * GET /Invoices/daily-revenue-trend
     */
    Invoice.dailyRevenueTrend = function(period, cb) {
        var dateRange = getDateRangeFromPeriod(period || '30days');
        
        Invoice.find({
            where: {
                status: { inq: ['paid', 'partial'] },
                invoiceDate: {
                    between: [dateRange.startDate, dateRange.endDate]
                }
            }
        }, function(err, invoices) {
            if (err) return cb(err);

            // Group by day
            var dailyMap = {};
            var totalRevenue = 0;

            invoices.forEach(function(invoice) {
                // Convert to Vietnam time (UTC+7), then shift -12h so noon-to-noon = same day
                var dateKey = moment(invoice.invoiceDate).utcOffset(7).subtract(12, 'hours').format('YYYY-MM-DD');
                var revenue = Number(invoice.paidAmount || invoice.totalAmount || 0);
                
                if (!dailyMap[dateKey]) {
                    dailyMap[dateKey] = {
                        date: dateKey,
                        revenue: 0,
                        invoiceCount: 0
                    };
                }
                
                dailyMap[dateKey].revenue += revenue;
                dailyMap[dateKey].invoiceCount++;
                totalRevenue += revenue;
            });

            // Convert to array and sort by date
            var dailyTrend = Object.keys(dailyMap).map(function(key) {
                return {
                    date: dailyMap[key].date,
                    revenue: Math.round(dailyMap[key].revenue),
                    invoiceCount: dailyMap[key].invoiceCount
                };
            }).sort(function(a, b) {
                return a.date.localeCompare(b.date);
            });

            var avgDailyRevenue = dailyTrend.length > 0 ? totalRevenue / dailyTrend.length : 0;

            cb(null, {
                dailyTrend: dailyTrend,
                totalRevenue: Math.round(totalRevenue),
                avgDailyRevenue: Math.round(avgDailyRevenue),
                period: period
            });
        });
    };

    Invoice.remoteMethod('dailyRevenueTrend', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/daily-revenue-trend', verb: 'get' },
        description: 'Xu hướng doanh thu theo ngày'
    });

    /**
     * Top Products - Sản phẩm bán chạy
     * GET /Invoices/top-products
     */
    Invoice.topProducts = function(period, limit, cb) {
        var Product = app.models.Product;
        var dateRange = getDateRangeFromPeriod(period || '30days');
        
        // Get all invoices in period with items
        Invoice.find({
            where: {
                status: { inq: ['paid', 'partial'] },
                invoiceDate: {
                    between: [dateRange.startDate, dateRange.endDate]
                }
            }
        }, function(err, invoices) {
            if (err) return cb(err);
            
            if (!invoices.length) {
                return cb(null, []);
            }

            // Group by product from embedded items
            var productMap = {};
            var productIds = [];

            invoices.forEach(function(invoice) {
                if (!invoice.items || !Array.isArray(invoice.items)) return;
                
                invoice.items.forEach(function(item) {
                    var productId = item.productId;
                    if (!productId) return;
                    
                    // Handle MongoDB ObjectId format
                    if (productId.$oid) {
                        productId = productId.$oid;
                    } else if (typeof productId === 'object') {
                        productId = productId.toString();
                    }
                    
                    if (productIds.indexOf(productId) === -1) {
                        productIds.push(productId);
                    }
                    
                    if (!productMap[productId]) {
                        productMap[productId] = {
                            productId: productId,
                            productName: item.name || '',
                            totalQuantity: 0,
                            totalRevenue: 0,
                            category: ''
                        };
                    }
                    
                    productMap[productId].totalQuantity += Number(item.quantity || 0);
                    productMap[productId].totalRevenue += Number(item.total || item.price * item.quantity || 0);
                });
            });

            // Get product info for categories
            if (productIds.length > 0 && Product) {
                Product.find({
                    where: { id: { inq: productIds } },
                    fields: ['id', 'name', 'category']
                }, function(err, products) {
                    if (err) return cb(err);
                    
                    products.forEach(function(product) {
                        var productId = product.id;
                        if (typeof productId === 'object') {
                            productId = productId.toString();
                        }
                        
                        if (productMap[productId]) {
                            productMap[productId].productName = product.name || productMap[productId].productName;
                            productMap[productId].category = product.category || 'Other';
                        }
                    });

                    // Convert to array, sort by revenue, and limit
                    var topProducts = Object.keys(productMap).map(function(key) {
                        var p = productMap[key];
                        return {
                            productId: p.productId,
                            productName: p.productName,
                            category: p.category,
                            totalQuantity: Math.round(p.totalQuantity * 100) / 100,
                            totalRevenue: Math.round(p.totalRevenue),
                            avgPrice: p.totalQuantity > 0 ? Math.round(p.totalRevenue / p.totalQuantity) : 0
                        };
                    }).sort(function(a, b) {
                        return b.totalRevenue - a.totalRevenue;
                    });

                    cb(null, topProducts);
                });
            } else {
                // No Product model or no products, return what we have
                var topProducts = Object.keys(productMap).map(function(key) {
                    var p = productMap[key];
                    return {
                        productId: p.productId,
                        productName: p.productName,
                        category: p.category || 'Other',
                        totalQuantity: Math.round(p.totalQuantity * 100) / 100,
                        totalRevenue: Math.round(p.totalRevenue),
                        avgPrice: p.totalQuantity > 0 ? Math.round(p.totalRevenue / p.totalQuantity) : 0
                    };
                }).sort(function(a, b) {
                    return b.totalRevenue - a.totalRevenue;
                }).slice(0, limit || 10);

                cb(null, topProducts);
            }
        });
    };

    Invoice.remoteMethod('topProducts', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } },
            { arg: 'limit', type: 'number', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'array', root: true },
        http: { path: '/top-products', verb: 'get' },
        description: 'Danh sách sản phẩm bán chạy'
    });

    /**
     * Customer Stats - Thống kê khách hàng
     * GET /Invoices/customer-stats
     */
    Invoice.customerStats = function(period, cb) {
        var dateRange = getDateRangeFromPeriod(period || '30days');
        
        Invoice.find({
            where: {
                status: { inq: ['paid', 'partial'] },
                invoiceDate: {
                    between: [dateRange.startDate, dateRange.endDate]
                }
            }
        }, function(err, invoices) {
            if (err) return cb(err);

            var uniqueCustomers = {};
            var dailyCustomers = {};

            invoices.forEach(function(invoice) {
                if (invoice.customerId) {
                    uniqueCustomers[invoice.customerId] = true;
                }
                
                var dateKey = moment(invoice.invoiceDate).format('YYYY-MM-DD');
                if (!dailyCustomers[dateKey]) {
                    dailyCustomers[dateKey] = {};
                }
                if (invoice.customerId) {
                    dailyCustomers[dateKey][invoice.customerId] = true;
                }
            });

            var daysDiff = moment(dateRange.endDate).diff(moment(dateRange.startDate), 'days') || 1;
            var totalCustomers = Object.keys(uniqueCustomers).length;
            var avgCustomersPerDay = totalCustomers / daysDiff;

            cb(null, {
                totalCustomers: totalCustomers,
                totalInvoices: invoices.length,
                avgCustomersPerDay: Math.round(avgCustomersPerDay * 100) / 100,
                period: period
            });
        });
    };

    Invoice.remoteMethod('customerStats', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/customer-stats', verb: 'get' },
        description: 'Thống kê khách hàng theo kỳ'
    });

    /**
     * P&L Report - Báo cáo lãi/lỗ
     * GET /Invoices/pl-report
     * Cost = sum(item.quantity * product.price)
     * Revenue = sum(item.quantity * product.sellingPrice) fallback to invoice totalAmount
     */
    Invoice.plReport = function(period, cb) {
        var Product = app.models.Product;
        var dateRange = getDateRangeFromPeriod(period || '30days');

        Invoice.find({
            where: {
                status: { inq: ['paid', 'partial'] },
                invoiceDate: {
                    between: [dateRange.startDate, dateRange.endDate]
                }
            }
        }, function(err, invoices) {
            if (err) return cb(err);

            // Collect all productIds from invoice items
            var productIds = [];
            invoices.forEach(function(invoice) {
                if (!invoice.items || !Array.isArray(invoice.items)) return;
                invoice.items.forEach(function(item) {
                    var pid = item.productId;
                    if (!pid) return;
                    if (pid.$oid) pid = pid.$oid;
                    else if (typeof pid === 'object') pid = pid.toString();
                    if (productIds.indexOf(pid) === -1) productIds.push(pid);
                });
            });

            function calcPL(productMap, expenses) {
                var totalRevenue = 0;
                var costOfGoods = 0;

                invoices.forEach(function(invoice) {
                    totalRevenue += Number(invoice.totalAmount || 0);

                    if (invoice.items && Array.isArray(invoice.items)) {
                        invoice.items.forEach(function(item) {
                            var pid = item.productId;
                            if (pid && pid.$oid) pid = pid.$oid;
                            else if (pid && typeof pid === 'object') pid = pid.toString();

                            var quantity = Number(item.quantity || 0);
                            var product = pid ? productMap[pid] : null;
                            var costPrice = product ? Number(product.price || 0) : 0;

                            costOfGoods += quantity * costPrice;
                        });
                    }
                });

                // Tổng chi phí vận hành (từ model transaction, lọc theo transactionDate)
                var operatingExpenses = expenses.reduce(function(sum, t) {
                    return sum + Number(t.amount || 0);
                }, 0);

                var grossProfit = totalRevenue - costOfGoods;
                var netProfit = grossProfit - operatingExpenses;
                var profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

                // Nhóm chi phí theo expenseType
                var expenseBreakdown = {};
                expenses.forEach(function(t) {
                    var etype = t.expenseType || 'other';
                    expenseBreakdown[etype] = (expenseBreakdown[etype] || 0) + Number(t.amount || 0);
                });

                cb(null, {
                    revenue: Math.round(totalRevenue),
                    costOfGoods: Math.round(costOfGoods),
                    grossProfit: Math.round(grossProfit),
                    operatingExpenses: Math.round(operatingExpenses),
                    expenseBreakdown: expenseBreakdown,
                    netProfit: Math.round(netProfit),
                    profitMargin: Math.round(profitMargin * 100) / 100,
                    totalInvoices: invoices.length,
                    totalExpenses: expenses.length,
                    period: period
                });
            }

            // Fetch expenses filtered by transactionDate
            var Transaction = app.models.transaction;
            Transaction.find({
                where: {
                    type: 'expense',
                    approvalStatus: 'approved',
                    transactionDate: {
                        between: [dateRange.startDate, dateRange.endDate]
                    }
                }
            }, function(err, expenses) {
                if (err) expenses = []; // không fail report nếu lỗi

                if (productIds.length > 0 && Product) {
                    Product.find({
                        where: { id: { inq: productIds } },
                        fields: ['id', 'price', 'sellingPrice']
                    }, function(err, products) {
                        if (err) return cb(err);
                        var productMap = {};
                        products.forEach(function(p) {
                            var pid = p.id;
                            if (typeof pid === 'object') pid = pid.toString();
                            productMap[pid] = p;
                        });
                        calcPL(productMap, expenses);
                    });
                } else {
                    calcPL({}, expenses);
                }
            });
        });
    };

    Invoice.remoteMethod('plReport', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/pl-report', verb: 'get' },
        description: 'Báo cáo lãi/lỗ (P&L) theo kỳ'
    });

    /**
     * Summary Stats - Thống kê tổng quan cho dashboard
     * GET /Invoices/summary-stats
     */
    Invoice.summaryStats = function(period, cb) {
        var dateRange = getDateRangeFromPeriod(period || '30days');
        
        Invoice.find({
            where: {
                status: { inq: ['paid', 'partial'] },
                invoiceDate: {
                    between: [dateRange.startDate, dateRange.endDate]
                }
            }
        }, function(err, invoices) {
            if (err) return cb(err);

            var totalRevenue = 0;
            var totalSessionTime = 0;
            var sessionCount = 0;
            var uniqueCustomers = {};
            var totalRating = 0;
            var ratingCount = 0;

            invoices.forEach(function(invoice) {
                totalRevenue += Number(invoice.paidAmount || invoice.totalAmount || 0);
                
                if (invoice.customerId) {
                    uniqueCustomers[invoice.customerId] = true;
                }
                
                if (invoice.sessionDuration) {
                    totalSessionTime += Number(invoice.sessionDuration);
                    sessionCount++;
                }
                
                if (invoice.customerRating) {
                    totalRating += Number(invoice.customerRating);
                    ratingCount++;
                }
            });

            var daysDiff = moment(dateRange.endDate).diff(moment(dateRange.startDate), 'days') || 1;
            var customerCount = Object.keys(uniqueCustomers).length;
            var avgCustomersPerDay = customerCount / daysDiff;
            var avgSessionTime = sessionCount > 0 ? totalSessionTime / sessionCount : 0;
            var avgRating = ratingCount > 0 ? totalRating / ratingCount : 0;

            // Get profit from P&L
            Invoice.plReport(period, function(err, plData) {
                if (err) return cb(err);

                cb(null, {
                    totalRevenue: Math.round(totalRevenue),
                    avgCustomersPerDay: Math.round(avgCustomersPerDay * 100) / 100,
                    avgSessionTime: Math.round(avgSessionTime * 10) / 10,
                    avgRating: Math.round(avgRating * 10) / 10,
                    totalProfit: plData.netProfit,
                    totalInvoices: invoices.length,
                    period: period
                });
            });
        });
    };

    Invoice.remoteMethod('summaryStats', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/summary-stats', verb: 'get' },
        description: 'Thống kê tổng quan cho dashboard'
    });

    /**
     * Revenue by Room - Doanh thu theo phòng
     * GET /Invoices/revenue-by-room
     */
    Invoice.revenueByRoom = function(period, cb) {
        var dateRange = getDateRangeFromPeriod(period || '30days');
        
        Invoice.find({
            where: {
                status: { inq: ['paid', 'partial'] },
                invoiceDate: {
                    between: [dateRange.startDate, dateRange.endDate]
                },
                roomId: { neq: null }
            },
            include: ['room']
        }, function(err, invoices) {
            if (err) return cb(err);

            var roomRevenue = {};
            var totalRevenue = 0;

            invoices.forEach(function(invoice) {
                var roomId = invoice.roomId;
                var revenue = Number(invoice.paidAmount || invoice.totalAmount || 0);
                
                if (roomId && revenue > 0) {
                    if (!roomRevenue[roomId]) {
                        roomRevenue[roomId] = {
                            roomId: roomId,
                            roomName: invoice.room ? invoice.room.name : 'Unknown Room',
                            totalRevenue: 0,
                            invoiceCount: 0,
                            avgRevenuePerInvoice: 0
                        };
                    }
                    
                    roomRevenue[roomId].totalRevenue += revenue;
                    roomRevenue[roomId].invoiceCount += 1;
                    totalRevenue += revenue;
                }
            });

            // Calculate averages and percentages
            var revenueByRoom = Object.values(roomRevenue).map(function(room) {
                room.avgRevenuePerInvoice = room.invoiceCount > 0 ? Math.round(room.totalRevenue / room.invoiceCount) : 0;
                room.percentage = totalRevenue > 0 ? Math.round((room.totalRevenue / totalRevenue) * 100 * 100) / 100 : 0;
                room.totalRevenue = Math.round(room.totalRevenue);
                return room;
            }).sort(function(a, b) {
                return b.totalRevenue - a.totalRevenue;
            });

            cb(null, {
                revenueByRoom: revenueByRoom,
                totalRevenue: Math.round(totalRevenue),
                totalRooms: revenueByRoom.length,
                period: period
            });
        });
    };

    Invoice.remoteMethod('revenueByRoom', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/revenue-by-room', verb: 'get' },
        description: 'Doanh thu theo phòng'
    });

    /**
     * Profit Loss - Alias for P&L Report
     * GET /Invoices/profit-loss
     */
    Invoice.profitLoss = function(period, cb) {
        Invoice.plReport(period, cb);
    };

    Invoice.remoteMethod('profitLoss', {
        accepts: [
            { arg: 'period', type: 'string', http: { source: 'query' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/profit-loss', verb: 'get' },
        description: 'Báo cáo lãi/lỗ (alias)'
    });

    // Tính lại adjustedTotalAmount trên hoá đơn gốc khi có hoá đơn điều chỉnh được lưu
    Invoice.observe('after save', async function(ctx) {
        const data = ctx.instance || ctx.data;
        if (!data || !data.isAdjustment || !data.originalInvoiceId) return;
        try {
            const originalInvoiceId = data.originalInvoiceId.toString();
            const [original, adjustments] = await Promise.all([
                Invoice.findById(originalInvoiceId),
                Invoice.find({ where: { originalInvoiceId: originalInvoiceId, isAdjustment: true } })
            ]);
            if (!original) return;
            const adjustmentSum = adjustments.reduce((sum, adj) => sum + (adj.totalAmount || 0), 0);
            const adjustedTotal = (original.totalAmount || 0) + adjustmentSum;
            await original.updateAttributes({ adjustedTotalAmount: adjustedTotal });
            console.log('[Invoice] adjustedTotalAmount updated for', originalInvoiceId, ':', adjustedTotal);
        } catch (err) {
            console.error('[Invoice] Error recalculating adjustedTotalAmount:', err.message);
        }
    });
};
