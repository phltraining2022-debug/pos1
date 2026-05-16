var moment = require('moment');
var app = require('../../server/server');
var notificationHandler = require('../../server/boot/pushNotification');
module.exports = function(TestResult) {
    TestResult.observe('before save', function(ctx, next){
        var instance = ctx.instance || ctx.data;

        if (!ctx.isNewInstance){
            instance.updatedAt = moment.utc();
            next();
            return;
        }

        instance.createdAt = moment.utc();
        instance.updatedAt = instance.createdAt;
        next();
    });

    TestResult.observe('after save', function(ctx, next){
        var instance = ctx.instance || ctx.data;

        if (ctx.isNewInstance){
            // TODO: Push notification order item has result
            var TestResult = app.models.testResult;
            TestResult.findOne({
                where: {
                    id: instance.id
                },
                include: ["patient", {orderItem: ["service"]}]
            }).then(function(tr){
                if(!tr){
                    console.log("Not found user");
                    next();
                    return;
                }

                var patient = tr.patient();
                var orderItem = tr.orderItem();
                var service = orderItem.service();

                console.log("Patient......", patient);
                console.log("orderItem......", orderItem);
                console.log("service......", service);
                var msg = 'Xét nghiệm ' + service.name + ' đã có kết quả';

                notificationHandler.getDeviceTokenByUserIds([patient.id])
                    .then(function(result){
                        if (!result.length){
                            console.log("Not tokens!");
                            next();
                            return;
                        }

                        notificationHandler.sendNotifications(result, msg);
                        next();
                    }, function(error){
                        console.log("Get notification errors: ", error);
                        next();
                    });
            }, function(error){
                console.log(error);
                next();
                return;
            });
            next();
        } else {
            next();
        }
    });
};
