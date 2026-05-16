// const express = require('express');
// const bodyParser = require('body-parser');
// const redis = require('redis');
// const mongoose = require('mongoose');
// const cron = require('node-cron');

// const ObjectId = mongoose.Types.ObjectId;

// const app = express();
// app.use(bodyParser.json());

// const redisClient = redis.createClient();
// // redisClient.connect();


// mongoose.connect('mongodb://localhost:27017/ats');

//     const schema = new mongoose.Schema({
//         viewCount: { type: Number, default: 0 }
//       }, { collection: 'News' }); // 👈 match your real MongoDB collection name
      
//       const News = mongoose.model('News', schema);

// //  async function main() {
// //     mongoose.connect('mongodb://localhost:27017/ats');

// //     const schema = new mongoose.Schema({
// //         viewCount: { type: Number, default: 0 }
// //       }, { collection: 'News' }); // 👈 match your real MongoDB collection name
      
// //       const News = mongoose.model('News', schema);

// //   // find first News sync 
// // const news = await News.findById('66bf4663711e4e8c6876f616');
// // console.log('First News:', news);
// // }

// // main().catch(err => console.log('MongoDB connection error:', err));




// // // API to receive view count
// app.post('/abcx', async (req, res) => {
//   const { model, id } = req.body;
//   console.log('Received view count:', model, id);
//   if (!model || !id) return res.status(400).send('Missing model or id');
//   await redisClient.incr(`viewcount:${model}:${id}`);
//   res.sendStatus(200);
// });

// // Cron job to flush view counts from Redis to MongoDB every minute
// cron.schedule('* * * * *', async () => {
//     console.log('Flushing view counts from Redis to MongoDB...');

//     redisClient.keys('viewcount:*', (err, keys) => {
//       if (err) {
//         console.error('Error fetching keys from Redis:', err);
//         return;
//       }
  
//       if (!keys || keys.length === 0) {
//         console.log('No view counts to flush.');
//         return;
//       }
  
//       console.log(`Found ${keys.length} keys to flush.`, keys);
  
//       keys.forEach((key) => {
//         redisClient.get(key, async (err, count) => {
//           if (err) {
//             console.error(`Error getting value for ${key}:`, err);
//             return;
//           }
  
//           const [, model, id] = key.split(':');
//           const inc = parseInt(count || '0', 10);
  
//           if (!inc || !id || !model) {
//             console.warn(`Invalid key or count: ${key} = ${count}`);
//             return;
//           }
  
//           if (model === 'News') {
//             try {
//               // debug get current view count
//                 // const news = await News.findById(id);
//                 // if (!news) {
//                 //   console.warn(`News item not found for id ${id}`);
//                 //   return;
//                 // }
//                 // const currentViewCount = news.viewCount || 0;
//                 // console.log(`Current view count for News ${id}: ${currentViewCount}`);
//               // Update view count in MongoDB
//               // Increment view count in MongoDB  
//               await News.updateOne({ _id: id }, { $inc: { viewCount: inc } });
//                 // await News.findByIdAndUpdate(id, { $inc: { viewCount: inc } });

//               console.log(`Flushed ${inc} views to MongoDB for ${model} ${id}`);
//             } catch (err) {
//               console.error(`MongoDB update error for ${model} ${id}:`, err);
//             }
  
//             // Clear Redis key
//             redisClient.del(key, (err) => {
//               if (err) console.error(`Error deleting key ${key}:`, err);
//             });
//           } else {
//             console.warn(`Unknown model "${model}" for key ${key}`);
//           }
//         });
//       });
//     });
// });

// app.listen(3001, () => {
//   console.log('ViewCounter API running on http://localhost:3000');
// });

const express = require('express');
const bodyParser = require('body-parser');
const redis = require('redis');
const mongoose = require('mongoose');
const cron = require('node-cron');

const ObjectId = mongoose.Types.ObjectId;

const app = express();
app.use(bodyParser.json());

const redisClient = redis.createClient();

redisClient.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

redisClient.on('ready', () => {
  console.log('✅ Redis client ready');
});
// redisClient.connect();


