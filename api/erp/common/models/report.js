module.exports = function(Report) {
  
  /**
   * Helper function to handle float arithmetic precision
   */
  function roundFloat(value, decimals = 2) {
    const multiplier = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  }

  /**
   * 0. Inventory Stats for Dashboard (Tổng quan nhanh)
   * GET /Reports/inventoryStats
   */
  Report.inventoryStats = async function(warehouseId) {
    const app = require('../../server/server');
    const StockItem = app.models.StockItem;
    const Product = app.models.Product;

    // Build filter for stock items
    const stockFilter = {
      where: {},
      fields: {
        id: true,
        productId: true,
        productName: true,
        warehouseId: true,
        warehouseName: true,
        quantity: true,
        minStockLevel: true
      }
    };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      stockFilter.where.warehouseId = warehouseId;
    }

    // Get stock items
    const stockItems = await StockItem.find(stockFilter);
    
    // Get unique product IDs
    const productIds = [...new Set(stockItems.map(item => item.productId))];
    
    // Get products with only needed fields
    const products = await Product.find({
      where: { id: { inq: productIds } },
      fields: { id: true, purchasePrice: true }
    });
    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    // Calculate stats
    const warehouseSet = new Set();
    const productSet = new Set();  // Track unique products
    let totalStock = 0;
    let lowStockItems = 0;
    let outOfStockItems = 0;
    let totalValue = 0;
    const lowStockList = [];

    for (const item of stockItems) {
      productSet.add(item.productId);  // Count unique products
      const qty = Number(item.quantity) || 0;
      totalStock += qty;
      
      if (qty === 0) {
        outOfStockItems++;
      } else if (qty <= (item.minStockLevel || 0)) {
        lowStockItems++;
        lowStockList.push({
          productName: item.productName,
          warehouseName: item.warehouseName,
          quantity: qty,
          minStock: item.minStockLevel || 0
        });
      }
      
      const product = productMap[item.productId];
      if (product && product.purchasePrice) {
        totalValue += qty * Number(product.purchasePrice);
      }
      
      if (item.warehouseId) warehouseSet.add(item.warehouseId);
    }

    return {
      totalProducts: productSet.size,  // Use unique product count
      totalStock: roundFloat(totalStock, 0),
      lowStockItems: lowStockItems,
      outOfStockItems: outOfStockItems,
      totalValue: roundFloat(totalValue, 0),
      warehouses: warehouseSet.size,
      lowStockList: lowStockList
    };
  };

  Report.remoteMethod('inventoryStats', {
    accepts: [
      { arg: 'warehouseId', type: 'string', http: { source: 'query' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/inventoryStats', verb: 'get' },
    description: 'Thống kê tổng quan kho hàng cho dashboard'
  });

  /**
   * 1. Inventory Summary Report (Tổng hợp tồn kho - giống Misa)
   * POST /Reports/inventorySummary
   */
  Report.inventorySummary = async function(warehouseId, productType, startDate, endDate) {

    const app = require('../../server/server');
    // const StockItem = app.models.StockItem; // Already declared at top, remove duplicate
    const StockMove = app.models.StockMove;
    const StockMoveItem = app.models.StockMoveItem;
    const Product = app.models.Product;
    const moment = require('moment');

    // Build StockMove filter
    const moveFilter = {
      where: { status: 'completed' },
      include: ['items']
    };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      moveFilter.where.warehouseId = warehouseId;
    }
    if (startDate && endDate) {
      const startMoment = moment(startDate).startOf('day');
      const endMoment = moment(endDate).endOf('day');
      moveFilter.where.createdAt = {
        between: [startMoment.toDate(), endMoment.toDate()]
      };
    }
    // Only filter by productType if provided
    let productTypeFilter = null;
    if (productType && productType !== 'null' && productType !== null && productType !== undefined && productType !== '') {
      productTypeFilter = productType;
    }
    console.log('[inventorySummary] moveFilter:', JSON.stringify(moveFilter));

    // Get all StockMoves with items
    const stockMoves = await StockMove.find(moveFilter);
    console.log('[inventorySummary] stockMoves.length:', stockMoves.length);
    if (stockMoves.length) {
      console.log('[inventorySummary] all StockMove:', JSON.stringify(stockMoves, null, 2));
    }
    // Build movement map: productId -> { import, export }
    const movementMap = {};
    const increaseTypes = ['adding', 'import', 'return', 'adjustment'];
    const decreaseTypes = ['online-sale', 'export', 'offline-sale', 'transfer', 'damaged', 'expired', 'production'];

    for (const move of stockMoves) {
      for (const moveItem of move.items()) {
        const productId = moveItem.productId;
        if (!productId) continue;
        if (!movementMap[productId]) movementMap[productId] = { import: 0, export: 0 };
        const qty = Number(moveItem.quantity) || 0;
        if (increaseTypes.includes(move.type)) {
          movementMap[productId].import += qty;
        } else if (decreaseTypes.includes(move.type)) {
          movementMap[productId].export += qty;
        }
      }
    }
    console.log('[inventorySummary] movementMap:', JSON.stringify(movementMap));

    // Get all productIds in movementMap
    let productIds = Object.keys(movementMap);
    if (!productIds.length) {
      console.log('[inventorySummary] No productIds in movementMap');
      return { items: [] };
    }

    // Get product info for all productIds
    const productFilter = { where: { id: { inq: productIds } }, fields: { id: true, code: true, name: true, category: true, uomStorage: true, uom: true, type: true } };
    if (productTypeFilter) productFilter.where.type = productTypeFilter;
    const products = await Product.find(productFilter);
    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });
    console.log('[inventorySummary] products.length:', products.length);

    // Get current stock for these products
    const stockFilter = { where: { productId: { inq: productIds } } };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      stockFilter.where.warehouseId = warehouseId;
    }
    const StockItem = app.models.StockItem;
    const stockItems = await StockItem.find(stockFilter);
    const stockMap = {};
    stockItems.forEach(s => { stockMap[s.productId] = s; });
    console.log('[inventorySummary] stockItems.length:', stockItems.length);

    // Build report items
    const items = [];
    for (const productId of productIds) {
      const product = productMap[productId];
      if (!product) continue;
      const movement = movementMap[productId] || { import: 0, export: 0 };
      const stockItem = stockMap[productId];
      const ending = stockItem ? Number(stockItem.quantity) || 0 : 0;
      const beginning = roundFloat(ending - movement.import + movement.export, 3);
      items.push({
        productId: productId,
        productCode: product.code || '',
        productName: product.name || '',
        category: product.category || '',
        uom: product.uomStorage || product.uom || 'kg',
        beginning: roundFloat(beginning, 3),
        import: roundFloat(movement.import, 3),
        export: roundFloat(movement.export, 3),
        ending: roundFloat(ending, 3),
        warehouseId: stockItem ? stockItem.warehouseId : warehouseId,
        warehouseName: stockItem ? stockItem.warehouseName || '' : ''
      });
    }
    console.log('[inventorySummary] items:', JSON.stringify(items));
    return { items };
  };

  Report.remoteMethod('inventorySummary', {
    accepts: [
      { arg: 'warehouseId', type: 'string', http: { source: 'form' } },
      { arg: 'productType', type: 'string', http: { source: 'form' } },
      { arg: 'startDate', type: 'string', required: true, http: { source: 'form' } },
      { arg: 'endDate', type: 'string', required: true, http: { source: 'form' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/inventorySummary', verb: 'post' },
    description: 'Báo cáo tổng hợp tồn kho theo kỳ (giống Misa)'
  });

  /**
   * 2. Inventory Movement Report (Xuất nhập tồn)
   * POST /Reports/inventoryMovement
   */
  Report.inventoryMovement = async function(warehouseId, startDate, endDate) {
    const app = require('../../server/server');
    const StockMove = app.models.StockMove;
    const Product = app.models.Product;
    const moment = require('moment');

    // Build StockMove filter
    const moveFilter = {
      where: { status: 'completed' },
      order: 'createdAt ASC',
      include: ['items']
    };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      moveFilter.where.warehouseId = warehouseId;
    }
    if (startDate && endDate) {
      const startMoment = moment(startDate).startOf('day');
      const endMoment = moment(endDate).endOf('day');
      moveFilter.where.createdAt = {
        between: [startMoment.toDate(), endMoment.toDate()]
      };
    }
    // Debug
    console.log('[inventoryMovement] moveFilter:', JSON.stringify(moveFilter));

    // Get all StockMoves with items
    const stockMoves = await StockMove.find(moveFilter);
    console.log('[inventoryMovement] stockMoves.length:', stockMoves.length);

    // Gather all productIds
    const productIdSet = new Set();
    for (const move of stockMoves) {
      for (const moveItem of move.items()) {
        if (moveItem.productId) productIdSet.add(moveItem.productId);
      }
    }
    const productIds = Array.from(productIdSet);
    if (!productIds.length) {
      console.log('[inventoryMovement] No productIds found');
      return { items: [] };
    }

    // Get product info
    const products = await Product.find({ where: { id: { inq: productIds } } });
    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });
    console.log('[inventoryMovement] products.length:', products.length);

    // Build report items
    const items = [];
    const increaseTypes = ['adding', 'import', 'return', 'adjustment'];
    const decreaseTypes = ['online-sale', 'export', 'offline-sale', 'transfer', 'damaged', 'expired', 'production'];

    for (const move of stockMoves) {
      for (const moveItem of move.items()) {
        const product = productMap[moveItem.productId];
        if (!product) continue;
        const type = increaseTypes.includes(move.type) ? 'import' : 'export';
        const quantity = Number(moveItem.quantity) || 0;
        const price = Number(moveItem.price) || Number(product.purchasePrice) || 0;
        items.push({
          date: move.createdAt,
          type: type,
          typeLabel: type === 'import' ? 'Nhập' : 'Xuất',
          documentCode: move.code || move.id,
          productId: moveItem.productId,
          productCode: product.code || '',
          productName: product.name || '',
          quantity: roundFloat(quantity, 3),
          uom: product.uomStorage || product.uom || 'kg',
          price: roundFloat(price, 0),
          value: roundFloat(quantity * price, 0),
          warehouseId: move.warehouseId,
          warehouseName: moveItem.warehouseName || '',
          notes: move.note || ''
        });
      }
    }
    console.log('[inventoryMovement] items:', JSON.stringify(items));
    return { items };
  };

  Report.remoteMethod('inventoryMovement', {
    accepts: [
      { arg: 'warehouseId', type: 'string', http: { source: 'form' } },
      { arg: 'startDate', type: 'string', required: true, http: { source: 'form' } },
      { arg: 'endDate', type: 'string', required: true, http: { source: 'form' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/inventoryMovement', verb: 'post' },
    description: 'Chi tiết xuất nhập tồn theo từng phiếu'
  });

  /**
   * 3. Inventory By Category Report (Tồn kho theo nhóm)
   * POST /Reports/inventoryByCategory
   */
  Report.inventoryByCategory = async function(warehouseId, productType, startDate, endDate) {
    const app = require('../../server/server');
    const StockItem = app.models.StockItem;
    const Product = app.models.Product;

    // Build StockItem filter
    const stockFilter = { where: {}, include: {
      relation: 'product',
      scope: { fields: { category: true} }
    } };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      stockFilter.where.warehouseId = warehouseId;
    }

    const stockItems = await StockItem.find(stockFilter);

    console.log('[inventoryByCategory] stockItems.length:', stockItems.length);
    if (stockItems.length > 0) {
      console.log('[inventoryByCategory] sample stockItem:', JSON.stringify(stockItems[0]));
    }

    // Group by category
    const categoryMap = {};
    for (const stockItem of stockItems) {
      const product = stockItem.product();
      if (!product) continue;
      const category = product.category || 'Chưa phân loại';
      if (!categoryMap[category]) {
        categoryMap[category] = {
          categoryName: category,
          items: [],
          totalQuantity: 0,
          totalValue: 0
        };
      }
      const quantity = Number(stockItem.quantity) || 0;
      const price = Number(product.purchasePrice) || 0;
      const value = quantity * price;
      categoryMap[category].items.push({
        productId: stockItem.productId,
        productCode: product.code || '',
        productName: product.name || '',
        quantity: roundFloat(quantity, 3),
        uom: product.uomStorage || product.uom || 'kg',
        price: roundFloat(price, 0),
        value: roundFloat(value, 0)
      });
      categoryMap[category].totalQuantity += quantity;
      categoryMap[category].totalValue += value;
    }

    // Convert to array and round totals
    const categories = Object.values(categoryMap).map(cat => ({
      categoryName: cat.categoryName,
      items: cat.items,
      totalQuantity: roundFloat(cat.totalQuantity, 3),
      totalValue: roundFloat(cat.totalValue, 0)
    }));
    return { categories };
  };

  Report.remoteMethod('inventoryByCategory', {
    accepts: [
      { arg: 'warehouseId', type: 'string', http: { source: 'form' } },
      { arg: 'productType', type: 'string', http: { source: 'form' } },
      { arg: 'startDate', type: 'string', http: { source: 'form' } },
      { arg: 'endDate', type: 'string', http: { source: 'form' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/inventoryByCategory', verb: 'post' },
    description: 'Tồn kho phân theo nhóm sản phẩm'
  });

  /**
   * 4. Purchase Report (Báo cáo nhập hàng theo NCC)
   * POST /Reports/purchaseReport
   */
  Report.purchaseReport = async function(supplierId, startDate, endDate) {
    const app = require('../../server/server');
    const StockMove = app.models.StockMove;
    const moment = require('moment');

    // Build StockMove filter
    const moveFilter = {
      where: {
        status: 'completed',
        type: { inq: ['adding', 'import'] }
      },
      include: ['items', 'supplier']
    };
    if (supplierId && supplierId !== 'null' && supplierId !== null && supplierId !== undefined && supplierId !== '') {
      moveFilter.where.supplierId = supplierId;
    }
    if (startDate && endDate) {
      const startMoment = moment(startDate).startOf('day');
      const endMoment = moment(endDate).endOf('day');
      moveFilter.where.createdAt = {
        between: [startMoment.toDate(), endMoment.toDate()]
      };
    }
    console.log('[purchaseReport] moveFilter:', JSON.stringify(moveFilter));

    // Get all StockMoves with items
    const stockMoves = await StockMove.find(moveFilter);
    console.log('[purchaseReport] stockMoves.length:', stockMoves.length);
    if (stockMoves.length > 0) {
      console.log('[purchaseReport] sample StockMove:', JSON.stringify(stockMoves[0], null, 2));
    }

    // Group by supplierId
    const supplierMap = {};
    for (const move of stockMoves) {
      const sid = move.supplierId || 'unknown';
      const supplier = move.supplier ? move.supplier() : null;
      const supplierName = supplier ? (supplier.name || supplier.companyName || 'Nhà cung cấp không xác định') : 'Nhà cung cấp không xác định';
      if (!supplierMap[sid]) {
        supplierMap[sid] = {
          supplierId: sid,
          supplierName: supplierName,
          documents: [],
          totalAmount: 0
        };
      }
      // Tính tổng tiền từng phiếu
      let docTotal = 0;
      const items = [];

      console.log('[purchaseReport] processing StockMove:', move.items());
      
      for (const moveItem of move.items()) {
        const quantity = Number(moveItem.quantity) || 0;
        const price = Number(moveItem.unitPrice || moveItem.price) || 0;
        const amount = quantity * price;
        docTotal += amount;
        items.push({
          productId: moveItem.productId,
          productCode: moveItem.code || moveItem.productCode || '',
          productName: moveItem.name || moveItem.productName || '',
          quantity: roundFloat(quantity, 3),
          uom: moveItem.uomStorage || moveItem.uom || 'kg',
          price: roundFloat(price, 0),
          amount: roundFloat(amount, 0)
        });
      }
      supplierMap[sid].documents.push({
        documentId: move.id,
        documentCode: move.code || '',
        date: move.createdAt,
        items: items,
        totalAmount: roundFloat(docTotal, 0)
      });
      supplierMap[sid].totalAmount += docTotal;
    }
    console.log('[purchaseReport] supplierMap:', JSON.stringify(supplierMap));

    // Convert to array and round totals
    const supplierReports = Object.values(supplierMap).map(sr => ({
      supplierId: sr.supplierId,
      supplierName: sr.supplierName,
      documents: sr.documents,
      totalAmount: roundFloat(sr.totalAmount, 0)
    }));
    return { suppliers: supplierReports };
  };

  Report.remoteMethod('purchaseReport', {
    accepts: [
      { arg: 'supplierId', type: 'string', http: { source: 'form' } },
      { arg: 'startDate', type: 'string', required: true, http: { source: 'form' } },
      { arg: 'endDate', type: 'string', required: true, http: { source: 'form' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/purchaseReport', verb: 'post' },
    description: 'Thống kê nhập hàng theo nhà cung cấp'
  });

  /**
   * 5. Export Report (Chi phí nguyên liệu theo tiệc)
   * POST /Reports/exportReport
   */
  Report.exportReport = async function(warehouseId, startDate, endDate) {
    const app = require('../../server/server');
    const StockMove = app.models.StockMove;
    const Product = app.models.Product;
    const Contract = app.models.contract;
    const moment = require('moment');

    // Build StockMove filter
    const moveFilter = {
      where: {
        status: 'completed',
        type: { inq: ['export', 'production', 'offline-sale'] }
      },
      include: ['items']
    };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      moveFilter.where.warehouseId = warehouseId;
    }
    if (startDate && endDate) {
      const startMoment = moment(startDate).startOf('day');
      const endMoment = moment(endDate).endOf('day');
      moveFilter.where.completedAt = {
        between: [startMoment.toDate(), endMoment.toDate()]
      };
    }
    console.log('[exportReport] moveFilter:', JSON.stringify(moveFilter));

    // Get all StockMoves with items
    const stockMoves = await StockMove.find(moveFilter);
    console.log('[exportReport] stockMoves.length:', stockMoves.length);
    if (stockMoves.length > 0) {
      console.log('[exportReport] sample StockMove:', JSON.stringify(stockMoves[0], null, 2));
    }

    // Group by event (if available from StockMove)
    const events = [];
    for (const move of stockMoves) {
      const eventName = move.reason || move.note || move.code || 'Xuất kho';
      let totalCost = 0;
      const items = [];
      for (const moveItem of move.items()) {
        if (!moveItem.productId) continue;
        const quantity = Number(moveItem.quantity) || 0;
        const price = Number(moveItem.unitPrice || moveItem.price) || 0;
        const cost = quantity * price;
        totalCost += cost;
        items.push({
          productId: moveItem.productId,
          productCode: moveItem.code || moveItem.productCode || '',
          productName: moveItem.name || moveItem.productName || '',
          quantity: roundFloat(quantity, 3),
          uom: moveItem.uomStorage || moveItem.uom || 'kg',
          price: roundFloat(price, 0),
          cost: roundFloat(cost, 0)
        });
      }
      events.push({
        date: move.createdAt,
        eventName: eventName,
        documentCode: move.code || move.id,
        items: items,
        totalCost: roundFloat(totalCost, 0)
      });
    }
    console.log('[exportReport] events.length:', events.length);
    return { events: events };
  };

  Report.remoteMethod('exportReport', {
    accepts: [
      { arg: 'warehouseId', type: 'string', http: { source: 'form' } },
      { arg: 'startDate', type: 'string', required: true, http: { source: 'form' } },
      { arg: 'endDate', type: 'string', required: true, http: { source: 'form' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/exportReport', verb: 'post' },
    description: 'Chi phí nguyên liệu theo tiệc/sự kiện'
  });

  /**
   * 6. Stock Count Report (Báo cáo kiểm kho)
   * POST /Reports/stockCountReport
   */
  Report.stockCountReport = async function(warehouseId, startDate, endDate) {
    const app = require('../../server/server');
    const StockCount = app.models.StockCount;
    const StockCountItem = app.models.StockCountItem;
    const Product = app.models.Product;
    const Warehouse = app.models.Warehouse;
    const Employee = app.models.Employee;
    const moment = require('moment');

    const startMoment = moment(startDate).startOf('day');
    const endMoment = moment(endDate).endOf('day');

    // Build filter
    const filter = {
      where: {
        countDate: {
          between: [startMoment.toDate(), endMoment.toDate()]
        }
      },
      order: 'countDate DESC',
      include: ['countItems', 'warehouse', 'executedBy']
    };
    if (warehouseId && warehouseId !== 'null' && warehouseId !== null && warehouseId !== undefined && warehouseId !== '') {
      filter.where.warehouseId = warehouseId;
    }
    console.log('[stockCountReport] filter:', JSON.stringify(filter));

    // Get stock counts with items
    const stockCounts = await StockCount.find(filter);
    console.log('[stockCountReport] stockCounts.length:', stockCounts.length);
    if (stockCounts.length > 0) {
      console.log('[stockCountReport] sample StockCount:', JSON.stringify(stockCounts[0], null, 2));
    }

    if (!stockCounts.length) {
      console.log('[stockCountReport] No stockCounts found');
      return { stockCounts: [] };
    }

    // Gather all productIds from countItems
    const productIdSet = new Set();
    for (const sc of stockCounts) {
      const countItems = sc.countItems() || [];
      for (const item of countItems) {
        if (item.productId) productIdSet.add(item.productId);
      }
    }
    const productIds = Array.from(productIdSet);
    console.log('[stockCountReport] productIds.length:', productIds.length);

    // Get products
    const products = await Product.find({ where: { id: { inq: productIds } } });
    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });
    console.log('[stockCountReport] products.length:', products.length);

    // Build report
    const reports = [];
    stockCounts.forEach(stockCount => {
      const warehouse = stockCount.warehouse() || null;
      const employee = stockCount.executedBy() || null;
      const items = stockCount.countItems() || [];

      let totalVariance = 0;
      let overCount = 0;
      let underCount = 0;
      let totalValue = 0;

      const itemDetails = [];
      for (const item of items) {
        const product = productMap[item.productId];
        if (!product) continue;

        const expectedQty = Number(item.systemQty || item.expectedQuantity) || 0;
        const countedQty = Number(item.countedQty || item.countedQuantity) || 0;
        const difference = Number(item.variance) || (countedQty - expectedQty);
        const price = Number(product.purchasePrice) || 0;
        const varianceValue = difference * price;
        const variancePercentage = expectedQty !== 0 ? (difference / expectedQty) * 100 : 0;

        totalVariance += Math.abs(difference);
        if (difference > 0) overCount++;
        if (difference < 0) underCount++;
        totalValue += Math.abs(varianceValue);

        itemDetails.push({
          productCode: product.code || '',
          productName: product.name || '',
          expectedQuantity: roundFloat(expectedQty, 3),
          countedQuantity: roundFloat(countedQty, 3),
          difference: roundFloat(difference, 3),
          variancePercentage: roundFloat(variancePercentage, 2),
          uom: product.uomStorage || product.uom || 'kg',
          price: roundFloat(price, 0),
          varianceValue: roundFloat(varianceValue, 0)
        });
      }

      reports.push({
        stockCountId: stockCount.id,
        stockCountCode: stockCount.code || '',
        countDate: stockCount.countDate,
        warehouseId: stockCount.warehouseId,
        warehouseName: warehouse ? warehouse.name : '',
        status: stockCount.status,
        statusLabel: stockCount.status === 'completed' ? 'Hoàn thành' : 
                     stockCount.status === 'in progress' ? 'Đang kiểm' : 'Chưa bắt đầu',
        executedBy: employee ? (employee.name || employee.fullName) : '',
        totalItems: items.length,
        overCount: overCount,
        underCount: underCount,
        totalVariance: roundFloat(totalVariance, 3),
        totalValue: roundFloat(totalValue, 0),
        items: itemDetails
      });
    });
    console.log('[stockCountReport] reports.length:', reports.length);

    return { stockCounts: reports };
  };

  Report.remoteMethod('stockCountReport', {
    accepts: [
      { arg: 'warehouseId', type: 'string', http: { source: 'form' } },
      { arg: 'startDate', type: 'string', required: true, http: { source: 'form' } },
      { arg: 'endDate', type: 'string', required: true, http: { source: 'form' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/stockCountReport', verb: 'post' },
    description: 'Lịch sử và chênh lệch kiểm kho'
  });

};
