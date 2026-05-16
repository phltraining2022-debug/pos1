module.exports = function() {
  return function securityMiddleware(req, res, next) {
    const path = req.path;
    const method = req.method;
    const userAgent = req.headers['user-agent'] || '';
    
    // Block suspicious file extensions (only for non-API paths)
    const suspiciousExtensions = [
      '.php', '.asp', '.aspx', '.jsp', '.jspx', '.do', '.action', '.cgi', '.pl', '.py', '.rb',
      '.jar', '.war', '.ear', '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.js',
      '.env', '.ini', '.conf', '.config', '.log', '.bak', '.backup', '.old', '.orig', '.tmp', '.temp', '.cache',
      '.htaccess', '.htpasswd', '.git', '.svn', '.DS_Store', '.Thumbs.db'
    ];
    
    // Only check file extensions for non-API paths
    if (!path.startsWith('/api/') && suspiciousExtensions.some(ext => path.toLowerCase().includes(ext))) {
      // console.log(`🚫 BLOCKED: Suspicious file extension - ${path}`);
      return res.status(404).send('Not found');
    }

    // Block path traversal attacks (only for non-API paths)
    if (!path.startsWith('/api/') && (
      path.includes('..') || 
      path.includes('%2e%2e') || 
      path.includes('%252e%252e')
    )) {
      // console.log(`🚫 BLOCKED: Path traversal detected - ${path}`);
      return res.status(404).send('Not found');
    }

    // Block requests to admin panels or known attack targets (always check)
    const forbiddenPaths = [
      '/admin', '/admin/', '/administrator', '/administrator/',
      '/phpmyadmin', '/phpMyAdmin', '/pma', '/mysql', '/myadmin',
      '/wp-admin', '/wp-login', '/wordpress', '/wp-content',
      '/joomla', '/drupal', '/magento', '/prestashop', '/opencart',
      '/cms', '/backend', '/console', '/manager', '/panel', '/dashboard',
      '/control', '/manage', '/uploads', '/upload', '/auth/check',
      '/service', '/cgi-bin', '/setup.cgi', '/convert', '/file', '/jobmanager', '/jars'
    ];
    
    if (forbiddenPaths.some(fb => path.toLowerCase().startsWith(fb))) {
      // console.log(`🚫 BLOCKED: Forbidden admin path - ${path}`);
      return res.status(404).send('Not found');
    }

    // Block suspicious user agents (always check)
    const badAgents = [
      'sqlmap', 'nikto', 'acunetix', 'nmap', 'nessus', 'dirbuster', 
      'fuzz', 'w3af', 'wpscan', 'crawler', 'bot', 'spider'
    ];
    
    if (badAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
      // console.log(`🚫 BLOCKED: Suspicious user agent - ${userAgent}`);
      return res.status(404).send('Not found');
    }

    // Block suspicious HTTP methods (always check)
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    if (!allowedMethods.includes(method)) {
      // console.log(`🚫 BLOCKED: Suspicious HTTP method - ${method} ${path}`);
      return res.status(404).send('Not found');
    }

    // Block suspicious headers (always check)
    const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-forwarded-proto'];
    for (const header of suspiciousHeaders) {
      if (req.headers[header] && req.headers[header].includes('..')) {
        // console.log(`🚫 BLOCKED: Suspicious header - ${header}: ${req.headers[header]}`);
        return res.status(404).send('Not found');
      }
    }

    // Simple rate limiting (using memory cache)
    const requestCount = req.app.locals.requestCount = req.app.locals.requestCount || {};
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 500000; // 1000 requests per minute (increased for API usage)

    if (!requestCount[req.ip]) {
      requestCount[req.ip] = { count: 0, resetTime: now + windowMs };
    }

    if (now > requestCount[req.ip].resetTime) {
      requestCount[req.ip] = { count: 0, resetTime: now + windowMs };
    }

    requestCount[req.ip].count++;

    if (requestCount[req.ip].count > maxRequests) {
      // console.log(`🚫 BLOCKED: Rate limit exceeded - ${req.ip} (${requestCount[req.ip].count} requests)`);
      return res.status(429).send('Too many requests');
    }

    // Clean up old entries (prevent memory leak)
    Object.keys(requestCount).forEach(key => {
      if (requestCount[key].resetTime < now) {
        delete requestCount[key];
      }
    });

    next();
  };
};