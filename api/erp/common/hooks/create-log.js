var app = require('../../server/server');


module.exports = function createLog(ctx, next) {

    next();
    var log = app.models.log;
    var model = app.models[ctx.Model.modelName];
    var token = ctx && ctx.get && ctx.get('accessToken');
    var userId = token && token.userId;

    // 
    var l = {
      model: ctx.Model.modelName,
      createdBy: userId || ctx.options.accessToken && ctx.options.accessToken.userId,
      event: 'updated'
    };
    if (ctx.instance) {
      var inst = ctx.instance;
      // clone the inst and remove the relations, createdById, updatedById, createdAt, updatedAt, id  
      l.data = JSON.parse(JSON.stringify(inst));
      const fieldsToExclude = ['createdById', 'updatedById', 'createdAt', 'updatedAt', 'id'];
      fieldsToExclude.forEach(field => {
        delete l.data[field];
      });

      // convert to ObjectId 
      l.objectId = inst.id;
      if (ctx.isNewInstance) {
        l.event = 'created';
        log.create(l);
      }  else {
        // depending on the model we can have different fields to check for changes
        // look the previous version of the instance and compare with the new one
        // just Object.keys(inst).forEach to check the changes
        // we can use lodash to compare the objects
        console.log('inst', inst);
        // find the previous version of the instance sync
        log.findOne({ where: { objectId: inst.id.toString() , model: ctx.Model.modelName }, order: 'createdAt DESC' }).then(function (prev) {
          if (prev) {
            var changes = {};
            Object.keys(l.data).forEach(function (key) {
              if (JSON.stringify(inst[key]) !== JSON.stringify(prev.data[key])) {
                if (inst[key] !== null && prev.data[key] !== null) {
                    changes[key] = { from: prev.data[key], to: inst[key] };
                }
              }
            });

            Object.keys(prev.data).forEach(function (key) {
              if (!l.data[key]) {
                changes[key] = { from: prev.data[key], to: null };
              }
            });

            l.changes = changes;

            console.log('Changes detected:', l.changes);

          } else {
          }
          log.create(l);
        });

      }

    }

  }