var moment = require('moment');
module.exports = function(ExportItem) {
    ExportItem.observe('before save', function setCreatedAtAndUpdatedAt(ctx, next){
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (modelInstance.id){
            modelInstance.updatedAt = moment.utc();
        } else {
            modelInstance.createdAt = moment.utc();
            modelInstance.updatedAt = modelInstance.createdAt;
        }
        var properties = "item".split(" ");
        properties.forEach(function(p){
            delete modelInstance[p];
        });
        next();
    });
};
