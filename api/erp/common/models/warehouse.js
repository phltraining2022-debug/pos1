'use strict';
var moment = require("moment");
module.exports = function(Warehouse) {
    Warehouse.observe('before save', function setCreatedAtAndUpdatedAt(ctx, next){
        var obj = ctx.data ? ctx.data : ctx.instance;
        if (obj.id){
            obj.updatedAt = moment.utc();
        } else {
            obj.createdAt = moment.utc();
            obj.updatedAt = obj.createdAt;
        }

        next();
    });
};
