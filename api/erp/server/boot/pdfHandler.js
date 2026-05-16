var pdf = require('html-pdf');
var moment = require('moment');
var app = require('../server');
var _ = require('underscore');
var utils = require('./utility');
var vm = require('vm');
const util = require('util');
var i18n = require('./i18n');

var nunjucks = require('nunjucks');
const e = require('express');
var env = new nunjucks.Environment();
var redis = require("redis"),
    redisClient = redis.createClient();

var templateEngine = nunjucks.configure('public', {
    autoescape: true,
    express: app
});

// ==================== CANONICAL URL HELPER FUNCTIONS ====================
/**
 * Tạo canonical URL thông minh - ưu tiên slug, fallback về template name
 * Đây là function chính được sử dụng để tạo canonical URL
 * @param {Object} req - Express request object
 * @returns {string} Canonical URL thông minh
 */
function generateSmartCanonicalUrl(req, options = {}) {
    try {
        // Luôn ưu tiên HTTPS
        const protocol = req.headers['x-forwarded-proto'] === 'https' || req.secure ? 'https' : req.protocol;
        const baseUrl = protocol + '://' + req.get('host');

        const { templateName = req.query.template, result = [], modelName = req.query.modelName, normalizeHome = true } = options;

        let canonicalPath = '/';

        // Helper: chuẩn hoá collection path từ template/model
        function getCollectionPath() {
            // Ưu tiên templateName và loại bỏ hậu tố -detail
            if (templateName && typeof templateName === 'string') {
                const normalized = templateName.replace(/-detail$/i, '');
                if (normalized) return `/${normalized}`;
            }
            // Fallback vào req.query.template nếu có
            if (req.query.template && typeof req.query.template === 'string') {
                const normalized = req.query.template.replace(/-detail$/i, '');
                if (normalized) return `/${normalized}`;
            }
            // Fallback theo modelName (giữ nguyên dạng đã cung cấp)
            if (modelName && typeof modelName === 'string') {
                return `/${modelName}`;
            }
            return '/';
        }

        // Helper: trích slug từ filter (kể cả where.or)
        function extractSlugFromFilter(filterObj) {
            if (!filterObj) return '';
            if (filterObj.slug) return String(filterObj.slug);
            if (filterObj.where) {
                if (filterObj.where.slug) return String(filterObj.where.slug);
                if (Array.isArray(filterObj.where.or)) {
                    const slugCond = filterObj.where.or.find(c => c && typeof c === 'object' && c.slug);
                    if (slugCond && slugCond.slug) return String(slugCond.slug);
                }
            }
            return '';
        }

        // 1. Đọc filter từ query, xác định có target item cụ thể hay không
        let requestedSlug = '';
        let hasIdInFilter = false;
        let isBroadWhere = false;
        let parsedFilterForFlags = null;
        if (req.query.filter) {
            try {
                parsedFilterForFlags = typeof req.query.filter === 'string' ? JSON.parse(req.query.filter) : req.query.filter;
                requestedSlug = extractSlugFromFilter(parsedFilterForFlags);
                if (!requestedSlug && parsedFilterForFlags && parsedFilterForFlags.id) {
                    hasIdInFilter = true;
                }
                // broad filter nếu where trống hoặc không có điều kiện
                if (parsedFilterForFlags && parsedFilterForFlags.where && Object.keys(parsedFilterForFlags.where).length === 0) {
                    isBroadWhere = true;
                }
            } catch (e) {
                console.log(`⚠️ Invalid filter JSON: ${req.query.filter}`);
            }
        }

        // 2. Xác định trang chi tiết hay danh sách
        const templateLooksDetail = typeof templateName === 'string' && /-detail$/i.test(templateName);
        const isDetailRequest = templateLooksDetail || !!requestedSlug || hasIdInFilter;

        // 3. Tính collection path (ví dụ: /locations từ locations-detail)
        const collectionPath = getCollectionPath();

        // 4. Xây canonical path
        if (isDetailRequest) {
            // Ưu tiên slug từ filter, sau đó tới slug từ result, cuối cùng id từ result
            let finalSlugOrId = requestedSlug;
            if (!finalSlugOrId && Array.isArray(result) && result[0] && result[0].slug) {
                finalSlugOrId = String(result[0].slug);
            }
            if (!finalSlugOrId && Array.isArray(result) && result[0] && result[0].id) {
                finalSlugOrId = String(result[0].id);
            }

            if (finalSlugOrId) {
                canonicalPath = `${collectionPath.replace(/\/$/, '')}/${finalSlugOrId}`;
            } else if (req.query.template) {
                canonicalPath = `/${req.query.template}`;
                console.log(`✅ Using template name as fallback: ${canonicalPath}`);
            } else {
                canonicalPath = collectionPath !== '/' ? collectionPath : '/';
                if (canonicalPath === '/') console.log(`✅ Using root as final fallback: ${canonicalPath}`);
            }
        } else {
            // Trang danh sách: không dùng slug/id từ result dù có dữ liệu
            canonicalPath = collectionPath !== '/' ? collectionPath : '/';
            if (canonicalPath === '/') console.log(`✅ Using root as final fallback: ${canonicalPath}`);
        }

        // Chuẩn hoá: nếu là /home hoặc /home/ thì trả về /
        if (normalizeHome && (canonicalPath === '/home' || canonicalPath === '/home/')) {
            canonicalPath = '/';
        }

        // Đảm bảo URL là absolute và không mang query
        const canonicalUrl = baseUrl + canonicalPath;
        return canonicalUrl;

    } catch (error) {
        console.error('Error generating smart canonical URL:', error);
        // Fallback an toàn
        const protocol = req.headers['x-forwarded-proto'] === 'https' || req.secure ? 'https' : req.protocol;
        return protocol + '://' + req.get('host') + '/';
    }
}

/**
 * Sinh meta robots "thông minh" dựa trên ngữ cảnh trang
 * - Detail: index, follow (trừ khi draft/preview/noindex)
 * - List: page 1 => index, follow; page > 1 => noindex, follow
 * - Search/filter đặc biệt, preview/edit, not-found => noindex (thường nofollow nếu private)
 */
function generateSmartMetaRobots(req, options = {}) {
    try {
        const { templateName = req.query.template, result = [], totalPages, currentPage = Number(req.query.page || 1) || 1 } = options;

        // Nhan dien detail vs list giống canonical
        let requestedSlug = '';
        let hasIdInFilter = false;
        if (req.query.filter) {
            try {
                const parsed = typeof req.query.filter === 'string' ? JSON.parse(req.query.filter) : req.query.filter;
                if (parsed) {
                    if (parsed.slug) requestedSlug = String(parsed.slug);
                    if (parsed.where && parsed.where.slug) requestedSlug = String(parsed.where.slug);
                    if (!requestedSlug && parsed.id) hasIdInFilter = true;
                    if (!requestedSlug && parsed.where && Array.isArray(parsed.where.or)) {
                        const cond = parsed.where.or.find(c => c && typeof c === 'object' && c.slug);
                        if (cond && cond.slug) requestedSlug = String(cond.slug);
                    }
                }
            } catch (e) { }
        }
        const templateLooksDetail = typeof templateName === 'string' && /-detail$/i.test(templateName);
        const isDetailRequest = templateLooksDetail || !!requestedSlug || hasIdInFilter;

        // Default
        let robots = 'index, follow';

        // Global switches
        const isPreview = req.query.preview === 'true' || req.query.edit === 'true' || req.param('edit') === 'true';
        if (isPreview) return 'noindex, nofollow';
        if (templateName === 'not-found') return 'noindex, nofollow';

        // Query types considered as search/listing facets
        const hasSearchQuery = !!(req.query.q || req.query.search || req.query.keyword);

        if (isDetailRequest) {
            const item = Array.isArray(result) ? result[0] : null;
            const status = item && item.status ? String(item.status) : '';
            const explicitRobots = item && item.seo && item.seo.robots ? String(item.seo.robots) : '';
            const hasExplicitUnpublished = (
                item &&
                Object.prototype.hasOwnProperty.call(item, 'isPublished') &&
                item.isPublished === false
            );
            const explicitNoindex = (item && (item.noindex === true || (item.seo && item.seo.noindex === true)) || hasExplicitUnpublished);

            if (explicitRobots) return explicitRobots;
            if (explicitNoindex || status === 'draft' || hasExplicitUnpublished) return 'noindex, nofollow';
            return 'index, follow';
        } else {
            // List pages logic
            if (hasSearchQuery) return 'noindex, follow';
            if (currentPage > 1) return 'noindex, follow';
            // If explicitly huge pagination known (optional): if totalPages && totalPages > 1 and currentPage === 1 still index
            return 'index, follow';
        }
    } catch (error) {
        console.error('Error generating smart meta robots:', error);
        return 'index, follow';
    }
}
// ==================== END CANONICAL URL HELPERS ====================

/**
 * Loại bỏ các query parameters không cần thiết cho canonical
 * @param {string} path - Path cần làm sạch
 * @returns {string} Path đã được làm sạch
 */
function removeUnnecessaryQueryParams(path) {
    if (!path.includes('?')) return path;

    const [basePath, queryString] = path.split('?');
    if (!queryString) return basePath;

    const params = new URLSearchParams(queryString);
    const unnecessaryParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'ref', 'fbclid', 'gclid', 'msclkid', 'dclid', 'mc_cid', 'mc_eid',
        'source', 'medium', 'campaign', 'term', 'content'
    ];

    // Loại bỏ các params không cần thiết
    unnecessaryParams.forEach(param => {
        params.delete(param);
    });

    // Giữ lại các params quan trọng như page, sort, filter
    const remainingParams = params.toString();

    return remainingParams ? `${basePath}?${remainingParams}` : basePath;
}

// ==================== NUNJUCKS CUSTOM FILTERS ====================
// Thêm custom filter cho canonical URL
env.addFilter('canonical', function (url, req) {
    if (!url) {
        return generateSmartCanonicalUrl(req);
    }

    // Nếu URL là relative, chuyển thành absolute
    if (url.startsWith('/')) {
        return req.protocol + '://' + req.get('host') + url;
    }

    // Nếu URL là absolute, trả về nguyên
    if (url.startsWith('http')) {
        return url;
    }

    return url;
});

// Filter để tạo URL an toàn
env.addFilter('safeUrl', function (url, req) {
    if (!url) return '';

    try {
        // Đảm bảo URL là absolute
        if (url.startsWith('/')) {
            return req.protocol + '://' + req.get('host') + url;
        }

        // Nếu đã là absolute, trả về nguyên
        if (url.startsWith('http')) {
            return url;
        }

        // Fallback
        return req.protocol + '://' + req.get('host') + '/' + url;
    } catch (error) {
        console.error('Error in safeUrl filter:', error);
        return req.protocol + '://' + req.get('host') + '/';
    }
});

