'use strict';
module.exports = function(WarehouseItem) {
    var app = require('../../server/server');
    var moment = require('moment');
    WarehouseItem.observe('before save', function setCreatedAtAndUpdatedAt(ctx, next){
        var wi = ctx.data ? ctx.data : ctx.instance;
        wi.searchKeywords = wi.itemName.toLowerCase().split(" ");
        if (wi.id){
            wi.updatedAt = moment.utc();
        } else {
            wi.createdAt = moment.utc();
            wi.updatedAt = wi.createdAt;
        }
        var properties = "item warehouse".split(" ");
        properties.forEach(function(p){
            delete wi[p];
        });
        next();
    });

    WarehouseItem.observe('before save', function createPriceHistory(ctx, next){
        var Price = app.models.price;
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (!modelInstance.sellPrice){
            modelInstance.sellPrice = modelInstance.importPrice;
        }
        if (modelInstance.id){
            WarehouseItem.findById(modelInstance.id, {}, function(error, whItem){
                if (whItem && (whItem.sellPrice != modelInstance.sellPrice)){
                    Price.find({
                        where: {
                            and: [
                                {targetId: modelInstance.id},
                                {isActive: true}
                            ]
                        }
                    }, function(error, p){
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

    WarehouseItem.observe("after save", function(ctx, next){
        if (ctx.instance && ctx.isNewInstance ){
            createNewPrice(ctx.instance, function(res){
                next();
            });
        } else {
            next();
        }
    });

    function createNewPrice(data, cb){
        var Price = app.models.price;
        var newPrice = {
            targetId: data.id,
            validFrom: moment.utc(),
            price: data.sellPrice,
            clinicId: data.clinicId,
            isActive: true,
            cat: "warehouseItem"
        };
        Price.create(newPrice, cb);
    }
};
