const { race } = require('bluebird');
const aiQueue = require('../utils/ai-queue.js');

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
    var warehouseOrder = require('../../server/boot/warehouse.order.bl.js')
    var Q = require('q');
    var Parse = require('parse/node');
    let inventory = require('./inventory');
    var aiHandler = require("./ai");
    var i18n = require('./i18n');

    var redis = require("redis");
    redisClient = redis.createClient();

    const axios = require('axios');
    const FormData = require('form-data');

    const fallbackFacebookPageToken =
        process.env.FACEBOOK_PAGE_ACCESS_TOKEN ||
        process.env.FB_PAGE_ACCESS_TOKEN ||
        'EAAIm6RUqMtoBPzDEXnDRXZA8njBnJsax311jMirNW4Rqon4PjTTOMtwRY5dOuV5i48DZBZCLlvWER1GNVyKZCPz96BR2ZAZBmhMXBzbbgGiez1h4ZBHbku2UnEpEEKvNpPZAVN5zpZAg9fVNbSW6Ud4STC3JGmRYsLLEHqhqZBN03S0HPQttnUwstYrU7eZBLmemkHAww7z';

    const resolveClinicFacebookPage = async ({ clinicId, pageId }) => {
        const Clinic = app.models.Clinic;
        let clinic = null;

        if (clinicId) {
            clinic = await Clinic.findById(clinicId);
        } else if (pageId) {
            clinic = await Clinic.findOne({ where: { 'facebookPages.pageId': pageId } });
        }

        if (!clinic || !Array.isArray(clinic.facebookPages)) {
            return null;
        }

        let pageMeta = null;
        if (pageId) {
            pageMeta = clinic.facebookPages.find((page) => page.pageId === pageId);
        } else {
            pageMeta = clinic.facebookPages.find((page) => !!page.pageToken) || clinic.facebookPages[0];
        }

        if (!pageMeta?.pageToken) {
            return null;
        }

        return { clinic, pageMeta };
    };

    app.use(loopback.token());

    /**
     * Middleware: Lưu language preference vào cookie
     */
    app.use(function (req, res, next) {
        const langFromQuery = req.query.lang;

        if (langFromQuery && ['vi', 'en', 'ja', 'ko', 'zh'].includes(langFromQuery)) {
            res.cookie('lang', langFromQuery, {
                maxAge: 365 * 24 * 60 * 60 * 1000, // 1 năm
                httpOnly: false,
                path: '/',
                sameSite: 'lax'
            });
        }

        next();
    });

    // Generic bulk import helper for models
    app.bulkImportGeneric = async function bulkImportGeneric(Model, input, opts) {
        const options = Object.assign({
            wrapperKeys: [],
            maxBatchSize: 1000,
            chunkSize: 50,
            interChunkDelayMs: 100,
            normalizeInput: null,
            dedupeAndPrepare: null,
            buildLookups: async () => ({}),
            processRow: null,
            findExisting: null,
            onCreate: async (data) => Model.create(data),
            onUpdate: async (existing, data) => existing.updateAttributes(data)
        }, opts || {});

        // Normalize input to array
        const normalizeInputToArray = (src) => {
            console.log('src ', src);
            if (typeof options.normalizeInput === 'function') return options.normalizeInput(src);
            if (!src) return [];
            if (Array.isArray(src)) {
                if (src.length === 1 && src[0] && typeof src[0] === 'object') {
                    for (const key of options.wrapperKeys) {
                        if (Array.isArray(src[0][key])) return src[0][key];
                    }
                }
                return src;
            }
            if (typeof src === 'object') {
                for (const key of options.wrapperKeys) {
                    if (Array.isArray(src[key])) return src[key];
                }
            }
            return [];
        };

        const rows = normalizeInputToArray(input);
        console.log('rows ', rows);
        if (!rows.length) {
            const error = new Error("Input must be a non-empty array or a wrapper containing records.");
            error.statusCode = 400;
            throw error;
        }
        if (rows.length > options.maxBatchSize) {
            const error = new Error(`Batch size too large. Maximum allowed: ${options.maxBatchSize}, received: ${rows.length}`);
            error.statusCode = 400;
            throw error;
        }

        const uniqueData = new Map();
        const preprocessErrors = [];
        rows.forEach((row, index) => {
            try {
                const r = options.dedupeAndPrepare ? options.dedupeAndPrepare(row, index) : null;
                if (!r || !r.key) {
                    preprocessErrors.push({ row: index + 1, error: (r && r.error) || 'Invalid row', data: row });
                    return;
                }
                uniqueData.set(r.key, Object.assign({}, row, r.prepared || {}, { originalIndex: index + 1 }));
            } catch (e) {
                preprocessErrors.push({ row: index + 1, error: e.message, data: row });
            }
        });

        const deduped = Array.from(uniqueData.values());

        try {
            const lookups = await (options.buildLookups ? options.buildLookups(deduped) : {});

            // Chunking
            const chunks = [];
            for (let i = 0; i < deduped.length; i += options.chunkSize) chunks.push(deduped.slice(i, i + options.chunkSize));

            const allResults = [];
            for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                const promises = chunk.map(async row => {
                    try {
                        if (!options.processRow || !options.findExisting) throw new Error('Missing processRow/findExisting');
                        const data = await options.processRow(row, lookups);
                        let existing = await options.findExisting(Model, data, lookups);
                        if (existing) {
                            const { createdAt, ...payload } = data;
                            const updated = await options.onUpdate(existing, payload);
                            return { status: 'updated', row: row.originalIndex, data: updated, id: updated.id };
                        }
                        const created = await options.onCreate(data);
                        return { status: 'created', row: row.originalIndex, data: created, id: created.id };
                    } catch (error) {
                        return { status: 'failed', row: row.originalIndex, error: error.message, originalData: row };
                    }
                });

                const results = await Promise.all(promises);
                allResults.push(...results);
                if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, options.interChunkDelayMs));
            }

            // Build summary
            const summary = {
                totalRecordsReceived: rows.length,
                uniqueRecordsProcessed: deduped.length,
                successfulCreates: 0,
                successfulUpdates: 0,
                failedImports: 0,
                processingTime: Date.now(),
                successes: [],
                errors: [],
                performance: {
                    chunksProcessed: chunks.length,
                    averageChunkTime: 0
                }
            };

            preprocessErrors.forEach(err => {
                summary.failedImports++;
                summary.errors.push({ row: err.row, error: err.error, data: err.data });
            });

            allResults.forEach(result => {
                if (result.status === 'created') {
                    summary.successfulCreates++;
                    summary.successes.push({ row: result.row, status: 'CREATED', id: result.id, name: result.data.name });
                } else if (result.status === 'updated') {
                    summary.successfulUpdates++;
                    summary.successes.push({ row: result.row, status: 'UPDATED', id: result.id, name: result.data.name });
                } else {
                    summary.failedImports++;
                    summary.errors.push({ row: result.row, error: result.error, data: result.originalData });
                }
            });

            const totalProcessed = summary.successfulCreates + summary.successfulUpdates + summary.failedImports;
            summary.successRate = totalProcessed > 0 ? (((summary.successfulCreates + summary.successfulUpdates) / totalProcessed) * 100).toFixed(2) + '%' : '0%';

            return summary;
        } catch (e) {
            throw e;
        }
    };

    // Common bulk import POST endpoint
    app.post('/api/bulk-import-json', async function (req, res) {
        try {
            const modelName = req.body && (req.body.model || req.query.model);
            if (!modelName) {
                return res.status(400).send({ error: 'Missing model' });
            }
            const Model = app.models[modelName];
            if (!Model) {
                return res.status(400).send({ error: `Model not found: ${modelName}` });
            }

            let options;

            // If model has getBulkImportConfig, use it
            if (typeof Model.getBulkImportConfig === 'function') {
                options = Model.getBulkImportConfig(app);
            } else {
                // Default configuration for models without getBulkImportConfig
                console.log(`Model ${modelName} does not have getBulkImportConfig, using default configuration`);
                options = {
                    wrapperKeys: [modelName.toLowerCase() + 's'], // e.g., 'products' for Product model
                    maxBatchSize: 1000,
                    chunkSize: 50,
                    dedupeAndPrepare: (row, index) => {
                        // Try to find a name field or use the first non-empty field as key
                        const nameField = row.name || row.Name || row.title || row.Title || row.id || row.Id || String(index);
                        return {
                            key: `row:${index}`,
                            prepared: { _resolvedData: row }
                        };
                    },
                    buildLookups: async (deduped) => {
                        // No lookups needed for basic import
                        return {};
                    },
                    processRow: async (row, lookups) => {
                        // Return the row data as-is, letting the model handle validation
                        return {
                            ...row._resolvedData,
                            updatedAt: new Date(),
                            createdAt: new Date()
                        };
                    },
                    findExisting: async (Model, data) => {
                        // Try to find existing record by common fields
                        if (data.id) {
                            return await Model.findById(data.id);
                        }
                        if (data.name) {
                            return await Model.findOne({ where: { name: data.name } });
                        }
                        if (data.slug) {
                            return await Model.findOne({ where: { slug: data.slug } });
                        }
                        return null;
                    }
                };
            }

            // Allow either body.data or the entire body (wrapperKeys will handle extraction)
            const payload = Object.prototype.hasOwnProperty.call(req.body, 'data') ? req.body.data : req.body;
            const summary = await app.bulkImportGeneric(Model, payload, options);
            res.send(summary);
        } catch (e) {
            console.error('Bulk import error:', e);
            res.status(500).send({ error: e.message });
        }
    });

    app.post('/api/inventory/import', inventory.importInventory)
    app.post('/api/inventory/export', inventory.exportInventory)
    app.post('/api/inventory/getWarehouesItemsQty', inventory.getWarehouesItemsQty)

    //var expressWs = require('express-ws')(app);


    app.get('/thanh/t', function (req, res) {
        return res.send('hello');
    });

    app.get('/api/combine', function (req, res, next) {
        var queries = req.query.queries ? JSON.parse(req.query.queries) : [];

        if (!Array.isArray(queries) || queries.length === 0) {
            return res.status(400).send({ error: 'Invalid queries parameter' });
        }

        var queryPromises = queries.map(query => {
            var modelName = query.model;
            var filter = query.filter || {};
            var Model = app.models[modelName];

            if (!Model) {
                return Promise.reject(new Error('Model not found: ' + modelName));
            }

            return Model.find(filter).then(results => ({
                modelName: modelName,
                results: results
            }));
        });

        Promise.all(queryPromises)
            .then(queryResults => {
                var result = {};
                queryResults.forEach(qr => {
                    result[qr.modelName] = qr.results;
                });

                result.EventCity = [
                    {
                        "name": "Hồ Chí Minh",
                        "slug": "ho-chi-minh"
                    },
                    {
                        "name": "Hà Nội",
                        "slug": "ha-noi"
                    },
                    {
                        "name": "Đà Nẵng",
                        "slug": "da-nang"
                    }];

                result.ScholarshipValue = [
                    {
                        "name": "Dưới 10%",
                        "id": "Dưới 10%"
                    },
                    {
                        "name": "10 - 25%",
                        "id": "10 - 25%"
                    },
                    {
                        "name": "25 - 50%",
                        "id": "25 - 50%"
                    },
                    {
                        "name": "Trên 50%",
                        "id": "Trên 50%"
                    }
                ];

                result.EventType = [
                    {
                        "name": "online",
                        "slug": "online"
                    },
                    {
                        "name": "offline",
                        "slug": "offline"
                    }
                ];
                res.json(result);
            })
            .catch(err => {
                next(err);
            });
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
                        if (_results && _results.length) console.log("RESULT!! " + _results.length); complete();
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
            subject: 'Hello', messageId: function () { },
            text: 'Testing some Mailgun awesomeness!'
        };
        //emailHandler.sendEmailWithoutTemplate("thanh.nguyenvan@gmail.com", "Forgot password", "test", function() {res.send({})} );
        //loopback.Email.send(data).then(function(response){console.log(response)})
        //.catch(function(err){ console.log(err); res.send({}); });
        var ll = 0;
        var Sample = app.models.Sample;
        var ids = ["2024846310", "2026103601", "2026103602", "2026103604", "2026103609", "2024585401", "2024585402", "2024585404", "2024585409", "2026103702", "2026103704", "2026103709", "2025431701", "2025431702", "2025431704", "2025431709", "2025634101", "2025634102", "2025634104", "2025634109", "2025363101", "2025363102", "2025363104", "2025363109", "2025363112", "2025338801", "2025338802", "2025338809", "2026103301", "2026103302", "2026103304", "2026103309", "2026103312", "2025619701", "2025619702", "2025619704", "2025619709", "2026103401", "2026103402", "2026103404", "2026103409", "2025619902", "2025619909", "2025617701", "2025617702", "2025617704", "2025617709", "2025617601", "2025617602", "2025617604", "2025617609", "2025339301", "2025339302", "2025339309", "2025338301", "2025338302", "2025338309", "2025333909", "2025635701", "2025635702", "2025635704", "2025635709", "2023479901", "2023479902", "2023479904", "2023479909", "2025636601", "2025636602", "2025636604", "2025380401", "2025380402", "2025380409", "2025617501", "2025617502", "2025617504", "2025617509", "2025433501", "2025433502", "2025433504", "2025433509", "2024890802", "2024890804", "2024890809", "2025639501", "2025639502", "2025639504", "2025639509", "2026105201", "2026105202", "2026105204", "2026105209", "2025617112", "2026104709", "2026105301"];
        ids = ["2025438113", "2025634313", "2025639613", "2025438213", "2023482013", "2025634315", "2025617215", "2025469111"];
        Sample.find({
            where: { sampleId: { "in": ids } }
        }).
            then(function (samples) {
                _.forEach(samples, (sample) => { sample.updateAttributes({ receivedAt: new Date('2020-07-25T09:50:24.256+00:00'), collectedAt: new Date('2020-07-25T08:50:24.256+00:00') }, function (e, r) { ll++; if (ll == 94) res.send({ len: samples.length }); }) })
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
                var pes = _.filter(order.orderItems, (oi) => { return oi.serviceId == "580479d743a45dd7621b52ea" });

                var gynPackages = ["5ab2229a81ea797f5385ed74", "5a69a6e4362db0896e18e761", "5a69a78b74d8ddb16eb50f1c"];
                if (pes.length == 0) {
                    // Gyn packages
                    pes = _.filter(order.orderItems, (oi) => {
                        return oi.testId == "58a6e0274b3562050ec3cbc1" ||
                            oi.testId == "5a08f19e40da73b10fcb596d" ||
                            oi.testId == "5a3a17632e3715d33c9deba5"
                    }
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
                        updatedAttrs.completeDate = pes[0].updatedAt;
                    }
                }

                if (updatedAttrs.completeDate || updatedAttrs.checkUpDate) {
                    _order.updateAttributes(updatedAttrs);
                    console.log(updatedAttrs);
                }
            })

            res.send({ count: orders.length });
        }, (e) => {
            res.send({ e: e.toString() });
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

    app.get('api/export-item', function (req, res) {
        warehouseOrder.exportItems(req, res);
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



    app.post('/api/zalo', async function (req, res) {
        try {
            console.log("Zalo webhook received");
            console.log("Query:", req.query);
            console.log("Body:", JSON.stringify(req.body, null, 2));

            // ===== DOMAIN VALIDATION - Fix race condition =====
            const domain = req.headers.host.toLowerCase().split('.')[0];
            const Clinic = app.models.Clinic;

            // Tìm clinic theo domain
            let clinic = await Clinic.findOne({
                where: { shortName: domain }
            });

            if (!clinic) {
                console.warn(`[Zalo] Clinic not found for domain: ${domain}`);
                return successHandler(res, "Webhook received but clinic not found - ignored");
            }

            console.log(`[Zalo] Processing webhook for clinic: ${clinic.shortName} (${clinic.name}), domain: ${domain}`);
            // ===== END DOMAIN VALIDATION =====

            const requestData = req.method === 'POST' ? req.body : req.query;

            // Handle webhook verification (GET request)
            if (req.method === 'GET' && req.query.verify_token) {
                // Zalo webhook verification
                const verifyToken = req.query.verify_token;
                // You should compare this with your configured verify token
                // For now, just return the challenge
                return res.status(200).send(req.query.challenge || '');
            }

            // Extract event type and data
            // Zalo sends event_name, but also check event and type for backward compatibility
            const event = requestData.event_name || requestData.event || requestData.type;
            const sender = requestData.sender || {};
            const recipient = requestData.recipient || {};
            const message = requestData.message || {};
            const timestamp = requestData.timestamp || Date.now();

            // Validate app_id from webhook matches configured app_id
            const Setting = app.models.Setting;
            const appIdDoc = await Setting.findOne({ where: { key: 'zalo_app_id' } });
            const configuredAppId = appIdDoc?.val;

            console.log('App ID validation:', {
                received: requestData.app_id,
                configured: configuredAppId,
                hasReceived: !!requestData.app_id,
                hasConfigured: !!configuredAppId
            });

            if (requestData.app_id && configuredAppId) {
                if (String(requestData.app_id) !== String(configuredAppId)) {
                    console.warn('Webhook app_id mismatch:', {
                        received: requestData.app_id,
                        configured: configuredAppId
                    });
                    console.log('Skipping webhook processing - app_id does not match configured app_id');
                    return successHandler(res, "Webhook received but app_id mismatch - ignored");
                } else {
                    console.log('App ID validation passed:', requestData.app_id);
                }
            } else if (requestData.app_id && !configuredAppId) {
                console.warn('Webhook contains app_id but no configured app_id found in Settings');
                console.log('Processing webhook anyway (app_id validation disabled)');
            } else if (!requestData.app_id && configuredAppId) {
                console.warn('Configured app_id exists but webhook does not contain app_id');
                console.log('Processing webhook anyway');
            }

            console.log('Event type:', event);
            console.log('Sender:', sender);
            console.log('Recipient:', recipient);
            console.log('Message:', message);

            // Determine if message is from user or OA admin
            const isFromUser = event && event.startsWith('user_');
            const isFromOA = event && event.startsWith('oa_');
            const isReceived = event && event.includes('received');

            console.log('Event detection:', {
                event: event,
                isFromUser: isFromUser,
                isFromOA: isFromOA,
                isReceived: isReceived
            });

            // Get user ID (sender for user messages, recipient for OA messages)
            const userId = isFromUser ? sender.id : (isFromOA ? recipient.id : sender.id);

            if (!userId) {
                console.warn('No user ID found in webhook data');
                return successHandler(res, "Webhook received but no user ID");
            }

            // Find or create lead - Filter theo clinicId để tránh race condition
            const Lead = app.models.Lead;
            let lead = await Lead.findOne({
                where: {
                    zaloId: userId,
                    clinicShortName: clinic.shortName  // Chỉ tìm lead thuộc clinic này
                }
            });

            // Fetch user details from Zalo API before creating/updating lead
            // Apply for both user messages and OA messages (except received messages)
            let userInfo = null;
            if (!isReceived) {
                try {
                    await refreshZaloTokenIfNeeded();
                    const access_token = await getZaloAccessToken();

                    const userDetailResponse = await axios.get('https://openapi.zalo.me/v3.0/oa/user/detail', {
                        params: { data: JSON.stringify({ user_id: userId }) },
                        headers: {
                            'access_token': access_token,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (userDetailResponse.data && userDetailResponse.data.data) {
                        userInfo = userDetailResponse.data.data;
                    }
                } catch (error) {
                    console.error('Error fetching user details from Zalo API:', error);
                    // Continue with lead creation/update even if user detail fetch fails
                }
            }

            // Create or update lead with user info from Zalo API (best-effort de-dup)
            if (!clinic?.shortName) {
                console.warn('[Zalo] Missing clinicShortName, skip lead creation');
                return successHandler(res, "Webhook received but clinic not resolved - skipped");
            }

            if (!lead) {
                const leadData = {
                    zaloId: userId,
                    clinicShortName: clinic.shortName,
                    fullName: userInfo ? (userInfo.display_name || userInfo.user_alias || 'Zalo User') : 'Zalo user',
                    name: userInfo ? (userInfo.display_name || userInfo.user_alias || 'Zalo User') : 'Zalo user',
                    status: 'new',
                    sourceOfLead: 'Zalo Chat',
                    ...(userInfo?.avatar ? { avatar: userInfo.avatar } : {}),
                    ...(userInfo?.user_id_by_app || userInfo?.user_id ? { phoneNumber: userInfo.user_id_by_app || userInfo.user_id } : {})
                };

                try {
                    lead = await Lead.create(leadData);
                    console.log('Created new lead with user info:', lead.id);
                } catch (e) {
                    // If another concurrent request just created it, fetch the existing one
                    console.warn('Lead create race detected, retrying findOne', e && e.message);
                    lead = await Lead.findOne({
                        where: {
                            zaloId: userId,
                            clinicShortName: clinic.shortName
                        }
                    });
                    if (!lead) throw e;
                }
            } else if (userInfo) {
                const updateData = {};

                if (userInfo.display_name || userInfo.user_alias) {
                    const displayName = userInfo.display_name || userInfo.user_alias || lead.fullName || 'Zalo User';
                    updateData.name = displayName;
                    updateData.fullName = displayName;
                }

                if (userInfo.avatar) {
                    updateData.avatar = userInfo.avatar;
                }

                if (userInfo.user_id_by_app || userInfo.user_id) {
                    updateData.phoneNumber = userInfo.user_id_by_app || userInfo.user_id;
                }

                if (Object.keys(updateData).length > 0) {
                    await lead.updateAttributes(updateData);
                    console.log('Updated lead with user info:', lead.id);
                }
            }

            // Process message based on event type
            const Message = app.models.Message;
            let messageData = {
                leadId: lead.id,
                clinicShortName: clinic.shortName,  // Gán clinicId để filter trong WebSocket
                zaloId: userId,
                message: requestData, // Store full webhook data
                zaloMsgId: message.msg_id || null, // Store msg_id separately for easier duplicate checking
                zaloAppId: requestData.app_id || null, // Store app_id separately for easier duplicate checking
            };

            // Add timestamp if available
            if (timestamp) {
                messageData.timestamp = new Date(timestamp * 1000); // Convert Unix timestamp to Date
            }


            if (event === 'user_send_text' || event === 'oa_send_text') {
                // Text message
                messageData.type = 'text';
                messageData.content = message.text || '';

                if (isFromUser) {
                    // Message from customer - broadcast to all
                    messageData.fromId = lead.id;
                    // toId is not set (undefined) - this allows WebSocket to broadcast to all
                } else if (isFromOA) {
                    // Message from OA admin - send to specific lead
                    messageData.toId = undefined;
                    messageData.toLeadId = lead.id;
                    // fromId is not set (undefined) - indicates message from OA
                }

            } else if (event === 'user_send_image' || event === 'oa_send_image') {
                // Image message
                messageData.type = 'image';

                if (message.attachments && message.attachments.length > 0) {
                    // Handle both 'image' and 'multi_image' types (multi_image is used when OA sends images from other platforms)
                    const imageAttachment = message.attachments.find(att =>
                        att.type === 'image' || att.type === 'multi_image'
                    );
                    if (imageAttachment && imageAttachment.payload) {
                        messageData.content = imageAttachment.payload.url || imageAttachment.payload.token || '';
                        messageData.imageUrl = imageAttachment.payload.url;
                        messageData.imageToken = imageAttachment.payload.token;
                    }
                } else if (message.image) {
                    // Alternative format
                    messageData.content = message.image.url || message.image.token || '';
                    messageData.imageUrl = message.image.url;
                    messageData.imageToken = message.image.token;
                }

                if (isFromUser) {
                    messageData.fromId = lead.id;
                    messageData.toId = undefined; // Explicitly set to allow WebSocket broadcast
                } else if (isFromOA) {
                    messageData.toId = undefined;
                    messageData.toLeadId = lead.id;
                    messageData.fromId = undefined; // Explicitly set to indicate message from OA
                }

            } else if (event === 'user_send_file' || event === 'oa_send_file') {
                // File message
                messageData.type = 'file';

                if (message.attachments && message.attachments.length > 0) {
                    const fileAttachment = message.attachments.find(att => att.type === 'file');
                    if (fileAttachment && fileAttachment.payload) {
                        messageData.content = fileAttachment.payload.name || fileAttachment.payload.url || '';
                        messageData.fileUrl = fileAttachment.payload.url;
                        messageData.fileToken = fileAttachment.payload.token;
                        messageData.fileName = fileAttachment.payload.name;
                        messageData.fileSize = fileAttachment.payload.size;
                    }
                } else if (message.file) {
                    // Alternative format
                    messageData.content = message.file.name || message.file.url || '';
                    messageData.fileUrl = message.file.url;
                    messageData.fileToken = message.file.token;
                    messageData.fileName = message.file.name;
                    messageData.fileSize = message.file.size;
                }

                if (isFromUser) {
                    messageData.fromId = lead.id;
                    messageData.toId = undefined; // Explicitly set to allow WebSocket broadcast
                } else if (isFromOA) {
                    messageData.toId = undefined;
                    messageData.toLeadId = lead.id;
                    messageData.fromId = undefined; // Explicitly set to indicate message from OA
                }

            } else if (event === 'user_received_message' || event === 'oa_received_message') {
                // Received message (confirmation that message was received)
                // Tìm message gốc dựa trên zaloMsgId và đánh dấu isReaded = true
                if (message.msg_id) {
                    try {
                        // Tìm message cũ dựa trên zaloMsgId
                        const existingMessage = await Message.findOne({
                            where: {
                                zaloMsgId: message.msg_id,
                                zaloId: userId
                            }
                        });

                        if (existingMessage) {
                            // Update isReaded = true cho message gốc
                            await existingMessage.updateAttributes({
                                isReaded: true
                            });
                        } else {
                            console.log('Original message not found for zaloMsgId:', message.msg_id);
                        }
                    } catch (error) {
                        console.error('Error updating message read status:', error);
                    }
                }

                // Return success ngay, không tạo message record mới

                return successHandler(res, "Zalo webhook processed successfully");

            } else {
                // Unknown event type or fallback to old format (for backward compatibility)
                // If no event type, check message content to determine type
                if (!event && requestData.message) {
                    if (requestData.message.text) {
                        // Text message from user (old format)
                        messageData.type = 'text';
                        messageData.content = requestData.message.text;
                        messageData.fromId = lead.id;
                        // toId is not set - allows broadcast
                    } else if (requestData.message.image || (requestData.message.attachments && requestData.message.attachments.some(att => att.type === 'image'))) {
                        // Image message - determine fromId/toId based on sender/recipient
                        messageData.type = 'image';
                        if (message.image) {
                            messageData.content = message.image.url || message.image.token || '';
                            messageData.imageUrl = message.image.url;
                            messageData.imageToken = message.image.token;
                        } else if (message.attachments && message.attachments.length > 0) {
                            const imageAttachment = message.attachments.find(att => att.type === 'image');
                            if (imageAttachment && imageAttachment.payload) {
                                messageData.content = imageAttachment.payload.url || imageAttachment.payload.token || '';
                                messageData.imageUrl = imageAttachment.payload.url;
                                messageData.imageToken = imageAttachment.payload.token;
                            }
                        }
                        // Determine fromId/toId: if sender exists, message is from user
                        if (sender && sender.id) {
                            messageData.fromId = lead.id;
                            messageData.toId = undefined;
                        } else if (recipient && recipient.id && !sender.id) {
                            messageData.toId = lead.id;
                            messageData.fromId = undefined;
                        }
                    } else if (requestData.message.file || (requestData.message.attachments && requestData.message.attachments.some(att => att.type === 'file'))) {
                        // File message - determine fromId/toId based on sender/recipient
                        messageData.type = 'file';
                        if (message.file) {
                            messageData.content = message.file.name || message.file.url || '';
                            messageData.fileUrl = message.file.url;
                            messageData.fileToken = message.file.token;
                            messageData.fileName = message.file.name;
                            messageData.fileSize = message.file.size;
                        } else if (message.attachments && message.attachments.length > 0) {
                            const fileAttachment = message.attachments.find(att => att.type === 'file');
                            if (fileAttachment && fileAttachment.payload) {
                                messageData.content = fileAttachment.payload.name || fileAttachment.payload.url || '';
                                messageData.fileUrl = fileAttachment.payload.url;
                                messageData.fileToken = fileAttachment.payload.token;
                                messageData.fileName = fileAttachment.payload.name;
                                messageData.fileSize = fileAttachment.payload.size;
                            }
                        }
                        // Determine fromId/toId: if sender exists, message is from user
                        if (sender && sender.id) {
                            messageData.fromId = lead.id;
                            messageData.toId = undefined;
                        } else if (recipient && recipient.id && !sender.id) {
                            messageData.toId = lead.id;
                            messageData.fromId = undefined;
                        }
                    } else {
                        // Unknown message type - log and store raw data
                        console.warn('Unknown Zalo message type (no event):', JSON.stringify(requestData.message));
                        messageData.type = 'unknown';
                        messageData.content = JSON.stringify(message);
                        // Try to determine fromId/toId based on sender/recipient
                        if (sender && sender.id) {
                            messageData.fromId = lead.id;
                        } else if (recipient && recipient.id) {
                            messageData.toId = lead.id;
                        }
                    }
                } else {
                    // Unknown event type - log and store raw data
                    console.warn('Unknown Zalo event type:', event);
                    messageData.type = event || 'unknown';
                    messageData.content = JSON.stringify(message);
                    messageData.fromId = isFromUser ? lead.id : undefined;
                    messageData.toId = isFromOA ? lead.id : undefined;
                }
            }

            // Log messageData before creating

            // Check for duplicate message using app_id + msg_id + zaloId + clinicId to prevent duplicate websocket broadcasts
            // This ensures only one message is created per app_id + msg_id + zaloId + clinicId combination
            if (message.msg_id && requestData.app_id) {


                // Try to find existing message by zaloMsgId first (new field) - thêm clinicId vào check
                let existingMessage = await Message.findOne({
                    where: {
                        zaloMsgId: message.msg_id,
                        zaloAppId: requestData.app_id,
                        zaloId: userId,
                        clinicShortName: clinic.shortName  // Thêm clinicId vào duplicate check
                    }
                });

                // If not found by new fields, try to find by nested message.msg_id and app_id (for backward compatibility)
                if (!existingMessage) {
                    const allMessages = await Message.find({
                        where: {
                            zaloId: userId,
                            clinicShortName: clinic.shortName  // Thêm clinicId vào fallback check
                        },
                        limit: 100 // Limit to recent messages for performance
                    });

                    existingMessage = allMessages.find(msg => {
                        // Check new field first
                        if (msg.zaloMsgId === message.msg_id && msg.zaloAppId && String(msg.zaloAppId) === String(requestData.app_id)) {
                            return true;
                        }
                        // Fallback to nested format
                        const msgData = msg.message || {};
                        const nestedMsg = msgData.message || {};
                        const msgAppId = msgData.app_id;

                        return nestedMsg.msg_id === message.msg_id &&
                            msgAppId &&
                            String(msgAppId) === String(requestData.app_id);
                    });
                }

                if (existingMessage) {

                    return successHandler(res, "Zalo webhook processed successfully (duplicate skipped)");
                } else {
                    console.log('No duplicate found, proceeding with message creation');
                }
            } else if (message.msg_id && !requestData.app_id) {
                // Fallback: if no app_id, check by msg_id only (for backward compatibility) - thêm clinicId


                let existingMessage = await Message.findOne({
                    where: {
                        zaloMsgId: message.msg_id,
                        zaloId: userId,
                        clinicShortName: clinic.shortName  // Thêm clinicId vào fallback check
                    }
                });

                if (!existingMessage) {
                    const allMessages = await Message.find({
                        where: {
                            zaloId: userId,
                            clinicShortName: clinic.shortName  // Thêm clinicId vào fallback check
                        },
                        limit: 100
                    });

                    existingMessage = allMessages.find(msg => {
                        const msgData = msg.message || {};
                        const nestedMsg = msgData.message || {};
                        return nestedMsg.msg_id === message.msg_id;
                    });
                }

                if (existingMessage) {

                    return successHandler(res, "Zalo webhook processed successfully (duplicate skipped)");
                } else {
                    console.log('No duplicate found, proceeding with message creation');
                }
            }

            // Create message record
            const createdMessage = await Message.create(messageData);



            // Return success response (Zalo expects 200 status)
            return successHandler(res, "Zalo webhook processed successfully");

        } catch (error) {
            console.error('Error processing Zalo webhook:', error);
            console.error('Error stack:', error.stack);
            // Still return 200 to Zalo to prevent retries for processing errors
            return successHandler(res, "Webhook received but processing failed");
        }
    });


    async function saveZaloSetting(key, value) {
        const Setting = app.models.Setting;

        const [setting, created] = await Setting.findOrCreate(
            { where: { key: key } },
            { key: key, val: String(value || '') }
        );

        // Nếu đã tồn tại, update lại
        if (!created) {
            await Setting.updateAll(
                { key: key },
                { val: String(value || '') }
            );
        }


        return { key, val: String(value || '') };
    }

    async function getZaloAccessToken() {
        const Setting = app.models.Setting;

        const doc = await Setting.findOne({ where: { key: 'zalo_access_token' } });

        if (!doc || typeof doc.val !== 'string') {
            throw new Error('Zalo access token not configured');
        }
        return doc.val;
    }

    async function refreshZaloTokenIfNeeded() {
        const Setting = app.models.Setting;
        const tokenExpiry = await Setting.findOne({
            where: { key: 'zalo_token_expiry' }
        });

        if (tokenExpiry && tokenExpiry.val) {
            try {
                const expiryDate = new Date(tokenExpiry.val);

                if (!isNaN(expiryDate.getTime())) {
                    const oneDayFromNow = new Date(Date.now() + 86400000);

                    if (expiryDate > oneDayFromNow) {
                        return;
                    }
                }
            } catch (err) {
                console.error('Error parsing token expiry date:', err);
            }
        }

        const [appIdDoc, appSecretDoc, refreshTokenDoc] = await Promise.all([
            Setting.findOne({ where: { key: 'zalo_app_id' } }),
            Setting.findOne({ where: { key: 'zalo_app_secret' } }),
            Setting.findOne({ where: { key: 'zalo_refresh_token' } })
        ]);

        const appId = appIdDoc?.val;
        const appSecret = appSecretDoc?.val;
        const refreshToken = refreshTokenDoc?.val;

        if (!appId || !appSecret || !refreshToken) {
            throw new Error('Zalo credentials not configured');
        }

        const response = await axios.post('https://oauth.zaloapp.com/v4/oa/access_token', {
            app_id: appId,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'secret_key': appSecret
            }
        });


        if (response.data.error) {
            throw new Error(`Zalo API Error: ${response.data.error_description || response.data.error_name}`);
        }

        // Chỉ update access_token (luôn có trong response)
        const updatePromises = [
            saveZaloSetting('zalo_access_token', String(response.data.access_token))
        ];

        // CHỈ update refresh_token và expiry date NẾU có refresh_token mới
        if (response.data.refresh_token) {
            let expiresInSeconds = 90000; // default 25 hours

            if (response.data.expires_in) {
                expiresInSeconds = parseInt(response.data.expires_in, 10);
            }

            if (isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
                console.warn('Invalid expires_in from Zalo refresh, using default 90000 seconds');
                expiresInSeconds = 90000;
            }

            const expiryTimestamp = Date.now() + (expiresInSeconds * 1000);
            const expiryDate = new Date(expiryTimestamp);

            if (isNaN(expiryDate.getTime())) {
                throw new Error('Invalid expiry date calculated');
            }

            // Thêm refresh_token và expiry vào update
            updatePromises.push(
                saveZaloSetting('zalo_refresh_token', String(response.data.refresh_token)),
                saveZaloSetting('zalo_token_expiry', expiryDate.toISOString())
            );

            console.log('Updated refresh_token and expiry date:', {
                expiresInSeconds,
                expiryDate: expiryDate.toISOString()
            });
        } else {
            console.log('No new refresh_token in response, keeping existing expiry date');
        }

        await Promise.all(updatePromises);
    }

    async function saveSentMessage(userId, message) {
        const Message = app.models.Message;
        const Lead = app.models.Lead;

        const lead = await Lead.findOne({ where: { zaloId: userId } });

        if (lead) {
            await Message.create({
                type: 'text',
                leadId: lead.id,
                toId: lead.id,
                content: message,
                zaloId: userId,
                status: 'sent'
            });
        }
    }


    app.post('/api/zalo/setup', async function (req, res) {
        try {
            const { app_id, app_secret, code } = req.body;

            if (!app_id || !app_secret || !code) {
                return res.status(400).json({
                    error: 'Missing required parameters: app_id, app_secret, code'
                });
            }

            const response = await axios.post('https://oauth.zaloapp.com/v4/oa/access_token', {
                app_id: app_id,
                code: code,
                grant_type: 'authorization_code'
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'secret_key': app_secret
                }
            });


            if (response.data.error) {
                throw new Error(`Zalo API Error: ${response.data.error_description || response.data.error_name}`);
            }

            let expiresInSeconds = 90000;

            if (response.data.expires_in) {
                expiresInSeconds = parseInt(response.data.expires_in, 10);
            }

            if (isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
                console.warn('Invalid expires_in from Zalo, using default 90000 seconds');
                expiresInSeconds = 90000;
            }

            const expiryTimestamp = Date.now() + (expiresInSeconds * 1000);
            const expiryDate = new Date(expiryTimestamp);

            if (isNaN(expiryDate.getTime())) {
                throw new Error('Invalid expiry date calculated');
            }

            await Promise.all([
                saveZaloSetting('zalo_app_id', String(app_id)),
                saveZaloSetting('zalo_app_secret', String(app_secret)),
                saveZaloSetting('zalo_access_token', String(response.data.access_token)),
                saveZaloSetting('zalo_refresh_token', String(response.data.refresh_token)),
                saveZaloSetting('zalo_token_expiry', expiryDate.toISOString())
            ]);

            return res.json({
                success: true,
                message: 'Zalo credentials saved successfully',
                expiresIn: expiresInSeconds,
                expiryDate: expiryDate.toISOString()
            });
        } catch (error) {
            console.error('Error setting up Zalo:', error);
            return res.status(500).json({
                error: 'Failed to setup Zalo',
                message: error.message,
                details: error.response?.data
            });
        }
    });

    app.get('/api/zalo/user/:userId', async function (req, res) {
        try {
            const { userId } = req.params;


            await refreshZaloTokenIfNeeded();
            const access_token = await getZaloAccessToken();

            const response = await axios.get('https://openapi.zalo.me/v3.0/oa/user/detail', {
                params: { data: JSON.stringify({ user_id: userId }) },
                headers: {
                    'access_token': access_token,
                    'Content-Type': 'application/json'
                }
            });
            if (response.data && response.data.data) {
                const userInfo = response.data.data;
                const Lead = app.models.Lead;

                // Find existing lead by zaloId to avoid creating duplicate
                const existingLead = await Lead.findOne({ where: { zaloId: userId } });

                if (existingLead) {
                    // Update existing lead
                    await existingLead.updateAttributes({
                        name: userInfo.display_name || userInfo.user_alias || existingLead.fullName || 'Zalo User',
                        avatar: userInfo.avatar || existingLead.avatar,
                        phoneNumber: userInfo.user_id_by_app || userInfo.user_id || existingLead.phoneNumber,
                        status: existingLead.status || 'new'
                    });
                } else {
                    // Create new lead only if doesn't exist
                    await Lead.create({
                        zaloId: userId,
                        name: userInfo.display_name || userInfo.user_alias || 'Zalo User',
                        avatar: userInfo.avatar,
                        phoneNumber: userInfo.user_id_by_app || userInfo.user_id,
                        status: 'new'
                    });
                }
            }

            return res.json(response.data);
        } catch (error) {
            console.error('Error getting user info:', error);
            return res.status(500).json({
                error: 'Failed to get user info',
                message: error.message
            });
        }
    });


    app.get('/api/zalo/token', async function (req, res) {
        try {

            // Refresh token nếu cần
            await refreshZaloTokenIfNeeded();

            // Lấy access token
            const accessToken = await getZaloAccessToken();

            return res.json({
                access_token: accessToken
            });
        } catch (error) {
            console.error('Error getting Zalo token:', error);
            return res.status(500).json({
                error: 'Failed to get Zalo access token',
                message: error.message
            });
        }
    });

    app.post('/api/zalo/send', async function (req, res) {
        try {
            const {
                userId,
                message,
                messageType,
                imageToken,
                imageUrl,
                fileToken,
                fileUrl,
                fileName
            } = req.body;

            if (!userId) {
                return res.status(400).json({
                    error: 'Missing userId'
                });
            }

            await refreshZaloTokenIfNeeded();
            const access_token = await getZaloAccessToken();

            const finalMessageType = messageType; // 'text' | 'image' | 'file'
            const finalImageToken = imageToken;
            const finalImageUrl = imageUrl;
            const finalFileToken = fileToken;
            const finalFileUrl = fileUrl;
            const finalFileName = fileName;

            // Basic validations by type
            if (finalMessageType === 'image' && !finalImageToken && !finalImageUrl) {
                return res.status(400).json({
                    error: 'Missing imageToken or imageUrl for image message'
                });
            }

            if (finalMessageType === 'file' && !finalFileToken && !finalFileUrl) {
                return res.status(400).json({
                    error: 'Missing fileToken or fileUrl for file message'
                });
            }

            if (!finalMessageType || finalMessageType === 'text') {
                if (!message) {
                    return res.status(400).json({
                        error: 'Missing message for text message'
                    });
                }
            }

            const headers = {
                'access_token': access_token,
                'Content-Type': 'application/json'
            };


            // Helper to call Zalo API
            const sendToZalo = async (payload) => {
                return axios.post(
                    'https://openapi.zalo.me/v3.0/oa/message/cs',
                    {
                        recipient: { user_id: userId },
                        message: payload
                    },
                    { headers }
                );
            };

            const checkZaloError = (responseData) => {
                // Zalo API: error = 0 means success, error !== 0 means error
                if (responseData && typeof responseData.error !== 'undefined' && responseData.error !== 0) {
                    return {
                        hasError: true,
                        error: responseData.error,
                        message: responseData.message || 'Zalo API error'
                    };
                }
                return { hasError: false };
            };

            const responses = [];

            // If there is text and an attachment request, send text first for reliability
            const hasText = typeof message === 'string' && message.trim().length > 0;
            const isAttachmentType = finalMessageType === 'image' || finalMessageType === 'file';

            if ((!finalMessageType || finalMessageType === 'text') && hasText) {
                const textPayload = { text: message };
                    const resp = await sendToZalo(textPayload);
                    const errorCheck = checkZaloError(resp.data);
                if (errorCheck.hasError) {
                    // Determine status code based on error type
                    // Negative errors are usually client errors (400), positive might be server errors (500)
                    const statusCode = errorCheck.error < 0 ? 400 : 500;
                    return res.status(statusCode).json({
                        success: false,
                        error: errorCheck.error,
                        message: errorCheck.message,
                        data: resp.data
                    });
                }
                responses.push({ type: 'text', data: resp.data });
            }

            if (isAttachmentType) {
                let attachmentPayload;

                if (finalMessageType === 'image') {
                    // Supports either token or url
                    // const imagePayload = finalImageToken
                    //     ? { token: finalImageToken }
                    //     : { url: finalImageUrl };

                    // attachmentPayload = {
                    //     attachment: {
                    //         type: 'image',
                    //         payload: imagePayload
                    //     }
                    // };

                    // Build media template per Zalo spec
                    const element = {
                        media_type: 'image',
                        ...(finalImageToken ? { attachment_id: finalImageToken } : { url: finalImageUrl })
                        // width/height only for gif per spec; not used for image
                    };

                    // message.text is optional (title of image). Include when provided.
                    attachmentPayload = {
                        ...(hasText ? { text: message } : {}),
                        attachment: {
                            type: 'template',
                            payload: {
                                template_type: 'media',
                                elements: [element] // max 1 element for media template
                            }
                        }
                    };
                } else if (finalMessageType === 'file') {
                    // Supports either token or url
                    // const filePayload = finalFileToken
                    //     ? { token: finalFileToken, name: finalFileName || 'file' }
                    //     : { url: finalFileUrl, name: finalFileName || 'file' };

                    // attachmentPayload = {
                    //     attachment: {
                    //         type: 'file',
                    //         payload: filePayload
                    //     }
                    // };

                    const filePayload = finalFileToken
                        ? { token: finalFileToken, name: finalFileName || 'file' }
                        : { url: finalFileUrl, name: finalFileName || 'file' };

                    attachmentPayload = {
                        attachment: {
                            type: 'file',
                            payload: filePayload
                        }
                    };
                }

                const resp = await sendToZalo(attachmentPayload);
                const errorCheck = checkZaloError(resp.data);
                if (errorCheck.hasError) {
                    // Determine status code based on error type
                    const statusCode = errorCheck.error < 0 ? 400 : 500;
                    return res.status(statusCode).json({
                        success: false,
                        error: errorCheck.error,
                        message: errorCheck.message,
                        data: resp.data
                    });
                }
                responses.push({ type: finalMessageType, data: resp.data });
            }

            // If user explicitly sends only text via messageType === 'text'
            if (finalMessageType === 'text' && hasText && responses.length === 0) {
                const textPayload = { text: message };
                const resp = await sendToZalo(textPayload);
                const errorCheck = checkZaloError(resp.data);
                if (errorCheck.hasError) {
                    // Determine status code based on error type
                    const statusCode = errorCheck.error < 0 ? 400 : 500;
                    return res.status(statusCode).json({
                        success: false,
                        error: errorCheck.error,
                        message: errorCheck.message,
                        data: resp.data
                    });
                }
                responses.push({ type: 'text', data: resp.data });
            }

            if (responses.length === 0) {
                return res.status(400).json({
                    error: 'Nothing to send. Provide message for text, or imageToken/imageUrl for image, or fileToken/fileUrl for file.'
                });
            }


            return res.json({
                success: true,
                data: responses
            });
        } catch (error) {
            console.error('Error sending message:', error);
            return res.status(500).json({
                error: 'Failed to send message',
                message: error.message
            });
        }
    });

    app.get('/api/zalo/messages/:zaloId', async function (req, res) {
        try {
            const { zaloId } = req.params;
            const limit = parseInt(req.query.limit) || 50;

            const Message = app.models.Message;
            const Lead = app.models.Lead;

            const lead = await Lead.findOne({ where: { zaloId } });

            if (!lead) {
                return res.status(404).json({
                    error: 'Lead not found'
                });
            }

            const messages = await Message.find({
                where: {
                    or: [
                        { leadId: lead.id },
                        { zaloId: zaloId }
                    ]
                },
                order: 'createdAt DESC',
                limit: limit
            });

            return res.json({
                success: true,
                lead: lead,
                messages: messages
            });
        } catch (error) {
            console.error('Error getting messages:', error);
            return res.status(500).json({
                error: 'Failed to get messages',
                message: error.message
            });
        }
    });

    app.get('/api/zalo/followers', async function (req, res) {
        try {
            const offset = parseInt(req.query.offset) || 0;
            const count = parseInt(req.query.count) || 50;

            await refreshZaloTokenIfNeeded();
            const access_token = await getZaloAccessToken();

            const response = await axios.get('https://openapi.zalo.me/v2.0/oa/getfollowers', {
                params: {
                    data: JSON.stringify({ offset, count })
                },
                headers: {
                    'access_token': access_token,
                    'Content-Type': 'application/json'
                }
            });

            return res.json({
                success: true,
                data: response.data
            });
        } catch (error) {
            console.error('Error getting followers:', error);
            return res.status(500).json({
                error: 'Failed to get followers',
                message: error.message
            });
        }
    });

    app.post('/api/zalo/upload', async function (req, res) {
        try {
            if (!req.files || !req.files.file) {
                return res.status(400).json({
                    error: 'No file uploaded'
                });
            }

            await refreshZaloTokenIfNeeded();
            const access_token = await getZaloAccessToken();

            const formData = new FormData();
            formData.append('file', req.files.file.data, req.files.file.name);

            const response = await axios.post('https://openapi.zalo.me/v2.0/oa/upload/image',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'access_token': access_token
                    }
                }
            );

            return res.json({
                success: true,
                data: response.data
            });
        } catch (error) {
            console.error('Error uploading file:', error);
            return res.status(500).json({
                error: 'Failed to upload file',
                message: error.message
            });
        }
    });

    app.post('/api/zalo/upload-file', async function (req, res) {
        try {
            if (!req.files || !req.files.file) {
                return res.status(400).json({
                    error: 'No file uploaded'
                });
            }

            await refreshZaloTokenIfNeeded();
            const access_token = await getZaloAccessToken();

            const formData = new FormData();
            formData.append('file', req.files.file.data, req.files.file.name);

            const response = await axios.post('https://openapi.zalo.me/v2.0/oa/upload/file',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'access_token': access_token
                    }
                }
            );

            return res.json({
                success: true,
                data: response.data
            });
        } catch (error) {
            console.error('Error uploading file:', error);
            return res.status(500).json({
                error: 'Failed to upload file',
                message: error.message
            });
        }
    });

    app.get('/api/whoami', async function (req, res) {
        try {
            var app = require('../server');
            // get the current access token from request header 
            var accessToken = req.headers.authorization;
            if (!accessToken) {
                errorHandler(res, { errmsg: "Missing access token" });
                return;
            }
            var AccessToken = app.models.AccessToken;

            const appX = req.app;

            app.models['AccessToken'].attachTo(appX.datasources['danhhien']);
            app.models['Customer'].attachTo(appX.datasources['danhhien']);
            app.models['user'].attachTo(appX.datasources['danhhien']);

            // switch db source to danhhien

            var a = await AccessToken.findById(accessToken);
            if (!a) {
                errorHandler(res, { errmsg: "Invalid access token" });
                return;
            }

            var User = app.models.user;
            var Customer = app.models.Customer;
            var SaleOrder = app.models.SaleOrder;

            var u = await User.findById(a.userId);
            var c = await Customer.findById(a.userId);
            var result = {
                'user': u || c, orders: await SaleOrder.find({
                    where: { customerId: a.userId },
                    include: ['items']
                })
            };
            successHandler(res, result);
        } catch (error) {
            console.error('Error in /api/whoami:', error);
            errorHandler(res, {
                errmsg: "Internal server error",
                error: error.message
            });
        }
    });


    app.post("/api/favorites/add", (req, res) => {
        const { userId, productId } = req.body;
        if (!userId || !productId) {
            return res.status(400).json({ error: "userId and productId are required" });
        }

        const key = `favorites:${userId}`;
        redisClient.sadd(key, productId, (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, added: result });
        });
    });

    // Remove a product from favorites
    app.post("/api/favorites/remove", (req, res) => {
        const { userId, productId } = req.body;
        if (!userId || !productId) {
            return res.status(400).json({ error: "userId and productId are required" });
        }

        const key = `favorites:${userId}`;
        redisClient.srem(key, productId, (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, removed: result });
        });
    });

    // Get all favorite products for a user
    app.get("/api/favorites/:userId", (req, res) => {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const key = `favorites:${userId}`;
        redisClient.smembers(key, (err, products) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ userId, favorites: products });
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
        // console.log(req.param('template'), req.param('modelName'), req.param('filter'));
        const subdomain = req.hostname.split('.')[0];
        const orginalUrl = req.headers.orginalUrl;
        const keyPath = `${subdomain}:${orginalUrl}`;

        const templateName = req.param('template') ? decodeURIComponent(req.param('template')) : null;

        if (templateName && templateName.startsWith('/')) {
            templateName = templateName.substring(1);
        }
        console.log('templateName ', templateName);

        // Kiểm tra xem có tồn tại Page với slug = templateName không
        if (templateName) {
            const Page = app.models.Page;
            Page.findOne({ where: { slug: templateName } }, function (err, pageResult) {
                if (err) {
                    console.log('Error checking page:', err);
                    // Fallback to template if error
                    pdfHandler.generateFromTemplate(templateName,
                        req.param('filter') && JSON.parse(req.param('filter')), req.param('modelName'), res, req,
                        pdfHandler.writeResponse);
                    return;
                }

                if (pageResult) {
                    // Sử dụng generateFromPage nếu tìm thấy Page có slug = templateName
                    console.log('Found page with slug, using generateFromPage');
                    pdfHandler.generateFromPage(templateName,
                        req.param('filter') && JSON.parse(req.param('filter')), req.param('modelName'), res, req,
                        pdfHandler.writeResponse);
                } else {
                    // Sử dụng generateFromTemplate nếu không tìm thấy Page có slug = templateName
                    console.log('Page with slug not found, using generateFromTemplate');
                    pdfHandler.generateFromTemplate(templateName,
                        req.param('filter') && JSON.parse(req.param('filter')), req.param('modelName'), res, req,
                        pdfHandler.writeResponse);
                }
            });
        } else {
            // Nếu không có templateName, sử dụng generateFromTemplate
            pdfHandler.generateFromTemplate(templateName,
                req.param('filter') && JSON.parse(req.param('filter')), req.param('modelName'), res, req,
                pdfHandler.writeResponse);
        }
    });


    function convertToHtml(text) {
        if (!text) return "";

        // Chuyển **bold** thành <strong>bold</strong>
        text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // Xử lý danh sách (dòng bắt đầu bằng `- `)
        text = text.replace(/\n\s*-\s(.*?)(?=\n|$)/g, "<li>$1</li>");

        // Bọc danh sách bằng <ul>
        text = text.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

        // Chuyển đổi xuống hàng `\n\n` thành `<p>`
        text = text.replace(/\n\n/g, "</p><p>");

        // Xuống dòng trong cùng một đoạn văn
        text = text.replace(/\n/g, "<br>");

        // Bọc toàn bộ nội dung trong thẻ `<p>`
        return `
        <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
                    p { margin-bottom: 15px; }
                    strong { color: #D35400; }
                    ul { padding-left: 20px; }
                    li { margin-bottom: 5px; }
                </style>
                <link
      rel="stylesheet"
      href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css"
    />
            </head>
            <body>
        <p>${text}</p>
        </body>
        </html>
        `;
    }

    app.get('/api/ai', async function (req, res) {
        var html = null;
        const visitId = req.param('visitId');
        const Prompt = app.models.Prompt;
        const Visit = app.models.visit;
        const visit = await Visit.findById(visitId);
        var _obj = {
            html: null,
            visit: visit
        };

        console.log('visit ', visit && visit.id);

        const redis = require("redis");
        const client = redis.createClient();

        client.rpush("message_queue", JSON.stringify(
            {
                model: 'visit',
                appName: 'tl',
                data: {
                    id: visitId,
                    message: 'Hello'
                }
            }), (err, reply) => {
            });


        var prompt = null;

        for (var i = 0; i < 15; i++) {
            prompt = await Prompt.findOne({
                where: {
                    objectId: visitId
                },
                order: 'createdAt DESC',
                limit: 1
            });

            if (prompt) {
                break;
            }

            // wait 10s 
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (prompt) {
            _obj.html = prompt.answer;
        } else {
            console.log('No prompt ..');
        }


        // console.log('lastPrompt ', lastPrompt);

        // if (lastPrompt && lastPrompt.length > 0) {
        //     _obj.html = lastPrompt[0].answer;
        // } else {
        // console.log('No prompt ..');
        // const Trigger = app.models.Trigger;
        // const trigger = await Trigger.findOne({
        //     where: { "filter.model": 'visit', "filter.event": 'x' },
        //     // include relation template 
        //     include: 'template'
        // });

        // if (trigger && trigger.code) {
        //     console.log('Trigger code:...');
        //     try {
        //         const code = trigger.code;
        //         var obj = _obj;
        //         const func = new Function('obj', 'require', code);

        //        // await func(obj, require); // Execute dynamic code
        //     } catch (executionError) {
        //         console.error('Error executing trigger code:', executionError);
        //     }
        // } else {
        //     console.log('No trigger code found');
        // }
        // }


        res.send({ ai: _obj.html, aiHtml: convertToHtml(_obj.html || 'No AI response') });
    });

    app.post("/api/askAi", async function (req, res) {
        const { messages } = req.body;
        if (!messages) {
            errorHandler(res, { errmsg: "messages is required" });
            return;
        }

        const response = await aiHandler.askAi({ messages: messages });

        if (!response || !response.content) {
            errorHandler(res, { errmsg: "AI response is empty" });
            return;
        }

        successHandler(res, { content: response.content });
    });

    app.get("/api/blocks/check-phone-number", async function (req, res) {
        const phone = req.param('phone');
        if (!phone) {
            errorHandler(res, { errmsg: "phone is required" });
            return;
        }
        const Customer = app.models.Customer;
        const User = app.models.User;

        const user = await User.findOne({ where: { phoneNumber: phone } });
        if (user) {
            successHandler(res, { isExisted: true });
            return;
        }

        const customer = await Customer.findOne({ where: { phone: phone } });
        if (customer) {
            successHandler(res, { isExisted: true });
        } else {
            successHandler(res, { isExisted: false });
        }
    });

    app.get('/api/ais', function (req, res) {
        const visitId = req.param('visitId');

        res.send(`
            <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
     <script src="https://cdn.live1.vn/tl.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            padding: 20px;
            background-color: #f4f4f4;
            text-align: center;
        }
        .container {
            max-width: 600px;
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            margin: auto;
            text-align: left;
        }
        .loading {
            font-size: 18px;
            color: #007bff;
            margin-top: 20px;
        }
        .response {
            margin-top: 20px;
        }
        .error {
            color: red;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="loading">Loading... Please wait up to 60 seconds.</div>
        <div class="response"></div>
        <div class="error"></div>
    </div>
    <script>
        $(document).ready(function() {
            load("${visitId}");
        }
        );
        </script>
</body>
</html>
            `
        );
    });

    app.get('/api/dashboard', function (req, res) {
        // get count on SaleOrder aggregate on status and date
        var SaleOrder = app.models.SaleOrder.getDataSource().connector.collection('SaleOrder');;
        var Visit = app.models.Visit;
        var Customer = app.models.Customer;
        var Product = app.models.Product;

        var dashboard = {
        };
        var count = 6;

        function checkFinish() {
            count--;
            if (count == 0) {
                res.send(dashboard);
            }
        }

        SaleOrder.aggregate(
            [
                {
                    $match: {
                        type: { $ne: 'quotation' }
                    }
                },
                {
                    $group: {
                        _id: { status: '$status' },
                        count: { $sum: 1 }
                    }
                }
            ], function (err, result) {
                // data return is [{"_id":{"status":"processing"},"count":1},{"_id":{"status":"pending"},"count":31},{"_id":{"status":"completed"},"count":154}
                // make it to {processing: 1, pending: 31, completed: 154}
                result = result.reduce(function (acc, cur) {
                    acc[cur._id.status] = cur.count;
                    return acc;
                }, {});

                dashboard.SaleOrderStatus = result;
                checkFinish();
            });

        // get sum of SaleOrder.total, SaleOrder.paidAmount, SaleOrder.deposit; 
        SaleOrder.aggregate(
            [
                {
                    $match: {
                        type: { $ne: 'quotation' }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$total' },
                        paidAmount: { $sum: '$paidAmount' },
                        deposit: { $sum: '$deposit' }
                    }
                }
            ], function (err, result) {
                dashboard.SaleOrderAmount = result[0];
                checkFinish();
            }
        );

        // get total sale order group by month by last six months
        SaleOrder.aggregate(
            [
                {
                    $match: {
                        type: { $ne: 'quotation' },
                        createdAt: { $gte: moment().subtract(6, 'months').toDate() }
                    }
                },
                {
                    $group: {
                        _id: { $month: '$createdAt' },
                        total: { $sum: '$total' },
                        paidAmount: { $sum: '$paidAmount' },
                        deposit: { $sum: '$deposit' }
                    }
                }
            ], function (err, result) {
                dashboard.SaleOrderMonthly = result;
                checkFinish();
            }
        );

        Customer.count({}, function (err, count) {
            dashboard.Customer = {
                count: count
            };
            checkFinish();
        });

        Product.count({}, function (err, count) {
            dashboard.Product = {
                count: count
            };
            checkFinish();
        });

        // Count Visit Today
        Visit.count({
            where: {
                and: [
                    { scheduledDate: { gte: moment().startOf('day').toDate() } },
                    { scheduledDate: { lte: moment().endOf('day').toDate() } }
                ]
            }
        }, function (err, count) {
            dashboard.Visit = {
                today: count
            };
            checkFinish();
        }
        );
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

    app.get('/api/a-test', function (req, res) {
        // using Q promise with all: 1. get not-found template name by redisClient 2. get template from Template model by name 'test'
        var Q = require('q');
        var redis = require("redis");
        redisClient = redis.createClient();
        var templateName = 'test';
        var notFoundTemplate = 'not-found';

        Q.all([
            Q.ninvoke(redisClient, 'get', 'not-found-template'),
            app.models.Template.findOne({ where: { name: templateName } })
        ]).then(function (results) {
            var notFoundTemplateResult = results[0];
            var template = results[1];

            if (!template) {
                template = { name: notFoundTemplate };
            }

            console.log('test results', results.map(function (r) { return r && r.name; }));

            res.send('ok');
        }).fail(function (error) {
            console.log('error', error);
            res.send(error);
        });

    });

    app.post('/api/rocketchat-webhook', async (req, res) => {
        const Message = app.models.message;

        try {
            // Extract the user ID from the webhook payload
            const userId = req.body.user_name;
            var parts = userId.split('.');
            var datasource = parts[parts.length - 1];
            const appX = req.app;

            app.models['message'].attachTo(appX.datasources[datasource]);
            app.models['message'].currentDatasource = datasource;
            app.models['Customer'].attachTo(appX.datasources[datasource]);
            app.models['user'].attachTo(appX.datasources[datasource]);
            app.models['installation'].attachTo(appX.datasources[datasource]);

            // Store the entire request body directly into the Message model
            const message = await Message.create(req.body);

            // Return an empty object to acknowledge the webhook
            return res.status(200).send({});
        } catch (error) {
            console.error('Error handling webhook:', error);
            return res.status(500).send({ error: 'Internal Server Error' });
        }
    });


    // send sms otp to user
    app.post('/api/send-sms-otp', async (req, res) => {
        const { _phoneNumber } = req.body;
        const Prelude = require('@prelude.so/sdk');

        // if phone number not start with +84, add +84 to the beginning
        let phoneNumber = _phoneNumber;
        if (!phoneNumber.startsWith('+84')) {
            if (phoneNumber.startsWith('0')) {
                phoneNumber = '+84' + phoneNumber.substring(1);
            } else {
                phoneNumber = '+84' + phoneNumber;
            }
        }

        const client = new Prelude({
            apiToken: "sk_GrJe8782slliqpfrm2bKUcJvrQBt47vm",
        });

        const verification = await client.verification.create({
            target: { type: 'phone_number', value: phoneNumber },
        });

        res.send(verification);
    });

    // verify sms otp
    app.post('/api/verify-sms-otp', async (req, res) => {
        const { phoneNumber, code } = req.body;
        const Prelude = require('@prelude.so/sdk');

        // if phone number not start with +84, add +84 to the beginning
        let _phoneNumber = phoneNumber;
        if (!_phoneNumber.startsWith('+84')) {
            if (_phoneNumber.startsWith('0')) {
                _phoneNumber = '+84' + _phoneNumber.substring(1);
            } else {
                _phoneNumber = '+84' + _phoneNumber;
            }
        }

        const client = new Prelude({
            apiToken: "sk_GrJe8782slliqpfrm2bKUcJvrQBt47vm",
        });

        const check = await client.verification.check({
            target: {
                type: "phone_number",
                value: _phoneNumber,
            },
            code: code
        });

        res.send(check);
    });


    app.get('/api/index', async function (req, res) {
        try {
            const domain = req.headers.host.toLowerCase();
            const AccessToken = app.models.AccessToken;
            const Clinic = app.models.Clinic;
            const Setting = app.models.Setting;
            const User = app.models.User;
            const RoleMapping = app.models.RoleMapping;
            const Role = app.models.Role;
            const Cfg = app.models.Cfg;
            let userId = req.accessToken && req.accessToken.userId;

            if (domain.includes('localhost') || domain.includes('register') || domain.includes('dangky')) {
                return res.send("window.gcfg = {}");
            }

            if (req.query.access_token && !req.accessToken) {
                const token = await AccessToken.findById(req.query.access_token);
                userId = token && token.userId;
                req.accessToken = token;
            }

            let clinic = await Clinic.findOne({
                where: { domain }
                // include: ['settings']
            });

            console.log('clinic ', clinic && clinic.id, ' domain: ', domain);

            let filter = { where: {} };
            if (clinic) {
                filter.where.clinicId = clinic.id;
            } else {
                clinic = {};
            }

            clinic.settings = await Setting.find(filter);

            if (!clinic) {
                return res.send('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Cty chưa tồn tại trong hệ thống.</h1></body>\'');
            }

            if (!userId) {
                return res.send("window.gcfg = " + JSON.stringify({}));
            }

            const user = await User.findById(userId, { include: ["clinic"] });

            if (!user) {
                return res.send("window.gcfg = {}");
            }

            const roleMappings = await RoleMapping.find({ where: { principalId: userId } });
            const roleIds = _.uniq(roleMappings.map(roleMapping => roleMapping.roleId));
            const roles = await Role.find({ where: { id: { inq: roleIds } } });
            const cfgs = await Cfg.find({ isActive: true });

            user.roles = roles;
            const result = {
                curUser: user,
                curClinic: clinic,
                cfgs: cfgs
            };

            res.send(`window.gcfg = ${JSON.stringify(result)}; window.gcfg.curUser.roles = ${JSON.stringify(roles)};`);
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Vui lòng thử lại sau.</h1></body>\'');
        }
    });


    app.get('/api/index2', function (req, res) {
        var domain = req.headers.host;
        var AccessToken = app.models.AccessToken;

        var userId = req.accessToken && req.accessToken.userId;

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
                    res.send('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Cty chưa tồn tại trong hệ thống.</h1></body>\'');
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

                            res.send("window.gcfg = " + JSON.stringify(result) + "; window.gcfg.curUser.roles = " + JSON.stringify(roles));
                        } else {
                            res.send("window.gcfg = {}");
                        }
                    });
                });

            });
        })
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
                isExpired: { ne: true }
            },
            limit: 4
        }, (err, _rContracts) => {
            var noContracts = 0;
            var noOrders = 0;

            if (_rContracts.length == 0) {
                res.send({ rOrders: 0, contract: _rContracts, err: err });
            }

            _.forEach(_rContracts, (_rContract) => {
                var rContract = JSON.parse(JSON.stringify(_rContract));
                order.find({
                    where: {
                        packageId: {
                            inq: _.map(rContract.packages, (po) => { return po && po.id })
                        },
                        isComplete: { ne: true },
                        isExpired: { ne: true },
                        isRemoved: { ne: true }
                    },
                    limit: 100
                }, (err, rOrders) => {
                    noContracts++;
                    noOrders += rOrders.length;

                    if (noContracts == _rContracts.length)
                        res.send({ rOrders: noOrders, contract: rContract, err: err });
                    if (rOrders && rOrders.length > 0) {
                        _.forEach(rOrders, (o) => {
                            o.updateAttributes({ isExpired: true })
                        })

                    } else {
                        // mark this contract as expired 
                        _rContract.updateAttributes({ isExpired: true })

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




    // Thêm API mới tối ưu hóa cho user profile
    app.get('/api/users/profile', async function (req, res) {
        try {
            // 1. Rate limiting cụ thể cho API này
            const rateLimitKey = `user_profile_${req.ip}`;
            const requestCount = req.app.locals.userProfileRequests = req.app.locals.userProfileRequests || {};
            const now = Date.now();
            const windowMs = 60000; // 1 phút
            const maxRequests = 100; // 100 requests mỗi phút

            if (!requestCount[rateLimitKey]) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            if (now > requestCount[rateLimitKey].resetTime) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            requestCount[rateLimitKey].count++;

            if (requestCount[rateLimitKey].count > maxRequests) {
                return res.status(429).json({
                    error: {
                        message: 'Rate limit exceeded. Please try again later.',
                        statusCode: 429
                    }
                });
            }

            // 2. Validate token với security checks
            const AccessToken = app.models.AccessToken;
            const User = app.models.User;
            const RoleMapping = app.models.RoleMapping;
            const Role = app.models.Role;
            const Clinic = app.models.Clinic;
            const Setting = app.models.Setting;

            let userId = null;
            let accessToken = null;

            // Kiểm tra token từ header hoặc query
            const authHeader = req.headers['authorization'];
            const queryToken = req.query.access_token;

            if (authHeader) {
                accessToken = await AccessToken.findById(authHeader);
                if (accessToken) {
                    userId = accessToken.userId;
                }
            } else if (queryToken) {
                accessToken = await AccessToken.findById(queryToken);
                if (accessToken) {
                    userId = accessToken.userId;
                }
            }

            if (!userId) {
                return res.status(401).json({
                    error: {
                        message: 'Authentication required',
                        statusCode: 401
                    }
                });
            }

            // 3. Validate token expiration
            if (accessToken && accessToken.created) {
                const tokenAge = Date.now() - new Date(accessToken.created).getTime();
                const maxAge = (accessToken.ttl || 1209600) * 1000; // Default 14 days

                if (tokenAge > maxAge) {
                    return res.status(401).json({
                        error: {
                            message: 'Token expired',
                            statusCode: 401
                        }
                    });
                }
            }

            // 4. Get domain và validate clinic (tương tự /api/index)
            const domain = req.headers.host.toLowerCase();

            if (domain.includes('localhost') || domain.includes('register') || domain.includes('dangky')) {
                console.log("localhost", domain);
            }


            let clinic = await Clinic.findOne({
                where: { domain }
                // include: ['settings']
            });


            let filter = { where: {} };
            if (clinic) {
                filter.where.clinicId = clinic.id;
            } else {
                clinic = {};
            }

            clinic.settings = await Setting.find(filter);

            if (!clinic) {
                console.log('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Cty chưa tồn tại trong hệ thống.</h1></body>\'');
            }

            // 5. Load user với clinic validation (cập nhật cho localhost)
            let whereCondition = { id: userId };
            // if (clinic.id !== 'localhost') {
            //     whereCondition.clinicId = clinic.id;
            // }

            const user = await User.findOne({
                where: whereCondition,
                include: ['clinic']
            });

            console.log('user ', user, whereCondition);

            if (!user) {
                return res.status(404).json({
                    error: {
                        message: 'User not found',
                        statusCode: 404
                    }
                });
            }

            // 6. Load roles với optimization (tránh N+1 query)
            const roleMappings = await RoleMapping.find({
                where: { principalId: userId }
            });

            const roleIds = [...new Set(roleMappings.map(rm => rm.roleId))];

            const roles = await Role.find({
                where: { id: { inq: roleIds } }
            });

            // 7. Load clinic settings với optimization
            const settings = await Setting.find({
                where: { clinicId: clinic.id }
            });

            // 8. Prepare response với data sanitization
            const sanitizedUser = {
                id: user.id,
                email: user.email,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                fullName: user.fullName,
                avatar: user.avatar,
                isActive: user.isActive,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            };

            const sanitizedRoles = roles.map(role => ({
                id: role.id,
                name: role.name,
                description: role.description,
                permissions: role.permissions
            }));

            const sanitizedClinic = {
                id: clinic.id,
                name: clinic.name,
                domain: clinic.domain,
                isActive: clinic.isActive,
                settings: settings.map(setting => ({
                    key: setting.key,
                    value: setting.value,
                    type: setting.type
                }))
            };

            // 9. Add security headers
            res.set({
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Cache-Control': 'no-cache, no-store, must-revalidate', // No cache for user profile
                'Pragma': 'no-cache',
                'Expires': '0',
                'ETag': `"${user.id}-${moment(user.updatedAt).valueOf()}-${Date.now()}"`
            });

            // 10. Return optimized response
            const response = {
                success: true,
                data: {
                    user: sanitizedUser,
                    roles: sanitizedRoles,
                    clinic: sanitizedClinic,
                    permissions: sanitizedRoles.map(role => role.name), // Simplified permissions
                    timestamp: new Date().toISOString()
                }
            };

            res.json(response);

        } catch (error) {
            console.error('User profile API error:', error);

            // Log error với context nhưng không expose sensitive info
            const errorId = Math.random().toString(36).substr(2, 9);
            console.error(`Error ID: ${errorId}`, {
                path: req.path,
                method: req.method,
                ip: req.ip,
                userId: req.accessToken?.userId,
                error: error.message
            });

            res.status(500).json({
                error: {
                    message: 'Internal server error',
                    errorId: errorId,
                    statusCode: 500
                }
            });
        }
    });

    // Thêm API để refresh token (optional)
    app.post('/api/user/refresh-token', async function (req, res) {
        try {
            const AccessToken = app.models.AccessToken;
            const User = app.models.User;

            const currentToken = req.headers['authorization'] || req.body.access_token;

            if (!currentToken) {
                return res.status(401).json({
                    error: {
                        message: 'Current token required',
                        statusCode: 401
                    }
                });
            }

            const accessToken = await AccessToken.findById(currentToken);

            if (!accessToken) {
                return res.status(401).json({
                    error: {
                        message: 'Invalid token',
                        statusCode: 401
                    }
                });
            }

            // Delete old token
            await AccessToken.destroyById(currentToken);

            // Create new token
            const user = await User.findById(accessToken.userId);
            const newToken = await user.createAccessToken(1209600); // 14 days

            res.json({
                success: true,
                data: {
                    accessToken: newToken.id,
                    ttl: newToken.ttl,
                    created: newToken.created,
                    userId: newToken.userId
                }
            });

        } catch (error) {
            console.error('Token refresh error:', error);
            res.status(500).json({
                error: {
                    message: 'Failed to refresh token',
                    statusCode: 500
                }
            });
        }
    });

    app.get('/api/user/:userId/profile', async function (req, res) {
        try {
            // 1. Rate limiting
            const rateLimitKey = `user_detail_${req.ip}`;
            const requestCount = req.app.locals.userDetailRequests = req.app.locals.userDetailRequests || {};
            const now = Date.now();
            const windowMs = 60000; // 1 phút
            const maxRequests = 50; // 50 requests mỗi phút

            if (!requestCount[rateLimitKey]) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            if (now > requestCount[rateLimitKey].resetTime) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            requestCount[rateLimitKey].count++;

            if (requestCount[rateLimitKey].count > maxRequests) {
                return res.status(429).json({
                    error: {
                        message: 'Rate limit exceeded. Please try again later.',
                        statusCode: 429
                    }
                });
            }

            // 2. Validate token và quyền admin
            const AccessToken = app.models.AccessToken;
            const User = app.models.User;
            const RoleMapping = app.models.RoleMapping;
            const Role = app.models.Role;
            const Clinic = app.models.Clinic;
            const Setting = app.models.Setting;

            let currentUserId = null;
            let accessToken = null;

            // Kiểm tra token từ header hoặc query
            const authHeader = req.headers['authorization'];
            const queryToken = req.query.access_token;

            if (authHeader) {
                accessToken = await AccessToken.findById(authHeader);
                if (accessToken) {
                    currentUserId = accessToken.userId;
                }
            } else if (queryToken) {
                accessToken = await AccessToken.findById(queryToken);
                if (accessToken) {
                    currentUserId = accessToken.userId;
                }
            }

            if (!currentUserId) {
                return res.status(401).json({
                    error: {
                        message: 'Authentication required',
                        statusCode: 401
                    }
                });
            }

            // 3. Validate token expiration
            if (accessToken && accessToken.created) {
                const tokenAge = Date.now() - new Date(accessToken.created).getTime();
                const maxAge = (accessToken.ttl || 1209600) * 1000; // Default 14 days

                if (tokenAge > maxAge) {
                    return res.status(401).json({
                        error: {
                            message: 'Token expired',
                            statusCode: 401
                        }
                    });
                }
            }

            // 4. Get domain và validate clinic (tương tự /api/index)
            const domain = req.headers.host.toLowerCase();

            if (domain.includes('localhost') || domain.includes('register') || domain.includes('dangky')) {
                console.log("localhost", domain);
            }


            let clinic = await Clinic.findOne({
                where: { domain }
                // include: ['settings']
            });


            let filter = { where: {} };
            if (clinic) {
                filter.where.clinicId = clinic.id;
            } else {
                clinic = {};
            }

            clinic.settings = await Setting.find(filter);

            if (!clinic) {
                console.log('window.gcfg = document.body.innerHTML = \'<body style="background-color:white"><h1>Cty chưa tồn tại trong hệ thống.</h1></body>\'');
            }


            // 5. Validate current user có quyền admin (cập nhật cho localhost)
            let currentUserWhereCondition = { id: currentUserId };
            if (clinic.id !== 'localhost') {
                currentUserWhereCondition.clinicId = clinic.id;
            }

            const currentUser = await User.findOne({
                where: currentUserWhereCondition
            });

            if (!currentUser) {
                return res.status(404).json({
                    error: {
                        message: 'Current user not found',
                        statusCode: 404
                    }
                });
            }

            // Check if current user has admin role
            const currentUserRoleMappings = await RoleMapping.find({
                where: { principalId: currentUserId }
            });

            const currentUserRoleIds = [...new Set(currentUserRoleMappings.map(rm => rm.roleId))];
            const currentUserRoles = await Role.find({
                where: { id: { inq: currentUserRoleIds } }
            });

            const isAdmin = currentUserRoles.some(role =>
                role.name && (role.name.toLowerCase().includes('admin') ||
                    role.name.toLowerCase().includes('super admin'))
            );

            if (!isAdmin) {
                return res.status(403).json({
                    error: {
                        message: 'Admin permission required',
                        statusCode: 403
                    }
                });
            }

            // 6. Load target user với clinic validation (cập nhật cho localhost)
            const targetUserId = req.params.userId;
            let targetUserWhereCondition = { id: targetUserId };
            if (clinic.id !== 'localhost') {
                targetUserWhereCondition.clinicId = clinic.id;
            }
            console.log('targetUserWhereCondition2 ', targetUserWhereCondition);
            const targetUser = await User.findOne({
                where: targetUserWhereCondition,
                include: ['clinic']
            });

            if (!targetUser) {
                return res.status(404).json({
                    error: {
                        message: 'Target user not found',
                        statusCode: 404
                    }
                });
            }

            // 7. Load target user roles với optimization (tránh N+1 query)
            const targetUserRoleMappings = await RoleMapping.find({
                where: { principalId: targetUserId }
            });

            const targetUserRoleIds = [...new Set(targetUserRoleMappings.map(rm => rm.roleId))];

            const targetUserRoles = await Role.find({
                where: { id: { inq: targetUserRoleIds } }
            });

            // 8. Prepare response với data sanitization
            const sanitizedUser = {
                id: targetUser.id,
                email: targetUser.email,
                username: targetUser.username,
                firstName: targetUser.firstName,
                lastName: targetUser.lastName,
                fullName: targetUser.fullName,
                avatar: targetUser.avatar,
                isActive: targetUser.isActive,
                lastLoginAt: targetUser.lastLoginAt,
                createdAt: targetUser.createdAt,
                updatedAt: targetUser.updatedAt
            };

            const sanitizedRoles = targetUserRoles.map(role => ({
                id: role.id,
                name: role.name,
                description: role.description,
                permissions: role.permissions // Include permissions for admin access
            }));

            const sanitizedClinic = {
                id: clinic.id,
                name: clinic.name,
                domain: clinic.domain,
                isActive: clinic.isActive
            };

            // 9. Add security headers
            res.set({
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Cache-Control': 'no-cache, no-store, must-revalidate', // No cache for user profile
                'Pragma': 'no-cache',
                'Expires': '0',
                'ETag': `"${targetUser.id}-${moment(targetUser.updatedAt).valueOf()}-${Date.now()}"`
            });

            // 10. Return optimized response
            const response = {
                success: true,
                data: {
                    user: sanitizedUser,
                    roles: sanitizedRoles,
                    clinic: sanitizedClinic,
                    permissions: sanitizedRoles.map(role => role.name), // Simplified permissions
                    timestamp: new Date().toISOString()
                }
            };

            res.json(response);

        } catch (error) {
            console.error('User detail API error:', error);

            // Log error với context nhưng không expose sensitive info
            const errorId = Math.random().toString(36).substr(2, 9);
            console.error(`Error ID: ${errorId}`, {
                path: req.path,
                method: req.method,
                ip: req.ip,
                userId: req.accessToken?.userId,
                error: error.message
            });

            res.status(500).json({
                error: {
                    message: 'Internal server error',
                    errorId: errorId,
                    statusCode: 500
                }
            });
        }
    });

    // API để lấy danh sách users với roles (dành cho admin)
    app.get('/api/users/with-roles', async function (req, res) {
        try {
            // 1. Rate limiting
            const rateLimitKey = `users_list_${req.ip}`;
            const requestCount = req.app.locals.usersListRequests = req.app.locals.usersListRequests || {};
            const now = Date.now();
            const windowMs = 60000; // 1 phút
            const maxRequests = 30; // 30 requests mỗi phút

            if (!requestCount[rateLimitKey]) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            if (now > requestCount[rateLimitKey].resetTime) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            requestCount[rateLimitKey].count++;

            if (requestCount[rateLimitKey].count > maxRequests) {
                return res.status(429).json({
                    error: {
                        message: 'Rate limit exceeded. Please try again later.',
                        statusCode: 429
                    }
                });
            }

            // 2. Validate token và quyền admin (same as above API)
            const AccessToken = app.models.AccessToken;
            const User = app.models.User;
            const RoleMapping = app.models.RoleMapping;
            const Role = app.models.Role;
            const Clinic = app.models.Clinic;

            let currentUserId = null;
            let accessToken = null;

            // Kiểm tra token từ header hoặc query
            const authHeader = req.headers['authorization'];
            const queryToken = req.query.access_token;

            if (authHeader) {
                accessToken = await AccessToken.findById(authHeader);
                if (accessToken) {
                    currentUserId = accessToken.userId;
                }
            } else if (queryToken) {
                accessToken = await AccessToken.findById(queryToken);
                if (accessToken) {
                    currentUserId = accessToken.userId;
                }
            }

            if (!currentUserId) {
                return res.status(401).json({
                    error: {
                        message: 'Authentication required',
                        statusCode: 401
                    }
                });
            }

            // Get domain và validate clinic (tương tự /api/index)
            const domain = req.headers.host.toLowerCase();

            // Cho phép test trên localhost/register/dangky với clinic mặc định
            let clinic = null;

            if (domain.includes('localhost') || domain.includes('register') || domain.includes('dangky')) {
                // Với localhost, tạo clinic ảo hoặc sử dụng clinic mặc định
                clinic = {
                    id: 'localhost',
                    name: 'Development Clinic',
                    domain: domain,
                    isActive: true
                };
            } else {
                clinic = await Clinic.findOne({
                    where: { domain }
                });

                if (!clinic) {
                    return res.status(404).json({
                        error: {
                            message: 'Clinic not found',
                            statusCode: 404
                        }
                    });
                }
            }

            // Validate current user có quyền admin (cập nhật cho localhost)
            let currentUserWhereCondition = { id: currentUserId };
            if (clinic.id !== 'localhost') {
                currentUserWhereCondition.clinicId = clinic.id;
            }

            const currentUser = await User.findOne({
                where: currentUserWhereCondition
            });

            if (!currentUser) {
                return res.status(404).json({
                    error: {
                        message: 'Current user not found',
                        statusCode: 404
                    }
                });
            }

            // Check if current user has admin role
            const currentUserRoleMappings = await RoleMapping.find({
                where: { principalId: currentUserId }
            });

            const currentUserRoleIds = [...new Set(currentUserRoleMappings.map(rm => rm.roleId))];
            const currentUserRoles = await Role.find({
                where: { id: { inq: currentUserRoleIds } }
            });

            const isAdmin = currentUserRoles.some(role =>
                role.name && (role.name.toLowerCase().includes('admin') ||
                    role.name.toLowerCase().includes('super admin'))
            );

            if (!isAdmin) {
                return res.status(403).json({
                    error: {
                        message: 'Admin permission required',
                        statusCode: 403
                    }
                });
            }

            // 3. Get pagination parameters
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';

            // 4. Build where condition for search (cập nhật cho localhost)
            let whereCondition = {};
            if (clinic.id !== 'localhost') {
                whereCondition.clinicId = clinic.id;
            }

            if (search) {
                let baseCondition = {};
                if (clinic.id !== 'localhost') {
                    baseCondition.clinicId = clinic.id;
                }

                whereCondition = {
                    and: [
                        baseCondition,
                        {
                            or: [
                                { fullName: { like: '%' + search + '%' } },
                                { email: { like: '%' + search + '%' } },
                                { username: { like: '%' + search + '%' } }
                            ]
                        }
                    ]
                };
            }

            // 5. Load users với optimization
            const users = await User.find({
                where: whereCondition,
                limit: limit,
                offset: offset,
                order: 'createdAt DESC'
            });

            const totalCount = await User.count(whereCondition);

            // 6. Load roles cho tất cả users trong một batch để tránh N+1 query
            const userIds = users.map(user => user.id);
            const allRoleMappings = await RoleMapping.find({
                where: { principalId: { inq: userIds } }
            });

            const allRoleIds = [...new Set(allRoleMappings.map(rm => rm.roleId))];
            const allRoles = await Role.find({
                where: { id: { inq: allRoleIds } }
            });

            // Create lookup maps
            const roleMap = {};
            allRoles.forEach(role => {
                roleMap[role.id] = role;
            });

            const userRoleMap = {};
            allRoleMappings.forEach(mapping => {
                if (!userRoleMap[mapping.principalId]) {
                    userRoleMap[mapping.principalId] = [];
                }
                if (roleMap[mapping.roleId]) {
                    userRoleMap[mapping.principalId].push(roleMap[mapping.roleId]);
                }
            });

            // 7. Prepare response
            const usersWithRoles = users.map(user => {
                const userRoles = userRoleMap[user.id] || [];

                return {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    fullName: user.fullName,
                    avatar: user.avatar,
                    isActive: user.isActive,
                    lastLoginAt: user.lastLoginAt,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                    roles: userRoles.map(role => ({
                        id: role.id,
                        name: role.name,
                        description: role.description
                    })),
                    roleName: userRoles.length > 0 ? userRoles[0].name : 'Không có vai trò'
                };
            });

            // 8. Add security headers
            res.set({
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Cache-Control': 'private, max-age=300'
            });

            // 9. Return response
            const response = {
                success: true,
                data: usersWithRoles,
                pagination: {
                    page: page,
                    limit: limit,
                    total: totalCount,
                    totalPages: Math.ceil(totalCount / limit)
                },
                timestamp: new Date().toISOString()
            };

            res.json(response);

        } catch (error) {
            console.error('Users list API error:', error);

            const errorId = Math.random().toString(36).substr(2, 9);
            console.error(`Error ID: ${errorId}`, {
                path: req.path,
                method: req.method,
                ip: req.ip,
                userId: req.accessToken?.userId,
                error: error.message
            });

            res.status(500).json({
                error: {
                    message: 'Internal server error',
                    errorId: errorId,
                    statusCode: 500
                }
            });
        }
    });

    // API để update user roles (dành cho admin)
    app.put('/api/user/:userId/roles', async function (req, res) {
        try {
            console.log('req.params.userId ', req.params.userId);
            // 1. Rate limiting
            const rateLimitKey = `update_user_roles_${req.ip}`;
            const requestCount = req.app.locals.updateUserRolesRequests = req.app.locals.updateUserRolesRequests || {};
            const now = Date.now();
            const windowMs = 60000; // 1 phút
            const maxRequests = 20; // 20 requests mỗi phút

            if (!requestCount[rateLimitKey]) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            if (now > requestCount[rateLimitKey].resetTime) {
                requestCount[rateLimitKey] = { count: 0, resetTime: now + windowMs };
            }

            requestCount[rateLimitKey].count++;

            if (requestCount[rateLimitKey].count > maxRequests) {
                return res.status(429).json({
                    error: {
                        message: 'Rate limit exceeded. Please try again later.',
                        statusCode: 429
                    }
                });
            }

            // 2. Validate token và quyền admin
            const AccessToken = app.models.AccessToken;
            const User = app.models.User;
            const RoleMapping = app.models.RoleMapping;
            const Role = app.models.Role;
            const Clinic = app.models.Clinic;

            let currentUserId = null;
            let accessToken = null;

            // Kiểm tra token từ header hoặc query
            const authHeader = req.headers['authorization'];
            const queryToken = req.query.access_token;

            if (authHeader) {
                accessToken = await AccessToken.findById(authHeader);
                if (accessToken) {
                    currentUserId = accessToken.userId;
                }
            } else if (queryToken) {
                accessToken = await AccessToken.findById(queryToken);
                if (accessToken) {
                    currentUserId = accessToken.userId;
                }
            }

            if (!currentUserId) {
                return res.status(401).json({
                    error: {
                        message: 'Authentication required',
                        statusCode: 401
                    }
                });
            }

            // 3. Get domain và validate clinic (tương tự /api/index)
            const domain = req.headers.host.toLowerCase();
            console.log('domain ', domain);

            // Cho phép test trên localhost/register/dangky với clinic mặc định
            let clinic = null;

            if (domain.includes('localhost') || domain.includes('register') || domain.includes('dangky')) {
                // Với localhost, tạo clinic ảo hoặc sử dụng clinic mặc định
                clinic = {
                    id: 'localhost',
                    name: 'Development Clinic',
                    domain: domain,
                    isActive: true
                };
            } else {
                clinic = await Clinic.findOne({
                    where: { domain }
                });

                if (!clinic) {
                    return res.status(404).json({
                        error: {
                            message: 'Clinic not found',
                            statusCode: 404
                        }
                    });
                }
            }

            // 4. Validate current user có quyền admin (cập nhật cho localhost)
            let currentUserWhereCondition = { id: currentUserId };
            if (clinic.id !== 'localhost') {
                currentUserWhereCondition.clinicId = clinic.id;
            }

            console.log('currentUserWhereCondition ', currentUserWhereCondition);

            const currentUser = await User.findOne({
                where: currentUserWhereCondition
            });

            console.log('currentUser ', currentUser);

            if (!currentUser) {
                return res.status(404).json({
                    error: {
                        message: 'Current user not found',
                        statusCode: 404
                    }
                });
            }

            // Check if current user has admin role
            const currentUserRoleMappings = await RoleMapping.find({
                where: { principalId: currentUserId }
            });

            const currentUserRoleIds = [...new Set(currentUserRoleMappings.map(rm => rm.roleId))];
            const currentUserRoles = await Role.find({
                where: { id: { inq: currentUserRoleIds } }
            });

            const isAdmin = currentUserRoles.some(role =>
                role.name && (role.name.toLowerCase().includes('admin') ||
                    role.name.toLowerCase().includes('super admin'))
            );

            if (!isAdmin) {
                return res.status(403).json({
                    error: {
                        message: 'Admin permission required',
                        statusCode: 403
                    }
                });
            }

            // 5. Validate target user (cập nhật cho localhost)
            const targetUserId = req.params.userId;
            let targetUserWhereCondition = { id: targetUserId };
            if (clinic.id !== 'localhost') {
                targetUserWhereCondition.clinicId = clinic.id;
            }
            console.log('targetUserWhereCondition3 ', targetUserWhereCondition);
            const targetUser = await User.findOne({
                where: { id: targetUserWhereCondition.id }
            });

            console.log('targetUser ', targetUser);

            if (!targetUser) {
                return res.status(404).json({
                    error: {
                        message: 'Target user not found',
                        statusCode: 404
                    }
                });
            }

            // 6. Validate request body
            const { roleIds } = req.body;

            if (!Array.isArray(roleIds)) {
                return res.status(400).json({
                    error: {
                        message: 'roleIds must be an array',
                        statusCode: 400
                    }
                });
            }

            // Validate that all role IDs exist
            if (roleIds.length > 0) {
                const existingRoles = await Role.find({
                    where: { id: { inq: roleIds } }
                });

                if (existingRoles.length !== roleIds.length) {
                    return res.status(400).json({
                        error: {
                            message: 'Some role IDs are invalid',
                            statusCode: 400
                        }
                    });
                }
            }

            // 7. Delete existing role mappings
            const existingMappings = await RoleMapping.find({
                where: { principalId: targetUserId }
            });

            for (const mapping of existingMappings) {
                await RoleMapping.destroyById(mapping.id);
            }

            // 8. Create new role mappings
            const newMappings = [];
            for (const roleId of roleIds) {
                const newMapping = await RoleMapping.create({
                    principalType: 'USER',
                    principalId: targetUserId,
                    roleId: roleId
                });
                newMappings.push(newMapping);
            }

            // 9. Prepare response
            const updatedRoles = await Role.find({
                where: { id: { inq: roleIds } }
            });

            const sanitizedRoles = updatedRoles.map(role => ({
                id: role.id,
                name: role.name,
                description: role.description
            }));

            // 10. Add security headers
            res.set({
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Cache-Control': 'no-cache'
            });

            // 11. Return response
            const response = {
                success: true,
                data: {
                    userId: targetUserId,
                    roles: sanitizedRoles,
                    timestamp: new Date().toISOString()
                }
            };

            res.json(response);

        } catch (error) {
            console.error('Update user roles API error:', error);

            const errorId = Math.random().toString(36).substr(2, 9);
            console.error(`Error ID: ${errorId}`, {
                path: req.path,
                method: req.method,
                ip: req.ip,
                userId: req.accessToken?.userId,
                error: error.message
            });

            res.status(500).json({
                error: {
                    message: 'Internal server error',
                    errorId: errorId,
                    statusCode: 500
                }
            });
        }
    });



    app.get('/news/:category/:name', function (req, res) {
        const category = req.params.category;
        const name = req.params.name;

        console.log(`Fetching news: category=${category}, name=${name}`);

        // Tạo filter để tìm tin tức
        const filter = {
            where: {
                and: [
                    {
                        or: [
                            { slug: name },
                            { name: { like: '%' + name + '%' } }
                        ]
                    }
                ]
            },
            include: ['category', 'author', 'tags']
        };

        // Nếu có category, thêm điều kiện tìm kiếm
        if (category && category !== 'uncategorized') {
            filter.where.and.push({
                or: [
                    { categorySlug: category },
                    { category: category }
                ]
            });
        }

        // Sử dụng pdfHandler để render template
        pdfHandler.generateFromTemplate(
            'news-detail', // Template name
            filter, // Filter data
            'News', // Model name
            res,
            req,
            function (html) {
                // Custom response handler
                res.set({
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'public, max-age=300'
                });
                res.send(html);
            }
        );
    });

    // Route để serve sitemap.xml từ Template model
    // app.get('/sitemap.xml', function (req, res) {
    //     const Template = app.models.Template;

    //     Template.findOne({ 
    //         where: { 
    //             name: 'sitemap.xml',
    //             isActive: true 
    //         } 
    //     }, function(err, template) {
    //         if (err) {
    //             console.error('Error fetching sitemap template:', err);
    //             return res.status(500).send('Internal Server Error');
    //         }

    //         if (!template || !template.content) {
    //             console.log('Sitemap template not found or empty');
    //             return res.status(404).send('Sitemap not found');
    //         }

    //         // Set proper headers for XML sitemap
    //         res.set({
    //             'Content-Type': 'application/xml; charset=utf-8',
    //             'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    //             'Last-Modified': template.updatedAt ? new Date(template.updatedAt).toUTCString() : new Date().toUTCString()
    //         });

    //         res.send(template.content);
    //     });
    // });
    /**
     * API: Thêm stockItem cho tất cả sản phẩm trong Product
     * POST /api/stock-items/generate-for-all-products
     */
    app.post('/api/generate-for-all-products', async function (req, res) {
        try {
            const Product = app.models.Product;
            const StockItem = app.models.StockItem;

            // Lấy tất cả sản phẩm
            const products = await Product.find({});

            if (!products || products.length === 0) {
                return res.status(404).json({ message: 'Không tìm thấy sản phẩm nào.' });
            }

            // Lấy danh sách StockItem hiện có và tạo một map để tra cứu nhanh
            const existingStockItems = await StockItem.find({
                where: { productId: { inq: products.map(p => p.id) } }
            });
            const existingStockItemsMap = new Map(
                existingStockItems.map(item => [String(item.productId), item])
            );

            const now = new Date();
            const stockItemsToCreate = [];
            const updatePromises = [];

            // Duyệt qua tất cả sản phẩm để quyết định tạo mới hay cập nhật
            for (const product of products) {
                const productData = {
                    price: product.price,
                    brand: product.brand,
                    category: product.category,
                    name: product.name,
                    serialNo: product.serialNo,
                    type: product.type,
                    totalPrice: product.price * 1, // Giả sử quantity là 1
                    updatedAt: now
                };

                const existingItem = existingStockItemsMap.get(String(product.id));

                if (existingItem) {
                    // Nếu đã tồn tại, thêm vào danh sách cập nhật
                    updatePromises.push(existingItem.updateAttributes(productData));
                } else {
                    // Nếu chưa tồn tại, thêm vào danh sách tạo mới
                    stockItemsToCreate.push({
                        ...productData,
                        minLevel: 0,
                        productId: product.id,
                        quantity: 1,
                        warehouseQuantity: {},
                        openingQuantity: 0,
                        allocatedQuantity: 0,
                        orderedQuantity: 0,
                        createdAt: now,
                        isActive: true,
                        minQuantity: 0,
                        location: '',
                        notes: ''
                    });
                }
            }

            // Thực hiện tạo mới và cập nhật
            const creationPromise = stockItemsToCreate.length > 0
                ? StockItem.create(stockItemsToCreate)
                : Promise.resolve([]);

            const [createdItems] = await Promise.all([
                creationPromise,
                ...updatePromises
            ]);

            const createdCount = Array.isArray(createdItems) ? createdItems.length : (createdItems ? 1 : 0);
            const updatedCount = updatePromises.length;

            if (createdCount === 0 && updatedCount === 0) {
                return res.status(200).json({ message: 'Tất cả stockItem đã được cập nhật và không có sản phẩm mới nào.' });
            }

            return res.status(200).json({
                message: `Hoàn tất: Đã tạo ${createdCount} stockItem mới và cập nhật ${updatedCount} stockItem.`,
            });

        } catch (error) {
            console.error('Lỗi khi tạo hoặc cập nhật stockItem:', error);
            return res.status(500).json({ message: 'Đã xảy ra lỗi khi xử lý.', error: error.message });
        }
    });




    app.get('/api/facebook-chat-webhook', async function (req, res) {
        try {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const VERIFY_TOKEN = 'LIVE1WEBHOOK'

        if (!mode || !token) {
            console.warn('[FB][GET] Missing mode or token', { mode: !!mode, token: !!token });
            return res.sendStatus(400);
        }

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {

            return res.status(200).send(challenge);
        }

        console.warn('[FB][GET] Verification failed', { mode, tokenMatched: token === VERIFY_TOKEN });
        return res.sendStatus(403);
        } catch (error) {
            console.error('Lỗi khi xử lý webhook Facebook:', error);
            return res.status(500).json({ message: 'Đã xảy ra lỗi khi xử lý webhook Facebook.', error: error.message });
        }
    });

    // Facebook Messenger webhook receiver
    app.post('/api/facebook-chat-webhook', async function (req, res) {
        try {
            // ===== DOMAIN VALIDATION - Fix race condition =====
            const domain = req.headers.host.toLowerCase().split('.')[0];
            const Clinic = app.models.Clinic;

            // Tìm clinic theo domain
            let clinicByDomain = await Clinic.findOne({
                where: { shortName: domain }
            });

            if (!clinicByDomain) {
                console.warn(`[FB] Clinic not found for domain: ${domain} - webhook will be processed but may cause race condition`);
                // Không return ngay, để code tiếp tục xử lý với clinic từ page resolution
                // Nhưng sẽ log warning để biết có thể có race condition
            } else {
                console.log(`[FB] Processing webhook for clinic: ${clinicByDomain.shortName} (${clinicByDomain.name}), domain: ${domain}`);
            }
            // ===== END DOMAIN VALIDATION =====

            const body = req.body;
            if (!body || body.object !== 'page') {
                console.warn('[FB][POST] Invalid body.object', { hasBody: !!body, object: body && body.object });
                return res.sendStatus(404);
            }

            // Ack ngay để FB không retry
            res.status(200).send('EVENT_RECEIVED');

            const Lead = app.models.Lead;
            const Message = app.models.Message;

            const getUserProfile = async (psid, accessToken) => {
                if (!accessToken) return null;
                try {
                    const url = `https://graph.facebook.com/v24.0/${psid}`;
                    const resp = await axios.get(url, {
                        params: {
                            fields: 'first_name,last_name,profile_pic',
                            access_token: accessToken
                        }
                    });
                    return resp.data || null;
                } catch (err) {
                    console.error('[FB] getUserProfile error:', err.response?.data || err.message);
                    return;
                }
            };

            const findOrCreateLeadByPsid = async (psid, options = {}) => {
                // Dùng field động như Zalo (model base cho phép nới lỏng)
                const {
                    clinicShortName,
                    facebookPageId,
                    facebookPageName,
                    pageToken
                } = options;

                // Filter theo clinicId để tránh race condition - chỉ tìm Lead thuộc clinic này
                let lead = await Lead.findOne({
                    where: {
                        facebookId: psid,
                        clinicShortName: clinicShortName || clinicByDomain?.shortName  // Filter theo clinicId
                    }
                });

                if (lead) {
                    const needsUpdate =
                        (!lead.clinicShortName && clinicShortName) ||
                        (!lead.facebookPageId && facebookPageId) ||
                        (!lead.facebookPageName && facebookPageName);
                    if (needsUpdate) {
                        await lead.updateAttributes({
                            clinicShortName: lead.clinicShortName || clinicShortName || clinicByDomain?.shortName,
                            facebookPageId: lead.facebookPageId || facebookPageId,
                            facebookPageName: lead.facebookPageName || facebookPageName
                        });
                        lead = await Lead.findById(lead.id);
                    }
                    return lead;
                }

                // Lấy profile để làm tên/ảnh
                const profile = await getUserProfile(psid, pageToken || fallbackFacebookPageToken);
                const displayName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'Facebook User';
                const avatar = profile?.profile_pic;

                // Gán clinicId khi tạo Lead mới để tránh race condition
                lead = await Lead.create({
                    facebookId: psid,
                    clinicShortName: clinicShortName || clinicByDomain?.shortName,  // Gán clinicId
                    name: displayName || 'Facebook User',
                    fullName: displayName || 'Facebook User',
                    avatar: avatar,
                    status: 'new',
                    sourceOfLead: 'Facebook Chat',
                    facebookPageId: facebookPageId || null,
                    facebookPageName: facebookPageName || null
                });

                return lead;
            };

            const saveIncomingMessage = async (lead, psid, fbEvent, options = {}) => {
                const { clinicShortName, facebookPageId } = options;
                const msg = fbEvent.message || {};
                const attachments = msg.attachments || [];
                const isEcho = !!msg.is_echo;
                const mid = msg.mid || null;



                // Chống trùng theo mid - thêm clinicId vào duplicate check
                if (mid) {
                    const dup = await Message.findOne({
                        where: {
                            fbMid: mid,
                            facebookId: psid,
                            //   clinicShortName: clinicShortName || clinicByDomain?.shortName || lead.clinicShortName  // Thêm clinicId vào duplicate check
                        }
                    });
                    if (dup) {
                        return null;
                    }
                }

                const base = {
                    leadId: lead.id,
                    clinicShortName: clinicShortName || clinicByDomain?.shortName || lead.clinicShortName,  // Gán clinicId để filter trong WebSocket
                    facebookId: psid,
                    fbMid: mid,
                    message: fbEvent, // lưu raw event để đối soát khi cần

                    facebookPageId: facebookPageId || lead.facebookPageId
                };

                // Text
                if (typeof msg.text === 'string' && msg.text.length > 0) {
                    const created = await Message.create({
                        ...base,
                        type: 'text',
                        content: msg.text,
                        fromId: isEcho ? undefined : lead.id,
                        toId: undefined,
                        toLeadId: isEcho ? lead.id : undefined
                    });
                    return created;
                }

                // Image/File/Other
                if (attachments.length > 0) {
                    const att = attachments[0];
                    if (att.type === 'image') {
                        const created = await Message.create({
                            ...base,
                            type: 'image',
                            content: att.payload?.url || '',
                            imageUrl: att.payload?.url,
                            fromId: isEcho ? undefined : lead.id,
                            toId: undefined,
                            toLeadId: isEcho ? lead.id : undefined
                        });
                        return created;
                    }
                    if (att.type === 'file' || att.type === 'audio' || att.type === 'video') {
                        const created = await Message.create({
                            ...base,
                            type: 'file',
                            content: att.payload?.url || '',
                            fileUrl: att.payload?.url,
                            fromId: isEcho ? undefined : lead.id,
                            toId: undefined,
                            toLeadId: isEcho ? lead.id : undefined
                        });
                        return created;
                    }
                }

                // Fallback unknown
                const created = await Message.create({
                    ...base,
                    type: 'unknown',
                    content: JSON.stringify(msg || {}),
                    fromId: isEcho ? undefined : lead.id,
                    toId: undefined,
                    toLeadId: isEcho ? lead.id : undefined
                });
                return created;
            };

            for (const entry of body.entry || []) {
                const pageId = entry.id;
                const resolved = await resolveClinicFacebookPage({ pageId });
                const clinic = resolved?.clinic || null;
                const pageMeta = resolved?.pageMeta || (fallbackFacebookPageToken
                    ? {
                        pageId,
                        pageToken: fallbackFacebookPageToken,
                        pageName: 'Default Facebook Page'
                    }
                    : null);

                if (!pageMeta) {
                    console.warn('[FB] No Facebook page token configured for page:', pageId);
                    return;
                }

                const events = entry.messaging || [];

                for (const event of events) {
                    try {
                        // Kiểm tra xem có phải echo message (page gửi tới user) không
                        const msg = event?.message || {};
                        const isEcho = !!msg.is_echo;

                        // Logic lấy PSID:
                        // - Nếu là echo (page gửi): lấy recipient.id (user PSID)
                        // - Nếu không phải echo (user gửi): lấy sender.id (user PSID)
                        const psid = isEcho
                            ? event?.recipient?.id
                            : event?.sender?.id;

                        if (!psid) {
                            continue;
                        }

                        // Ưu tiên clinic từ domain validation, fallback về clinic từ page resolution
                        const finalClinicShortName = clinicByDomain?.shortName || clinic?.shortName;

                        const lead = await findOrCreateLeadByPsid(psid, {
                            clinicShortName: finalClinicShortName,
                            facebookPageId: pageMeta.pageId,
                            facebookPageName: pageMeta.pageName,
                            pageToken: pageMeta.pageToken
                        });

                        if (event.message) {
                            await saveIncomingMessage(lead, psid, event, {
                                clinicShortName: finalClinicShortName,
                                facebookPageId: pageMeta.pageId
                            });
                        } else if (event.postback?.payload) {
                            // Lưu postback như text để hiện trong chat
                            await Message.create({
                                leadId: lead.id,
                                clinicShortName: finalClinicShortName || lead.clinicShortName,  // Đảm bảo có clinicId
                                facebookId: psid,
                                type: 'text',
                                content: `[Postback] ${event.postback.payload}`,
                                message: event,
                                toId: undefined,
                                fromId: lead.id,
                                clinicShortName: clinic?.shortName || lead.clinicShortName,
                                facebookPageId: pageMeta.pageId || lead.facebookPageId
                            });

                        } else {
                            console.log('[FB] Unsupported event:', JSON.stringify(event));
                        }
                    } catch (err) {
                        console.error('[FB] Event processing error:', err);
                    }
                }
            };
        } catch (err) {
            console.error('[FB] Webhook error:', err);
            // không đổi response vì đã res ở trên
        }
    });



    app.post('/api/facebook-chat-webhook/send', async function (req, res) {
        try {
            const {
                facebookId,
                message,
                messageType,
                imageUrl,
                fileUrl,
                fileName
            } = req.body;

            if (!facebookId) {
                return res.status(400).json({ error: 'Missing facebookId' });
            }

            const finalMessageType = messageType || 'text';

            // Validation theo từng loại message
            if (finalMessageType === 'image' && !imageUrl) {
                return res.status(400).json({
                    error: 'Missing imageUrl for image message'
                });
            }

            if (finalMessageType === 'file' && !fileUrl) {
                return res.status(400).json({
                    error: 'Missing fileUrl for file message'
                });
            }

            if (finalMessageType === 'text' && !message) {
                return res.status(400).json({
                    error: 'Missing message for text message'
                });
            }

            const url = `https://graph.facebook.com/v23.0/me/messages`;
            const Message = app.models.Message;
            const Lead = app.models.Lead;
            const lead = await Lead.findOne({ where: { facebookId } });
            const clinicShortName = req.body.clinicShortName || lead?.clinicShortName;
            const facebookPageId = req.body.facebookPageId || lead?.facebookPageId;

            const resolved = await resolveClinicFacebookPage({
                clinicShortName,
                pageId: facebookPageId
            });

            const pageMeta = resolved?.pageMeta || (fallbackFacebookPageToken
                ? {
                    pageToken: fallbackFacebookPageToken,
                    pageId: facebookPageId,
                    pageName: 'Default Facebook Page'
                }
                : null);

            if (!pageMeta?.pageToken) {
                return res.status(400).json({ error: 'Missing Facebook Page token for this clinic/page' });
            }

            // Build payload theo chuẩn Facebook Messenger API
            let messagePayload = {
                recipient: { id: facebookId },
                messaging_type: 'RESPONSE'
            };

            let messageData = {
                leadId: lead?.id,
                toId: lead?.id,
                facebookId,
                status: 'sent'
            };

            if (finalMessageType === 'image') {
                // Cấu trúc đúng cho image theo Facebook Messenger API
                messagePayload.message = {
                    attachment: {
                        type: 'image',
                        payload: {
                            url: imageUrl,
                            is_reusable: false
                        }
                    }
                };

                messageData.type = 'image';
                messageData.content = imageUrl;
                messageData.imageUrl = imageUrl;
            } else if (finalMessageType === 'file') {
                // Cấu trúc đúng cho file theo Facebook Messenger API
                messagePayload.message = {
                    attachment: {
                        type: 'file',
                        payload: {
                            url: fileUrl,
                            is_reusable: false
                        }
                    }
                };

                messageData.type = 'file';
                messageData.content = fileName || fileUrl;
                messageData.fileUrl = fileUrl;
                if (fileName) {
                    messageData.fileName = fileName;
                }
            } else {
                // Text message - cấu trúc đúng
                messagePayload.message = {
                    text: message
                };

                messageData.type = 'text';
                messageData.content = message;
            }

            const resp = await axios.post(url, messagePayload, {
                params: { access_token: pageMeta.pageToken }
            });

            // Lưu message gửi đi để đồng bộ UI chat
            if (lead) {
                messageData.fbMid = resp?.data?.message_id;
                messageData.facebookPageId = lead.facebookPageId || pageMeta.pageId || null;
                await Message.create(messageData);
            }

            return res.json({ success: true, result: resp.data });
        } catch (error) {
            console.error('Error sending Facebook message:', error.response?.data || error.message);
            return res.status(500).json({
                error: 'Failed to send Facebook message',
                message: error.response?.data || error.message
            });
        }
    });

    // Lấy lịch sử messages theo facebookId (giống /api/zalo/messages/:zaloId)
    app.get('/api/facebook-chat-webhook/messages/:facebookId', async function (req, res) {
        try {
            const { facebookId } = req.params;
            const limit = parseInt(req.query.limit) || 50;

            const Message = app.models.Message;
            const Lead = app.models.Lead;

            const lead = await Lead.findOne({ where: { facebookId } });
            if (!lead) {
                return res.status(404).json({ error: 'Lead not found' });
            }

            const messages = await Message.find({
                where: {
                    or: [
                        { leadId: lead.id },
                        { facebookId: facebookId }
                    ]
                },
                order: 'createdAt DESC',
                limit: limit
            });

            return res.json({
                success: true,
                lead,
                messages
            });
        } catch (error) {
            console.error('Error getting Facebook messages:', error);
            return res.status(500).json({
                error: 'Failed to get messages',
                message: error.message
            });
        }
    });

    /**
     * API: Lấy translations cho frontend
     * GET /api/translations?lang=vi
     */
    app.get('/api/translations', function (req, res) {
        const subdomain = req.hostname.split('.')[0];
        const lang = req.query.lang || req.cookies?.lang || 'vi';

        i18n.loadTranslationsAsync(subdomain, lang)
            .then(translations => {
                res.json({
                    success: true,
                    tenant: subdomain,
                    language: lang,
                    translations: translations
                });
            })
            .catch(error => {
                console.error('Error loading translations:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to load translations',
                    message: error.message
                });
            });
    });

    /**
     * API: Lấy danh sách ngôn ngữ có sẵn
     * GET /api/languages
     */
    app.get('/api/languages', function (req, res) {
        try {
            const languages = i18n.getAvailableLanguages();
            res.json({
                success: true,
                languages: languages
            });
        } catch (error) {
            console.error('Error getting languages:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get languages'
            });
        }
    });

    /**
     * API: Xóa cache translations (admin only - TODO: thêm authentication)
     * POST /api/translations/clear-cache
     */
    app.post('/api/translations/clear-cache', function (req, res) {
        // TODO: Thêm authentication check ở đây

        const lang = req.body.lang || null;

        try {
            i18n.clearCache(null, lang);
            res.json({
                success: true,
                message: 'Cache cleared successfully'
            });
        } catch (error) {
            console.error('Error clearing cache:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to clear cache'
            });
        }
    });




    app.post('/api/ai/apply-fields', async function (req, res) {
        try {
            const {
                model,
                recordId,
                targetFields,
                data = {},
                prompt,
                waitForResult = false,
                responseKey = null
            } = req.body || {};
    
            if (!model || !recordId || !targetFields || typeof targetFields !== 'object') {
                return res.status(400).send({
                    isSuccess: false,
                    errMsg: 'model, recordId và targetFields (object) là bắt buộc'
                });
            }
    
            const Model = app.models[model];
            if (!Model) {
                return res.status(400).send({
                    isSuccess: false,
                    errMsg: `Không tìm thấy model ${model}`
                });
            }
    
            const record = await Model.findById(recordId);
            if (!record) {
                return res.status(404).send({
                    isSuccess: false,
                    errMsg: `Không tìm thấy bản ghi ${recordId}`
                });
            }
    
            const fieldList = Object.keys(targetFields);
            if (!fieldList.length) {
                return res.status(400).send({
                    isSuccess: false,
                    errMsg: 'targetFields phải chứa ít nhất một field'
                });
            }
    
            const defaultPrompt = [
                'Bạn là AI chuẩn hóa hồ sơ bệnh án.',
                `JSON dữ liệu đầu vào: ${JSON.stringify(data, null, 2)}.`,
                `Hãy trả về JSON với các khóa: ${fieldList.join(', ')}.`,
                'Nếu không xác định được giá trị thì trả về chuỗi rỗng.',
                'Chỉ trả về JSON hợp lệ.'
            ].join('\n');
    
            const job = {
                prompt: prompt || defaultPrompt,
                payload: data,
                waitForResult,
                responseKey,
                jobId: undefined,
                systemPrompt: 'Bạn luôn trả JSON chuẩn',
                meta: {
                    modelName: model,
                    recordId,
                    targetFields
                }
            };
    
            aiQueue.pushJob(job, async function (err, result) {
                if (err) {
                    console.error('AI job error:', err);
                    return res.status(500).send({
                        isSuccess: false,
                        errMsg: err.message || 'AI job failed'
                    });
                }
    
                if (waitForResult === false) {
                    return res.send({
                        isSuccess: true,
                        result: result,
                        errMsg: ''
                    });
                }
    
                let aiOutput = result && result.response ? result.response : result;
    
                var extractJsonString = function (text) {
                    if (typeof text !== 'string') {
                        return text;
                    }
                    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
                    if (fenced && fenced[1]) {
                        return fenced[1].trim();
                    }
                    return text.trim();
                };
    
                if (typeof aiOutput === 'string') {
                    try {
                        aiOutput = JSON.parse(extractJsonString(aiOutput));
                    } catch (parseErr) {
                        return res.status(502).send({
                            isSuccess: false,
                            errMsg: 'AI trả về chuỗi không phải JSON hợp lệ',
                            raw: aiOutput
                        });
                    }
                }
    
                const normalizeValue = function (fieldName, value, fieldType) {
                    if (value === undefined || value === null) {
                        return value;
                    }
    
                    const type = (fieldType || '').toLowerCase();
                    if (type === 'number') {
                        const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
                        return Number.isFinite(numeric) ? numeric : undefined;
                    }
    
                    return value;
                };
    
                const getFieldConfig = function (config) {
                    if (config && typeof config === 'object') {
                        return {
                            type: config.type || ''
                        };
                    }
                    return { type: '' };
                };
    
                const updatePayload = {};
                fieldList.forEach(function (field) {
                    // Lấy trực tiếp từ AI response theo tên field
                    const rawValue = aiOutput[field];
                    
                    const config = getFieldConfig(targetFields[field]);
                    const normalizedValue = normalizeValue(field, rawValue, config.type);
                    
                    // Chỉ update nếu có giá trị (bỏ qua undefined, null, empty string)
                    if (normalizedValue !== undefined && normalizedValue !== null && normalizedValue !== '') {
                        updatePayload[field] = normalizedValue;
                    }
                });
    
                if (!Object.keys(updatePayload).length) {
                    return res.status(422).send({
                        isSuccess: false,
                        errMsg: 'AI không trả về giá trị hợp lệ cho field nào',
                        aiOutput: aiOutput
                    });
                }
    
                await record.updateAttributes(updatePayload);
                res.send({
                    isSuccess: true,
                    result: {
                        updatedFields: updatePayload,
                        aiOutput: aiOutput
                    },
                    errMsg: ''
                });
            });
        } catch (error) {
            console.error('apply-fields error:', error);
            res.status(500).send({
                isSuccess: false,
                errMsg: error.message
            });
        }
    });


    app.post('/api/ai/generate', function (req, res) {


        var prompt = req.body.prompt;
        var systemPrompt = req.body.systemPrompt;


        if (!prompt) {
            return res.json({
                success: false,
                error: 'Missing prompt'
            })
        }

        console.log('Received AI request:', prompt);

        aiQueue.pushJob({
            prompt: prompt,
            systemPrompt: systemPrompt || 'You are a helpful assistant',
            temperature: 0.7,
            waitForResult: true,
            timeoutSecs: 60
        }, function (err, result) {
            if (err) {
                console.error('Error generating AI response:', err);
                return res.json({
                    success: false,
                    error: 'Failed to generate AI response',
                    message: err.message
                });
            }
            console.log('Generated AI response:', result);
            return res.json({
                success: true,
                result: result
            });
        })


    })



};
