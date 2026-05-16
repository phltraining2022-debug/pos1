var moment = require('moment');

var app = require('../server');

function timeInTextToInt(timeInText) {
    if (!timeInText) return 0;
    var vals = timeInText.split(':');
    return parseInt(vals[0]) * 60 + parseInt(vals[1]);
}

function minuteToTimeText(minute) {
    var h = Math.floor(minute / 60); var m = minute - h * 60;
    if (h < 10) h = '0' + h.toString();
    if (m < 10) m = '0' + m.toString();
    return h.toString() + ':' + m.toString();
}

function getSlots(start, end, durationPerSlot, offTimes) {
    var slots = [];
    for (var i = start; i < end; i += durationPerSlot) {

        // offFrom i offTo  offFrom i + durationPerSlot offTo 
        slots.push(minuteToTimeText(i));
    }
    return slots;
}


function getTimeSlots(locationId, shifts) {
    var slots = [];
    for (var m = 0; m < shifts.length; m++) {
        var shift = shifts[m];
        for (var j = 0; j < shift.locations.length; j++) {
            console.log(shift.locations[j].locationId);
            if (shift.locations[j].locationId == locationId) {

                var lt = shift.locations[j];
                var start = timeInTextToInt(lt.startTime);
                var end = timeInTextToInt(lt.endTime);

                var durationPerSlot = 20;

                if (shift.minutesPerSlot) durationPerSlot = shift.minutesPerSlot;

		if (start > end) end = end + 24 * 60;

                for (var i = start; i < end; i += durationPerSlot) {

                    if (lt.offTimes.length) {
                        var offSlot = false;
                        for (var k = 0; k < lt.offTimes.length; k++) {
                            var off = lt.offTimes[k];
                            var offFrom = timeInTextToInt(off.startTime);
                            var offTo = timeInTextToInt(off.endTime);

                            if ((offFrom <= i && i < offTo) ||
                                ((offFrom < (i + durationPerSlot)) && ((i + durationPerSlot) < offTo))) {
                                offSlot = true; i = offTo - durationPerSlot;
                            }
                        }

                        if (!offSlot) {
                            slots.push(i);
                        }
                    } else {
                        slots.push(i);
                    }
                }
            }
        }
    }
    return { slots: slots, shifts: shifts, minutesPerSlot: shift && shift.minutesPerSlot };
}

function hasShiftInLocation(locationId, shifts) {
    for (var m = 0; m < shifts.length; m++) {
        var shift = shifts[m];
        for (var j = 0; j < shift.locations.length; j++) {
            if (shift.locations[j].locationId == locationId) {
                return true;
            }
        }
    }

    return false;
}


module.exports.getAvailableDaysInMonth = function (clinicId, locationId, doctorId, month, cb) {

    var DateShift = app.models.DateShift;
    var Shift = app.models.Shift;
    var SysCfg = app.models.SysCfg;

    var startMonth = moment(month + '-01', "YYYY-MM-DD");
    var endMonth = moment(month + '-01', "YYYY-MM-DD").add(1, 'month');

    DateShift.findOne({
        where: {
            userId: doctorId,
            month: month
        }
    }, function (err, dateShift) {
        SysCfg.findOne({
                where: {
                    clinicId: clinicId,
                    category: 'workingDays'
                }
            }, function (err, cfgs) {
                var workingDays = cfgs && JSON.parse(cfgs.value) || {};
                var weekDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

                console.log(cfgs.value);

                Shift.find({
                    where: {
                        defaultDoctors: doctorId
                    }
                }, function (err, shifts) {
                    console.log('shifts ', shifts, doctorId);

                    // has shifts in this location
                    SysCfg.find(
                        { "where": { "and": [{ "category": "holidays" }, { "fromDate": { "lte": endMonth.toISOString() } }, { "toDate": { "gte": startMonth.toISOString() } }] } }
                        , function (err, result) {
                            // holidays
                            var ret = {};

                            if (hasShiftInLocation(locationId, shifts || []) || doctorId == 'undefined')
                                for(var i=1; i<=startMonth.daysInMonth(); i++) {
                                    var dateObj = moment(month + '-' + (i<10? ('0' + i): i));
                                    var iDate = dateObj.toISOString();

                                    var isHoliday = false;
                                    var isOff = true;
                                    for(var j=0;j<result.length;j++) {
                                        if (result[j].fromDate < iDate && iDate < result[j].toDate) {
                                            isHoliday = true;
                                        }
                                    }

                                    if (isHoliday || !workingDays[weekDays[dateObj.day()]]) {
                                        // not working day
                                        if (dateShift && dateShift.dateShifts && dateShift.dateShifts[i + '']) {
                                            isOff = false;
                                        }
                                    } else {
                                        // working days
                                        isOff = false;
                                    }
		
                                    if (!isOff) {
                                        ret[i+''] = true;
                                    }
				    ret[i + ''] = true;
                                }


                            cb({dates: ret});
                    });
                });
        });
    });
}

module.exports.getAvailability = function (clinicId, locationId, doctorId, date, cb) {

    var DateShift = app.models.DateShift;
    var Shift = app.models.Shift;
    var onDate = moment(date, "YYYY-MM-DD");
    var SysCfg = app.models.SysCfg;

    var dayInMonth = onDate.date() - 1;
    DateShift.findOne({
        where: {
            userId: doctorId,
            month: moment(date, "YYYY-MM-DD").format("YYYY-MM")
        }
    }, function (err, dateShift) {
	if (dateShift && dateShift.emergencyDates && dateShift.emergencyDates[dayInMonth]) {
            cb({ isEmergencyDay: true, slots: [] });
            return; 
        }

        if (!dateShift || (dateShift.dateShifts && !(dateShift.dateShifts[dayInMonth]))) {
            // find default shifts for this doctor

            // if it is working days
            SysCfg.findOne({
                where: {
                    clinicId: clinicId,
                    category: 'workingDays',
                    deletedById:{exists:false}
                }
            }, function (err, cfgs) {
                var workingDays = cfgs && JSON.parse(cfgs.value) || {};
                var weekDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                if (workingDays[weekDays[onDate.day()]] == true) {
                    SysCfg.findOne(
                        { "where": { "and": [{ "category": "holidays" }, { "fromDate": { "lte": onDate.toISOString() } }, { "toDate": { "gte": onDate.toISOString() } }] } }
                        , function (err, result) {
                            if (!result || true) {
                                Shift.find({
                                    where: {
                                        defaultDoctors: doctorId,
     					deletedById:{exists:false}
                                    }
                                }, function (err, shifts) {
                                    if (doctorId == 'undefined')
                                        shifts = [{locations:[{locationId: locationId, startTime:'8:00', endTime: '17:00', offTimes:[{startTime:'12:00',endTime:'13:00'}]}]}];
                                    cb(getTimeSlots(locationId, shifts));
                                });
                            } else {
                                cb({ isHoliday: true, slots: [] });
                            }
                        });
                } else {
                    cb({ slots: [], msg: 'week day off' });
                }
            });

        } else {
            Shift.find({
                where: {
                    id:
                    {
                        inq: dateShift.dateShifts[dayInMonth]
                    }
                }
            }, function (err, shifts) {
                console.log(shifts);
                cb(getTimeSlots(locationId, shifts));
            });
        }
    });
}

