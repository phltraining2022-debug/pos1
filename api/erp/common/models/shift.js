var moment = require('moment');
module.exports = function(Shift) {
    Shift.observe("before save", function setCreatedAtAndUpdatedAt(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (modelInstance.id){
            modelInstance.updatedAt = moment.utc();
            next();
            return;
        }

        // create
        modelInstance.createdAt = moment.utc();
        modelInstance.updatedAt = modelInstance.createdAt;

        next();
    });

    Shift.observe("before savve", function deleteRelationObjs(ctx, next){
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        var properties = "shiftLocations".split(" ");

        properties.forEach(function(p){
            delete modelInstance[p];
        });

        next();
    });
};
