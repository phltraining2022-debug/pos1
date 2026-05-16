module.exports = function(WarehouseLocation) {
  /**
   * Before save hook to auto-generate location code and validate capacity
   */
  WarehouseLocation.observe('before save', function(ctx, next) {
    const data = ctx.instance || ctx.data;
    
    if (!data) return next();

    // Auto-generate location code from hierarchy if not provided
    if (ctx.isNewInstance && !data.code && data.zoneCode) {
      const parts = [
        data.zoneCode,
        data.aisle || '',
        data.rack || '',
        data.shelf || '',
        data.bin || ''
      ].filter(p => p); // Remove empty parts
      
      data.code = parts.join('-');
    }

    // Auto-calculate volume capacity from dimensions if not provided
    if (data.width && data.height && data.depth && !data.volumeCapacity) {
      data.volumeCapacity = data.width * data.height * data.depth;
    }

    // Validate current occupancy doesn't exceed capacity
    if (data.currentOccupancy !== undefined && data.capacity !== undefined) {
      if (data.currentOccupancy > data.capacity) {
        return next(new Error('Current occupancy cannot exceed capacity'));
      }
      
      // Auto-set status to 'full' if at capacity
      if (data.currentOccupancy >= data.capacity) {
        data.status = 'full';
      } else if (data.status === 'full' && data.currentOccupancy < data.capacity) {
        // Reset from full to active if occupancy decreases
        data.status = 'active';
      }
    }

    // Validate temperature range for cold storage
    if (data.locationType && ['COLD_STORAGE', 'FREEZER'].includes(data.locationType)) {
      if (data.temperatureMin !== undefined && data.temperatureMax !== undefined) {
        if (data.temperatureMin > data.temperatureMax) {
          return next(new Error('Minimum temperature cannot exceed maximum temperature'));
        }
      }
    }

    // Validate reserved location
    if (data.isReserved === false) {
      data.reservedFor = null; // Clear reservation details
    }

    next();
  });

  /**
   * Remote method to check if location can accommodate a product
   */
  WarehouseLocation.canAccommodate = function(locationId, productId, quantity, cb) {
    const app = require('../../server/server');
    const Product = app.models.Product;

    WarehouseLocation.findById(locationId, function(err, location) {
      if (err) return cb(err);
      if (!location) return cb(new Error('Location not found'));

      // Check if location is active and allows putaway
      if (location.status !== 'active' || !location.isPutawayAllowed) {
        return cb(null, {
          canAccommodate: false,
          reason: 'Location is not active or putaway is not allowed'
        });
      }

      // Check if reserved for something else
      if (location.isReserved && location.reservedFor !== productId) {
        return cb(null, {
          canAccommodate: false,
          reason: 'Location is reserved for another product'
        });
      }

      // Check capacity
      const availableCapacity = location.capacity - (location.currentOccupancy || 0);
      if (quantity > availableCapacity) {
        return cb(null, {
          canAccommodate: false,
          reason: 'Insufficient capacity',
          availableCapacity: availableCapacity,
          requested: quantity
        });
      }

      // Check product type restrictions
      if (location.restrictedProducts && location.restrictedProducts.includes(productId)) {
        return cb(null, {
          canAccommodate: false,
          reason: 'Product is restricted from this location'
        });
      }

      // If product type restrictions exist, check them
      if (location.allowedProductTypes && location.allowedProductTypes.length > 0) {
        Product.findById(productId, function(err, product) {
          if (err) return cb(err);
          if (!product) {
            return cb(null, {
              canAccommodate: false,
              reason: 'Product not found'
            });
          }

          const productType = product.type || product.category || product.productType;
          if (productType && !location.allowedProductTypes.includes(productType)) {
            return cb(null, {
              canAccommodate: false,
              reason: 'Product type not allowed in this location',
              productType: productType,
              allowedTypes: location.allowedProductTypes
            });
          }

          // All checks passed
          return cb(null, {
            canAccommodate: true,
            availableCapacity: availableCapacity,
            location: location
          });
        });
      } else {
        // No product type restrictions, all checks passed
        cb(null, {
          canAccommodate: true,
          availableCapacity: availableCapacity,
          location: location
        });
      }
    });
  };

  /**
   * Remote method to update occupancy (add/remove stock)
   */
  WarehouseLocation.updateOccupancy = function(locationId, quantityDelta, cb) {
    WarehouseLocation.findById(locationId, function(err, location) {
      if (err) return cb(err);
      if (!location) return cb(new Error('Location not found'));

      const currentOccupancy = location.currentOccupancy || 0;
      const newOccupancy = currentOccupancy + quantityDelta;

      if (newOccupancy < 0) {
        return cb(new Error('Occupancy cannot be negative'));
      }

      if (newOccupancy > location.capacity) {
        return cb(new Error('Occupancy would exceed capacity'));
      }

      location.updateAttributes({
        currentOccupancy: newOccupancy,
        status: newOccupancy >= location.capacity ? 'full' : 'active'
      }, function(err, updated) {
        if (err) return cb(err);
        cb(null, updated);
      });
    });
  };

  /**
   * Remote method to find optimal location for a product
   * Returns the best location based on priority, available capacity, and restrictions
   */
  WarehouseLocation.findOptimalLocation = function(warehouseId, productId, quantity, cb) {
    const app = require('../../server/server');
    const Product = app.models.Product;

    Product.findById(productId, function(err, product) {
      if (err) return cb(err);
      if (!product) return cb(new Error('Product not found'));

      const productType = product.type || product.category || product.productType;

      // Build filter for suitable locations
      const filter = {
        where: {
          warehouseId: warehouseId,
          status: 'active',
          isPutawayAllowed: true,
          isReserved: false
        },
        order: 'priority DESC, currentOccupancy ASC' // Higher priority first, then less occupied
      };

      WarehouseLocation.find(filter, function(err, locations) {
        if (err) return cb(err);

        // Filter locations that can accommodate the product
        const suitableLocations = locations.filter(loc => {
          // Check capacity
          const availableCapacity = loc.capacity - (loc.currentOccupancy || 0);
          if (quantity > availableCapacity) return false;

          // Check restricted products
          if (loc.restrictedProducts && loc.restrictedProducts.includes(productId)) {
            return false;
          }

          // Check allowed product types
          if (loc.allowedProductTypes && loc.allowedProductTypes.length > 0) {
            if (productType && !loc.allowedProductTypes.includes(productType)) {
              return false;
            }
          }

          return true;
        });

        if (suitableLocations.length === 0) {
          return cb(null, {
            found: false,
            reason: 'No suitable location found',
            warehouseId: warehouseId,
            productId: productId,
            quantity: quantity
          });
        }

        // Return the best location (first after sorting by priority and occupancy)
        cb(null, {
          found: true,
          location: suitableLocations[0],
          alternatives: suitableLocations.slice(1, 5) // Up to 4 alternative locations
        });
      });
    });
  };

  /**
   * Remote method to get location utilization statistics
   */
  WarehouseLocation.getUtilization = function(warehouseId, cb) {
    const filter = warehouseId ? { where: { warehouseId: warehouseId } } : {};

    WarehouseLocation.find(filter, function(err, locations) {
      if (err) return cb(err);

      const stats = {
        totalLocations: locations.length,
        active: locations.filter(l => l.status === 'active').length,
        full: locations.filter(l => l.status === 'full').length,
        inactive: locations.filter(l => l.status === 'inactive').length,
        maintenance: locations.filter(l => l.status === 'maintenance').length,
        totalCapacity: 0,
        totalOccupied: 0,
        utilizationPercent: 0,
        byType: {}
      };

      locations.forEach(loc => {
        stats.totalCapacity += loc.capacity || 0;
        stats.totalOccupied += loc.currentOccupancy || 0;

        // Group by location type
        const type = loc.locationType || 'UNKNOWN';
        if (!stats.byType[type]) {
          stats.byType[type] = {
            count: 0,
            capacity: 0,
            occupied: 0,
            utilization: 0
          };
        }
        stats.byType[type].count++;
        stats.byType[type].capacity += loc.capacity || 0;
        stats.byType[type].occupied += loc.currentOccupancy || 0;
      });

      // Calculate utilization percentages
      stats.utilizationPercent = stats.totalCapacity > 0 
        ? Math.round((stats.totalOccupied / stats.totalCapacity) * 100) 
        : 0;

      Object.keys(stats.byType).forEach(type => {
        const typeStats = stats.byType[type];
        typeStats.utilization = typeStats.capacity > 0 
          ? Math.round((typeStats.occupied / typeStats.capacity) * 100) 
          : 0;
      });

      cb(null, stats);
    });
  };

  // Register remote methods
  WarehouseLocation.remoteMethod('canAccommodate', {
    accepts: [
      { arg: 'locationId', type: 'string', required: true, http: { source: 'path' } },
      { arg: 'productId', type: 'string', required: true },
      { arg: 'quantity', type: 'number', required: true }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/:locationId/can-accommodate', verb: 'get' },
    description: 'Check if location can accommodate a product quantity'
  });

  WarehouseLocation.remoteMethod('updateOccupancy', {
    accepts: [
      { arg: 'locationId', type: 'string', required: true, http: { source: 'path' } },
      { arg: 'quantityDelta', type: 'number', required: true, description: 'Positive to add, negative to remove' }
    ],
    returns: { arg: 'location', type: 'object', root: true },
    http: { path: '/:locationId/update-occupancy', verb: 'post' },
    description: 'Update location occupancy (add or remove stock)'
  });

  WarehouseLocation.remoteMethod('findOptimalLocation', {
    accepts: [
      { arg: 'warehouseId', type: 'string', required: true },
      { arg: 'productId', type: 'string', required: true },
      { arg: 'quantity', type: 'number', required: true }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/find-optimal', verb: 'get' },
    description: 'Find the best location for storing a product'
  });

  WarehouseLocation.remoteMethod('getUtilization', {
    accepts: [
      { arg: 'warehouseId', type: 'string', description: 'Optional: filter by warehouse' }
    ],
    returns: { arg: 'stats', type: 'object', root: true },
    http: { path: '/utilization', verb: 'get' },
    description: 'Get location utilization statistics'
  });
};
