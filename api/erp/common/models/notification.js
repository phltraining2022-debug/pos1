var moment = require('moment');
var app = require('../../server/server');
var emailHandler = require('../../server/boot/email');
var smsHandler = require('../../server/boot/sms');

var nunjucks = require('nunjucks');

var notificationModule = module.exports = function(Notification) {
    Notification.observe("before save", function(ctx, next) {
        var instance = ctx.data ? ctx.data : ctx.instance;

        if (ctx.isNewInstance){
            instance.createdAt = moment.utc();
        }

        instance.updatedAt = instance.createdAt;
        next();
    });

    // Auto-send web push whenever a new notification is created
    Notification.observe("after save", async function(ctx) {
        if (!ctx.isNewInstance) return;
        const instance = ctx.instance;
        if (!instance.receiverIds || !instance.receiverIds.length) return;

        try {
            const Installation = app.models.Installation;
            await Installation.sendWebPushToUsers(
                instance.receiverIds,
                instance.title,
                instance.content,
                instance.data || {}
            );
        } catch (err) {
            console.error('[Notification afterSave] Web push error:', err);
        }

        try {
            const Installation = app.models.Installation;
            await Installation.sendMobilePushToUsers(
                instance.receiverIds,
                instance.title,
                instance.content,
                instance.data || {}
            );
        } catch (err) {
            console.error('[Notification afterSave] Mobile push error:', err);
        }
    });


};

var sendEmail = notificationModule.sendEmail = function(email, title, content, cb){
    emailHandler.sendEmailWithoutTemplate(email, title, content, cb)
};

var sendSms = notificationModule.sendSms = function(receiver, content, cb){
    console.log("Send Receiver: ", receiver);
    console.log("Content: ", content);
    smsHandler.sendSms(receiver.phone, content, cb);
};

var kNotificationType = notificationModule.kNotificationType = {
    Auto: 'Auto',
    Options: {
        Immediately: "Immediately",
        SpecificTime: "SpecificTime",
        Interval: "Interval"
    }
};

var kNotificationMethod = notificationModule.kNotificationMethod = {
    SMS: "sms",
    Email: "email",
    Mobile: "mobile"
};
