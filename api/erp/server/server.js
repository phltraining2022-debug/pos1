var loopback = require('loopback');
var boot = require('loopback-boot');
var app = module.exports = loopback();
var bodyParser = require('body-parser');
var LoopBackContext = require('loopback-context');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');
var cookieParser = require('cookie-parser')
// var omicall = require('./boot/omicall');
// var omicallApiService = require('./boot/omicall-api-service');

const cls = require('cls-hooked');
// const namespace = cls.createNamespace('loopback');


app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(cookieParser('secret--1x'))

// connect to redis
var redis = require('redis');
var client = redis.createClient();


app.use(loopback.context());
app.use(LoopBackContext.perRequest());

// app.use(loopback.token({
//   model: app.models.AccessToken,
//   cookies: ['access_token']
// }));


app.use(function setCurrentUser(req, res, next) {

  const subdomain = req.headers.host.split('.')[0];
  var loopbackContext = LoopBackContext.getCurrentContext();

  if (!loopbackContext) {
    return next();
  }

  if (req.accessToken) {
    if (req.headers['from-public-site']) {
      console.log('from public site');
      loopbackContext.set('currentLeadId', req.accessToken.userId);
    } else {
      loopbackContext.set('currentUserId', req.accessToken.userId);
    }
  } 

  return next();
});
/* 
app.use(function setCurrentUser(req, res, next) {

  const subdomain = req.headers.host.split('.')[0];

  console.log('req.accessToken', req.accessToken);

  // set database name based on subdomain
  const dbName = subdomain;

  if (!req.accessToken && req.cookies && req.cookies.access_token) {
    req.accessToken = app.models.AccessToken.findOne({ where: { id: req.cookies.access_token } }).
      then(function (accessToken) {
      req.accessToken = accessToken;
      if (accessToken) {
        app.models.user.findById(accessToken.userId, function (err, user) {
          if (err) return next(err);
          if (!user) {
            // find the id in customer table 
            app.models.Customer.findById(accessToken.userId, function (err, user) {
              if (err) return next(err);
              if (!user) {
                // find the id in lead table 
                app.models.Lead.findById(accessToken.userId, function (err, user) {
                  if (err) return next(err);
                  if (!user) {
                    return next(new Error('No user with this access token was found.'));
                  }
                  req.currentUser = user;
                  req.xUser = user;
                  req.accessToken = accessToken;
                  var loopbackContext = LoopBackContext.getCurrentContext();
                  if (loopbackContext) {
                    loopbackContext.set('user', user);
                    loopbackContext.set('currentUser', user);
                  }
                  next();
                });
              } else {
                req.currentUser = user;
                req.xUser = user;
                req.accessToken = accessToken;
                var loopbackContext = LoopBackContext.getCurrentContext();
                if (loopbackContext) {
                  loopbackContext.set('user', user);
                  loopbackContext.set('currentUser', user);
                }
                next();
              }
            });
            // return next(new Error('No user with this access token was found.'));
          }

          console.log('user', user.id);
          req.currentUser = user;
          req.xUser = user;
          req.accessToken = accessToken;

          // store access token id key with value into redis
          client.set(user.id, req.cookies.access_token, function (err, reply) {
            console.log('client set', err, reply);
          });
          
          var loopbackContext = LoopBackContext.getCurrentContext();
          if (loopbackContext) {
            loopbackContext.set('user', user);
            loopbackContext.set('currentUser', user);
          }
          next();
        });
      } else {
        return next();
      }
    });
  } else {

    if (!req.headers['from-public-site']) {

      if (req.accessToken) {
        console.log('req.accessToken.userId', req.accessToken.userId);
        app.models.user.findById(req.accessToken.userId, function (err, user) {
          if (err) return next(err);
          if (!user) {
            // find the id in customer table
            app.models.Customer.findById(req.accessToken.userId, function (err, user) {
              if (err) return next(err);
              if (!user) {
                // find the id in lead table
                app.models.Lead.findById(req.accessToken.userId, function (err, user) {
                  if (err) return next(err);
                  if (!user) {
                    return next(new Error('No user with this access token was found.'));
                  }
                  req.currentUser = user;
                  req.xUser = user;
                  var loopbackContext = LoopBackContext.getCurrentContext();
                  if (loopbackContext) {
                    loopbackContext.set('user', user);
                    loopbackContext.set('currentUser', user);
                  }
                  next();
                });
              } else {
                req.currentUser = user;
                req.xUser = user;
                var loopbackContext = LoopBackContext.getCurrentContext();
                if (loopbackContext) {
                  loopbackContext.set('user', user);
                  loopbackContext.set('currentUser', user);
                }
                next();
              }
            });
          }
          req.currentUser = user;
          req.xUser = user;
          var loopbackContext = LoopBackContext.getCurrentContext();
          if (loopbackContext) {
            loopbackContext.set('user', user);
            loopbackContext.set('currentUser', user);
          }
          next();
        });
      } else {
        return next();
      }
    } else {  
      // from public site
      console.log('from public site');
      var loopbackContext = LoopBackContext.getCurrentContext();
      if (loopbackContext) {
        loopbackContext.set('currentUser', '11222333');
        console.log('>>> set user currentUser');
      } else {
        console.log('>>> no loopbackContext');
      }

      next();

      // namespace.run(() => {
      //   namespace.set('currentUserId', '11222333');
      //   next();
      // });

      // if (req.accessToken)
      //   app.models.Lead.findById(req.accessToken.userId, function (err, user) {
      //     // set current context user
          
      //     next();
      //   });
      // else
      //   next();
    }
  }
}); */


app.start = function () {
  const port = process.env.PORT || 7001;
   
  var httpServer = app.listen(port, function () {
  });


  return httpServer;
};

console.log(__dirname);

boot(app, __dirname, function (err) {
  if (err) throw err;


  if (require.main === module) {
    app.start();
  }
});







