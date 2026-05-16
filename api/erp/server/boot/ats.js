const clinic = require('../../common/models/clinic');
const _ = require('lodash');
const nunjucks = require('nunjucks');


const redisClient = require('redis').createClient();
redisClient.on('error', function(err) {
    console.error('Redis error: ', err);
});

// Configure nunjucks
const env = nunjucks.configure({ autoescape: false });

// Add custom filters
env.addFilter('replace', function(str, pattern, replacement) {
    return str.replace(new RegExp(pattern, 'g'), replacement);
});

env.addFilter('lower', function(str) {
    return str.toLowerCase();
});

// Add seoUrl filter - copy from pdfHandler.js
const slugify = require('slugify'); // Needed for the |slug modifier
const _get = require('lodash.get');

// --- Slugify Configuration ---
const slugifyOptions = {
    replacement: '-',  
    remove: /[*+~.()'"!:@]/g, 
    lower: true,      
    strict: true,     
    locale: 'vi',     
    trim: true        
};

function getPropertyValue(obj, path, defaultValue = '') {
    const value = _get(obj, path, defaultValue);
    return value === null || value === undefined ? defaultValue : value;
}

env.addFilter('seoUrl', function(dataObject, config, objectType) {

    // --- Helper Function: Fallback URL Generation ---
    // Generates a URL like /type/id if primary generation fails
    function generateFallbackUrl(obj, typeStr) {
      const objectId = getPropertyValue(obj, 'id', ''); // Get ID from the object

      // Use the provided type string, ensure it's a non-empty string
      const safeTypeStr = typeof typeStr === 'string' && typeStr ? typeStr : 'unknown-type';

      if (safeTypeStr !== 'unknown-type' && objectId) {
        // Basic fallback format: /type/id
        // Slugify the type string for URL safety
        const safeTypeSlug = slugify(safeTypeStr, { lower: true, strict: true });
        return `/${safeTypeSlug}/${objectId}`;
      } else {
        // Log a warning if fallback cannot be fully generated
        console.warn(`friendly-seo-url filter: Could not generate fallback URL (missing objectType argument or id on dataObject). Type provided: ${typeStr}`);
        // Return '#' as the ultimate fallback link
        return '#';
      }
    }

    // --- Main Filter Logic ---

    // 1. Validate dataObject
    if (!dataObject) {
      console.error("friendly-seo-url filter: Primary dataObject is missing.");
      return '#'; // Cannot proceed without an object
    }

    // 2. Validate configuration object and format string
    if (!config || typeof config.fmt !== 'string' || config.fmt.length === 0) {
      console.warn("friendly-seo-url filter: Configuration object or 'fmt' string is missing or invalid. Generating fallback URL.");
      // Generate fallback using the provided objectType argument
      return generateFallbackUrl(dataObject, objectType);
    }

    // 3. Process the format string if config is valid
    let urlFormat = config.fmt;
    try {
      // Use regex to find all placeholders like ${...} and replace them
      const finalUrl = urlFormat.replace(/\$\{(.+?)\}/g, (match, placeholder) => {
        // match = full placeholder e.g., "${manufacturer.name|slug}"
        // placeholder = content inside brackets e.g., "manufacturer.name|slug"

        let path = placeholder;
        let applySlug = false;

        // Check for the '|slug' modifier at the end
        if (placeholder.endsWith('|slug')) {
          applySlug = true;
          path = placeholder.substring(0, placeholder.length - 5); // Get the path part
        }

        // Retrieve the raw value using the path from the dataObject
        // Uses the getPropertyValue helper for safety (handles undefined/null)
        let value = getPropertyValue(dataObject, path);

        // Ensure the value is treated as a string for consistency and slugify
        if (value !== null && value !== undefined) {
            value = String(value);
        } else {
            // Value not found for the path, use empty string
            value = '';
            // Log a warning for debugging purposes
            console.warn(`friendly-seo-url filter: Could not find value for path "${path}" in dataObject.`);
        }

        // Apply slugify function if the |slug modifier was present and value is not empty
        if (applySlug && value) {
          value = slugify(value, slugifyOptions);
        }

        // Return the final (potentially slugified) value to replace the placeholder
        return value;
      }); // End of replace function

      // Optional: Check if any placeholders remain unreplaced (might indicate typo in fmt or missing data)
      if (finalUrl.includes('${')) {
           console.warn(`friendly-seo-url filter: Final URL might still contain unreplaced placeholders: ${finalUrl}`);
      }

      // Return the successfully generated URL
      return finalUrl;

    } catch (error) {
      // Catch any unexpected errors during the replacement process
      console.warn("friendly-seo-url filter: Error during placeholder processing. Generating fallback.", error);
      // Generate fallback using the provided objectType argument
      return generateFallbackUrl(dataObject, objectType);
    }
  }); 

module.exports = function (app) {
    var app = require('../../server/server');
    app.get('/api/load-cfg', async function(req, res) {
        const Clinic = app.models.clinic;

        var sources = Object.keys(app.dataSources);
        for (var i = 0; i < sources.length; i++) {
            var dataSourceName = sources[i];
    
       
            const dataSource = app.dataSources[dataSourceName];

            // skip datasource if it is not mongodb
            if (dataSource.adapter.name !== 'mongodb') {
                console.log('Skipping non-mongodb datasource:', dataSourceName);
                continue;
            }

            Clinic.attachTo(dataSource);
        
            // Load active clinics into Redis
            try {
                var clinic = await Clinic.findOne({ where: { isActive: true } });
                dataSource.clinic = clinic;
                if (clinic) {
                    console.log(clinic.domain);
                    redisClient.set('ds-' + dataSourceName, JSON.stringify(clinic), function(err) {
                        if (err) {
                            console.error('Error saving clinic to Redis:', err);
                        }
                    });
                    console.log('Active clinics loaded into Redis');
                } else {
                    console.log('No active clinics found');
                }
            } catch (err) {
                console.error('Error finding clinic:', err);
            }
        }
    
    });

    app.get('/api/test01', function(req, res) {
        const Clinic = app.models.clinic;
        // get datasource name from Clinic model 
        const datasourceName = Clinic.currentDatasource;
        const dataSource = app.dataSources[datasourceName];

        res.json({clinic: dataSource.clinic, datasourceName: datasourceName});  

        return;

        // additional info how long it takes to get the data
        const startTime = Date.now();
        redisClient.get('ds-' + datasourceName , function(err, data) {
            const duration = Date.now() - startTime;
            console.log('Time taken to get data from Redis:', duration, 'ms');
            if (err) {
                console.error('Error retrieving data from Redis:', err);
                return res.status(500).send('Internal Server Error');
            }
            if (data) {
                const clinic = JSON.parse(data);

                res.json({...clinic, duration });
            } else {
                res.send('No active clinic found ' + datasourceName);
            }
        }
        );
    });

    app.get('/api/test02', function(req, res) {
        const Clinic = app.models.clinic;
        // get datasource name from Clinic model 
        const a = {'a': 1};
        res.json({a: _.get(a, 'a')});
        return;

        // additional info how long it takes to get the data
        const startTime = Date.now();
        Clinic.findOne({ where: { isActive: true } }, function(err, clinic) {
            const duration = Date.now() - startTime;
            console.log('Time taken to get data from MongoDB:', duration, 'ms');
            if (err) {
                console.error('Error retrieving data from MongoDB:', err);
                return res.status(500).send('Internal Server Error');
            }
            if (clinic) {
                res.json({ ...clinic, duration });
            } else {
                res.send('No active clinic found');
            }
        }
        );
    });



   

    function renderTemplateContent(template, data, featureName = null) {
        if (!template) return '';
        console.log('Rendering template', featureName);
        try {
            if (featureName) {
                if(template.id === "68538d7a9bb7e488c4100415") {
                    console.log('Rendering template for feature: ', featureName, 'data: ', data);
                }
                // console.log(`Rendering template for feature: ${featureName}, data: ${JSON.stringify(data)}, template length: ${template}`);
              return env.renderString(template, data);
            }
            if (data.type && data.type === 'menu') {
                // console.log(`Rendering template for feature: data: ${JSON.stringify(data)}, template length: ${template}`);
            }
            return nunjucks.renderString(template, {data: data});
        } catch (error) {
            console.error('Nunjucks render error:', error);
            return `<!-- Template render error: ${error.message} -->`;
        }
    }

    async function renderBlock(block, API_BASE_URL = null) {
        if (!block || !block.type) return `<!-- Unknown block type: ${JSON.stringify(block)} -->`;
        
        // If block has content field, use it as template with block data
        if (block.content) {
            
            // Prepare template data - start with existing data or empty object
            let templateData = { ...(block.data || {}) };
            const blockData = { ...block };
            delete blockData.content; // Remove content field to avoid passing template as data
            
            
            // If block has features, fetch the feature data and add to templateData
            if (block.features && API_BASE_URL) {
                
                try {
                    for (const [featureName, feature] of Object.entries(block.features)) {
                        console.log('Fetching feature data', feature);
                        const featureData = await fetchFeatureData(feature, API_BASE_URL);
                        
                        // Add feature data directly to templateData
                        templateData[featureName] = featureData;
                        return renderTemplateContent(block.content, templateData, Object.keys(templateData));
                    }
                    
                    
                } catch (error) {
                    console.error('❌ Error fetching features:', error);
                }
            } else {
                if (!block.features) {
                    console.log('Reason: Block has no features field');
                }
                if (!API_BASE_URL) {
                    console.log('Reason: No API_BASE_URL provided');
                }
            }
            
            
            // Use env.renderString instead of nunjucks.renderString to access custom filters
            const renderedContent = renderTemplateContent(block.content, blockData);
            
            
            return renderedContent;
        }
    
        // Handle block-template type specifically
        if (block.type === 'query' && block.data) {
            return await renderBlock(block.data, API_BASE_URL);
        }
        
        // Fallback to traditional rendering for blocks without content
        const styleObject = (block.styles && typeof block.styles === 'object' && !Array.isArray(block.styles))
                           ? block.styles
                           : (block.style && typeof block.style === 'object' && !Array.isArray(block.style))
                           ? block.style
                           : {};
        const styleAttributeValue = applyStyles(styleObject);
        const styleAttribute = styleAttributeValue ? `style="${styleAttributeValue}"` : '';
        const idAttribute = block.id ? `id="${block.id}"` : '';
        const classAttribute = `class="block-type-${block.type}"`;
        const combinedAttributes = `${idAttribute} ${classAttribute} ${styleAttribute}`.trim();
    
        switch (block.type) {
            case 'text':
            case 'heading':
                const textContent = block.text || block.content || '';
                const tagName = block.type === 'heading' ? 'h1' : 'div';
                return `<${tagName} ${combinedAttributes}>${textContent}</${tagName}>`;
        
            case 'image':
                const imgSrc = block.src || '';
                const imgAlt = block.alt || '';
                const imgHref = block.href;
                
                if (imgHref) {
                    return `<a href="${imgHref}"><img src="${imgSrc}" alt="${imgAlt}" ${combinedAttributes} /></a>`;
                } else {
                    return `<img src="${imgSrc}" alt="${imgAlt}" ${combinedAttributes} />`;
                }
        
            case 'video':
                const videoSrc = block.src || block.url || '';
                const videoAlt = block.alt || '';
                const videoControls = block.controls !== false ? 'controls' : '';
                const videoAutoplay = block.autoplay ? 'autoplay' : '';
                const videoLoop = block.loop ? 'loop' : '';
                const videoMuted = block.muted ? 'muted' : '';
                const videoPoster = block.poster ? `poster="${block.poster}"` : '';
                const videoWidth = block.width ? `width="${block.width}"` : '';
                const videoHeight = block.height ? `height="${block.height}"` : '';
                
                const videoAttributes = [videoControls, videoAutoplay, videoLoop, videoMuted, videoPoster, videoWidth, videoHeight]
                    .filter(attr => attr).join(' ');
                
                return `<video ${combinedAttributes} ${videoAttributes}>
                    <source src="${videoSrc}" type="video/mp4">
                    ${videoAlt || 'Your browser does not support the video tag.'}
                </video>`;
        
            case 'button':
            case 'button-item':
                const buttonText = block.text || block.content || 'Button';
                const href = block.href || block.url || '#';
                return `<a href="${href}" ${combinedAttributes}>${buttonText}</a>`;
        
            case 'column':
                if (block.children && Array.isArray(block.children)) {
                    const childrenHtml = await Promise.all(block.children.map(child => renderBlock(child, API_BASE_URL)));
                    const columnStyle = applyStyles(block.styles || {});
                    const columnStyleAttr = columnStyle ? `style="${columnStyle}"` : '';
                    return `<div ${columnStyleAttr}>${childrenHtml.join('')}</div>`;
                }
                return `<div ${combinedAttributes}><!-- Empty column --></div>`;
    
            case 'columns':
                if (block.columns && Array.isArray(block.columns)) {
                    const columnsHtml = await Promise.all(block.columns.map(async column => {
                        const columnStyle = applyStyles(column.styles || column.style || {});
                        const columnStyleAttr = columnStyle ? `style="${columnStyle}"` : '';
                        
                        const childrenHtml = column.children && Array.isArray(column.children)
                            ? await Promise.all(column.children.map(child => renderBlock(child, API_BASE_URL)))
                            : [];
                    
                        if (column.href) {
                            return `<a href="${column.href}" ${columnStyleAttr}>${childrenHtml.join('')}</a>`;
                        } else {
                            return `<div ${columnStyleAttr}>${childrenHtml.join('')}</div>`;
                        }
                    }));
                    
                    const containerStyle = applyStyles(block.styles || {});
                    const containerStyleAttr = containerStyle ? `style="${containerStyle}"` : '';
                    return `<div ${containerStyleAttr}>${columnsHtml.join('')}</div>`;
                }
                return `<div ${combinedAttributes}><!-- Empty columns --></div>`;
    
            case 'slide':
                if (block.children && Array.isArray(block.children)) {
                    const slideStyle = applyStyles(block.styles || block.style || {});
                    const slideStyleAttr = slideStyle ? `style="${slideStyle}"` : '';
                    const childrenHtml = await Promise.all(block.children.map(child => renderBlock(child, API_BASE_URL)));
                    return `<div class="slide" ${slideStyleAttr}>${childrenHtml.join('')}</div>`;
                }
                return `<div class="slide" ${combinedAttributes}><!-- Empty slide --></div>`;
        
            case 'slider':
                if (block.slides && Array.isArray(block.slides)) {
                    const slidesHtml = await Promise.all(block.slides.map(slide => renderBlock(slide, API_BASE_URL)));
                    const showControls = block.config?.showControls !== false;
                    const showDots = block.config?.showDots !== false;
                    
                    const sliderStyle = applyStyles(block.styles || {});
                    const sliderStyleAttr = sliderStyle ? `style="${sliderStyle}"` : '';
                    
                    return `<div class="slider" ${sliderStyleAttr}>
                        <div class="slides">${slidesHtml.join('')}</div>
                        ${showControls ? '<div class="controls"><button class="prev">❮</button><button class="next">❯</button></div>' : ''}
                        ${showDots ? '<div class="dots"></div>' : ''}
                    </div>`;
                }
                return `<div ${combinedAttributes}><!-- Empty slider --></div>`;
        
            case 'buttons':
                if (block.buttons && Array.isArray(block.buttons)) {
                    const buttonsHtml = await Promise.all(block.buttons.map(button => renderBlock(button, API_BASE_URL)));
                    return `<div ${combinedAttributes}>${buttonsHtml.join('')}</div>`;
                }
                return `<div ${combinedAttributes}><!-- Empty buttons --></div>`;
        
            case 'custom':
                // Handle custom type - just render content if available
                if (block.content) {
                    return `<div ${combinedAttributes}>${block.content}</div>`;
                }
                return `<div ${combinedAttributes}><!-- Custom block: ${block.name || 'Unnamed'} --></div>`;
            case 'menu':
                if (block.content) {
                    return `<div ${combinedAttributes}>${block.content}</div>`;
                }
                return `<div ${combinedAttributes}><!-- Custom block: ${block.name || 'Unnamed'} --></div>`;
            default:
                return `<div ${combinedAttributes}><!-- Unsupported block type: ${block.type} --></div>`;
        }
    }

    async function fetchFeatureData(feature, API_BASE_URL) {
        if (!feature || !feature.model) {
            console.log('No feature or model', feature);
            return [];
        }
        
        try {
            // Resolve LoopBack model by multiple naming strategies
            const Model = app.models[feature.model];
            if (!Model) {
                console.log('Model not found for feature.model:', feature.model);
                return [];
            }

            // Build LoopBack filter from provided feature.filter
            /** @type {object} */
            const lbFilter = {};

            if (feature.filter) {
                const { where, limit, order, fields, include, skip, offset } = feature.filter;
                if (where) lbFilter.where = where;
                if (typeof limit !== 'undefined') lbFilter.limit = limit;
                if (order) lbFilter.order = order;
                if (fields) lbFilter.fields = fields;
                if (include) lbFilter.include = include;
                if (typeof skip !== 'undefined') lbFilter.skip = skip;
                if (typeof offset !== 'undefined') lbFilter.offset = offset;
            }

            // Use callback API for compatibility with LoopBack v2
            const data = await new Promise((resolve) => {
                Model.find(lbFilter, function(err, results) {
                    if (err) {
                        console.error('💥 Error querying model for feature data:', err);
                        return resolve([]);
                    }
                    resolve(results || []);
                });
            });
            console.log('Feature data', data.length);
            return data;
        } catch (error) {
            console.error('💥 Error fetching feature data from model:', error);
            return [];
        }
    }

    function applyStyles(styleObj) {
        if (!styleObj || typeof styleObj !== 'object') return '';
        return Object.entries(styleObj)
            .filter(([, value]) => value !== null && value !== undefined && value !== '')
            .map(([key, value]) => {
                const cssKey = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
                return `${cssKey}: ${value}`;
            })
            .join('; ');
    }

    // Update renderDataBlocks to pass API_BASE_URL
    async function renderDataBlocks(dataBlocks, isBaseContext = false, API_BASE_URL = null) {
        if (!dataBlocks || !Array.isArray(dataBlocks)) return '';
        
       
        
        const renderedBlocks = await Promise.all(dataBlocks.map(async (block, index) => {
            
            if (isBaseContext && block.type === 'placeholder') {
                console.log('📍 Placeholder block detected');
                return '<!-- page-content-placeholder-marker -->';
            }
            
            return await renderBlock(block, API_BASE_URL);
        }));
        
        return renderedBlocks.join('\n');
    }



    app.get('/api/r/:slug', async function(req, res) {
        const slug = req.params.slug;
        const API_BASE_URL = 'https://danhhien.test.live1.vn/api/';
        
        const TEMPLATE_URL = 'https://danhhien.test.live1.vn/api/templates/674ae96ed1edb02c507a80af';
        
        if (typeof API_BASE_URL === 'undefined') {
            console.error("API_BASE_URL is not defined. Please define it in your application config.");
            return res.status(500).send('Server configuration error: API_BASE_URL not defined.');
        }
    
        const ALL_PAGES_DATA_URL = `${API_BASE_URL}pages?filter={"include":"base"}`;
    
        try {
            async function fetchData(url) {
                const fetch = require('node-fetch');
                const response = await fetch(url);
                if (!response.ok) {
                    if (response.status === 404) return null;
                    throw new Error(`HTTP error ${response.status}: ${response.statusText} for URL ${url}`);
                }
                return response.json();
            }
            
            // Fetch template HTML
            const templateData = await fetchData(TEMPLATE_URL);
            if (!templateData || !templateData.content) {
                return res.status(500).send('Error fetching template data.');
            }
    
            // Fetch all pages data
            const allPagesArray = await fetchData(ALL_PAGES_DATA_URL);
    
            if (!allPagesArray || !Array.isArray(allPagesArray)) {
                console.error('Failed to fetch or parse all pages data, or data is not an array from:', ALL_PAGES_DATA_URL);
                return res.status(500).send('Error fetching page data from the source.');
            }
    
            // Find the specific page by slug from the fetched array
            let pageData = allPagesArray.find(p => p.slug === slug);
            
            if (!pageData) {
                return res.status(404).send(`Page with slug '${slug}' not found.`);
            }
    
            const pageName = pageData.name || slug;
            let renderedHtmlContent = '';
            
            // Check if the page has a base relation
            if (pageData.base && pageData.base.dataBlocks && Array.isArray(pageData.base.dataBlocks)) {
                // Render base blocks with isBaseContext=true to identify placeholders
                const basePageBlocks = pageData.base.dataBlocks || [];
                const renderedBaseContent = await renderDataBlocks(basePageBlocks, true, API_BASE_URL);
                
                // Render current page blocks
                const currentPageBlocks = pageData.dataBlocks || [];
                const renderedPageContent = await renderDataBlocks(currentPageBlocks, false, API_BASE_URL);
                
                // Replace placeholder markers with current page content
                renderedHtmlContent = renderedBaseContent.replace(
                    '<!-- page-content-placeholder-marker -->',
                    renderedPageContent || '<!-- Page has no content to display -->'
                );
            } else {
                // No base relation, render only current page blocks
                const currentPageBlocks = pageData.dataBlocks || [];
                renderedHtmlContent = await renderDataBlocks(currentPageBlocks, false, API_BASE_URL);
            }
            
            // Extract head scripts from rendered content
            let headScripts = '';
            const headScriptRegex = /<!-- SCRIPT_HEAD_MARKER:(.*?) -->([\s\S]*?)<!-- END_SCRIPT_HEAD_MARKER:\1 -->/g;
            let match;
            while ((match = headScriptRegex.exec(renderedHtmlContent)) !== null) {
                headScripts += match[2] + '\n';
            }
            // Remove script markers from body content
            renderedHtmlContent = renderedHtmlContent.replace(headScriptRegex, '');
    
    
            // Use template HTML from API
            let templateHtml = templateData.content;
            
            // Replace template placeholders with actual content
            templateHtml = templateHtml
                // Replace title
                .replace(/\{\{site\.name\}\} - \{\{tpl\.subject\}\}/g, pageName)
                .replace(/<title>.*?<\/title>/i, `<title>${pageName}</title>`)
                
                // Add additional stylesheets to head (removed canvas styles)
                // .replace('</head>', `    ${stylesheetsHtml}\n    ${headScripts}\n</head>`)
                
                // Replace body content block
                .replace(/\{\% block body \%\}[\s\S]*?\{\% endblock \%\}/g, renderedHtmlContent || '<!-- Page has no content to display -->')
                
                // Add scripts before closing body tag
                // .replace('</body>', `    ${scriptsHtml}\n</body>`)
                
                // Remove any remaining Jinja2 template syntax that we don't handle
                .replace(/\{\%[^%]*\%\}/g, '')
                .replace(/\{\{[^}]*\}\}/g, '')
                
                // Replace template attributes if present
                .replace(/tpl=".*?"/g, `tpl="${slug}"`);
    
            res.set('Content-Type', 'text/html');
            res.send(templateHtml);
    
        } catch (err) {
            console.error(`💥 Error fetching or rendering page for slug '${slug}':`, err);
            console.error('Error stack:', err.stack);
            res.status(500).send('Error loading page data or template.');
        }
    });

    // Delete objects by name in a specified model
    function deleteByNameHandler(req, res) {
        try {
            const { model, name, caseInsensitive } = req.body || {};
            if (!model || !name) {
                return res.status(400).json({ error: "Missing required body fields 'model' and 'name'." });
            }

            const TargetModel = app.models[model];
            if (!TargetModel) {
                return res.status(400).json({ error: `Model '${model}' not found.` });
            }

            const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const buildExactRegex = (value) => new RegExp(`^${escapeRegExp(value)}$`, 'i');

            /** @type {object} */
            let where;
            if (caseInsensitive === 'true') {
                where = { name: buildExactRegex(name) };
            } else {
                where = { name: name };
            }

            TargetModel.destroyAll(where, function(err, info) {
                if (err) {
                    console.error('Error deleting objects:', err);
                    return res.status(500).json({ error: 'Internal Server Error' });
                }
                const deleted = (info && (info.count || (info.result && info.result.n))) || 0;
                return res.json({ model, name, caseInsensitive: caseInsensitive === 'true', deletedCount: deleted });
            });
        } catch (error) {
            console.error('Unexpected error in delete-by-name:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    app.post('/api/admin/delete-by-name', deleteByNameHandler);
    app.delete('/api/admin/delete-by-name', deleteByNameHandler);

    
}
