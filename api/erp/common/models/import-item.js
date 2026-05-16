var moment = require('moment');

module.exports = function(ImportItem) {
    ImportItem.observe("before save", function removeIncludeObject(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        var properties = "import item supplier".split(" ");
        properties.forEach(function(p){
            delete modelInstance[p];
        });

        next();
    });

    ImportItem.observe("before save", function setCreatedAtAndUpdatedAt(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (modelInstance.id){
            modelInstance.updatedAt = moment.utc();
            next();
            return;
        }

        // create new patient
        modelInstance.createdAt = moment.utc();
        modelInstance.updatedAt = modelInstance.createdAt;

        next();
    });
};
