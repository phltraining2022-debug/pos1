'use strict';
const cls = require('cls-hooked');
// Tạo namespace, tên gì cũng được
const ns = cls.createNamespace('loopback_context_ns');

module.exports = {
  // Middleware để khởi tạo context cho mỗi request
  perRequest: function() {
    return function(req, res, next) {
      ns.run(function() {
        next();
      });
    };
  },
  // Hàm lấy namespace để set/get dữ liệu
  getNamespace: function() {
    return ns;
  }
};