'use strict';
var LoopBackContext = require('loopback-context');

module.exports = function(app) {
  Object.keys(app.models).forEach(function(modelName) {
    var Model = app.models[modelName];
    var originalGetDataSource = Model.getDataSource;

    Model.getDataSource = function() {
      // 1. Lấy context
      var ctx = LoopBackContext.getCurrentContext();
      
      // 2. Lấy datasource từ context
      if (ctx) {
        var dsName = ctx.get('currentDatasource');
        if (dsName && app.dataSources[dsName]) {
          return app.dataSources[dsName];
        }
      }

      // 3. Fallback
      return originalGetDataSource.call(this);
    };
  });
};