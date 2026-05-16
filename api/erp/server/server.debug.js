var loopback = require('loopback');
var boot = require('loopback-boot');
var app = module.exports = loopback();
var bodyParser = require('body-parser');
var LoopBackContext = require('loopback-context');
var ParseServer = require('parse-server').ParseServer;

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.start = function () {
  var port = 8800;

  console.log(process.argv);

  if (process.argv && process.argv.length > 2 && process.argv[2] == 'lab-agent') {
    port = 8005;
    console.log('Running as lab agent', port)
  }


  // start the web server
  var httpServer = app.listen(port, function () {
    app.emit('started');
    var baseUrl = app.get('url').replace(/\/$/, '');
    console.log('Web server listening at: %s', baseUrl);
    if (app.get('loopback-component-explorer')) {
      var explorerPath = app.get('loopback-component-explorer').mountPath;
      console.log('Browse your REST API at %s%s', baseUrl, explorerPath);
    }
  });


  ParseServer.createLiveQueryServer(httpServer);
  return httpServer;
};

// Bootstrap the application, configure models, datasources and middleware.
// Sub-apps like REST API are mounted via boot scripts.
boot(app, __dirname, function (err) {
  if (err) throw err;

  // start the server if `$ node server.js`
  if (require.main === module) {
    // app.start();

    app.io = require('socket.io')(app.start());
    app.io.on('connection', function (socket) {
      console.log('a user connected');
      socket.on('chat message', function (msg) {
        console.log('message: ' + msg);
        app.io.emit('chat message', msg);
      });
      socket.on('disconnect', function () {
        console.log('user disconnected');
      });
    });
  }
});


app.use(LoopBackContext.perRequest());
app.use(loopback.token({
  headers: ['authorization'], model: app.models.accessToken,
  currentUserLiteral: 'me'
}));

app.use(function setCurrentUser(req, res, next) {
  var ctx = req.loopbackContext;

  if (!req.headers.authorization || ctx.accessToken)
    next();
  else
    app.models.accessToken.findById(req.headers.authorization, function (err, token) {

      var ctddx = req.loopbackContext;
      if (ctx && token && ctx.active) {
        ctx.set('accessToken', token);
      }

      next();
    });
});


function inject(ctx, next) {
  if (ctx) {
    var l = loopback.getCurrentContext();
    if (l) {
      console.log('has lctx'); l.set('remote-ip', ctx.req.headers['x-real-ip']);
    }
  }
  next();
}

app.remotes().before('*.*', inject);

var path = require('path');
var _ = require('underscore');


var api = new ParseServer({
  databaseURI: 'mongodb://localhost:27017/care1',
  cloud: __dirname + '/cloud/main.js',
  appId: 'hat-app',
  masterKey: '123', //Add your master key here. Keep it secret!
  serverURL: 'http://localhost:1338/parse',  // Don't forget to change to https if needed
  liveQuery: {
    classNames: ["piNotification", "piNotifications"] // List of classes to support for query subscriptions
  }
});


// Serve the Parse API on the /parse URL prefix
var mountPath = '/parse';
app.use(mountPath, api);


