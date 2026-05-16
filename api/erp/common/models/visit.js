var moment = require('moment');
var app = require('../../server/server');
var Q = require('q');
var utility = require('../../server/boot/utility');
var Parse = require('parse/node');

module.exports = function (Visit) {

    false && Visit.observe('before save', function (ctx, next) {
        var instance = ctx.data || ctx.instance;
        console.log(instance)

        if (instance && instance.isPendingForCheckOut && instance.flagSendNotification) {
            console.log('pending for checkout ')
            utility.findUsersByPermissions(["Checkup.v"], function(userIds) {
                app.models.patient.findById(instance.patientId).then(function (p) {
                    utility.sendNotification('system', {text: (p.fullName || 'A patient')+ ' is pending for out', 
                        orderId: instance.orderId}, 
                        userIds, function(notification) {
                            setTimeout(function(){ notification.destroy(); }, 3000);
                        }, 
                        {
                            "type": "notification", 
                            orderId: instance.orderId,
                            "event": "pending-for-check-out"
                        }
                    );
                })
            })
        }

        if (ctx.isNewInstance && instance) {
            // fix if the order is missing any things
            utility.createOrderItems(instance.orderId);

            utility.findUsersByPermissions(["Checkup.v", "Nurse.v", "Doctor.v"], function(userIds) {
                app.models.patient.findById(instance.patientId).then(function (p) {
                    utility.sendNotification('system', {text: (p.fullName || 'A patient')+ ' has checked in', 
                        orderId: instance.orderId}, 
                        userIds, function() {
                        console.log('complete notification');
                    }, {"type": "notification", orderId: instance.orderId, "event": "checked_in"})
                });
            });
        } else {
            
            // checkout case 
            if (instance && instance.checkoutAt && instance.flagSendNotification) {
                utility.findUsersByPermissions(["Checkup.v", "Nurse.v", "Doctor.v"], function(userIds) {
                    app.models.patient.findById(instance.patientId).then(function (p) {
                        utility.sendNotification('system', {text: (p.fullName || 'A patient')+ ' has checked out', 
                            orderId: instance.orderId}, 
                            userIds, function(notification) {
                                setTimeout(function(){ notification.destroy(); }, 3000);
                            }, 
                            {
                                "type": "notification", 
                                orderId: instance.orderId,
                                "event": "checked_out"
                            }
                        );

                        // remove checked in notification
                        var Notification = Parse.Object.extend("piNotification");
                        var query = new Parse.Query(Notification);
                        query.equalTo("orderId", instance.orderId);
                        query.equalTo("event", "checked_in");
                        query.find({
                            success: function(results) {
                              console.log('remove checked in notifications - results ', results);
                              for (var i = 0; i < results.length; i++) {
                                var object = results[i];
                                object.destroy({
                                    success: function(o) {
                                    },
                                    error: function(o, error) {
                                    }
                                  });
                              }
                            },
                            error: function(error) {
                              console.log("Error: " + error.code + " " + error.message);
                            }
                        });
                    });
                });
            }
        }

        delete instance.flagSendNotification;

        if (ctx.isNewInstance && instance && instance.appointmentId) {
            checkCreateVisitWithAppointment(instance.appointmentId).then(function (isValid) {
                console.log("Is valid????", isValid);
                if (isValid) {
                    var err = new Error('Has checked in');
                    err.statusCode = '403';
                    next(err);
                } else {
                    next();
                }
            }, function (error) {
                next(error);
            });
        }else{
            next()
        }
    });



    Visit.observe("before save", function removeIncludedItem(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        var properties = "doctor clinic medicalRecord order subOrders patient".split(" ");
        properties.forEach(function (p) {
            delete modelInstance[p];
        });

        next();
    });

    function checkCreateVisitWithAppointment(appointmentId) {
        var visit = app.models.visit;
        var dfd = Q.defer();
        visit.findOne({
            where: {
                appointmentId: appointmentId
            }
        }).then(function (data) {
            if (data && data.id) {
                dfd.resolve(true)
            } else {
                dfd.resolve(false)
            }
        }, function (error) {
            dfd.reject(error);
        });
        return dfd.promise;
    }

};
