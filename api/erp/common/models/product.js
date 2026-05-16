module.exports = function (Product) {
    // Hook trước khi lưu - xử lý relatedProductIds từ BOM
    Product.observe("before save", function (ctx, next) {
        const instance = ctx.instance || ctx.data;
        if (!instance) return next();

        try {
            // Kiểm tra xem instance có structure BOM không
            if (instance.bom && 
                instance.bom.rawMaterials && 
                Array.isArray(instance.bom.rawMaterials) && 
                instance.bom.rawMaterials.length > 0) { 

                // Extract materialId từ rawMaterials array
                instance.relatedProductIds = instance.bom.rawMaterials
                    .map(item => item.materialId)
                    .filter(id => id); // Lọc bỏ các id null/undefined
                
                console.log(`✓ Cập nhật relatedProductIds từ BOM: ${instance.relatedProductIds.join(', ')}`);
            } else {
                // Nếu không có BOM hoặc rawMaterials rỗng
                instance.relatedProductIds = [];
                console.log('⊗ Không có BOM hoặc rawMaterials rỗng');
            }
            
            next();
        } catch (error) {
            console.error('Lỗi trong beforeSave hook:', error);
            next(error);
        }
    });
};
