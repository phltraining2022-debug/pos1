const { debouncedGenerateSitemap } = require('../../server/boot/sitemap');
const moment = require('moment');

module.exports = function(Location) {
  const updateSitemap = (ctx, next) => {
    let shouldTrigger = false;

    // Check if this is a delete operation
    if (ctx.where && !ctx.instance) {
      // This is a delete operation - ctx.instance is undefined for delete
      shouldTrigger = true;
      console.log('[SITEMAP] Location deleted, triggering sitemap update');
    } else if (ctx.instance) {
      // This is a save operation (create or update)
      const isNowActive = ctx.instance.isActive === true;
      
      // Nếu đang được activate (create hoặc update)
      if (isNowActive) {
        shouldTrigger = true;
        console.log('[SITEMAP] Location activated, triggering sitemap update');
      }
      // Nếu đang được deactivate - cần check giá trị cũ (chỉ cho update, không phải create)
      else if (!isNowActive && !ctx.isNewInstance) {
        // Query lại record từ database để lấy giá trị cũ
        Location.findById(ctx.instance.id, {
          fields: { isActive: true }
        }).then(previousRecord => {
          if (previousRecord && previousRecord[0].isActive === true) {
            shouldTrigger = true;
            console.log('[SITEMAP] Location deactivated (was active), triggering sitemap update');
          }
          
          if (shouldTrigger) {
            const clientContext = Location.app.hostname ? Location.app.hostname.split('.')[0] : 
                                (Location.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(Location.app, 3000, clientContext);
          }
          next();
        }).catch(err => {
          console.error('[SITEMAP] Error checking previous isActive status:', err);
          // Fallback: trigger sitemap update nếu không thể check được
          shouldTrigger = true;
          
          if (shouldTrigger) {
            const clientContext = Location.app.hostname ? Location.app.hostname.split('.')[0] : 
                                (Location.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(Location.app, 3000, clientContext);
          }
          next();
        });
        return; // Quan trọng: return sớm để không gọi next() ở dưới
      }
    }

    if (shouldTrigger) {
      const clientContext = Location.app.hostname ? Location.app.hostname.split('.')[0] : 
                          (Location.currentDatasource || 'ats');
      
      console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
      debouncedGenerateSitemap(Location.app, 3000, clientContext);
    }
    next();
  };

  // Location.observe('before save', (ctx,next) => {
  //   if(ctx.isNewInstance && ctx.instance) {
  //     if(!ctx.instance.createdAt) {
  //       ctx.instance.createdAt = moment.utc();
  //       return;
  //     }

  //   }
  //   if (ctx.data){
  //     ctx.data.updatedAt = moment.utc();
  //   } else if(ctx.instance) {
  //     ctx.instance.updatedAt = moment.utc();
  //   }
  //   next();
  // })


  Location.observe('before save', (ctx, next) => {
    // CREATE: server kiểm soát timestamps
    if (ctx.isNewInstance && ctx.instance) {
      if (!ctx.instance.createdAt) {
        ctx.instance.createdAt = moment.utc();
      }
      ctx.instance.updatedAt = moment.utc();
      return next();
    }
  
    // UPDATE: kiểm tra xung đột TÙY CHỌN (chỉ khi FE gửi updatedAt)
    const getClientUpdatedAt = () => {
      const direct = (ctx.data && ctx.data.updatedAt) ||
                     (ctx.instance && ctx.instance.updatedAt) ||
                     (ctx.options && ctx.options.updatedAt);
      if (direct) return moment.utc(direct);
  
      const req = ctx.options && ctx.options.http && ctx.options.http.req;
      const fromReq = req && req.body && req.body.updatedAt;
      if (fromReq) return moment.utc(fromReq);
  
      return null;
    };
  
    const clientUpdatedAt = getClientUpdatedAt();
    
    // Nếu FE KHÔNG gửi updatedAt → bỏ qua check (tương thích ngược)
    if (!clientUpdatedAt) {
      if (ctx.data) {
        delete ctx.data.updatedAt; // xóa nếu có
        ctx.data.updatedAt = moment.utc();
      } else if (ctx.instance) {
        ctx.instance.updatedAt = moment.utc();
      }
      return next();
    }
  
    // FE có gửi nhưng format sai → báo 400
    if (!clientUpdatedAt.isValid()) {
      const err = new Error('Invalid updatedAt format for concurrency check');
      err.statusCode = 400;
      err.code = 'INVALID_UPDATED_AT';
      return next(err);
    }
  
    const id = (ctx.where && (ctx.where.id || ctx.where._id)) ||
               (ctx.instance && ctx.instance.id) ||
               (ctx.data && ctx.data.id);
  
    if (!id) {
      // Không có id → bỏ qua check
      if (ctx.data) {
        delete ctx.data.updatedAt;
        ctx.data.updatedAt = moment.utc();
      } else if (ctx.instance) {
        ctx.instance.updatedAt = moment.utc();
      }
      return next();
    }
  
    // Xóa updatedAt client gửi
    if (ctx.data) {
      delete ctx.data.updatedAt;
    }
  
    // Kiểm tra xung đột
    Location.findById(id, { fields: { id: true, updatedAt: true }, include: [] })
      .then((record) => {
        if (!record) {
          const err = new Error('Record not found');
          err.statusCode = 404;
          err.code = 'RECORD_NOT_FOUND';
          return next(err);
        }
  
        const dbUpdatedAt = moment.utc(record.updatedAt);
        if (dbUpdatedAt.isValid() && clientUpdatedAt.isBefore(dbUpdatedAt)) {
          const err = new Error('Conflict: the record has been updated by another source');
          err.statusCode = 409;
          err.code = 'CONFLICT_STALE_UPDATE';
          err.details = { dbUpdatedAt: dbUpdatedAt.toISOString() };
          return next(err);
        }
  
        // Server set updatedAt = now
        if (ctx.data) {
          ctx.data.updatedAt = moment.utc();
        } else if (ctx.instance) {
          ctx.instance.updatedAt = moment.utc();
        }
        return next();
      })
      .catch((e) => {
        e.statusCode = e.statusCode || 500;
        return next(e);
      });
  });

  Location.observe('after save', updateSitemap);
  Location.observe('after delete', updateSitemap);
};
