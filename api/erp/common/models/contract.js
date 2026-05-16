var moment = require('moment');
var materialsCalc = require('../lib/materials-calculator');

module.exports = function(Contract) {
    
    // Hook để sync từ Contract sang Booking khi update contract
    Contract.observe('after save', async function (ctx) {
        // Nếu được đánh dấu là save do sync từ Booking thì bỏ qua, tránh vòng lặp
        if (ctx.options && ctx.options.skipSyncFromBookingHook) {
            console.log('[Contract after save] Skipping because of skipSyncFromBookingHook flag');
            return;
        }

        const contract = ctx.instance || ctx.data;
        if (!contract || !contract.id) {
            console.log('[Contract after save] No contract or contract.id');
            return;
        }

        console.log('[Contract after save] Contract ID:', contract.id, 'isNewInstance:', ctx.isNewInstance);

        // Chỉ sync khi update contract (không phải create)
        if (ctx.isNewInstance) {
            console.log('[Contract after save] This is a new contract, skipping sync');
            return;
        }

        // Nếu contract có bookingId thì update booking
        if (!contract.bookingId) {
            console.log('[Contract after save] No bookingId, skipping sync');
            return;
        }

        const Booking = Contract.app.models.Booking;

        try {
            console.log('[Contract after save] Looking for booking with bookingId:', contract.bookingId);
            
            // Load lại contract từ DB để có đầy đủ data
            const fullContract = await Contract.findById(contract.id);
            if (!fullContract) {
                console.log('[Contract after save] Could not load full contract data');
                return;
            }

            // Tìm booking theo bookingId - thử cả exact match và regex
            let booking = await Booking.findById(fullContract.bookingId);

            // Nếu không tìm thấy, thử với regex
            if (!booking) {
                booking = await Booking.findOne({
                    where: {
                        id: {
                            regexp: String(fullContract.bookingId),
                            options: 'i'
                        }
                    }
                });
            }

            if (!booking) {
                console.log('[Contract after save] Booking not found for bookingId:', fullContract.bookingId);
                return;
            }

            console.log('[Contract after save] Found booking:', booking.id);
            const updateData = {};
            
            // Sync các field từ contract sang booking
            if (fullContract.eventDate !== undefined && fullContract.eventDate !== null) {
                updateData.date = fullContract.eventDate;
            }
            if (fullContract.endTime !== undefined && fullContract.endTime !== null) {
                updateData.endTime = fullContract.endTime;
            }
            if (fullContract.hallId !== undefined && fullContract.hallId !== null) {
                updateData.roomId = fullContract.hallId;
            }
            if (fullContract.note !== undefined) {
                updateData.note = fullContract.note || '';
            }
            if (fullContract.customerId !== undefined && fullContract.customerId !== null) {
                updateData.customerId = fullContract.customerId;
            }
            
            // Sync loại tiệc
            if (fullContract.eventType !== undefined) {
                updateData.eventType = fullContract.eventType || '';
            }
            if (fullContract.partyType !== undefined) {
                updateData.partyType = fullContract.partyType || '';
            }
            
            // Sync các field về số lượng bàn và khách
            // Contract dùng tableCount, Booking dùng numberOfTables
            if (fullContract.tableCount !== undefined && fullContract.tableCount !== null) {
                updateData.numberOfTables = fullContract.tableCount;
            }
            if (fullContract.reserveTables !== undefined && fullContract.reserveTables !== null) {
                updateData.reserveTables = fullContract.reserveTables;
            }
            if (fullContract.freeTables !== undefined && fullContract.freeTables !== null) {
                updateData.freeTables = fullContract.freeTables;
            }
            if (fullContract.guestCount !== undefined && fullContract.guestCount !== null) {
                updateData.guestCount = fullContract.guestCount;
            }

            // Chỉ update nếu có thay đổi
            if (Object.keys(updateData).length > 0) {
                console.log('[Contract after save] Updating booking with data:', JSON.stringify(updateData));
                // Đặt flag để Booking.after save không sync ngược lại Contract
                await booking.updateAttributes(updateData, {
                    skipSyncFromContractHook: true
                });
                console.log('[Contract after save] Successfully updated booking:', booking.id);
            } else {
                console.log('[Contract after save] No changes to sync to booking');
            }

        } catch (error) {
            console.error('[Contract after save] Error syncing booking from contract:', error);
            // Don't throw error to avoid breaking the contract save
        }
    });
    
    /**
     * Calculate materials required for a contract's menu.
     * HTTP POST /Contracts/:id/calculateMaterials
     * Matches MaterialRequest.calculate logic but for single contract
     */
    Contract.calculateMaterials = async function(id, menuOverride) {
        if (!id) throw new Error('contract id is required');
        
        const app = require('../../server/server');
        const Product = app.models.Product;
        const StockItem = app.models.StockItem;
        
        // Load contract
        const contract = await Contract.findById(id);
        if (!contract) throw new Error('contract not found: ' + id);

        const menu = contract.menu || contract.menuObject || {};
      
        // Check if menu has BOM structure
        if (!menu || !menu.bom || !menu.bom.parts || menu.bom.parts.length === 0) {
            return { 
                materials: {}, 
                items: [], 
                groupedByDish: [],
                message: 'No menu items found' 
            };
        }



        // STEP 1: Build dishes map with correct table calculation
        const baseTableCount = contract.tableCount || 0;
        const reserveTables = contract.reserveTables || 0;
        const freeTables = contract.freeTables || 0;
        const totalTables = baseTableCount + reserveTables + freeTables;

        const dishes = {};
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

        const dishIds = Object.keys(dishes);
        if (!dishIds.length) {
            return { 
                materials: {}, 
                items: [], 
                groupedByDish: [],
                message: 'No dishes found' 
            };
        }

        // STEP 2: Load dishes with related materials
        const products = await Product.find({
            where: { id: { inq: dishIds } },
            include: {
                relation: 'relatedProducts',
                scope: { include: 'suppliers' }
            }
        });

        const groupedByDish = [];
        const materialMap = {};

        products.forEach(product => {
            const dish = dishes[product.id];
            if (!dish) return;

            // Build material dictionary
            const fullRawMatDict = {};
            const relatedProducts = product.relatedProducts || [];
            const relatedProductsArray = Array.isArray(relatedProducts) ? relatedProducts : (typeof relatedProducts === 'function' ? relatedProducts() : []);
            relatedProductsArray.forEach(rp => {
                fullRawMatDict[rp.id] = rp;
            });

            console.log('fullRawMatDict ', fullRawMatDict);

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
                    materialName: fullRawMat.name || rawMat.name || 'Unknown',
                    materialCode: fullRawMat.code || '',
                    category: fullRawMat.category || 'Khác',
                    uomUsage: rawMat.uomUsage || '',
                    uomStorage: rawMat.uomStorage || rawMat.uomUsage || '',
                    quantity: qtyNeeded,
                    buffer: fullRawMat.buffer || 0
                });

                // Aggregate materials
                if (!materialMap[materialId]) {
                    materialMap[materialId] = {
                        productId: materialId,
                        productName: fullRawMat.name || rawMat.name || 'Unknown',
                        productCode: fullRawMat.code || '',
                        category: fullRawMat.category || 'Khác',
                        uomUsage: rawMat.uomUsage || '',
                        uomStorage: rawMat.uomStorage || rawMat.uomUsage || '',
                        bomTotal: 0,
                        stock: 0,
                        buffer: fullRawMat.buffer || 0,
                        type: fullRawMat.type,
                        details: []
                    };
                }

                materialMap[materialId].bomTotal += qtyNeeded;

                // Store detail
                const existingDetail = materialMap[materialId].details.find(d => d.dishId === product.id);
                if (!existingDetail) {
                    materialMap[materialId].details.push({
                        dish: dish.name || 'Unknown',
                        dishId: product.id,
                        quantity: qtyNeeded,
                        banquet: (dish.details && dish.details[0]) ? dish.details[0].banquet : '',
                        banquetId: (dish.details && dish.details[0]) ? dish.details[0].banquetId : '',
                        tables: (dish.details && dish.details[0]) ? dish.details[0].tables : 0
                    });
                } else {
                    existingDetail.quantity += qtyNeeded;
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
            return { 
                materials: {}, 
                items: [], 
                groupedByDish,
                message: 'No materials found in BOMs' 
            };
        }

        const materialIds = items.map(item => item.productId);

        // STEP 3: Load material master data
        const materialProducts = await Product.find({
            where: { id: { inq: materialIds } },
            include: 'suppliers'
        });

        const productMap = {};
        (materialProducts || []).forEach(p => {
            productMap[p.id] = p;
        });

        // Enrich items
        items.forEach(item => {
            const product = productMap[item.productId];
            if (!product) {
                console.warn('Product not found for materialId:', item.productId);
                // Set defaults if product not found
                item.productCode = item.productCode || '';
                item.uomStorage = item.uomStorage || item.uomUsage || 'kg';
                item.price = 0;
                item.suppliers = [];
                item.bomTotalConverted = item.bomTotal;
                return;
            }

            item.productCode = product.code || '';
            item.uomStorage = product.uomStorage || product.uom || 'kg';
            item.uomUsage = item.uomUsage || product.uomUsage || product.uom || 'kg';
            item.price = product.purchasePrice || 0;
            item.buffer = product.buffer || item.buffer || 0;
            item.type = product.type || item.type;

            const suppliers = product.suppliers || [];
            const suppliersArray = Array.isArray(suppliers) ? suppliers : (typeof suppliers === 'function' ? suppliers() : []);
            
            if (suppliersArray && suppliersArray.length > 0) {
                item.supplierName = suppliersArray[0].name || '';
                item.supplierId = suppliersArray[0].id || '';
                item.suppliers = suppliersArray.map(s => ({ 
                    id: s.id || '', 
                    name: s.name || '' 
                }));
            } else {
                item.suppliers = [];
            }

            // Unit conversion
            if (item.uomUsage !== item.uomStorage) {
                const converted = convertUnit(item.bomTotal, item.uomUsage, item.uomStorage);
                item.bomTotalConverted = converted.quantity;
            } else {
                item.bomTotalConverted = item.bomTotal;
            }
        });

        // STEP 4: Load stock
        const stockItems = await StockItem.find({ 
            where: { productId: { inq: materialIds } } 
        });

        const stockMap = {};
        (stockItems || []).forEach(stock => {
            if (!stockMap[stock.productId]) {
                stockMap[stock.productId] = 0;
            }
            stockMap[stock.productId] += (Number(stock.quantity) || 0);
        });

        items.forEach(item => {
            item.stock = stockMap[item.productId] || 0;
            
            // Calculate suggested order
            const currentBom = item.bomTotalConverted || item.bomTotal;
            const buffer = item.buffer || 0;
            const needed = currentBom * (1 + buffer / 100);
            const suggest = needed - (item.stock || 0);
            item.manualOrder = suggest > 0 ? Math.round(suggest * 10) / 10 : 0;
        });

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
            
            categoryMap[cat].items.push(item);
            
            const uom = (item.uomStorage || 'kg').toString();
            categoryMap[cat].totalsByUom[uom] = 
                (categoryMap[cat].totalsByUom[uom] || 0) + (Number(item.manualOrder) || 0);
        });

        const materialsGrouped = Object.values(categoryMap);

        // Legacy format for backward compatibility
        const materials = {};
        items.forEach(item => {
            materials[item.productId] = {
                qty: item.bomTotalConverted || item.bomTotal,
                unit: item.uomStorage || item.uomUsage,
                name: item.productName,
                stock: item.stock,
                buffer: item.buffer,
                suggested: item.manualOrder
            };
        });

        return {
            materials,
            items,
            groupedByDish,
            materialsGrouped,
            totalTables,
            baseTableCount,
            reserveTables,
            freeTables,
            totalCost: items.reduce((sum, item) => sum + ((item.manualOrder || 0) * (item.price || 0)), 0)
        };
    };

    // Unit conversion helper
    function convertUnit(quantity, fromUom, toUom) {
        if (!fromUom || !toUom || fromUom === toUom) {
            return { quantity: quantity, uom: toUom || fromUom || 'kg' };
        }

        const rules = {
            'gr': { 'kg': 0.001, 'tạ': 0.00001, 'tấn': 0.000001 },
            'kg': { 'gr': 1000, 'tạ': 0.01, 'tấn': 0.001 },
            'ml': { 'lít': 0.001, 'l': 0.001 },
            'lít': { 'ml': 1000 },
            'l': { 'ml': 1000 }
        };

        const from = String(fromUom || '').toLowerCase().trim();
        const to = String(toUom || '').toLowerCase().trim();

        if (rules[from] && rules[from][to]) {
            return {
                quantity: parseFloat((quantity * rules[from][to]).toFixed(3)),
                uom: toUom
            };
        }

        return { quantity: quantity, uom: fromUom };
    }

    Contract.remoteMethod('calculateMaterials', {
        accepts: [
            { arg: 'id', type: 'string', required: true, http: { source: 'path' } },
            { arg: 'menu', type: 'object', http: { source: 'body' } }
        ],
        returns: { arg: 'materials', type: 'object', root: true },
        http: { path: '/:id/calculateMaterials', verb: 'post' }
    });

    /**
     * Activate event/contract - sets operationStatus to 'activated' and creates ProductionOrder
     * HTTP POST /Contracts/:id/activate
     */
    Contract.activate = async function(id) {
        if (!id) throw new Error('contract id is required');

        const app = require('../../server/server');
        const ProductionOrder = app.models.ProductionOrder;
        const ProductionItem = app.models.ProductionItem;
        const Product = app.models.Product;

        // Load contract with relations
        const contract = await Contract.findById(id, { include: 'hall' });
        if (!contract) throw new Error('Contract not found: ' + id);

        // Check if already activated
        if (contract.operationStatus === 'activated' || contract.operationStatus === 'in_progress' || contract.operationStatus === 'completed') {
            throw new Error('Contract is already activated or in progress. Current status: ' + contract.operationStatus);
        }

        // Calculate total tables: tableCount + reserveTables + freeTables
        const tableCount = Number(contract.tableCount) || 0;
        const reserveTables = Number(contract.reserveTables) || 0;
        const freeTables = Number(contract.freeTables) || 0;
        const totalTables = tableCount + reserveTables + freeTables;

        if (totalTables === 0) {
            throw new Error('Cannot activate contract: Total tables (confirmed + reserve + free) must be greater than 0');
        }

        // Update contract tableCount to total
        await contract.updateAttributes({
            operationStatus: 'activated',
            tableCount: totalTables
        });

        // Extract menu items from contract
        const menu = contract.menu || contract.menuObject || {};
        if (!menu || !menu.bom || !Array.isArray(menu.bom.parts) || menu.bom.parts.length === 0) {
            throw new Error('Contract menu is empty or invalid. Cannot create production order.');
        }

        // Build product quantities map (dishId -> quantity considering all tables)
        const productQuantities = {};
        menu.bom.parts.forEach(part => {
            const dishId = part.materialId || part.productId || part.id;
            const qtyPerTable = Number(part.quantity || part.qty || 0);
            if (!dishId || qtyPerTable <= 0) return;

            const totalQty = qtyPerTable * totalTables;
            productQuantities[dishId] = (productQuantities[dishId] || 0) + totalQty;
        });

        const productIds = Object.keys(productQuantities);
        if (productIds.length === 0) {
            throw new Error('No valid products found in contract menu');
        }

        // Load product details
        const products = await Product.find({ where: { id: { inq: productIds } } });
        const productById = {};
        products.forEach(p => {
            productById[p.id] = p;
        });

        // Generate ProductionOrder code
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
        const poCode = `KPO-${year}${month}${day}-${random}`;

        // Determine event name and hall
        const eventName = contract.name || contract.eventName || 'Event';
        const hall = contract.hall && typeof contract.hall === 'function' ? contract.hall() : contract.hall;
        const hallName = contract.hallName || (hall && hall.name) || '';

        // Calculate pax (guests) - typically 10 guests per table
        const pax = totalTables * 10;

        // Create ProductionOrder
        const productionOrderData = {
            code: poCode,
            status: 'new',
            contractId: contract.id,
            eventName: eventName,
            hallName: hallName,
            pax: pax,
            tableQty: totalTables,
            dueDate: contract.eventDate || new Date(),
            notes: `Tạo từ hợp đồng ${contract.id}. Bàn chính: ${tableCount}, Bàn dự phòng: ${reserveTables}, Bàn tặng: ${freeTables}`
        };

        const productionOrder = await ProductionOrder.create(productionOrderData);

        // Create ProductionItems for each product
        const productionItems = [];
        for (const productId of productIds) {
            const product = productById[productId];
            const quantity = productQuantities[productId];

            if (!product) {
                console.warn(`Product ${productId} not found, skipping`);
                continue;
            }

            productionItems.push({
                productionOrderId: productionOrder.id,
                productId: productId,
                productName: product.name || product.title || 'Unknown',
                quantity: quantity,
                unit: product.uom || product.unit || 'portion',
                status: 'pending'
            });
        }

        if (productionItems.length > 0) {
            await ProductionItem.create(productionItems);
        }

        // Return result
        return {
            success: true,
            contract: {
                id: contract.id,
                operationStatus: 'activated',
                tableCount: totalTables,
                reserveTables: reserveTables,
                freeTables: freeTables
            },
            productionOrder: {
                id: productionOrder.id,
                code: productionOrder.code,
                status: productionOrder.status,
                tableQty: totalTables,
                pax: pax,
                itemCount: productionItems.length
            }
        };
    };

    Contract.remoteMethod('activate', {
        accepts: [
            { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/:id/activate', verb: 'post' },
        description: 'Activate contract and create production order with total tables (confirmed + reserve + free)'
    });
    
};
