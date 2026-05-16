// let debounceTimeout = null;

// const SITEMAP_PREFIX = 'sitemap:';
// const SITEMAP_CACHE_KEY = `${SITEMAP_PREFIX}urls`;
// const SITEMAP_LAST_GENERATED_KEY = `${SITEMAP_PREFIX}last_generated`;
// const SITEMAP_LOCK_KEY = `${SITEMAP_PREFIX}lock`;

// // Cache TTL (24 hours)
// const CACHE_TTL = 24 * 60 * 60;

// function getRedisClient(app) {
//   // Nếu app có redisClient thì dùng, nếu không thì tạo mới
//   if (app.redisClient) {
//     return app.redisClient;
//   }
  
//   // Tạo mới nhưng với error handling
//   const redis = require('redis');
//   const client = redis.createClient();
//   client.on('error', function(err) {
//     console.error('Sitemap Redis error:', err);
//   });
//   return client;
// }

// async function getCachedSitemapUrls(app) {
//   const redisClient = getRedisClient(app);
//   return new Promise((resolve, reject) => {
//     redisClient.get(SITEMAP_CACHE_KEY, (err, data) => {
//       if (err) {
//         console.error('Redis get error:', err);
//         resolve(null); // Fallback to null instead of rejecting
//       } else {
//         resolve(data ? JSON.parse(data) : null);
//       }
//     });
//   });
// }

// async function cacheSitemapUrls(app, urls) {
//   const redisClient = getRedisClient(app);
//   return new Promise((resolve, reject) => {
//     redisClient.setex(SITEMAP_CACHE_KEY, CACHE_TTL, JSON.stringify(urls), (err) => {
//       if (err) {
//         console.error('Redis setex error:', err);
//         resolve(); // Don't reject, just log error
//       } else {
//         resolve();
//       }
//     });
//   });
// }

// async function needsRegeneration(app) {
//   const redisClient = getRedisClient(app);
//   return new Promise((resolve, reject) => {
//     redisClient.get(SITEMAP_LAST_GENERATED_KEY, (err, data) => {
//       if (err) {
//         console.error('Redis get error:', err);
//         resolve(true); // Fallback to regenerate on error
//       } else {
//         if (!data) {
//           resolve(true);
//         } else {
//           const lastGenerated = new Date(data);
//           const now = new Date();
//           const hoursSinceLastGenerated = (now - lastGenerated) / (1000 * 60 * 60);
//           resolve(hoursSinceLastGenerated > 1); // Regenerate if older than 1 hour
//         }
//       }
//     });
//   });
// }

// async function setLastGenerated(app) {
//   const redisClient = getRedisClient(app);
//   return new Promise((resolve, reject) => {
//     redisClient.set(SITEMAP_LAST_GENERATED_KEY, new Date().toISOString(), (err) => {
//       if (err) {
//         console.error('Redis set error:', err);
//       }
//       resolve(); // Always resolve, don't fail on cache errors
//     });
//   });
// }

// async function generateSitemap(app, forceRegenerate = false) {
//   try {
//     console.log('[SITEMAP] Starting sitemap generation...');

//      if (!forceRegenerate) {
//       const needsRegen = await needsRegeneration(app);
//       if (!needsRegen) {
//         console.log('[SITEMAP] Using cached sitemap, no regeneration needed');
//         return;
//       }
//     }

//     // Check for lock to prevent concurrent generation
//     const redisClient = getRedisClient(app);
//     const lockResult = await new Promise((resolve) => {
//       redisClient.set(SITEMAP_LOCK_KEY, '1', 'EX', 300, 'NX', (err, result) => {
//         if (err) {
//           console.error('Redis lock error:', err);
//           resolve(false); // Continue without lock on error
//         } else {
//           console.log('result', result);
//           resolve(result === 'OK');
//         }
//       });
//     });

