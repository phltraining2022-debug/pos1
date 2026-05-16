var moment = require('moment');
module.exports = function(InsurancePackage) {
    InsurancePackage.observe('before save', function(ctx, next){
        var instance = ctx.data || ctx.instance;

        if (!ctx.isNewInstance){
            instance.updatedAt = moment.utc();
            next();
            return;
        }

        // create
        instance.createdAt = moment.utc();
        instance.updatedAt = instance.createdAt;

        next();
    })
};