// mongoose.connect('mongodb://localhost:27017/ats');

//     const schema = new mongoose.Schema({
//         viewCount: { type: Number, default: 0 }
//       }, { collection: 'News' }); // 👈 match your real MongoDB collection name
      
//       const News = mongoose.model('News', schema);

//  async function main() {
//     mongoose.connect('mongodb://localhost:27017/ats');

//     const schema = new mongoose.Schema({
//         viewCount: { type: Number, default: 0 }
//       }, { collection: 'News' }); // 👈 match your real MongoDB collection name
      
//       const News = mongoose.model('News', schema);

//   // find first News sync 
// const news = await News.findById('66bf4663711e4e8c6876f616');
// console.log('First News:', news);
// }

// main().catch(err => console.log('MongoDB connection error:', err));




// // API to receive view count
// app.post('/abcx', async (req, res) => {
//   const { model, id } = req.body;
//   console.log('Received view count:', model, id);
//   if (!model || !id) return res.status(400).send('Missing model or id');
//   await redisClient.incr(`viewcount:${model}:${id}`);
//   res.sendStatus(200);
// });

// // Cron job to flush view counts from Redis to MongoDB every minute
// cron.schedule('* * * * *', async () => {
//     console.log('Flushing view counts from Redis to MongoDB...');

//     redisClient.keys('viewcount:*', (err, keys) => {
//       if (err) {
//         console.error('Error fetching keys from Redis:', err);
//         return;
//       }
  
//       if (!keys || keys.length === 0) {
//         console.log('No view counts to flush.');
//         return;
//       }
  
//       console.log(`Found ${keys.length} keys to flush.`, keys);
  
//       keys.forEach((key) => {
//         redisClient.get(key, async (err, count) => {
//           if (err) {
//             console.error(`Error getting value for ${key}:`, err);
//             return;
//           }
  
//           const [, model, id] = key.split(':');
//           const inc = parseInt(count || '0', 10);
  
//           if (!inc || !id || !model) {
//             console.warn(`Invalid key or count: ${key} = ${count}`);
//             return;
//           }
  
//           if (model === 'News') {
//             try {
//               // debug get current view count
//                 // const news = await News.findById(id);
//                 // if (!news) {
//                 //   console.warn(`News item not found for id ${id}`);
//                 //   return;
//                 // }
//                 // const currentViewCount = news.viewCount || 0;
//                 // console.log(`Current view count for News ${id}: ${currentViewCount}`);
//               // Update view count in MongoDB
//               // Increment view count in MongoDB  
//               await News.updateOne({ _id: id }, { $inc: { viewCount: inc } });
//                 // await News.findByIdAndUpdate(id, { $inc: { viewCount: inc } });

//               console.log(`Flushed ${inc} views to MongoDB for ${model} ${id}`);
//             } catch (err) {
//               console.error(`MongoDB update error for ${model} ${id}:`, err);
//             }
  
//             // Clear Redis key
//             redisClient.del(key, (err) => {
//               if (err) console.error(`Error deleting key ${key}:`, err);
//             });
//           } else {
//             console.warn(`Unknown model "${model}" for key ${key}`);
//           }
//         });
//       });
//     });
// });

// app.listen(3001, () => {
//   console.log('ViewCounter API running on http://localhost:3000');
// });


const dataSources = {
  'vb': 'vb',
  'ats': 'ats', 
  'amor': 'amor',
  'edutrain': 'edutrain',
  'tl': 'tl',
  'danhhien': 'danhhien-test',
  'pl': 'pl',
  'mangline': 'mangline'
};

const modelMappings = {
  'vb': {
    'tin-tuc': 'News',
    'bai-viet': 'Post'
  },
  'ats': {
    'News': 'News',
    'Posts': 'Post'
  },
  'amor': {
    'tin-tuc': 'News',
    'cau-chuyen': 'Story'
  },
  'edutrain': {
    'khoa-hoc': 'Course',
    'bai-hoc': 'Lesson'
  },
  'tl': {
    'News': 'News'
  },
  'danhhien': {
    'tin-tuc': 'News'  
  },
  'pl': {
    'san-pham': 'Product',
    'tin-tuc': 'News'
  },
};