//     // if (!lockResult) {
//     //   console.log('[SITEMAP] Another sitemap generation is in progress, skipping...');
//     //   return;
//     // }
//     const hostname = process.env.SITE_URL || 'https://ats.test.live1.vn';
//     const models = [
//       { name: 'News', path: 'news' },
//       { name: 'Event', path: 'events' },
//       { name: 'ScholarshipNews', path: 'scholarships' },
//       { name: 'Template', path: '' },
//       { name: 'School', path: 'schools' },
//       { name: 'Location', path: 'locations' },
//       { name: 'TestimonialNews', path: 'testimonial-news' },
//       { name: 'FAQ', path: 'faqs' },
//       { name: 'Services', path: 'services' },
//     ];

//     let urls = [
//       {
//         loc: `${hostname}/`,
//         changefreq: 'daily',
//         priority: '1.0',
//         lastmod: new Date().toISOString().slice(0, 10)
//       },
//       {
//         loc: `${hostname}/schools`,
//         changefreq: 'weekly',
//         priority: '0.8',
//         lastmod: new Date().toISOString().slice(0, 10)
//       },
//     ];

//     for (const m of models) {
//       try{
//       const Model = app.models[m.name];
//       if (!Model) continue;
//       let where = {};
//       // Điều kiện cho từng model
//       if ((m.name === 'News' || m.name === 'Event') && Model.definition.properties.isPublished) {
//         where.isPublished = true;
//       } else if (
//         (m.name === 'Location' || m.name === 'School' || m.name === 'ScholarshipNews' || m.name === 'TestimonialNews') &&
//         Model.definition.properties.isActive
//       ) {
//         where.isActive = true;
//       } else if (m.name === 'Template') {
//         where = { type: 'static', isActive: true };
//       } else if (Model.definition.properties.published) {
//         where.published = true;
//       } else if (Model.definition.properties.isActive) {
//         where.isActive = true;
//       }
//         const items = await Model.find({ where, fields: { slug: true } });
//       items.forEach(item => {
//         if (!item.slug) return;
//         urls.push({
//           loc: `${hostname}/${m.path ? m.path + '/' : ''}${item.slug}`,
//           lastmod: new Date().toISOString().slice(0, 10), // Dùng current date thay vì item.updatedAt
//           changefreq: 'weekly',
//           priority: '0.8'
//         });
//       });
//       } catch (err) {
//         console.error(`[SITEMAP] Error processing model ${m.name}:`, err);
//         continue;
//       }
//     }
//      try {
//       await cacheSitemapUrls(app, urls);
//        await setLastGenerated(app);
//        console.log('[SITEMAP] Sitemap generation completed');
//     } catch (err) {
//       console.error('[SITEMAP] Redis cache error (continuing anyway):', err);
//     }
//     let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
//     xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
//     for (const u of urls) {
//       xml += `  <url>\n`;
//       xml += `    <loc>${u.loc}</loc>\n`;
//       xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
//       xml += `    <changefreq>${u.changefreq}</changefreq>\n`;
//       xml += `    <priority>${u.priority}</priority>\n`;
//       xml += `  </url>\n`;
//     }
//     xml += `</urlset>\n`;

//     const Template = app.models.Template;
//     const [tpl] = await Template.find({ where: { name: 'sitemap.xml' } });
//     if (tpl) {
//       tpl.content = xml;
//       tpl.updatedAt = new Date();
//       await tpl.save();
//       console.log('[SITEMAP] Đã cập nhật sitemap.xml trong Template model!');
//     } else {
//       await Template.create({
//         name: 'sitemap.xml',
//         content: xml,
//         contentType: 'xml',
//         isActive: true,
//         createdAt: new Date(),
//         updatedAt: new Date()
//       });
//       console.log('[SITEMAP] Đã tạo mới sitemap.xml trong Template model!');
//     }
    
//     redisClient.del(SITEMAP_LOCK_KEY, (err) => {
//       if (err) console.error('Redis lock release error:', err);
//     });
    
//   } catch (err) {
//     console.error('[SITEMAP] Lỗi khi tạo sitemap.xml:', err);
//     const redisClient = getRedisClient(app);
//     redisClient.del(SITEMAP_LOCK_KEY, (err) => {
//       if (err) console.error('Redis lock release error:', err);
//     });
//   }
// }

//   function debouncedGenerateSitemap(app, delay = 30000) {
//   if (debounceTimeout) clearTimeout(debounceTimeout);
//   debounceTimeout = setTimeout(() => {
//     generateSitemap(app, true);
//     debounceTimeout = null;
//   }, delay);
// }

