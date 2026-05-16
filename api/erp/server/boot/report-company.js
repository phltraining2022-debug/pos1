var moment = require('moment');

var app = require('../server');
const ServiceDoctorConsultationId = "580479d743a45dd7621b52ea"
const LabTestId = "58aa998333a60c0b0e04a926"
const VirtualSignId = "58a6daf14b3562050ec3cbbd"
const CategoryIdLabtest = "57ef5d6751ce851065e5ce3c"
const getError = (msg, status = 500) => ({ status: status, msg })
const DATEFORMAT = 'DD-MM-YYYY'
const VirtualSignData = [
    { name: "BMI", index: 'BMI' },
    { name: "SPO2", index: 'SPO2' },
    { name: "Blood pressure", index: 'blood1' },
    { name: "Blood pressure", index: 'blood2' },
    { name: "Chest Circumference", index: 'chestCircumference' },
    { name: "HIP Circumference", index: 'circumference' },
    { name: "Exercise", index: 'exercise' },
    { name: "Exercise detail", index: 'exerciseDetail' },
    { name: "Per week", index: 'timesExercises' },
    { name: "time per day", index: 'minuteInTimes' },
    { name: "Head Circumference", index: 'headCircumference' },
    { name: "height", index: 'height' },
    { name: "weight", index: 'weight' },
    { name: "pulse", index: 'pulse' },
    { name: "Waist/Hip Ratio", index: 'ratioWH' },
    { name: "Respiration Rate", index: 'respirationRate' },
    { name: "Temperature", index: 'temperature' },
    { name: "Waist Circumference", index: 'waist' },
]
const getListPackages = async (packages) => {
    const Package = app.models.package
    let result = { msg: "null" }
    await Package.find({
        where: {
            id: { inq: packages },
            isActive: true, removed: { neq: true },
        },
        fields: { id: 1, tests: 1 }
    }
    )
        .then((list) => {
            result = list
        })
        .catch(err => {
            result = getError(err.message)
        })
    return (result)
}
const getOrdersItemDoctorConsultation = async orderIds => {
    const OrderItem = app.models.orderItem
    let result = { msg: "null" }
    await OrderItem.find({
        where: {
            orderId: { inq: orderIds },
            serviceId: ServiceDoctorConsultationId,
            isActive: true, removed: { neq: true },
        },
        fields: { id: 1, result: 1, orderId: 1, status: 1, excuteByName: 1 }
    }
    )
        .then((list) => {
            result = list.map(i => ({
                id: i.id,
                doctorName: i.excuteByName,
                certificateConclusion: (!!i.result && !!i.result.certificateConclusion) ? i.result.certificateConclusion : null,
                orderId: i.orderId,
                status: i.status
            }))
        })
        .catch(err => {
            result = getError(err.message)
        })
    return result
}
const getCheckupReport = async (packages) => {
    const Orders = app.models.order
    let result = { msg: "null" }
    await Orders.find({
        where: {
            isActive: true, isRemoved: { neq: true },
            packageId: { inq: packages },
            clinicId: "57d8ce790bf89f8731945b15"
        },
        fields: { orderItems: true, visitId: 1, patientId: 1, id: 1, findings: 1, findingStatus: 1 },
        "include": [
            {
                relation: "visit",
                scope: {
                    fields: { visitDate: 1 }
                }
            },
            {
                relation: "patient",
                scope: {
                    fields: { fullName: 1, DOB: 1, Gender: 1, gender:1 }
                }
            },
            // {
            // relation: "orderItems",
            // scope: {
            //     fields: {
            //         testId: true,
            //         status: true,
            //         result: true,
            //         serviceId: true,
            //         payTypeSyntax: true
            //     }
            // }
            // }
        ],
        "order": "updatedAt desc"
    }
    )
        .then(async (orders) => {
            // get all certificateConclusion
            const certificateConclusions = await getOrdersItemDoctorConsultation(orders.map(i => i.id))
            orders = orders.map(order =>
                ({
                    ...(order.__data || order),
                    ...certificateConclusions.find(certificateConclusion => order.id && certificateConclusion.orderId && order.id.toString() == certificateConclusion.orderId)
                })
            )
            result = orders
        })
        .catch(err => {
            result = getError(err.message)
        })
    return ({ orders: result })
}
const getSamplesInLabtests = async (labTests) => {
    // // console.log(labTests)
    const Sample = app.models.Sample
    let result = { msg: "null" }
    await Sample.find({
        where: { isActive: true, or: [{ id: { inq: labTests } }, { refOrderId: { inq: labTests } }] },
        fields: {
            id: 1, type: 1, isCollected: 1, orderIds: 1, status: 1
        }
    })
        .then((samples) => {
            let dict = {}
            samples.forEach(sample => {
                dict[sample.type] = sample.id
            });
            result = {
                samples: samples.map(i => ({ type: i.type, sampleId: i.id, orderIds: i.orderIds, status: i.isCollected ? "collected" : '' })),
                aarrSamples: dict
            }
        })
        .catch(err => {
            result = getError(err.message)
        })
    return (result)
}
const getNameTests = async (tests) => {
    const Tests = app.models.test
    let result = { msg: "null" }
    await Tests.find({
        where: { isActive: true, id: { inq: tests } },
        fields: {
            id: 1, name: 1, groupId: 1, sampleType: 1, categoryId: 1, referenceTest: 1
        }
    })
        .then((tests) => {
            result = tests
        })
        .catch(err => {
            result = getError(err.message)
        })
    return (result)
}
const getNameServices = async (services) => {
    const Service = app.models.service
    let result = { msg: "null" }
    await Service.find({
        where: { isActive: true, id: { inq: services } },
        fields: {
            id: 1, name: 1
        }
    })
        .then((tests) => {
            result = tests
        })
        .catch(err => {
            result = getError(err.message)
        })
    return (result)
}
const getCheckupStatus = async (packages, limit = 2000, skip = 0) => {
    const Orders = app.models.order
    let result = { msg: "null" }
    await Orders.find({
        limit: limit,
        skip: skip,
        where: {
            isActive: true, isRemoved: { neq: true },
            packageId: { inq: packages },
            clinicId: "57d8ce790bf89f8731945b15"
        },
        fields: { orderItems: true, visitId: 1, patientId: 1, id: 1, findings: 1 },
        "include": [
            {
                relation: "visit",
                scope: {
                    fields: { visitDate: 1 }
                }
            },
            {
                relation: "patient",
                scope: {
                    fields: { fullName: 1, DOB: 1, Gender: 1, gender:1 }
                }
            },
            {
                relation: "orderItems",
                scope: {
                    fields: {
                        testId: true,
                        status: true,
                        serviceId: true,
                        payTypeSyntax: true,
                        type: true,
                        id: 1
                    }
                }
            }
        ],
        "order": "updatedAt desc"
    }
    )
        .then(async (orders) => {
            const packageIds = orders.map(i => i.id)
            // get all certificateConclusion
            const certificateConclusions = await getOrdersItemDoctorConsultation(packageIds)

            orders = orders.map(order =>
                ({
                    ...(order.__data || order),
                    ...(!!certificateConclusions
                        ? certificateConclusions.find(certificateConclusion => order.id.toString() == certificateConclusion.orderId)
                        : [])
                })
            )
            //get distinct orderId with labtest
            let dictOrderIdWithLabtest = {}
            let dictTest = {}
            let dictTestObj = {}
            let dictService = {}
            orders.map(order => {
                const arr = order.orderItems.filter(i => {
                    if (!!i.testId) dictTest[i.testId] = i.testId
                    if (!!i.serviceId) dictService[i.serviceId] = i.serviceId
                    return i.testId == LabTestId
                })
                arr.map(i => dictOrderIdWithLabtest[i.orderId] = 1)
            })
            //get name tests 
            const testObjects = await getNameTests(Object.keys(dictTest))
            let arr = dictTest = {}

            testObjects.forEach(i => {
                dictTestObj[i.id] = i;
                let temp = arr[i.sampleType || i.name]
                if (!!temp) {
                    arr[i.sampleType || i.name] = { ...temp, groupTestId: temp.group.push(i.id) }
                } else {
                    arr[i.sampleType || i.name] = { ...i.__data, group: [i.id] }
                }
            })
            const packageObject = await getListPackages(packages)
            let testsInPackages = {}
            packageObject.forEach(
                i => i.tests.forEach(j => {
                    let temp = JSON.parse(j)
                    testsInPackages[temp.id] = { isOptional: temp.isFree, isAdditional: temp.isOptional }
                })
            );
            testsInPackages['58aa998333a60c0b0e04a926'] = testsInPackages['58a6daf14b3562050ec3cbbd'] = { isOptional: false, isFree: false };

            // testsInPackages = Object.keys(testsInPackages).map(i => ({
            //     testId: i,
            //     ...testsInPackages[i]
            // }))
            console.log(testObjects);
            let arrSamples = [], arrTests = []
            arr = Object.keys(arr).map(i => arr[i])
            if (packages.length == 1)
                arr = arr.map(t => {
                    let isOptional = Boolean(testsInPackages[t.id] && testsInPackages[t.id].isOptional); 
                    let fullTestObj = dictTestObj[t.id];
                    let isAdditional = Boolean(testsInPackages[t.id] && testsInPackages[t.id].isAdditional) || Boolean(!testsInPackages[t.id] && !(fullTestObj && fullTestObj.referenceTest && testsInPackages[fullTestObj.referenceTest]));
                    return {
                        ...t, isOptional, isAdditional
                    }
                })
            arr.forEach(i => {
                if (!!i.sampleType)
                    arrSamples.push(i)
                else
                    arrTests.push(i)
            })
            dictService = await getNameServices(Object.keys(dictService))
            const { samples, aarrSamples } = await getSamplesInLabtests(packageIds)

            //map orders with datasample via orderid
            const resultData = {
                samples,
                // arrSample: Object.keys(arrSamples).map(i => ({ name: i, id: arrSamples[i] })),                
                arrSamples: arrSamples,
                arrTests,
                arrService: dictService,
                patients: orders.map(order => ({
                    ...order,
                    details: [
                        // ...order.orderItems,
                        ...arr.map(i => {
                            let data = {}
                            order.orderItems.forEach(j => {

                                if (!!j.testId) {
                                    if (!!i.group.find(i => j.testId.toString() == i.toString())) {
                                        data = {
                                            status: j.status,
                                            ...i
                                        }
                                    }
                                }
                            })
                            return data
                        }),
                        // ...(samples.filter(i => i.orderIds == order.orderId))
                    ],
                    orderItems: undefined,
                    ...(!!certificateConclusions
                        ? certificateConclusions.find(certificateConclusion => order.id.toString() == certificateConclusion.orderId)
                        : [])
                }))
            }
            result = resultData
        })
        .catch(err => {
            result = getError(err.message)
        })
    return ({ orders: result })
}
const getResultOrdersItems = async orderItemIds => {
    const OrderItem = app.models.orderItem
    let result = { msg: "null" }
    await OrderItem.find({
        where: {
            _id: { inq: orderItemIds },
            isActive: true, removed: { neq: true },
        },
        fields: { id: 1, result: 1, orderId: 1, status: 1, testId: 1 }
    })
        .then((list) => {
            result = list
        })
        .catch(err => {
            result = getError(err.message)
        })
    return result
}
const getSamplesInLabtest = async (labTests) => {
    const Sample = app.models.Sample
    let result = { msg: "null" }
    await Sample.find({
        where: { isActive: true, or: [{ id: { inq: labTests } }, { refOrderId: { inq: labTests } }] },
        fields: {
            id: 1, type: 1, isCollected: 1, orderIds: 1, orderItemIds: 1, status: 1
        }
    })
        .then(async (samples) => {
            // console.log('==========1,2,1')

            const dict = {}
            let orderItemIds = []
            samples.map(sample => {
                dict[sample.id] = { ...sample.__data, orderItemIds: undefined }
                return orderItemIds.push(...sample.orderItemIds)
            })
            // console.log('==========1,2,2')

            const orderItemData = await getResultOrdersItems(orderItemIds)
            // console.log('==========1,2,3', samples.length)

            try {
                result = {
                    samples: samples.map(i => {
                        return ({
                            sampleId: i.id,
                            orderIds: i.orderIds,
                            status: i.isCollected ? "collected" : '',
                            orderItems: i.orderItemIds.map(orderItemId => {
                                let match = {}
                                orderItemData.some(orderItem => {
                                    if (orderItem.id == orderItemId) {
                                        match = orderItem
                                        return true
                                    }
                                })
                                return match
                            })
                        })
                    }),
                    dictSamples: dict
                }
            } catch (error) {
                // console.log(error)
            }
            // console.log('==========1,2,4')

        })
        .catch(err => {
            result = getError(err.message)
        })
    return (result)
}
const getLabTestOnly = async (packages, limit = 2000, skip = 0) => {
    const Orders = app.models.order
    let result = { msg: "null" }
    await Orders.find({
        limit: limit,
        skip: skip,
        where: {
            isActive: true, isRemoved: { neq: true },
            packageId: { inq: packages },
            clinicId: "57d8ce790bf89f8731945b15"
        },
        fields: { orderItems: true, visitId: 1, patientId: 1, id: 1, findings: 1 },
        "include": [
            {
                relation: "visit",
                scope: {
                    fields: { visitDate: 1 }
                }
            },
            {
                relation: "patient",
                scope: {
                    fields: { fullName: 1, DOB: 1, Gender: 1, gender:1 }
                }
            },
            {
                relation: "orderItems",
                scope: {
                    fields: {
                        testId: true,
                        status: true,
                        serviceId: true,
                        payTypeSyntax: true,
                        result: 1
                    }
                }
            }
        ],
        "order": "updatedAt desc"
    }
    )
        .then(async (orders) => {
            // get all certificateConclusion
            const certificateConclusions = await getOrdersItemDoctorConsultation(orders.map(i => i.id))

            orders = orders.map(order =>
                ({
                    ...(order.__data || order),
                    ...(!!certificateConclusions
                        ? certificateConclusions.find(certificateConclusion => order.id && order.id.toString() == certificateConclusion.orderId)
                        : [])
                })
            )
            //get distinct orderId with labtest
            let dictOrderIdWithLabtest = {}
            let dictTest = {}
            let dictService = {}
            orders.map(order => {
                const arr = order.orderItems.filter(i => {
                    if (!!i.testId) dictTest[i.testId] = i.testId
                    if (!!i.serviceId) dictService[i.serviceId] = i.serviceId
                    return i.testId == LabTestId
                })
                arr.map(i => dictOrderIdWithLabtest[i.orderId] = 1)
            })
            // console.log('==========1')

            const { samples, dictSamples } = await getSamplesInLabtest(Object.keys(dictOrderIdWithLabtest))
            // console.log('==========1,2')

            dictTest = await getNameTests(Object.keys(dictTest))
            // console.log('==========2')

            dictService = await getNameServices(Object.keys(dictService))
            // console.log('==========3')

            packages = await getListPackages(packages)
            let testsInPackages = {}
            packages.forEach(
                i => i.tests.forEach(j => {
                    let temp = JSON.parse(j)
                    testsInPackages[temp.id] = { isOptional: temp.isFree, isAdditional: temp.isOptional }
                })
            );
            testsInPackages['58aa998333a60c0b0e04a926'] = testsInPackages['58a6daf14b3562050ec3cbbd'] = { isOptional: false, isFree: false };

            // console.log('==========4')
            let sample = (Object.keys(dictSamples).map(i => ({ ...dictSamples[i], name: dictSamples[i].type, type: undefined, id: i })))
            if (packages.length > 0)
                sample = sample.map(t => {
                    let isOptional = Boolean(testsInPackages[t.id] && testsInPackages[t.id].isOptional);
                    let isAdditional = Boolean(testsInPackages[t.id] && testsInPackages[t.id].isAdditional) || Boolean(!testsInPackages[t.id] && !(t.referenceTest && testsInPackages[t.referenceTest]) );
                    return {
                        ...t, isOptional, isAdditional
                    }
                })
            //let arrTest = dictTest.filter(i => !!i.sampleType)
            let arrTest = dictTest;
            if (packages.length > 0)
                arrTest = arrTest.map(t => {
                    let isOptional = Boolean(testsInPackages[t.id] && testsInPackages[t.id].isOptional);
                    let isAdditional = Boolean(testsInPackages[t.id] && testsInPackages[t.id].isAdditional) || Boolean(!testsInPackages[t.id] && !(t.referenceTest && testsInPackages[t.referenceTest]));
                    return {
                        ...t.__data, isOptional, isAdditional
                    }
                })
            result = {
                sample,
                arrTest,
                arrService: dictService,
                patients: orders.map(order => ({
                    ...order,
                    virtualSign: order.orderItems.find(orderItem => orderItem.testId == VirtualSignId),
                    details: [
                        ...(samples.filter(i => i.orderIds && order.orderId && i.orderIds.toString() == order.orderId.toString()))
                    ],
                    // orderLabtest: [
                    //     ...(samples.filter(i => i.orderIds && order.orderId && i.orderIds.toString() != order.orderId.toString()))
                    // ],
                    orderItems: undefined
                }))
            }
        })
        .catch(err => {
            result = getError(err.message)
        })
    return ({ orders: result })
}

