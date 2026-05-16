module.exports = function(Cfg) {
  
    Cfg.observe('before save', function(ctx, next) {
      if (ctx.instance && !ctx.instance.id) {
        const obj = ctx.instance;
        let id = '';
  
        // Custom ID generation logic
        if (obj.type && (obj.type === 'status' || obj.type === 'type') && obj.value) {
          id = obj.value;
        } else {
          id = [obj.model, obj.value].filter(e => e).join('.');
        }
  
        // Assign the generated ID to the instance
        ctx.instance.id = id;
      }
      next();
    });
  };
  