module.exports = function(EventStaff) {
  /**
   * Remote method to get available staff for a specific shift
   * Returns ACTIVE staff who are not already assigned to the given shift
   */
  EventStaff.getAvailableForShift = function(eventShiftId, cb) {
    const app = require('../../server/server');
    const StaffAssignment = app.models.StaffAssignment;

    // Find all staff already assigned to this shift
    StaffAssignment.find({ where: { eventShiftId: eventShiftId } }, function(err, assignments) {
      if (err) return cb(err);

      const assignedStaffIds = assignments.map(a => a.eventStaffId);

      // Find ACTIVE staff not in the assigned list
      const filter = {
        where: {
          status: 'ACTIVE',
          id: { nin: assignedStaffIds }
        },
        order: 'ratingScore DESC, name ASC'
      };

      EventStaff.find(filter, function(err, availableStaff) {
        if (err) return cb(err);
        cb(null, availableStaff);
      });
    });
  };

  /**
   * Remote method to get staff statistics
   * Returns counts by status and training status
   */
  EventStaff.getStatistics = function(cb) {
    EventStaff.find({}, function(err, allStaff) {
      if (err) return cb(err);

      const stats = {
        total: allStaff.length,
        active: allStaff.filter(s => s.status === 'ACTIVE').length,
        new: allStaff.filter(s => s.status === 'NEW').length,
        inactive: allStaff.filter(s => s.status === 'INACTIVE').length,
        trained: allStaff.filter(s => s.isTrained).length,
        untrained: allStaff.filter(s => !s.isTrained).length,
        byRating: {
          excellent: allStaff.filter(s => s.ratingScore === 5).length,
          good: allStaff.filter(s => s.ratingScore === 4).length,
          average: allStaff.filter(s => s.ratingScore === 3).length,
          poor: allStaff.filter(s => s.ratingScore <= 2).length
        }
      };

      cb(null, stats);
    });
  };

  /**
   * Before save hook to validate data
   */
  EventStaff.observe('before save', function(ctx, next) {
    const data = ctx.instance || ctx.data;
    
    if (!data) return next();

    // Ensure roles is an array
    if (data.roles && !Array.isArray(data.roles)) {
      data.roles = [];
    }

    // Validate rating score range
    if (data.ratingScore !== undefined && (data.ratingScore < 0 || data.ratingScore > 5)) {
      return next(new Error('Rating score must be between 0 and 5'));
    }

    // Validate hourly rate
    if (data.hourlyRate !== undefined && data.hourlyRate < 0) {
      return next(new Error('Hourly rate cannot be negative'));
    }

    // Auto-set trained staff to ACTIVE if status is still NEW
    if (data.isTrained === true && data.status === 'NEW') {
      data.status = 'ACTIVE';
    }

    next();
  });

  // Register remote methods
  EventStaff.remoteMethod('getAvailableForShift', {
    accepts: [
      { arg: 'eventShiftId', type: 'string', required: true, description: 'Event shift ID' }
    ],
    returns: { arg: 'staff', type: 'array', root: true },
    http: { path: '/available-for-shift/:eventShiftId', verb: 'get' },
    description: 'Get available ACTIVE staff for a specific shift'
  });

  EventStaff.remoteMethod('getStatistics', {
    accepts: [],
    returns: { arg: 'stats', type: 'object', root: true },
    http: { path: '/statistics', verb: 'get' },
    description: 'Get staff statistics by status, training, and rating'
  });
};
