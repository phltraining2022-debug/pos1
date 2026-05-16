var loopback = require('loopback');
var boot = require('loopback-boot');
var app = module.exports = loopback();
var bodyParser = require('body-parser');
var LoopBackContext = require('loopback-context');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');
var cookieParser = require('cookie-parser')
var fs = require('fs');

const cls = require('cls-hooked');


app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(cookieParser('secret--1x'))

// Import the Redis client
const redis = require('redis');

// Create a Redis client
const client = redis.createClient();

// Handle connection errors
client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// Function to process messages from the queue
async function processQueue() {
  try {
    // Wait for a message from the queue
    const message = await new Promise((resolve, reject) => {
      client.blpop('message_queue', 0, (err, message) => {
        if (err) {
          reject(err);
        } else {
          resolve(message);
        }
      });
    });

    // Process the message
    console.log('Processing message:', JSON.parse(message[1]));

    const m = JSON.parse(message[1]);
    
    // format of message is { "model": "visit", "data": { "toId": 1, "fromId": 2, "content": "Hello" } }

    if (m.model === 'visit') {
      // Process the visit message
      console.log('Start processing visit message:', m.data);
      const appName = m.appName;
      // check if there is the code inf folder jobs/${appName}/visit.js
      // if there is, execute the code
      if (appName && fs.existsSync(`jobs/${appName}/visit.js`)) {
        const code = fs.readFileSync(`jobs/${appName}/visit.js`, 'utf8');
        const func = new Function('obj', 'require', code);
        await func(m.data, require); 
      }

      // if not, do nothing
    } else if (m.model === 'message') {
      // Process the message message
      // check if there is the code inf folder jobs/${appName}/message.js
      // if there is, execute the code

      // if not, do nothing
    }

    // Simulate asynchronous processing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Continue processing the next message
    processQueue();
  } catch (err) {
    console.error('Queue Processing Error:', err);
    // Optionally, add a delay before retrying
    setTimeout(processQueue, 1000);
  }
}

// Start processing the queue
processQueue();


boot(app, __dirname, function (err) {
});