// module.exports = {
//   generateSitemap,
//   debouncedGenerateSitemap
// };




let debounceTimeout = null;

async function generateSitemap(app, forceRegenerate = false, clientContext = null) {
  try {
    
    let hostname;
    if (app.hostname && app.hostname.startsWith('ats.')) {
        hostname = 'https://ats.org.vn';
    } else {
        hostname = app.hostname ? 'https://' + app.hostname : '';
    }
    const models = [
      { name: 'News', path: 'news' },
      { name: 'Event', path: 'events' },
      { name: 'ScholarshipNews', path: 'scholarships' },
      { name: 'Template', path: '' },
      { name: 'School', path: 'schools' },
      { name: 'Location', path: 'locations' },
      { name: 'TestimonialNews', path: 'testimonial-news' },
      { name: 'FAQ', path: 'faqs' },
      { name: 'Services', path: 'services' },
    ];

    let urls = [
      {
        loc: `${hostname}/`,
        changefreq: 'daily',
        priority: '1.0',
        lastmod: new Date().toISOString().slice(0, 10)
      },
      {
        loc: `${hostname}/schools`,
        changefreq: 'weekly',
        priority: '0.8',
        lastmod: new Date().toISOString().slice(0, 10)
      },
    ];

    for (const m of models) {
      try {
        const Model = app.models[m.name];
        if (!Model) {
          continue;
        }
        
        let where = {};
        // Điều kiện cho từng model
        if ((m.name === 'News' || m.name === 'Event') && Model.definition.properties.isPublished) {
          where.isPublished = true;
        } else if (
          (m.name === 'Location' || m.name === 'School' || m.name === 'ScholarshipNews' || m.name === 'TestimonialNews') &&
          Model.definition.properties.isActive
        ) {
          where.isActive = true;
        } else if (m.name === 'Template') {
          where = { type: 'static', isActive: true };
        } else if (Model.definition.properties.published) {
          where.published = true;
        } else if (Model.definition.properties.isActive) {
          where.isActive = true;
        }

        // Bỏ fields hoàn toàn để tránh lỗi relations
        const items = await Model.find({ where });
        
        items.forEach(item => {
          if (!item.slug) return;
          urls.push({
            loc: `${hostname}/${m.path ? m.path + '/' : ''}${item.slug}`,
            lastmod: new Date().toISOString().slice(0, 10),
            changefreq: 'weekly',
            priority: '0.8'
          });
        });
      } catch (err) {
        console.error(`[SITEMAP] Error processing model ${m.name}:`, err);
        // Tiếp tục với model tiếp theo
        continue;
      }
    }

    // Tạo XML
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    for (const u of urls) {
      xml += `  <url>\n`;
      xml += `    <loc>${u.loc}</loc>\n`;
      xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
      xml += `    <changefreq>${u.changefreq}</changefreq>\n`;
      xml += `    <priority>${u.priority}</priority>\n`;
      xml += `  </url>\n`;
    }
    xml += `</urlset>\n`;

    // Lưu vào Template model
    const Template = app.models.Template;
    const [tpl] = await Template.find({ where: { name: 'sitemap.xml' } });
    if (tpl) {
      tpl.content = xml;
      tpl.updatedAt = new Date();
      await tpl.save();
      console.log('[SITEMAP] Đã cập nhật sitemap.xml trong Template model!');
    } else {
      await Template.create({
        name: 'sitemap.xml',
        content: xml,
        contentType: 'xml',
        type: 'static',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('[SITEMAP] Đã tạo mới sitemap.xml trong Template model!');
    }
    
  } catch (err) {
    console.error('[SITEMAP] Lỗi khi tạo sitemap.xml:', err);
  }
}

function debouncedGenerateSitemap(app, delay = 3000, clientContext = null) {
   if (clientContext) {
    currentClientContext = clientContext;
  }
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    generateSitemap(app, true, clientContext);
    debounceTimeout = null;
    currentClientContext = null;
  }, delay);
}

module.exports = {
  generateSitemap,
  debouncedGenerateSitemap
};