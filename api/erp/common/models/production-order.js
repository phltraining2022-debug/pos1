module.exports = function(ProductionOrder) {
    
    /**
     * Get materials from linked MaterialRequests
     * HTTP GET /ProductionOrders/:id/getMaterials
     * 
     * Flow:
     * 1. Load ProductionOrder với contract
     * 2. Load MaterialRequests cho contract này (department: 'kitchen' và 'operations')
     * 3. Lấy items từ MaterialRequests
     * 4. Return materials array
     * 
     * Returns:
     * {
     *   kitchenMaterials: [...],      // NVL từ MaterialRequest (kitchen)
     *   operationsMaterials: [...],    // Vật tư setup từ MaterialRequest (operations)
     *   allMaterials: [...],           // Tổng hợp cả 2 loại
     *   kitchenRequest: {...},         // Info MaterialRequest kitchen
     *   operationsRequest: {...}       // Info MaterialRequest operations
     * }
     */
    // ProductionOrder.getMaterials = function(id, cb) {
    //     const app = require('../../server/server');
    //     const MaterialRequest = app.models.MaterialRequest;
        
    //     ProductionOrder.findById(id, {
    //         include: ['contract']
    //     }, function(err, po) {
    //         if (err) return cb(err);
    //         if (!po) return cb(new Error('ProductionOrder not found'));
            
    //         const contractId = po.contractId;
    //         if (!contractId) {
    //             return cb(null, {
    //                 kitchenMaterials: [],
    //                 operationsMaterials: [],
    //                 allMaterials: [],
    //                 kitchenRequest: null,
    //                 operationsRequest: null
    //             });
    //         }
            
    //         // Load MaterialRequests cho contract này
    //         // Chỉ lấy MaterialRequests đã được approve hoặc completed
    //         MaterialRequest.find({
    //             where: {
    //                 contractIds: { inq: [contractId] },
    //                 status: { inq: ['approved', 'completed', 'partial'] }
    //             },
    //             include: ['items']
    //         }, function(err, requests) {
    //             if (err) return cb(err);
                
    //             // Tìm MaterialRequest cho kitchen và operations
    //             const kitchenRequest = requests.find(r => r.department === 'kitchen');
    //             const operationsRequest = requests.find(r => r.department === 'operations');
                
    //             // Map items từ MaterialRequest (kitchen) thành materials
    //             const kitchenMaterials = [];
    //             if (kitchenRequest && kitchenRequest.items && Array.isArray(kitchenRequest.items)) {
    //                 kitchenRequest.items.forEach(item => {
    //                     kitchenMaterials.push({
    //                         materialId: item.productId,
    //                         materialName: item.productName || item.name || 'Unknown',
    //                         materialCode: item.productCode || item.code || '',
    //                         quantity: item.requiredQuantity || item.toPurchase || 0,
    //                         uomUsage: item.uom || item.uomUsage || 'unit',
    //                         uomStorage: item.uomStorage || item.uom || 'unit',
    //                         type: 'raw_material',
    //                         source: 'MaterialRequest (Kitchen)',
    //                         materialRequestId: kitchenRequest.id,
    //                         materialRequestCode: kitchenRequest.code,
    //                         materialRequestName: kitchenRequest.name,
    //                         category: item.category || 'Khác',
    //                         price: item.estimatedPrice || 0
    //                     });
    //                 });
    //             }
                
    //             // Map items từ MaterialRequest (operations) thành materials
    //             const operationsMaterials = [];
    //             if (operationsRequest && operationsRequest.items && Array.isArray(operationsRequest.items)) {
    //                 operationsRequest.items.forEach(item => {
    //                     operationsMaterials.push({
    //                         materialId: item.productId,
    //                         materialName: item.productName || item.name || 'Unknown',
    //                         materialCode: item.productCode || item.code || '',
    //                         quantity: item.requiredQuantity || item.toPurchase || 0,
    //                         uomUsage: item.uom || item.uomUsage || 'unit',
    //                         uomStorage: item.uomStorage || item.uom || 'unit',
    //                         type: 'setup_material',
    //                         source: 'MaterialRequest (Operations)',
    //                         materialRequestId: operationsRequest.id,
    //                         materialRequestCode: operationsRequest.code,
    //                         materialRequestName: operationsRequest.name,
    //                         category: item.category || 'Khác',
    //                         price: item.estimatedPrice || 0
    //                     });
    //                 });
    //             }
                
    //             const allMaterials = [...kitchenMaterials, ...operationsMaterials];
                
    //             return cb(null, {
    //                 kitchenMaterials: kitchenMaterials,
    //                 operationsMaterials: operationsMaterials,
    //                 allMaterials: allMaterials,
    //                 kitchenRequest: kitchenRequest ? {
    //                     id: kitchenRequest.id,
    //                     code: kitchenRequest.code,
    //                     name: kitchenRequest.name,
    //                     status: kitchenRequest.status
    //                 } : null,
    //                 operationsRequest: operationsRequest ? {
    //                     id: operationsRequest.id,
    //                     code: operationsRequest.code,
    //                     name: operationsRequest.name,
    //                     status: operationsRequest.status
    //                 } : null
    //             });
    //         });
    //     });
    // };

    ProductionOrder.getMaterials = function(id, cb) {
        const app = require('../../server/server');
        const MaterialRequest = app.models.MaterialRequest;
        
        ProductionOrder.findById(id, {
            include: ['contract']
        }, function(err, po) {
            if (err) return cb(err);
            if (!po) return cb(new Error('ProductionOrder not found'));
            
            const contractId = po.contractId;
            if (!contractId) {
                return cb(null, {
                    kitchenMaterials: [],
                    operationsMaterials: [],
                    allMaterials: [],
                    kitchenRequest: null,
                    operationsRequest: null
                });
            }
            
            // Load MaterialRequests cho contract này
            // Chỉ lấy MaterialRequests đã được approve hoặc completed
            MaterialRequest.find({
                where: {
                    contractIds: { inq: [contractId] },
                    status: { inq: ['approved', 'completed', 'partial'] }
                }
            }, function(err, requests) {
                if (err) return cb(err);
                
                // Tìm MaterialRequest cho kitchen và operations
                const kitchenRequest = requests.find(r => r.department === 'kitchen');
                const operationsRequest = requests.find(r => r.department === 'operations');
                
                // Load MaterialRequestItems riêng cho từng MaterialRequest
                const MaterialRequestItem = app.models.MaterialRequestItem;
                const requestIds = [];
                if (kitchenRequest) requestIds.push(kitchenRequest.id);
                if (operationsRequest) requestIds.push(operationsRequest.id);
                
                if (requestIds.length === 0) {
                    return cb(null, {
                        kitchenMaterials: [],
                        operationsMaterials: [],
                        allMaterials: [],
                        kitchenRequest: null,
                        operationsRequest: null
                    });
                }
                
                // Load tất cả MaterialRequestItems cho các MaterialRequests này
                MaterialRequestItem.find({
                    where: {
                        materialRequestId: { inq: requestIds }
                    }
                }, function(err, items) {
                    if (err) return cb(err);
                    
                    // Map items từ MaterialRequest (kitchen) thành materials
                    const kitchenMaterials = [];
                    if (kitchenRequest && items) {
                        const kitchenItems = items.filter(item => item.materialRequestId === kitchenRequest.id);
                        kitchenItems.forEach(item => {
                            kitchenMaterials.push({
                                materialId: item.productId,
                                materialName: item.productName || item.name || 'Unknown',
                                materialCode: item.productCode || item.code || '',
                                quantity: item.requiredQuantity || item.toPurchase || 0,
                                uomUsage: item.uom || item.uomUsage || 'unit',
                                uomStorage: item.uomStorage || item.uom || 'unit',
                                type: 'raw_material',
                                source: 'MaterialRequest (Kitchen)',
                                materialRequestId: kitchenRequest.id,
                                materialRequestCode: kitchenRequest.code,
                                materialRequestName: kitchenRequest.name,
                                category: item.category || 'Khác',
                                price: item.estimatedPrice || 0
                            });
                        });
                    }
                    
                    // Map items từ MaterialRequest (operations) thành materials
                    const operationsMaterials = [];
                    if (operationsRequest && items) {
                        const operationsItems = items.filter(item => item.materialRequestId === operationsRequest.id);
                        operationsItems.forEach(item => {
                            operationsMaterials.push({
                                materialId: item.productId,
                                materialName: item.productName || item.name || 'Unknown',
                                materialCode: item.productCode || item.code || '',
                                quantity: item.requiredQuantity || item.toPurchase || 0,
                                uomUsage: item.uom || item.uomUsage || 'unit',
                                uomStorage: item.uomStorage || item.uom || 'unit',
                                type: 'setup_material',
                                source: 'MaterialRequest (Operations)',
                                materialRequestId: operationsRequest.id,
                                materialRequestCode: operationsRequest.code,
                                materialRequestName: operationsRequest.name,
                                category: item.category || 'Khác',
                                price: item.estimatedPrice || 0
                            });
                        });
                    }
                    
                    const allMaterials = [...kitchenMaterials, ...operationsMaterials];
                    
                    return cb(null, {
                        kitchenMaterials: kitchenMaterials,
                        operationsMaterials: operationsMaterials,
                        allMaterials: allMaterials,
                        kitchenRequest: kitchenRequest ? {
                            id: kitchenRequest.id,
                            code: kitchenRequest.code,
                            name: kitchenRequest.name,
                            status: kitchenRequest.status
                        } : null,
                        operationsRequest: operationsRequest ? {
                            id: operationsRequest.id,
                            code: operationsRequest.code,
                            name: operationsRequest.name,
                            status: operationsRequest.status
                        } : null
                    });
                });
            });
        });
    };
    
    ProductionOrder.remoteMethod('getMaterials', {
        description: 'Get materials from linked MaterialRequests (kitchen NVL + operations setup materials)',
        accepts: [
            { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/:id/getMaterials', verb: 'get' }
    });
};