module.exports.checkUpReport = async (req, res) => {
    let { packages } = req.query
    try {
        packages = JSON.parse(packages)
    } catch (err) {
        err = getError(err.message)
        res.status(err.status).json(err)
        return
    }

    if (!!packages) { // get all package
        const result = await getCheckupReport(packages)
        const { orders } = result, total = orders.length, completed = (orders.filter(i => i.status === 'completed')).length
        res.status(200).json({
            summary: {
                total, completed
            },
            details: orders
            // .map(i => ({
            //     patientId: i.packageId,
            //     visitId: i.visitId,
            //     findings: i.findings,
            //     certificateConclusion: i.certificateConclusion,
            //     orderId: i.orderId,
            //     status: i.status,
            //     visitDate: (!!i.visit && !!i.visit.visitDate
            //         ? i.visit.visitDate : undefined),
            //     fullName: i.patient.fullName,
            //     DOB: i.patient.DOB
            // }))
        })
        return
    }

    res.json(getError('missing parameter'))
};

module.exports.checkUpStatusLabTestOnly = async (req, res) => {
    let { packages, limit = 2000, skip = 0 } = req.query
    try {
        packages = JSON.parse(packages)
    } catch (err) {
        err = getError(err.message)
        res.status(err.status).json(err)
        return
    }
    if (!!packages) { // get all package
        const result = await getLabTestOnly(packages, limit, skip)
        // const result = await getCheckupStatus(packages, limit, skip)
        const { orders } = result
        // console.log(orders)
        const header = [
            { name: 'No.' },
            { name: 'Show up date' },
            { name: 'Full Name' },
            { name: 'DOB' },
            { name: "Employee Code" },
            { name: 'Gender' },
            ...VirtualSignData.map(i => ({ name: i.name })),
            // ...orders.sample.map(i => ({ name: i.name })),
            ...orders.arrTest.map(i => ({ name: i.name, isOptional: i.isOptional, isAdditional: i.isAdditional })),
            { name: 'certificateConclusion' },
            { name: 'Name of Doctor' },
        ]
        const body = orders.patients.map((patient, index) => {
            return [
                { value: index + 1 },
                { value: (patient.visit && patient.visit.visitDate) ? moment(patient.visit.visitDate).format(DATEFORMAT) : '' },
                { value: patient.patient.fullName || '' },
                { value: patient.patient.DOB ? moment(patient.patient.DOB).format(DATEFORMAT) : '' },
                { value: patient.patient.employeeCode || '', style: 'center' },
                { value: (patient.patient.Gender || patient.patient.gender) == 'male' ? 'M' : 'F', style: 'center' },
                ...VirtualSignData.map(i => ({ value: !!patient.virtualSign && !!patient.virtualSign.result && patient.virtualSign.result[i.index] || '', style: 'center' })),
                ...orders.arrTest.map(test => {
                    let result = { value: '' }
                    patient.details.some(sample => {
                        let match = sample.orderItems.find(orderItem => test.id && orderItem.testId && test.id.toString() == orderItem.testId.toString())
                        if (match) {
                            result = { value: match.result }
                            return true
                        }
                    })
                    return result
                }),

                { value: patient.certificateConclusion, style: 'center' },
                { value: patient.doctorName }
            ]
        })
        res.status(200).json({ header, body })
        return
    }
    res.json(getError('missing parameter'))
};

