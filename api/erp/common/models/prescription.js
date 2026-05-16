var moment = require('moment');
module.exports = function(Prescription) {
    Prescription.observe('before save', function setCreatedAtAndUpdatedAt(ctx, next){
        var instance = ctx.data || ctx.instance;

        if(!ctx.isNewInstance){
            instance.updatedAt = moment.utc();
            next();
            return;
        }

        // New instance
        instance.createdAt = moment.utc();
        instance.updatedAt = instance.createdAt;
        next();
    });
};
