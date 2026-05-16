// Example express application adding the parse-server module to expose Parse
// compatible API routes.

var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');
var _ = require('underscore');


var databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;

if (!databaseUri) {
  console.log('DATABASE_URI not specified, falling back to localhost.');
}

var api = new ParseServer({
  databaseURI: databaseUri || 'mongodb://localhost:27017/amor',
  cloud: process.env.CLOUD_CODE_MAIN || __dirname + '/cloud/main.js',
  appId: process.env.APP_ID || 'amor',
  masterKey: process.env.MASTER_KEY || '123', //Add your master key here. Keep it secret!
  serverURL: process.env.SERVER_URL || 'http://localhost:1338/parse',  // Don't forget to change to https if needed
  liveQuery: {
    classNames: ["Notification"] // List of classes to support for query subscriptions
  }
});

// The information showed about the poster
var userEmail = 'YOUR_EMAIL';
var userDisplayName = 'YOUR_DISPLAY_NAME';
var userDescription = 'YOUR_DESCRIPTION';

// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

var app = express();


// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

app.locals._ = _;
app.locals.userEmail = userEmail;
app.locals.userDisplayName = userDisplayName;
app.locals.userDescription = userDescription;
app.locals.formatTime = function(time) {
  return moment(time).format('MMMM Do YYYY, h:mm a');
};
// Generate a snippet of the given text with the given length, rounded up to the
// nearest word.
app.locals.snippet = function(text, length) {
  if (text.length < length) {
    return text;
  } else {
    var regEx = new RegExp("^.{" + length + "}[^ ]*");
    return regEx.exec(text)[0] + "...";
  }
};


var port = process.env.PORT || 1338;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('parse-server-example running on port ' + port + '.');
});

// This will enable the Live Query real-time server
ParseServer.createLiveQueryServer(httpServer);