// Connection caching
const connectionMap = {};
const mongoConnections = new Map();
const modelCache = new Map();

function resolveCollectionName(tenantName, modelName, explicitCollection) {
  // Nếu có explicit collection thì dùng luôn
  if (explicitCollection) {
    console.log(`🔧 ${tenantName}: Using explicit collection: ${modelName} -> ${explicitCollection}`);
    return explicitCollection;
  }
  
  // Kiểm tra mapping cho tenant
  const tenantMappings = modelMappings[tenantName];
  if (tenantMappings && tenantMappings[modelName]) {
    console.log(`🔧 ${tenantName}: Mapped collection: ${modelName} -> ${tenantMappings[modelName]}`);
    return tenantMappings[modelName];
  }
  
  // Fallback về model name
  console.log(`🔧 ${tenantName}: Fallback collection: ${modelName} -> ${modelName}`);
  return modelName;
}


// 🔥 STRICT tenant extraction
function extractTenant(req, res, next) {
  const hostname = req.hostname || req.headers.host?.split(':')[0];
  
  if (!hostname) {
    return res.status(400).json({ error: 'Missing hostname' });
  }
  
  const tenantName = hostname.split('.')[0];
  
  // 🛡️ STRICT validation - chỉ cho phép tenants đã định nghĩa
  if (!dataSources[tenantName]) {
    console.error(`🚨 SECURITY: Unknown tenant attempted: ${tenantName} from ${hostname}`);
    return res.status(403).json({ 
      error: `Access denied for tenant: ${tenantName}`,
      allowed_tenants: Object.keys(dataSources)
    });
  }
  
  req.tenantName = tenantName;
  req.databaseName = dataSources[tenantName];
  
  console.log(`✅ Tenant validated: ${tenantName} -> ${req.databaseName}`);
  next();
}

// Get connection với tenant isolation
async function getConnection(tenantName, databaseName) {
  const cacheKey = `${process.pid}:${tenantName}`;
  
  if (connectionMap[cacheKey] && mongoConnections.has(tenantName)) {
    return mongoConnections.get(tenantName);
  }
  
  // 🔥 STRICT: Chỉ connect đến database được phép
  const connectionString = `mongodb://localhost:27017/${databaseName}`;
  const connection = mongoose.createConnection(connectionString, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000
  });
  
  mongoConnections.set(tenantName, connection);
  connectionMap[cacheKey] = tenantName;
  
  console.log(`🔗 Connected: ${tenantName} -> ${databaseName}`);
  return connection;
}

// Get model với tenant isolation
async function getModel(tenantName, databaseName, modelName, collectionName = modelName) {
  const modelKey = `${tenantName}:${modelName}:${collectionName}`;
  
  if (modelCache.has(modelKey)) {
    return modelCache.get(modelKey);
  }
  
  const connection = await getConnection(tenantName, databaseName);
  const schema = new mongoose.Schema({
    viewCount: { type: Number, default: 0 }
  }, { collection: collectionName });
  
  // 🔥 Unique model name để tránh conflict
  const uniqueModelName = `${tenantName}_${modelName}_${Date.now()}`;
  const Model = connection.model(uniqueModelName, schema);
  modelCache.set(modelKey, Model);
  
  return Model;
}

app.use(extractTenant);

