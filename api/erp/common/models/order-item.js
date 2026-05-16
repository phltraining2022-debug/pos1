 var moment = require('moment');
var app = require('../../server/server');
var notificationHandler = require('../../server/boot/pushNotification');
var loopback = require('loopback');
var _ = require('underscore');
var path = require('path');
var moment = require('moment');
var Parse = require('parse/node');
var Q = require('q');
var utility = require('../../server/boot/utility');

function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

function isAbnormal(p, _result, ranges, mr, abnormalRangesRef) {
    if (!mr) mr = [];
    var nr = [];
    var result = '0';
    
    if (_result) {
        result = _result.replace('>', '').replace('<', '')
        var EPSILON = 0.000001;
        if (_result.indexOf('<') != -1) {
            result = result - EPSILON;
        } else if (_result.indexOf('>') != -1) {
            result = result + EPSILON;
        }
    } else {
        return false;
    }

    if (!isNumber(result)) {
        result = result.toLowerCase();
    }

    var abnormalNames = ["risk", "positive", "high risk", "moderate risk", "equivocal", "borderline high", "dangerous"];
    
    for(var i=0;i<ranges.length;i++) {
        var r=ranges[i];

        if (!p.martialStatus)
            p.martialStatus = 'single';

        if(r[p.martialStatus] && r[p.gender] && r.ageFrom <= p.age && p.age <= r.ageTo) {
            // console.log(result, Number.isNaN(result));
            if (!isNumber(result)) {
                // for text
                if (r.rangeName && (r.rangeName.value == result || result == r.valueIn)) {
                    
                    if (abnormalNames.indexOf(r.rangeName.value) > -1) {
                        mr.push(r.rangeName.value);
                    } else {
                        nr.push(r.rangeName.value);
                    }

                }
            } else {
                // for number
                // check operator 
                if (r.operator && (r.lowerRange || r.upperRange)) {
                    var e = '';
                    if (e) e = e + ' && '
                    if (r.operator.value == "-") {
                        e = e + '(' + result + ' <= ' + r.upperRange + ') && (' + result + ' >= ' + r.lowerRange + ')';
                    } else {
                        e = e + '(' + result + r.operator.value + (r.lowerRange || r.upperRange) + ')'
                    }
                    if (eval(e)) {
                        // console.log('match ', e, r.rangeName.value, eval(e));
                        if (r.rangeName && abnormalNames.indexOf(r.rangeName.value) > -1) {
                            mr.push(r.rangeName.value)
                        } else {
                            nr.push(r.rangeName.value);
                        }
                    }
                }
            }
        }
        
    }    
    
    if (mr.length > 0) {
        // does not match any normal range
        console.log('abnormal patient !!!', mr);
        return mr.indexOf('dangerous') != -1 ? 'dangerous' : 'abnormal';
    }

    if (nr.length == 0) 
        return 'abnormal';

    return 'normal';
}

