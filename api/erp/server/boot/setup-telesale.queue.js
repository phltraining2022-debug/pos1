module.exports = function(app) {
    console.log('🚀 Loading setup-telesale-queue.js...');
    const redisClient = require('redis').createClient();
    
    async function setupTelesaleQueue() {
      console.log('🔧 Starting setupTelesaleQueue...');
      try {
        const User = app.models.user;
        const Employee = app.models.Employee;
        const Role = app.models.Role;
        const RoleMapping = app.models.RoleMapping;
        
        console.log('📋 Models loaded successfully');
        
        // 1. Tìm role "telesale"
        console.log('🔍 Finding telesale role...');
        const telesaleRole = await Role.findOne({
          where: { name: 'Telesale' }
        });
        
        if (!telesaleRole) {
          console.warn('AUTO-ASSIGN: Không tìm thấy role telesale');
          return;
        }
        console.log('✅ Found telesale role:', telesaleRole.id);
        
        // 2. Tìm users có role telesale
        console.log('🔍 Finding role mappings...');
        const roleMappings = await RoleMapping.find({
          where: { roleId: telesaleRole.id }
        });
        
        console.log('📊 Found role mappings:', roleMappings.length);
        const userIds = roleMappings.map(rm => rm.principalId);
        console.log('👥 User IDs:', userIds);
        
        // 3. Tìm employees của users này
        console.log('🔍 Finding employees...');
        const employees = await Employee.find({
          where: { userId: { inq: userIds }}
        });
        
        console.log('👷 Found employees:', employees.length);
        if (employees.length === 0) {
          console.warn('AUTO-ASSIGN: Không tìm thấy telesale nào');
          return;
        }
        
        // 4. Tạo queue với weight
        const QUEUE_KEY = 'telesale_queue';
        const WEIGHT_KEY = 'telesale_weights';
        
        // Xóa queue cũ
        redisClient.del(QUEUE_KEY);
        redisClient.del(WEIGHT_KEY);
        
        // Tạo queue mới
        const queueItems = [];
        for (const emp of employees) {
          const user = await User.findById(emp.userId);
          
          // Kiểm tra setting "Phân bổ đều"
          let weight = user.leadWeight || 1;
          try {
            const Setting = app.models.Setting;
            const evenDistributionSetting = await Setting.findOne({
              where: { key: 'leadAssignmentEvenDistribution' }
            });
            
            if (evenDistributionSetting && evenDistributionSetting.isEnabled === false) {
              // Nếu tắt "Phân bổ đều", set weight = 0
              weight = 0;
            } else {
              // Nếu bật "Phân bổ đều" hoặc không có setting, sử dụng leadWeight hoặc mặc định = 1
              weight = user.leadWeight || 1;
            }
          } catch (error) {
            console.error('Error loading even distribution setting:', error);
            // Fallback về logic cũ
            weight = user.leadWeight || 1;
          }
          

          const employeeIdString = emp.id.toString();
          // Lưu weight
          redisClient.hset(WEIGHT_KEY, employeeIdString, weight);
          
          // Tạo queue items theo weight
          for (let i = 0; i < weight; i++) {
            queueItems.push(employeeIdString);
          }
        }
        
        // Shuffle và lưu vào Redis
        const shuffled = queueItems.sort(() => Math.random() - 0.5);
        redisClient.rpush(QUEUE_KEY, shuffled);
        
        console.log(`AUTO-ASSIGN: Setup queue với ${employees.length} telesales`);
        
      } catch (error) {
        console.error('AUTO-ASSIGN: Lỗi setup queue:', error);
      }
    }
    
    app.setupTelesaleQueue = setupTelesaleQueue;
    
    // Auto setup khi server start
    app.on('started', async () => {
      console.log('🎯 Server started, auto-setting up telesale queue...');
      await setupTelesaleQueue();
    });
  };