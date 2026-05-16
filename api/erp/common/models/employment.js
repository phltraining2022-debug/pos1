var moment = require('moment');

module.exports = function(Employment) {
    Employment.observe('before save', function(ctx, next){
        var instance = ctx.data || ctx.instance;

        if(!ctx.isNewInstance){
            instance.updatedAt = moment.utc();
            next();
            return;
        }

        instance.createdAt = moment.utc();
        instance.updatedAt = instance.createdAt;
        next();
    })
};
