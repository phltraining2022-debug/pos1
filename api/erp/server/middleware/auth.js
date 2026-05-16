module.exports = function() {
  return function authMiddleware(req, res, next) {
    //console.log('Auth middleware - Path:', req.path);
    // console.log('Auth middleware - Hostname:', req.headers);

    // Lấy token từ header Authorization
    const authHeader = req.headers['authorization'];
    let token = authHeader;
    // if (authHeader && authHeader.startsWith('Bearer ')) {
    //   token = authHeader.slice(7); // Bỏ "Bearer "
    //   // console.log('Token found:', token.substring(0, 10) + '...');
    // }
    // } else {
    //   console.log('No Authorization header found');
    // }
    const sharedCode = req.query.sharedCode || req.headers['x-shared-code'];
    // Bỏ qua authentication cho một số endpoint công khai
    const publicEndpoints = [
      '/api/users/login',
      '/api/users/register', 
      '/api/products',
      '/api/customers/login',
      '/api/leads/login',
      '/api/verify-sms-otp',
      '/api/index',
      '/api/ip',
      '/api/whoami',
      '/api/r/:slug',
      '/api/templates/*',
      '/api/pages/*',
      '/api/blocks/*',
      '/api/files/*',
      '/api/reset-password-code',
      '/api/request-reset-code',
      '/api/appointments',
      '/api/subscribers',
      '/api/auth/customer/facebook',
      '/api/auth/customer/google',
      '/api/auth/customer/facebook/callback', 
      '/api/auth/customer/google/callback',
      '/api/redemptioncodes',
      '/api/redemptionCodes',
      '/api/pdf',
      '/api/containers/imgs/download/',
      '/api/auth/customer/link-account',
      '/api/auth/customer/login',
      '/api/leads/request-reset-code',
      '/api/leads/reset-password-code',
      '/api/r/:slug',
      '/api/events',
      '/api/blocks',
      '/api/leads/facebook-webhook',
      '/api/load-cfg',
      '/api/r/home-dh-test',
      '/api/templates',
      '/api/pages',
      '/api/news',
      '/api/schools',
      '/api/scholarshipnews',
      '/api/Cfgs',
      '/api/media',
      '/api/collections',
      '/api/zalo',
      '/api/facebook-chat-webhook',
      '/api/facebook-chat-webhook/send',
      '/api/facebook-chat-webhook/messages/:facebookId',
      '/api/facebook-chat-webhook/messages',


    ];

    

    
    // Kiểm tra nếu là public endpoint
    if (publicEndpoints.some(endpoint => req.path.toLowerCase().startsWith(endpoint.toLowerCase()))) {
      // console.log('Public endpoint - skipping authentication');
      return next();
    }

    const pathLower = req.path.toLowerCase();
    if((pathLower === '/api/leads' || pathLower === '/api/leads/') && req.method === 'POST'){
      return next();
    }

    if((pathLower === '/api/users' || pathLower === '/api/users/') && req.method === 'POST'){
      return next();
    }

    if((pathLower === '/api/customers' || pathLower === '/api/customers/') && req.method === 'POST'){
      return next();
    }

    // Chỉ yêu cầu token cho các method chỉnh sửa (POST, PUT, DELETE, PATCH)
    // GET request không cần token
    const app = req.app;
    const hostname = req.hostname;
    const clientName = hostname.split('.')[0];
    const datasourceName = clientName;
    let datasource = app.dataSources[datasourceName];
    
    if (!datasource) {
      // Fall back to default kara datasource (for local dev without Host header)
      datasource = app.dataSources['kara'] || app.dataSources['db'];
      if (!datasource) {
        return res.status(500).json({
          error: {
            message: 'Invalid datasource configuration',
            statusCode: 500
          }
        });
      }
    }

    // Xử lý sharedCode trước (nếu có)
    //console.log('sharedCode:', sharedCode);
    if (sharedCode) {
      const Filter = app.models.Filter;
      
      // Đảm bảo model được attach với đúng datasource
      if (Filter.currentDatasource !== datasourceName) {
        Filter.attachTo(datasource);
        Filter.currentDatasource = datasourceName;
      }

      // Tìm filter với sharedCode
      Filter.findOne({
        where: {
          sharedCode: sharedCode
        }
      }, function(err, filter) {
        if (err) {
         
          return res.status(500).json({
            error: {
              message: 'Database error',
              statusCode: 500
            }
          });
        }

        if (!filter) {
         
          return res.status(401).json({
            error: {
              message: 'Invalid shared code',
              statusCode: 401
            }
          });
        }

         const allowedUrls = [
          '/api/AppModels/smartFind',
          '/api/settings',
          '/api/filters',
          '/api/events'
        ];

        const isUrlAllowed = allowedUrls.some(url => req.path.startsWith(url));
        
        if (!isUrlAllowed) {
          
          return res.status(403).json({
            error: {
              message: 'Access denied: URL not allowed for shared code',
              statusCode: 403
            }
          });
        }

        // Nếu hợp lệ, gán vào req.sharedFilter và tiếp tục
        req.sharedFilter = filter;
        req.sharedCode = sharedCode;
        
        var loopbackContext = require('loopback-context');
        var ctx = loopbackContext.getCurrentContext();
        if (ctx) {
          ctx.set('sharedFilter', filter);
          ctx.set('sharedCode', sharedCode);
        }
        
        
        next();
      });
      return; // Dừng xử lý token nếu đã xử lý sharedCode
    }

    // Xử lý token nếu không có sharedCode
    // Chỉ yêu cầu token cho các method chỉnh sửa (POST, PUT, DELETE, PATCH)
    if (!token && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
     
      return res.status(401).json({
        error: {
          message: 'Access token required for modification operations',
          statusCode: 401
        }
      });
    }

    if (!token) {
      return res.status(401).json({
        error: {
          message: 'Access token required',
          statusCode: 401
        }
      });
    }

    // Lấy AccessToken model với đúng datasource
    const AccessToken = app.models.AccessToken;
    
    // Đảm bảo model được attach với đúng datasource
    if (AccessToken.currentDatasource !== datasourceName) {
      AccessToken.attachTo(datasource);
      AccessToken.currentDatasource = datasourceName;
    }

    // Xác thực token với DB
    AccessToken.findById(token, function(err, accessToken) {
      if (err) {
       
        return res.status(500).json({
          error: {
            message: 'Database error',
            statusCode: 500
          }
        });
      }

      if (!accessToken) {
        
        return res.status(401).json({
          error: {
            message: 'Invalid or expired access token',
            statusCode: 401
          }
        });
      }

      // Nếu hợp lệ, gán vào req.accessToken và tiếp tục
      req.accessToken = accessToken;
      
      var loopbackContext = require('loopback-context');
      var ctx = loopbackContext.getCurrentContext();
      if (ctx) {
        ctx.set('accessToken', accessToken);
        ctx.set('currentUserId', accessToken.userId);
      }
      
      //console.log('Authentication successful for user:', accessToken.userId);
      next();
    });
  }
};