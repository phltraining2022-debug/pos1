module.exports = function(StaffAssignment) {
  /**
   * Before save hook to set timestamps and validate assignment
   */
  StaffAssignment.observe('before save', function(ctx, next) {
    const app = require('../../server/server');
    const EventStaff = app.models.EventStaff;
    const EventShift = app.models.EventShift;
    const data = ctx.instance || ctx.data;
    
    if (!data) return next();

    // Set assignedAt timestamp on creation
    if (ctx.isNewInstance && !data.assignedAt) {
      data.assignedAt = new Date();
    }

    // Set confirmedAt timestamp when isConfirmed changes to true
    if (data.isConfirmed === true && !data.confirmedAt) {
      data.confirmedAt = new Date();
    }

    // Validate that staff exists and is ACTIVE
    if (ctx.isNewInstance || data.eventStaffId) {
      const staffId = data.eventStaffId;
      
      EventStaff.findById(staffId, function(err, staff) {
        if (err) return next(err);
        if (!staff) {
          return next(new Error('EventStaff not found: ' + staffId));
        }
        if (staff.status !== 'ACTIVE') {
          return next(new Error('Cannot assign staff with status: ' + staff.status + '. Staff must be ACTIVE.'));
        }

        // Validate shift exists
        const shiftId = data.eventShiftId;
        EventShift.findById(shiftId, function(err, shift) {
          if (err) return next(err);
          if (!shift) {
            return next(new Error('EventShift not found: ' + shiftId));
          }

          next();
        });
      });
    } else {
      next();
    }
  });

  /**
   * Remote method to bulk assign staff to a shift
   */
  StaffAssignment.bulkAssign = function(eventShiftId, staffAssignments, assignedBy, cb) {
    const app = require('../../server/server');
    const EventStaff = app.models.EventStaff;
    const EventShift = app.models.EventShift;

    // Validate shift exists
    EventShift.findById(eventShiftId, function(err, shift) {
      if (err) return cb(err);
      if (!shift) return cb(new Error('EventShift not found'));

      // Validate all staff are ACTIVE
      const staffIds = staffAssignments.map(sa => sa.eventStaffId);
      
      EventStaff.find({
        where: {
          id: { inq: staffIds },
          status: 'ACTIVE'
        }
      }, function(err, activeStaff) {
        if (err) return cb(err);

        if (activeStaff.length !== staffIds.length) {
          return cb(new Error('Some staff are not ACTIVE or do not exist'));
        }

        // Create assignments
        const assignments = staffAssignments.map(sa => ({
          eventShiftId: eventShiftId,
          eventStaffId: sa.eventStaffId,
          jobRole: sa.jobRole || 'Phục vụ bàn',
          isConfirmed: sa.isConfirmed || false,
          assignedBy: assignedBy,
          assignedAt: new Date()
        }));

        StaffAssignment.create(assignments, function(err, created) {
          if (err) return cb(err);
          cb(null, { success: true, count: created.length, assignments: created });
        });
      });
    });
  };

  /**
   * Remote method to confirm an assignment (staff confirmation)
   */
  StaffAssignment.confirmAssignment = function(id, cb) {
    StaffAssignment.findById(id, function(err, assignment) {
      if (err) return cb(err);
      if (!assignment) return cb(new Error('Assignment not found'));

      assignment.updateAttributes({
        isConfirmed: true,
        confirmedAt: new Date()
      }, function(err, updated) {
        if (err) return cb(err);
        cb(null, updated);
      });
    });
  };

  /**
   * Remote method to get staff schedule (all assignments for a staff member)
   */
  StaffAssignment.getStaffSchedule = function(eventStaffId, startDate, endDate, cb) {
    const app = require('../../server/server');
    const EventShift = app.models.EventShift;

    // Find all assignments for this staff
    StaffAssignment.find({
      where: { eventStaffId: eventStaffId },
      include: 'eventShift'
    }, function(err, assignments) {
      if (err) return cb(err);

      // Filter by date range if provided
      let filteredAssignments = assignments;
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : new Date(0);
        const end = endDate ? new Date(endDate) : new Date('2100-01-01');
        
        filteredAssignments = assignments.filter(a => {
          const shift = a.eventShift ? a.eventShift() : null;
          if (!shift) return false;
          const shiftDate = new Date(shift.date);
          return shiftDate >= start && shiftDate <= end;
        });
      }

      const schedule = filteredAssignments.map(a => {
        const shift = a.eventShift ? a.eventShift() : null;
        return {
          assignmentId: a.id,
          shiftId: a.eventShiftId,
          date: shift ? shift.date : null,
          dayName: shift ? shift.dayName : null,
          hall: shift ? shift.hall : null,
          shiftTime: shift ? shift.shiftTime : null,
          timeRange: shift ? shift.timeRange : null,
          jobRole: a.jobRole,
          isConfirmed: a.isConfirmed,
          assignedAt: a.assignedAt,
          confirmedAt: a.confirmedAt
        };
      });

      cb(null, schedule);
    });
  };

  // Register remote methods
  StaffAssignment.remoteMethod('bulkAssign', {
    accepts: [
      { arg: 'eventShiftId', type: 'string', required: true, description: 'Event shift ID' },
      { arg: 'staffAssignments', type: 'array', required: true, description: 'Array of {eventStaffId, jobRole, isConfirmed}' },
      { arg: 'assignedBy', type: 'string', description: 'User ID of assigner' }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/bulk-assign', verb: 'post' },
    description: 'Bulk assign multiple staff to a shift'
  });

  StaffAssignment.remoteMethod('confirmAssignment', {
    accepts: [
      { arg: 'id', type: 'string', required: true, http: { source: 'path' } }
    ],
    returns: { arg: 'assignment', type: 'object', root: true },
    http: { path: '/:id/confirm', verb: 'post' },
    description: 'Confirm a staff assignment'
  });

  StaffAssignment.remoteMethod('getStaffSchedule', {
    accepts: [
      { arg: 'eventStaffId', type: 'string', required: true, http: { source: 'path' } },
      { arg: 'startDate', type: 'date', description: 'Start date filter (optional)' },
      { arg: 'endDate', type: 'date', description: 'End date filter (optional)' }
    ],
    returns: { arg: 'schedule', type: 'array', root: true },
    http: { path: '/staff/:eventStaffId/schedule', verb: 'get' },
    description: 'Get schedule for a specific staff member'
  });
};
