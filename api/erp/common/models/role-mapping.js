// RoleMapping.observe('after save', async function autoSetupQueue(ctx) {
//     setTimeout(async () => {
//       try {
//         const app = RoleMapping.app;
//         if (app.setupTelesaleQueue) {
//           await app.setupTelesaleQueue();
//         }
//       } catch (error) {
//         console.error('Auto queue update failed:', error);
//       }
//     }, 2000);
//   });
  
//   RoleMapping.observe('before delete', async function autoSetupQueue(ctx) {
//     setTimeout(async () => {
//       try {
//         const app = RoleMapping.app;
//         if (app.setupTelesaleQueue) {
//           await app.setupTelesaleQueue();
//         }
//       } catch (error) {
//         console.error('Auto queue update failed:', error);
//       }
//     }, 2000);
//   });


module.exports = function(RoleMapping) {
    RoleMapping.observe('after save', async function autoSetupQueue(ctx) {
        // Khi thêm/xóa role telesale
        if (ctx.data.roleId) {
          const Role = RoleMapping.app.models.Role;
          const role = await Role.findById(ctx.data.roleId);
          if (role && role.name === 'Telesale') {
            // Set leadWeight cho user khi được gán role telesale
            try {
              const User = RoleMapping.app.models.User;
              const Setting = RoleMapping.app.models.Setting;
              
              // Kiểm tra setting "Phân bổ đều"
              const evenDistributionSetting = await Setting.findOne({
                where: { key: 'leadAssignmentEvenDistribution' }
              });
              
              const isEvenDistribution = evenDistributionSetting ? evenDistributionSetting.isEnabled : true;
              
              // Cập nhật leadWeight cho user
              const updateData = {};
              if (isEvenDistribution) {
                updateData.leadWeight = 1;
              } else {
                updateData.leadWeight = 0;
              }
              
              await User.updateAll(
                { id: ctx.data.principalId },
                updateData
              );
              
              console.log(`Updated leadWeight for user ${ctx.data.principalId} to ${updateData.leadWeight} when assigned Telesale role`);
            } catch (error) {
              console.error('Error setting leadWeight for telesale role:', error);
            }
            
            setTimeout(async () => {
              try {
                const app = RoleMapping.app;
                if (app.setupTelesaleQueue) {
                  await app.setupTelesaleQueue();
                }
              } catch (error) {
                console.error('Auto queue update failed:', error);
              }
            }, 2000);
          }
        }
    });
      
    RoleMapping.observe('before delete', async function autoSetupQueue(ctx) {
    // Khi xóa role mapping
    setTimeout(async () => {
        try {
        const app = RoleMapping.app;
        if (app.setupTelesaleQueue) {
            await app.setupTelesaleQueue();
        }
        } catch (error) {
        console.error('Auto queue update failed:', error);
        }
    }, 2000);
    });
}