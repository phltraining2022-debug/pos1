const { debouncedGenerateSitemap } = require('../../server/boot/sitemap');
const moment = require('moment');

module.exports = function(News) {
  const updateSitemap = (ctx, next) => {
    let shouldTrigger = false;

    // Check if this is a delete operation
    if (ctx.where && !ctx.instance) {
      // This is a delete operation - ctx.instance is undefined for delete
      shouldTrigger = true;
      console.log('[SITEMAP] News deleted, triggering sitemap update');
    } else if (ctx.instance) {
      // This is a save operation (create or update)
      const isNowPublished = ctx.instance.isPublished === true;
      console.log('ctx.isNewInstance', ctx.isNewInstance);
      
      // Nếu đang được publish (create hoặc update)
      if (isNowPublished) {
        shouldTrigger = true;
        console.log('[SITEMAP] News published, triggering sitemap update');
      }
      // Nếu đang được unpublish - cần check giá trị cũ (chỉ cho update, không phải create)
      else if (!isNowPublished && !ctx.isNewInstance) {
        // Query lại record từ database để lấy giá trị cũ
        News.findById(ctx.instance.id, {
          fields: { isPublished: true }
        }).then(previousRecord => {
          if (previousRecord && previousRecord[0].isPublished === true) {
            shouldTrigger = true;
            console.log('[SITEMAP] News unpublished (was published), triggering sitemap update');
          }
          console.log('previousRecord', previousRecord);
          if (shouldTrigger) {
            const clientContext = News.app.hostname ? News.app.hostname.split('.')[0] : 
                                (News.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(News.app, 3000, clientContext);
          }
          next();
        }).catch(err => {
          console.error('[SITEMAP] Error checking previous isPublished status:', err);
          // Fallback: trigger sitemap update nếu không thể check được
          shouldTrigger = true;
          
          if (shouldTrigger) {
            const clientContext = News.app.hostname ? News.app.hostname.split('.')[0] : 
                                (News.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(News.app, 3000, clientContext);
          }
          next();
        });
        return; // Quan trọng: return sớm để không gọi next() ở dưới
      }
    }

    console.log('shouldTrigger', shouldTrigger);
    if (shouldTrigger) {
      const clientContext = News.app.hostname ? News.app.hostname.split('.')[0] : 
                          (News.currentDatasource || 'ats');
      
      console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
      debouncedGenerateSitemap(News.app, 3000, clientContext);
    }
    next();
  };
  // News.observe('before save', (ctx,next) => {
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

  News.observe('before save', (ctx, next) => {
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
    News.findById(id, { fields: { id: true, updatedAt: true }, include: [] })
      .then((record) => {
        if (!record) {
          const err = new Error('Record not found');
          err.statusCode = 404;
          err.code = 'RECORD_NOT_FOUND';
          return next(err);
        }
  
        // const dbUpdatedAt = moment.utc(record.updatedAt);
        // if (dbUpdatedAt.isValid() && clientUpdatedAt.isBefore(dbUpdatedAt)) {
        //   const err = new Error('Conflict: the record has been updated by another source');
        //   err.statusCode = 409;
        //   err.code = 'CONFLICT_STALE_UPDATE';
        //   err.details = { dbUpdatedAt: dbUpdatedAt.toISOString() };
        //   return next(err);
        // }

        // Kiểm tra xem DB có updatedAt không trước khi tạo moment
        const dbUpdatedAt = (record.updatedAt != null) ? moment.utc(record.updatedAt) : null;
        console.log('dbUpdatedAt', dbUpdatedAt);
        console.log('dbUpdatedAt.isValid()', dbUpdatedAt.isValid());
        // Nếu DB không có updatedAt → skip check conflict (cho phép update lần đầu)
        if (!dbUpdatedAt || !dbUpdatedAt.isValid()) {
          // Không check conflict, cho phép update và set updatedAt mới
          if (ctx.data) {
            ctx.data.updatedAt = moment.utc();
          } else if (ctx.instance) {
            ctx.instance.updatedAt = moment.utc();
          }
          return next();
        }
        console.log('clientUpdatedAt', clientUpdatedAt);
        console.log('clientUpdatedAt.isBefore(dbUpdatedAt)', clientUpdatedAt.isBefore(dbUpdatedAt));
        // DB có updatedAt hợp lệ → phải check conflict
        // Nếu client gửi updatedAt cũ hơn DB → báo conflict
        if (clientUpdatedAt && clientUpdatedAt.isBefore(dbUpdatedAt)) {
          const err = new Error('Conflict: the record has been updated by another source');
          err.statusCode = 409;
          err.code = 'CONFLICT_STALE_UPDATE';
          err.details = { 
            dbUpdatedAt: dbUpdatedAt.toISOString(),
            clientUpdatedAt: clientUpdatedAt.toISOString()
          };
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

  News.observe('after save', updateSitemap);
  News.observe('after delete', updateSitemap);
};