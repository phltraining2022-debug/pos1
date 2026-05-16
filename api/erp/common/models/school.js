const { debouncedGenerateSitemap } = require('../../server/boot/sitemap');
let markdownConverter = null;
try {
  const showdownModule = require('showdown');
  if (showdownModule && typeof showdownModule.Converter === 'function') {
    // markdownConverter = new showdownModule.Converter({
    //   tables: true,
    //   strikethrough: true,
    //   tasklists: true,
    //   simpleLineBreaks: true,
    //   openLinksInNewWindow: true
    // });

    markdownConverter = new showdownModule.Converter({
      tables: true
    });
  } else if (showdownModule && typeof showdownModule.converter === 'function') {
    // markdownConverter = new showdownModule.converter({
    //   tables: true,
    //   strikethrough: true,
    //   tasklists: true,
    //   simpleLineBreaks: true,
    //   openLinksInNewWindow: true
    // });

    markdownConverter = new showdownModule.converter({
      tables: true
    });
  }
} catch (e) {
}

module.exports = function(School) {
  const updateSitemap = (ctx, next) => {
    let shouldTrigger = false;

    // Check if this is a delete operation
    if (ctx.where && !ctx.instance) {
      // This is a delete operation - ctx.instance is undefined for delete
      shouldTrigger = true;
      console.log('[SITEMAP] School deleted, triggering sitemap update');
    } else if (ctx.instance) {
      // This is a save operation (create or update)
      const isNowActive = ctx.instance.isActive === true;
      
      // Nếu đang được activate (create hoặc update)
      if (isNowActive) {
        shouldTrigger = true;
        console.log('[SITEMAP] School activated, triggering sitemap update');
      }
      // Nếu đang được deactivate - cần check giá trị cũ (chỉ cho update, không phải create)
      else if (!isNowActive && !ctx.isNewInstance) {
        // Query lại record từ database để lấy giá trị cũ
        School.findById(ctx.instance.id, {
          fields: { isActive: true }
        }).then(previousRecord => {
          if (previousRecord && previousRecord[0].isActive === true) {
            shouldTrigger = true;
            console.log('[SITEMAP] School deactivated (was active), triggering sitemap update');
          }
          
          if (shouldTrigger) {
            const clientContext = School.app.hostname ? School.app.hostname.split('.')[0] : 
                                (School.currentDatasource || 'ats');
            
            
            debouncedGenerateSitemap(School.app, 3000, clientContext);
          }
          next();
        }).catch(err => {
          console.error('[SITEMAP] Error checking previous isActive status:', err);
          // Fallback: trigger sitemap update nếu không thể check được
          shouldTrigger = true;
          
          if (shouldTrigger) {
            const clientContext = School.app.hostname ? School.app.hostname.split('.')[0] : 
                                (School.currentDatasource || 'ats');
            
           
            debouncedGenerateSitemap(School.app, 3000, clientContext);
          }
          next();
        });
        return; // Quan trọng: return sớm để không gọi next() ở dưới
      }
    }

    if (shouldTrigger) {
      const clientContext = School.app.hostname ? School.app.hostname.split('.')[0] : 
                          (School.currentDatasource || 'ats');
      
      
      debouncedGenerateSitemap(School.app, 3000, clientContext);
    }
    next();
  };

  School.observe('after save', updateSitemap);
  School.observe('after delete', updateSitemap);

  // Helpers
  function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }
  const normalize = (text) => (text || '').toString().trim().toLowerCase();
  const getFirstNonEmpty = (obj, keys) => {
    for (const key of keys) {
      const value = obj && obj[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && !Number.isNaN(value)) return String(value);
      if (typeof value === 'boolean') return value ? 'true' : 'false';
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
  const toNumber = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  };
  // const markdownToHtml = (text) => {
  //   if (!text) return '';
  //   if (markdownConverter && typeof markdownConverter.makeHtml === 'function') {
  //     try { return markdownConverter.makeHtml(text); } catch (e) { return text; }
  //   }
  //   return text;
  // };

  const markdownToHtml = (text) => {
    if (!text) return '';
    
    // Parse markdown tables first
    let processedText = text;
    const tableRegex = /^(\|.*\|)\s*\n(\|[\s\-\|]+\|)\s*\n((?:\|.*\|\s*\n?)*)/gm;
    
    processedText = processedText.replace(tableRegex, (match) => {
      const trimmedMatch = match.trim();
      const lines = trimmedMatch.split('\n');
      if (lines.length < 3) return match;
      
      const escapeHtml = (value) => (value || '').replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const renderMarkdownInline = (value) => {
        const text = (value || '').trim();
        if (!text) return '';
        if (markdownConverter && typeof markdownConverter.makeHtml === 'function') {
          try {
            const html = markdownConverter.makeHtml(text).trim();
            return html.replace(/^<p>/i, '').replace(/<\/p>$/i, '').trim();
          } catch (e) {
            return escapeHtml(text);
          }
        }
        return escapeHtml(text);
      };

      const header = lines[0].split('|').slice(1, -1).map(cell => renderMarkdownInline(cell));
      const rows = lines.slice(2).map(line => 
        line.split('|').slice(1, -1).map(cell => renderMarkdownInline(cell))
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
      const trailingNewlinesMatch = match.match(/\n+$/);
      const trailingNewlines = trailingNewlinesMatch ? trailingNewlinesMatch[0] : '\n\n';
      return `${html}${trailingNewlines}`;
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

  // Bulk import for School
  School.bulkImport = async function(input) {
    const appInstance = School.app;
    const Level = appInstance.models.Level;
    const Major = appInstance.models.Major;
    const Location = appInstance.models.location || appInstance.models.Location;
    const City = appInstance.models.City;

    const summary = await appInstance.bulkImportGeneric(School, input, {
      wrapperKeys: ['schools'],
      maxBatchSize: 1000,
      chunkSize: 50,
      normalizeInput: null,
      dedupeAndPrepare: (row, index) => {
        const name = getFirstNonEmpty(row, ['name', 'Name', 'schoolName', 'university_name', 'UniversityName']);
        const slug = getFirstNonEmpty(row, ['slug', 'Slug']);
        if (!name) return { error: 'Missing required field: name' };
        return {
          key: `name:${normalize(name)}`,
          prepared: { _resolvedName: name, _resolvedSlug: slug }
        };
      },
      buildLookups: async (deduped) => {
        const levelNamesSet = new Set();
        const majorNamesSet = new Set();
        const locationIds = new Set();
        const locationSlugs = new Set();
        const locationNames = new Set();
        const cityNames = new Set();

        deduped.forEach(r => {
          toArrayFromMaybe(r.levels || r.level || r.educationLevels || '').forEach(n => levelNamesSet.add(normalize(n)));
          toArrayFromMaybe(r.majors || r.major || r.majorNames || '').forEach(n => majorNamesSet.add(normalize(n)));
          const locId = getFirstNonEmpty(r, ['locationId', 'LocationId']);
          const locSlug = getFirstNonEmpty(r, ['locationSlug']);
          const locName = getFirstNonEmpty(r, ['location', 'locationName']);
          const cityName = getFirstNonEmpty(r, ['city', 'cityName']);
          if (locId) locationIds.add(String(locId));
          if (locSlug) locationSlugs.add(normalize(locSlug));
          if (locName) locationNames.add(locName.trim());
          if (cityName) cityNames.add(cityName.trim());
        });

        const [allLevels, allMajors, locationsById, locationsBySlug, locationsByName, citiesByName] = await Promise.all([
          Level ? (levelNamesSet.size ? Level.find({ where: { name: { inq: Array.from(levelNamesSet) } } }) : Level.find({})) : Promise.resolve([]),
          Major ? (majorNamesSet.size ? Major.find({ where: { name: { inq: Array.from(majorNamesSet) } } }) : Major.find({})) : Promise.resolve([]),
          Location && locationIds.size ? Location.find({ where: { id: { inq: Array.from(locationIds) } } }) : Promise.resolve([]),
          Location && locationSlugs.size ? Location.find({ where: { slug: { inq: Array.from(locationSlugs) } } }) : Promise.resolve([]),
          Location && locationNames.size ? Location.find({ where: { name: { inq: Array.from(locationNames) } } }) : Promise.resolve([]),
          City && cityNames.size ? City.find({ where: { name: { inq: Array.from(cityNames) } } }) : Promise.resolve([])
        ]);

        return {
          levelMap: new Map(allLevels.map(l => [normalize(l.name), l.id])),
          majorMap: new Map(allMajors.map(m => [normalize(m.name), m.id])),
          locationIdMap: new Map(locationsById.map(l => [String(l.id), l])),
          locationSlugMap: new Map(locationsBySlug.map(l => [normalize(l.slug), l])),
          locationNameMap: new Map(locationsByName.map(l => [normalize(l.name), l])),
          cityNameMap: new Map(citiesByName.map(c => [normalize(c.name), c.id]))
        };
      },
      processRow: async (row, lookups) => {
        const name = row._resolvedName;
        let slug = row._resolvedSlug;
        
        // Nếu không có slug trong input, tạo slug mới từ name
        if (!slug && name) {
          slug = slugify(name);
        }
        
        // levels/majors
        const levelIds = toArrayFromMaybe(row.levels || row.level || row.educationLevels || '')
          .map(n => lookups.levelMap.get(normalize(n)))
          .filter(Boolean);
        const majorIds = toArrayFromMaybe(row.majors || row.major || row.majorNames || '')
          .map(n => lookups.majorMap.get(normalize(n)))
          .filter(Boolean);

        // location/city
        const locId = getFirstNonEmpty(row, ['locationId', 'LocationId']);
        const locSlug = getFirstNonEmpty(row, ['locationSlug']);
        const locName = getFirstNonEmpty(row, ['location', 'locationName']);
        let locationId = '';
        if (locId && lookups.locationIdMap.has(String(locId))) locationId = String(locId);
        else if (locSlug && lookups.locationSlugMap.has(normalize(locSlug))) locationId = String(lookups.locationSlugMap.get(normalize(locSlug)).id);
        else if (locName && lookups.locationNameMap.has(normalize(locName))) locationId = String(lookups.locationNameMap.get(normalize(locName)).id);

        const cityName = getFirstNonEmpty(row, ['city', 'cityName']);
        const cityId = cityName && lookups.cityNameMap.get(normalize(cityName)) ? String(lookups.cityNameMap.get(normalize(cityName))) : undefined;

        const buildDescription = (row) => {
          const seen = new Set();
          const normalizeBlock = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const withHeadingIfMissing = (heading, content) => {
            const text = (content || '').toString().trim();
            if (!text) return '';
            // if (/^\s*#{1,6}\s/.test(text)) return text;
            return `## ${heading}\n\n${text}`;
          };
          const ordered = [
            ['GIỚI THIỆU CHUNG', row.gioi_thieu_chung],
            ['ĐIỂM THẾ MẠNH', row.diem_the_manh],
            ['RANKINGS TỪ TỔ CHỨC UY TÍN', row.rankings],
            ['THÔNG TIN CAMPUS', row.thong_tin_campus],
            ['CHI PHÍ', row.chi_phi],
            ['NGÀNH HỌC THẾ MẠNH', row.nganh_hoc_the_manh],
            ['YÊU CẦU ĐẦU VÀO', row.yeu_cau_dau_vao],
            ['LỜI KẾT', row.loi_ket]
          ];
          const sections = [];
          for (const [heading, content] of ordered) {
            const norm = normalizeBlock(content);
            if (!norm || seen.has(norm)) continue;
            seen.add(norm);
            sections.push(withHeadingIfMissing(heading, content));
          }
          return sections.join('\n\n');
        };
        const fullDescription = buildDescription(row);
        // Debug logs for meta fields resolution (config path)
        const resolvedMetaTitle2 = getFirstNonEmpty(row, ['meta_title', 'metaTitle', 'MetaTitle']);
        const resolvedShortDesc2 = getFirstNonEmpty(row, ['meta_description', 'shortDescription', 'ShortDescription']) || undefined;
        // try {
        //   console.log('[School.getBulkImportConfig.processRow] name:', name, 'slug:', slug, 'meta_title->metaTitle:', resolvedMetaTitle2, 'meta_description->shortDescription length:', resolvedShortDesc2 ? resolvedShortDesc2.length : 0);
        // } catch (e) {}
        
        // Debug logs for meta fields resolution
        const resolvedMetaTitle = getFirstNonEmpty(row, ['meta_title', 'metaTitle', 'MetaTitle']);
        const resolvedShortDesc = getFirstNonEmpty(row, ['meta_description', 'shortDescription', 'ShortDescription']) || undefined;
        // try {
        //   console.log('[School.bulkImport.processRow] name:', name, 'slug:', slug, 'meta_title->metaTitle:', resolvedMetaTitle, 'meta_description->shortDescription length:', resolvedShortDesc ? resolvedShortDesc.length : 0);
        // } catch (e) {}

        return {
          name: name || getFirstNonEmpty(row, ['university_name', 'UniversityName']) || '',
          slug: slug,
          isPublished: toBoolean(row.isPublished !== undefined ? row.isPublished : true),
          isHot: toBoolean(row.isHot),
          logo: getFirstNonEmpty(row, ['logo', 'Logo']),
          ranking: getFirstNonEmpty(row, ['ranking', 'Ranking']),
          nameVi: getFirstNonEmpty(row, ['nameVi', 'nameVI', 'NameVi']),
          codeId: getFirstNonEmpty(row, ['codeId', 'codeID', 'CodeId']),
          cricos: getFirstNonEmpty(row, ['cricos', 'CRICOS']),
          duration: toNumber(row.duration),
          tuition: toNumber(row.tuition),
          metaTitle: getFirstNonEmpty(row, ['meta_title', 'metaTitle', 'MetaTitle']),
          levelIds: levelIds,
          majorIds: majorIds,
          locationId: locationId || undefined,
          cityId: cityId || undefined,
          schoolType: getFirstNonEmpty(row, ['schoolType', 'SchoolType', 'school-type']) || '',
          shortDescription: getFirstNonEmpty(row, ['meta_description', 'shortDescription', 'ShortDescription']) || undefined,
          description: markdownToHtml(fullDescription) || '',
          updatedAt: new Date(),
          createdAt: new Date(),
          abbreviation: getFirstNonEmpty(row, ['abbreviation', 'Abbreviation']) || ''
        };
      },
      findExisting: async (Model, data) => {
        let existing = await Model.findOne({ where: { name: data.name } });
        if (!existing && data.slug) existing = await Model.findOne({ where: { slug: data.slug } });
        return existing;
      },
      onUpdate: async (existing, data) => {
        // Preserve slug cũ nếu không có slug mới trong data
        if (!data.slug && existing.slug) {
          data.slug = existing.slug;
        }
        
        // Debug: log shortDescription before/after update
        // try {
        //   console.log('[School.bulkImport.onUpdate] name:', existing && existing.name, 'shortDescription:', {
        //     before: existing && existing.shortDescription ? existing.shortDescription.substring(0, 120) : existing && existing.shortDescription,
        //     after: data && data.shortDescription ? data.shortDescription.substring(0, 120) : data && data.shortDescription
        //   });
        // } catch (e) {}
        
        // Debug: log shortDescription before/after update (config path)
        // try {
        //   console.log('[School.getBulkImportConfig.onUpdate] name:', existing && existing.name, 'shortDescription:', {
        //     before: existing && existing.shortDescription ? existing.shortDescription.substring(0, 120) : existing && existing.shortDescription,
        //     after: data && data.shortDescription ? data.shortDescription.substring(0, 120) : data && data.shortDescription
        //   });
        // } catch (e) {}
        
        // Preserve các field khác nếu không có trong data hoặc là empty string
        const fieldsToPreserve = ['logo', 'ranking', 'nameVi', 'codeId', 'cricos', 'metaTitle', 'metaDescription', 'schoolType', 'abbreviation'];
        fieldsToPreserve.forEach(field => {
          if ((!data[field] || data[field] === '') && existing[field]) {
            data[field] = existing[field];
          }
        });
        
        return existing.updateAttributes(data);
      }
    });

    return summary;
  };

  School.remoteMethod('bulkImport', {
    description: 'Bulk import/update schools from a JSON array with normalization and error handling.',
    accepts: [
      {
        arg: 'schools',
        type: 'array',
        http: { source: 'body' },
        required: true,
        description: "An array of school objects or a wrapper containing 'schools' array."
      }
    ],
    returns: {
      arg: 'summary',
      type: 'object',
      root: true
    },
    http: {
      path: '/bulk-import-json',
      verb: 'post'
    }
  });

  // Config for common bulk importer
  School.getBulkImportConfig = function(appInstance) {
    const Level = appInstance.models.Level;
    const Major = appInstance.models.Major;
    const Location = appInstance.models.location || appInstance.models.Location;
    const City = appInstance.models.City;
    return {
      wrapperKeys: ['schools'],
      maxBatchSize: 1000,
      chunkSize: 50,
      dedupeAndPrepare: (row) => {
        const name = getFirstNonEmpty(row, ['name', 'Name', 'schoolName', 'university_name', 'UniversityName']);
        const slug = getFirstNonEmpty(row, ['slug', 'Slug']);
        if (!name) return { error: 'Missing required field: name' };
        return { key: `name:${normalize(name)}`, prepared: { _resolvedName: name, _resolvedSlug: slug } };
      },
      buildLookups: async (deduped) => {
        const levelNamesSet = new Set();
        const majorNamesSet = new Set();
        const locationIds = new Set();
        const locationSlugs = new Set();
        const locationNames = new Set();
        const cityNames = new Set();
        deduped.forEach(r => {
          toArrayFromMaybe(r.levels || r.level || r.educationLevels || '').forEach(n => levelNamesSet.add(normalize(n)));
          toArrayFromMaybe(r.majors || r.major || r.majorNames || '').forEach(n => majorNamesSet.add(normalize(n)));
          const locId = getFirstNonEmpty(r, ['locationId', 'LocationId']);
          const locSlug = getFirstNonEmpty(r, ['locationSlug']);
          const locName = getFirstNonEmpty(r, ['location', 'locationName']);
          const cityName = getFirstNonEmpty(r, ['city', 'cityName']);
          if (locId) locationIds.add(String(locId));
          if (locSlug) locationSlugs.add(normalize(locSlug));
          if (locName) locationNames.add(locName.trim());
          if (cityName) cityNames.add(cityName.trim());
        });
        const [allLevels, allMajors, locationsById, locationsBySlug, locationsByName, citiesByName] = await Promise.all([
          Level ? (levelNamesSet.size ? Level.find({ where: { name: { inq: Array.from(levelNamesSet) } } }) : Level.find({})) : Promise.resolve([]),
          Major ? (majorNamesSet.size ? Major.find({ where: { name: { inq: Array.from(majorNamesSet) } } }) : Major.find({})) : Promise.resolve([]),
          Location && locationIds.size ? Location.find({ where: { id: { inq: Array.from(locationIds) } } }) : Promise.resolve([]),
          Location && locationSlugs.size ? Location.find({ where: { slug: { inq: Array.from(locationSlugs) } } }) : Promise.resolve([]),
          Location && locationNames.size ? Location.find({ where: { name: { inq: Array.from(locationNames) } } }) : Promise.resolve([]),
          City && cityNames.size ? City.find({ where: { name: { inq: Array.from(cityNames) } } }) : Promise.resolve([])
        ]);
        return {
          levelMap: new Map(allLevels.map(l => [normalize(l.name), l.id])),
          majorMap: new Map(allMajors.map(m => [normalize(m.name), m.id])),
          locationIdMap: new Map(locationsById.map(l => [String(l.id), l])),
          locationSlugMap: new Map(locationsBySlug.map(l => [normalize(l.slug), l])),
          locationNameMap: new Map(locationsByName.map(l => [normalize(l.name), l])),
          cityNameMap: new Map(citiesByName.map(c => [normalize(c.name), c.id]))
        };
      },
      processRow: async (row, lookups) => {
        const name = row._resolvedName;
        let slug = row._resolvedSlug;
        
        // Nếu không có slug trong input, tạo slug mới từ name
        if (!slug && name) {
          slug = slugify(name);
        }
        
        const levelIds = toArrayFromMaybe(row.levels || row.level || row.educationLevels || '')
          .map(n => lookups.levelMap.get(normalize(n)))
          .filter(Boolean);
        const majorIds = toArrayFromMaybe(row.majors || row.major || row.majorNames || '')
          .map(n => lookups.majorMap.get(normalize(n)))
          .filter(Boolean);
        const locId = getFirstNonEmpty(row, ['locationId', 'LocationId']);
        const locSlug = getFirstNonEmpty(row, ['locationSlug']);
        const locName = getFirstNonEmpty(row, ['location', 'locationName']);
        let locationId = '';
        if (locId && lookups.locationIdMap.has(String(locId))) locationId = String(locId);
        else if (locSlug && lookups.locationSlugMap.has(normalize(locSlug))) locationId = String(lookups.locationSlugMap.get(normalize(locSlug)).id);
        else if (locName && lookups.locationNameMap.has(normalize(locName))) locationId = String(lookups.locationNameMap.get(normalize(locName)).id);
        const cityName = getFirstNonEmpty(row, ['city', 'cityName']);
        const cityId = cityName && lookups.cityNameMap.get(normalize(cityName)) ? String(lookups.cityNameMap.get(normalize(cityName))) : undefined;
        const buildDescription = (row) => {
          const seen = new Set();
          const normalizeBlock = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const withHeadingIfMissing = (heading, content) => {
            const text = (content || '').toString().trim();
            if (!text) return '';
            // if (/^\s*#{1,6}\s/.test(text)) return text;
            return `## ${heading}\n\n${text}`;
          };
          const ordered = [
            ['GIỚI THIỆU CHUNG', row.gioi_thieu_chung],
            ['VỊ TRÍ CAMPUS', row.vi_tri_campus],
            ['NGÀNH HỌC CHƯƠNG TRÌNH', row.nganh_hoc_chuong_trinh],
            ['ĐIỀU KIỆN TUYỂN SINH', row.dieu_kien_tuyen_sinh],
            ['HỌC PHÍ VÀ CHI PHÍ', row.hoc_phi_chi_phi],
            ['ĐIỂM THẾ MẠNH', row.diem_the_manh],
            ['RANKINGS TỪ TỔ CHỨC UY TÍN', row.rankings],
            ['THÔNG TIN CAMPUS', row.thong_tin_campus],
            ['HỌC BỔNG', row.hoc_bong],
            ['CHI PHÍ', row.chi_phi],
            ['NGÀNH HỌC THẾ MẠNH', row.nganh_hoc_the_manh],
            ['CƠ HỘI NGHỀ NGHIỆP', row.co_hoi_nghe_nghiep],
            ['YÊU CẦU ĐẦU VÀO', row.yeu_cau_dau_vao],
            ['DU HỌC VỚI ATS', row.du_hoc_voi_ats],
            ['NGUỒN THAM KHẢO', row.nguon_tham_khao],
            ['LỜI KẾT', row.loi_ket]
          ];
          const sections = [];
          for (const [heading, content] of ordered) {
            const norm = normalizeBlock(content);
            if (!norm || seen.has(norm)) continue;
            seen.add(norm);
            sections.push(withHeadingIfMissing(heading, content));
          }
          return sections.join('\n\n');
        };
        const fullDescription = buildDescription(row);
        console.log('shortDescription:', getFirstNonEmpty(row, ['meta_description', 'shortDescription', 'ShortDescription']) || undefined);
        console.log('metaTitle:', getFirstNonEmpty(row, ['meta_title', 'metaTitle', 'MetaTitle']));
        return {
          name: name || getFirstNonEmpty(row, ['university_name', 'UniversityName']) || '',
          slug: slug,
          isPublished: toBoolean(row.isPublished !== undefined ? row.isPublished : true),
          isHot: toBoolean(row.isHot),
          logo: getFirstNonEmpty(row, ['logo', 'Logo']),
          ranking: getFirstNonEmpty(row, ['ranking', 'Ranking']),
          nameVi: getFirstNonEmpty(row, ['nameVi', 'nameVI', 'NameVi']),
          codeId: getFirstNonEmpty(row, ['codeId', 'codeID', 'CodeId']),
          cricos: getFirstNonEmpty(row, ['cricos', 'CRICOS']),
          duration: toNumber(row.duration),
          tuition: toNumber(row.tuition),
          metaTitle: getFirstNonEmpty(row, ['meta_title', 'metaTitle', 'MetaTitle']),
          levelIds: levelIds,
          majorIds: majorIds,
          locationId: locationId || undefined,
          cityId: cityId || undefined,
          schoolType: getFirstNonEmpty(row, ['schoolType', 'SchoolType', 'school-type']) || '',
          shortDescription: getFirstNonEmpty(row, ['meta_description', 'shortDescription', 'ShortDescription']) || undefined,
          description: markdownToHtml(fullDescription) || '',
          updatedAt: new Date(),
          createdAt: new Date(),
          abbreviation: getFirstNonEmpty(row, ['abbreviation', 'Abbreviation']) || ''
        };
      },
      findExisting: async (Model, data) => {
        let existing = await Model.findOne({ where: { name: data.name } });
        if (!existing && data.slug) existing = await Model.findOne({ where: { slug: data.slug } });
        return existing;
      },
      onUpdate: async (existing, data) => {
        // Preserve slug cũ nếu không có slug mới trong data
        if (!data.slug && existing.slug) {
          data.slug = existing.slug;
        }
        
        // Preserve các field khác nếu không có trong data hoặc là empty string
        const fieldsToPreserve = ['logo', 'ranking', 'nameVi', 'codeId', 'cricos', 'metaTitle', 'metaDescription', 'schoolType', 'abbreviation'];
        fieldsToPreserve.forEach(field => {
          if ((!data[field] || data[field] === '') && existing[field]) {
            data[field] = existing[field];
          }
        });
        
        return existing.updateAttributes(data);
      }
    };
  };


  // School.observe('before save', (ctx, next) => {
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
  //   School.findById(id, { fields: { id: true, updatedAt: true }, include: [] })
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

  // School.observe('before save', (ctx, next) => {
  //     // CREATE: server kiểm soát timestamps
  //     if (ctx.isNewInstance && ctx.instance) {
  //       if (!ctx.instance.createdAt) {
  //         ctx.instance.createdAt = moment.utc();
  //       }
  //       ctx.instance.updatedAt = moment.utc();
  //       return next();
  //     }
  //   });
};