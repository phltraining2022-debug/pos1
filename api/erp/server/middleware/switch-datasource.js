// const connectionMap = {}; // Map to store the current database connection for each instance

// const redisClient = require('redis').createClient();
// redisClient.on('error', function(err) {
//     console.error('Redis error: ', err);
// });



// module.exports = function() {
//   return function switchDatasource(req, res, next) {
//     const app = req.app;
//     const hostname = req.hostname;
//     req.app.hostname = hostname;
    
//     // Extract client name from hostname, assuming format is client.prod.live1.vn
//     const clientName = hostname.split('.')[0];

//     console.log('switch datasource ', clientName);
    
//     // Map client name to datasource
//     // const datasourceMapping = {
//     //   'ats': 'ats',
//     //   'amor': 'amor', 
//     //   'vb': 'vb','tl': 'tl','pl': 'pl','danhhien': 'danhhien'
//     // };

//     const datasourceName = clientName;
    
//     const datasource = app.dataSources[datasourceName];
//     if (datasource) {
//       if (connectionMap[process.pid] !== datasourceName) {
//         // Attach the appropriate datasource to all models if not already attached
//         Object.keys(app.models).forEach(function(modelName) {
//           const Model = app.models[modelName];
//           Model.attachTo(datasource);
//           Model.currentDatasource = datasourceName; // Set the current datasource name
//         });
//         connectionMap[process.pid] = datasourceName; // Update the connection map
//         console.log(`Process ... ${process.pid} switched to datasource: ${datasourceName}`);
//       }

//       if (datasource.clinic && datasource.clinic.timestamp && (new Date() - datasource.clinic.timestamp) > 1000 * 60 * 5) {
//         // If the clinic is already loaded and not older than 5 minutes, use it
//         console.log('flushing clinic from cache');
//         datasource.clinic = null;
//       } 

//       if (!datasource.clinic) {
//         redisClient.get('ds-' + datasourceName, function(err, data) {
          
//           if (data) {
//             const clinic = JSON.parse(data);
//             datasource.clinic = clinic;
//             clinic.timestamp = new Date(); 
//             console.log('Clinic loaded from Redis:', clinic);
//             next();
//           } else {
//             console.log('No active clinics found in Redis');
//             // load the cliinc into redis
//             const Clinic = app.models.Clinic;
//             if (Clinic) {
//               Clinic.findOne({ where: { isActive: true } }, function(err, clinic) {
//                 if (!err && clinic) {
//                   redisClient.set('ds-' + datasourceName, JSON.stringify(clinic));
//                   datasource.clinic = clinic;
//                   clinic.timestamp = new Date();
//                 }
//                 next();
//               });
//             } else {
//               next();
//             }
//           }
//         }
//         );
//       } else {
//         next();
//       }
//     } else {
//       next();
//     }
//   }; 
// };



const connectionMap = {}; // Lưu datasource hiện tại của mỗi process
const switchLock = {}; // Lock để tránh race condition khi switch

const redisClient = require('redis').createClient();
redisClient.on('error', function(err) {
    console.error('Redis error: ', err);
});

const LoopBackContext = require('loopback-context');

module.exports = function() {
  return function switchDatasource(req, res, next) {
    const app = req.app;
    const hostname = req.hostname;
    req.app.hostname = hostname;
    
    const clientName = hostname.split('.')[0];
    const datasourceName = clientName;
    const datasource = app.dataSources[datasourceName];

    if (datasource) {
      handleClinicCache(datasource, datasourceName, next);
    } else {
      next();
    }
  };
};

// Helper function xử lý Redis clinic cache
function handleClinicCache(datasource, datasourceName, next) {
  if (datasource.clinic && datasource.clinic.timestamp && (new Date() - datasource.clinic.timestamp) > 1000 * 60 * 5) {
    datasource.clinic = null;
  }

  if (!datasource.clinic) {
    redisClient.get('ds-' + datasourceName, function(err, data) {
      if (data) {
        try {
          const clinic = JSON.parse(data);
          datasource.clinic = clinic;
          clinic.timestamp = new Date();
        } catch(e) {
          console.error('[TENANT] Parse clinic error:', e);
        }
      }
      next();
    });
  } else {
    next();
  }
}