// 🔥 API với STRICT tenant validation
app.post('/abcx', async (req, res) => {
  const { model, id, collection } = req.body;
  
  if (!model || !id) {
    return res.status(400).json({ error: 'Missing model or id' });
  }
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid ObjectId' });
  }
  
  try {

    const resolvedCollection = resolveCollectionName(req.tenantName, model, collection);

    // 🛡️ Redis key MUST include tenant - không có backward compatibility
    const redisKey = `viewcount:${req.tenantName}:${model}:${resolvedCollection}:${id}`;
     const newCount = await new Promise((resolve, reject) => {
      redisClient.incr(redisKey, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    console.log(`📊 ${req.tenantName}: ${model} -> ${resolvedCollection}:${id} view counted (total: ${newCount})`);
    
    
    
    res.json({ 
      success: true, 
      tenant: req.tenantName,
      database: req.databaseName,
      model: model,
      collection: resolvedCollection,
      redis_key: redisKey,
      current_count: newCount
    });
  } catch (error) {
    console.error('❌ Redis error:', error);
    res.status(500).json({ error: 'Redis error' });
  }
});

// Processing lock
let isProcessing = false;

// 🔥 ULTRA-SAFE cron job - ZERO chance of cross-tenant data
cron.schedule('* * * * *', (now) => {
  if (isProcessing) {
    console.log('⏳ Previous flush still running');
    return;
  }
  
  isProcessing = true;
  console.log('🔍 Starting cron job to flush Redis...');
  
  // 🔥 FIX: Redis v3.x dùng callback
  redisClient.keys('viewcount:*', async (err, keys) => {
    try {
      if (err) {
        console.error('❌ Error fetching keys from Redis:', err);
        return;
      }
      
      console.log(`🔍 Found ${keys?.length || 0} keys in Redis:`, keys);
      
      if (!keys || keys.length === 0) {
        console.log('✅ No view counts to flush');
        return;
      }
      
      console.log(`🔄 Processing ${keys.length} keys...`);
      
      const processedKeys = [];
      
      // Process each key sequentially
      for (const key of keys) {
        try {
          // 🔥 FIX: Redis v3.x get with callback converted to promise
          const count = await new Promise((resolve, reject) => {
            redisClient.get(key, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          
          const keyParts = key.split(':');
          
          // 🛡️ STRICT: CHỈ accept format mới có tenant
          if (keyParts.length !== 5) {
            console.error(`🚨 INVALID KEY FORMAT: ${key}`);
            // Delete invalid key
            redisClient.del(key);
            continue;
          }
          
          const [prefix, tenantName, model, collection, id] = keyParts;
          
          if (prefix !== 'viewcount') {
            console.error(`🚨 INVALID PREFIX: ${key}`);
            continue;
          }
          
          const inc = parseInt(count || '0', 10);
          
          if (!inc || !tenantName || !model || !collection || !id) {
            console.warn(`⚠️ Invalid data: ${key} = ${count}`);
            continue;
          }
          
          // 🛡️ STRICT tenant validation
          if (!dataSources[tenantName]) {
            console.error(`🚨 SECURITY: Unknown tenant in Redis: ${tenantName}`);
            redisClient.del(key);
            continue;
          }
          
          const databaseName = dataSources[tenantName];
          const Model = await getModel(tenantName, databaseName, model, collection);
          
          const result = await Model.updateOne(
            { _id: id },
            { $inc: { viewCount: inc } }
          );
          
          if (result.matchedCount > 0) {
            console.log(`✅ ${tenantName}: +${inc} views to ${collection}:${id}`);
          } else {
            console.warn(`⚠️ ${tenantName}: Document not found ${collection}:${id}`);
          }
          
          processedKeys.push(key);
          
        } catch (err) {
          console.error(`❌ Error processing ${key}:`, err.message);
        }
      }
      
      // Batch delete processed keys
      if (processedKeys.length > 0) {
        redisClient.del(processedKeys, (err) => {
          if (err) {
            console.error('❌ Error deleting keys:', err);
          } else {
            console.log(`🎯 Deleted ${processedKeys.length} processed keys`);
          }
        });
      }
      
    } catch (error) {
      console.error('💥 Cron job error:', error);
    } finally {
      isProcessing = false;
    }
  });
});
app.listen(3001, () => {
  console.log('🛡️ SECURE Multi-tenant ViewCounter API running on http://localhost:3001');
  console.log('🏢 Authorized tenants:');
  Object.entries(dataSources).forEach(([tenant, database]) => {
    console.log(`   ✅ ${tenant}.app.com -> ${database} database`);
  });
});




