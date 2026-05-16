module.exports = function(PurchaseRequest) {
  // Remote method implementation for reject
  PurchaseRequest.reject = function(id, cb) {
    // Find the purchase request by id
    PurchaseRequest.findById(id, function(err, request) {
      if (err) {
        cb(err);
      } else if (!request) {
        cb(new Error('Purchase request not found'));
      } else {
        // Update the status to "Rejected"
        request.status = 'Rejected';
        request.save(function(err, updatedRequest) {
          if (err) {
            cb(err);
          } else {
            cb(null, updatedRequest);
          }
        });
      }
    });
  };

  // Remote method implementation for cancel
  PurchaseRequest.cancel = function(id, cb) {
    // Find the purchase request by id
    PurchaseRequest.findById(id, function(err, request) {
      if (err) {
        cb(err);
      } else if (!request) {
        cb(new Error('Purchase request not found'));
      } else {
        // Update the status to "Canceled"
        request.status = 'Canceled';
        request.save(function(err, updatedRequest) {
          if (err) {
            cb(err);
          } else {
            cb(null, updatedRequest);
          }
        });
      }
    });
  };

  // Add before save hook to create PurchaseOrder when status transitions to approved
  PurchaseRequest.observe('before save', function(ctx, next) {
    var app = require('../../server/server');
    var PurchaseOrder = app.models.PurchaseOrder;
    var PurchaseOrderItem = app.models.PurchaseOrderItem;
    var PurchaseRequestItem = app.models.PurchaseRequestItem;

    // Determine new data being saved
    var data = ctx.data ? ctx.data : ctx.instance;
    if (!data) {
      return next();
    }

    // Only act when status is set to lowercase 'approved' (per model enum)
    var newStatus = data.status;
    if (newStatus !== 'approved') {
      return next();
    }

    // Determine PR id for fetching current record and items
    var requestId = (ctx.instance && ctx.instance.id) || (ctx.where && ctx.where.id) || data.id;
    if (!requestId) {
      // If no id, proceed without creating PO
      return next();
    }

    // Load current record to compare previous status and check existing PO
    PurchaseRequest.findById(requestId, function(err, existing) {
      if (err) {
        return next(err);
      }
      if (!existing) {
        return next();
      }

      // If already approved and has a PO linked, do nothing
      if (existing.status === 'approved' && (existing.purchaseOrderId || data.purchaseOrderId)) {
        return next();
      }

      // Create PO from PR items
      PurchaseRequestItem.find({ where: { purchaseRequestId: requestId } }, function(err, items) {
        if (err) {
          return next(err);
        }

        var totalQuantity = 0;
        items.forEach(function(it) { totalQuantity += (it.quantity || 0); });

        var poData = {
          quantityOrder: totalQuantity,
          status: 'Pending',
          purchaseRequestId: requestId
        };

        PurchaseOrder.create(poData, function(err, po) {
          if (err) {
            return next(err);
          }

          // Prepare PO items
          var poItems = items.map(function(it) {
            var quantity = it.quantity || 0;
            var price = it.unitPrice || 0;
            return {
              purchaseOrderId: po.id,
              productId: it.productId,
              quantity: quantity,
              price: price,
              subTotal: quantity * price
            };
          });

          // Link PO back to PR in the save payload
          if (ctx.data) {
            ctx.data.purchaseOrderId = po.id;
          } else if (ctx.instance) {
            ctx.instance.purchaseOrderId = po.id;
          }

          if (!poItems.length) {
            return next();
          }

          // Bulk create PO items
          PurchaseOrderItem.create(poItems, function(err) {
            if (err) {
              return next(err);
            }
            next();
          });
        });
      });
    });
  });

  // Expose the remote methods via LoopBack's API
  PurchaseRequest.remoteMethod(
    'reject',
    {
      accepts: [
        { arg: 'id', type: 'string', required: true, description: 'Purchase request ID' }
      ],
      returns: [
        { arg: 'updatedRequest', type: 'object', root: true, description: 'Updated purchase request' }
      ],
      http: { verb: 'post', path: '/:id/reject' }
    }
  );

  /**
   * materialsSummary remote method
   * GET /purchaseRequests/materialsSummary/:id
   * Returns aggregated materials and grouping by supplier for a purchase request
   */
  PurchaseRequest.approve = function(id, cb) {
    const app = require('../../server/server');
    const Contract = app.models.Contract;
    const Product = app.models.Product;

    PurchaseRequest.findById(id, { fields: ['id', 'contracts'] }, function(err, pr) {
      if (err) return cb(err);
      if (!pr) return cb(new Error('PurchaseRequest not found: ' + id));

      const contractIds = pr.contracts || [];
      if (!contractIds.length) return cb(null, { materialsSummary: [], purchaseRequestsBySupplier: [] });

      Contract.find({ where: { id: { inq: contractIds } } }, function(err, contracts) {
        if (err) return cb(err);

        // Prefer precomputed materials on contracts (contract.materials) if present.
        // Aggregate all contract.materials into materialMap; if none present, fall back to BOM traversal.
        const materialMap = {};
        const materialIdsSet = new Set();

        // Aggregate from contract.materials when available
        contracts.forEach(contract => {
          const mats = contract.materials;
          if (!mats) return;

          if (Array.isArray(mats)) {
            mats.forEach(m => {
              const mid = m.materialId || m.id || m.productId || m.material;
              const qty = Number(m.quantity || m.qty || m.requiredQuantity || m.toPurchase || 0) || 0;
              const uom = m.uom || m.uomUsage || 'unit';
              const name = m.name || null;
              if (!mid || !qty) return;
              if (!materialMap[mid]) materialMap[mid] = { requiredQuantity: 0, uom: uom, name: name };
              materialMap[mid].requiredQuantity += qty;
              materialIdsSet.add(mid);
            });
          } else if (typeof mats === 'object') {
            // object map: { materialId: qty } or { materialId: { quantity, uom, name } }
            Object.keys(mats).forEach(mid => {
              const val = mats[mid];
              let qty = 0;
              let name = null;
              let uom = 'unit';
              if (typeof val === 'number') qty = Number(val);
              else if (typeof val === 'object') {
                qty = Number(val.quantity || val.qty || val.requiredQuantity || 0) || 0;
                name = val.name || null;
                uom = val.uom || val.uomUsage || uom;
              }
              if (!mid || !qty) return;
              if (!materialMap[mid]) materialMap[mid] = { requiredQuantity: 0, uom: uom, name: name };
              materialMap[mid].requiredQuantity += qty;
              materialIdsSet.add(mid);
            });
          }
        });

        // If no precomputed materials found, fall back to previous BOM-based aggregation
        if (materialIdsSet.size === 0) {
          // Build dishes map: dishId -> { quantity }
          const dishes = {};
          contracts.forEach(contract => {
            const menu = contract.menu || {};
            const tables = contract.tableCount || 1;
            if (menu && menu.bom && Array.isArray(menu.bom.parts)) {
              menu.bom.parts.forEach(part => {
                const dishId = part.materialId || part.productId || part.id;
                const qty = Number(part.quantity || 0) * tables;
                if (!dishId) return;
                if (!dishes[dishId]) dishes[dishId] = { quantity: 0 };
                dishes[dishId].quantity += qty;
              });
            }
          });

          const dishIds = Object.keys(dishes);
          if (!dishIds.length) return cb(null, { materialsSummary: [], purchaseRequestsBySupplier: [] });

          // Load product details for dishes (including relatedProducts and suppliers)
          Product.find({ where: { id: { inq: dishIds } }, include: { relation: 'relatedProducts', scope: { include: { relation: 'suppliers', scope: { fields: ['id','name'] } } } } }, function(err, products) {
            if (err) return cb(err);

            products.forEach(prod => {
              const dishQty = dishes[prod.id] ? dishes[prod.id].quantity : 0;
              const bom = prod.bom || {};
              const raw = Array.isArray(bom.rawMaterials) ? bom.rawMaterials : [];
              raw.forEach(item => {
                const mid = item.materialId || item.id;
                if (!mid) return;
                const per = Number(item.quantity || item.qty || 0) || 0;
                const add = per * dishQty;
                if (!materialMap[mid]) {
                  materialMap[mid] = { requiredQuantity: 0, uom: item.uomUsage || item.uom || 'unit', name: item.name || null };
                }
                materialMap[mid].requiredQuantity += add;
                materialIdsSet.add(mid);
              });
            });

            proceedWithMaterials();
          });
          return; // proceed will happen in callback
        }

        // If we had precomputed materials, continue
        proceedWithMaterials();

        function proceedWithMaterials() {
          const materialIds = Array.from(materialIdsSet);
          if (!materialIds.length) return cb(null, { materialsSummary: [], purchaseRequestsBySupplier: [] });

          // Fetch product records for materials to get names and suppliers
          Product.find({ where: { id: { inq: materialIds } }, include: 'suppliers' }, function(err, materialProds) {
            if (err) return cb(err);

            const materialById = {};
            materialProds.forEach(mp => {
              materialById[mp.id] = mp;
            });

            // Build materialsSummary array
            const materialsSummary = materialIds.map(mid => {
              const info = materialMap[mid] || { requiredQuantity: 0, uom: 'unit', name: null };
              const mp = materialById[mid];
              // Normalize suppliers which may be an array, a single object, or undefined
              let suppliers = [];
              if (mp && mp.suppliers) {
                if (Array.isArray(mp.suppliers)) {
                  suppliers = mp.suppliers.map(s => ({ id: s.id, name: s.name }));
                } else if (typeof mp.suppliers === 'object') {
                  // single supplier object
                  suppliers = [{ id: mp.suppliers.id || null, name: mp.suppliers.name || mp.suppliers.displayName || null }];
                }
              }
              const name = info.name || (mp && mp.name) || ('material-' + mid);
              const toPurchase = info.requiredQuantity; // Placeholder: will adjust with stock next
              return {
                materialId: mid,
                name: name,
                uom: info.uom,
                requiredQuantity: info.requiredQuantity,
                toPurchase: toPurchase,
                suppliers: suppliers
              };
            });

            // Now check stock levels from StockItem and compute toPurchase = max(0, required - onHand)
            const StockItem = app.models.StockItem;
            StockItem.find({ where: { productId: { inq: materialIds } } }, function(err, stockItems) {
              if (err) {
                return cb(err);
              }

              // Aggregate stock information per product: quantity (onHand), allocatedQuantity, orderedQuantity
              const stockByProduct = {};
              const allocatedByProduct = {};
              const orderedByProduct = {};
              (stockItems || []).forEach(si => {
                const pid = si.productId;
                stockByProduct[pid] = (stockByProduct[pid] || 0) + (Number(si.quantity) || 0);
                allocatedByProduct[pid] = (allocatedByProduct[pid] || 0) + (Number(si.allocatedQuantity) || 0);
                orderedByProduct[pid] = (orderedByProduct[pid] || 0) + (Number(si.orderedQuantity) || 0);
              });

              // Update materialsSummary with onHand, available and toPurchase
              materialsSummary.forEach(mat => {
                const onHand = stockByProduct[mat.materialId] || 0;
                const allocated = allocatedByProduct[mat.materialId] || 0;
                const ordered = orderedByProduct[mat.materialId] || 0;
                // Available = (onHand - allocatedQuantity) + orderedQuantity
                const available = Math.max(0, (onHand - allocated) + ordered);
                mat.onHand = onHand;
                mat.allocated = allocated;
                mat.ordered = ordered;
                mat.available = available;
                mat.toPurchase = Math.max(0, (mat.requiredQuantity || 0) - available);
              });

              // Group by supplier
              const supplierMap = {};
              materialsSummary.forEach(mat => {
                const suppliers = mat.suppliers && mat.suppliers.length ? mat.suppliers : [{ id: null, name: 'Nhà cung cấp không xác định' }];
                suppliers.forEach(s => {
                  if (!supplierMap[s.id]) supplierMap[s.id] = { name: s.name, items: [] };
                  supplierMap[s.id].items.push({ name: mat.name, quantity: mat.toPurchase, uom: mat.uom });
                });
              });

              const purchaseRequestsBySupplier = Object.values(supplierMap);

              // Group by category using product data (materialById)
              const categoryMap = {};
              materialsSummary.forEach(mat => {
                const mp = materialById[mat.materialId] || {};
                const categoryId = mp.category || mp.categoryId || 'Uncategorized';
                const categoryName = mp.categoryName || mp.categoryLabel || mp.category || 'Uncategorized';
                if (!categoryMap[categoryId]) {
                  categoryMap[categoryId] = { categoryId: categoryId, categoryName: categoryName, items: [], totalsByUom: {} };
                }
                categoryMap[categoryId].items.push({
                  materialId: mat.materialId,
                  name: mat.name,
                  requiredQuantity: mat.requiredQuantity,
                  toPurchase: mat.toPurchase,
                  onHand: mat.onHand,
                  allocated: mat.allocated,
                  ordered: mat.ordered,
                  available: mat.available,
                  uom: mat.uom,
                  suppliers: mat.suppliers || []
                });
                const uom = (mat.uom || 'unit').toString();
                categoryMap[categoryId].totalsByUom[uom] = (categoryMap[categoryId].totalsByUom[uom] || 0) + (Number(mat.toPurchase) || 0);
              });

              const materialsGrouped = Object.keys(categoryMap).map(k => categoryMap[k]);

              // Persist computed summary back to the PurchaseRequest record so front-end can load it later
              // We already loaded `pr` earlier (the outer PurchaseRequest.findById), reuse it to avoid an extra DB lookup.
              try {
                const updatePayload = {
                  materialsSummary: materialsSummary,
                  purchaseRequestsBySupplier: purchaseRequestsBySupplier,
                  materialsGrouped: materialsGrouped,
                  status: 'approved'
                };

                if (pr && typeof pr.updateAttributes === 'function') {
                  // pr is the instance we fetched at the start of this method
                  pr.updateAttributes(updatePayload, function(updateErr) {
                    if (updateErr) console.error('Failed to persist materialsSummary on PurchaseRequest:', updateErr);
                    // Always return computed result to caller
                    return cb(null, { materialsSummary: materialsSummary, purchaseRequestsBySupplier: purchaseRequestsBySupplier, materialsGrouped: materialsGrouped });
                  });
                } 
              } catch (e) {
                console.error('Error persisting materials summary:', e);
                return cb(null, { materialsSummary: materialsSummary, purchaseRequestsBySupplier: purchaseRequestsBySupplier, materialsGrouped: materialsGrouped });
              }
            });
          });
        }
      });
    });
  };

  PurchaseRequest.remoteMethod('approve', {
    accepts: [ { arg: 'id', type: 'string', required: true, http: { source: 'path' } } ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/approve/:id', verb: 'post' }
  });

  PurchaseRequest.remoteMethod(
    'cancel',
    {
      accepts: [
        { arg: 'id', type: 'string', required: true, description: 'Purchase request ID' }
      ],
      returns: [
        { arg: 'updatedRequest', type: 'object', root: true, description: 'Updated purchase request' }
      ],
      http: { verb: 'post', path: '/:id/cancel' }
    }
  );

};

