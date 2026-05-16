module.exports = function(ProductionBatch) {
  
  // Helper function to generate unique redemption code
  function generateRedemptionCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = 'WHKY-';
    
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      if (i < 2) result += '-';
    }
    
    return result;
  }

  // Helper function to generate unique code with collision detection
  async function generateUniqueRedemptionCode() {
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
      const code = generateRedemptionCode();
      
      // Check if code already exists
      const existingCode = await ProductionBatch.app.models.RedemptionCode.findOne({
        where: { code: code }
      });
      
      if (!existingCode) {
        return code;
      }
      
      attempts++;
    }
    
    throw new Error('Unable to generate unique redemption code after maximum attempts');
  }

  // Helper function to create redemption codes for a batch
  async function createRedemptionCodesForBatch(productionBatch) {
    const RedemptionCode = ProductionBatch.app.models.RedemptionCode;
    const quantity = productionBatch.quantity;
    const batchId = productionBatch.id;
    
    console.log(`Creating ${quantity} redemption codes for batch ${productionBatch.batchCode}`);
    
    // Generate codes in batches to avoid memory issues
    const batchSize = 100;
    const codes = [];
    
    for (let i = 0; i < quantity; i += batchSize) {
      const currentBatchSize = Math.min(batchSize, quantity - i);
      const batchCodes = [];
      
      // Generate codes for current batch
      for (let j = 0; j < currentBatchSize; j++) {
        try {
          const code = await generateUniqueRedemptionCode();
          batchCodes.push({
            code: code,
            pointsValue: 100, // Default points value, can be made configurable
            status: 'available',
            productionBatchId: batchId,
            expiresAt: new Date(new Date().getFullYear(), 11, 31, 23, 59, 59), // End of current year
            isActive: true
          });
        } catch (error) {
          console.error(`Error generating code ${i + j + 1}:`, error);
          throw error;
        }
      }
      
      // Bulk create codes for current batch
      try {
        const createdCodes = await RedemptionCode.create(batchCodes);
        codes.push(...createdCodes);
        console.log(`Created ${createdCodes.length} codes (${i + 1}-${i + createdCodes.length}/${quantity})`);
      } catch (error) {
        console.error(`Error creating codes batch ${i + 1}-${i + currentBatchSize}:`, error);
        throw error;
      }
    }
    
    return codes;
  }

  // Helper function to delete redemption codes for a batch
  async function deleteRedemptionCodesForBatch(productionBatchId) {
    const RedemptionCode = ProductionBatch.app.models.RedemptionCode;
    
    console.log(`Deleting redemption codes for batch ${productionBatchId}`);
    
    try {
      // Find all codes for this batch
      const codes = await RedemptionCode.find({
        where: { productionBatchId: productionBatchId }
      });
      
      if (codes.length > 0) {
        // Check if any codes are already redeemed
        const redeemedCodes = codes.filter(code => code.status === 'redeemed');
        
        if (redeemedCodes.length > 0) {
          throw new Error(`Cannot delete batch: ${redeemedCodes.length} codes have already been redeemed`);
        }
        
        // Delete all codes for this batch
        await RedemptionCode.destroyAll({
          productionBatchId: productionBatchId
        });
        
        console.log(`Deleted ${codes.length} redemption codes for batch ${productionBatchId}`);
      }
    } catch (error) {
      console.error(`Error deleting codes for batch ${productionBatchId}:`, error);
      throw error;
    }
  }

  // Hook: After save - create redemption codes when batch is created or updated
  ProductionBatch.observe('after save', async function(ctx, next) {
    try {
      const instance = ctx.instance || ctx.data;
      const isNew = ctx.isNewInstance;
      
      // Only create codes for new batches or when quantity changes
      if (isNew || (ctx.data && ctx.data.quantity && ctx.data.quantity !== ctx.currentInstance.quantity)) {
        // Check if codes should be generated (status is CODES_GENERATED or quantity > 0)
        if (instance.status === 'CODES_GENERATED' && instance.quantity > 0) {
          // Check if codes already exist for this batch
          const existingCodes = await ProductionBatch.app.models.RedemptionCode.find({
            where: { productionBatchId: instance.id }
          });
          
          if (existingCodes.length === 0) {
            // Create new codes
            await createRedemptionCodesForBatch(instance);
            console.log(`Successfully created ${instance.quantity} redemption codes for batch ${instance.batchCode}`);
          } else {
            console.log(`Codes already exist for batch ${instance.batchCode}, skipping creation`);
          }
        }
      }
      
      next();
    } catch (error) {
      console.error('Error in after save hook:', error);
      next(error);
    }
  });

  // Hook: Before delete - prevent deletion if codes are redeemed
  ProductionBatch.observe('before delete', async function(ctx, next) {
    try {
      const where = ctx.where;
      
      // Find the batch being deleted
      const batch = await ProductionBatch.findOne({ where });
      
      if (batch) {
        // Check if any codes are redeemed
        const redeemedCodes = await ProductionBatch.app.models.RedemptionCode.find({
          where: { 
            productionBatchId: batch.id,
            status: 'redeemed'
          }
        });
        
        if (redeemedCodes.length > 0) {
          const error = new Error(`Cannot delete batch ${batch.batchCode}: ${redeemedCodes.length} redemption codes have already been redeemed`);
          error.statusCode = 400;
          return next(error);
        }
      }
      
      next();
    } catch (error) {
      console.error('Error in before delete hook:', error);
      next(error);
    }
  });

  // Hook: After delete - clean up redemption codes
  ProductionBatch.observe('after delete', async function(ctx, next) {
    try {
      const instance = ctx.instance;
      
      if (instance) {
        await deleteRedemptionCodesForBatch(instance.id);
        console.log(`Successfully cleaned up redemption codes for deleted batch ${instance.batchCode}`);
      }
      
      next();
    } catch (error) {
      console.error('Error in after delete hook:', error);
      next(error);
    }
  });

  // Remote method to manually generate codes for a batch
  ProductionBatch.generateCodes = async function(batchId, options = {}) {
    const batch = await ProductionBatch.findById(batchId);
    
    if (!batch) {
      const error = new Error('Production batch not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Check if codes already exist
    const existingCodes = await ProductionBatch.app.models.RedemptionCode.find({
      where: { productionBatchId: batchId }
    });
    
    if (existingCodes.length > 0) {
      const error = new Error('Redemption codes already exist for this batch');
      error.statusCode = 400;
      throw error;
    }
    
    // Update batch status to CODES_GENERATED
    await batch.updateAttributes({ status: 'CODES_GENERATED' });
    
    // Create codes
    const codes = await createRedemptionCodesForBatch(batch);
    
    return {
      success: true,
      message: `Successfully generated ${codes.length} redemption codes`,
      codesGenerated: codes.length,
      batchCode: batch.batchCode
    };
  };

  // Remote method to delete all codes for a batch
  ProductionBatch.deleteCodes = async function(batchId, options = {}) {
    const batch = await ProductionBatch.findById(batchId);
    
    if (!batch) {
      const error = new Error('Production batch not found');
      error.statusCode = 404;
      throw error;
    }
    
    await deleteRedemptionCodesForBatch(batchId);
    
    // Update batch status to PLANNED
    await batch.updateAttributes({ status: 'PLANNED' });
    
    return {
      success: true,
      message: 'Successfully deleted all redemption codes for this batch',
      batchCode: batch.batchCode
    };
  };

  // Register remote methods
  ProductionBatch.remoteMethod('generateCodes', {
    accepts: [
      { arg: 'batchId', type: 'string', required: true, description: 'ID of the production batch' },
      { arg: 'options', type: 'object', http: { source: 'body' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/:id/generate-codes', verb: 'post' },
    description: 'Manually generate redemption codes for a production batch'
  });

  ProductionBatch.remoteMethod('deleteCodes', {
    accepts: [
      { arg: 'batchId', type: 'string', required: true, description: 'ID of the production batch' },
      { arg: 'options', type: 'object', http: { source: 'body' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/:id/delete-codes', verb: 'delete' },
    description: 'Delete all redemption codes for a production batch'
  });

};