var moment = require('moment');
module.exports = function(Medicine) {
    var app = require('../../server/server');
    Medicine.observe("before save", function(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        modelInstance.searchKeywords = modelInstance.name.toLowerCase().split(" ");
        modelInstance.searchName = modelInstance.name.toLowerCase()
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

    Medicine.observe("before save", function (ctx, next) {
        var Price = app.models.price;
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (modelInstance.id){
            Medicine.findById(modelInstance.id, {}, function(error, med){
                if (med && (med.price != modelInstance.price)){
                    Price.find({filter: {
                        where: {targetId: modelInstance.id, isActive: true}
                    }}, function(error, p){
                        if (p && p.length){
                            p[0].updateAttributes({
                                isActive: false,
                                validTo: moment.utc()
                            }, function(error, res){
                                createNewPrice(modelInstance, function(error, NP){
                                    next();
                                });
                            });
                        } else {
                            next();
                        }
                    });
                } else {
                    next();
                }
            });
        } else {
            next();
        }
    });

    Medicine.observe("after save", function(ctx, next){
        if (ctx.instance && ctx.isNewInstance ){
            createNewPrice(ctx.instance, function(res){
                next();
            });
        } else {
            next();
        }
    })

    function createNewPrice(data, cb){
        var Price = app.models.price;
        var newPrice = {
            targetId: data.id,
            validFrom: moment.utc(),
            price: data.price,
            clinicId: data.clinicId,
            isActive: true
        };
        Price.create(newPrice, cb);
    }
};