module.exports.checkUpStatus = async (req, res) => {
    let { packages, limit = 2000, skip = 0, labTestOnly } = req.query
    try {
        packages = JSON.parse(packages)
    } catch (err) {
        err = getError(err.message)
        res.status(err.status).json(err)
        return
    }

    if (!!packages) { // get all package
        const result = await getCheckupStatus(packages, limit, skip)
        const { orders } = result
        const header = [
            { name: 'No.' },
            { name: 'Show up date' },
            { name: 'Full Name' },
            { name: 'DOB' },
            { name: "Employee Code" },
            { name: 'Gender', style: 'center' },
            ...orders.arrSamples.map(i => ({ name: i.sampleType, id: i.sampleId, style: 'center' })),
            ...orders.arrTests.map(i => ({ name: i.name, isOptional: i.isOptional, isAdditional: i.isAdditional, style: 'center' })),
            ...orders.arrService,
            { name: 'certificateConclusion', style: 'center' },
            { name: 'Name of Doctor', style: 'center' },
        ]
        let body = orders.patients.map((patient, index) => {
            return [
                { value: index + 1 },
                { value: (patient.visit && patient.visit.visitDate) ? moment(patient.visit.visitDate).format(DATEFORMAT) : '' },
                { value: patient.patient.fullName || '' },
                { value: patient.patient.DOB ? moment(patient.patient.DOB).format(DATEFORMAT) : '' },
                { value: patient.patient.employeeCode || '', style: 'center' },
                { value: (patient.patient.Gender || patient.patient.gender) == 'male' ? 'M' : 'F', style: 'center' },
                ...orders.arrSamples.map(s => {
                    let t = orders.samples.find(d =>
                        s.type == d.sampleType && (d.orderIds && patient.orderId && d.orderIds.toString() == patient.orderId.toString()));
                    return { value: (t && t.status) || '', style: 'center' }
                }),
                ...orders.arrTests.map(s => { let t = patient.details.find(d => s.id == d.id); return { value: (t && t.status == 'done' ? 'x' : ''), style: 'center' } }),
                ...orders.arrService.map(s => ({ value: s.id == ServiceDoctorConsultationId ? patient.status : s.status, style: 'center' })),
                { value: patient.certificateConclusion, style: 'center' },
                { value: patient.doctorName }
            ]
        })
        res.status(200).json({ header, body })
        return
    }
    res.json(getError('missing parameter'))
};



