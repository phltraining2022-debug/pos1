"use strict";

/**
 * GHN Configuration
 * Environment variables and settings for GHN integration
 */

module.exports = {
  // GHN API Configuration
  api: {
    baseURL: process.env.GHN_BASE_URL || 'https://dev-online-gateway.ghn.vn/shiip/public-api/v2',
    token: process.env.GHN_TOKEN || '98a27111-9f39-11f0-bdaf-ae7fa045a771',
    shopId: process.env.GHN_SHOP_ID || '197502',
    clientId: process.env.GHN_CLIENT_ID || '2510384',
    timeout: parseInt(process.env.GHN_TIMEOUT) || 30000
  },

  // Default shipping settings
  shipping: {
    defaultServiceId: process.env.GHN_DEFAULT_SERVICE_ID || '53320', // Standard delivery
    defaultServiceTypeId: parseInt(process.env.GHN_DEFAULT_SERVICE_TYPE_ID) || 2, // Standard
    defaultPaymentTypeId: parseInt(process.env.GHN_DEFAULT_PAYMENT_TYPE_ID) || 1, // COD
    defaultRequiredNote: process.env.GHN_DEFAULT_REQUIRED_NOTE || 'KHONGCHOXEMHANG',
    defaultWeight: parseInt(process.env.GHN_DEFAULT_WEIGHT) || 100, // grams
    defaultDimensions: {
      length: parseInt(process.env.GHN_DEFAULT_LENGTH) || 10, // cm
      width: parseInt(process.env.GHN_DEFAULT_WIDTH) || 10, // cm
      height: parseInt(process.env.GHN_DEFAULT_HEIGHT) || 10 // cm
    }
  },

  // Webhook configuration
  webhook: {
    enabled: process.env.GHN_WEBHOOK_ENABLED === 'true',
    orderStatusUrl: process.env.GHN_ORDER_STATUS_WEBHOOK_URL || '/api/ghn/webhook/order-status',
    ticketUrl: process.env.GHN_TICKET_WEBHOOK_URL || '/api/ghn/webhook/ticket',
    secret: process.env.GHN_WEBHOOK_SECRET || ''
  },

  // Notification settings
  notifications: {
    enabled: process.env.GHN_NOTIFICATIONS_ENABLED === 'true',
    smsEnabled: process.env.GHN_SMS_ENABLED === 'true',
    emailEnabled: process.env.GHN_EMAIL_ENABLED === 'true',
    smsProvider: process.env.GHN_SMS_PROVIDER || 'twilio',
    emailProvider: process.env.GHN_EMAIL_PROVIDER || 'sendgrid'
  },

  // Business logic settings
  business: {
    autoCreateTickets: process.env.GHN_AUTO_CREATE_TICKETS === 'true',
    autoProcessReturns: process.env.GHN_AUTO_PROCESS_RETURNS === 'true',
    autoRefundOnReturn: process.env.GHN_AUTO_REFUND_ON_RETURN === 'true',
    maxRetryAttempts: parseInt(process.env.GHN_MAX_RETRY_ATTEMPTS) || 3,
    retryDelay: parseInt(process.env.GHN_RETRY_DELAY) || 5000 // ms
  },

  // Status mapping
  statusMapping: {
    'ready_to_pick': 'pending_pickup',
    'picking': 'picking',
    'picked': 'picked',
    'storing': 'in_transit',
    'transporting': 'in_transit',
    'sorting': 'in_transit',
    'delivering': 'out_for_delivery',
    'delivered': 'delivered',
    'delivery_failed': 'delivery_failed',
    'waiting_to_return': 'return_pending',
    'return': 'returning',
    'returned': 'returned',
    'exception': 'exception',
    'damage': 'damaged',
    'lost': 'lost'
  },

  // Error codes and messages
  errorCodes: {
    'INVALID_PROVINCE': 'Tỉnh/thành phố không hợp lệ',
    'INVALID_DISTRICT': 'Quận/huyện không hợp lệ',
    'INVALID_WARD': 'Phường/xã không hợp lệ',
    'INVALID_SERVICE': 'Dịch vụ vận chuyển không hợp lệ',
    'INVALID_ORDER': 'Đơn hàng không hợp lệ',
    'ORDER_NOT_FOUND': 'Không tìm thấy đơn hàng',
    'INSUFFICIENT_BALANCE': 'Số dư không đủ',
    'NETWORK_ERROR': 'Lỗi kết nối mạng',
    'TIMEOUT': 'Hết thời gian chờ',
    'UNAUTHORIZED': 'Không có quyền truy cập',
    'RATE_LIMITED': 'Vượt quá giới hạn yêu cầu'
  },

  // Validation rules
  validation: {
    phone: {
      pattern: /^[0-9]{10,11}$/,
      message: 'Số điện thoại phải có 10-11 chữ số'
    },
    address: {
      minLength: 10,
      maxLength: 200,
      message: 'Địa chỉ phải có từ 10-200 ký tự'
    },
    weight: {
      min: 1,
      max: 30000, // 30kg
      message: 'Khối lượng phải từ 1-30000 gram'
    },
    dimensions: {
      min: 1,
      max: 200, // 2m
      message: 'Kích thước phải từ 1-200 cm'
    }
  },

  // Logging configuration
  logging: {
    enabled: process.env.GHN_LOGGING_ENABLED !== 'false',
    level: process.env.GHN_LOG_LEVEL || 'info',
    logRequests: process.env.GHN_LOG_REQUESTS === 'true',
    logResponses: process.env.GHN_LOG_RESPONSES === 'true',
    logWebhooks: process.env.GHN_LOG_WEBHOOKS === 'true'
  }
};
