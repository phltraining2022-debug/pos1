const { debouncedGenerateSitemap } = require('../../server/boot/sitemap');
const moment = require('moment');
let markdownConverter = null;
try {
  const showdownModule = require('showdown');
  if (showdownModule && typeof showdownModule.Converter === 'function') {
    // markdownConverter = new showdownModule.Converter();

    markdownConverter = new showdownModule.Converter({
      tables: true,  // Bật hỗ trợ table
      strikethrough: true,  // Bật hỗ trợ strikethrough
      tasklists: true,  // Bật hỗ trợ task lists
      simpleLineBreaks: true,  // Bật hỗ trợ line breaks
      openLinksInNewWindow: true  // Mở link trong tab mới
    });
  } else if (showdownModule && typeof showdownModule.converter === 'function') {
    // markdownConverter = new showdownModule.converter();

    markdownConverter = new showdownModule.converter({
      tables: true,
      strikethrough: true,
      tasklists: true,
      simpleLineBreaks: true,
      openLinksInNewWindow: true
    });
  }
} catch (e) {
  // If showdown is unavailable, fallback later will return raw text
}

module.exports = function (ScholarshipNews) {
  
  function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
  }

  // Batch processing utility for better memory management
  function chunkArray(array, chunkSize = 100) {
      const chunks = [];
      for (let i = 0; i < array.length; i += chunkSize) {
          chunks.push(array.slice(i, i + chunkSize));
      }
      return chunks;
  }

  // Normalization helpers
  const normalize = (text) => (text || '').toString().trim().toLowerCase();
  const getFirstNonEmpty = (obj, keys) => {
    for (const key of keys) {
      const value = obj && obj[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const toArrayFromMaybe = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[|,;]+/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  };
  const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(v)) return true;
      if (['false', '0', 'no', 'n'].includes(v)) return false;
    }
    return false;
  };
  // const markdownToHtml = (text) => {
  //   if (!text) return '';
  //   if (markdownConverter && typeof markdownConverter.makeHtml === 'function') {
  //     try {
  //       return markdownConverter.makeHtml(text);
  //     } catch (e) {
  //       return text;
  //     }
  //   }
  //   return text;
  // };

  const markdownToHtml = (text) => {
    if (!text) return '';
    
    // Parse markdown tables first
    let processedText = text;
    const tableRegex = /^(\|.*\|)\s*\n(\|[\s\-\|]+\|)\s*\n((?:\|.*\|\s*\n?)*)/gm;
    
    processedText = processedText.replace(tableRegex, (match) => {
      const lines = match.trim().split('\n');
      if (lines.length < 3) return match;
      
      const header = lines[0].split('|').slice(1, -1).map(cell => cell.trim());
      const rows = lines.slice(2).map(line => 
        line.split('|').slice(1, -1).map(cell => cell.trim())
      );
      
      let html = '<table class="markdown-table">\n<thead>\n<tr>\n';
      header.forEach(cell => html += `<th>${cell}</th>\n`);
      html += '</tr>\n</thead>\n<tbody>\n';
      
      rows.forEach(row => {
        html += '<tr>\n';
        row.forEach(cell => html += `<td>${cell}</td>\n`);
        html += '</tr>\n';
      });
      
      html += '</tbody>\n</table>';
      return html;
    });
    
    // Use showdown for other markdown
    if (markdownConverter && typeof markdownConverter.makeHtml === 'function') {
      try {
        return markdownConverter.makeHtml(processedText);
      } catch (e) {
        return processedText;
      }
    }
    return processedText;
  };

  const updateSitemap = (ctx, next) => {
    let shouldTrigger = false;

    // Check if this is a delete operation
    if (ctx.where && !ctx.instance) {
      // This is a delete operation - ctx.instance is undefined for delete
      shouldTrigger = true;
      console.log('[SITEMAP] ScholarshipNews deleted, triggering sitemap update');
    } else if (ctx.instance) {
      // This is a save operation (create or update)
      const isNowActive = ctx.instance.isActive === true;
      
      // Nếu đang được activate (create hoặc update)
      if (isNowActive) {
        shouldTrigger = true;
        console.log('[SITEMAP] ScholarshipNews activated, triggering sitemap update');
      }
      // Nếu đang được deactivate - cần check giá trị cũ (chỉ cho update, không phải create)
      else if (!isNowActive && !ctx.isNewInstance) {
        // Query lại record từ database để lấy giá trị cũ
        ScholarshipNews.findById(ctx.instance.id, {
          fields: { isActive: true }
        }).then(previousRecord => {
          if (previousRecord && previousRecord[0].isActive === true) {
            shouldTrigger = true;
            console.log('[SITEMAP] ScholarshipNews deactivated (was active), triggering sitemap update');
          }
          
          if (shouldTrigger) {
            const clientContext = ScholarshipNews.app.hostname ? ScholarshipNews.app.hostname.split('.')[0] : 
                                (ScholarshipNews.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(ScholarshipNews.app, 3000, clientContext);
          }
          next();
        }).catch(err => {
          console.error('[SITEMAP] Error checking previous isActive status:', err);
          // Fallback: trigger sitemap update nếu không thể check được
          shouldTrigger = true;
          
          if (shouldTrigger) {
            const clientContext = ScholarshipNews.app.hostname ? ScholarshipNews.app.hostname.split('.')[0] : 
                                (ScholarshipNews.currentDatasource || 'ats');
            
            console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
            debouncedGenerateSitemap(ScholarshipNews.app, 3000, clientContext);
          }
          next();
        });
        return; // Quan trọng: return sớm để không gọi next() ở dưới
      }
    }

    if (shouldTrigger) {
      const clientContext = ScholarshipNews.app.hostname ? ScholarshipNews.app.hostname.split('.')[0] : 
                          (ScholarshipNews.currentDatasource || 'ats');
      
      console.log(`[SITEMAP] Triggering for client: ${clientContext}`);
      debouncedGenerateSitemap(ScholarshipNews.app, 3000, clientContext);
    }
    next();
  };

  // ScholarshipNews.observe('before save', (ctx, next) => {
  //   // CREATE: server kiểm soát timestamps
  //   if (ctx.isNewInstance && ctx.instance) {
  //     if (!ctx.instance.createdAt) {
  //       ctx.instance.createdAt = moment.utc();
  //     }
  //     ctx.instance.updatedAt = moment.utc();
  //     return next();
  //   }
  
  //   // UPDATE: kiểm tra xung đột TÙY CHỌN (chỉ khi FE gửi updatedAt)
  //   const getClientUpdatedAt = () => {
  //     const direct = (ctx.data && ctx.data.updatedAt) ||
  //                    (ctx.instance && ctx.instance.updatedAt) ||
  //                    (ctx.options && ctx.options.updatedAt);
  //     if (direct) return moment.utc(direct);
  
  //     const req = ctx.options && ctx.options.http && ctx.options.http.req;
  //     const fromReq = req && req.body && req.body.updatedAt;
  //     if (fromReq) return moment.utc(fromReq);
  
  //     return null;
  //   };
  
  //   const clientUpdatedAt = getClientUpdatedAt();
    
  //   // Nếu FE KHÔNG gửi updatedAt → bỏ qua check (tương thích ngược)
  //   if (!clientUpdatedAt) {
  //     if (ctx.data) {
  //       delete ctx.data.updatedAt; // xóa nếu có
  //       ctx.data.updatedAt = moment.utc();
  //     } else if (ctx.instance) {
  //       ctx.instance.updatedAt = moment.utc();
  //     }
  //     return next();
  //   }
  
  //   // FE có gửi nhưng format sai → báo 400
  //   if (!clientUpdatedAt.isValid()) {
  //     const err = new Error('Invalid updatedAt format for concurrency check');
  //     err.statusCode = 400;
  //     err.code = 'INVALID_UPDATED_AT';
  //     return next(err);
  //   }
  
  //   const id = (ctx.where && (ctx.where.id || ctx.where._id)) ||
  //              (ctx.instance && ctx.instance.id) ||
  //              (ctx.data && ctx.data.id);
  
  //   if (!id) {
  //     // Không có id → bỏ qua check
  //     if (ctx.data) {
  //       delete ctx.data.updatedAt;
  //       ctx.data.updatedAt = moment.utc();
  //     } else if (ctx.instance) {
  //       ctx.instance.updatedAt = moment.utc();
  //     }
  //     return next();
  //   }
  
  //   // Xóa updatedAt client gửi
  //   if (ctx.data) {
  //     delete ctx.data.updatedAt;
  //   }
  
  //   // Kiểm tra xung đột
  //   ScholarshipNews.findById(id, { fields: { id: true, updatedAt: true }, include: [] })
  //     .then((record) => {
  //       if (!record) {
  //         const err = new Error('Record not found');
  //         err.statusCode = 404;
  //         err.code = 'RECORD_NOT_FOUND';
  //         return next(err);
  //       }
  
  //       const dbUpdatedAt = moment.utc(record.updatedAt);
  //       if (dbUpdatedAt.isValid() && clientUpdatedAt.isBefore(dbUpdatedAt)) {
  //         const err = new Error('Conflict: the record has been updated by another source');
  //         err.statusCode = 409;
  //         err.code = 'CONFLICT_STALE_UPDATE';
  //         err.details = { dbUpdatedAt: dbUpdatedAt.toISOString() };
  //         return next(err);
  //       }
  
  //       // Server set updatedAt = now
  //       if (ctx.data) {
  //         ctx.data.updatedAt = moment.utc();
  //       } else if (ctx.instance) {
  //         ctx.instance.updatedAt = moment.utc();
  //       }
  //       return next();
  //     })
  //     .catch((e) => {
  //       e.statusCode = e.statusCode || 500;
  //       return next(e);
  //     });
  // });

  // ScholarshipNews.observe('before save', (ctx, next) => {
  //   // CREATE: server kiểm soát timestamps
  //   if (ctx.isNewInstance && ctx.instance) {
  //     if (!ctx.instance.createdAt) {
  //       ctx.instance.createdAt = moment.utc();
  //     }
  //     ctx.instance.updatedAt = moment.utc();
  //     return next();
  //   }
  // });

  ScholarshipNews.observe('after save', updateSitemap);
  ScholarshipNews.observe('after delete', updateSitemap);

  /**
   * Remote method for bulk importing and updating scholarships from a JSON array.
   * This function is optimized to handle large datasets efficiently with:
   * - Batch processing to prevent memory issues
   * - Database transaction support
   * - Optimized bulk operations
   * - Comprehensive error handling and reporting
   */
  ScholarshipNews.bulkImport = async function(scholarships) {
    const appInstance = ScholarshipNews.app;
    const School = appInstance.models.School;
    const Level = appInstance.models.Level;

    const summary = await appInstance.bulkImportGeneric(ScholarshipNews, scholarships, {
      wrapperKeys: ['scholarshipnews'],
      maxBatchSize: 1000,
      chunkSize: 50,
      dedupeAndPrepare: (row, index) => {
        const scholarshipName = getFirstNonEmpty(row, ['name', 'title', 'scholarship', 'scholarshipName', 'Name']);
        const schoolIdRaw = getFirstNonEmpty(row, ['schoolId', 'school_id', 'SchoolId', 'SchoolID']);
        const schoolSlug = getFirstNonEmpty(row, ['schoolSlug', 'SchoolSlug']);
        const schoolName = getFirstNonEmpty(row, ['institution', 'school', 'university', 'schoolName', 'institutionName', 'Institution']);
        if (!scholarshipName) return { error: 'Missing required field: name' };
        if (!schoolIdRaw && !schoolSlug && !schoolName) return { error: 'Missing required school reference: provide schoolId, schoolSlug, or institution/school name' };
        const keyPrefix = schoolIdRaw ? `id:${String(schoolIdRaw).trim()}` : (schoolSlug ? `slug:${normalize(schoolSlug)}` : `name:${normalize(schoolName)}`);
        return {
          key: `${keyPrefix}::${normalize(scholarshipName)}`,
          prepared: {
            _resolvedName: scholarshipName,
            _resolvedSchoolId: schoolIdRaw ? String(schoolIdRaw).trim() : '',
            _resolvedSchoolSlug: schoolSlug ? normalize(schoolSlug) : '',
            _resolvedSchoolName: schoolName ? schoolName.trim() : ''
          }
        };
      },
      buildLookups: async (deduped) => {
        const schoolIds = new Set();
        const schoolSlugs = new Set();
        const schoolNames = new Set();
        const levelNamesSet = new Set();
        deduped.forEach(row => {
          if (row._resolvedSchoolId) schoolIds.add(row._resolvedSchoolId);
          if (row._resolvedSchoolSlug) schoolSlugs.add(row._resolvedSchoolSlug);
          if (row._resolvedSchoolName) schoolNames.add(row._resolvedSchoolName.trim());
          const levelsInput = row.levels || row.level || row.educationLevels || '';
          toArrayFromMaybe(levelsInput).forEach(l => levelNamesSet.add(normalize(l)));
        });
        const [schoolsById, schoolsBySlug, schoolsByName, allLevels] = await Promise.all([
          schoolIds.size ? School.find({ where: { id: { inq: Array.from(schoolIds) } } }) : Promise.resolve([]),
          schoolSlugs.size ? School.find({ where: { slug: { inq: Array.from(schoolSlugs) } } }) : Promise.resolve([]),
          schoolNames.size ? School.find({ where: { name: { inq: Array.from(schoolNames) } } }) : Promise.resolve([]),
          levelNamesSet.size ? Level.find({ where: { name: { inq: Array.from(levelNamesSet) } } }) : Level.find({})
        ]);
        return {
          schoolIdMap: new Map(schoolsById.map(s => [String(s.id), s])),
          schoolSlugMap: new Map(schoolsBySlug.map(s => [normalize(s.slug), s])),
          schoolNameMap: new Map(schoolsByName.map(s => [normalize(s.name), s])),
          levelMap: new Map(allLevels.map(l => [normalize(l.name), l.id]))
        };
      },
      processRow: async (row, lookups) => {
        const scholarshipName = row._resolvedName;
        if (!scholarshipName) throw new Error('Missing required field: name');
        
        // Sửa logic slug
        let slug = row.slug || row.Slug; // Lấy slug từ input nếu có
        if (!slug && scholarshipName) {
          slug = slugify(scholarshipName); // Chỉ tạo slug mới nếu không có trong input
        }
        
        let school = null;
        const schoolId = row._resolvedSchoolId;
        const schoolSlug = row._resolvedSchoolSlug;
        const schoolName = row._resolvedSchoolName;
        if (schoolId) school = lookups.schoolIdMap.get(String(schoolId));
        if (!school && schoolSlug) school = lookups.schoolSlugMap.get(normalize(schoolSlug));
        if (!school && schoolName) school = lookups.schoolNameMap.get(normalize(schoolName));
        if (!school) throw new Error(`School not found by ${schoolId ? 'id' : (schoolSlug ? 'slug' : 'name')}: ${schoolId || schoolSlug || schoolName}`);

        const levelsInput = row.levels || row.level || row.educationLevels || '';
        const levelNames = toArrayFromMaybe(levelsInput);
        const levelIds = levelNames.map(name => lookups.levelMap.get(normalize(name))).filter(Boolean);

        return {
          name: scholarshipName,
          value: `${getFirstNonEmpty(row, ['value', 'Value'])} ${getFirstNonEmpty(row, ['currency', 'Currency'])}`.trim(),
          slug: slug, // Sử dụng slug đã xử lý
          description: markdownToHtml(row.description || row.Description || ''),
          schoolId: school.id.toString(),
          locationId: school.locationId,
          levelIds: levelIds,
          majorIds: Array.isArray(row.majorIds) ? row.majorIds : (typeof row.majorIds === 'string' ? row.majorIds.split(/[|,;]+/).map(s => s.trim()).filter(Boolean) : []),
          isPublished: true,
          isActive: true,
          isHot: toBoolean(row.isHot),
          deadline: row.deadline || row.Deadline || null,
          percentage: row.percent ? String(row.percent) : (row.percentage ? String(row.percentage) : null),
          updatedAt: new Date(),
          createdAt: new Date()
        };
      },
      findExisting: async (Model, data) => {
        let existing = await Model.findOne({ where: { name: data.name } });
        if (!existing) existing = await Model.findOne({ where: { slug: data.slug } });
        return existing;
      },
      onUpdate: async (existing, data) => {
        // Preserve slug cũ nếu không có slug mới trong data
        if (!data.slug && existing.slug) {
          data.slug = existing.slug;
        }
        return existing.updateAttributes(data);
      }
    });

    return summary;
  };

  /**
   * Register the remote method with Loopback.
   */
  ScholarshipNews.remoteMethod('bulkImport', {
    description: 'Bulk import/update scholarships from a JSON array with advanced optimization and error handling.',
    accepts: [
      {
        arg: 'scholarships',
        type: 'array',
        http: { source: 'body' },
        required: true,
        description: 'An array of scholarship objects to import/update (max 1000 records).'
      }
    ],
    returns: {
      arg: 'summary',
      type: 'object',
      root: true,
      description: 'Detailed summary of the import operation including success rates and error details.'
    },
    http: {
      path: '/bulk-import-json',
      verb: 'post'
    }
  });

  // Config for common bulk importer
  ScholarshipNews.getBulkImportConfig = function(appInstance) {
    const School = appInstance.models.School;
    const Level = appInstance.models.Level;
    return {
      wrapperKeys: ['scholarshipnews'],
      maxBatchSize: 1000,
      chunkSize: 50,
      dedupeAndPrepare: (row) => {
        const scholarshipName = getFirstNonEmpty(row, ['name', 'title', 'scholarship', 'scholarshipName', 'Name']);
        const schoolIdRaw = getFirstNonEmpty(row, ['schoolId', 'school_id', 'SchoolId', 'SchoolID']);
        const schoolSlug = getFirstNonEmpty(row, ['schoolSlug', 'SchoolSlug']);
        const schoolName = getFirstNonEmpty(row, ['institution', 'school', 'university', 'schoolName', 'institutionName', 'Institution']);
        if (!scholarshipName) return { error: 'Missing required field: name' };
        if (!schoolIdRaw && !schoolSlug && !schoolName) return { error: 'Missing required school reference: provide schoolId, schoolSlug, or institution/school name' };
        const keyPrefix = schoolIdRaw ? `id:${String(schoolIdRaw).trim()}` : (schoolSlug ? `slug:${normalize(schoolSlug)}` : `name:${normalize(schoolName)}`);
        return {
          key: `${keyPrefix}::${normalize(scholarshipName)}`,
          prepared: {
            _resolvedName: scholarshipName,
            _resolvedSchoolId: schoolIdRaw ? String(schoolIdRaw).trim() : '',
            _resolvedSchoolSlug: schoolSlug ? normalize(schoolSlug) : '',
            _resolvedSchoolName: schoolName ? schoolName.trim() : ''
          }
        };
      },
      buildLookups: async (deduped) => {
        const schoolIds = new Set();
        const schoolSlugs = new Set();
        const schoolNames = new Set();
        const levelNamesSet = new Set();
        deduped.forEach(row => {
          if (row._resolvedSchoolId) schoolIds.add(row._resolvedSchoolId);
          if (row._resolvedSchoolSlug) schoolSlugs.add(row._resolvedSchoolSlug);
          if (row._resolvedSchoolName) schoolNames.add(row._resolvedSchoolName.trim());
          const levelsInput = row.levels || row.level || row.educationLevels || '';
          toArrayFromMaybe(levelsInput).forEach(l => levelNamesSet.add(normalize(l)));
        });
        const [schoolsById, schoolsBySlug, schoolsByName, allLevels] = await Promise.all([
          schoolIds.size ? School.find({ where: { id: { inq: Array.from(schoolIds) } } }) : Promise.resolve([]),
          schoolSlugs.size ? School.find({ where: { slug: { inq: Array.from(schoolSlugs) } } }) : Promise.resolve([]),
          schoolNames.size ? School.find({ where: { name: { inq: Array.from(schoolNames) } } }) : Promise.resolve([]),
          levelNamesSet.size ? Level.find({ where: { name: { inq: Array.from(levelNamesSet) } } }) : Level.find({})
        ]);
        return {
          schoolIdMap: new Map(schoolsById.map(s => [String(s.id), s])),
          schoolSlugMap: new Map(schoolsBySlug.map(s => [normalize(s.slug), s])),
          schoolNameMap: new Map(schoolsByName.map(s => [normalize(s.name), s])),
          levelMap: new Map(allLevels.map(l => [normalize(l.name), l.id]))
        };
      },
      processRow: async (row, lookups) => {
        const scholarshipName = row._resolvedName;
        if (!scholarshipName) throw new Error('Missing required field: name');
        
        // Sửa logic slug
        let slug = row.slug || row.Slug; // Lấy slug từ input nếu có
        if (!slug && scholarshipName) {
          slug = slugify(scholarshipName); // Chỉ tạo slug mới nếu không có trong input
        }
        
        let school = null;
        const schoolId = row._resolvedSchoolId;
        const schoolSlug = row._resolvedSchoolSlug;
        const schoolName = row._resolvedSchoolName;
        if (schoolId) school = lookups.schoolIdMap.get(String(schoolId));
        if (!school && schoolSlug) school = lookups.schoolSlugMap.get(normalize(schoolSlug));
        if (!school && schoolName) school = lookups.schoolNameMap.get(normalize(schoolName));
        if (!school) throw new Error(`School not found by ${schoolId ? 'id' : (schoolSlug ? 'slug' : 'name')}: ${schoolId || schoolSlug || schoolName}`);
        
        const levelsInput = row.levels || row.level || row.educationLevels || '';
        const levelNames = toArrayFromMaybe(levelsInput);
        const levelIds = levelNames.map(name => lookups.levelMap.get(normalize(name))).filter(Boolean);
        
        return {
          name: scholarshipName,
          value: `${getFirstNonEmpty(row, ['value', 'Value'])} ${getFirstNonEmpty(row, ['currency', 'Currency'])}`.trim(),
          slug: slug, // Sử dụng slug đã xử lý
          description: markdownToHtml(row.description || row.Description || ''),
          schoolId: school.id.toString(),
          locationId: school.locationId,
          levelIds: levelIds,
          majorIds: Array.isArray(row.majorIds) ? row.majorIds : (typeof row.majorIds === 'string' ? row.majorIds.split(/[|,;]+/).map(s => s.trim()).filter(Boolean) : []),
          isPublished: true,
          isActive: true,
          isHot: toBoolean(row.isHot),
          deadline: row.deadline || row.Deadline || null,
          percentage: row.percent ? String(row.percent) : (row.percentage ? String(row.percentage) : null),
          updatedAt: new Date(),
          createdAt: new Date()
        };
      },
      findExisting: async (Model, data) => {
        let existing = await Model.findOne({ where: { name: data.name } });
        if (!existing) existing = await Model.findOne({ where: { slug: data.slug } });
        return existing;
      },
      onUpdate: async (existing, data) => {
        // Preserve slug cũ nếu không có slug mới trong data
        if (!data.slug && existing.slug) {
          data.slug = existing.slug;
        }
        return existing.updateAttributes(data);
      }
    };
  };
};