// Simple filter cho meta robots (giữ an toàn giá trị)
env.addFilter('metaRobots', function (robots) {
    if (!robots || typeof robots !== 'string') return 'index, follow';
    return robots;
});
// Filter để truncate text theo độ dài
env.addFilter('truncate', function (text, length, suffix = '...') {
    if (!text || text.length <= length) return text;
    return text.substring(0, length - suffix.length) + suffix;
});

// Filter để escape HTML entities
env.addFilter('escapeHtml', function (text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
});

// ==================== END NUNJUCKS FILTERS ====================

var gender = {
    "male": "Nam",
    "female": "Nữ",
    "other": "Khác"
};
// make it fit the width of the page
var report_options =
{
    "format": "A3",
    "orientation": "portrait",
    "border": {
        "top": "0in",
        "right": "0in",
        "bottom": "0in",
        "left": "0in"
    },
    "footer": {
        "contents": '<img style="width:30px;height:30px" src="http://127.0.0.1/styles/img/footer-print.jpg" /><span style="color: #444;">P {{page}}</span>'
    }
};




function splitIntoSections(html) {
    var tagSectionStart = '<!-- sections -->'; var tagSectionEnd = '<!-- sections end-->';
    var beginTag = '<!-- section: ';
    var endTag = ' -->';
    var sections = [];

    var head = html.substring(0, html.indexOf(tagSectionStart));
    var tail = html.substring(html.indexOf(tagSectionEnd) + tagSectionEnd.length, html.length);
    var body = html.substring(head.length + tagSectionStart.length, html.length - tail.length - tagSectionEnd.length);

    var tagPosition = 0;
    var nextPos = 0;
    while (tagPosition != -1) {
        tagPosition = body.indexOf(beginTag, nextPos);
        if (tagPosition != -1) {
            var endTagPos = body.indexOf(endTag, nextPos);
            if (endTagPos != -1) {
                var sectionName = body.substring(tagPosition + beginTag.length, endTagPos);
                nextPos = endTagPos + endTag.length;
                console.log('sectionName ', sectionName, endTagPos, nextPos);

                // close section tag
                var closeSectionTag = beginTag + sectionName + ' end-->';

                var closeSectionTagPos = body.indexOf(closeSectionTag, nextPos);

                if (closeSectionTagPos != - 1) {
                    var content = body.substring(nextPos, closeSectionTagPos).trim();
                    if (content)
                        sections.push({ id: sections.length + 1, name: sectionName, content: head + content + tail });
                }

                nextPos = closeSectionTagPos + closeSectionTag.length;

            }
            tagPosition = endTagPos;
        }
    }

    return sections;
}

function singularizeNoun(pluralNoun) {
    if (pluralNoun.endsWith('s')) {
        return pluralNoun.slice(0, -1); // Remove the 's' at the end
    } else {
        return pluralNoun; // No change for irregular plurals or singular nouns
    }
}


function replaceDatePlaceholders(filter, r) {
    const today = moment().startOf('day').toDate();
    const thisMonth = moment().startOf('month').toDate();
    const nextMonth = moment().add(1, 'month').startOf('month').toDate();

    const datePlaceholders = {
        '$today': today,
        '$thisMonth': thisMonth,
        '$nextMonth': nextMonth
    };

    const replaceDates = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'object') {
                replaceDates(obj[key]);
            } else if (typeof obj[key] === 'string' && datePlaceholders[obj[key]]) {
                obj[key] = datePlaceholders[obj[key]];
            }
        }
    };

    replaceDates(filter);
}



