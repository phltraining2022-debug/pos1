var schedule = require('node-schedule');
var loopback = require('loopback');
var _ = require('underscore');
var moment = require('moment');
var app = require('../server');
var emailHandler = require('./email');
var smsHandler = require('./sms');
var _ = require('underscore');
const { syncLeads } = require('./sync-data-lead');

module.exports = function (app) {

    if (process.env.NODE_APP_INSTANCE === '0') {
        const X_HOURS = 24; 
        console.log('Cron Job được kích hoạt trên MAIN INSTANCE (ID 0).');

        // Cronjob mỗi phút kiểm tra booking quá hạn chưa thanh toán và gửi nhắc nhở
        var checkOverdueBookingsJob = false && schedule.scheduleJob('*/1 * * * *', async function () {
            console.log('=== Bắt đầu kiểm tra booking quá hạn chưa thanh toán ===');

            try {
                const Booking = app.models.Booking;
                const Lead = app.models.Lead;
                const now = new Date();
                const overdueLimit = new Date(now.getTime() - X_HOURS * 72 * 60 * 1000); // X_HOURS giờ trước

                const overdueBookings = await Booking.find({
                    where: {
                        and: [
                            { status: 'pending' },
                            { createdAt: { lt: overdueLimit } }
                        ]
                    },
                    include: ['deposits', 'lead']
                });

                for (let booking of overdueBookings) {
                    // Kiểm tra nếu chưa có deposit nào được thanh toán
                    const deposits = booking.deposits() || [];
                    const hasPaidDeposit = deposits.length > 0;

                    if (!hasPaidDeposit) {
                        // Cập nhật trạng thái booking thành 'overdue'
                        booking.status = 'overdue';
                        await booking.save();

                        console.log(`✓ Cập nhật booking ID ${booking.id} thành 'overdue'`);

                        const Notification = app.models.notification;
                        const _lead = booking.lead();
                        const eventDate = moment(booking.date).format('DD/MM/YYYY HH:mm');
                        await Notification.create({
                            title: `Booking quá hạn cọc`,
                            message: `Booking ${_lead.name} ngày ${eventDate}`,
                            type: 'reminder',
                            priority: 'high',
                            isRead: false,
                            icon: 'fas fa-exclamation-triangle',
                            color: 'red',
                            actionUrl: `#/restaurant/booking/edit/${booking.id}`
                        });

                        // Gửi email nhắc nhở khách hàng
                        const lead = booking.lead();
                    }
                }
                
                console.log('=== Hoàn thành kiểm tra booking quá hạn chưa thanh toán ===');
            } catch (error) {
                console.error('Lỗi khi kiểm tra booking quá hạn:', error);
            }
        });


        // Cronjob chạy mỗi ngày lúc 6:00 sáng để tạo reminder sinh nhật và kỷ niệm ngày cưới
        var birthdayAndAnniversaryJob = false && schedule.scheduleJob('0 * * * * *', async function () {
            console.log('=== Bắt đầu tạo reminder sinh nhật và kỷ niệm ngày cưới ===');


            try {
                const Customer = app.models.Customer;
                const Contract = app.models.contract;
                const Reminder = app.models.Reminder;

                // print current db context since we using db context switching 
                // Customer.currentDatasource
                console.log(Customer.currentDatasource);

                
                const today = moment().startOf('day');
                const futureLimit = moment().add(15, 'days').endOf('day'); // Kiểm tra trong vòng 15 ngày tới
                
                // 1. Tạo reminder cho sinh nhật khách hàng
                const customers = await Customer.find({
                    where: {
                        dob: { neq: null }
                    }
                });
                
                let birthdayReminderCount = 0;
                const processedBirthdays = new Set(); // Tránh tạo reminder trùng cho cùng 1 customer
                
                for (let customer of customers) {
                    if (!customer.dob) continue;

                    console.log('Processing customer DOB:', customer.name, customer.dob);
                    
                    const dobMoment = moment(customer.dob);
                    // Lấy sinh nhật năm nay: giữ nguyên ngày/tháng, đổi năm thành năm hiện tại
                    const birthdayThisYear = moment().year(moment().year())
                        .month(dobMoment.month())
                        .date(dobMoment.date())
                        .startOf('day');
                    
                    // Nếu sinh nhật năm nay đã qua, lấy sinh nhật năm sau
                    const birthdayDate = birthdayThisYear.isBefore(today) 
                        ? birthdayThisYear.clone().add(1, 'year') 
                        : birthdayThisYear.clone();
                    
                    // Kiểm tra xem sinh nhật có trong vòng 15 ngày tới không
                    if (birthdayDate.isBetween(today, futureLimit, null, '[]')) {
                        // Tạo key để check duplicate
                        const customerDateKey = `${customer.id}_${birthdayDate.format('YYYY-MM-DD')}`;
                        
                                                // Bỏ qua nếu đã xử lý customer này cho ngày này rồi
                        if (processedBirthdays.has(customerDateKey)) {
                            console.log(`⊗ Bỏ qua - đã xử lý sinh nhật cho KH ${customer.name} ngày ${birthdayDate.format('DD/MM/YYYY')}`);
                            continue;
                        }
                        
                        // Kiểm tra xem đã có reminder chưa - CHẶT CHẼ HƠN
                        const dueDateStart = birthdayDate.clone().startOf('day').toDate();
                        const dueDateEnd = birthdayDate.clone().endOf('day').toDate();
                        
                        console.log(`Checking existing birthday for customer ${customer.id}, date: ${dueDateStart}`);
                        
                        const existingReminder = await Reminder.findOne({
                            where: {
                                and: [
                                    { customerId: customer.id },
                                    { 
                                        dueDate: {
                                            gte: dueDateStart,
                                            lte: dueDateEnd
                                        }
                                    },
                                    {
                                        or: [
                                            { note: { like: '%Sinh nhật%' } },
                                            { note: { like: '%sinh nhật%' } }
                                        ]
                                    }
                                ]
                            }
                        });
                        
                        if (existingReminder) {
                            processedBirthdays.add(customerDateKey);
                            console.log(`⊗ Đã có reminder sinh nhật cho KH: ${customer.name} (Reminder ID: ${existingReminder.id})`);
                            continue;
                        }
                        
                        // Tạo reminder mới
                        const daysUntil = birthdayDate.diff(today, 'days');
                        await Reminder.create({
                            customerId: customer.id,
                            dueDate: birthdayDate.toDate(),
                            status: 'Pending',
                            customerName: customer.name,
                            phoneNumber: customer.phone,
                            note: `Sinh nhật khách hàng ${customer.name} - ${birthdayDate.format('DD/MM/YYYY')} (còn ${daysUntil} ngày)`
                        });
                        birthdayReminderCount++;
                        processedBirthdays.add(customerDateKey);
                        console.log(`✓ Tạo reminder sinh nhật cho KH: ${customer.name} - còn ${daysUntil} ngày`);
                    }
                }
                
                // 2. Tạo reminder cho kỷ niệm ngày cưới
                const weddingContracts = await Contract.find({
                    where: {
                        eventType: 'W',
                        eventDate: { neq: null }
                    },
                    include: ['customer', 'lead']
                });
                
                let anniversaryReminderCount = 0;
                const processedCustomers = new Set(); // Tránh tạo reminder trùng cho cùng 1 customer
                
                for (let contract of weddingContracts) {
                    if (!contract.eventDate) continue;
                    
                    const eventMoment = moment(contract.eventDate);
                    
                    // Tính ngày kỷ niệm các năm tiếp theo
                    let anniversaryDate = null;
                    let yearsAgo = 0;
                    
                    // Tìm ngày kỷ niệm gần nhất (>= 1 năm) trong vòng 15 ngày tới
                    for (let year = 1; year <= 50; year++) {
                        const testDate = moment(eventMoment).add(year, 'years').startOf('day');
                        
                        // Kiểm tra xem ngày kỷ niệm có trong vòng 15 ngày tới không
                        if (testDate.isBetween(today, futureLimit, null, '[]')) {
                            anniversaryDate = testDate;
                            yearsAgo = year;
                            break;
                        }
                        
                        // Nếu đã vượt quá 15 ngày tới thì dừng
                        if (testDate.isAfter(futureLimit)) {
                            break;
                        }
                    }
                    
                    // Chỉ tạo reminder nếu tìm thấy ngày kỷ niệm hợp lệ (>= 1 năm)
                    if (anniversaryDate && yearsAgo >= 1) {
                        // Lấy thông tin khách hàng từ contract hoặc lead
                        let customerId = contract.customerId;
                        let customerName = contract.name || 'Khách hàng';
                        let phoneNumber = '';
                        
                        // Ưu tiên lấy thông tin từ customer relation
                        if (contract.customer && contract.customer()) {
                            const customer = contract.customer();
                            customerId = customer.id;
                            customerName = customer.name;
                            phoneNumber = customer.phone;
                        } else if (contract.lead && contract.lead()) {
                            // Fallback lấy từ lead nếu không có customer
                            const lead = contract.lead();
                            if (!customerId) customerId = lead.customerId;
                            if (lead.name) customerName = lead.name;
                            if (lead.phone) phoneNumber = lead.phone;
                        }
                        
                        // Tạo key để check duplicate (dựa vào customerId và ngày kỷ niệm)
                        const customerDateKey = `${customerId}_${anniversaryDate.format('YYYY-MM-DD')}`;
                        
                        // Bỏ qua nếu đã xử lý customer này cho ngày này rồi
                        if (processedCustomers.has(customerDateKey)) {
                            console.log(`⊗ Bỏ qua contract ${contract.id} - đã có reminder cho KH ${customerName} ngày ${anniversaryDate.format('DD/MM/YYYY')}`);
                            continue;
                        }
                        
                        // Kiểm tra customerId hợp lệ
                        if (!customerId) {
                            console.log(`⚠ Bỏ qua contract ${contract.id} - không có customerId`);
                            continue;
                        }
                        
                        // Kiểm tra xem đã có reminder chưa - CHẶT CHẼ HƠN
                        const dueDateStart = anniversaryDate.clone().startOf('day').toDate();
                        const dueDateEnd = anniversaryDate.clone().endOf('day').toDate();
                        
                        console.log(`Checking existing anniversary for customer ${customerId}, date: ${dueDateStart}`);
                        
                        const existingReminder = await Reminder.findOne({
                            where: {
                                and: [
                                    { customerId: customerId },
                                    { 
                                        dueDate: {
                                            gte: dueDateStart,
                                            lte: dueDateEnd
                                        }
                                    },
                                    {
                                        or: [
                                            { note: { like: '%Kỷ niệm ngày cưới%' } },
                                            { note: { like: '%kỷ niệm ngày cưới%' } }
                                        ]
                                    }
                                ]
                            }
                        });
                        
                        if (existingReminder) {
                            processedCustomers.add(customerDateKey);
                            console.log(`⊗ Đã có reminder kỷ niệm cho KH: ${customerName} (Reminder ID: ${existingReminder.id})`);
                            continue;
                        }
                        
                        // Tạo reminder mới
                        const daysUntil = anniversaryDate.diff(today, 'days');
                        await Reminder.create({
                            customerId: customerId,
                            contractId: contract.id,
                            leadId: contract.leadId,
                            dueDate: anniversaryDate.toDate(),
                            status: 'Pending',
                            customerName: customerName,
                            phoneNumber: phoneNumber,
                            note: `Kỷ niệm ngày cưới ${yearsAgo} năm - ${customerName} - ${anniversaryDate.format('DD/MM/YYYY')} (còn ${daysUntil} ngày)`
                        });
                        anniversaryReminderCount++;
                        processedCustomers.add(customerDateKey);
                        console.log(`✓ Tạo reminder kỷ niệm ${yearsAgo} năm ngày cưới cho: ${customerName} - còn ${daysUntil} ngày`);
                    }
                }
                
                console.log(`=== Hoàn thành: Đã tạo ${birthdayReminderCount} reminder sinh nhật và ${anniversaryReminderCount} reminder kỷ niệm ngày cưới ===`);
                
            } catch (error) {
                console.error('Lỗi khi tạo reminder sinh nhật và kỷ niệm:', error);
            }
        });


        var createLeadSnapshotJob = schedule.scheduleJob('0 0 0 */3 * *', async function () {
            console.log('=== Bắt đầu tạo Lead Snapshot (ATS only) ===');
        
            try {
                // Chỉ chạy cho tenant 'ats'
                const TARGET_TENANT = 'ats';
                
                // Kiểm tra xem datasource 'ats' có tồn tại không
                if (!app.dataSources[TARGET_TENANT]) {
                    console.log(`⚠️ Datasource '${TARGET_TENANT}' không tồn tại, bỏ qua.`);
                    return;
                }
        
                // Attach tất cả models vào datasource 'ats' để đảm bảo query đúng tenant
                const atsDatasource = app.dataSources[TARGET_TENANT];
                Object.keys(app.models).forEach(function(modelName) {
                    const Model = app.models[modelName];
                    Model.attachTo(atsDatasource);
                    Model.currentDatasource = TARGET_TENANT;
                });
        
                console.log(`✓ Đã switch sang datasource: ${TARGET_TENANT}`);
        
                const Lead = app.models.Lead;
                const Snapshot = app.models.Snapshot;
                const moment = require('moment');
        
                // Lấy ngày hiện tại
                const recordDate = moment().format('YYYY-MM-DD');
        
                // Dùng findOrCreate ngay từ đầu để tránh race condition
                // Nếu đã có snapshot thì return luôn, không query leads
                const [snapshot, created] = await Snapshot.findOrCreate(
                    { where: { recordDate: recordDate } },
                    {
                        recordDate: recordDate,
                        data: {
                            modalLead: []
                        }
                    }
                );
        
                // Nếu đã có snapshot rồi thì bỏ qua
                if (!created) {
                    console.log(`✓ Đã có snapshot cho ngày ${recordDate} (tenant: ${TARGET_TENANT}), bỏ qua.`);
                    return;
                }
        
                console.log(`✓ Đã tạo snapshot record cho ngày ${recordDate}, bắt đầu query leads...`);
        
                // Chỉ query leads sau khi đã tạo được snapshot record (tránh race condition)
                // Query tất cả Lead theo batch để tránh quá tải memory
                const QUERY_BATCH_SIZE = 500; // Query 500 leads mỗi lần
                const allLeads = [];
                let skip = 0;
                let hasMore = true;
        
                while (hasMore) {
                    const leads = await Lead.find({
                        limit: QUERY_BATCH_SIZE,
                        skip: skip,
                        include: [
                            { relation: 'office', scope: { fields: ['name', 'id'] } },
                            { relation: 'telesalePerson', scope: { fields: ['name', 'id'] } },
                            { relation: 'counselor', scope: { fields: ['name', 'id'] } },
                            {
                                relation: 'leadCampaigns',
                                scope: { 
                                    include: [{ 
                                        relation: 'campaign',
                                        scope: { fields: ['name', 'id'] }
                                    }] 
                                },
                            },
                            { relation: 'attendedEvents', scope: { fields: ['name', 'id'] } },
                        ],
                    });
        
                    if (leads.length === 0) {
                        hasMore = false;
                    } else {
                        // Chuyển đổi sang plain object
                        const leadsData = leads.map(lead => lead.toJSON());
                        allLeads.push(...leadsData);
                        skip += QUERY_BATCH_SIZE;
                        
                        // Nếu query được ít hơn batch size thì đã hết
                        if (leads.length < QUERY_BATCH_SIZE) {
                            hasMore = false;
                        }
                    }
                }
        
                // Update snapshot với data leads
                snapshot.data = {
                    modalLead: allLeads
                };
                await snapshot.save();
        
                console.log(`✓ Đã tạo snapshot cho ngày ${recordDate} (tenant: ${TARGET_TENANT}) với ${allLeads.length} leads trong 1 document`);
                console.log('=== Hoàn thành tạo Lead Snapshot ===');
        
            } catch (error) {
                console.error('Lỗi khi tạo Lead Snapshot:', error);
            }
        });

    } else {
        console.log(`Instance ID ${process.env.NODE_APP_INSTANCE} là Worker, KHÔNG chạy Cron Job.`);
    }

};
