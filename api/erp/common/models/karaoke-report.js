module.exports = function(Invoice) {
  
  /**
   * Helper function to handle float arithmetic precision
   */
  function roundFloat(value, decimals = 2) {
    const multiplier = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }

  /**
   * Helper function to get date range from period parameter
   */
  function getDateRange(period) {
    const moment = require('moment');
    const endDate = moment().endOf('day');
    let startDate;

    // Handle custom date range format: custom:YYYY-MM-DD:YYYY-MM-DD
    if (period && period.startsWith('custom:')) {
      const parts = period.split(':');
      if (parts.length === 3) {
        startDate = moment(parts[1], 'YYYY-MM-DD').startOf('day');
        endDate = moment(parts[2], 'YYYY-MM-DD').endOf('day');
        
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
   * 1. Revenue Report - Báo cáo doanh thu tổng quan
   * GET /Invoices/revenue-report
   */
  Invoice.revenueReport = async function(period) {
    const app = require('../../server/server');
    const moment = require('moment');
    
    const dateRange = getDateRange(period || '30days');
    
    // Get all paid invoices in period
    const invoices = await Invoice.find({
      where: {
        status: { inq: ['paid', 'partial'] },
        invoiceDate: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      },
      include: ['items', 'customer']
    });

    // Calculate totals
    let totalRevenue = 0;
    let totalInvoices = invoices.length;
    let totalCustomers = new Set();

    for (const invoice of invoices) {
      totalRevenue += Number(invoice.paidAmount || invoice.totalAmount || 0);
      if (invoice.customerId) totalCustomers.add(invoice.customerId);
    }

    const avgInvoiceValue = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

    return {
      totalRevenue: roundFloat(totalRevenue, 0),
      totalInvoices: totalInvoices,
      totalCustomers: totalCustomers.size,
      avgInvoiceValue: roundFloat(avgInvoiceValue, 0),
      period: period,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    };
  };

  Invoice.remoteMethod('revenueReport', {
    accepts: [
      { arg: 'period', type: 'string', http: { source: 'query' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/revenue-report', verb: 'get' },
    description: 'Báo cáo doanh thu tổng quan theo kỳ'
  });

  /**
   * 2. Daily Revenue Trend - Xu hướng doanh thu theo ngày
   * GET /Invoices/daily-revenue-trend
   */
  Invoice.dailyRevenueTrend = async function(period) {
    const moment = require('moment');
    const dateRange = getDateRange(period || '30days');
    
    const invoices = await Invoice.find({
      where: {
        status: { inq: ['paid', 'partial'] },
        invoiceDate: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      }
    });

    // Group by day
    const dailyMap = {};
    let totalRevenue = 0;

    for (const invoice of invoices) {
      const dateKey = moment(invoice.invoiceDate).format('YYYY-MM-DD');
      const revenue = Number(invoice.paidAmount || invoice.totalAmount || 0);
      
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
    }

    // Convert to array and sort by date
    const dailyTrend = Object.values(dailyMap)
      .map(day => ({
        date: day.date,
        revenue: roundFloat(day.revenue, 0),
        invoiceCount: day.invoiceCount
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const avgDailyRevenue = dailyTrend.length > 0 ? totalRevenue / dailyTrend.length : 0;

    return {
      dailyTrend: dailyTrend,
      totalRevenue: roundFloat(totalRevenue, 0),
      avgDailyRevenue: roundFloat(avgDailyRevenue, 0),
      period: period
    };
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
   * 3. Top Products - Sản phẩm bán chạy
   * GET /Invoices/top-products
   */
  Invoice.topProducts = async function(period, limit) {
    const app = require('../../server/server');
    const InvoiceItem = app.models.InvoiceItem;
    const Product = app.models.Product;
    
    const dateRange = getDateRange(period || '30days');
    
    // Get all invoice items in period
    const invoices = await Invoice.find({
      where: {
        status: { inq: ['paid', 'partial'] },
        invoiceDate: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      },
      fields: ['id']
    });

    const invoiceIds = invoices.map(inv => inv.id);
    
    if (!invoiceIds.length) {
      return [];
    }

    // Get invoice items
    const items = await InvoiceItem.find({
      where: {
        invoiceId: { inq: invoiceIds }
      }
    });

    // Group by product
    const productMap = {};
    const productIds = new Set();

    for (const item of items) {
      if (!item.productId) continue;
      
      productIds.add(item.productId);
      
      if (!productMap[item.productId]) {
        productMap[item.productId] = {
          productId: item.productId,
          productName: item.productName || '',
          totalQuantity: 0,
          totalRevenue: 0,
          category: ''
        };
      }
      
      productMap[item.productId].totalQuantity += Number(item.quantity || 0);
      productMap[item.productId].totalRevenue += Number(item.amount || 0);
    }

    // Get product info for categories
    if (productIds.size > 0) {
      const products = await Product.find({
        where: { id: { inq: Array.from(productIds) } },
        fields: ['id', 'name', 'category']
      });
      
      products.forEach(product => {
        if (productMap[product.id]) {
          productMap[product.id].productName = product.name || productMap[product.id].productName;
          productMap[product.id].category = product.category || 'Other';
        }
      });
    }

    // Convert to array, sort by revenue, and limit
    const topProducts = Object.values(productMap)
      .map(p => ({
        productId: p.productId,
        productName: p.productName,
        category: p.category,
        totalQuantity: roundFloat(p.totalQuantity, 2),
        totalRevenue: roundFloat(p.totalRevenue, 0),
        avgPrice: p.totalQuantity > 0 ? roundFloat(p.totalRevenue / p.totalQuantity, 0) : 0
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit || 10);

    return topProducts;
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
   * 4. Customer Stats - Thống kê khách hàng
   * GET /Invoices/customer-stats
   */
  Invoice.customerStats = async function(period) {
    const dateRange = getDateRange(period || '30days');
    const moment = require('moment');
    
    const invoices = await Invoice.find({
      where: {
        status: { inq: ['paid', 'partial'] },
        invoiceDate: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      }
    });

    const uniqueCustomers = new Set();
    const dailyCustomers = {};

    for (const invoice of invoices) {
      if (invoice.customerId) {
        uniqueCustomers.add(invoice.customerId);
      }
      
      const dateKey = moment(invoice.invoiceDate).format('YYYY-MM-DD');
      if (!dailyCustomers[dateKey]) {
        dailyCustomers[dateKey] = new Set();
      }
      if (invoice.customerId) {
        dailyCustomers[dateKey].add(invoice.customerId);
      }
    }

    const daysDiff = moment(dateRange.endDate).diff(moment(dateRange.startDate), 'days') || 1;
    const avgCustomersPerDay = uniqueCustomers.size / daysDiff;

    return {
      totalCustomers: uniqueCustomers.size,
      totalInvoices: invoices.length,
      avgCustomersPerDay: roundFloat(avgCustomersPerDay, 2),
      period: period
    };
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
   * 5. P&L Report - Báo cáo lãi/lỗ
   * GET /Invoices/pl-report
   */
  Invoice.plReport = async function(period) {
    const app = require('../../server/server');
    const StockMove = app.models.StockMove;
    const moment = require('moment');
    
    const dateRange = getDateRange(period || '30days');
    
    // Get revenue from invoices
    const invoices = await Invoice.find({
      where: {
        status: { inq: ['paid', 'partial'] },
        invoiceDate: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      }
    });

    let totalRevenue = 0;
    for (const invoice of invoices) {
      totalRevenue += Number(invoice.paidAmount || invoice.totalAmount || 0);
    }

    // Get cost of goods from stock movements (exports)
    const stockMoves = await StockMove.find({
      where: {
        type: { inq: ['export', 'offline-sale', 'production'] },
        status: 'completed',
        completedAt: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      },
      include: ['items']
    });

    let costOfGoods = 0;
    for (const move of stockMoves) {
      const items = move.items ? move.items() : [];
      for (const item of items) {
        const quantity = Number(item.quantity || 0);
        const price = Number(item.unitPrice || item.price || 0);
        costOfGoods += quantity * price;
      }
    }

    // Estimate operating costs (should come from a separate expense tracking system)
    const daysDiff = moment(dateRange.endDate).diff(moment(dateRange.startDate), 'days') || 1;
    const monthMultiplier = daysDiff / 30;
    
    const monthlyOperatingCosts = {
      staff: 15000000,
      utilities: 8000000,
      maintenance: 3000000,
      other: 2000000
    };

    const operatingCosts = {
      staff: roundFloat(monthlyOperatingCosts.staff * monthMultiplier, 0),
      utilities: roundFloat(monthlyOperatingCosts.utilities * monthMultiplier, 0),
      maintenance: roundFloat(monthlyOperatingCosts.maintenance * monthMultiplier, 0),
      other: roundFloat(monthlyOperatingCosts.other * monthMultiplier, 0)
    };

    const totalOperatingCosts = Object.values(operatingCosts).reduce((sum, val) => sum + val, 0);
    const grossProfit = totalRevenue - costOfGoods;
    const netProfit = grossProfit - totalOperatingCosts;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      revenue: roundFloat(totalRevenue, 0),
      costOfGoods: roundFloat(costOfGoods, 0),
      grossProfit: roundFloat(grossProfit, 0),
      operatingCosts: operatingCosts,
      totalOperatingCosts: roundFloat(totalOperatingCosts, 0),
      netProfit: roundFloat(netProfit, 0),
      profitMargin: roundFloat(profitMargin, 2),
      totalInvoices: invoices.length,
      period: period
    };
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
   * 6. Summary Stats - Thống kê tổng quan cho dashboard
   * GET /Invoices/summary-stats
   */
  Invoice.summaryStats = async function(period) {
    const moment = require('moment');
    const dateRange = getDateRange(period || '30days');
    
    // Get all invoices in period
    const invoices = await Invoice.find({
      where: {
        status: { inq: ['paid', 'partial'] },
        invoiceDate: {
          between: [dateRange.startDate, dateRange.endDate]
        }
      }
    });

    let totalRevenue = 0;
    let totalSessionTime = 0;
    let sessionCount = 0;
    const uniqueCustomers = new Set();
    let totalRating = 0;
    let ratingCount = 0;

    for (const invoice of invoices) {
      totalRevenue += Number(invoice.paidAmount || invoice.totalAmount || 0);
      
      if (invoice.customerId) {
        uniqueCustomers.add(invoice.customerId);
      }
      
      if (invoice.sessionDuration) {
        totalSessionTime += Number(invoice.sessionDuration);
        sessionCount++;
      }
      
      if (invoice.customerRating) {
        totalRating += Number(invoice.customerRating);
        ratingCount++;
      }
    }

    const daysDiff = moment(dateRange.endDate).diff(moment(dateRange.startDate), 'days') || 1;
    const avgCustomersPerDay = uniqueCustomers.size / daysDiff;
    const avgSessionTime = sessionCount > 0 ? totalSessionTime / sessionCount : 0;
    const avgRating = ratingCount > 0 ? totalRating / ratingCount : 0;

    // Get profit from P&L
    const plData = await Invoice.plReport(period);

    return {
      totalRevenue: roundFloat(totalRevenue, 0),
      avgCustomersPerDay: roundFloat(avgCustomersPerDay, 2),
      avgSessionTime: roundFloat(avgSessionTime, 1),
      avgRating: roundFloat(avgRating, 1),
      totalProfit: plData.netProfit,
      totalInvoices: invoices.length,
      period: period
    };
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
   * 7. Profit Loss - Alias for P&L Report (for backward compatibility)
   * GET /Invoices/profit-loss
   */
  Invoice.profitLoss = async function(period) {
    return await Invoice.plReport(period);
  };

  Invoice.remoteMethod('profitLoss', {
    accepts: [
      { arg: 'period', type: 'string', http: { source: 'query' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/profit-loss', verb: 'get' },
    description: 'Báo cáo lãi/lỗ (alias)'
  });

};
