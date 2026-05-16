"use strict";

const axios = require('axios');
const moment = require('moment');

/**
 * GHN (Giao Hàng Nhanh) API Service
 * Comprehensive shipping management for ecommerce system
 * Documentation: https://api.ghn.vn/home/docs
 */

class GHNService {
  constructor() {
    this.baseURL = 'https://dev-online-gateway.ghn.vn/shiip/public-api/';
    this.token = process.env.GHN_TOKEN || '98a27111-9f39-11f0-bdaf-ae7fa045a771';
    this.shopId = process.env.GHN_SHOP_ID || '197502';
    this.clientId = process.env.GHN_CLIENT_ID || '2510384';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Token': this.token
      },
      timeout: 30000
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[GHN API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('[GHN API Error]', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * 1. ADDRESS MANAGEMENT
   */

  // Get all provinces
  async getProvinces() {
    try {
      const response = await this.client.get('/master-data/province');
      return {
        success: true,
        data: response.data.data,
        message: 'Provinces retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get districts by province ID
  async getDistricts(provinceId) {
    try {
      const response = await this.client.get(`/master-data/district`, {
        params: { province_id: provinceId }
      });
      return {
        success: true,
        data: response.data.data,
        message: 'Districts retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get wards by district ID
  async getWards(districtId) {
    try {
      const response = await this.client.get(`/master-data/ward`, {
        params: { district_id: districtId }
      });
      return {
        success: true,
        data: response.data.data,
        message: 'Wards retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * 2. SHIPPING FEE CALCULATION
   */

  // Calculate shipping fee
  async calculateFee(feeData) {
    try {
      const payload = {
        from_district_id: feeData.fromDistrictId,
        to_district_id: feeData.toDistrictId,
        service_id: feeData.serviceId,
        service_type_id: feeData.serviceTypeId || 2, // Standard delivery
        weight: feeData.weight || 100, // grams
        value: feeData.value || 0, // COD amount
        ...feeData
      };

      const response = await this.client.post('/shipping-order/fee', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Shipping fee calculated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get available services
  async getServices(fromDistrictId, toDistrictId) {
    try {
      const response = await this.client.get('/shipping-order/available-services', {
        params: {
          from_district_id: fromDistrictId,
          to_district_id: toDistrictId
        }
      });
      return {
        success: true,
        data: response.data.data,
        message: 'Services retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get expected delivery time
  async getExpectedDeliveryTime(deliveryData) {
    try {
      const payload = {
        from_district_id: deliveryData.fromDistrictId,
        to_district_id: deliveryData.toDistrictId,
        service_id: deliveryData.serviceId,
        service_type_id: deliveryData.serviceTypeId || 2
      };

      const response = await this.client.post('/shipping-order/leadtime', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Expected delivery time calculated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * 3. ORDER MANAGEMENT
   */

  // Create shipping order
  async createOrder(orderData) {
    try {
      const payload = {
        payment_type_id: orderData.paymentTypeId || 1, // 1: COD, 2: Prepaid
        required_note: orderData.requiredNote || 'KHONGCHOXEMHANG',
        to_name: orderData.toName,
        to_phone: orderData.toPhone,
        to_address: orderData.toAddress,
        to_ward_code: orderData.toWardCode,
        to_district_id: orderData.toDistrictId,
        to_province_id: orderData.toProvinceId,
        return_phone: orderData.returnPhone || this.clientId,
        return_address: orderData.returnAddress,
        return_district_id: orderData.returnDistrictId,
        return_ward_code: orderData.returnWardCode,
        client_order_code: orderData.clientOrderCode,
        cod_amount: orderData.codAmount || 0,
        content: orderData.content || '',
        weight: orderData.weight || 100,
        length: orderData.length || 10,
        width: orderData.width || 10,
        height: orderData.height || 10,
        service_id: orderData.serviceId,
        service_type_id: orderData.serviceTypeId || 2,
        ...orderData
      };

      const response = await this.client.post('/shipping-order/create', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Order created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get order information
  async getOrderInfo(orderCode) {
    try {
      const response = await this.client.get('/shipping-order/detail', {
        params: { order_code: orderCode }
      });
      return {
        success: true,
        data: response.data.data,
        message: 'Order information retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get order by client order code
  async getOrderByClientCode(clientOrderCode) {
    try {
      const response = await this.client.get('/shipping-order/detail-by-client-code', {
        params: { client_order_code: clientOrderCode }
      });
      return {
        success: true,
        data: response.data.data,
        message: 'Order information retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Update order
  async updateOrder(orderCode, updateData) {
    try {
      const payload = {
        order_code: orderCode,
        ...updateData
      };

      const response = await this.client.post('/shipping-order/update', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Order updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Cancel order
  async cancelOrder(orderCode, reason = 'Khách hàng yêu cầu hủy đơn hàng') {
    try {
      const payload = {
        order_codes: [orderCode],
        reason: reason
      };

      const response = await this.client.post('/shipping-order/cancel', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Order cancelled successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Update COD amount
  async updateCOD(orderCode, codAmount) {
    try {
      const payload = {
        order_code: orderCode,
        cod_amount: codAmount
      };

      const response = await this.client.post('/shipping-order/update-cod', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'COD amount updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Print order
  async printOrder(orderCodes) {
    try {
      const payload = {
        order_codes: Array.isArray(orderCodes) ? orderCodes : [orderCodes]
      };

      const response = await this.client.post('/shipping-order/print', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Order print data retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Return order
  async returnOrder(orderCode, reason = 'Khách hàng yêu cầu trả hàng') {
    try {
      const payload = {
        order_code: orderCode,
        reason: reason
      };

      const response = await this.client.post('/shipping-order/return', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Order return initiated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Delivery again
  async deliveryAgain(orderCode) {
    try {
      const payload = {
        order_code: orderCode
      };

      const response = await this.client.post('/shipping-order/delivery-again', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Order scheduled for delivery again'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * 4. STORE MANAGEMENT
   */

  // Create store
  async createStore(storeData) {
    try {
      const payload = {
        name: storeData.name,
        phone: storeData.phone,
        address: storeData.address,
        ward_code: storeData.wardCode,
        district_id: storeData.districtId,
        province_id: storeData.provinceId,
        ...storeData
      };

      const response = await this.client.post('/shop', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Store created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get stores
  async getStores() {
    try {
      const response = await this.client.get('/shop');
      return {
        success: true,
        data: response.data.data,
        message: 'Stores retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * 5. PICK SHIFT MANAGEMENT
   */

  // Get pick shifts
  async getPickShifts() {
    try {
      const response = await this.client.get('/shipping-order/pick-shift');
      return {
        success: true,
        data: response.data.data,
        message: 'Pick shifts retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * 6. TICKET MANAGEMENT
   */

  // Create ticket
  async createTicket(ticketData) {
    try {
      const payload = {
        order_code: ticketData.orderCode,
        reason: ticketData.reason,
        content: ticketData.content,
        ...ticketData
      };

      const response = await this.client.post('/ticket', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Ticket created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get tickets
  async getTickets(params = {}) {
    try {
      const response = await this.client.get('/ticket', { params });
      return {
        success: true,
        data: response.data.data,
        message: 'Tickets retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Get ticket details
  async getTicket(ticketId) {
    try {
      const response = await this.client.get(`/ticket/${ticketId}`);
      return {
        success: true,
        data: response.data.data,
        message: 'Ticket details retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  // Create ticket feedback
  async createTicketFeedback(ticketId, feedbackData) {
    try {
      const payload = {
        ticket_id: ticketId,
        content: feedbackData.content,
        ...feedbackData
      };

      const response = await this.client.post('/ticket/feedback', payload);
      return {
        success: true,
        data: response.data.data,
        message: 'Ticket feedback created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * 7. UTILITY METHODS
   */

  // Validate address
  async validateAddress(addressData) {
    try {
      const { provinceId, districtId, wardCode } = addressData;
      
      // Check if province exists
      const provinces = await this.getProvinces();
      if (!provinces.success) return provinces;
      
      const province = provinces.data.find(p => p.ProvinceID === provinceId);
      if (!province) {
        return {
          success: false,
          error: 'Invalid province ID',
          data: null
        };
      }

      // Check if district exists
      const districts = await this.getDistricts(provinceId);
      if (!districts.success) return districts;
      
      const district = districts.data.find(d => d.DistrictID === districtId);
      if (!district) {
        return {
          success: false,
          error: 'Invalid district ID',
          data: null
        };
      }

      // Check if ward exists
      const wards = await this.getWards(districtId);
      if (!wards.success) return wards;
      
      const ward = wards.data.find(w => w.WardCode === wardCode);
      if (!ward) {
        return {
          success: false,
          error: 'Invalid ward code',
          data: null
        };
      }

      return {
        success: true,
        data: {
          province,
          district,
          ward
        },
        message: 'Address validated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  // Get shipping status list
  getShippingStatusList() {
    return {
      success: true,
      data: [
        { code: 'ready_to_pick', name: 'Chờ lấy hàng', description: 'Đơn hàng đã được tạo và chờ lấy hàng' },
        { code: 'picking', name: 'Đang lấy hàng', description: 'Đang lấy hàng từ người gửi' },
        { code: 'picked', name: 'Đã lấy hàng', description: 'Đã lấy hàng thành công' },
        { code: 'storing', name: 'Đang lưu kho', description: 'Hàng đang được lưu tại kho' },
        { code: 'transporting', name: 'Đang vận chuyển', description: 'Hàng đang được vận chuyển' },
        { code: 'sorting', name: 'Đang phân loại', description: 'Hàng đang được phân loại tại kho đích' },
        { code: 'delivering', name: 'Đang giao hàng', description: 'Đang giao hàng cho người nhận' },
        { code: 'delivered', name: 'Đã giao hàng', description: 'Giao hàng thành công' },
        { code: 'delivery_failed', name: 'Giao hàng thất bại', description: 'Giao hàng thất bại' },
        { code: 'waiting_to_return', name: 'Chờ trả hàng', description: 'Chờ trả hàng về người gửi' },
        { code: 'return', name: 'Đang trả hàng', description: 'Đang trả hàng về người gửi' },
        { code: 'returned', name: 'Đã trả hàng', description: 'Đã trả hàng về người gửi' },
        { code: 'exception', name: 'Đơn hàng ngoại lệ', description: 'Đơn hàng gặp sự cố' },
        { code: 'damage', name: 'Hàng bị hỏng', description: 'Hàng bị hỏng trong quá trình vận chuyển' },
        { code: 'lost', name: 'Hàng bị mất', description: 'Hàng bị mất trong quá trình vận chuyển' }
      ],
      message: 'Shipping status list retrieved successfully'
    };
  }

  // Format order data for GHN API
  formatOrderData(orderData) {
    return {
      to_name: orderData.customerName,
      to_phone: orderData.customerPhone,
      to_address: orderData.customerAddress,
      to_ward_code: orderData.wardCode,
      to_district_id: orderData.districtId,
      to_province_id: orderData.provinceId,
      client_order_code: orderData.orderCode,
      cod_amount: orderData.codAmount || 0,
      content: orderData.content || '',
      weight: orderData.weight || 100,
      length: orderData.length || 10,
      width: orderData.width || 10,
      height: orderData.height || 10,
      service_id: orderData.serviceId,
      service_type_id: orderData.serviceTypeId || 2,
      payment_type_id: orderData.paymentTypeId || 1,
      required_note: orderData.requiredNote || 'KHONGCHOXEMHANG'
    };
  }
}

// Export singleton instance
const ghnService = new GHNService();

module.exports = ghnService;
