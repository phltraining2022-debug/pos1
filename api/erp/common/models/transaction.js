var moment = require('moment');
module.exports = function(Transaction) {
    Transaction.observe("before save", function(ctx, next) {
        var modelInstance = ctx.data || ctx.instance;
        if (!ctx.isNewInstance){
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
