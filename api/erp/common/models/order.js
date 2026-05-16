'use strict';
var moment = require('moment');
var app = require('../../server/server');
var emailHandler = require('../../server/boot/email');
var smsHandler = require('../../server/boot/sms');
var Q = require('q');
var _ = require('underscore');
var utility = require('../../server/boot/utility');

module.exports = function (Order) {
    var formatCount = "0000";
    Order.validatesUniquenessOf('MDH', { message: 'Order Number is not unique' });
    Order.observe("before save", function (ctx, next) {
        var Clinic = app.models.clinic;
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        var properties = "doctor clinic medicalRecords services orderItems orgOrder subOrders patient promotions specialization transactions".split(" ");
        properties.forEach(function (p) {
            delete modelInstance[p];
        });

        if (modelInstance.flagSendNotification || modelInstance.isComplete) {
            var flag = modelInstance.flagSendNotification + ''; // clone the string

            Order.findOne({
                where: { id: modelInstance.id }, 
                include: [
                    'patient'//,
                    // {
                    // relation: "orderItems",
                    // scope: {
                    //     where: {
                    //         serviceId: "580479d743a45dd7621b52ea"
                    //     },
                    //     include: ["service"]
                    // }
                ]
            }).then(function (_order) {
                var order = JSON.parse(JSON.stringify(_order));

                console.log('result modelInstance.id', modelInstance.id, flag)

                if (flag == 'readyForTranslation') {
                    utility.findUsersByPermissions(["Doctor.Doctor Consultation.translate"], function (userIds) {
                        utility.sendNotification('system',
                            { text: order.patient.fullName  + 
                                ' is ready for translation' },
                            userIds, function () {
                                console.log('complete notification');
                            }, { "type": "task", "taskName": "translate", "orderId": order.id })
                    });
                }
    
                if (flag == 'translationCompleted') {
                    utility.findUsersByPermissions(["Doctor.Doctor Consultation.complete"], function (userIds) {
                        utility.sendNotification('system',
                            { text: order.patient.fullName + 
                                ' translation complete' },
                            userIds, function () {
                            }, { "type": "task", "taskName": "translate complete", "orderId": order.id })
                    });
                }

                if (flag == 'danger-to-life-alert' && modelInstance.dangerToLifeAlert != order.dangerToLifeAlertReportedBy && modelInstance.dangerToLifeAlert) {
                    utility.findUsersByRoles(["Doctor Gynecology", "Doctor consultation", "Super Admin", "Doctor"], function (userIds) {
                        utility.sendNotification('system',
                            { 
                                patientName: order.patient.fullName, 
                                status: order.labTestStatus,
                                text: order.patient.fullName + 
                                ' has dangerous results' },
                            userIds, function () {
                            }, { "type": "alert", "taskName": "danger-to-life-alert", "orderId": order.refOrderId || order.id })
                    });
                }

                if (modelInstance.isComplete != order.isComplete && modelInstance.isComplete) {

                    console.log('remove all notification !!!');

                    Parse.initialize("hat-app");
                    Parse.serverURL = 'http://127.0.0.1:1338/parse';
            
                    var Notification = Parse.Object.extend("piNotification");
                    var queryRefOrders = new Parse.Query(Notification);
                    
                    queryRefOrders.equalTo("refOrderId", order.refOrderId || order.id);
                    queryRefOrders.notEqualTo("isDone", true);
                    queryRefOrders.find({
                        success: function(results) {
                            console.log(results);
                            _.forEach(results, (r) => {
                                r.set('isDone', true);
                                r.save();
                            })
                        }
                    });

                    var query = new Parse.Query(Notification);
                    query.equalTo("orderId", modelInstance.id);
                    query.notEqualTo("isDone", true);
                    query.find({
                        success: function(results) {
                            console.log(results);
                            _.forEach(results, (r) => {
                                r.set('isDone', true);
                                r.save();
                            })
                        }
                    });
                }
    
            }, (e) => {
                console.log(e)
            });
            
            delete modelInstance.flagSendNotification;
        }

        if (!ctx.isNewInstance) {
            modelInstance.isUpdated = true;
            next();
            return;
        }

        // Create new order
        modelInstance.isRemoved = false;
        modelInstance.isSynced = false;
        var idOfClinic = modelInstance.clinicId;
        if (modelInstance.refClinic) {
            idOfClinic = modelInstance.refClinic;
        }

        if (!modelInstance.MDH)  {
            var redis = require("redis"),
            client = redis.createClient();
    
            client.incr('MDH', function (err, id) {
                modelInstance.MDH = 20199000 + id + 400;
                next();
            });
        } else {
            next();
        }

    });

    Order.observe('after save', function notifyCollectPayment(ctx, next) {
        var instance = ctx.instance || ctx.data;

        if (ctx.isNewInstance && instance.packageId && !instance.tag && !instance.refOrderId) {
        
            // fix order 
            setTimeout(() => {
                utility.createOrderItems(instance.id);
            }, 500);
        } else 

        if (ctx.isNewInstance &&
            // ((new Date()) - instance.createdAt) < 10 * 1000 &&
                (instance.tag == 'additional order' || instance.tag == 'retest')) {
                            
            setTimeout(() => {
                Order.findOne({
                    where: { id: instance.id }, 
                    include: [
                        'patient',
                        'createdBy', 
                        {
                            relation: "orderItems",
                            scope: {
                                include: [
                                    {
                                        relation: "test",
                                        scope: {
                                            fields: {
                                                id: 1,
                                                name: 1,
                                                sampleType: 1, 
                                                referenceTest: 1
                                            }
                                        }
                                    },
                                    {
                                        relation: "service",
                                        scope: {
                                            fields: {
                                                id: 1,
                                                name: 1
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    ] })
                .then(function (order) {
                    var order = JSON.parse(JSON.stringify(order))
                    
                    var orderItems =  _.map(_.filter(order.orderItems, (oi) => {
                            return !oi.test.referenceTest
                        }), function(oi) {
                            return {
                                id: oi.id, 
                                doctorName: order.createdBy && order.createdBy.isDoctor &&order.createdBy.fullName,
                                doctorId: order.createdById,
                                name: (oi.test && oi.test.name) || (oi.service && oi.service.name)
                            }
                        })
                    
                    console.log('order.createdBy !!!! ', order.createdById, orderItems)

                    var labOrderItems = _.map(_.filter(order.orderItems, (oi) => {return oi.test.sampleType}), 
                        function(oi) {
                            return {id: oi.id, name: oi.test.name}
                        })

                    var nonLabOrderItems = _.map(_.filter(order.orderItems, (oi) => {return !oi.test || !oi.test.sampleType}), 
                        function(oi) {
                            return {id: oi.id, name: (oi.test && oi.test.name) || (oi.service && oi.service.name)}
                        }
                    )

                    if (order.createdBy && order.createdBy.isDoctor) {
                        
                        Parse.initialize("hat-app");
                        Parse.serverURL = 'http://127.0.0.1:1338/parse';

                        var Notification = Parse.Object.extend("piNotification");
                        var query = new Parse.Query(Notification);
                        if (order.refOrderId)
                            query.equalTo("refOrderId", order.refOrderId);
                        else 
                            if (order.orderId)
                                query.equalTo("orderId", order.orderId);
                            
                        query.limit(1);
                        query.equalTo("taskName", "pending-for-results");
                        query.find({
                            success: function(results) {
                                console.log('found existing notification ', results);
                                if (results.length > 0) {

                                    for (var i = 0; i < results.length; i++) {
                                        var object = results[i];
                                        var _orderItems = object.get('orderItems') || [];
                                        var map = {};
                                        _.forEach(_orderItems, (oi) => {
                                            map[oi.id] = oi;
                                        });

                                        _.forEach(orderItems, (oi) => {
                                            map[oi.id] = oi;
                                        });
                                        
                                        var newOrderItems = [];
                                        _.forEach(Object.keys(map), (key) => {
                                            newOrderItems.push(map[key])
                                        });

                                        object.set('orderItems', newOrderItems);
                                        object.save();
                                    }
                                } else {
                                
                                    utility.findUsersByRoles(["Super Admin"], function (userIds) {
                                        userIds = userIds.concat([order.createdById])
                                        utility.sendNotification('system',
                                            { 
                                            },
                                            userIds, function () {
                                            }, 
                                            {
                                                "type": "task", 
                                                "taskName": "pending-for-results", 
                                                "orderItems": orderItems,
                                                "refOrderId": order.refOrderId,
                                                "orderId": order.id
                                            })
                                    });
                                }
                            }
                        });
                    }
                    

                    utility.findUsersByPermissions(
                            ["Doctor.v", "Nurse.v", "Checkup.v", "COBASIT.v"], 
                            function (userIds, userId2Roles, roleMap) {
                        
                                utility.sendNotificationToUsersHaveTaskPermission(
                                    "notification", instance.tag,
                                    userIds, userId2Roles, roleMap,
                                    order, instance);

                            });  
                    
                });
            }, 3000);
        }

        next();
    });

    Order.observe("before save", function initDataForSearch(ctx, next) {
        var instance = ctx.instance || ctx.data;
        var Patient = app.models.patient;
        var Clinic = app.models.clinic;
        var vCompany = app.models.company;

        var updatedAt = moment(instance.updatedAt);
        var indexedAt = moment(instance.indexedAt);

        next();

    });


    Order.observe("after save", function sendEmailNewInsuranceOrder(ctx, next) {
        var instance = ctx.instance || ctx.data;
        if (ctx.isNewInstance) {
            // TODO: Send email new insurance order to insurance company
            app.models.order.findOne({
                where: {
                    and: [
                        { id: instance.id }
                    ]
                },
                include: ["patient", "insurancePackage", "insuranceCompany"]
            }, function (error, result) {
                if (!error) {

                    if (result) {
                        if (result.patient() && result.insurancePackage() && result.insuranceCompany()) {
                            var data = {
                                fullName: result.patient().fullName,
                                packageName: result.insurancePackage().name,
                                packagePrice: result.insurancePackage().price,
                                companyName: result.insuranceCompany().name,
                                email: result.patient().email
                            };

                            if (instance.isEmail) {
                                emailHandler.sendEmail(data, emailHandler.EMAIL_TEMPLATES.Insurance_New_Order, function (result) {
                                    console.log("patient....", result);
                                });
                            }

                            if (instance.isSms) {
                                // TODO: Send sms insurance order for orderer
                            }

                            var companyData = {
                                fullName: result.patient().fullName,
                                packageName: result.insurancePackage().name,
                                packagePrice: result.insurancePackage().price,
                                companyName: result.insuranceCompany().name,
                                email: result.insuranceCompany().email
                            };
                            emailHandler.sendEmail(companyData, emailHandler.EMAIL_TEMPLATES.Insurance_Company_New_Order, function (result) {
                                console.log("insurance company...", result);
                            });
                        }

                        next();
                    }
                }
            });

        } else {
            next();
        }
    });

    function getProperty(obj, property, includes) {
        var v = obj;
        var fields = property.split(".");
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            if (typeof (v[field]) == "function") {
                v = v[field]();
            }
            else {
                v = v[field];
            }
            if (!v) break;
        }

        function toTitleCase(str) {
            return str.replace(/\w\S*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
        }

        var searchFieldName = 'search' + fields.map(function (v) { return toTitleCase(v) }).join('')

        return [v, searchFieldName];
    }

    function getRefClinicById(id) {
        var Clinic = app.models.clinic;
        var dfd = Q.defer();
        Clinic.findById(id).then(function (c) {
            if (!c) {
                dfd.reject("Not found clinic");
            } else {
                dfd.resolve(c);
            }
        }, function (error) {
            dfd.reject(error);
        });

        return dfd.promise;
    }

    function getDoctorById(id) {
        var User = app.models.user;
        var dfd = Q.defer();
        User.findById(id).then(function (d) {
            if (!d) {
                dfd.reject("Not found doctor");
            } else {
                dfd.resolve(d);
            }
        }, function (error) {
            dfd.reject(error);
        });

        return dfd.promise;
    }

    function indexedData(propsToIndexed, data) {
        console.log("Props: ", propsToIndexed);
        propsToIndexed.forEach(function (p) {
            var propResult = getProperty(data, p, []);
            data[propResult[1]] = propResult[0];
        });

        delete data.thePatient;
        delete data.theDoctor;
        delete data.theClinic;
        delete data.theReferenceClinic;

        data.indexedAt = moment.utc();
        data.tbIndexed = false;
    }

    function sendSmsInsuranceForOrderer(smsInfo) {
    }
};