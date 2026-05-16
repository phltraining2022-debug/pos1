'use strict';
var moment = require('moment');
var app = require('../../server/server');

module.exports = function(DateShift) {

DateShift.observe("after save", function sendConfirmedOrderNotification(ctx, next) {
        if (ctx.isNewInstance) {
            next();
            return;
        }

        var Appointment = app.models.appointment;
        var instance = ctx.data || ctx.instance;
	

	console.log('instance.lastModifiedDay ', instance.lastModifiedDay);
	instance.lastModifiedDay = instance.lastModifiedDay + 1; // real day

	Appointment.find({
                        where: {doctorId: instance.userId,
			reminded: {exists: false},
                        date: instance.month + '-' +  (instance.lastModifiedDay < 10 ? ('0' + instance.lastModifiedDay) : instance.lastModifiedDay)  }},
       		function(err, apmts) {
		var notifications = [];
		for(var j=0;j<apmts.length;j++) {
			var obj = apmts[j];
			var newNoti = {
                icon: "fa-bell-o",
                time: moment.utc(),
                type: "system",
                title: "system notification",
                receiver: null,
                isRead: false,
                locationId: obj.locationId,
                targetId: obj.id,
                model: "appointment",
                clinicId: instance.clinicId,
                message: (obj.patient_info.fullName || 'Client') + "'s appointment needs rearrange. schedule changed"
            };
		notifications.push(newNoti);


		}
		var Notification = app.models.notification;
	        if (notifications.length) 
		Notification.create(notifications, function(err, result){
			app.io.emit('message', 'schedule changed');
        	});


	});

	next();
});


};
