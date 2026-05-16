
module.exports = function (app) {
    var app = require('../../server/server');
    var bodyParser = require('body-parser');
    var loopback = require('loopback');
    var moment = require('moment');
    var NotificationModule = require('../../common/models/notification')
    var locationHandler = require('./location');
    var emailHandler = require('./email');
    var smsHandler = require('./sms');
    var _ = require('underscore');
    var doctorSchedule = require('./doctor');
    var reportCompany = require('./report-company')

    var pdfHandler = require('./pdfHandler');
    var indexing = require('./indexing');

    var utils = require('./utility');
    var nunjucks = require('nunjucks');
    var gif = require('./gif');

    var pdf = require('html-pdf');
    var fs = require('fs');
    var path = require('path')
    
    var Q = require('q');
    var Parse = require('parse/node');
    let inventory = require('./inventory')
    app.use(loopback.token());

    app.post('/api/inventory/import',inventory.importInventory)
    app.post('/api/inventory/export',inventory.exportInventory)
    app.post('/api/inventory/getWarehouesItemsQty',inventory.getWarehouesItemsQty)

    //var expressWs = require('express-ws')(app);


    app.get('/api/thanh/t', function(req, res) {
        return res.send('hello');
    });

    //Authentication
    //log a user in
    // app.post('/api/login', function(req, res) {
    //     var email = req.body.email;
    //     var phoneNumber = req.body.phoneNumber;
    //     var password = req.body.password;
    //     var loginData = {password: password};
    //     console.log(email, phoneNumber, password);
    //     if (phoneNumber){
    //         loginData.username = phoneNumber;
    //     } else if(email){
    //         loginData.email = email;
    //     }
    //
    //     if (!loginData['username'] && !loginData['email']){
    //         errorHandler(res, {errmsg: "Missing email or phone number"});
    //         return;
    //     }
    //
    //     console.log("loginData: ", loginData);
    //     var User = app.models.user;
    //     var Patient = app.models.patient;
    //     User.login(loginData, 'user', function(err, token) {
    //         if (err) {
    //             //console.log("Err: ", err);
    //             Patient.login(loginData, "patient", function(err, token){
    //                 if (err){
    //                     res.send({isSuccess: false, result: null, errMsg: err});
    //                     return;
    //                 }
    //
    //                 successHandler(res, {
    //                     email: email,
    //                     phoneNumber: phoneNumber,
    //                     accessToken: token.id
    //                 });
    //             });
    //             return;
    //         }
    //
    //         successHandler(res, {
    //             email: email,
    //             phoneNumber: phoneNumber,
    //             accessToken: token.id
    //         });
    //     });
    // });
    // End authentication



    // app.get('/api/importMedicine', function (req, res) {
    //     console.log('ws');
    //     utils.initMedicine();
    //     res.send({ 'msg': 'sucess', err: '' });
    // });


    //importICD10 open commet
    // app.get('/api/importICD10', function (req, res) {
    //     var clinicId = req.param('clinicId')
    //     if (!clinicId) {
    //         res.send({ 'msg': 'err', err: '333' })
    //         return;
    //     }
    //     utils.importICD10Eng(clinicId);
    //     res.send({ 'msg': 'sucess', err: '' });
    // });



    var fs = require('fs')


    function parseASTM(msg) {
        var r = {
            'sampleId': '',
            'results': []
        }

        var lines = msg.split('\r')
        console.log('lines ', lines)
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();

            if (line) {
                if (line[0] == 'O') {
                    var fields = line.split('|')
                    r['sampleId'] = fields[2]
                }

                if (line[0] == 'R') {
                    var fields = line.split('|')
                    internalCode = fields[2].replace('^^^', '').replace('^^^^', '')
                    console.log(internalCode)
                    r['results'].push({ 'internalCode': internalCode, 'result': fields[3] })
                }
            }
        }

        return r
    }


    function updateResults(r, complete) {
        var sampleId = r.sampleId;
        var results = r.results;
        var Sample = app.models.Sample;
        var OrderItem = app.models.orderItem;
        var Test = app.models.test;
        var Order = app.models.order;
        var testCode2OrderItem = {};

        var code2Result = {};
        for (var i = 0; i < results.length; i++) {
            code2Result[results[i].internalCode] = results[i].result;
            testCode2OrderItem[results[i].internalCode] = null;
        }

        console.log('Processing sample id ', r)
        Sample.findOne({
            where: {
                sampleId: sampleId
            }
        }, function (err, s) {
            if (err || !s) {
                console.log('Could not find out sample id', sampleId, err)
                complete(new Error('not found sample id'))
                return
            }

            s.updateAttributes({
                result: results.concat(s.result || [])
            }, function (err, result) {

                console.log('Update result from COBAS IT ', err, result)
            })

            console.log('sccc', s)
            var orderItemIds = s.orderItemIds;

            OrderItem.find({
                where: {
                    id: { inq: orderItemIds },
                    type: 1
                },
                include: "test"
            }).then(function (_ois) {

                var ois = JSON.parse(JSON.stringify(_ois))


                if (ois && ois.length) {
                    var ups = [];
                    var count;
                    var testId2OrderItem = {};
                    var foundOrderItems = {};

                    for (i = 0; i < ois.length; i++) {
                        testId2OrderItem[ois[i].testId] = ois[i];
                    }

                    for (i = 0; i < ois.length; i++) {
                        count++;
                        var upOder = ois[i];
                        var _upOder = _ois[i];
                        var orderItemStatusText = (upOder.statusTest || '').toLowerCase();
                        var parentOrderItemStatusText = (upOder.test.referenceTest && testId2OrderItem[upOder.test.referenceTest] &&
                            testId2OrderItem[upOder.test.referenceTest].statusTest) || '';
                        parentOrderItemStatusText = parentOrderItemStatusText.toLowerCase();

                        console.log('Test code ', upOder.test.internalCode)
                        foundOrderItems[upOder.test.internalCode] = true;

                        // not allowed update the result when it is completed by Lab Manager
                        if (parentOrderItemStatusText != "completed" &&
                            orderItemStatusText != "completed") {

                            var test = ois[i].test;

                            testCode2OrderItem[test.internalCode] = upOder;

                            if (test.internalCode in code2Result) {
                                _upOder.result = code2Result[test.internalCode];

                                ups.push(_upOder.updateAttributes(_upOder, function (updateErr, o) {
                                    if (updateErr) {
                                        console.log('error ', updateErr)
                                    } else {
                                        console.log('success ', o)
                                    }
                                }));
                            }

                        } else {
                            if (parentOrderItemStatusText == "completed") {
                                var p = upOder.test.referenceTest && testId2OrderItem[upOder.test.referenceTest];
                                console.log(p)
                            }
                        }
                    }

                    var internalCodes = _.map(_.filter(Object.keys(code2Result), (code) => { return !foundOrderItems[code] }), (code) => { return parseInt(code) })
                    var upsertNewOrderItems = [];
                    var createdOrderItemIds = [];

                    console.log('missing internalCodes', internalCodes);

                    if (internalCodes.length > 0) {

                        Order.find({
                            where: { id: s.orderIds }
                        }, function (err, retOrders) {
                            var order = retOrders[0];

                            // create orderItems
                            Test.find({
                                where: {
                                    internalCode: { inq: internalCodes },
                                    referenceTest: { neq: null } // only with sub test ...
                                },
                                fields: {
                                    id: 1,
                                    internalCode: 1
                                },
                            }, function (err, tests) {

                                _.forEach(tests, (test) => {
                                    upsertNewOrderItems.push(OrderItem.upsert({
                                        testId: test.id,
                                        orderId: s.orderIds,
                                        refOrderId: s.refOrderId,
                                        patientId: order.patientId,
                                        result: code2Result[test.internalCode],
                                        clinicId: "57d8ce790bf89f8731945b15",
                                        clinicIds: ["57d8ce790bf89f8731945b15"],
                                        type: 1,
                                        status: "new",
                                        tag: "correct"
                                    }, function (err, createdItem) {

                                        createdOrderItemIds.push(createdItem.id)
                                        console.log("created orderItem ", createdOrderItemIds)

                                        if (createdOrderItemIds.length == tests.length) {
                                            s.orderItemIds = s.orderItemIds.concat(createdOrderItemIds)
                                            Sample.upsert(s)
                                        }

                                    }))
                                })

                                console.log('s.orderItemIds ', s.orderItemIds)

                                // Q.all(upsertNewOrderItems).then(function () {

                                // update sample
                                // s.orderItemIds = s.orderItemIds.concat(createdOrderItemIds)
                                // Sample.upsert(s)
                                // })
                            })
                        })
                    }

                    Q.all(ups).then(function (_results) {
                        if (_results && _results.length) console.log("RESULT!! "+ _results.length);   complete();
                    })
                }

            }, function (error) {
                complete(error)
            })

        })
    }


    function processMsg(filePath) {
        fs.readFile(filePath, { encoding: 'utf-8' }, function (err, data) {
            if (!err) {
                console.log('received data:' + data.length);
                var results = parseASTM(data);
                console.log(results)
                updateResults(results, function (e) {
                    if (!e) {
                        // fs.unlink(filePath)
                        //fs.rename(filePath, filePath.replace('/results/', '/r/')); 
                        fs.createReadStream(filePath).pipe(fs.createWriteStream(filePath.replace('/results/', '/r/')));
                        try {
                            fs.unlink(filePath)
                        } catch (error) {
                            console.log('removing the result with error ', error)
                        }

                    } else {
                        fs.createReadStream(filePath).pipe(fs.createWriteStream(filePath.replace('/results/', '/pending/')));
                        try {
                            fs.unlink(filePath)
                        } catch (error) {
                            console.log('removing the result with error ', error)
                        }
                    }

                });
            } else {
                console.log(err);
            }
        });
    }

    console.log(process.argv)

    if (process.argv && process.argv.length > 2 && process.argv[2] == 'lab-agent') {
        // Running as lab agent
        console.log('Running as lab-agent');

        setInterval(function () {
            console.log('timer ...')

            fs.readdir("/var/www/his/msg/results", (err, files) => {
                var i = 0;

                if (files && files.length > 0) {
                    processMsg("/var/www/his/msg/results/" + files[0])
                }

            });

        }, 10000);

        setInterval(function () {
            console.log('timer ...')
            const { exec } = require('child_process');
            exec("cp /var/www/his/msg/orders-queue/*.txt /var/www/his/msg/orders/", (err, stdout, stderr) => {
                if (!err) {
                    exec("remove /var/www/his/msg/orders-queue/*.txt", (err, stdout, stderr) => {
                        if (!err) {
                        }
                    });
                }
            });

        }, 10000);
    }

    app.post('/api/contact', function (req, res) {
        var data = req.body;
        var lang = {
            "1": "English", "2": "Vietnamese", "3": "Korea", "4": "Japanese"
        }
        var subject =
        {
            "13082": { t: "General Inquiry" },
            "4867": { t: "Corporate arrangement", m: "tuyet.nguyen@vietnammedicalpractice.com" },
            "13069": { t: "Medical Report" },
            "13071": { t: "Make an appointment" },
            "13072": { t: "Change / Cancel an appointment" },
            "13074": { t: "Others" }
        };

        var email = "care1_reception@vietnammedicalpractice.com";
        if (subject[data.SubjectId].m)
            email = subject[data.SubjectId].m;

        if (data.Language == "4") email = "hiroko@vietnammedicalpractice.com";

        data.Subject = subject[data.SubjectId].t;
        data.Language = lang[data.Language];
        data.email = email; // "thanh.nguyenvan@gmail.com";
        emailHandler.sendEmail(req.body, "contact", function () {
            successHandler(res, {
                message: 'ok'
            });
        })
    });

    app.post('/api/patient/arriveAtStation', function (req, res) {
        // TODO
    });

    app.post('/api/lab-agent/send-order', function (req, res) {
        console.log(req.body);

        var enableFile = true;
        var enableTCP = false;

        if (enableFile) {
            var fs = require('fs');
            var orderTime = moment().format('YYYYMMDDhhmmssSSS');
            var fileNameInQueue = "/var/www/his/msg/orders-queue/order" + orderTime + ".txt";
            var fileNameToSharedFolder = "/var/www/his/msg/orders/order" + orderTime + ".txt";

            fs.writeFile(fileNameInQueue, req.body.rawMsg, function (err) {
                if (!err) {
                    // copy to "/var/www/his/msg/orders/order" + orderTime + ".txt"

                    var markSending = "mv " + fileNameInQueue + " " + fileNameInQueue + ".sending;";
                    var copyFileToSharedFolder = "cp " + fileNameInQueue + ".sending" + " " + fileNameToSharedFolder;

                    const { exec } = require('child_process');
                    exec(markSending + copyFileToSharedFolder, (err, stdout, stderr) => {
                        if (err) {
                            console.log(err);

                            // rename back to .txt
                            exec("mv " + fileNameInQueue + ".sending " + fileNameInQueue, (err, stdout, stderr) => {
                                console.log("rename order file back to .txt");
                            });
                        } else {
                            // remove file
                            exec("rm " + fileNameInQueue + ".sending", (err, stdout, stderr) => {
                                console.log("remove sending file");
                            });
                        }
                    });

                    successHandler(res, {
                        success: true,
                        message: 'ok'
                    });
                } else {

                    console.log(err);
                    successHandler(res, {
                        success: false,
                        message: 'ok'
                    });
                }

                console.log("The file was saved!");
            });

            fs.writeFile("/var/www/his/msg/orders-log/order" + orderTime + ".txt", req.body.rawMsg, function (err) {
                console.log("Copied of order has been saved!");
            });
        }

        if (enableTCP) {
            var net = require('net');
            var host = "127.0.0.1";
            client = new net.Socket();

            client.connect(5005, host, function () {
                console.log('Connected');
                client.write(req.body.rawMsg + '<<e>>');
            });

            client.on('data', function (data) {
                console.log('Received: ' + data);
                client.destroy(); // kill client after server's response
            });

            client.on('close', function () {
                console.log('Connection closed');
            });
        }

    });


    app.get('/api/doIndexing', indexing.doIndexing);



    app.post('/api/print/zpl', function (req, res) {
        var r = { isSuccess: false, result: null, errMsg: "" };

        if (req.body.printerIP && req.body.stickers) {
            var net = require('net');
            var client = new net.Socket();
            client.connect(11000, req.body.printerIP, function () {
                console.log('Connected');
                client.write(req.body.stickers.join('^XZ\r\n') + '<EOF>');
                r.isSuccess = true;
                res.send(r);
            });

            client.on('data', function (data) {
                console.log('Received: ' + data);
            });

            client.on('error', function (err) {
                console.log("Error: " + err.message);
                res.send(r);
            })

            client.on('close', function () {
                console.log('Connection closed');
            });
        } else {
            res.send(r);
        }
    })

    


    app.get('/api/fixSample', function (req, res) {
        var from = req.body.from;
        var Sample = app.models.Sample;
        var OrderItem = app.models.OrderItem;

        Sample.find({
            where: {
                sampleId: { between: [req.query.from, req.query.to] }
            }
        }, function (err, samples) {
            res.send({ samples: samples })
            _.forEach(samples, (sample) => {
                if (sample)
                    OrderItem.find({
                        where: {
                            id: { inq: sample.orderItemIds },
                            type: 1
                        },
                        // include: "test"
                    }).then(function (items) {
                        var foundTests = {}
                        var testIds = [];
                        _.forEach(items, (item) => {
                            if (!foundTests[item.testId]) {
                                foundTests[item.testId] = item;
                                testIds.push(item.testId)
                            } else {
                                if (!foundTests[item.testId].result && item.result)
                                    foundTests[item.testId] = item
                            }
                        })

                        var newList = _.map(testIds, (testId) => { return foundTests[testId].id })

                        if (newList.length != sample.orderItemIds.length) {
                            sample.orderItemIds = newList;
                            Sample.upsert(sample)
                            console.log('update', sample.type)
                        }

                    });
            })

        });
    });

    app.post('/api/resultSampleInternalCode', function (req, res) {
        var sampleId = req.body.sampleId;
        var results = req.body.results;
        var Sample = app.models.Sample;
        var OrderItem = app.models.orderItem

        var code2Result = {};
        for (var i = 0; i < results.length; i++) {
            code2Result[results[i].internalCode] = results[i].result;
        }


        Sample.findOne({
            where: {
                sampleId: sampleId
            }
        }, function (err, s) {
            s.updateAttributes({
                result: results
            }, function (err, result) {
                if (err) {
                    console.log('Update result from COBAS IT')
                } else {
                    console.log('Failed to update result from COBAS IT')
                }
            })

            if (err) {
                errorHandler(res, err);
                return
            }
            if (!s) {
                errorHandler(res, err);
                return
            }

            console.log('sccc', s)
            var orderItemIds = s.orderItemIds

            OrderItem.find({
                where: {
                    id: { inq: orderItemIds },
                    type: 1
                },
                include: "test"
            }).then(function (ois) {
                var ois = JSON.parse(JSON.stringify(ois));
                console.log('TESSSST ', ois[0].test);
                if (ois && ois.length) {
                    var ups = [];
                    var count;
                    for (i = 0; i < ois.length; i++) {
                        count++;
                        var upOder = ois[i];
                        if (upOder.type && upOder.type == 1) {
                            upOder.status = 'done';
                            var test = ois[i].test;

                            console.log('RESULT ', ois[i].result);

                            if (test.internalCode in code2Result) {
                                upOder.result = code2Result[test.internalCode];
                            } else {
                                console.log('** no result for internal code ', test.internalCode)
                            }

                            upOder.technician = "Louise";
                            ups.push(upOder.updateAttributes(upOder, function (updateErr, o) {
                                if (updateErr) {
                                    res.send({ isSuccess: false, result: null, errMsg: updateErr })
                                }
                            }));
                        };
                        // if(count==ordI.length){

                        // }
                    }
                    Q.all(ups).then(function () {
                        successHandler(res, s)
                    })
                }

            }, function (error) {
                if (error) {
                    res.send({ isSuccess: false, result: null, errMsg: error });

                }
            })


        })
    })


    app.get('/api/send-reminder', function (req, res) {
        var Appointment = app.models.appointment;
        Appointment.find({
            where: {
                isReminded: { ne: true },
                scheduledDate: { gte: moment().add('hours', 12).toDate() },
                scheduledDate: { gte: new Date() }
            },
            include: ["patient", "doctor", "location"]
        }, function (err, apmts) {

            _.forEach(apmts, (a) => {
                a = JSON.parse(JSON.stringify(a))
                if (!a.patient || !a.patient.email)
                    a.patient = a.patient_info;


                var data = {
                    appointment: a,
                    email: a.patient && a.patient.email
                };

                console.log("test ... ", a.patient)

                // if (data.email == 'thanh@vastbit.com')
                emailHandler.sendEmail(data, emailHandler.EMAIL_TEMPLATES.AppointmentReminder, function (res) {
                    console.log("Response: ", res);

                });

                a.isReminded = true;
                Appointment.upsert(a)
            })
            res.send({
                result: _.map(apmts, (a) => {
                    return {
                        appointment: a,
                        email: (a.patient_info && a.patient_info.email) || (a.patient && a.patient.email)
                    };
                })
            })
        })
    });

    app.get('/api/fixOrder2', function (req, res) {
        var MDH = req.param('MDH');
        var Order = app.models.order;
        var Test = app.models.test;
        var OrderItem = app.models.orderItem;

        Order.findOne({
            where: {
                MDH: MDH
            },
            include: [
                "patient", "package",
                {
                    relation: "orderItems",
                    scope: {
                        include: ["service", "test"]
                    }
                }
            ]
        }, function (err, order) {
            var order = JSON.parse(JSON.stringify(order));
            _.forEach(order.orderItems, (oi) => {
                if (oi.test && oi.test.sampleType && oi.isAbnormal) {
                    delete oi.test;
                    OrderItem.upsert(oi);
                }
            })

            res.send({});

        })
    });

    app.post('/api/mail-webhook', function (req, res) {

        var Order = app.models.order;
        var body = req.body;

        // forward it to care1
        const { exec } = require('child_process');
        if (req.headers && req.headers.host && req.headers.host == 'care1.vastbit.com') {
            exec("sudo -u ubuntu ssh ubuntu@care0.vastbit.com " +
                '"curl -d \'' + JSON.stringify(req.body).replace(/[\""]/g, '\\"') + '\' -H \'Content-Type: application/json\' -X POST http://localhost/api/mail-webhook"', (err, stdout, stderr) => {
                    if (err) {
                        console.log("can not ssh", err)
                    }
                });

            res.send({});
            return;
        }


        _.forEach(body, (item) => {
            var msgId = null;
            var deliveryStatus = null;

            if (item['sg_message_id']) {
                var msgIdRaw = item['sg_message_id'].split('.filter');
                msgId = msgIdRaw[0];
                
                var email = item['email'];
                var event = item['event'];
                

                if (event == 'bounce' || event == 'dropped') {
                    deliveryStatus = 'failed'
                }

                if (event == 'delivered') {
                    deliveryStatus = 'delivered';
                }

                console.log(msgId, email, event, deliveryStatus);
            }
   

            if (msgId && deliveryStatus) {
                Order.findOne({
                    where: {
                        mailGunId: msgId
                    }
                }, function (err, order) {
                    var attrs = {
                        deliveryStatus: deliveryStatus
                    }

                    if (order) {
                        console.log('Found order......', msgId, order.id);

                        order.updateAttributes(attrs, function (err, result) {
                            if (err) {
                                console.log('Could not update delivery date')
                            }
                        })

                        if (event != 'delivered') {
                            var Log = app.models.log;
                            Log.upsert({
                                event: 'send-mail',
                                action: 'send',
                                model: 'order',
                                createdById: 'system',
                                data: event,
                                orderId: order.id,
                                mailGunId: msgId
                            }, function (err, log) {
                                console.log(err, log)
                            })
                        }
                    } else {
                        console.log('Could not mailgun id', msgId, err, req.headers.host);
                    }
                });
            }
        });

        res.send({});
    });

    app.get('/api/test-mail', function (req, res) {
                var email = req.param('email');
        var api_key = 'key-45fae8265fa182af6aa6063eede2245c';
        
        var data = {
            from: 'noreply@vietnammedicalpractice.com',
            to: 'thanh.nguyenvan@gmail.com',
            subject: 'Hello', messageId: function() {},
            text: 'Testing some Mailgun awesomeness!'
        };
        //emailHandler.sendEmailWithoutTemplate("thanh.nguyenvan@gmail.com", "Forgot password", "test", function() {res.send({})} );
        //loopback.Email.send(data).then(function(response){console.log(response)})
        //.catch(function(err){ console.log(err); res.send({}); });
        var ll = 0;
        var Sample = app.models.Sample;
        var ids = ["2024846310","2026103601","2026103602","2026103604","2026103609","2024585401","2024585402","2024585404","2024585409","2026103702","2026103704","2026103709","2025431701","2025431702","2025431704","2025431709","2025634101","2025634102","2025634104","2025634109","2025363101","2025363102","2025363104","2025363109","2025363112","2025338801","2025338802","2025338809","2026103301","2026103302","2026103304","2026103309","2026103312","2025619701","2025619702","2025619704","2025619709","2026103401","2026103402","2026103404","2026103409","2025619902","2025619909","2025617701","2025617702","2025617704","2025617709","2025617601","2025617602","2025617604","2025617609","2025339301","2025339302","2025339309","2025338301","2025338302","2025338309","2025333909","2025635701","2025635702","2025635704","2025635709","2023479901","2023479902","2023479904","2023479909","2025636601","2025636602","2025636604","2025380401","2025380402","2025380409","2025617501","2025617502","2025617504","2025617509","2025433501","2025433502","2025433504","2025433509","2024890802","2024890804","2024890809","2025639501","2025639502","2025639504","2025639509","2026105201","2026105202","2026105204","2026105209","2025617112","2026104709","2026105301"];
        ids = ["2025438113", "2025634313", "2025639613", "2025438213", "2023482013", "2025634315", "2025617215", "2025469111"];
        Sample.find({
           where: {sampleId: {"in": ids}}}).
        then(function (samples) {
           _.forEach(samples, (sample) => { sample.updateAttributes({receivedAt: new Date('2020-07-25T09:50:24.256+00:00'), collectedAt: new Date('2020-07-25T08:50:24.256+00:00')}, function(e, r) {ll++; if(ll==94) res.send({len: samples.length});} ) })
           //res.send({len: samples.length});
        }); 
    });

    app.get('/api/fixOrder3', function (req, res) {
        var Order = app.models.order;
        var Test = app.models.test;
        var OrderItem = app.models.orderItem;

        Order.find({
            where: {
                isComplete: true,
                completeDate: {
                    eq: null
                },
                refOrderId: {
                    eq: null
                }
            },
            limit: 1000,
            include: [
                "patient", "package",
                "orderItems", 
                "visits",
                // {
                    // relation: "orderItems",
                    // scope: {
                    //     include: ["service", "test"]
                    // }
                // }
            ]
        }).then(function (orders) {
            _.forEach(orders, (_order) => {
                var order = JSON.parse(JSON.stringify(_order))
                var pes = _.filter(order.orderItems, (oi) => { return oi.serviceId == "580479d743a45dd7621b52ea"});

                var gynPackages =  ["5ab2229a81ea797f5385ed74", "5a69a6e4362db0896e18e761", "5a69a78b74d8ddb16eb50f1c"];
                if (pes.length == 0) {
                    // Gyn packages
                    pes = _.filter(order.orderItems, (oi) => { return oi.testId == "58a6e0274b3562050ec3cbc1" || 
                        oi.testId == "5a08f19e40da73b10fcb596d" || 
                        oi.testId == "5a3a17632e3715d33c9deba5"}
                    );
                }

                var updatedAttrs = {};

                console.log(order.patient && order.patient.fullName);

                if (order.visits && order.visits.length) {
                    // not very true
                    updatedAttrs.checkUpDate = order.visits[0].createdAt;
                }

                if (pes.length) {
                    if (pes[0].updatedAt) {
                        _order.completeDate = pes[0].updatedAt;
                        updatedAttrs.completeDate= pes[0].updatedAt;
                    }
                }

                if (updatedAttrs.completeDate || updatedAttrs.checkUpDate) {
                    _order.updateAttributes(updatedAttrs);
                    console.log(updatedAttrs);
                }
            })
            
            res.send({count: orders.length});
        }, (e) => {
            res.send({e: e.toString()});
        })
    })

    app.get('/api/fixOrder', function (req, res) {
        var MDH = req.param('MDH');
        var Order = app.models.order;
        var Test = app.models.test;
        var OrderItem = app.models.orderItem;

        Order.findOne({
            where: {
                MDH: MDH
            },
            include: [
                "patient", "package",
                {
                    relation: "orderItems",
                    scope: {
                        include: ["service", "test"]
                    }
                }
            ]
        }, function (err, order) {
            var order = JSON.parse(JSON.stringify(order));
            var package = order.package;
            var packageTestMap = {};
            var tests = [];
            _.forEach(package.tests, (t) => { var t = JSON.parse(t); tests.push(t.id); packageTestMap[t.id] = t })

            var orderItems = {};
            _.forEach(order.orderItems, (oi) => {
                orderItems[oi.test && oi.test.id || oi.service && oi.service.id] = true;
            });

            var missing = [];

            _.forEach(tests, (t) => {
                if (!orderItems[t]) {
                    missing.push(t);
                }
            });

            var orderItemsToCreate = [];
            Test.find({
                where: {
                    id: { inq: missing }
                },
                include: ["subTests"]
            }, function (err, tests) {
                tests = JSON.parse(JSON.stringify(tests));
                _.forEach(tests, (t) => {
                    OrderItem.upsert({
                        "orderId": order.id,
                        "status": "new",
                        "testId": t.id,
                        "type": t.sampleType ? 1 : 0,
                        "clinicId": "57d8ce790bf89f8731945b15",
                        "isActive": true,
                        "clinicIds": [
                            "57d8ce790bf89f8731945b15"
                        ],
                        "patientId": order.patientId,
                        "isOptional": packageTestMap[t.id].isOptional,
                        "isFree": packageTestMap[t.id].isFree
                    });

                    if (t.subTests) {
                        _.forEach(t.subTests, (st) => {
                            if (st)
                                OrderItem.upsert({
                                    "orderId": order.id,
                                    "status": "new",
                                    "name": "sub",
                                    "testId": st.id,
                                    "type": st.sampleType ? 1 : 0,
                                    "clinicId": "57d8ce790bf89f8731945b15",
                                    "isActive": true,
                                    "clinicIds": [
                                        "57d8ce790bf89f8731945b15"
                                    ],
                                    "patientId": order.patientId,
                                    "isOptional": packageTestMap[st.id] && packageTestMap[st.id].isOptional,
                                    "isFree": packageTestMap[st.id] && packageTestMap[st.id].isFree
                                });
                        });
                    }
                });

                res.send(tests);
            });
        });
    })

    app.get('/api/remoteTabletAnswerMedical', function (req, res) {
        var patientId = req.param('patientId');
        console.log('tesst', req, patientId)
        var Patient = app.models.patient;

        Parse.initialize("hat-app");
        Parse.serverURL = 'http://127.0.0.1/parse';
        var Notification = Parse.Object.extend("piNotification");
        var n = new Notification();

        Patient.findById(patientId, function (err, data) {
            if (err) {
                res.send(err);
                return
            }
            if (!data) {
                res.send('Not found patient');
                return
            }
            n.set({ data: data });
            n.set("remoteMedical", true)
            n.save(null, {
                success: function (_n) {
                    console.log('success')
                    successHandler(res, data)
                },
                error: function (_n, error) {
                    // Execute any logic that should take place if the save fails.
                    // error is a Parse.Error with an error code and message.
                    console.log('Failed to create new object, with error code: ' + error.message);
                    res.send(error.message);
                }
            });

        })
    })

    app.get('/api/simulateCobasIT', function (req, res) {

        var sampleId = req.body.sampleId;

        var Sample = app.models.Sample;
        var OrderItem = app.models.orderItem;
        console.log('test', req, sampleId)
        Sample.findOne({
            where: {
                sampleId: sampleId
            }
        }, function (err, s) {
            if (err) {
                errorHandler(res, err);
                return
            }
            if (!s) {
                errorHandler(res, err);
                return
            }

            console.log('sccc', s)
            var orderItemIds = s.orderItemIds

            OrderItem.find({
                filter: {
                    where: {
                        and: [
                            { id: { inq: orderItemIds } }
                        ]
                    }
                }
            }).then(function (ordI) {

                if (ordI && ordI.length) {
                    var ups = [];
                    var count;
                    for (i = 0; i < ordI.length; i++) {
                        count++;
                        var upOder = ordI[i];
                        if (upOder.type && upOder.type == 1) {
                            upOder.status = 'done';
                            var chars = "0123456789";
                            var result = ""
                            for (var j = 0; j < 2; ++j) {
                                result += chars.charAt(Math.floor(Math.random() * chars.length))
                            };
                            upOder.result = result;
                            upOder.technician = "Rochelle";
                            ups.push(upOder.updateAttributes(upOder, function (updateErr, o) {
                                if (updateErr) {
                                    res.send({ isSuccess: false, result: null, errMsg: updateErr })
                                }
                            }));
                        };
                        // if(count==ordI.length){

                        // }
                    }
                    Q.all(ups).then(function () {
                        successHandler(res, s)
                    })
                }

            }, function (error) {
                if (error) {
                    res.send({ isSuccess: false, result: null, errMsg: error });

                }
            })


        })
    })

    app.post('/api/lead-login', function (req, res) {
        var username = req.body.username;
        var password = req.body.password;
        var loginData = { password: password };
        var Lead = app.models.Lead;
        if (username.indexOf('@') > -1) {
            loginData.email = username.toLowerCase()
        } else {
            loginData.phoneNumber = username
        }
        console.log('login data', loginData)
        Lead.login(loginData, function (err, p) {

            if (err) {
                console.log('erro', err)
                res.send({ isSuccess: false, result: null, errMsg: err });
                return;
            }
            if (p) {
                res.cookie('access_token', p.id, {
                  ///  signed: true
                });

                successHandler(res, p)
            }
        });
    })

    app.post('/api/decodeBase64', function (req, res) {
        var t = (new Date).getTime();
        var file = path.join(__dirname, '../', '../', 'storage' + "/files") + '/' + t + '.png';
        var base64 = req.param('base64');
        fs.writeFileSync(file, new Buffer(base64, 'base64'), 'binary');
        successHandler(res, { file: file });
    })

    app.get('/api/ip', function (req, res) {
        res.send('window.remoteIp = "' + req.headers['x-real-ip'] + '";');
    });


    app.get('/api/appointments/me', function (req, res) {
        if (req.accessToken && req.accessToken.userId) {
            var Appointment = app.models.appointment;
            Appointment.find({
                where: {
                    patientId: req.accessToken.userId,
                    removed: { neq: true }
                },
                include: ["location", "doctor", "specialty"],
                order: "date desc"
            }).then(function (result) {
                res.send(result)
            });
        } else {
            res.status(401);
            res.send({
                'Error': 'Unauthorized',
                'Message': 'You need to be authenticated to access this endpoint'
            });
        }
    });


    function patientRegister(req, res) {
        var obj = JSON.parse(JSON.stringify(req.body));
        console.log(obj)
        var Patient = app.models.patient;

        obj.DOB = moment(obj.DOB, 'DD-MM-YYYY').toDate();

        Patient.upsert(
            obj
        ).then(function (result) {
            res.send(result)
        }, function (err) {
            res.send({
                'Error': 'Uknown',
                'Message': str(err)
            });
        });
    }

    function currentPatient(req, res) {
        if (req.accessToken && req.accessToken.userId) {
            var Patient = app.models.patient;
            Patient.find({
                where: {
                    id: req.accessToken.userId,
                    removed: { neq: true }
                }
                // include: ["location", "doctor", "specialty"],
                // order:"date desc"
            }).then(function (result) {
                res.send(result[0])
            });
        } else {
            res.status(401);
            res.send({
                'Error': 'Unauthorized',
                'Message': 'You need to be authenticated to access this endpoint'
            });
        }
    }



    app.post('/api/public/patients', patientRegister);

    app.get('/api/public/patients', currentPatient);



    function upsertAppointment(req, res) {
        if (req.accessToken && req.accessToken.userId) {
            var patientId = req.accessToken.userId;
            var obj = JSON.parse(JSON.stringify(req.body))
            var Appointment = app.models.appointment;
            obj.patientId = patientId;
            obj.createdById = patientId;


            if (obj.id) {
                Appointment.findById(obj.id, function (err, r) {
                    delete obj.id;
                    r.updateAttributes(obj, function (data) {
                        res.send(r)
                    });
                })

            } else {
                obj.status = "confirmed";
                Appointment.upsert(
                    obj
                ).then(function (result) {
                    res.send(result)
                });
            }
        } else {
            res.status(401);
            res.send({
                'Error': 'Unauthorized',
                'Message': 'You need to be authenticated to access this endpoint'
            });
        }
    }

    app.post('/api/appointments/me', upsertAppointment);
    app.put('/api/appointments/me', upsertAppointment);


    app.get('/api/rate/:doctorId/:rate', function (req, res) {
        var doctorId = req.param("doctorId");
        var rateValue = req.param("rate");
        var Doctor = app.models.user;
        Doctor.findById(doctorId, {}, function (error, d) {
            if (error) {
                res.send(error);
                return;
            }
            if (!d) {
                res.send("Not found doctor!");
                return;
            }
            d[rateValue.toString()] = d[rateValue.toString()] + 1;
            var totalRate = 0;
            var totalRateUser = 0;
            for (var i = 1; i < 6; i++) {
                totalRate += d[i.toString()] * i;
                totalRateUser += d[i.toString()];
            }

            d.rank = totalRate / totalRateUser;
            d.updateAttributes(d, function (updateErr, doctor) {
                if (updateErr) {
                    res.send(updateErr);
                    return;
                }
                successHandler(res, { rank: doctor.rank });
            });
        });
    });

    app.get("/api/doctor-appmt/:doctorId/:date", function (req, res) {
        var doctorId = req.param("doctorId");
        var date = req.param("date");
        var Doctor = app.models.user;
        var Appointment = app.models.appointment;
        var fromDate = moment(date).utc().hour(0).minute(0).second(0);
        var toDate = moment(date).utc().hour(23).minute(59).second(59);
        Doctor.findById(doctorId, {}, function (error, d) {
            if (error) {
                errorHandler(res, err);
                return;
            }
            if (!d) {
                errorHandler(res, { msg: "Not found doctor!" });
                return;
            }
            Appointment.find({
                filter: {
                    where: {
                        doctorId: d.id,
                        date: { gte: [fromDate, toDate] }
                    }
                }
            }, function (error, result) {
                if (error) {
                    errorHandler(res, err);
                    return;
                }

                successHandler(res, result);
            });
        });
    })

    app.get("/api/verify-account/:code", function (req, res) {
        var code = req.param("code");
        console.log("Code: ", code);
        var User = app.models.User;
        User.find({
            where: {
                verifyCode: code,
                isActive: false
            }
        }, function (err, p) {
            if (err) {
                console.log("get user error!");
                errorHandler(res, err);
                return;
            }
            if (!p || !p.length) {
                console.log("Not found user");
                res.send("Not found user");
                return;
            }

            var patient = p[0];

            patient.updateAttributes({
                isActive: true,
                emailVerified: true
            }, function (err, p) {
                if (err) {
                    console.log("update user error!");
                    errorHandler(res, err);
                    return;
                }

                res.send("Thank you!");
            });
        });
    });

    app.get('/api/send-msg/:notificationId/:receiverId', function (req, res) {
        var notificationId = req.param("notificationId");
        var receiverId = req.param("receiverId");
        var Notification = app.models.notification;

        console.log("GO to here???");

        Notification.findById(notificationId, function (err, notification) {
            console.log("11111111111");
            if (err) {
                console.log("error: ", err);
                errorHandler(res, err);
                return;
            }

            if (!notification) {
                console.log("Not found noti: ", notificationId);
                errorHandler(res, { msg: "Not found notification." });
                return;
            }

            var index = -1;
            var receiver;

            console.log("2222222222");

            notification.receivers.forEach(function (r, i) {
                if (r.id == receiverId) {
                    receiver = r;
                    index = i;
                }
            });

            if (!receiver) {
                errorHandler(res, { msg: "Not found receiver" });
                return;
            }

            console.log("HEre gain??");

            if (notification.notiMethod.indexOf(NotificationModule.kNotificationMethod.Email) > -1) {
                if (receiver.email) {
                    receiver.isDelivered = true;
                    var content = notification.content;
                    console.log("Come here?");
                    var Patient = app.models.patient;
                    console.log("title: ", notification.title);
                    Patient.findById(receiverId, function (error, p) {
                        if (error) {
                            errorHandler(res, error);
                            return;
                        }

                        if (!p) {
                            var User = app.models.user;
                            User.findById(receiverId, function (error, u) {
                                if (error) {
                                    errorHandler(res, error);
                                    return;
                                }

                                if (!u) {
                                    errorHandler(res, { errmsg: "Not found receiver!" });
                                    return;
                                }

                                content = nunjucks.renderString(content, JSON.parse(JSON.stringify(u)));
                                NotificationModule.sendEmail(receiver.email, notification.title, content, function (res) {
                                    console.log("send email to " + receiver.email);
                                });
                            })
                        } else {
                            content = nunjucks.renderString(content, JSON.parse(JSON.stringify(p)));
                            NotificationModule.sendEmail(receiver.email, notification.title, content, function (res) {
                                console.log("send email to " + receiver.email);
                            });
                        }
                    })
                }
            }

            if (notification.notiMethod.indexOf(NotificationModule.kNotificationMethod.SMS) > -1) {
                console.log("Send SMS.");
                if (receiver.phone) {
                    receiver.isDelivered = true;
                    NotificationModule.sendSms(receiver, notification.content, function (res) {
                        console.log("send sms to " + receiver.phone);
                    });
                }
            }

            notification.receivers[index].isDelivered = true;
            notification.updateAttributes({
                receivers: notification.receivers
            }, function (err, noti) {
                if (err) {
                    console.log("Update notification error: ", err.msg);
                    errorHandler(res, err);
                    return;
                }

                successHandler(res, noti);
            });
        });
    });

    app.get('/api/getOrderNotSynced', function (req, res) {
        var Order = app.models.order;
        // Get not synced order
        Order.find({
            fields: {
                id: 1,
                patientId: 1,
                isRemoved: 1,
                isSynced: 1,
                isUpdated: 1
            },
            where: {
                isSynced: false,
                type: 3
            },
            include: [
                {
                    relation: "patient",
                    scope: {
                        fields: {
                            id: 1,
                            fullName: 1,
                            firstName: 1,
                            lastName: 1,
                            gender: 1,
                            DOB: 1,
                            address: 1
                        }
                    }
                }
            ]
        }, function (err, orders) {
            if (err) {
                console.log("Get order error: ", err.msg);
                errorHandler(res, err);
                return;
            }

            var orderList = _.map(orders, function (o) {
                return o.orderItems().length > 0 ? o : null;
            }).filter(function (o) {
                return o;
            });

            var orderDic = {};
            var testIds = [];

            orderList.forEach(function (o) {
                orderDic[o.id] = [];
                var orderItems = o.orderItems();
                var tests = _.map(orderItems, function (ot) {
                    return [].concat(_.map(ot.service().test, function (t) {
                        return t.toString();
                    })).toString();
                });

                orderDic[o.id] = tests.toString().split(',');
                testIds = _.uniq(testIds.concat(tests.toString().split(',')));
            });

            var Test = app.models.test;
            Test.find({
                where: { id: { inq: testIds } }
            }, function (err, testRes) {
                if (err) {
                    console.log("find test error: ", err.errmsg);
                    errorHandler(res, err);
                    return;
                }

                orderList.forEach(function (o) {
                    var testsInOrder = orderDic[o.id];

                    var tests = _.filter(testRes, function (t) {
                        return testsInOrder.indexOf(t.id.toString()) > -1;
                    });

                    o.orderItems = [];
                    var result = [];

                    tests.forEach(function (t) {
                        result.push({
                            orderId: o.id,
                            testCode: t.code,
                            testId: t.id
                        });
                    });

                    o.orderItems = result;
                });

                successHandler(res, orderList);
            });
        });
    });

    app.post('/api/updateSyncedOrderStatus', function (req, res) {
        var orderIds = req.body.orderIds;
        var Order = app.models.Order;

        Order.updateAll({
            id: { inq: orderIds }
        }, {
                isSynced: true
            }, function (err, info) {
                if (err) {
                    console.log("Get order error: ", err.errmsg);
                    errorHandler(res, err);
                    return;
                }

                successHandler(res, { updatedCount: info.count });
            });
    });

    app.post('/api/updateTestResults', function (req, res) {
        var orderId = req.body.orderId;
        var results = req.body.results;

        if (!orderId) {
            errorHandler(res, { errmsg: "Missing order id." });
            return;
        }

        if (!results) {
            errorHandler(res, { errmsg: "Missing tests list." })
            return;
        }

        var Order = app.models.order;
        var TestResult = app.models.testResult;
        Order.findById(orderId, {
            include: [
                { orderItems: ["service"] },
                "patient",
                "visit"
            ]
        }, function (err, order) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            if (!order) {
                errorHandler(res, { errmsg: "Not found order" });
                return;
            }

            var orderItems = order.orderItems();
            var serviceTestIds = [];
            var orderItemTestId = {};
            orderItems.forEach(function (ot) {
                orderItemTestId[ot.id] = [];
                var tests = [].concat(ot.service().test);
                tests.forEach(function (t) {
                    serviceTestIds.push(t);
                    orderItemTestId[ot.id].push(t);
                });
            });

            var Test = app.models.test;
            Test.find({
                where: {
                    id: { inq: serviceTestIds }
                }
            }, function (err, tests) {
                if (err) {
                    errorHandler(res, err);
                    return;
                }

                var testResults = [];
                var orderItemTest = {};
                orderItems.forEach(function (ot) {
                    orderItemTest[ot.id] = tests.filter(function (t) {
                        return orderItemTestId[ot.id].indexOf(t.id.toString()) > -1;
                    });

                    var orderItemResult = results.filter(function (r) {
                        return orderItemTest[ot.id].map(function (t) {
                            return t.code;
                        }).indexOf(r.testCode) > -1;
                    });

                    orderItemTest[ot.id].forEach(function (otTest) {
                        orderItemResult.forEach(function (otResult) {
                            if (otResult.testCode == otTest.code) {

                                otTest.result = otResult.result;
                                otTest.note = otResult.comment;
                            }
                        })
                    });

                    var testResult = {
                        orderItemId: ot.id,
                        orderId: order.id,
                        patientId: order.patient.id,
                        serviceId: ot.serviceId,
                        result: orderItemTest[ot.id],
                        visitId: order.visitId
                    };
                    testResults.push(testResult);
                });

                TestResult.upsert(testResults, function (err, result) {
                    if (err) {
                        errorHandler(res, err);
                        return;
                    }
                    successHandler(res, result);
                });
            });
        });
    });

    app.get('/api/getLocation/:country/:city/:district', function (req, res) {
        var country = req.param('country');
        var city = req.param('city');
        var district = req.param('district');

        if (!country) {
            successHandler(req, ["Vietnam"])
            return;
        }

        if (country && !city) {
            var cities = locationHandler.getCities(country);
            successHandler(res, cities);
            return;
        }

        if (city && !district) {
            var districts = locationHandler.getDistricts(city);
            successHandler(res, districts);
            return;
        }

        if (country && city && district) {
            console.log("Come here");
            var wards = locationHandler.getWards(city, district);
            successHandler(res, wards);
            return;
        }
        successHandler(res, []);
    });

    app.get('/api/getLocation/:country/:city', function (req, res) {
        var country = req.param('country');
        var city = req.param('city');

        var districts = locationHandler.getDistricts(city);
        successHandler(res, districts);
    });

    app.get('/api/getLocation/:country', function (req, res) {
        var country = req.param('country');
        var cities = locationHandler.getCities(country);
        successHandler(res, cities);
    });

    app.get('/api/getLocation', function (req, res) {
        successHandler(res, ['Vietnam']);
    });


    app.get('/api/doctor-availability-in-month/:clinicId/:doctorId/:date', function (req, res) {
        var doctorId = req.param('doctorId');
        var date = req.param('date');

        doctorSchedule.getAvailableDaysInMonth(req.param('clinicId'), req.param('locationId'), doctorId, date, function (result) {
            successHandler(res, result);
        });
    });


    app.get('/api/doctor-availability/:clinicId/:doctorId/:date', function (req, res) {
        var doctorId = req.param('doctorId');
        var date = req.param('date');
        var slots = [];
        // previous day
        var previousDay = moment(date, 'YYYY-MM-DD').add(-1, 'day').format('YYYY-MM-DD');

        function minuteToTimeText(minute) {
            var h = Math.floor(minute / 60); var m = minute - h * 60;
            if (h < 10) h = '0' + h.toString();
            if (m < 10) m = '0' + m.toString();
            return h.toString() + ':' + m.toString();
        }

        doctorSchedule.getAvailability(req.param('clinicId'), req.param('locationId'), doctorId, previousDay, function (preResult) {
            doctorSchedule.getAvailability(req.param('clinicId'), req.param('locationId'), doctorId, date, function (result) {
                var Appointment = app.models.appointment;
                Appointment.find({
                    where: {
                        doctorId: doctorId,
                        date: date,
                        status: { neq: 'cancelled' }
                    }
                },
                    function (err, apmts) {

                        for (var i = 0; i < preResult.slots.length; i++) { if (preResult.slots[i] >= 24 * 60) { slots.push(minuteToTimeText(preResult.slots[i] - 24 * 60)); } }
                        for (var i = 0; i < result.slots.length; i++) { if (result.slots[i] < 24 * 60) { slots.push(minuteToTimeText(result.slots[i])); } }

                        var bookedSlots = apmts.map(function (s) { return s.timeSlot });
                        result['bookedSlot'] = bookedSlots;
                        for (var i = bookedSlots.length - 1; i > -1; i--) {
                            var bSlot = bookedSlots[i];
                            if (req.param('removeBookedSlots') && slots.indexOf(bSlot) > -1) {
                                slots.splice(slots.indexOf(bSlot), 1);
                            }
                        }
                        result.slots = slots;

                        successHandler(res, result);
                    });
            });
        });

    });

    app.post('/api/activeAccount', function (req, res) {
        var code = req.body.code;
        var phoneNumber = req.body.phoneNumber;
        var email = req.body.email;

        console.log("Req data: ", code, phoneNumber, email);

        // Validate req
        if (!code) {
            errorHandler(res, { errmsg: "Missing code!" });
            return;
        }

        if (!phoneNumber && !email) {
            errorHandler(res, { errmsg: "Email or phone number are missing" });
            return;
        }

        var Patient = app.models.patient;
        var query = {
            verifyCode: code
        };

        if (phoneNumber) {
            query['phoneNumber'] = phoneNumber;
        }

        if (email) {
            query['email'] = email;
        }

        Patient.find({
            where: query
        }, function (err, patients) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            console.log("Active account found patients: ", patients.length);

            var p = patients[0];

            if (!p) {
                errorHandler(res, { errmsg: "Account not found or wrong code." });
                return;
            }

            p.updateAttributes({
                isActive: true
            }, function (err, result) {
                if (err) {
                    errorHandler(res, { errmsg: "Update isActive error: " + err.errmsg });
                    return;
                }

                successHandler(res, result);
            })
        })
    });

    app.post('/api/resendVerifyCode', function (req, res) {
        var email = req.body.email;
        var phone = req.body.phoneNumber;

        if (!email && !phone) {
            errorHandler(res, { errmsg: "Missing phone number and email" });
            return;
        }

        var query = {};

        if (email) {
            query.email = email;
        };
        if (phone) {
            query.phoneNumber = phone;
        }

        var Patient = app.models.patient;
        Patient.find({
            where: query
        }, function (err, patients) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            if (!patients || !patients.length) {
                errorHandler(res, { errmsg: "Not found user" });
                return;
            }

            var p = patients[0];
            if (p.isActive) {
                successHandler(res, { result: { msg: "Your account has been activated" } });
                return;
            }
            sendVerifyEmail(p, function (result) {
                sendVerifySms(p, function (result) {
                    if (!res)
                        console.log("send verify sms error: ");
                    successHandler(res, "Sent");
                });
            });
        })
    });

    app.post('/api/forgotPassword', function (req, res) {
        var phone = req.body.phoneNumber;

        if (!phone) {
            errorHandler(res, { errmsg: "Missing phone number." });
            return;
        }

        var Patient = app.models.patient;

        Patient.findOne({
            where: {
                phoneNumber: phone,
                clinicId: ""
            }
        }, function (err, p) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            if (!p) {
                errorHandler(res, { errmsg: "Not found patient with phone" });
                return;
            }

            var code = generateVerifyCode();

            p.updateAttributes({
                isActive: false,
                verifyCode: code
            }, function (err, result) {
                if (err) {
                    errorHandler(res, err);
                    return;
                }

                console.log("Forgot password result: ", result);
                sendVerifySms(result, function (sendSMSRes) {
                    successHandler(res, "Success");
                });
            })
        })
    });

    app.post('/api/user/forgotPassword', function (req, res) {
        var phone = req.body.phoneNumber;

        if (!phone) {
            errorHandler(res, { errmsg: "Missing phone number." });
            return;
        }

        var email;
        if (phone.includes('@')) {
            email = phone;
        }

        var query = {};
        if (email) {
            query.email = email;
        } else {
            query.phoneNumber = phone;
        }
        console.log("query", query);

        var User = app.models.user;

        User.findOne({
            where: query
        }, function (err, p) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            if (!p) {
                errorHandler(res, { errmsg: "Not found user" });
                return;
            }

            var code = generateVerifyCode();

            p.updateAttributes({
                isActive: false,
                verifyCode: code
            }, function (err, result) {
                if (err) {
                    errorHandler(res, err);
                    return;
                }

                if (email) {
                    sendVerifyCode(result, function (sendEmailRes) {
                        successHandler(res, "Success");
                    })
                } else {
                    sendVerifySms(result, function (sendSMSRes) {
                        successHandler(res, "Success");
                    });
                }
            })
        })
    });

    app.get('/api/activeAccountUser', function (req, res) {
        var id = req.param('userId');
        var User = app.models.user;
        User.findById(id).then(function (u) {
            if (!u) {
                errorHandler(res, { errmsg: "not found user" });
                return;
            }

            console.log("USERRRRRRR: ", u);

            u.updateAttributes({
                isActive: true
            }, function (error, result) {
                console.log("Active result: ", result);
                successHandler(res, "Success");
            })
        }, function (error) {
            console.log(error);
            errorHandler(res, error);
        })
    });

    app.post('/api/newPassword', function (req, res) {
        var code = req.body.verifyCode;
        var newPassword = req.body.password;
        var phone = req.body.phoneNumber;
        var context = req.body.context;
        var ModelName;

        if (context && context == "user") {
            ModelName = app.models.user;
        } else {
            ModelName = app.models.patient;
        }

        console.log("Model: ", ModelName);

        var requiredParamsErrMsg = [];
        if (!code) {
            requiredParamsErrMsg.push("verify code");
        }

        if (!newPassword) {
            requiredParamsErrMsg.push("password");
        }

        if (!phone) {
            requiredParamsErrMsg.push("phone");
        }

        if (requiredParamsErrMsg.length) {
            errorHandler(res, { errmsg: "Missing " + requiredParamsErrMsg.join(", ") });
            return;
        }

        //var Patient = app.models.patient;

        var query = {
            isActive: { neq: true },
            verifyCode: code
        };

        if (phone.includes('@')) {
            query.email = phone;
        } else {
            query.phoneNumber = phone;
        }
        ModelName.findOne({
            where: query
        }, function (err, p) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            if (!p) {
                errorHandler(res, { errmsg: "Not found!" });
                return;
            }

            p.updateAttributes({
                password: newPassword,
                isActive: true
            }, function (err, result) {
                if (err) {
                    errorHandler(res, err);
                    return;
                }

                successHandler(res, result);
            });
        });
    });

    app.post('/api/getClinics', function (req, res) {
        var curClinic = req.body.curClinic;
        var query = "";
        if (curClinic) {
            query = { id: { neq: curClinic } }
        };

        var Clinic = app.models.clinic;
        Clinic.find({
            where: query
        }, function (err, clinics) {
            if (err) {
                errorHandler(res, err);
                return;
            }

            successHandler(res, clinics);
        });
    });

    app.get('/api/whoami', function (req, res) {
        console.log('whoami');
        var app = require('../server');
        var AccessToken = app.models.AccessToken;
        AccessToken.findForRequest(req, {}, function (aux, accesstoken) {
            console.log(aux, accesstoken);
            if (accesstoken == undefined) {
                res.status(401);
                res.send({
                    'Error': 'Unauthorized',
                    'Message': 'You need to be authenticated to access this endpoint'
                });
            } else {
                var UserModel = app.models.user;
                UserModel.findById(accesstoken.userId, function (err, user) {
                    console.log(user);
                    res.status(200);
                    res.send();
                });
            }
        });
    });

    app.post('/api/gif', function (req, res) {
        var files = req.body;
        console.log(typeof (files));
        successHandler(res, gif.gen(files.user, files.friend));
    });

    app.post('/api/upload-file', function (req, res) {
        var files = req.files || req.file || req.form.file;
        console.log(typeof (files));
        successHandler(res, "Success");
    });

    app.post('/api/getAvailableClinic', function (req, res) {
        var curClinicId = req.body.curClinic;

        if (!curClinicId) {
            errorHandler(res, { errmsg: "Missing current clinic" });
            return;
        }

        var Clinic = app.models.clinic;
        Clinic.find({
            where: {
                id: { neq: curClinicId },
                isActive: true
            }
        }, function (error, result) {
            if (error) {
                errorHandler(res, error);
                return;
            }

            successHandler(res, result);
        })
    });


    app.get('/api/check-up/availableDates', function (req, res) {
        var month = req.param('month');
        var dates = [];
        var weeks = [];
        var startMonth = moment(month + '-01 23:59', "YYYY-MM-DD hh:mm");
        var idate = moment(month + '-01', "YYYY-MM-DD");
        var today = moment();

        for (var i = 1; i < startMonth.weekday(); i++) {
            dates.push({});
        }

        for (var i = 1; i <= startMonth.daysInMonth(); i++) {
            var v = {};
            v[idate.dates().toString()] = today < idate ? Math.floor(Math.random() * 8) : 0;
            dates.push(v);
            idate.add(1, 'day');
        }

        for (var i = 0; i < dates.length; i++) {
            if (i % 7 == 0) weeks.push([]);
            weeks[Math.floor(i / 7)].push(dates[i]);
        }

        var date = req.param('date');

        if (!date)
            successHandler(res, { weeks: weeks });
        else
            successHandler(res, { slots: [{ title: "8:00AM - 9:00AM", available: 3, hour: 8 }, { title: "9:00AM - 10:00AM", available: 5, hour: 9 }] });
    });

    app.get('/api/pdf', function (req, res) {
        console.log('params ... ', req.query.template, req.query.modelName, req.query.filter, req.query.page);
        pdfHandler.generateFromTemplate(req.param('template'),
            req.param('filter') && JSON.parse(req.param('filter')), req.param('modelName'), res, req,
            pdfHandler.writeResponse);
    });

    app.get('/api/medical-report', function (req, res) {

        var filter = {
            "where": {
                "or": [{ "id": req.param('orderId') }, { "refOrderId": req.param('orderId') }]
            },
            "include": [
                "patient",
                {
                    "orderItems": [
                        "service",
                        {
                            "test": "group"
                        },
                        "excuteBy", 
                        "visit"
                    ]
                },
                "company",
                "visit",
                "visits",
                "samples",
                "labTestCompletedBy"
            ]
        };




        if (req.param('download') == 'true')
            res.setHeader('Content-disposition', 'attachment; filename=' + req.param('orderId') + '.pdf');
            templateName = req.param('lang') == 'vi' ? 'medical-report-3-vi' : 'medical-report-3' + (req.param('sub') || ''); console.log(templateName); 
        pdfHandler.generateFromTemplate(templateName, filter, 'order', res, req, pdfHandler.writeResponse);

    });
    
    app.get('/api/medical-report-test-1', function (req, res) {

        var filter = {
            "where": {
                "or": [{ "id": req.param('orderId') }, { "refOrderId": req.param('orderId') }]
            },
            "include": [
                "patient",
                {
                    "orderItems": [
                        "service",
                        {
                            "test": "group"
                        },
                        "excuteBy",
                        "visit"
                    ]
                },
                "company",
                "visit",
                "visits",
                "samples",
                "labTestCompletedBy"
            ]
        };


        if (req.param('download') == 'true')
            res.setHeader('Content-disposition', 'attachment; filename=' + req.param('orderId') + '.pdf');
            templateName = req.param('lang') == 'vi' ? 'medical-report-3-vi' : 'medical-report-3' + (req.param('sub') || ''); console.log(templateName);
        pdfHandler.generateFromTemplate(templateName, filter, 'order', res, req, pdfHandler.writeResponse);

    });

    // to be removed
    app.get('/api/medical-report-test-obsoleted', function (req, res) {
        var filter = {
            "where": {
                "or": [{ "id": req.param('orderId') }, { "refOrderId": req.param('orderId') }]
            },
            "include": [
                "patient",
                {
                    "orderItems": [
                        "service",
                        {
                            "test": "group"
                        },
                        "excuteBy"
                    ]
                }
            ]
        };


        if (req.param('download') == 'true')
            res.setHeader('Content-disposition', 'attachment; filename=' + req.param('orderId') + '.pdf');

        pdfHandler.generateFromTemplate(req.param('lang') == 'vi' ? 'medical-report-3-vi' : 'medical-report-4', filter, 'order', res, req,
            pdfHandler.writeResponse);

    });

    app.get('/api/medical-report/send', function (req, res) {
        var Order = app.models.order;

        Order.findOne({
            where: {
                id: req.param('orderId')
            },
            include: ['patient']
        }, function (error, order) {

            if (req.param('byPost')) {
                order.updateAttributes({
                    reportDeliveriedByPostAt: new Date()
                }, function (err, result) {
                    if (err) {
                        console.log('Could not update delivery date')
                    }
                })
                successHandler(res, { success: true });

            } else {

                console.log("sending post email .. ");

                var patient = (typeof order.patient === "function") ? order.patient() : order.patient;
                var path = require('path');
                var mime = require('mime');

                var pdfFileName = req.param('orderId') + '.pdf';
                var protectedFileName = pdfFileName.replace(".pdf", "-pwd.pdf");
                var pwd = moment(patient.DOB).format('DDMMYYYY');
                var currentFolder = "/var/www/vhms/api/images/report/";

                var exec = require('child_process').exec;
                var cmd = 'cd /var/www/vhms/api/images/report;wget "http://localhost/api/medical-report?' +
                    (req.param('lang') && ('lang=' + req.param('lang') + '&') || '') + 'orderId=' + req.param('orderId') +
                    '" -O ' + pdfFileName;

                console.log('cmd ', cmd)
                var paramLang = req.param('lang');

                cmd += ';pdftk ' + pdfFileName + ' output ' + protectedFileName + ' owner_pw ' + pwd + 'o' + ' user_pw ' + pwd + ' allow printing';
                console.log(cmd)
                exec(cmd, function (error, stdout, stderr) {

                    if (!fs.existsSync(currentFolder + pdfFileName)) {
                        errorHandler(res, { message: "Could not genrate the report" });
                        return
                    }

                    var file = path.resolve('./../images/report/' + protectedFileName);
                    console.log('complete generating pdf ', file);
                    var fileStream = fs.createReadStream(file);
                    var fileStat = fs.statSync(file);
                    var attachment = {
                        data: fileStream,
                        filename: path.basename(file),
                        knownLength: fileStat.size,
                        contentType: mime.lookup(file)//REQUIRED, by omitting this, mailgun will not send your attachment
                    };

                    attachment = {
                        filename: path.basename(file),
                        path: file
                    };
                    

                    emailHandler.sendEmail({
                        email: patient.email,
                        patient: patient,
                        attachments: [attachment],
                        mailGunIsPrefferred: false && (!order.deliveryStatus || order.deliveryStatus != 'failed') && patient.email.indexOf('yahoo.com') == -1
                    },

                        'email-medical-report', function (err, mail) {
                            console.log("Response: ", err, mail);

                            if (err) {
                                res.errMsg = "Could not genrate the report";
                                errorHandler(res, { message: "Could not genrate the report" });
                            } else {
                                if (!paramLang) paramLang = 'en';

                                if (!order.reportDeliveriedInLangs)
                                    order.reportDeliveriedInLangs = [];

                                if (order.reportDeliveriedInLangs.indexOf(paramLang) == -1) {
                                    order.reportDeliveriedInLangs.push(paramLang);

                                    if (order.reportDeliveriedInLangs.length == 2) {
                                        // workaround for filter all
                                        order.reportDeliveriedInLangs.push('all');
                                    }
                                }

                                console.log('verified !!!!!!')

                                var updatedAttrs = {
                                    reportDeliveriedAt: new Date(),
                                    reportDelivered: true,
                                    reportDeliveriedInLangs: order.reportDeliveriedInLangs
                                };

                                if (mail.id) {
                                    // mailgun id
                                    updatedAttrs.mailGunId = mail.id.replace('>', '').replace('<', '');
                                } else {
                                    updatedAttrs.deliveryStatus = 'delivered';
                                }

                                if (mail.id) {
                                    // mailgun id
                                    updatedAttrs.mailGunId = mail.id.replace('>', '').replace('<', '');
                                    updatedAttrs.lastMedicalDeliverySendLink = req.originalUrl;
                                }

                                order.updateAttributes(updatedAttrs, function (err, result) {
                                    if (err) {
                                        console.log('Could not update delivery date')
                                    }
                                })
                                successHandler(res, { success: true });
                            }
                        });

                }, function (err) {
                    console.log('error when creating report ', err);
                });
            }

            /*
	    var file = path.resolve('./images/image.jpg');
	    var fileStream = fs.createReadStream(file);
	    var fileStat = fs.statSync(file);
	    var attachment = {
	      	data: fileStream,
		filename: path.basename(file),
	        knownLength: fileStat.size,
	        contentType: mime.lookup(file)//REQUIRED, by omitting this, mailgun will not send your attachment
	    };

            emailHandler.sendEmail({email: patient.email, 
			attachments: [attachment]}, 
			'email-medical-report', function (email_res) {
                console.log("Response: ", email_res);
                successHandler(res, {success: true});
            });
            */
        });
    });

    app.get('/api/barcode', function (req, res) {

        var barcode = require('barcode');
        var code39 = barcode('code128', {
            data: req.param('code') || '12121',
            width: 400,
            height: 100,
        });

        code39.getStream(function (err, readStream) {
            if (err) throw err;

            readStream.pipe(res);
        });
    });

    app.get('/api/search-keyword', function (req, res) {
        var keyword = req.param('keyword').toLowerCase();
        console.log("Keyword: ", keyword);
        var modelName = req.param('model');
        var query = JSON.parse(req.param('query'));
        var Model = app.models[modelName];

        if (!modelName) {
            errorHandler(res, { errmsg: "Missing model" });
            return;
        }

        if (!keyword) {
            errorHandler(res, { errmsg: "Missing keyword" });
            return;
        }

        var searchQuery = [
            {
                or: [
                    { searchKeywords: { inq: [keyword] } },
                    { searchKeywords: keyword }
                ]
            },
            {
                and: [
                    { searchCode: { gte: keyword } },
                    { searchCode: { lte: keyword + 'z' } }
                ]
            },
            {
                and: [
                    { searchWithoutDiacritics: { gte: keyword } },
                    { searchWithoutDiacritics: { lte: keyword + 'z' } }
                ]
            },
            {
                and: [
                    { searchEnglishName: { gte: keyword } },
                    { searchEnglishName: { lte: keyword + 'z' } }
                ]
            },
            {
                and: [
                    { searchName: { gte: keyword } },
                    { searchName: { lte: keyword + 'z' } }
                ]
            },
            {
                and: [
                    { barcode: { gte: keyword } },
                    { barcode: { lte: keyword + 'z' } }
                ]
            },
            {
                and: [
                    { phoneNumber: { gte: keyword } },
                    { phoneNumber: { lte: keyword + 'z' } }
                ]
            },
            {
                and: [
                    { name: { gte: keyword } },
                    { name: { lte: keyword + 'z' } }
                ]
            },
        ];


        if (query) {
            if (query.filter) {
                query = query.filter;
            }
            if (query.where) {
                if (query.where['or']) {
                    for (var i = 0; i <= searchQuery.length; i++) {
                        query.where['or'] = _.uniq(query.where['or'].push(searchQuery(i)));
                    }
                } else {
                    query.where['or'] = searchQuery
                }
            } else {
                query.where = { or: searchQuery };
            }
        } else {
            query = {
                where: {
                    or: searchQuery
                }
            }
        }
        query.where['removed'] = { neq: true };

        query.limit = 15;

        console.log("query: ", JSON.stringify(query));

        Model.find(query).then(function (result) {
            successHandler(res, result);
        }, function (error) {
            errorHandler(res, error);
        });
    });

    // API for out web
    app.get('/api/get-clinics', function (req, res) {
        var type = req.param('type');
        if (!type) {
            errorHandler(res, { errmsg: "Mising type." });
            return;
        }

        utils.getDataByQuery("clinic", {
            where: {
                type: type
            },
            fields: {
                name: 1,
                id: 1,
                type: 1,
                address: 1,
                website: 1,
                tuyenCS: 1,
                phoneNumber: 1,
                urlImages: 1
            }
        }).then(function (result) {
            successHandler(res, result);
        }, function (error) {
            errorHandler(res, error);
        })
    });

    app.get('/api/get-users-by-clinic', function (req, res) {
        var role = req.param('role');
        var clinicId = req.param('clinicId');

        console.log(role, ',', clinicId);

        if (!role) {
            errorHandler(res, { errmsg: "Missing role" });
            return;
        }

        if (!clinicId && clinicId != "") {
            errorHandler(res, { errmsg: "Missing clinic id" });
            return;
        }

        utils.getDataByQuery('Role', {
            where: {
                name: { inq: [role, role.toLowerCase()] }
            },
            include: ["principals"]
        }).then(function (roles) {
            var doctorIds = _.map(roles[0].principals(), function (rm) {
                return rm.principalId;
            });

            utils.getDataByQuery('user', {
                where: {
                    id: { inq: doctorIds },
                    clinicId: clinicId
                },
                fields: {
                    firstName: 1,
                    lastName: 1,
                    fullName: 1,
                    address: 1,
                    id: 1,
                    gender: 1
                }
            }).then(function (result) {
                successHandler(res, result);
            }, function (error) {
                errorHandler(res, error);
            });
        }, function (error) {
            errorHandler(res, error);
        });
    });

    app.get('/api/user/dashboard', function (req, res) {
        // will return a dictonary of common related models
        /*
            1. get all task assign to this user
            2. get all notification for this user
            3. get all appointment for this user
            4. get all order for this user
            5. get all invoice for this user
         */
        // get current user from the context 
        var userId = req.accessToken.userId;
        
        // get all task assign to this user 
        var Task = app.models.task;
        
    });

    app.get('/api/index', function (req, res) {

        var domain = req.headers.host;
        console.log("Domain: ", domain);

        var AccessToken = app.models.AccessToken;

        var userId = req.accessToken && req.accessToken.userId;

        console.log('index user ... ', req.accessToken);

        //  get the access_token from the request sync
        AccessToken.findForRequest(req, {}, function (aux, accesstoken) {

            console.log('index user ... ', accesstoken);
        });

    

        var Clinic = app.models.clinic;
        Clinic.findOne({
            where: {
                domain: domain.toLowerCase()
            },
            include: ['settings']
        }, function (error, c) {
            if (domain.indexOf('localhost') < 0 && domain.indexOf('register') < 0 && domain.indexOf('dangky') < 0) {
                if (error) {
                    console.log(error);
                    res.send('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Vui long thử lại sau.</h1></body>\'');
                    return;
                }

                if (!c) {
                    res.send('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Cty không tìm thấy trong hệ thống.</h1></body>\'');
                    return;
                }
            }


            if (!userId) {
                res.send("window.gcfg = " + JSON.stringify({}));
                return;
            }


            var User = app.models.user;

            User.findById(userId, {
                include: ["clinic"]
            }, function (error, u) {
                if (error) {
                    errorHandler(res, error);
                    return;
                }

                var RoleMapping = app.models.RoleMapping;
                var Role = app.models.Role;
                RoleMapping.find({ where: { principalId: userId } }, function (err, roleMappings) {
                    var roleIds = _.uniq(roleMappings
                        .map(function (roleMapping) {
                            return roleMapping.roleId;
                        }));

                    var conditions = roleIds.map(function (roleId) {
                        return { id: roleId };
                    });

                    Role.find({ where: { or: conditions } }, function (err, roles) {

                        if (u) {
                            var clinic = u.clinic();
                            u['roles'] = roles;
                            var result = {
                                curUser: u,
                                curClinic: c
                            }

                            console.log('roles ', u);

                            res.send("window.gcfg = " + JSON.stringify(result) + "; window.gcfg.curUser.roles = " + JSON.stringify(roles));
                        } else {
                            res.send("window.gcfg = {}");
                        }
                    });
                });



            });
        })

        // })

    });

    app.get('/api/get-services', function (req, res) {
        var clinicId = req.param('clinicId');
        utils.getDataByQuery('servicePackage', {
            where: {
                clinicId: clinicId,
                isActive: true
            }
        }).then(function (packages) {
            var packageToServiceDic = {};
            var packageDic = {};
            var serviceIds = [];

            _.each(packages, function (p) {
                packageToServiceDic[p.id] = p.services;
                packageDic[p.id] = p;
                serviceIds = serviceIds.concat(p.services);
            });

            serviceIds = _.uniq(serviceIds);

            utils.getDataByQuery('service', {
                where: {
                    id: { inq: serviceIds }
                },
                include: [
                    {
                        relation: "type",
                        scope: {
                            fields: {
                                name: 1
                            }
                        }
                    }
                ],
                fields: {
                    typeId: 1,
                    name: 1,
                    id: 1
                }
            }).then(function (services) {
                _.each(packages, function (p) {
                    var svcIds = packageToServiceDic[p.id];
                    var serviceList = _.filter(services, function (s) {
                        return svcIds.indexOf(s.id.toString()) > -1;
                    });
                    p.serviceList = serviceList;
                });

                successHandler(res, packages);
            }, function (error) {
                errorHandler(res, error);
            });

        }, function (error) {
            errorHandler(res, error);
        })
    });

    app.get('/api/get-insurance-package', function (req, res) {
        var companyId = req.param("companyId");

        if (!companyId) {
            errorHandler(res, { errmsg: "Missing company id!" });
            return;
        }

        var query = {
            where: {
                insuranceCompanyId: companyId,
                isActive: true,
                isPublic: true
            },
            fields: {
                content: 1,
                name: 1,
                price: 1,
                validFrom: 1,
                validTo: 1
            }
        };

        utils.getDataByQuery('insurancePackage', query).then(function (result) {
            successHandler(res, result);
        }, function (error) {
            errorHandler(res, error);
        })
    });

    app.get('/api/get-insurance-company', function (req, res) {
        var query = {
            where: {
                status: "Đã Xác Nhận"
            },
            fields: {
                name: 1
            }
        }

        utils.getDataByQuery('insuranceCompany', query).then(function (result) {
            successHandler(res, result);
        }, function (error) {
            errorHandler(res, error);
        })
    });

    app.get('/api/initFakePatient', function (req, res) {
        utils.initFakeData();
        successHandler(res, "HEHE");
    });

    app.get('/api/initCSKCB', function (req, res) {
        utils.initCSKCB();
        successHandler(res, "CSKCB");
    });

    app.get('/api/initFakeUser', function (req, res) {
        utils.initFakeUser();
        successHandler(res, "HEHE");
    });
    app.get('/api/report-company/check-upReport', reportCompany.checkUpReport);

    app.get('/api/report-company/check-upStatus', reportCompany.checkUpStatus);

    app.get('/api/report-company/check-upStatus/labTestOnly', reportCompany.checkUpStatusLabTestOnly);

    app.get('/api/a-test', function (req, res) {
        // using Q promise with all: 1. get not-found template name by redisClient 2. get template from Template model by name 'test'
        var Q = require('q');
        var redisClient = require('../server').redisClient;
        var templateName = 'test';
        var notFoundTemplate = 'not-found';

        Q.all([
            Q.ninvoke(redisClient, 'get', 'not-found-template'),
            app.models.Template.findOne({ where: { name: templateName } })
        ]).then(function (results) {
            var notFoundTemplate = results[0];
            var template = results[1];

            if (!template) {
                template = { name: notFoundTemplate };
            }

            console.log('test results', results.map(function (r) { return r && r.name; }));

            res.send(template);
        });
        
    });

    var sendVerifyEmail = function (p, cb) {
        var host = "http://doctornex.com";
        //var host = "http://localhost:8000"
        var data = {
            email: p.email,
            fullName: p.fullName,
            link: host + "/verify-account/" + p.verifyCode
        }
        emailHandler.sendEmail(data, emailHandler.EMAIL_TEMPLATES.VERIFY_ACCOUNT, cb);
    };

    app.get('/api/proceed-expired-contract', function (req, res) {
        var contract = app.models.contract;
        var order = app.models.order;
        contract.find({
            where: {
                expireDate: {
                    lte: moment().add(-1, 'days').toISOString()
                },
                isExpired: {ne: true}
            },
            limit: 4
        }, (err, _rContracts) => {
            var noContracts = 0;
            var noOrders = 0;

            if (_rContracts.length == 0) {
                res.send({rOrders: 0, contract: _rContracts, err: err});
            }

            _.forEach(_rContracts, (_rContract) => {
                var rContract = JSON.parse(JSON.stringify(_rContract));
                order.find({
                    where: {
                        packageId: {
                            inq: _.map(rContract.packages, (po) => {return po && po.id})
                        },
                        isComplete: {ne: true},
                        isExpired: {ne: true},
                        isRemoved: {ne: true}
                    },
                    limit: 100
                }, (err, rOrders) => {
                    noContracts++;
                    noOrders += rOrders.length;

                    if (noContracts == _rContracts.length)
                        res.send({rOrders: noOrders, contract: rContract, err: err});
                    if (rOrders && rOrders.length > 0) {
                        _.forEach(rOrders, (o) => {
                            o.updateAttributes({isExpired: true})
                        })
           
                    } else {
                        // mark this contract as expired 
                        _rContract.updateAttributes({isExpired: true})
    
                    }
                    
                });
                // find all packages 
            })
            
           
           
        })
    });

    var sendVerifyCode = function (p, cb) {
        var content = "Ma xac nhan: " + p.verifyCode;
        emailHandler.sendEmailWithoutTemplate(p.email, "Forgot password", content, cb);
    }

    var sendVerifySms = function (p, cb) {
        var content = "Ma xac nhan: " + p.verifyCode;
        smsHandler.sendSms(p.phoneNumber, content, cb);
    }

    var successHandler = function (res, data) {
        res.send({ isSuccess: true, result: data, errMsg: "" });
    };

    var errorHandler = function (res, error) {
        res.send({ isSuccess: false, result: null, errMsg: error.errmsg || '' });
    };

    var generateVerifyCode = function () {
        var result = "";
        result += "000" + Math.floor((Math.random() * 1000));
        return result.slice(-4);
    }




};
