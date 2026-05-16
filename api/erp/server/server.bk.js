var loopback = require('loopback');
var boot = require('loopback-boot');
var app = module.exports = loopback();
var bodyParser = require('body-parser');
var LoopBackContext = require('loopback-context');
var ParseServer = require('parse-server').ParseServer;

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.start = function () {
  var port = 9900;

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


  return httpServer;
};

// Bootstrap the application, configure models, datasources and middleware.
// Sub-apps like REST API are mounted via boot scripts.
boot(app, __dirname, function (err) {
  if (err) throw err;

  // start the server if `$ node server.js`
  if (require.main === module) {
    app.start();
  }
});





