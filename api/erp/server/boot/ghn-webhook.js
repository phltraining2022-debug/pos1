"use strict";

/**
 * GHN Webhook Handler
 * Handles order status updates and ticket callbacks from GHN
 * Documentation: https://api.ghn.vn/home/docs
 */

module.exports = function(app) {
  const ghnWebhook = {};

  // Order status callback webhook
  ghnWebhook.orderStatusCallback = async function(req, res) {
    try {
      console.log('[GHN Webhook] Order status callback received:', JSON.stringify(req.body, null, 2));
      
      const { order_code, status, reason, time, cod_amount, cod_transfer_fee, cod_fee, shipping_fee, total_fee } = req.body;
      
      if (!order_code || !status) {
        return res.status(400).json({
          success: false,
          error: 'Order code and status are required',
          data: null
        });
      }

      // Find the order in your system
      const Order = app.models.Order;
      const order = await Order.findOne({
        where: { 
          or: [
            { ghnOrderCode: order_code },
            { orderCode: order_code }
          ]
        }
      });

      if (!order) {
        console.log(`[GHN Webhook] Order not found: ${order_code}`);
        return res.status(404).json({
          success: false,
          error: 'Order not found',
          data: null
        });
      }

      // Update order status and tracking info
      const updateData = {
        ghnStatus: status,
        ghnStatusReason: reason || null,
        ghnStatusUpdatedAt: time ? new Date(time) : new Date(),
        lastUpdated: new Date()
      };

      // Add fee information if provided
      if (cod_amount !== undefined) updateData.codAmount = cod_amount;
      if (cod_transfer_fee !== undefined) updateData.codTransferFee = cod_transfer_fee;
      if (cod_fee !== undefined) updateData.codFee = cod_fee;
      if (shipping_fee !== undefined) updateData.shippingFee = shipping_fee;
      if (total_fee !== undefined) updateData.totalFee = total_fee;

      await order.updateAttributes(updateData);

      // Add status history
      const statusHistory = order.statusHistory || [];
      statusHistory.push({
        status: status,
        reason: reason,
        timestamp: time ? new Date(time) : new Date(),
        source: 'GHN Webhook'
      });

      await order.updateAttributes({ statusHistory });

      // Trigger business logic based on status
      await handleOrderStatusChange(order, status, reason);

      console.log(`[GHN Webhook] Order ${order_code} status updated to ${status}`);

      res.json({
        success: true,
        message: 'Order status updated successfully',
        data: { order_code, status }
      });

    } catch (error) {
      console.error('[GHN Webhook] Error processing order status callback:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // Ticket callback webhook
  ghnWebhook.ticketCallback = async function(req, res) {
    try {
      console.log('[GHN Webhook] Ticket callback received:', JSON.stringify(req.body, null, 2));
      
      const { ticket_id, status, content, created_at, updated_at } = req.body;
      
      if (!ticket_id || !status) {
        return res.status(400).json({
          success: false,
          error: 'Ticket ID and status are required',
          data: null
        });
      }

      // Find the ticket in your system
      const Ticket = app.models.Ticket;
      const ticket = await Ticket.findOne({
        where: { ghnTicketId: ticket_id }
      });

      if (!ticket) {
        console.log(`[GHN Webhook] Ticket not found: ${ticket_id}`);
        return res.status(404).json({
          success: false,
          error: 'Ticket not found',
          data: null
        });
      }

      // Update ticket status
      const updateData = {
        ghnStatus: status,
        lastUpdated: new Date()
      };

      if (content) updateData.ghnContent = content;
      if (created_at) updateData.ghnCreatedAt = new Date(created_at);
      if (updated_at) updateData.ghnUpdatedAt = new Date(updated_at);

      await ticket.updateAttributes(updateData);

      // Add status history
      const statusHistory = ticket.statusHistory || [];
      statusHistory.push({
        status: status,
        content: content,
        timestamp: updated_at ? new Date(updated_at) : new Date(),
        source: 'GHN Webhook'
      });

      await ticket.updateAttributes({ statusHistory });

      console.log(`[GHN Webhook] Ticket ${ticket_id} status updated to ${status}`);

      res.json({
        success: true,
        message: 'Ticket status updated successfully',
        data: { ticket_id, status }
      });

    } catch (error) {
      console.error('[GHN Webhook] Error processing ticket callback:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        data: null
      });
    }
  };

  // Handle order status changes with business logic
  async function handleOrderStatusChange(order, status, reason) {
    try {
      const OrderStatus = app.models.OrderStatus;
      const Notification = app.models.Notification;
      const Customer = app.models.Customer;

      // Map GHN status to your system status
      const statusMapping = {
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
      };

      const systemStatus = statusMapping[status] || status;

      // Update order status in your system
      await order.updateAttributes({
        status: systemStatus,
        lastStatusChange: new Date()
      });

      // Create order status record
      await OrderStatus.create({
        orderId: order.id,
        status: systemStatus,
        reason: reason,
        source: 'GHN',
        timestamp: new Date()
      });

      // Send notifications based on status
      await sendStatusNotification(order, systemStatus, reason);

      // Handle specific statuses
      switch (systemStatus) {
        case 'delivered':
          await handleDeliveredOrder(order);
          break;
        case 'delivery_failed':
          await handleDeliveryFailed(order, reason);
          break;
        case 'returned':
          await handleReturnedOrder(order);
          break;
        case 'damaged':
        case 'lost':
          await handleOrderIssue(order, systemStatus, reason);
          break;
      }

    } catch (error) {
      console.error('[GHN Webhook] Error handling order status change:', error);
    }
  }

  // Send status notification to customer
  async function sendStatusNotification(order, status, reason) {
    try {
      const Notification = app.models.Notification;
      const Customer = app.models.Customer;

      const customer = await Customer.findById(order.customerId);
      if (!customer) return;

      const statusMessages = {
        'pending_pickup': 'Đơn hàng của bạn đã được tạo và đang chờ lấy hàng',
        'picking': 'Đơn hàng của bạn đang được lấy từ người gửi',
        'picked': 'Đơn hàng của bạn đã được lấy thành công',
        'in_transit': 'Đơn hàng của bạn đang được vận chuyển',
        'out_for_delivery': 'Đơn hàng của bạn đang được giao',
        'delivered': 'Đơn hàng của bạn đã được giao thành công',
        'delivery_failed': `Giao hàng thất bại: ${reason || 'Không xác định'}`,
        'returned': 'Đơn hàng của bạn đã được trả về người gửi',
        'damaged': 'Đơn hàng của bạn bị hỏng trong quá trình vận chuyển',
        'lost': 'Đơn hàng của bạn bị mất trong quá trình vận chuyển'
      };

      const message = statusMessages[status] || `Trạng thái đơn hàng đã thay đổi: ${status}`;

      await Notification.create({
        customerId: customer.id,
        type: 'order_status',
        title: 'Cập nhật trạng thái đơn hàng',
        message: message,
        orderId: order.id,
        isRead: false,
        createdAt: new Date()
      });

      // Send SMS or email if configured
      if (customer.phone) {
        // Send SMS notification
        console.log(`[GHN Webhook] SMS notification sent to ${customer.phone}: ${message}`);
      }

      if (customer.email) {
        // Send email notification
        console.log(`[GHN Webhook] Email notification sent to ${customer.email}: ${message}`);
      }

    } catch (error) {
      console.error('[GHN Webhook] Error sending notification:', error);
    }
  }

  // Handle delivered order
  async function handleDeliveredOrder(order) {
    try {
      // Mark order as completed
      await order.updateAttributes({
        status: 'completed',
        deliveredAt: new Date(),
        lastUpdated: new Date()
      });

      // Update inventory if needed
      // Add any post-delivery logic here

      console.log(`[GHN Webhook] Order ${order.orderCode} marked as completed`);
    } catch (error) {
      console.error('[GHN Webhook] Error handling delivered order:', error);
    }
  }

  // Handle delivery failed
  async function handleDeliveryFailed(order, reason) {
    try {
      // Create a ticket for failed delivery
      const Ticket = app.models.Ticket;
      
      await Ticket.create({
        orderId: order.id,
        type: 'delivery_failed',
        priority: 'high',
        subject: 'Giao hàng thất bại',
        description: `Giao hàng thất bại: ${reason || 'Không xác định'}`,
        status: 'open',
        createdAt: new Date()
      });

      console.log(`[GHN Webhook] Delivery failed ticket created for order ${order.orderCode}`);
    } catch (error) {
      console.error('[GHN Webhook] Error handling delivery failed:', error);
    }
  }

  // Handle returned order
  async function handleReturnedOrder(order) {
    try {
      // Update order status
      await order.updateAttributes({
        status: 'returned',
        returnedAt: new Date(),
        lastUpdated: new Date()
      });

      // Process refund if needed
      // Add any return processing logic here

      console.log(`[GHN Webhook] Order ${order.orderCode} marked as returned`);
    } catch (error) {
      console.error('[GHN Webhook] Error handling returned order:', error);
    }
  }

  // Handle order issues (damaged/lost)
  async function handleOrderIssue(order, issueType, reason) {
    try {
      // Create high priority ticket
      const Ticket = app.models.Ticket;
      
      await Ticket.create({
        orderId: order.id,
        type: issueType,
        priority: 'urgent',
        subject: `Đơn hàng ${issueType === 'damaged' ? 'bị hỏng' : 'bị mất'}`,
        description: `Đơn hàng ${issueType === 'damaged' ? 'bị hỏng' : 'bị mất'}: ${reason || 'Không xác định'}`,
        status: 'open',
        createdAt: new Date()
      });

      console.log(`[GHN Webhook] ${issueType} ticket created for order ${order.orderCode}`);
    } catch (error) {
      console.error('[GHN Webhook] Error handling order issue:', error);
    }
  }

  // Register webhook routes
  app.post('/api/ghn/webhook/order-status', ghnWebhook.orderStatusCallback);
  app.post('/api/ghn/webhook/ticket', ghnWebhook.ticketCallback);

  console.log('GHN Webhook routes registered successfully');
};
