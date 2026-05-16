const moment = require('moment');

module.exports = function(Page) {
  Page.observe('before save', (ctx,next) => {
    if(ctx.isNewInstance && ctx.instance) {
      if(!ctx.instance.createdAt) {
        ctx.instance.createdAt = moment.utc();
        return;
      }

    }
    if (ctx.data){
      ctx.data.updatedAt = moment.utc();
    } else if(ctx.instance) {
      ctx.instance.updatedAt = moment.utc();
    }
    next();
  })
}