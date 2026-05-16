module.exports = function(PurchaseOrder) {
  /**
   * Duyệt đơn hàng mua (approve)
   * @param {string} id - PurchaseOrder id
   * @param {string} approvedBy - Employee id
   * @param {Function} cb - Callback
   */
  PurchaseOrder.approve = async function(id, approvedBy, cb) {
    try {
      const po = await PurchaseOrder.findById(id);
      if (!po) return cb(null, {error: 'PurchaseOrder not found'});
      if (po.status === 'Done') return cb(null, {error: 'PurchaseOrder already approved'});
      po.status = 'Done';
      po.approvedBy = approvedBy;
      po.approvedAt = new Date();
      await po.save();
      cb(null, {success: true, purchaseOrder: po});
    } catch (err) {
      cb(err);
    }
  };

  PurchaseOrder.remoteMethod('approve', {
    accepts: [
      {arg: 'id', type: 'string', required: true, http: {source: 'form'}},
      {arg: 'approvedBy', type: 'string', required: true, http: {source: 'form'}}
    ],
    returns: {arg: 'result', type: 'object', root: true},
    http: {path: '/approve', verb: 'post'},
    description: 'Duyệt đơn hàng mua'
  });
};