module.exports = function (OrderItem) {

    OrderItem.observe('before save', function (ctx, next) {
        var instance = ctx.instance || ctx.data;

        if (!instance.result) {
            next();
        } else {
            // dirty fix for gyn 
            if (instance.testId == "58a6e0274b3562050ec3cbc1") {
                var result = instance.result; 
                var abnormal = false;
                if (!result.gynecologicalAbnormal || !result.breastAbnormal) {
                    app.models.patient.findById(instance.patientId).then(function (p) {
                        var alertMsg = 'ABNORMAL !!!!!! ' + p.fullName;
                        var Phaxio = require('phaxio'),
                        phaxio = new Phaxio('e545133e312955d117d21f03d7ca3845921a4739', '6e2bb124c018fe903e09863d9cad5a04b2d906a8'),
                        callback = function(err,data){console.log(err, data);};
                        
                        if (false)
                            phaxio.sendFax({
                                to: '+84 8 3514 0758',
                                string_data: alertMsg,
                                string_data_type: 'text'
                            },
                            callback);

                    });
                }
                
            }

            app.models.test.findById(instance.testId).then(function (t) {
                console.log('referenceRange ', JSON.stringify(t.referenceRange));
                var referenceRange = JSON.parse(JSON.stringify(t.referenceRange));
                if (t.referenceRange.length > 0) {
                    app.models.order.findById(instance.refOrderId || instance.orderId).then(function (rootOrder) {

                        app.models.patient.findById(rootOrder.patientId).then(function (p) {
                            p.age =  moment().diff(p.DOB, 'years')
                            var conclusion = isAbnormal(p, instance.result, referenceRange);
                            console.log('conclusion !!! ', conclusion);
    
                            instance.isDangerous = conclusion == 'dangerous';
                            instance.isAbnormal = conclusion != 'normal';
                                
                            instance.valid = !instance.isAbnormal;
                            next();
                        }, function(e) {
                            next();
                        });

                    }, function(e) {
                        next();
                    });

                } else {
                    next();
                }
            }, function(e){
                next();
            });
        }
        
    });

    function upsertNotification(taskName, orderItem, instance) {
        console.log('Send external result notification ', orderItem.order.refOrderID || instance.orderId);

        Parse.initialize("hat-app");
        Parse.serverURL = 'http://127.0.0.1:1338/parse';

        var Notification = Parse.Object.extend("piNotification");
        var query = new Parse.Query(Notification);
        
        query.equalTo("refOrderId", orderItem.order.refOrderID || instance.orderId);
        query.equalTo("taskName", taskName);

        query.find({
            success: function(results) {
                if (results.length > 0) {

                    for (var i = 0; i < results.length; i++) {
                        var object = results[i];
                        var orderItems = object.get('orderItems') || [];
                        var ois = _.filter(orderItems, (oi) => {return oi.id == instance.id;})
                        if (ois.length > 0)
                            ois[0].status = 'ready';
                        else
                            orderItems.push({
                                    id: orderItem.id,
                                    name: orderItem.test && orderItem.test.name,
                                    status: 'ready'
                                }
                            )

                        object.set('orderItems', orderItems);
                        object.save();
                    }
                } else {
                    utility.findUsersByRoles(["Doctor Gynecology", "Doctor consultation", "Super Admin"], function (userIds) {
                        utility.sendNotification('system', 
                            { 
                                urlAttachFile: instance.urlAttachFile,
                                patientName: orderItem.patient.fullName,
                                patientDOB: orderItem.patient.DOB
                            },
                            userIds, function () {
                                // complete notification
                            }, { 
                                "type": "task", 
                                "taskName": taskName, 
                                orderId: instance.refOrderId || instance.orderId,
                                patientId: instance.patientId,
                                orderItemId: instance.id,
                                orderItems: [{
                                    id: orderItem.id,
                                    name: orderItem.test && orderItem.test.name + (orderItem.urlAttachFile && '(external)'),
                                    status: 'ready',
                                }]
                            })
                    });
                }
            },
            error: function(error) {
                console.log("Error: " + error.code + " " + error.message);
            }    
        });
    }

    OrderItem.observe('before save', function notifyCollectPayment(ctx, next) {
        var instance = ctx.instance || ctx.data;

        if (instance.result) {
            if (instance.result.gynecologicalAbnormal || instance.result.breastAbnormal) {
                instance.isAbnormal = true;
            } else if (instance.result.breastNormal && instance.result.gynecologicalNormal) {
                instance.isAbnormal = false;
            }
        }

        

        if (instance.id && instance.status) {

            console.log('statuss ???? ', instance)
            OrderItem.findOne({where: {id: instance.id}, 
                include:['patient', 'test', 
                    {
                        relation: "order",
                        scope: {
                                include: ['createdBy', 'patient']
                        }
                    },
                ]}).then(function (orderItem) {

                orderItem = JSON.parse(JSON.stringify(orderItem))

                // if (instance.urlAttachFile != orderItem.urlAttachFile) {
                // if (instance.statusTest == 'Completed' &&  
                //         // orderItem.test && orderItem.test.method=='Attach external' && 
                //         ((instance.urlAttachFile && orderItem.statusTest != 'Completed') ||  instance.urlAttachFile != orderItem.urlAttachFile)) {
                //             console.log('External results ....');
                //             upsertNotification('external result', orderItem, instance);
                // }

                if (instance.statusTest == 'Completed' 
                    && orderItem.statusTest != instance.statusTest 
                    && (orderItem.order.createdBy && orderItem.order.createdBy.isDoctor || 
                        ((instance.urlAttachFile && orderItem.statusTest != 'Completed') || instance.urlAttachFile != orderItem.urlAttachFile))) {
                            upsertNotification('pending-for-results', orderItem, instance);
                }     

                var notificationType = null;
                var taskName = null;
                var eventType = null;

                if ( (instance.isConfirmed != orderItem.isConfirmed && instance.status.toLowerCase() != 'refused') ||
                    (instance.status.toLowerCase() == 'refused' && instance.status != orderItem.status) ) {

                        notificationType = 'notification';

                    if (orderItem.isFree || orderItem.isOptional) {
                        notificationType = 'optional';
                        eventType = instance.status.toLowerCase() == 'refused' ? 'refused' : 'confirmed';
                    }
                
                }

                if (notificationType) {
                    // just this order item 
                    orderItem.order.orderItems = [orderItem];
                    utility.findUsersByPermissions(
                        ["Doctor.v", "Nurse.v", "Checkup.v", "COBASIT.v"], 
                        function (userIds, userId2Roles, roleMap) {
                    
                            utility.sendNotificationToUsersHaveTaskPermission(
                                notificationType, taskName,
                                userIds, userId2Roles, roleMap,
                                orderItem.order, orderItem.order, eventType);
                        }); 
                } 


                if ((!orderItem.isDangerous && instance.isDangerous && instance.statusTest == 'Completed') || 
-                        instance.isDangerous && instance.statusTest == 'Completed' && orderItem.statusTest != 'Completed') {

                    utility.findUsersByRoles(["Doctor consultation", "Super Admin"], function (userIds) {
                        console.log('alert ... !!!', userIds);
                        notificationType = "alert"; taskName = "dangerous";

                        utility.sendNotification('system', 
                            { 
                                patientName: orderItem.order.patient.fullName,
                                patientDOB: orderItem.order.patient.DOB
                            },
                            userIds, function () {
                                // complete notification
                                console.log('complete alert ... !!!');
                            }, { 
                                "type": notificationType, 
                                "taskName": taskName, 
                                orderId: instance.refOrderId || instance.orderId,
                                orderItemId: orderItem.id,
                                patientId: instance.patientId,
                                orderItemId: instance.id,
                                orderItems: [{
                                    id: orderItem.id,
                                    name: orderItem.test && orderItem.test.name,
                                    result: instance.result,
                                    status: 'dangerous',
                                }]
                            })
                    });
                }

            });      
        } 
        
        next();
    });






};