async function checkAndHandleRedirect(req, res) {
    // Whitelist các domain hợp lệ (thay bằng domain thật của bạn)
    const allowedDomains = ['yourdomain.com', 'www.yourdomain.com'];

    // Kiểm tra model Settings có tồn tại không
    if (!app || !app.models || !app.models.Setting) {
        console.error('Settings model is not available in app.models');
        return false;
    }
    const Settings = app.models.Setting;

    let redirectConfig;
    try {
        redirectConfig = await new Promise((resolve, reject) => {
            Settings.findOne({ where: { key: 'redirects.config' } }, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    } catch (error) {
        console.error('Error fetching redirects.config:', error);
        return false;
    }

    const originalPath = req.path;
    const originalTemplate = req.query.template || req.param('template');
    // Kiểm tra xem có phải request từ nginx rewrite từ "/" không
    // Nếu req.path là "/api/pdf" và template=home, có thể là từ nginx rewrite "/" thành "/api/pdf?template=home"
    const isFromNginxRootRewrite = originalPath === '/api/pdf' && originalTemplate === 'home';

    let canonicalPath = '/';
    try {
        const canonicalUrl = generateSmartCanonicalUrl(req);
        const urlObj = new URL(canonicalUrl);
        canonicalPath = urlObj.pathname;
    } catch (e) {
        canonicalPath = req.path;
    }

    if (redirectConfig && Array.isArray(redirectConfig.value)) {
        let match = null;

        // Ưu tiên 1: Tìm rule có source="/home" khi có template=home và path=/api/pdf
        // Vì cả "/" và "/home" đều có thể thành "/api/pdf?template=home"
        const homeRule = redirectConfig.value.find(r => r.source === '/home');
        if (homeRule && originalPath === '/api/pdf' && originalTemplate === 'home' && !req.query._redirected) {
            match = homeRule;
            console.log('Found redirect rule for /home (via /api/pdf?template=home), Match:', match);
        }

        // Ưu tiên 2: Tìm rule theo originalPath nếu không phải /api/pdf
        if (!match && originalPath && originalPath !== '/api/pdf' && originalPath !== '/') {
            match = redirectConfig.value.find(r => r.source === originalPath);
            if (match) {
                console.log('Found redirect rule by originalPath:', originalPath, 'Match:', match);
            }
        }

        // Ưu tiên 3: Tìm rule theo canonicalPath
        if (!match) {
            match = redirectConfig.value.find(r => r.source === canonicalPath);
            if (match) {
                console.log('Found redirect rule by canonicalPath:', canonicalPath, 'Match:', match);
            }
        }

        if (match) {
            const dest = match.destination;

            // Tránh redirect loop: nếu đã ở destination rồi thì không redirect
            // Trừ khi request ban đầu là từ /home
            if (dest === '/' && isFromNginxRootRewrite) {
                console.log('Already at destination "/" (via nginx rewrite), skipping redirect to avoid loop');
                return false;
            }

            // Chỉ cho phép redirect tới URL nội bộ hoặc domain hợp lệ
            let isSafe = false;
            console.log('Redirect destination:', dest);
            if (typeof dest === 'string') {
                if (dest.startsWith('/')) {
                    isSafe = true;
                } else {
                    try {
                        const urlObj = new URL(dest, `http://${req.get('host')}`);
                        isSafe = allowedDomains.includes(urlObj.hostname);
                    } catch (e) {
                        isSafe = false;
                    }
                }
            }
            if (isSafe) {
                console.log('Performing redirect to:', dest, 'with type:', match.type);
                res.redirect(match.type === '301' ? 301 : 302, dest);
                return true;
            } else {
                console.log('Unsafe redirect destination detected:', dest);
                // Không redirect tới domain lạ hoặc URL không hợp lệ
                console.warn('Unsafe redirect destination blocked:', dest);
                res.status(400).send('Invalid redirect destination');
                return true;
            }
        }
    }
    // let canonicalPath = '/';
    // try {
    //     const canonicalUrl = generateSmartCanonicalUrl(req);
    //     const urlObj = new URL(canonicalUrl);
    //     canonicalPath = urlObj.pathname;
    // } catch (e) {
    //     canonicalPath = req.path;
    // }

    // if (redirectConfig && Array.isArray(redirectConfig.value)) {
    //     const match = redirectConfig.value.find(r => r.source === canonicalPath);
    //     console.log('redirectConfig', redirectConfig.value);
    //     console.log('Checking redirects for path:', canonicalPath, 'Found match:', match);
    //     if (match) {
    //         const dest = match.destination;
    //         // Chỉ cho phép redirect tới URL nội bộ hoặc domain hợp lệ
    //         let isSafe = false;
    //         console.log('Redirect destination:', dest);
    //         if (typeof dest === 'string') {
    //             if (dest.startsWith('/')) {
    //                 isSafe = true;
    //             } else {
    //                 try {
    //                     const urlObj = new URL(dest, `http://${req.get('host')}`);
    //                     isSafe = allowedDomains.includes(urlObj.hostname);
    //                 } catch (e) {
    //                     isSafe = false;
    //                 }
    //             }
    //         }
    //         if (isSafe) {
    //             console.log('Performing redirect to:', dest);
    //             return res.redirect(match.type === '301' ? 301 : 302, dest);
    //         } else {
    //             console.log('Unsafe redirect destination detected:', dest);
    //             // Không redirect tới domain lạ hoặc URL không hợp lệ
    //             console.warn('Unsafe redirect destination blocked:', dest);
    //             res.status(400).send('Invalid redirect destination');
    //             return true;
    //         }
    //     }
    // }


    return false;
}




module.exports.generateFromPage = async function (pageName,
    filter, modelName, res, req,
    cb, keyPath) {

    if (await checkAndHandleRedirect(req, res)) return;

    var urlPrefix = req.protocol + '://' + req.get('host');
    console.log('Generating from Page:', pageName);

    // Tối ưu: Lấy data trực tiếp từ database thay vì gọi API

    try {
        // Chuẩn bị biến templateData, sẽ chỉ fetch nếu hostname phù hợp
        let templateData = null;

        // Lấy page data trực tiếp từ database với base relation
        const Page = app.models.Page;
        const pageData = await new Promise((resolve, reject) => {
            Page.findOne({
                where: { slug: pageName },
                include: ["base"]
            }, function (err, page) {
                if (err) {
                    console.error('Error fetching page:', err);
                    return reject(err);
                }
                if (!page) {
                    return reject(new Error(`Page with slug '${pageName}' not found.`));
                }
                resolve(page);
            });
        });

        const pageName_final = pageData.name || pageName;
        let renderedHtmlContent = '';

        // Check if the page has a base relation
        if (pageData.base && pageData.base.dataBlocks && Array.isArray(pageData.base.dataBlocks)) {
            // Render base blocks with isBaseContext=true to identify placeholders
            const basePageBlocks = pageData.base.dataBlocks || [];
            const renderedBaseContent = await renderDataBlocks(basePageBlocks, true);

            // Render current page blocks
            const currentPageBlocks = pageData.dataBlocks || [];
            const renderedPageContent = await renderDataBlocks(currentPageBlocks, false);

            // Replace placeholder markers with current page content
            renderedHtmlContent = renderedBaseContent.replace(
                '<!-- page-content-placeholder-marker -->',
                renderedPageContent || '<!-- Page has no content to display -->'
            );
        } else {
            // No base relation, render only current page blocks
            const currentPageBlocks = pageData.dataBlocks || [];
            renderedHtmlContent = await renderDataBlocks(currentPageBlocks, false);
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

        // Lấy clinic info để có site name
        let clinicInfo = null;
        try {
            const Clinic = app.models.clinic;
            clinicInfo = await new Promise((resolve) => {
                Clinic.findOne({ where: { isActive: true } }, function (err, clinic) {
                    if (err) {
                        console.error('Error fetching clinic:', err);
                        return resolve(null);
                    }
                    resolve(clinic);
                });
            });
        } catch (error) {
            console.error('Error getting clinic info:', error);
        }

        // Sử dụng nunjucks để render template thay vì string replacement
        const templateContext = {
            site: clinicInfo,
            tpl: {
                subject: pageName_final
            },
            company: clinicInfo || [],
            pageName: pageName_final,
            pageName_final: pageName_final,
            renderedHtmlContent: renderedHtmlContent || '<!-- Page has no content to display -->',
            headScripts: headScripts,
            // Thêm các biến khác nếu cần
            pageData: pageData,
            currentYear: new Date().getFullYear(),
            clinic: clinicInfo
        };

        // Luôn áp dụng template: ưu tiên baseTemplateId của page, fallback template mặc định
        let templateHtml = '';
        const Template = app.models.Template;
        const baseTemplateId = pageData && pageData.canvasStyles && pageData.canvasStyles.baseTemplateId
            ? String(pageData.canvasStyles.baseTemplateId)
            : '';
        const defaultTemplateId = '674ae96ed1edb02c507a80af';

        async function fetchTemplateByIdPreferFallback(preferredId, fallbackId) {
            const idToTryFirst = preferredId || fallbackId;
            try {
                const tpl = await new Promise((resolve, reject) => {
                    Template.findOne({ where: { id: idToTryFirst } }, function (err, template) {
                        if (err) return reject(err);
                        resolve(template || null);
                    });
                });
                if (tpl && tpl.content) return tpl;
                if (!preferredId || preferredId === fallbackId) return tpl; // nothing else to try
            } catch (e) {
                console.error('Error fetching preferred template:', e);
            }
            // Fallback
            try {
                const tpl = await new Promise((resolve, reject) => {
                    Template.findOne({ where: { id: fallbackId } }, function (err, template) {
                        if (err) return reject(err);
                        resolve(template || null);
                    });
                });
                return tpl;
            } catch (e) {
                console.error('Error fetching fallback template:', e);
                return null;
            }
        }

        templateData = await fetchTemplateByIdPreferFallback(baseTemplateId, defaultTemplateId);

        if (!templateData || !templateData.content) {
            return res.status(500).send('Error fetching template data.');
        }

        // Xử lý template theo cách tương thích với Jinja2 syntax
        templateHtml = templateData.content;

        // Bước 1: Xử lý Jinja2 blocks trước ({% block body %})
        templateHtml = templateHtml.replace(
            /\{\% block body \%\}[\s\S]*?\{\% endblock \%\}/g,
            renderedHtmlContent || '<!-- Page has no content to display -->'
        );

        // Bước 2: Thay thế các placeholder cơ bản (chỉ những cái không phải template variables)
        // templateHtml = templateHtml
        // 	.replace(/<title>.*?<\/title>/i, `<title>${pageName_final}</title>`)
        // 	.replace(/tpl=\".*?\"/g, `tpl=\"${pageName}\"`);

        // Bước 3: Thử render với nunjucks cho các biến còn lại
        try {
            // Debug: Log template context
            // console.log('Template context:', JSON.stringify(templateContext, null, 2));

            // Chuyển đổi Jinja2 syntax thành Nunjucks syntax
            let nunjucksTemplate = templateHtml
                .replace(/\{\{([^}]+)\}\}/g, '{{ $1 }}')
                .replace(/\{\%([^%]+)\%\}/g, '{% $1 %}');

            // console.log('Nunjucks template preview:', nunjucksTemplate.substring(0, 500) + '...');

            templateHtml = env.renderString(nunjucksTemplate, templateContext);
            console.log('Nunjucks render successful');
        } catch (renderError) {
            console.error('Nunjucks render error:', renderError);
            console.error('Template context was:', JSON.stringify(templateContext, null, 2));
            // Fallback: chỉ xử lý string replacement
            templateHtml = templateHtml
                .replace(/\{\%[^%]*\%\}/g, '')
                .replace(/\{\{[^}]*\}\}/g, '');
        }

        if (req.param('html')) {
            res.set('Content-Type', 'text/html');
            res.send(templateHtml);
        } else {
            const pdf = require('html-pdf');
            pdf.create(templateHtml, report_options).toStream(function (err, stream) {
                if (err) {
                    console.error('PDF generation error:', err);
                    res.status(500).send('PDF generation failed');
                } else {
                    cb(stream, res);
                }
            });
        }

    } catch (err) {
        console.error(`💥 Error fetching or rendering page for slug '${pageName}':`, err);
        console.error('Error stack:', err.stack);

        // Xử lý lỗi 404 cho page not found
        if (err.message && err.message.includes('not found')) {
            return res.status(404).send(`Page with slug '${pageName}' not found.`);
        }

        res.status(500).send('Error loading page data or template.');
    }

};

// Copy các functions từ ats.js
async function renderDataBlocks(dataBlocks, isBaseContext = false) {
    if (!dataBlocks || !Array.isArray(dataBlocks)) return '';

    const renderedBlocks = await Promise.all(dataBlocks.map(async (block, index) => {
        if (isBaseContext && block.type === 'placeholder') {
            console.log('📍 Placeholder block detected');
            return '<!-- page-content-placeholder-marker -->';
        }

        return await renderBlock(block);
    }));

    return renderedBlocks.join('\n');
}

async function renderBlock(block) {
    if (!block || !block.type) return `<!-- Unknown block type: ${JSON.stringify(block)} -->`;

    // If block has content field, use it as template with block data
    if (block.content && block.type !== 'text' && block.type !== 'heading') {
        // Prepare template data - start with existing data or empty object
        let templateData = { ...(block.data || {}) };
        const blockData = { ...block };
        delete blockData.content; // Remove content field to avoid passing template as data

        // If block has features, fetch the feature data and add to templateData
        if (block.features) {
            try {
                for (const [featureName, feature] of Object.entries(block.features)) {
                    console.log('Fetching feature data', feature);
                    const featureData = await fetchFeatureData(feature);

                    // Add feature data directly to templateData
                    templateData[featureName] = featureData;
                    return renderTemplateContent(block.content, templateData, Object.keys(templateData));
                }
            } catch (error) {
                console.error('❌ Error fetching features:', error);
            }
        }

        // Use env.renderString instead of nunjucks.renderString to access custom filters
        const renderedContent = renderTemplateContent(block.content, blockData);

        return renderedContent;
    }

    // Handle block-template type specifically
    if (block.type === 'query' && block.data) {
        return await renderBlock(block.data);
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
    const combinedAttributes = `${idAttribute} ${classAttribute}`.trim();

    switch (block.type) {
        case 'text':
            const textContent = block.content || '';
            console.log('textContent', textContent);
            const textStyle = applyStyles(block.style || {});
            return `<div ${combinedAttributes} style="${textStyle}">${textContent}</div>`;

        case 'heading':
            // const textContent = block.text || block.content || '';
            // const tagName = block.type === 'heading' ? 'h1' : 'div';
            // return `<${tagName} ${combinedAttributes}>${textContent}</${tagName}>`;

            // const textContent = block.content || '';
            // const tagName = block.type === 'heading' ? (block.headingLevel || 'h2') : 'div';
            // return `<${tagName} ${combinedAttributes} ${styleAttribute}>${textContent}</${tagName}>`;


            const headingContent = block.content || '';
            const headingTag = block.headingLevel || 'h2';
            const headingStyle = applyStyles(block.style || {});
            return `<${headingTag} ${combinedAttributes} style="${headingStyle}">${headingContent}</${headingTag}>`;

        case 'image':
            // const imgSrc = block.src || '';
            // const imgAlt = block.alt || '';
            // const imgHref = block.href;

            // if (imgHref) {
            //     return `<a href="${imgHref}"><img src="${imgSrc}" alt="${imgAlt}" ${combinedAttributes} /></a>`;
            // } else {
            //     return `<img src="${imgSrc}" alt="${imgAlt}" ${combinedAttributes} />`;
            // }

            // const desktopSrc = block.src || '';
            // const mobileSrc = block.srcMobile || desktopSrc;
            // const imgAlt = block.alt || '';
            // const imgHref = block.href;
            // const target = block.target === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';

            // let desktopImgTag = `<img src="${desktopSrc}" alt="${imgAlt}" class="desktop-only" style="width:100%; height:auto;">`;
            // let mobileImgTag = `<img src="${mobileSrc}" alt="${imgAlt}" class="mobile-only" style="width:100%; height:auto;">`;

            // if (imgHref) {
            //     desktopImgTag = `<a href="${imgHref}" ${target}>${desktopImgTag}</a>`;
            //     mobileImgTag = `<a href="${imgHref}" ${target}>${mobileImgTag}</a>`;
            // }

            // let finalImageHtml = '';
            // const deviceType = block.deviceType || 'both';
            // if (deviceType === 'desktop') finalImageHtml = desktopImgTag;
            // else if (deviceType === 'mobile') finalImageHtml = mobileImgTag;
            // else finalImageHtml = desktopImgTag + mobileImgTag;

            // return `<div ${combinedAttributes}>${finalImageHtml}</div>`;

            const desktopSrc = block.src || '';
            const mobileSrc = block.srcMobile || desktopSrc;
            const imgAlt = block.alt || '';
            const imgHref = block.href;
            const target = block.target === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';
            // Style cho thẻ img để responsive, nhưng không ép height 100%
            const imgStyles = "width: 100%; height: auto; object-fit: cover; display: block;";

            let desktopImgTag = `<img src="${desktopSrc}" alt="${imgAlt}" class="desktop-only" style="${imgStyles}">`;
            let mobileImgTag = `<img src="${mobileSrc}" alt="${imgAlt}" class="mobile-only" style="${imgStyles}">`;

            if (imgHref) {
                desktopImgTag = `<a href="${imgHref}" ${target}>${desktopImgTag}</a>`;
                mobileImgTag = `<a href="${imgHref}" ${target}>${mobileImgTag}</a>`;
            }

            let finalImageHtml = '';
            const deviceType = block.deviceType || 'both';
            if (deviceType === 'desktop') finalImageHtml = desktopImgTag;
            else if (deviceType === 'mobile') finalImageHtml = mobileImgTag;
            else finalImageHtml = desktopImgTag + mobileImgTag;

            // Render thẻ div cha và áp dụng style của block
            return `<div ${combinedAttributes} ${styleAttribute}>${finalImageHtml}</div>`;


        case 'video':
            // const videoSrc = block.src || block.url || '';
            // const videoAlt = block.alt || '';
            // const videoControls = block.controls !== false ? 'controls' : '';
            // const videoAutoplay = block.autoplay ? 'autoplay' : '';
            // const videoLoop = block.loop ? 'loop' : '';
            // const videoMuted = block.muted ? 'muted' : '';
            // const videoPoster = block.poster ? `poster="${block.poster}"` : '';
            // const videoWidth = block.width ? `width="${block.width}"` : '';
            // const videoHeight = block.height ? `height="${block.height}"` : '';

            // const videoAttributes = [videoControls, videoAutoplay, videoLoop, videoMuted, videoPoster, videoWidth, videoHeight]
            //     .filter(attr => attr).join(' ');

            // return `<video ${combinedAttributes} ${videoAttributes}>
            //     <source src="${videoSrc}" type="video/mp4">
            //     ${videoAlt || 'Your browser does not support the video tag.'}
            // </video>`;

            const videoSrc = block.src || block.url || '';
            const videoControls = block.controls !== false ? 'controls' : '';
            const videoAutoplay = block.autoplay ? 'autoplay' : '';
            const videoLoop = block.loop ? 'loop' : '';
            const videoMuted = block.muted ? 'muted' : '';
            const videoAttributes = [videoControls, videoAutoplay, videoLoop, videoMuted, 'playsinline'].filter(Boolean).join(' ');
            const videoStyles = "width: 100%; height: auto; display: block;";

            return `<div ${combinedAttributes} ${styleAttribute}>
                        <video ${videoAttributes} style="${videoStyles}">
                            <source src="${videoSrc}" type="video/mp4">
                        </video>
                    </div>`;

        case 'button':
        case 'button-item':
            const buttonText = block.text || block.content || 'Button';
            const href = block.href || block.url || '#';
            return `<a href="${href}" ${combinedAttributes}>${buttonText}</a>`;

        case 'column':
            if (block.children && Array.isArray(block.children)) {
                const childrenHtml = await Promise.all(block.children.map(child => renderBlock(child)));
                const columnStyle = applyStyles(block.styles || {});
                const columnStyleAttr = columnStyle ? `style="${columnStyle}"` : '';
                return `<div ${columnStyleAttr}>${childrenHtml.join('')}</div>`;
            }
            return `<div ${combinedAttributes}><!-- Empty column --></div>`;

        case 'columns':
            if (block.columns && Array.isArray(block.columns)) {
                const columnsHtml = await Promise.all(block.columns.map(async column => {
                    const columnStyle = applyStyles(column.styles || column.style || {});
                    const childrenHtml = (column.children || []).map(child => renderBlock(child));
                    const resolvedChildrenHtml = await Promise.all(childrenHtml);

                    if (column.href) {
                        return `<a href="${column.href}" class="column" style="${columnStyle}">${resolvedChildrenHtml.join('')}</a>`;
                    } else {
                        return `<div class="column" style="${columnStyle}">${resolvedChildrenHtml.join('')}</div>`;
                    }
                }));

                // Desktop defaults similar to builder: row, gap, wrap
                const desktopFlexDirection = (block.style && block.style.flexDirection) || 'row';
                const desktopGap = (block.style && block.style.gap) || '10px';
                const desktopFlexWrap = (block.style && block.style.flexWrap) || 'nowrap';

                // Ensure display:flex and merge with provided styles
                const containerStyles = Object.assign(
                    { 'display': 'flex', 'flexDirection': desktopFlexDirection, 'gap': desktopGap, 'flexWrap': desktopFlexWrap },
                    block.style || {}
                );
                const containerStyleAttr = `style="${applyStyles(containerStyles)}"`;

                const containerHtml = `<div ${containerStyleAttr} ${combinedAttributes}>${columnsHtml.join('')}</div>`;

                // Inject responsive script to mimic builder's previewDevice behavior
                let responsiveScript = '';
                if (block.id) {
                    const mobileGap = desktopGap;
                    const hasCustomWidth = !!(block.style && block.style.width);
                    const originalWidth = hasCustomWidth ? String(block.style.width) : '';
                    responsiveScript = `
                    <script>
                    (function() {
                    var el = document.getElementById('${block.id}');
                    if (!el) return;
                    var dfd = '${desktopFlexDirection}';
                    var dgp = '${mobileGap}';
                    var dfw = '${desktopFlexWrap}';
                    var hasW = ${hasCustomWidth ? 'true' : 'false'};
                    var origW = ${hasCustomWidth ? `'${originalWidth.replace(/'/g, "\\'")}'` : "''"};
                    function applyMobile() {
                        el.style.display = 'flex';
                        el.style.flexDirection = 'column';
                        el.style.gap = dgp || '10px';
                        if (!hasW) {
                        el.style.width = '100%';
                        }
                    }
                    function applyDesktop() {
                        el.style.display = 'flex';
                        el.style.flexDirection = dfd || 'row';
                        el.style.gap = dgp || '10px';
                        el.style.flexWrap = dfw || 'nowrap';
                        if (!hasW) {
                        el.style.removeProperty('width');
                        } else {
                        el.style.width = origW;
                        }
                    }
                    function update() {
                        if (window.innerWidth <= 768) applyMobile(); else applyDesktop();
                    }
                    update();
                    window.addEventListener('resize', update);
                    })();
                    </script>`;
                }

                return containerHtml + responsiveScript;
            }
            return `<div ${combinedAttributes}><!-- Empty columns --></div>`;

        // case 'slide':
        //     if (block.children && Array.isArray(block.children)) {
        //         const slideStyle = applyStyles(block.styles || block.style || {});
        //         const slideStyleAttr = slideStyle ? `style="${slideStyle}"` : '';
        //         const childrenHtml = await Promise.all(block.children.map(child => renderBlock(child)));
        //         return `<div class="slide" ${slideStyleAttr}>${childrenHtml.join('')}</div>`;
        //     }
        //     return `<div class="slide" ${combinedAttributes}><!-- Empty slide --></div>`;

        // case 'slider':
        //     if (block.slides && Array.isArray(block.slides)) {
        //         const slidesHtml = await Promise.all(block.slides.map(slide => renderBlock(slide)));
        //         const showControls = block.config?.showControls !== false;
        //         const showDots = block.config?.showDots !== false;

        //         const sliderStyle = applyStyles(block.styles || {});
        //         const sliderStyleAttr = sliderStyle ? `style="${sliderStyle}"` : '';

        //         return `<div class="slider" ${sliderStyleAttr}>
        //             <div class="slides">${slidesHtml.join('')}</div>
        //             ${showControls ? '<div class="controls"><button class="prev">❮</button><button class="next">❯</button></div>' : ''}
        //             ${showDots ? '<div class="dots"></div>' : ''}
        //         </div>`;
        //     }
        //     return `<div ${combinedAttributes}><!-- Empty slider --></div>`;

        case 'slide':
            const children = block.children || [];
            const resolvedContentHtml = await Promise.all(children.map(child => renderBlock(child)));

            // Gộp các style của slide với style mặc định là flex-column
            const slideStyles = Object.assign({
                'display': 'flex',
                'flex-direction': 'column',
                'justify-content': 'flex-start', // Bắt đầu từ trên xuống
            }, block.styles || {});

            const slideStyleAttr = `style="${applyStyles(slideStyles)}"`;

            return `<div class="slide" ${idAttribute} ${slideStyleAttr}>
                    ${resolvedContentHtml.join('')}
                </div>`;

        // const slideChildrenHtml = block.children && Array.isArray(block.children)
        // ? (await Promise.all(block.children.map(child => renderBlock(child)))).join('')
        // : '';
        // const slideStyleAttr = applyStyles(block.styles || block.style || {});
        // return `<div class="slide" ${slideStyleAttr ? `style="${slideStyleAttr}"` : ''}>${slideChildrenHtml}</div>`;
        case 'slider':

            if (block.slides && Array.isArray(block.slides)) {
                const slidesHtml = await Promise.all(block.slides.map(slide => renderBlock(slide)));
                const sliderStyle = applyStyles(block.styles || {});

                // Cấu trúc HTML chuẩn cho slider, bao gồm các nút mà JS cần
                // JS sẽ tự tìm và chèn các dấu chấm (dots)
                const sliderHtml = `<div class="banner slider-container block-type-slider" ${idAttribute} style="${sliderStyle}">
                            <div class="slides">${slidesHtml.join('')}</div>
                            <button class="slide-previous">‹</button>
                            <button class="slide-next">›</button>
                        </div>`;

                // Thêm script auto slide nếu được cấu hình (loop về đầu khi tới cuối)
                let autoSlideScript = '';
                if (block.id) {
                    const interval = block.autoSlideInterval || 5000;
                    autoSlideScript = `
                    <script>
                    (function() {
                        var slider = document.getElementById('${block.id}');
                        if (!slider) return;
                        var nextButton = slider.querySelector('.slide-next');
                        var prevButton = slider.querySelector('.slide-previous');
                        var slidesWrapper = slider.querySelector('.slides');
                        var slides = slidesWrapper ? Array.prototype.slice.call(slidesWrapper.querySelectorAll('.slide')) : [];
                        if (!slides.length) return;

                        function isClickable(btn) {
                            if (!btn) return false;
                            var style = window.getComputedStyle(btn);
                            if (btn.disabled) return false;
                            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                            if (btn.offsetWidth === 0 && btn.offsetHeight === 0) return false;
                            return true;
                        }

                        function getActiveIndex() {
                            for (var i = 0; i < slides.length; i++) {
                                if (slides[i].classList.contains('active')) return i;
                            }
                            return -1;
                        }

                        function setActive(index) {
                            for (var i = 0; i < slides.length; i++) {
                                if (i === index) slides[i].classList.add('active'); else slides[i].classList.remove('active');
                            }
                            try {
                                if (slidesWrapper && slidesWrapper.scrollTo) slidesWrapper.scrollTo({ left: 0, behavior: 'auto' });
                                if (slidesWrapper) slidesWrapper.style.transform = 'translateX(0)';
                            } catch (_) {}
                            if (prevButton) prevButton.style.removeProperty('display');
                            if (nextButton) nextButton.style.removeProperty('display');
                        }

                        setInterval(function() {
                            if (isClickable(nextButton)) {
                                nextButton.click();
                                return;
                            }
                            var current = getActiveIndex();
                            var next = (current >= 0 ? (current + 1) % slides.length : 0);
                            setActive(next);
                        }, ${interval});
                    })();
                    </script>`;
                }

                return sliderHtml + autoSlideScript;
            }
            return `<div id="${idAttribute}" class="block-type-slider"><!-- Empty slider --></div>`;
        // if (block.slides && Array.isArray(block.slides)) {
        //     const slidesHtml = await Promise.all(block.slides.map(slide => renderBlock(slide)));
        //     const sliderStyle = applyStyles(block.styles || {});
        //     // JS sẽ tự tạo dots và controls, chúng ta chỉ cần cung cấp cấu trúc cơ bản.
        //     return `<div class="slider" ${sliderStyle ? `style="${sliderStyle}"` : ''}>
        //                 <div class="slides">${slidesHtml.join('')}</div>
        //             </div>`;
        // }
        // return `<div ${combinedAttributes}><!-- Empty slider --></div>`;
        case 'tabs':
            if (block.tabs && Array.isArray(block.tabs)) {
                const tabTitles = block.tabs.map((tab, index) =>
                    `<li class="tab-label ${index === 0 ? 'active' : ''}" data-tab="${tab.id}">${tab.title || `Tab ${index + 1}`}</li>`
                ).join('');

                const tabContents = (await Promise.all(block.tabs.map(async (tab, index) => {
                    const childrenHtml = (tab.children && Array.isArray(tab.children)) ? (await Promise.all(tab.children.map(child => renderBlock(child)))).join('') : '';
                    return `<div class="tab-content ${index === 0 ? 'active' : ''}" id="${tab.id}">${childrenHtml}</div>`;
                }))).join('');

                return `<div class="tab-container" ${combinedAttributes}>
                            <ul class="tab-labels">${tabTitles}</ul>
                            <div class="tab-contents">${tabContents}</div>
                        </div>`;
            }
            return `<div ${combinedAttributes}><!-- Empty tabs --></div>`;
        case 'buttons':
            if (block.buttons && Array.isArray(block.buttons)) {
                const buttonsHtml = await Promise.all(block.buttons.map(button => renderBlock(button)));
                return `<div ${combinedAttributes}>${buttonsHtml.join('')}</div>`;
            }
            return `<div ${combinedAttributes}><!-- Empty buttons --></div>`;
        case 'button-group':
            // Render a group of buttons (similar to 'buttons' but with specific class)
            if (block.buttons && Array.isArray(block.buttons)) {
                const groupButtonsHtml = await Promise.all(block.buttons.map(button => renderBlock(button)));
                const groupStyle = applyStyles(block.styles || block.style || {});
                const groupStyleAttr = groupStyle ? `style="${groupStyle}"` : '';
                return `<div class="button-group" ${groupStyleAttr} ${idAttribute}>${groupButtonsHtml.join('')}</div>`;
            }
            return `<div class="button-group" ${idAttribute}><!-- Empty button-group --></div>`;
        case 'button-support':
            // Support a single button or an array of buttons for support actions
            if (Array.isArray(block.buttons) && block.buttons.length) {
                const supportButtonsHtml = await Promise.all(block.buttons.map(button => renderBlock(button)));
                const supportStyle = applyStyles(block.styles || block.style || {});
                const supportStyleAttr = supportStyle ? `style="${supportStyle}"` : '';
                return `<div class="button-support" ${supportStyleAttr} ${idAttribute}>${supportButtonsHtml.join('')}</div>`;
            }
            {
                const text = block.text || block.content || block.label || 'Button';
                const phone = block.phone;
                const href = phone ? `tel:${phone}` : (block.href || block.url || '#');
                const target = block.target === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';
                const btnStyle = applyStyles(block.styles || block.style || {});
                const btnStyleAttr = btnStyle ? `style="${btnStyle}"` : '';
                return `<a href="${href}" class="button-support-item" ${target} ${btnStyleAttr} ${idAttribute}>${text}</a>`;
            }

        case 'custom':
            if (block.content) {
                return `<div ${combinedAttributes}>${block.content}</div>`;
            }
            if (block.customHtml) {
                return `<div ${combinedAttributes}>${block.customHtml}</div>`;
            }
            return `<div ${combinedAttributes}><!-- Custom block: ${block.name || 'Unnamed'} --></div>`;
        case 'menu':
            // if (block.content) {
            //     return `<div ${combinedAttributes}>${block.content}</div>`;
            // }

            // async function renderMenuItems(items) {
            //     if (!items || !items.length) return '';
            //     let html = '<ul>';
            //     for (const item of items) {
            //         const childrenHtml = await renderMenuItems(item.items || item.children);
            //         const target = item.target === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';
            //         html += `<li><a href="${item.actionValue || '#'}">${item.text}</a>${childrenHtml}</li>`;
            //     }
            //     html += '</ul>';
            //     return html;
            // }
            // const menuItemsHtml = await renderMenuItems(block.items || []);
            // return `<nav ${combinedAttributes}><button class="menu-toggle">Menu</button><div class="menu-items-container">${menuItemsHtml}</div></nav>`;

            async function renderMenuItems(items, isSubmenu = false) {
                if (!items || !items.length) return '';
                let html = `<ul class="${isSubmenu ? 'submenu' : ''}">`;
                for (const item of items) {
                    const childrenHtml = await renderMenuItems(item.items || item.children, true);
                    const target = item.target === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';
                    html += `<li class="menu-item">
                                <a href="${item.actionValue || '#'}">${item.text}</a>
                                ${childrenHtml}
                             </li>`;
                }
                html += '</ul>';
                return html;
            }
            const menuItemsHtml = await renderMenuItems(block.items || []);
            // Theo JS, menu chính được bao bọc trong một div có class 'menu' và có một nút bấm riêng.
            return `<div class="menu-wrapper">
                        <button class="open-menu-btn">☰</button>
                        <div class="menu" ${combinedAttributes}>${menuItemsHtml}</div>
                    </div>`;

        case 'form':
            const fieldsHtml = (block.fields || []).map(field => {
                const required = field.required ? 'required' : '';
                const label = field.label ? `<label for="field-${field.id}">${field.label} ${required ? '*' : ''}</label>` : '';

                switch (field.type) {
                    case 'textarea':
                        return `<div>${label}<textarea id="field-${field.id}" name="${field.name}" placeholder="${field.placeholder || ''}" ${required}></textarea></div>`;
                    case 'select':
                        const options = (field.options || []).map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
                        return `<div>${label}<select id="field-${field.id}" name="${field.name}" ${required}>${options}</select></div>`;
                    case 'submit':
                        return `<div><button type="submit">${field.value || 'Submit'}</button></div>`;
                    default: // text, email, password, etc.
                        return `<div>${label}<input type="${field.type}" id="field-${field.id}" name="${field.name}" placeholder="${field.placeholder || ''}" ${required}></div>`;
                }
            }).join('');
            return `<form action="${block.action || '#'}" method="${block.method || 'POST'}" ${combinedAttributes}>${fieldsHtml}</form>`;
        case 'table':
            try {
                const modelName = block.modelName;
                if (!modelName) return '<!-- Table block is missing a model name -->';
                const Model = app.models[modelName];
                if (!Model) return `<!-- Model not found: ${modelName} -->`;

                const tableData = await new Promise((resolve, reject) => {
                    Model.find({}, (err, results) => {
                        if (err) return reject(err);
                        resolve(results || []);
                    });
                });

                const columns = block.tableColumns || [];
                const headers = columns.map(col => `<th>${col.title || col.fieldName}</th>`).join('');
                const rows = tableData.map(row => {
                    const cells = columns.map(col => `<td>${row[col.fieldName] || ''}</td>`).join('');
                    return `<tr>${cells}</tr>`;
                }).join('');

                return `<div ${combinedAttributes}><table class="rendered-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;


            } catch (error) {
                console.error('Error rendering table block:', error);
                return `<!-- Error rendering table: ${error.message} -->`;
            }


        case 'accordion':
            if (block.items && Array.isArray(block.items)) {
                const accordionItemsHtml = await Promise.all(block.items.map(async (item, index) => {
                    const childrenHtml = (item.children && Array.isArray(item.children))
                        ? (await Promise.all(item.children.map(child => renderBlock(child)))).join('')
                        : '';

                    const itemStyle = applyStyles(item.style || {});
                    const itemStyleAttr = itemStyle ? `style="${itemStyle}"` : '';
                    const isFirst = index === 0;
                    const collapseId = `collapseOne-${index + 1}`;

                    return `<div class="accordion-item" ${itemStyleAttr}>
                                    <h4 class="accordion-header">
                                        <button class="accordion-button" type="button" data-bs-toggle="collapse"
                                            data-bs-target="#${collapseId}" aria-expanded="${isFirst ? 'true' : 'false'}"
                                            aria-controls="panelsStayOpen-${collapseId}">
                                            ${item.title || `Item ${index + 1}`}
                                        </button>
                                    </h4>
                                    <div id="${collapseId}" class="accordion-collapse collapse ${isFirst ? 'show' : ''}">
                                        <div class="accordion-body">
                                            ${childrenHtml}
                                        </div>
                                    </div>
                                </div>`;
                }));

                const accordionStyle = applyStyles(block.style || {});
                const accordionStyleAttr = accordionStyle ? `style="${accordionStyle}"` : '';

                return `<div class="cau-hoi-thuong-gap" style="width: 100%; max-width: 1200px; align-self: center;">
                            <div class="accordion data-item" ${combinedAttributes} ${accordionStyleAttr}>
                                ${accordionItemsHtml.join('')}
                            </div>
                        </div>`;
            }

            return `<div class="cau-hoi-thuong-gap" style="width: 100%; max-width: 1200px; align-self: center;">
                            <div ${combinedAttributes}><!-- Empty accordion --></div>
                        </div>`;

        case 'accordion-item':
            const itemChildrenHtml = (block.children && Array.isArray(block.children))
                ? (await Promise.all(item.children.map(child => renderBlock(child)))).join('')
                : '';

            const itemStyle = applyStyles(block.style || {});
            const itemStyleAttr = itemStyle ? `style="${itemStyle}"` : '';
            const collapseId = `collapseOne-${block.id || 'item'}`;

            return `<div class="accordion-item" ${itemStyleAttr}>
                        <h4 class="accordion-header">
                            <button class="accordion-button" type="button" data-bs-toggle="collapse"
                                data-bs-target="#${collapseId}" aria-expanded="false"
                                aria-controls="panelsStayOpen-${collapseId}">
                                ${block.title || 'Accordion Item'}
                            </button>
                        </h4>
                        <div id="${collapseId}" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                ${itemChildrenHtml}
                            </div>
                        </div>
                    </div>`;
        default:
            return `<div ${combinedAttributes}><!-- Unsupported block type: ${block.type} --></div>`;
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

function renderTemplateContent(template, data, featureName = null) {
    if (!template) return '';
    console.log('Rendering template', featureName);
    try {
        if (featureName) {
            if (template.id === "68538d7a9bb7e488c4100415") {
                console.log('Rendering template for feature: ', featureName, 'data: ', data);
            }
            return env.renderString(template, data);
        }
        if (data.type && data.type === 'menu') {
            // console.log(`Rendering template for feature: data: ${JSON.stringify(data)}, template length: ${template}`);
        }
        return env.renderString(template, { data: data });
    } catch (error) {
        console.error('Nunjucks render error:', error);
        return `<!-- Template render error: ${error.message} -->`;
    }
}

async function fetchFeatureData(feature) {
    if (!feature || !feature.model) {
        console.log('No feature or model', feature);
        return [];
    }

    try {
        const Model = app.models[feature.model];
        if (!Model) {
            console.log('Model not found for feature.model:', feature.model);
            return [];
        }

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

        const data = await new Promise((resolve) => {
            Model.find(lbFilter, function (err, results) {
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

module.exports.generateFromTemplate = async function (templateName,
    filter, modelName, res, req,
    cb, keyPath) {

    if (await checkAndHandleRedirect(req, res)) return;

    var urlPrefix = req.protocol + '://' + req.get('host');

    // Log the query parameters
    console.log('Query Parameters:', req.query.page);
    var brigde = {
        cmap: {
            "trang-suc-kim-cuong": "Trang Sức Kim Cương",
            "trang-suc-kim-cuong-da-mau": "Trang Sức Đá Màu",
            "trang-suc-ngoc-trai": "Trang Sức Ngọc Trai",
            "trang-suc-cuoi": "Trang Sức Cưới",
            "trang-suc-da-mau": "Trang Sức Đá Màu",
            "trang-suc-da-mau-nam": "Trang Sức Đá Màu Nam",
            "trang-suc-da-mau-nu": "Trang Sức Đá Màu Nữ",
            "trang-suc-tron": "Trang Sức Trơn",
            "trang-suc-kim-cuong-nu": "Trang Sức Kim Cương Nữ",
            "trang-suc-kim-cuong-nam": "Trang Sức Kim Cương Nam",
            "trang-suc-da-mau-kim-cuong-nu": "Trang Sức Đá Màu Kim Cương Nữ",
            "trang-suc-kim-cuong-da-mau-nam": "Trang Sức Đá Màu Kim Cương Nam",
            "trang-suc-nu": "Trang Sức Nữ",
            "trang-suc-nam": "Trang Sức Nam",
            "nhan": "NHẪN",
            "mat-day-chuyen": "MẶT",
            "day-chuyen": "DÂY CHUYỀN",
            "bong-tai": "BÔNG TAI",
            "vong": "VÒNG",
            "lac": "LẮC",
            "chuoi-ngoc-trai": "Chuỗi Ngọc Trai"
        }
    };

    console.log('urlPrefix ', urlPrefix, req.accessToken);

    var Template = app.models.Template;
    Template.find({
        where: {
            name: templateName
        },
        include: ["base",
            {
                relation: 'blocks', // Include the TemplateBlock model
                scope: {
                    include: 'block' // Include the Block model within TemplateBlock
                }
            }]
    }, function (err, tpls) {

        if (res.headersSent) return;
        var tpl = tpls[0];

        const mm = {
            "courses": "Course",
            "locations": "Location",
            "schools": "School",
            "scholarships": "ScholarshipNews",
            "news": "News",
            "events": "Event",
            "event-news": "Event",
            "pages": "Page",
            "clinic": "clinic",
            "about": "clinic"
        };

        var modelNameStr = modelName.toString();
        var model = app.models[mm[modelNameStr] || modelNameStr];



        if (!tpl) {
            Template.findOne({ where: { name: 'not-found' } }, function (err, _tpl) {
                if (err) {
                    console.error('Error fetching not-found template:', err);
                    return res.status(404).send('Error');
                }
                
                // Check if _tpl exists and has content
                if (_tpl && _tpl.content) {
                    return res.status(404).send(_tpl.content);
                }
                
                // Fallback if template not found or has no content
                res.status(404).send('Error');
            });

            return;
        }

        if (!model && tpl && tpl.model) {
            model = app.models[tpl.model];
        }
        if (!model) {
            // Return 404 when the desired model cannot be resolved,
            // but allow fallback to clinic when templateName matches modelName or its mapped alias.
            // var safeTemplateName = (templateName || '').toString().toLowerCase();
            // var safeModelName = (modelNameStr || '').toString().toLowerCase();
            // var mappedModel = mm[modelNameStr];
            // var safeMappedModel = (mappedModel || '').toString().toLowerCase();

            // console.log('safeTemplateName ', safeTemplateName, safeModelName, safeMappedModel);

            // if (safeTemplateName && (safeTemplateName === safeModelName || (mappedModel && safeTemplateName === safeMappedModel))) {
            //     model = app.models.clinic;
            // } else {
            //     Template.findOne({ where: { name: 'not-found' } }, function (err, notFoundTpl) {
            //         res.status(404).send(notFoundTpl.content);
            //     });
            //     return;
            // }

            var modelCheck = app.models.clinic;

            if (modelCheck.currentDatasource === 'ats') {


                var safeTemplateName = (templateName || '').toString().toLowerCase();
                var safeModelName = (modelNameStr || '').toString().toLowerCase();
                var mappedModel = mm[modelNameStr];
                var safeMappedModel = (mappedModel || '').toString().toLowerCase();

                // Bỏ '-detail' ở cuối nếu có
                if (safeTemplateName && safeTemplateName.endsWith('-detail')) {
                    safeTemplateName = safeTemplateName.replace(/-detail$/, '');
                }

                //   console.log('safeTemplateName ', safeTemplateName, safeModelName, safeMappedModel);

                var matchDirect =
                    (safeTemplateName && safeModelName && (
                        safeTemplateName.indexOf(safeModelName) > -1 ||
                        safeModelName.indexOf(safeTemplateName) > -1
                    ));

                var matchMapped =
                    (mappedModel && safeMappedModel && (
                        safeTemplateName.indexOf(safeMappedModel) > -1 ||
                        safeMappedModel.indexOf(safeTemplateName) > -1
                    ));

                if (safeTemplateName && (matchDirect || matchMapped)) {
                    model = modelCheck;
                } else {
                    Template.findOne({ where: { name: 'not-found' } }, function (err, notFoundTpl) {
                        res.status(404).send(notFoundTpl.content);
                    });
                    return;
                }
            }
            else {
                model = app.models.clinic;
            }

        }




        var path = require('path');
        var exec = require('child_process').execSync;

        if (!filter.limit) filter.limit = 21;

        if (!filter.order) filter.order = 'id DESC';



        if (tpl.filter)
            filter = Object.assign(filter, tpl.filter);

        var itemPerPage = filter.limit;
        filter.offset = ((req.query.page || 1) - 1) * itemPerPage;

        var _c = JSON.parse(JSON.stringify(req.query));

        if (_c && _c.edit) delete _c.edit;


        if (_c.filter) {
            if (typeof _c.filter == 'string') {
                try {
                    _c.filter = JSON.parse(_c.filter);
                } catch (error) {
                    console.log('error ', error);
                    // _c.filter = {};
                }
            }


            ['where', 'include', 'order', 'limit', 'offset', 'skip', 'fields'].forEach(e => {
                if (_c.filter[e]) {
                    if (!filter[e])
                        filter[e] = _c.filter[e];
                    else
                        Object.assign(filter[e], _c.filter[e]);
                }
            });

            // Object.assign(filter.include, _c.filter.include);
            // Object.assign(filter.order, _c.filter.order);
            // Object.assign(filter.limit, _c.filter.limit);
            // Object.assign(filter.offset, _c.filter.offset);
            // Object.assign(filter.skip, _c.filter.skip);
        }

        console.log('c ', _c, _c.where);

        ['html', 'template', 'modelName', 'filter', 'page'].forEach(e => {
            delete _c[e];
        });

        if (!filter.where)
            filter.where = {};

        Object.keys(_c).forEach(e => {
            if (_c[e] && e !== 'lang')
                filter.where[e] = _c[e];
        })



        if (filter.where && filter.where.item) {
            delete filter.where.item;
        }

        // _.forEach
        console.log('req.query', req.query, JSON.stringify(filter), mm[modelNameStr]);

        model.find(filter, function (err, result) {
            //Thêm kiểm tra kết quả trước khi xử lý
            if (err) {
                console.log('Database error:', err);
                return res.status(500).send('Internal Server Error');
            }
            if (!result && (req.query.modelName !== 'schools' || req.query.modelName !== 'scholarships')) {
                // console.log('not found', req.query.modelName, result.length);
                Template.findOne({ where: { name: 'not-found' } }, function (err, notFoundTpl) {
                    res.status(404).send(notFoundTpl.content);
                });
                return;
            }
            if ((req.query.modelName === 'news' || req.query.modelName === 'events' || req.query.modelName === 'tin-tuc' || req.query.modelName === 'scholarships' || req.query.modelName === 'schools'
                || req.query.modelName === 'locations') && (result.length <= 1)) {
                // Tìm template 404
                console.log('check');
                if (result.length == 1) {
                    // console.log('result ', result);
                    const item = result[0];
                    let shouldShow404 = false;


                    // Kiểm tra review parameter - nếu có ?review=true thì bỏ qua kiểm tra 404
                    const isReviewMode = req.query.modelName === 'events' || app.models.clinic.currentDatasource !== 'ats';

                    if (!isReviewMode) {
                        // Kiểm tra isPublished nếu có
                        if (item.hasOwnProperty('isPublished') && item.isPublished === false) {
                            console.log('isPublished ', item.isPublished);
                            shouldShow404 = true;
                        }

                        // Kiểm tra status nếu có
                        if (item.hasOwnProperty('status') && item.status === 'draft') {
                            console.log('status ', item.status);
                            shouldShow404 = true;
                        }
                    } else {
                        console.log('Review mode enabled - skipping 404 checks');
                    }
                    // console.log('shouldShow404 ', shouldShow404);
                    if (shouldShow404) {
                        console.log('not found', req.query.modelName, result.length);
                        Template.findOne({ where: { name: 'not-found' } }, function (err, notFoundTpl) {
                            res.status(404).send(notFoundTpl.content);
                        });
                        return;
                    }
                }
                else if (req.query.template === 'scholarships-detail' || req.query.template === 'schools-detail' || req.query.template === 'news-detail' || req.query.template === 'events-detail' || req.query.template === 'tin-tuc-detail' || req.query.template === 'locations-detail') {
                    console.log('not found', req.query.modelName, result.length);
                    Template.findOne({ where: { name: 'not-found' } }, function (err, notFoundTpl) {
                        res.status(404).send(notFoundTpl.content);
                    });
                    return;
                }
            }

            // fix me single of view ...

            var r = JSON.parse(JSON.stringify(result));
            var base = tpl.base();
            var models = {};
            var q = {
                'company': {
                    model: 'clinic',
                    filter: {
                        where: {
                            domain: req.get('host')
                        }
                    }
                }
            };

            if (base && tpl.content.indexOf('{% block body %}') == -1) {
                tpl.content = (tpl.css || '') + (tpl.schemaLD || '') + '{% block body %}' + (tpl.header || '')
                    + tpl.content + '<!-- blocks --> {% endblock %}';
            } else {
            }

            // append .dataBlocks into tpl.blocks
            function compileHeroBannerBlock(block) {

                if (block.data && block.data.slides && block.data.slides.length) {
                    var nunjuckTemplate = `
                        <section class="hero-banner {{block.style.renderMode}} {{block.classes}}" > 
                            {% for slide in block.data.slides %}
                            <div class="container {{slide.classes}} " {% if slide.backgroundImage.src %} style="background-image: url('{{ slide.backgroundImage.src }}');" {% endif %}>
                                {% if slide.title.content or slide.subtitle.content %}
                                <div class="hero-content">
                                    <div class="hero-text">
                                        {% if slide.title.content %}
                                            {% if block.first %}
                                            <h1>{{ slide.title.content }}</h1>
                                            {% else %}
                                            <h2>{{ slide.title.content }}</h2>
                                            {% endif %}
                                            
                                        {% endif %}

                                        {% if slide.subtitle.content %}<p>{{ slide.subtitle.content }}</p>{% endif %}
                                        {% for button in slide.buttons %}
                                            <a href="{{ button.link }}" class="btn">{{ button.content }}</a>
                                        {% endfor %}
                                    </div>
                                </div>
                                {% endif %}

                                {% if slide.heroImage.src %}
                                <div class="hero-image">
                                    <img src="{{ slide.heroImage.src }}" alt="">
                                </div>
                                {% endif %} 
                            </div>
                            {% endfor %} 
                        </section>`;
                    return nunjucks.renderString(nunjuckTemplate, { block: block });
                } else {
                    return '';
                }

                return block.data && block.data.slides && block.data.slides.map(e => {
                    var nunjuckTemplate = `
                        <section class="hero-banner" 
                        {% if e.backgroundImage.src %} style="background-image: url('{{ e.backgroundImage.src }}');" {% endif %}>
                            <div class="container {{e.classes}} ">
                                <div class="hero-content">
                                    <div class="hero-text">
                                        {% if e.title.content %}<h2>{{ e.title.content }}</h2>{% endif %}
                                        {% if e.subtitle.content %}<p>{{ e.subtitle.content }}</p>{% endif %}
                                        {% for button in e.buttons %}
                                            <a href="{{ button.link }}" class="btn">{{ button.content }}</a>
                                        {% endfor %}
                                    </div>
                                </div>
                                {% if e.heroImage.src %}
                                <div class="hero-image">
                                    <img src="{{ e.heroImage.src }}" alt="">
                                </div>
                                {% endif %}
                            </div>
                        </section>`
                    return nunjucks.renderString(nunjuckTemplate, { e: e });

                });
            }
            if (tpl.dataBlocks) {
                tpl.dataBlocks.length && (tpl.dataBlocks[0].first = true);
                var _d = {};
                if (tpl.refBlocks && tpl.refBlocks.length) {
                    // fix me: error SyntaxError: Unexpected token u in JSON at position 0
                    try {
                        const _blocks = JSON.parse(JSON.stringify(tpl.refBlocks));
                        _blocks.forEach(e => {
                            _d[e.id] = e;
                        });
                    } catch (error) {
                        console.log('error ', error);
                    }

                }

                tpl.dataBlocks.forEach(e => {
                    if (_d[e.id])
                        e.content = _d[e.id].content;
                });

                var blockCompiled = tpl.dataBlocks.map(e => {
                    switch (e.type) {
                        case 'simple':
                        case 'common':
                            return nunjucks.renderString(e.content, { block: e });
                        case 'hero-banner':
                            return compileHeroBannerBlock(e);
                        case 'generic':
                            return nunjucks.renderString(e.content, { block: e });
                    }
                });

                if (base)
                    base.content = base.content.replace('<!-- blocks -->', '<!-- blocks -->' + blockCompiled.join(''));


                tpl.content = tpl.content.replace('<!-- blocks -->', '<!-- blocks -->' + blockCompiled.join(''));
            }


            if (r && r.length == 1) {
                const t = r[0];
                // console.log('Debug datablock', t.dataBlocks);
                if (t.dataBlocks) {
                    // console.log('r.dataBlocks ', t.dataBlocks.length);
                    t.dataBlocks.length && (t.dataBlocks[0].first = true);

                    var _d = {};
                    t.refBlocks && t.refBlocks.forEach(e => {
                        _d[e.id] = e;
                    });

                    t.dataBlocks.forEach(e => {
                        if (_d[e.id])
                            e.content = _d[e.id].content;
                    });

                    var blockCompiled = t.dataBlocks.map(e => {
                        switch (e.type) {
                            case 'simple':
                            case 'common':
                            
                                return nunjucks.renderString(e.content, { block: e });
                            case 'generic':
                                return nunjucks.renderString(e.content, { block: e });
                            case 'hero-banner':
                                return compileHeroBannerBlock(e);
                        }
                    });

                    if (base)
                        base.content = base.content.replace('<!-- blocks -->', '<!-- blocks -->' + blockCompiled.join(''));


                    tpl.content = tpl.content.replace('<!-- blocks -->', '<!-- blocks -->' + blockCompiled.join(''));
                }
            } else {

                console.log('r.dataBlocks not found');
                //  Template.findOne({ where: { name: 'not-found' } }, function (err, _tpl) {
                //     res.status(404).send(_tpl.content);
                // });

                // return;
            }



            if (tpl.blocks) {
                var t = JSON.parse(JSON.stringify(tpl));

                try {
                    var blocks = (t.templateBlocks || []);
                    blocks = _.sortBy(blocks, 'order', 'desc');
                    var blocks = blocks.map(e => {
                        return e.block.content.replace('<section ', `<section block-id="${e.block.id}" `);
                    }).join('');

                    if (base)
                        base.content = base.content.replace('<!-- blocks -->', blocks);


                    tpl.content = tpl.content.replace('<!-- blocks -->', blocks);

                    t.blocks && t.blocks.forEach((b) => {
                        if (b.model) {
                            try {

                                // var model = JSON.parse(b.model);
                                eval((base.script || '') + ';' + (tpl.script || '') + ';var model = ' + b.model);
                                for (k in model) {
                                    console.log('okk  ', k);
                                    q[k] = model[k];
                                }

                            } catch (error) {
                                console.log(error);
                            }
                        }
                    })

                } catch (error) {
                    console.log('??? ', error);
                }

            }


            var compiledBase = base && base.content ? nunjucks.compile(base.content, env) : undefined;


            // Tạo canonical URL
            const canonicalUrl = generateSmartCanonicalUrl(req, { templateName, result: r, modelName: req.query.modelName || (mm[modelNameStr] ? modelNameStr : undefined) });

            // Tạo meta robots thông minh (tạm thời, sẽ cập nhật lại sau khi biết totalPages)
            let metaRobots = generateSmartMetaRobots(req, { templateName, result: r, currentPage: Number(req.query.page || 1) || 1 });

            // Debug: Log ra canonical URL để kiểm tra
            // console.log('🔍 Canonical URL Debug:');
            // console.log('   API Path:', req.path);
            // console.log('   Template Name:', templateName);
            // console.log('   Data Slug:', r[0] ? r[0].slug : 'undefined');
            // console.log('   Data ID:', r[0] ? r[0].id : 'undefined');
            // console.log('   Query Template:', req.query.template);
            // console.log('   Query Filter:', req.query.filter);
            // console.log('   Generated Canonical:', canonicalUrl);
            // console.log('---');
            // console.log('data check',r.length);

            // Lấy subdomain và language cho i18n
            const subdomain = req.hostname.split('.')[0];
            let currentLang = 'vi';
            if (req.param('lang')) {
                currentLang = req.param('lang');
            } else if (req.query.lang) {
                currentLang = req.query.lang;
            }
            // } else if (req.cookies && req.cookies.lang) {
            //     currentLang = req.cookies.lang;
            // }
            const allTranslations = i18n.loadTranslations(subdomain, currentLang);
            console.log(`[i18n] Debug - req.param('lang'): ${req.param('lang')}, req.query.lang: ${req.query.lang}, req.cookies?.lang: ${req.cookies?.lang}`);
            console.log(`[i18n] Rendering: tenant=${subdomain}, lang=${currentLang}`);

            var doc = {
                brigde: brigde,
                itemPerPage: itemPerPage,
                currentPage: req.query.page || 1,
                modelName: mm[modelNameStr] || modelNameStr,
                ex: {}, console: console, urlPrefix: urlPrefix, app: app,
                rs: r,
                tpl: tpl,
                req: req,
                baseTemplate: tpl.base(),
                compiledBase: compiledBase,
                html: req.param('html') == 'true',
                sleep: {}, result: r, results: r, setTimeout: setTimeout, moment: moment, path: path, exec: exec, fs: require('fs'), "_": _,
                canonicalUrl: canonicalUrl,
                metaRobots: metaRobots,
                category: req.query.category || req.param('category') || filter.where.category,

                // i18n properties
                tenant: subdomain,
                subdomain: subdomain,
                currentLang: currentLang,
                lang: currentLang,
                translations: allTranslations,
                t: function (key, params) {
                    return i18n.translate(key, this.tenant, this.currentLang, params);
                },
            };
            if (r[0] && r.length == 1) doc['r'] = r[0];
            else if (r[0] && r.length > 1) doc['r'] = r;

            // console.log('r ', r);
            var rootOrder = r[0];

            var reportOnlyOrderItemId = req.param('orderItemId');
            if (reportOnlyOrderItemId) {
                _.forEach(r, (o) => {
                    o.orderItems = _.filter(o.orderItems, (oi) => { return oi.id == reportOnlyOrderItemId; });
                });
            }


            const noQ = Object.keys(q).length;
            console.log('noQ ', noQ);
            var count = 0;


            function createPages(totalPages, currentPage, doc) {
                const startPage = Math.max(1, currentPage - 2);
                const endPage = Math.min(totalPages, currentPage + 2);

                // Ensure we always show 5 pages
                doc.pages = Array.from({ length: Math.min(5, endPage - startPage + 1) }, (_, i) => startPage + i);
            }

            if (filter.where && filter.where.limit && filter.where.limit <= result.length) {
                doc['resultCount'] = result.length;
                doc.totalPages = 1;
                createPages(1, 1, doc);
            }


            Object.keys(q).forEach((v) => {
                replaceDatePlaceholders(q[v].filter, r);


                count++;
                app.models[q[v].model].find(q[v].filter, function (err, result) {
                    count--;
                    doc[v] = JSON.parse(JSON.stringify(result));
                    // console.log('doc[v] ', doc[v]);

                    console.log('result app.models[q[v].model].find ', result.length, count);

                    function done() {
                        if (count == 0) {
                            console.log('Finished All query ');

                            if (base && base.script) {
                                tpl.script = base.script + ';' + (tpl.script || '');
                            }

                            if (tpl.script) {
                                var context = new vm.createContext(doc);
                                var script = new vm.Script(tpl.script);
                                script.runInContext(context);
                            }


                            if (tpl.content.indexOf('<section template-id=""') != -1) {
                                tpl.content = tpl.content.replace('<section ', `<section template-id="${tpl.id}" `);
                            }

                            var content = compiledBase ? "{% extends compiledBase %} " + tpl.content : tpl.content;

                            env.addFilter('extractImgSrc', function (content) {
                                const imgSrcs = [];
                                const regex = /<img[^>]+src="([^">]+)"/g;
                                let match;
                                while ((match = regex.exec(content)) !== null) {
                                    imgSrcs.push(match[1]);
                                }
                                return imgSrcs;
                            });


                            function finalRender() {

                                try {
                                    if (doc.company && doc.company.length) {
                                        doc.site = doc.company[0];
                                    }


                                    env.renderString(content, doc, function (err, result) {
                                        if (err) {
                                            console.log('Error !!!!!!!!!!!!!!!!!!: ', err);
                                            console.log('result', result);
                                            // console.log(content);
                                        }

                                        // Auto-translate HTML nếu không phải tiếng Việt
                                        if (doc.currentLang && doc.currentLang !== 'vi') {
                                            result = i18n.autoTranslateHTML(result, doc.subdomain, doc.currentLang);
                                        }

                                        if (tpl.contentType == 'plaintext') {
                                            res.setHeader('Content-Type', 'text/plain');
                                        } if (tpl.contentType == 'xml') {
                                            res.setHeader('Content-Type', 'application/xml');
                                        }


                                        if (req.param('html')) {
                                            if (res.headersSent) return;
                                            res.send(result);
                                            if (tpl.enableCache && keyPath) {
                                                redisClient.set(keyPath, result, 'EX', 60 * 60 * 24);
                                                console.log('set cache !! ', keyPath);
                                            }
                                        } else {
                                            pdf.create(result, tpl.printOptions || report_options).toStream(function (err, stream) {
                                                module.exports.writeResponse(stream, res);
                                            });
                                        }
                                    });
                                } catch (error) {
                                    console.log('error rendering ', error);
                                    res.send(error);
                                }

                            }

                            if (!doc['resultCount'] && doc['resultCount'] !== 0) {
                                try {
                                    model.count(filter.where, function (err, count) {
                                        doc['resultCount'] = count;
                                        doc.totalPages = Math.ceil(count / itemPerPage) || 1;
                                        createPages(doc.totalPages, doc.currentPage, doc);
                                        // Cập nhật lại meta robots sau khi có totalPages
                                        doc.metaRobots = generateSmartMetaRobots(req, { templateName, result: r, totalPages: doc.totalPages, currentPage: Number(doc.currentPage) || 1 });
                                        finalRender();
                                    });
                                } catch (error) {
                                    console.log('error counting ', error);
                                }

                            } else {
                                // Cập nhật meta robots nếu totalPages đã xác định trước đó
                                if (doc.totalPages) {
                                    doc.metaRobots = generateSmartMetaRobots(req, { templateName, result: r, totalPages: doc.totalPages, currentPage: Number(doc.currentPage) || 1 });
                                }
                                finalRender();
                            }


                        }
                    }

                    done();

                });
            });


        });
    });
};

module.exports.writeResponse = function (stream, res) {
    stream.pipe(res);
};

function displayDate(d, sFormat) {
    var theDate = moment(d);
    return theDate.isValid() ? theDate.format(sFormat) : "";
};

function sumByProp(arrData, prop) {
    var valuesToSum = _.map(arrData, function (d) {
        return d[prop];
    });

    console.log("valuesToSum: ", valuesToSum);

    var result = valuesToSum.reduce(function (a, b) { return a + b; }, 0);

    return result;
};

function displayCurrency(n) {
    return " " + (n && n.toFixed(0) || '').replace(/./g, function (c, i, a) {
        return i && c !== "," && ((a.length - i) % 3 === 0) ? '.' + c : c;
    }) + " VNĐ";
}

function displayAddress(address) {
    console.log("address");
    if (!address) {
        return "";
    }

    var street = address.street ? (address.street.trim().length > 0 ? (address.street) : "") : "";
    var ward = address.ward ? (address.ward.trim().length > 0 ? (address.ward) : "") : "";
    var district = address.district ? (address.district.trim().length > 0 ? (address.district) : "") : "";
    var city = address.city ? ((address.city.trim().length > 0) ? (address.city) : "") : "";

    return [street, ward, district, city].join(", ");
}

function displayGender(g) {
    return gender[g.toLowerCase()];
}

function getObject(id, modelName, attr, cb) {
    var query = { where: { id: id } };
    utils.getDataByQuery(modelName, query).then(function (obj) {
        //dfd.resolve({r: obj});
        cb(null, obj[0][attr]);
    }, function (error) {
        console.log("error");
        cb(error);
    });
}

function toWords(n) {
    if (n === 0) return 'không';

    const ones = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    const teens = ['mười', 'mười một', 'mười hai', 'mười ba', 'mười bốn', 'mười lăm', 'mười sáu', 'mười bảy', 'mười tám', 'mười chín'];
    const tens = ['', '', 'hai mươi', 'ba mươi', 'bốn mươi', 'năm mươi', 'sáu mươi', 'bảy mươi', 'tám mươi', 'chín mươi'];
    const scales = ['tỷ', 'triệu', 'nghìn', ''];

    function chunkNumber(num) {
        let str = num.toString().padStart(Math.ceil(num.toString().length / 3) * 3, '0');
        return str.match(/.{1,3}/g);
    }

    function threeDigitToWords(num) {
        let [hundreds, tensDigit, onesDigit] = num.split('').map(Number);
        let result = [];

        if (hundreds > 0) {
            result.push(ones[hundreds] + ' trăm');
            if (tensDigit === 0 && onesDigit > 0) {
                result.push('lẻ ' + ones[onesDigit]);
                return result.join(' ');
            }
        }

        if (tensDigit === 1) {
            result.push(teens[onesDigit]);
        } else {
            if (tensDigit > 1) result.push(tens[tensDigit]);
            if (onesDigit > 0) {
                if (onesDigit === 5 && tensDigit > 0) {
                    result.push('lăm');
                } else {
                    result.push(ones[onesDigit]);
                }
            }
        }

        return result.join(' ');
    }

    let chunks = chunkNumber(n);
    let words = chunks.map((chunk, index) => {
        let chunkValue = parseInt(chunk);
        return chunkValue > 0 ? threeDigitToWords(chunk) + ' ' + scales[scales.length - chunks.length + index] : '';
    }).filter(Boolean);

    return words.join(' ').trim();
}

// Add filter in Nunjucks environment
env.addFilter('toWords', toWords);


env.addFilter('displayDate', displayDate);
env.addFilter('sumByProp', sumByProp);
env.addFilter('displayCurrency', displayCurrency);
env.addFilter('displayAddress', displayAddress);
env.addFilter('displayGender', displayGender);
env.addFilter('displayGenderX', displayGender);
env.addFilter('getObject', getObject, true);
env.addFilter('fixImgURL', function (url) {
    return url.replace('cdn.live1.vn', 'ats.test.live1.vn');
});

/**
 * Filter: Dịch text (cho text động)
 * Usage: {{ 'greeting' | t }}
 */
env.addFilter('t', function (key, params) {
    const context = this.ctx || {};
    const tenant = context.tenant || context.subdomain || 'default';
    const lang = context.currentLang || context.lang || 'vi';
    return i18n.translate(key, tenant, lang, params);
});

/**
 * Filter: Dịch text có HTML (không escape)
 * Usage: {{ 'greeting' | t_safe }}
 */
env.addFilter('t_safe', function (key, params) {
    const context = this.ctx || {};
    const tenant = context.tenant || context.subdomain || 'default';
    const lang = context.currentLang || context.lang || 'vi';
    const text = i18n.translate(key, tenant, lang, params);
    return new nunjucks.runtime.SafeString(text);
});

/**
 * Filter: Thêm lang vào URL
 * Usage: {{ '/about' | addLang }}
 */
env.addFilter('addLang', function (url) {
    if (!url) return url;
    const context = this.ctx || {};
    const currentLang = context.currentLang || context.lang;
    if (!currentLang || currentLang === 'vi') return url;
    if (url.startsWith('http') || url.startsWith('//') || url.startsWith('#')) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}lang=${currentLang}`;
});

const slugify = require('slugify'); // Needed for the |slug modifier
const _get = require('lodash.get');

// --- Slugify Configuration ---
// Define options for slugify consistency
const slugifyOptions = {
    replacement: '-',  // replace spaces with replacement character, defaults to `-`
    remove: /[*+~.()'"!:@]/g, // remove characters that slugify doesn't handle by default
    lower: true,      // convert to lower case
    strict: true,     // strip special characters except replacement
    locale: 'vi',     // <<<<<< ADD VIETNAMESE LOCALE SUPPORT HERE
    trim: true        // trim leading and trailing replacement chars, defaults to `true`
};

function getPropertyValue(obj, path, defaultValue = '') {
    const value = _get(obj, path, defaultValue);
    // Ensure we don't return null/undefined, default to the defaultValue (which defaults to '')
    return value === null || value === undefined ? defaultValue : value;
}


env.addFilter('seoUrl', function (dataObject, config, objectType) {

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
        console.error("friendly-seo-url filter: Error during placeholder processing. Generating fallback.", error);
        // Generate fallback using the provided objectType argument
        return generateFallbackUrl(dataObject, objectType);
    }
}); // End of addFilter

