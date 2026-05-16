module.exports = function(MaterialRequest) {
  
  /**
   * Calculate materials from linked contracts
   * HTTP POST /MaterialRequests/:id/calculate
   * Matches frontend logic from kitchen-mrp.controller.js
   */
  MaterialRequest.calculate = function(id, cb) {
    const app = require('../../server/server');
    const Contract = app.models.contract;
    const Product = app.models.Product;
    const StockItem = app.models.StockItem;
    const MaterialRequestItem = app.models.MaterialRequestItem;

    MaterialRequest.findById(id, function(err, mr) {
      if (err) return cb(err);
      if (!mr) return cb(new Error('MaterialRequest not found: ' + id));

      const contractIds = mr.contractIds || [];
      if (!contractIds.length) {
        return cb(new Error('No contracts linked to this material request'));
      }

      // Load contracts with full details
      Contract.find({ where: { id: { inq: contractIds } } }, function(err, contracts) {
        if (err) return cb(err);

        // STEP 1: Build dishes map from menu.bom.parts
        const dishes = {};
        
        contracts.forEach(contract => {
          const menu = contract.menu || {};
          const baseTableCount = contract.tableCount || 0;
          const reserveTables = contract.reserveTables || 0;
          const freeTables = contract.freeTables || 0;
          const totalTables = baseTableCount + reserveTables + freeTables;

          if (menu && menu.bom && Array.isArray(menu.bom.parts)) {
            menu.bom.parts.forEach(part => {
              const dishId = part.materialId || part.productId || part.id;
              if (!dishId) return;

              const qty = (Number(part.quantity) || 0) * totalTables;

              if (!dishes[dishId]) {
                dishes[dishId] = {
                  name: part.name,
                  totalQty: 0,
                  details: []
                };
              }

              dishes[dishId].totalQty += qty;
              dishes[dishId].details.push({
                banquet: contract.eventName || contract.code,
                banquetId: contract.id,
                qty: qty,
                tables: totalTables
              });
            });
          }
        });

        const dishIds = Object.keys(dishes);
        if (!dishIds.length) {
          return cb(new Error('No menu items found in contracts'));
        }

        // STEP 2: Load dishes (products) with their related materials (rawMaterials)
        Product.find({
          where: { id: { inq: dishIds } },
          include: {
            relation: 'relatedProducts',
            scope: { include: 'suppliers' }
          }
        }, function(err, products) {
          if (err) return cb(err);

          // Build groupedByDish - dishes from menu.bom.parts with materials from product.bom.rawMaterials
          const groupedByDish = [];
          const materialMap = {};

          products.forEach(product => {
            const dish = dishes[product.id];
            if (!dish) return;

            // Build full material dictionary
            const fullRawMatDict = {};
            (product.relatedProducts || []).forEach(rp => {
              fullRawMatDict[rp.id] = rp;
            });

            const dishMaterials = [];
            const bom = product.bom || {};
            const rawMaterials = Array.isArray(bom.rawMaterials) ? bom.rawMaterials : [];

            rawMaterials.forEach(rawMat => {
              const materialId = rawMat.materialId;
              if (!materialId) return;

              const fullRawMat = fullRawMatDict[materialId] || {};
              const qtyNeeded = (Number(rawMat.quantity) || 0) * dish.totalQty;

              dishMaterials.push({
                materialId: materialId,
                materialName: fullRawMat.name,
                materialCode: fullRawMat.code || '',
                category: fullRawMat.category || 'Khác',
                uomUsage: rawMat.uomUsage || '',
                uomStorage: rawMat.uomStorage || rawMat.uomUsage || '',
                quantity: qtyNeeded,
                buffer: fullRawMat.buffer || 0
              });

              // Aggregate materials for materialMap
              if (!materialMap[materialId]) {
                materialMap[materialId] = {
                  productId: materialId,
                  productName: fullRawMat.name,
                  productCode: fullRawMat.code || '',
                  category: fullRawMat.category || 'Khác',
                  uomUsage: rawMat.uomUsage || '',
                  uomStorage: rawMat.uomStorage || rawMat.uomUsage || '',
                  bomTotal: 0,
                  stock: 0,
                  manualOrder: 0,
                  buffer: fullRawMat.buffer || 0,
                  type: fullRawMat.type,
                  details: []
                };
              }

              materialMap[materialId].bomTotal += qtyNeeded;

              // Store detail with dish info
              const existingDishDetail = materialMap[materialId].details.find(d => d.dishId === product.id);
              if (!existingDishDetail) {
                materialMap[materialId].details.push({
                  dish: dish.name,
                  dishId: product.id,
                  quantity: qtyNeeded,
                  banquet: dish.details[0].banquet,
                  banquetId: dish.details[0].banquetId,
                  tables: dish.details[0].tables
                });
              } else {
                existingDishDetail.quantity += qtyNeeded;
              }
            });

            groupedByDish.push({
              dishId: product.id,
              dishName: dish.name,
              dishCode: product.code || '',
              totalQty: dish.totalQty,
              materials: dishMaterials,
              banquets: dish.details
            });
          });

          const items = Object.values(materialMap);
          if (!items.length) {
            return cb(new Error('No materials found in product BOMs'));
          }

          const materialIds = items.map(item => item.productId);

          // STEP 3: Load full material product details (with suppliers)
          Product.find({
            where: { id: { inq: materialIds } },
            include: 'suppliers'
          }, function(err, materialProducts) {
            if (err) return cb(err);

            const productMap = {};
            (materialProducts || []).forEach(p => {
              productMap[p.id] = p;
            });

            // Enrich items with product master data
            items.forEach(item => {
              const product = productMap[item.productId];
              if (!product) return;

              item.productCode = product.code;
              item.uomStorage = product.uomStorage || product.uom;
              item.uomUsage = item.uomUsage || product.uomUsage || product.uom;
              item.price = product.purchasePrice || 0;
              item.buffer = product.buffer || 0;
              item.type = product.type;

              if (product.suppliers && product.suppliers.length > 0) {
                item.supplierName = product.suppliers[0].name;
                item.supplierId = product.suppliers[0].id;
                item.suppliers = product.suppliers.map(s => ({ id: s.id, name: s.name }));
              }

              // Unit conversion - bomTotal is in uomUsage, convert to uomStorage for purchasing
              if (item.uomUsage !== item.uomStorage) {
                const converted = convertUnit(item.bomTotal, item.uomUsage, item.uomStorage);
                item.bomTotalConverted = converted.quantity;
              } else {
                item.bomTotalConverted = item.bomTotal;
              }
            });

            proceedWithStockCheck();

            // STEP 4: Load stock information
            function proceedWithStockCheck() {
              StockItem.find({ where: { productId: { inq: materialIds } } }, function(err, stockItems) {
                if (err) return cb(err);

                const stockMap = {};
                (stockItems || []).forEach(stock => {
                  if (!stockMap[stock.productId]) {
                    stockMap[stock.productId] = 0;
                  }
                  stockMap[stock.productId] += (Number(stock.quantity) || 0);
                });

                items.forEach(item => {
                  item.stock = stockMap[item.productId] || 0;
                  
                  // Calculate suggested order quantity with buffer
                  const currentBom = item.bomTotalConverted || item.bomTotal;
                  const buffer = item.buffer || 0;
                  const needed = currentBom * (1 + buffer / 100);
                  const suggest = needed - (item.stock || 0);
                  item.manualOrder = suggest > 0 ? Math.round(suggest * 10) / 10 : 0;
                });

                // Separate semi-finished products
                const regularItems = [];
                const semiFinishedItems = [];
                items.forEach(item => {
                  if (item.type === 'Sơ chế, bán thành phẩm') {
                    semiFinishedItems.push(item);
                  } else {
                    regularItems.push(item);
                  }
                });

                // Build materialsSummary for API response
                const materialsSummary = items.map(item => ({
                  materialId: item.productId,
                  productName: item.productName,
                  productCode: item.productCode,
                  category: item.category,
                  uomUsage: item.uomUsage,
                  uomStorage: item.uomStorage,
                  bomTotal: item.bomTotal,
                  bomTotalConverted: item.bomTotalConverted,
                  stock: item.stock,
                  buffer: item.buffer,
                  manualOrder: item.manualOrder,
                  price: item.price,
                  suppliers: item.suppliers || [],
                  details: item.details || []
                }));

                // Group by supplier
                const supplierMap = {};
                items.forEach(item => {
                  const suppliers = item.suppliers && item.suppliers.length ? 
                    item.suppliers : 
                    [{ id: null, name: 'Nhà cung cấp không xác định' }];
                    
                  suppliers.forEach(s => {
                    if (!supplierMap[s.id]) {
                      supplierMap[s.id] = { supplierId: s.id, supplierName: s.name, items: [] };
                    }
                    supplierMap[s.id].items.push({ 
                      productId: item.productId,
                      productName: item.productName,
                      quantity: item.manualOrder, 
                      uom: item.uomStorage || item.uomUsage
                    });
                  });
                });
                const purchaseRequestsBySupplier = Object.values(supplierMap);

                // Group by category
                const categoryMap = {};
                items.forEach(item => {
                  const cat = item.category || 'Chưa phân loại';
                  if (!categoryMap[cat]) {
                    categoryMap[cat] = { 
                      categoryName: cat, 
                      items: [],
                      totalsByUom: {}
                    };
                  }
                  
                  categoryMap[cat].items.push({
                    productId: item.productId,
                    productName: item.productName,
                    productCode: item.productCode,
                    bomTotal: item.bomTotal,
                    bomTotalConverted: item.bomTotalConverted,
                    stock: item.stock,
                    manualOrder: item.manualOrder,
                    uomStorage: item.uomStorage,
                    uomUsage: item.uomUsage,
                    buffer: item.buffer,
                    price: item.price,
                    suppliers: item.suppliers
                  });
                  
                  const uom = (item.uomStorage || 'kg').toString();
                  categoryMap[cat].totalsByUom[uom] = 
                    (categoryMap[cat].totalsByUom[uom] || 0) + (Number(item.manualOrder) || 0);
                });
                const materialsGrouped = Object.values(categoryMap);

                // Create MaterialRequestItems
                const itemsToCreate = items.map(item => ({
                  materialRequestId: mr.id,
                  productId: item.productId,
                  productName: item.productName,
                  productCode: item.productCode,
                  requiredQuantity: item.bomTotalConverted || item.bomTotal,
                  availableQuantity: item.stock,
                  toPurchase: item.manualOrder,
                  uom: item.uomStorage || item.uomUsage,
                  estimatedPrice: item.price,
                  subTotal: (item.manualOrder || 0) * (item.price || 0),
                  suppliers: item.suppliers || []
                }));

                // Delete old items and create new ones
                MaterialRequestItem.destroyAll({ materialRequestId: mr.id }, function(err) {
                  if (err) console.error('Error deleting old items:', err);

                  MaterialRequestItem.create(itemsToCreate, function(err, createdItems) {
                    if (err) {
                      console.error('Error creating MaterialRequestItems:', err);
                    }

                    // Calculate total cost
                    const totalCost = items.reduce((sum, item) => 
                      sum + ((item.manualOrder || 0) * (item.price || 0)), 0);

                    // Update MaterialRequest with computed data
                    mr.updateAttributes({
                      items: items,
                      groupedByDish: groupedByDish,
                      materialsSummary: materialsSummary,
                      purchaseRequestsBySupplier: purchaseRequestsBySupplier,
                      materialsGrouped: materialsGrouped,
                      totalCost: totalCost,
                      totalItems: items.length,
                      status: 'submitted'
                    }, function(updateErr) {
                      if (updateErr) {
                        console.error('Error updating MaterialRequest:', updateErr);
                      }

                      cb(null, {
                        success: true,
                        items: items,
                        groupedByDish: groupedByDish,
                        materialsSummary: materialsSummary,
                        purchaseRequestsBySupplier: purchaseRequestsBySupplier,
                        materialsGrouped: materialsGrouped,
                        totalCost: totalCost,
                        totalItems: items.length
                      });
                    });
                  });
                });
              });
            }
          });
        });
      });
    });
  };

  // Unit conversion helper (from frontend)
  function convertUnit(quantity, fromUom, toUom) {
    if (!fromUom || !toUom || fromUom === toUom) {
      return { quantity: quantity, uom: toUom || fromUom };
    }

    const rules = {
      'gr': { 'kg': 0.001, 'tạ': 0.00001, 'tấn': 0.000001 },
      'kg': { 'gr': 1000, 'tạ': 0.01, 'tấn': 0.001 },
      'ml': { 'lít': 0.001, 'l': 0.001 },
      'lít': { 'ml': 1000 },
      'l': { 'ml': 1000 }
    };

    const from = fromUom.toLowerCase().trim();
    const to = toUom.toLowerCase().trim();

    if (rules[from] && rules[from][to]) {
      return {
        quantity: parseFloat((quantity * rules[from][to]).toFixed(3)),
        uom: toUom
      };
    }

    return { quantity: quantity, uom: fromUom };
  }

  MaterialRequest.remoteMethod('calculate', {
    accepts: [
      { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/:id/calculate', verb: 'post' },
    description: 'Calculate materials from linked contracts and create items'
  });

  /**
   * Approve material request
   */
  MaterialRequest.approve = function(id, cb) {
    MaterialRequest.findById(id, function(err, mr) {
      if (err) return cb(err);
      if (!mr) return cb(new Error('MaterialRequest not found'));

      mr.updateAttributes({
        status: 'approved',
        approvedAt: new Date()
      }, cb);
    });
  };

  MaterialRequest.remoteMethod('approve', {
    accepts: [
      { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
    ],
    returns: { arg: 'materialRequest', type: 'object', root: true },
    http: { path: '/:id/approve', verb: 'post' },
    description: 'Approve material request'
  });

  /**
   * Reject material request
   */
  MaterialRequest.reject = function(id, cb) {
    MaterialRequest.findById(id, function(err, mr) {
      if (err) return cb(err);
      if (!mr) return cb(new Error('MaterialRequest not found'));

      mr.updateAttributes({
        status: 'rejected',
        rejectedAt: new Date()
      }, cb);
    });
  };

  MaterialRequest.remoteMethod('reject', {
    accepts: [
      { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
    ],
    returns: { arg: 'materialRequest', type: 'object', root: true },
    http: { path: '/:id/reject', verb: 'post' },
    description: 'Reject material request'
  });
};
