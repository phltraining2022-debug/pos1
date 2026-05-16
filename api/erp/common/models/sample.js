var loopback = require('loopback');
var app = require('../../server/server');
var utility = require('../../server/boot/utility');

module.exports = function (Sample) {

    var loopback = require('loopback');
    var _ = require('underscore');
    var path = require('path');
    var moment = require('moment');
    var Parse = require('parse/node');
    var app = require('../../server/server');

    var Order = app.models.order;

    Sample.validatesUniquenessOf('sampleId', { message: 'Sample is created already, refresh the browser' });

    Sample.observe('before save', function sendNotification(ctx, next) {
        var instance = ctx.instance || ctx.data;
        var ids = [instance.orderIds];
        if (instance.refOrderId) ids.push(instance.refOrderId);

        function _next(instance) {
            if (instance)
                delete instance.flagSendNotification;
            next();
        }

        if (instance && instance.status) {
                                
            if (instance.flagSendNotification && instance.note == "old sample" && instance.status == 'received') {
         

                var Sample = app.models.Sample;
                Sample.find({
                        where: {sampleId: instance.sampleId}
                    }, function (err, samples) {
                        if (samples && samples.length > 0) {
                            var sample = samples[0];
                            
                            instance.needsRetransfer = sample.status == 'received' && instance.orderItemIds && (sample.orderItemIds.length != instance.orderItemIds.length);
                            console.log('using old sample, needs retransfer ', instance.needsRetransfer);
                        }

                        _next(instance);
                    }
                )

            }  else if (instance.status == "collected" || instance.status == "received") {

                var Order = app.models.order;
                Order.findOne({
                    where: {
                        MDH: instance.sampleId.substring(0, instance.sampleId.length - 2)
                    }
                }).then(function (o, r) {
                    _next(instance);

                    if (!o.isLabOrder || instance.flag == 'transfer') {
                        delete instance.flag;

                        o.isLabOrder = true;
                        if (o.labTestOrderDates) {
                            o.labTestOrderDates.push(new Date());
                        } else 
                            o.labTestOrderDates = [new Date()];

                        if (!o.labTestOrderDate)
                            o.labTestOrderDate = new Date();

                        Order.upsert(o, function (err, result) {
                        });
                    }
                    
                }, function(err) {
                    _next(instance);
                    console.log(err)
                });
    
                

            } else if (instance.status == "rejected") {
                //type: 'Urine',
                sampleType = instance.sampleType
                requestSamplePriority = instance.requestSamplePriority
                var Order = app.models.order;

                Order.findOne({ where: { id: instance.orderIds }, include: ['patient'] }).then(function (order) {
                    var patient = JSON.parse(JSON.stringify(order)).patient;

                    if (patient) {

                        utility.findUsersByPermissions(["Nurse.v", "Checkup.v", "Doctor.v"], function (userIds) {
                            utility.sendNotification('system',
                                { 
                                    text: (patient.fullName || '') + ' - ' + instance.type + ' sample' },
                                userIds, function () {
                                    console.log('complete notification');
                                }, 
                                { 
                                    "type": "task", 
                                    "taskName": "reject", 
                                    "priority": instance.requestSamplePriority, 
                                    sampleId: instance.sampleId
                                }
                            )
                        });
                    }
                })

                _next(instance);

            } else if (instance.status == "collectLater") {

                if (instance.flagSendNotification) {
                    
                    console.log('Collect later ... ', instance)
                    var Order = app.models.order;
                    Order.findOne({ where: { id: instance.orderIds }, include: ['patient'] }).then(function (order) {
                        var patient = JSON.parse(JSON.stringify(order)).patient;
                        utility.findUsersByPermissions(["Checkup.v"], function (userIds) {
                            utility.sendNotification('system',
                                { text: 'Patient ' + (patient.fullName || '') + ': collect later sample  ' + instance.type },
                                userIds, function () {
                                    console.log('complete notification');
                                }, {
                                    "type": "task",
                                    "taskName": "Re-schedule",
                                    "isDone": false,
                                    patientId: patient.id,
                                    orderId: instance.orderIds,
                                    sampleId: instance.id
                                })
                        });
                    });

                    
                }

                _next(instance);

            } else {
                _next(instance);
            }

        } else {
            _next(instance
            );
        }

    })
};
