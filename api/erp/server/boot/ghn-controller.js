"use strict";

const ghnService = require('./ghn');

/**
 * GHN Controller - Expose GHN services through LoopBack API
 * Provides comprehensive shipping management for ecommerce
 */

module.exports = function(app) {
  const ghnController = {};

  // 1. ADDRESS MANAGEMENT APIs

  ghnController.getProvinces = async function(req, res) {
    try {
      const result = await ghnService.getProvinces();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getDistricts = async function(req, res) {
    try {
      const { provinceId } = req.params;
      if (!provinceId) {
        return res.status(400).json({
          success: false,
          error: 'Province ID is required',
          data: null
        });
      }

      const result = await ghnService.getDistricts(provinceId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getWards = async function(req, res) {
    try {
      const { districtId } = req.params;
      if (!districtId) {
        return res.status(400).json({
          success: false,
          error: 'District ID is required',
          data: null
        });
      }

      const result = await ghnService.getWards(districtId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.validateAddress = async function(req, res) {
    try {
      const { provinceId, districtId, wardCode } = req.body;
      
      if (!provinceId || !districtId || !wardCode) {
        return res.status(400).json({
          success: false,
          error: 'Province ID, District ID, and Ward Code are required',
          data: null
        });
      }

      const result = await ghnService.validateAddress({ provinceId, districtId, wardCode });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // 2. SHIPPING FEE CALCULATION APIs

  ghnController.calculateFee = async function(req, res) {
    try {
      const feeData = req.body;
      
      if (!feeData.fromDistrictId || !feeData.toDistrictId) {
        return res.status(400).json({
          success: false,
          error: 'From District ID and To District ID are required',
          data: null
        });
      }

      const result = await ghnService.calculateFee(feeData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getServices = async function(req, res) {
    try {
      const { fromDistrictId, toDistrictId } = req.query;
      
      if (!fromDistrictId || !toDistrictId) {
        return res.status(400).json({
          success: false,
          error: 'From District ID and To District ID are required',
          data: null
        });
      }

      const result = await ghnService.getServices(fromDistrictId, toDistrictId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getExpectedDeliveryTime = async function(req, res) {
    try {
      const deliveryData = req.body;
      
      if (!deliveryData.fromDistrictId || !deliveryData.toDistrictId || !deliveryData.serviceId) {
        return res.status(400).json({
          success: false,
          error: 'From District ID, To District ID, and Service ID are required',
          data: null
        });
      }

      const result = await ghnService.getExpectedDeliveryTime(deliveryData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // 3. ORDER MANAGEMENT APIs

  ghnController.createOrder = async function(req, res) {
    try {
      const orderData = req.body;
      
      // Validate required fields
      const requiredFields = ['toName', 'toPhone', 'toAddress', 'toWardCode', 'toDistrictId', 'toProvinceId', 'serviceId'];
      const missingFields = requiredFields.filter(field => !orderData[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`,
          data: null
        });
      }

      const result = await ghnService.createOrder(orderData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getOrderInfo = async function(req, res) {
    try {
      const { orderCode } = req.params;
      
      if (!orderCode) {
        return res.status(400).json({
          success: false,
          error: 'Order Code is required',
          data: null
        });
      }

      const result = await ghnService.getOrderInfo(orderCode);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getOrderByClientCode = async function(req, res) {
    try {
      const { clientOrderCode } = req.params;
      
      if (!clientOrderCode) {
        return res.status(400).json({
          success: false,
          error: 'Client Order Code is required',
          data: null
        });
      }

      const result = await ghnService.getOrderByClientCode(clientOrderCode);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.updateOrder = async function(req, res) {
    try {
      const { orderCode } = req.params;
      const updateData = req.body;
      
      if (!orderCode) {
        return res.status(400).json({
          success: false,
          error: 'Order Code is required',
          data: null
        });
      }

      const result = await ghnService.updateOrder(orderCode, updateData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.cancelOrder = async function(req, res) {
    try {
      const { orderCode } = req.params;
      const { reason } = req.body;
      
      if (!orderCode) {
        return res.status(400).json({
          success: false,
          error: 'Order Code is required',
          data: null
        });
      }

      const result = await ghnService.cancelOrder(orderCode, reason);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.updateCOD = async function(req, res) {
    try {
      const { orderCode } = req.params;
      const { codAmount } = req.body;
      
      if (!orderCode || codAmount === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Order Code and COD Amount are required',
          data: null
        });
      }

      const result = await ghnService.updateCOD(orderCode, codAmount);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.printOrder = async function(req, res) {
    try {
      const { orderCodes } = req.body;
      
      if (!orderCodes || !Array.isArray(orderCodes) || orderCodes.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Order Codes array is required',
          data: null
        });
      }

      const result = await ghnService.printOrder(orderCodes);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.returnOrder = async function(req, res) {
    try {
      const { orderCode } = req.params;
      const { reason } = req.body;
      
      if (!orderCode) {
        return res.status(400).json({
          success: false,
          error: 'Order Code is required',
          data: null
        });
      }

      const result = await ghnService.returnOrder(orderCode, reason);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.deliveryAgain = async function(req, res) {
    try {
      const { orderCode } = req.params;
      
      if (!orderCode) {
        return res.status(400).json({
          success: false,
          error: 'Order Code is required',
          data: null
        });
      }

      const result = await ghnService.deliveryAgain(orderCode);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // 4. STORE MANAGEMENT APIs

  ghnController.createStore = async function(req, res) {
    try {
      const storeData = req.body;
      
      const requiredFields = ['name', 'phone', 'address', 'wardCode', 'districtId', 'provinceId'];
      const missingFields = requiredFields.filter(field => !storeData[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`,
          data: null
        });
      }

      const result = await ghnService.createStore(storeData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getStores = async function(req, res) {
    try {
      const result = await ghnService.getStores();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // 5. PICK SHIFT APIs

  ghnController.getPickShifts = async function(req, res) {
    try {
      const result = await ghnService.getPickShifts();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // 6. TICKET MANAGEMENT APIs

  ghnController.createTicket = async function(req, res) {
    try {
      const ticketData = req.body;
      
      if (!ticketData.orderCode || !ticketData.reason) {
        return res.status(400).json({
          success: false,
          error: 'Order Code and Reason are required',
          data: null
        });
      }

      const result = await ghnService.createTicket(ticketData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getTickets = async function(req, res) {
    try {
      const params = req.query;
      const result = await ghnService.getTickets(params);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.getTicket = async function(req, res) {
    try {
      const { ticketId } = req.params;
      
      if (!ticketId) {
        return res.status(400).json({
          success: false,
          error: 'Ticket ID is required',
          data: null
        });
      }

      const result = await ghnService.getTicket(ticketId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.createTicketFeedback = async function(req, res) {
    try {
      const { ticketId } = req.params;
      const feedbackData = req.body;
      
      if (!ticketId || !feedbackData.content) {
        return res.status(400).json({
          success: false,
          error: 'Ticket ID and Content are required',
          data: null
        });
      }

      const result = await ghnService.createTicketFeedback(ticketId, feedbackData);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // 7. UTILITY APIs

  ghnController.getShippingStatusList = function(req, res) {
    try {
      const result = ghnService.getShippingStatusList();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  ghnController.formatOrderData = function(req, res) {
    try {
      const orderData = req.body;
      const formattedData = ghnService.formatOrderData(orderData);
      
      res.json({
        success: true,
        data: formattedData,
        message: 'Order data formatted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // Register routes
  app.get('/api/ghn/provinces', ghnController.getProvinces);
  app.get('/api/ghn/districts/:provinceId', ghnController.getDistricts);
  app.get('/api/ghn/wards/:districtId', ghnController.getWards);
  app.post('/api/ghn/validate-address', ghnController.validateAddress);
  
  app.post('/api/ghn/calculate-fee', ghnController.calculateFee);
  app.get('/api/ghn/services', ghnController.getServices);
  app.post('/api/ghn/expected-delivery-time', ghnController.getExpectedDeliveryTime);
  
  app.post('/api/ghn/orders', ghnController.createOrder);
  app.get('/api/ghn/orders/:orderCode', ghnController.getOrderInfo);
  app.get('/api/ghn/orders/client/:clientOrderCode', ghnController.getOrderByClientCode);
  app.put('/api/ghn/orders/:orderCode', ghnController.updateOrder);
  app.delete('/api/ghn/orders/:orderCode', ghnController.cancelOrder);
  app.put('/api/ghn/orders/:orderCode/cod', ghnController.updateCOD);
  app.post('/api/ghn/orders/print', ghnController.printOrder);
  app.post('/api/ghn/orders/:orderCode/return', ghnController.returnOrder);
  app.post('/api/ghn/orders/:orderCode/delivery-again', ghnController.deliveryAgain);
  
  app.post('/api/ghn/stores', ghnController.createStore);
  app.get('/api/ghn/stores', ghnController.getStores);
  
  app.get('/api/ghn/pick-shifts', ghnController.getPickShifts);
  
  app.post('/api/ghn/tickets', ghnController.createTicket);
  app.get('/api/ghn/tickets', ghnController.getTickets);
  app.get('/api/ghn/tickets/:ticketId', ghnController.getTicket);
  app.post('/api/ghn/tickets/:ticketId/feedback', ghnController.createTicketFeedback);
  
  app.get('/api/ghn/shipping-status', ghnController.getShippingStatusList);
  app.post('/api/ghn/format-order', ghnController.formatOrderData);

  console.log('GHN API routes registered successfully');
};
