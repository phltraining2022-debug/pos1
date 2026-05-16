module.exports = function(EventShift) {
  /**
   * Before save hook to calculate labor demand based on number of tables
   */
  EventShift.observe('before save', function(ctx, next) {
    const data = ctx.instance || ctx.data;
    
    if (!data) return next();

    // Auto-calculate labor demand if numTables is provided
    if (data.numTables !== undefined && data.numTables > 0) {
      const serviceNeeded = Math.ceil(data.numTables / 2); // 1 waiter per 2 tables
      const kitchenNeeded = Math.ceil(data.numTables / 10); // 1 kitchen helper per 10 tables
      
      data.laborDemand = {
        totalNeeded: serviceNeeded + kitchenNeeded,
        serviceNeeded: serviceNeeded,
        kitchenNeeded: kitchenNeeded
      };
    }

    // Auto-set dayName from date if not provided
    if (data.date && !data.dayName) {
      const daysOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
      const dateObj = new Date(data.date);
      data.dayName = daysOfWeek[dateObj.getDay()];
    }

    next();
  });

  /**
   * Remote method to get shift details with assigned staff
   */
  EventShift.getShiftWithStaff = function(id, cb) {
    const app = require('../../server/server');
    const StaffAssignment = app.models.StaffAssignment;
    const EventStaff = app.models.EventStaff;

    EventShift.findById(id, function(err, shift) {
      if (err) return cb(err);
      if (!shift) return cb(new Error('Shift not found'));

      // Get all assignments for this shift
      StaffAssignment.find({
        where: { eventShiftId: id },
        include: 'eventStaff'
      }, function(err, assignments) {
        if (err) return cb(err);

        const shiftData = shift.toObject();
        shiftData.assignedStaff = assignments.map(a => {
          const staff = a.eventStaff ? a.eventStaff() : null;
          return {
            assignmentId: a.id,
            staffId: a.eventStaffId,
            name: staff ? staff.name : 'Unknown',
            phone: staff ? staff.phone : '',
            hourlyRate: staff ? staff.hourlyRate : 0,
            roles: staff ? staff.roles : [],
            jobRole: a.jobRole,
            isConfirmed: a.isConfirmed,
            assignedAt: a.assignedAt,
            confirmedAt: a.confirmedAt
          };
        });

        const totalAssigned = shiftData.assignedStaff.length;
        const totalNeeded = shiftData.laborDemand ? shiftData.laborDemand.totalNeeded : 0;
        shiftData.staffingStatus = {
          totalNeeded: totalNeeded,
          totalAssigned: totalAssigned,
          deficit: totalNeeded - totalAssigned,
          isFullyStaffed: totalAssigned >= totalNeeded
        };

        cb(null, shiftData);
      });
    });
  };

  /**
   * Remote method to get shifts for a date range with staffing status
   */
  EventShift.getShiftsForDateRange = function(startDate, endDate, cb) {
    const filter = {
      where: {
        date: {
          between: [new Date(startDate), new Date(endDate)]
        }
      },
      order: 'date ASC, shiftTime ASC'
    };

    EventShift.find(filter, function(err, shifts) {
      if (err) return cb(err);

      // For each shift, get assignment count
      const app = require('../../server/server');
      const StaffAssignment = app.models.StaffAssignment;

      const shiftIds = shifts.map(s => s.id);
      
      StaffAssignment.find({
        where: { eventShiftId: { inq: shiftIds } }
      }, function(err, assignments) {
        if (err) return cb(err);

        // Group assignments by shift
        const assignmentsByShift = {};
        assignments.forEach(a => {
          if (!assignmentsByShift[a.eventShiftId]) {
            assignmentsByShift[a.eventShiftId] = [];
          }
          assignmentsByShift[a.eventShiftId].push(a);
        });

        // Add staffing info to each shift
        const shiftsWithStaffing = shifts.map(shift => {
          const shiftData = shift.toObject();
          const assigned = assignmentsByShift[shift.id] || [];
          const totalNeeded = shiftData.laborDemand ? shiftData.laborDemand.totalNeeded : 0;
          
          shiftData.staffingStatus = {
            totalNeeded: totalNeeded,
            totalAssigned: assigned.length,
            deficit: totalNeeded - assigned.length,
            isFullyStaffed: assigned.length >= totalNeeded
          };

          return shiftData;
        });

        cb(null, shiftsWithStaffing);
      });
    });
  };

  // Register remote methods
  EventShift.remoteMethod('getShiftWithStaff', {
    accepts: [
      { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
    ],
    returns: { arg: 'shift', type: 'object', root: true },
    http: { path: '/:id/with-staff', verb: 'get' },
    description: 'Get shift details with assigned staff and staffing status'
  });

  EventShift.remoteMethod('getShiftsForDateRange', {
    accepts: [
      { arg: 'startDate', type: 'date', required: true, description: 'Start date (inclusive)' },
      { arg: 'endDate', type: 'date', required: true, description: 'End date (inclusive)' }
    ],
    returns: { arg: 'shifts', type: 'array', root: true },
    http: { path: '/date-range', verb: 'get' },
    description: 'Get shifts for date range with staffing status'
  });
};
