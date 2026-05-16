module.exports = function() {
  return function advancedSecurityMiddleware(req, res, next) {
    const path = req.path;
    const method = req.method;
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection.remoteAddress;

    return next();
    
    // Log mọi request để debug
    // console.log(`[MIDDLEWARE] ${method} ${path} - User-Agent: ${userAgent} - IP: ${ip}`);

    // ==================== WHITELIST - MODEL NAMES ====================
    // CHỈ CHO PHÉP CÁC MODEL ĐÃ ĐỊNH NGHĨA - QUAN TRỌNG NHẤT
    const allowedModels = [
      'Users', 'users',
      'Customers', 'customers',
      'Leads', 'leads',
      'AccessTokens', 'accessTokens',
      'AccessTokenCodes', 'accessTokenCodes',
      'Templates', 'templates',
      'Pages', 'pages',
      'Blocks', 'blocks',
      'Files', 'files',
      'Filters', 'filters',
      'Favorites', 'favorites',
      'AppModels',
      // Thêm tất cả model names hợp lệ của bạn vào đây
    ];

    // ==================== WHITELIST - ROUTES ====================
    // Chỉ cho phép các API đã được định nghĩa trong server
    const allowedRoutes = [
      // API cơ bản của LoopBack
      '/api/',
      '/api/explorer',
      '/api/explorer/',
      
      // SEO routes - Thêm các route SEO quan trọng
      '/robots.txt',
      '/sitemap.xml',
      '/sitemap',
      '/sitemap-index.xml',
      '/favicon.ico',
      '/.well-known/',
      '/humans.txt',
      '/security.txt',
      
      // API authentication
      '/api/users/login',
      '/api/users/register', 
      '/api/users/logout',
      '/api/users/me',
      '/api/customers/login',
      '/api/leads/login',
      '/api/verify-sms-otp',
      '/api/whoami',
      
      // API từ ats.js
      '/api/load-cfg',
      '/api/test01',
      '/api/test02',
      '/api/test03',
      '/api/test04',
      '/api/test05',
      '/api/r',
      '/api/templates',
      '/api/pages',
      '/api/blocks',
      '/api/files',
      '/api/index',
      '/api/ip',
      '/api/decodeBase64',
      '/api/getClinics',
      '/api/favorites',
      
      // API từ routes.js
      '/api/lead-login',
      '/api/Leads',
      '/api/filters',
      '/api/accessTokens',
      '/api/accessTokenCodes',
      '/api/auth/customer/facebook',
      '/api/auth/customer/google',
      '/api/auth/customer/facebook/callback', 
      '/api/auth/customer/google/callback',
    ];

    // ==================== ALLOWED BOTS ====================
    // Danh sách các bot SEO hợp lệ được phép
    const allowedBots = [
      'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot', 
      'facebookexternalhit', 'twitterbot', 'linkedinbot', 'whatsapp', 'telegrambot',
      'applebot', 'crawler', 'spider', 'bot', 'crawl', 'scraper', 'indexer',
      'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'sistrix', 'sogou',
      'seznambot', 'yandex', 'google', 'bing', 'yahoo', 'duckduckgo',
      'ia_archiver', 'archive.org', 'wayback', 'web.archive.org',
      'pinterest', 'pinterestbot', 'skypeuripreview', 'discordbot',
      'slackbot', 'telegram', 'viber', 'linebot', 'kakaotalk'
    ];
    
    // ==================== CHECK IF BOT ====================
    const userAgentLower = userAgent.toLowerCase();
    const isAllowedBot = allowedBots.some(bot => {
      const botLower = bot.toLowerCase();
      const result = userAgentLower.includes(botLower);
      return result;
    });

    // ==================== ALLOW SEO BOT ROUTES ====================
    // Nếu là bot SEO, cho phép truy cập các route SEO ngay lập tức
    if (isAllowedBot && (path === '/robots.txt' || path === '/sitemap.xml' || path.startsWith('/sitemap') || path === '/favicon.ico')) {
      // console.log(`✅ ALLOWED: SEO Bot accessing ${path} - ${userAgent} from ${ip}`);
      return next();
    }

    // ==================== NOSQL/SQL INJECTION PROTECTION ====================
    // BLOCK NGAY LẬP TỨC - Kiểm tra trong URL, path và query string
    const fullUrl = req.url;
    const noSqlInjectionPatterns = [
      // MongoDB operators
      /\$where/i,
      /\$ne/i,
      /\$gt/i,
      /\$lt/i,
      /\$gte/i,
      /\$lte/i,
      /\$regex/i,
      /\$in/i,
      /\$nin/i,
      /\$or/i,
      /\$and/i,
      /\$not/i,
      /\$nor/i,
      /\$exists/i,
      /\$type/i,
      /\$mod/i,
      /\$text/i,
      /\$expr/i,
      /\$elemMatch/i,
      /\$size/i,
      
      // SQL Injection patterns
      /DBMS_PIPE/i,
      /CHR\(/i,
      /RECEIVE_MESSAGE/i,
      /WAITFOR\s+DELAY/i,
      /BENCHMARK/i,
      /SLEEP\(/i,
      /pg_sleep/i,
      /\|\|.*\|\|/,  // Oracle concatenation như: 'contact'||DBMS_PIPE
      /;\s*DROP/i,
      /;\s*DELETE/i,
      /;\s*UPDATE/i,
      /;\s*INSERT/i,
      /UNION.*SELECT/i,
      /SELECT.*FROM/i,
      /INSERT.*INTO/i,
      /UPDATE.*SET/i,
      /DELETE.*FROM/i,
      
      // Math-based SQL injection như: -1 OR 2+132-132-1=0+0+0+1
      /OR\s+\d+[\+\-\*\/]=\d+/i,
      /AND\s+\d+[\+\-\*\/]=\d+/i,
      /-\d+\s+OR\s+\d+/i,
      
      // Common SQL keywords
      /xp_cmdshell/i,
      /sp_executesql/i,
      /exec\s*\(/i,
      /execute\s*\(/i,
      
      // Hex encoding attempts
      /0x[0-9a-f]{2,}/i,
    ];
    
    const hasSqlInjection = noSqlInjectionPatterns.some(pattern => pattern.test(fullUrl));
    
    if (hasSqlInjection) {
      console.log(`🚫 BLOCKED: SQL/NoSQL injection detected - ${fullUrl} from ${ip}`);
      return res.status(400).send('Bad Request');
    }

    // Kiểm tra trong request body (nếu có)
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body);
      if (noSqlInjectionPatterns.some(pattern => pattern.test(bodyStr))) {
        console.log(`🚫 BLOCKED: SQL/NoSQL injection in body from ${ip}`);
        return res.status(400).send('Bad Request');
      }
    }

    // ==================== MODEL API VALIDATION ====================
    // Kiểm tra xem có phải là model API không và validate model name
    const modelMatch = path.match(/^\/api\/([a-zA-Z][a-zA-Z0-9_-]*)/);
    let isModelApi = false;
    
    if (modelMatch) {
      const modelName = modelMatch[1];
      
      // Kiểm tra xem model name có hợp lệ không
      // 1. Phải nằm trong whitelist
      // 2. Không chứa ký tự đặc biệt nguy hiểm
      const isValidModelName = allowedModels.includes(modelName) && 
                              /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(modelName) &&
                              modelName.length < 50;
      
      if (!isValidModelName) {
        console.log(`🚫 BLOCKED: Invalid model name - ${modelName} from ${ip} - Path: ${path}`);
        return res.status(404).send('Not found');
      }
      
      isModelApi = true;
    }

    // ==================== ALLOWED ROUTE CHECK ====================
    const isAllowedRoute = allowedRoutes.some(route => {
      if (route.endsWith('*')) {
        return path.startsWith(route.slice(0, -1));
      }
      return path.startsWith(route);
    });

    // ==================== BOT ADMIN PATH PROTECTION ====================
    // Nếu là bot SEO, cho phép truy cập tất cả route (trừ admin paths)
    if (isAllowedBot) {
      const suspiciousPaths = [
        '/admin', '/admin/', '/administrator', '/administrator/',
        '/phpmyadmin', '/phpMyAdmin', '/pma', '/mysql', '/myadmin',
        '/wp-admin', '/wp-login', '/wordpress', '/wp-content',
        '/joomla', '/drupal', '/magento', '/prestashop', '/opencart', '/oscommerce', '/zen-cart', '/cubecart', '/x-cart',
        '/shopware', '/typo3', '/concrete5', '/silverstripe',
        '/processwire', '/craft', '/expressionengine', '/modx',
        '/cms', '/backend', '/console', '/manager', '/panel', '/dashboard', '/control', '/manage', '/uploads', '/upload',
        '/auth/check', '/service', '/cgi-bin', '/setup.cgi', '/convert', '/file', '/jobmanager', '/jars'
      ];
      
      if (suspiciousPaths.some(p => path.toLowerCase().startsWith(p))) {
        console.log(`🚫 BLOCKED: Bot accessing admin path - ${path} from ${ip}`);
        return res.status(404).send('Not found');
      }
      
      return next();
    }

    // ==================== ROUTE VALIDATION ====================
    // Nếu không phải allowed route và không phải model API thì BLOCK
    if (!isAllowedRoute && !isModelApi) {
      console.log(`🚫 BLOCKED: Unknown route - ${method} ${path} from ${ip} (User-Agent: ${userAgent})`);
      return res.status(404).send('Not found');
    }

    // ==================== SECURITY CHECKS ====================
    // Chỉ kiểm tra các điều kiện bảo mật cơ bản cho allowed routes

    // 1. BLOCK SUSPICIOUS FILE EXTENSIONS
    if (!isAllowedRoute && !isModelApi) {
      const blockedExtensions = [
        '.php', '.asp', '.aspx', '.jsp', '.jspx', '.do', '.action', '.cgi', '.pl', '.py', '.rb',
        '.jar', '.war', '.ear', '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.js',
        '.env', '.ini', '.conf', '.config', '.xml', '.yml', '.yaml', '.json',
        '.log', '.bak', '.backup', '.old', '.orig', '.tmp', '.temp', '.cache', '.swp', '.swo',
        '.htaccess', '.htpasswd', '.git', '.svn', '.DS_Store', '.Thumbs.db'
      ];
      if (blockedExtensions.some(ext => path.toLowerCase().includes(ext))) {
        console.log(`🚫 BLOCKED: Suspicious extension - ${path} from ${ip}`);
        return res.status(404).send('Not found');
      }
    }

    // 2. BLOCK COMMON ATTACK PATTERNS
    if (!isAllowedRoute && !isModelApi) {
      if (path.includes('..') || /%2e%2e|%252e%252e|%00|%0a|%0d|%09|%20|%2b|%2d|%2f|%5c|%7c|%3b|%26|%7e|%60|%27|%22|%3c|%3e|%28|%29|%5b|%5d|%7b|%7d|%5e|%24|%23|%40|%21|%2a/i.test(path)) {
        console.log(`🚫 BLOCKED: Path traversal or encoding - ${path} from ${ip}`);
        return res.status(404).send('Not found');
      }
    }

    // 3. BLOCK COMMAND INJECTION PATTERNS
    if (!isAllowedRoute && !isModelApi) {
      if (/\|\||&&|;|`.*`|\$\(.*\)|<.*>|>.*<|\|.*\||&.*&|\(.*\)|\[.*\]|\{.*\}|\/etc\/passwd|\/etc\/shadow|\/proc\//i.test(path)) {
        console.log(`🚫 BLOCKED: Command injection detected - ${path} from ${ip}`);
        return res.status(404).send('Not found');
      }
    }

    // 4. BLOCK SUSPICIOUS PATHS (admin panels, known CMS, etc.) - LUÔN KIỂM TRA
    const suspiciousPaths = [
      '/admin', '/admin/', '/administrator', '/administrator/',
      '/phpmyadmin', '/phpMyAdmin', '/pma', '/mysql', '/myadmin',
      '/wp-admin', '/wp-login', '/wordpress', '/wp-content',
      '/joomla', '/drupal', '/magento', '/prestashop', '/opencart', '/oscommerce', '/zen-cart', '/cubecart', '/x-cart',
      '/shopware', '/typo3', '/concrete5', '/silverstripe',
      '/processwire', '/craft', '/expressionengine', '/modx',
      '/cms', '/backend', '/console', '/manager', '/panel', '/dashboard', '/control', '/manage', '/uploads', '/upload',
      '/auth/check', '/service', '/cgi-bin', '/setup.cgi', '/convert', '/file', '/jobmanager', '/jars'
    ];
    if (suspiciousPaths.some(p => path.toLowerCase().startsWith(p))) {
      console.log(`🚫 BLOCKED: Suspicious admin path - ${path} from ${ip}`);
      return res.status(404).send('Not found');
    }

    // 5. BLOCK SUSPICIOUS USER AGENTS
    const badAgents = [
      'sqlmap', 'nikto', 'acunetix', 'nmap', 'nessus', 'dirbuster', 'fuzz', 'w3af', 'wpscan',
      'havij', 'masscan', 'metasploit', 'burp', 'zap', 'vega', 'grabber'
    ];
    
    if (badAgents.some(agent => userAgent.toLowerCase().includes(agent)) && !isAllowedBot) {
      console.log(`🚫 BLOCKED: Suspicious user agent - ${userAgent} from ${ip}`);
      return res.status(404).send('Not found');
    }

    // 6. BLOCK SUSPICIOUS QUERY PARAMETERS
    if (!isAllowedRoute && !isModelApi) {
      const queryString = req.url.split('?')[1] || '';
      if (queryString) {
        const suspiciousParams = [
          'apikey', 'service-cmds-peform', 'todo', 'cmd', 'C1', 'f_ntp_server',
          'exec', 'execute', 'xp_cmdshell', 'sp_executesql', 'union', 'select',
          'drop', 'insert', 'update', 'delete', 'where', 'from'
        ];
        if (suspiciousParams.some(param => queryString.toLowerCase().includes(param))) {
          console.log(`🚫 BLOCKED: Suspicious query parameters - ${path}?${queryString} from ${ip}`);
          return res.status(404).send('Not found');
        }
      }
    }

    // 7. BLOCK SUSPICIOUS HTTP METHODS - LUÔN KIỂM TRA
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    if (!allowedMethods.includes(method)) {
      console.log(`🚫 BLOCKED: Suspicious HTTP method - ${method} ${path} from ${ip}`);
      return res.status(404).send('Not found');
    }

    // 8. BLOCK REQUESTS WITH SUSPICIOUS HEADERS - LUÔN KIỂM TRA
    const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-forwarded-proto'];
    for (const header of suspiciousHeaders) {
      if (req.headers[header] && req.headers[header].includes('..')) {
        console.log(`🚫 BLOCKED: Suspicious header - ${header}: ${req.headers[header]} from ${ip}`);
        return res.status(404).send('Not found');
      }
    }

    // ==================== RATE LIMITING ====================
    // Rate limiting đã được bỏ - sử dụng rate limiting ở tầng nginx/cloudflare thay thế

    // ==================== ALL CHECKS PASSED ====================
    next();
  };
};