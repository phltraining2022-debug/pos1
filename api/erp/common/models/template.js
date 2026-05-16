const { debouncedGenerateSitemap } = require('../../server/boot/sitemap');
const moment = require('moment');

module.exports = function(Template) {
  const updateSitemap = (ctx, next) => {
    let shouldTrigger = false;

    const isStaticType = ctx.instance ? ctx.instance.type === 'static' : (ctx.currentInstance && ctx.currentInstance.type === 'static');

    // Check if this is a delete operation
    if (ctx.where && !ctx.instance && isStaticType) {
      // This is a delete operation - ctx.instance is undefined for delete
      shouldTrigger = true;
      console.log('[SITEMAP] Template deleted, triggering sitemap update');
    } else if (ctx.instance && isStaticType) {
      // This is a save operation (create or update)
      const isNowActive = ctx.instance.isActive === true;
      
      // Nếu đang được activate (create hoặc update)
      if (isNowActive) {
        shouldTrigger = true;
        console.log('[SITEMAP] Template activated, triggering sitemap update');
      }
      // Nếu đang được deactivate - cần check giá trị cũ (chỉ cho update, không phải create)
      else if (!isNowActive && !ctx.isNewInstance) {
        // Query lại record từ database để lấy giá trị cũ
        Template.findById(ctx.instance.id, {
          fields: { isActive: true }
        }).then(previousRecord => {
          if (previousRecord && previousRecord[0].isActive === true) {
            shouldTrigger = true;
            console.log('[SITEMAP] Template deactivated (was active), triggering sitemap update');
          }
          
          if (shouldTrigger) {
            const clientContext = Template.app.hostname ? Template.app.hostname.split('.')[0] : 
                                (Template.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(Template.app, 3000, clientContext);
          }
          next();
        }).catch(err => {
          console.error('[SITEMAP] Error checking previous isActive status:', err);
          // Fallback: trigger sitemap update nếu không thể check được
          shouldTrigger = true;
          
          if (shouldTrigger) {
            const clientContext = Template.app.hostname ? Template.app.hostname.split('.')[0] : 
                                (Template.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(Template.app, 3000, clientContext);
          }
          next();
        });
        return; // Quan trọng: return sớm để không gọi next() ở dưới
      }
    }

    if (shouldTrigger) {
      const clientContext = Template.app.hostname ? Template.app.hostname.split('.')[0] : 
                          (Template.currentDatasource || 'ats');
      
      console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
      debouncedGenerateSitemap(Template.app, 3000, clientContext);
    }
    next();
  };

  Template.observe('before save', (ctx,next) => {
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
  Template.observe('after save', updateSitemap);
  Template.observe('after delete', updateSitemap);
};
