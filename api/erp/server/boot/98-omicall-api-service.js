// 'use strict';

module.exports = function(app) {
    console.log('[OmiCall Boot] Starting OmiCall API service boot...');
    
    try {
        // require('./omicall-api-service')(app);
        require('./cloudfone-api-service')(app);
        console.log('[OmiCall Boot] OmiCall API service loaded successfully');
    } catch (error) {
        console.error('[OmiCall Boot] Error loading OmiCall API service:', error);
    }
};


// module.exports = function(app) {
//   const redisClient = require('redis').createClient();
  
//   async function setupTelesaleQueue() {
//     try {
//       const User = app.models.user;
//       const Employee = app.models.Employee;
//       const Role = app.models.Role;
//       const RoleMapping = app.models.RoleMapping;
      
//       // 1. Tìm role "telesale"
//       const telesaleRole = await Role.findOne({
//         where: { name: 'telesale' }
//       });
      
//       if (!telesaleRole) {
//         console.warn('AUTO-ASSIGN: Không tìm thấy role telesale');
//         return;
//       }
      
//       // 2. Tìm users có role telesale
//       const roleMappings = await RoleMapping.find({
//         where: { roleId: telesaleRole.id }
//       });
      
//       const userIds = roleMappings.map(rm => rm.principalId);
      
//       // 3. Tìm employees của users này
//       const employees = await Employee.find({
//         where: { userId: { inq: userIds }, isActive: true }
//       });
      
//       if (employees.length === 0) {
//         console.warn('AUTO-ASSIGN: Không tìm thấy telesale nào');
//         return;
//       }
      
//       // 4. Tạo queue với weight
//       const QUEUE_KEY = 'telesale_queue';
//       const WEIGHT_KEY = 'telesale_weights';
      
//       // Xóa queue cũ
//       redisClient.del(QUEUE_KEY);
//       redisClient.del(WEIGHT_KEY);
      
//       // Tạo queue mới
//       const queueItems = [];
//       for (const emp of employees) {
//         const user = await User.findById(emp.userId);
//         const weight = user.leadWeight || 1;
        
//         // Lưu weight
//         redisClient.hset(WEIGHT_KEY, emp.id, weight);
        
//         // Tạo queue items theo weight
//         for (let i = 0; i < weight; i++) {
//           queueItems.push(emp.id);
//         }
//       }
      
//       // Shuffle và lưu vào Redis
//       const shuffled = queueItems.sort(() => Math.random() - 0.5);
//       redisClient.rpush(QUEUE_KEY, shuffled);
      
//       console.log(`AUTO-ASSIGN: Setup queue với ${employees.length} telesales`);
      
//     } catch (error) {
//       console.error('AUTO-ASSIGN: Lỗi setup queue:', error);
//     }
//   }
  
//   app.setupTelesaleQueue = setupTelesaleQueue;
  
//   // Auto setup khi server start
//   app.on('started', async () => {
//     await setupTelesaleQueue();
//   });
// };