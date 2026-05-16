'use strict';

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

/**
 * Refresh Zalo token nếu cần thiết
 * @param {Object} app - LoopBack app instance
 * @param {Function} callback - (err) => {}
 */
// function refreshZaloTokenIfNeeded(app, callback) {
//   const Setting = app.models.Setting;
  
//   Setting.findOne({ where: { key: 'zalo_token_expiry' } }, function(err, tokenExpiry) {
//     if (err) return callback(err);
    
//     if (tokenExpiry && tokenExpiry.val) {
//       try {
//         const expiryDate = new Date(tokenExpiry.val);
        
//         if (isNaN(expiryDate.getTime())) {
//                 console.warn('Invalid token expiry date, forcing refresh');
//             } else {
//                 const oneDayFromNow = new Date(Date.now() + 86400000);

//                 if (expiryDate > oneDayFromNow) {
//                     console.log('Token still valid, no refresh needed');
//                     return;
//                 }
//             }
//       } catch (err) {
//         console.error('Error parsing token expiry date:', err);
//       }
//     }
    
//     // Token hết hạn hoặc sắp hết hạn, cần refresh
//     Promise.all([
//       Setting.findOne({ where: { key: 'zalo_app_id' } }),
//       Setting.findOne({ where: { key: 'zalo_app_secret' } }),
//       Setting.findOne({ where: { key: 'zalo_refresh_token' } })
//     ]).then(function([appIdDoc, appSecretDoc, refreshTokenDoc]) {
//       const appId = appIdDoc?.val;
//       const appSecret = appSecretDoc?.val;
//       const refreshToken = refreshTokenDoc?.val;
      
//       if (!appId || !appSecret || !refreshToken) {
//         return callback(new Error('Zalo credentials not configured'));
//       }
      
//       axios.post('https://oauth.zaloapp.com/v4/oa/access_token', {
//         app_id: appId,
//         refresh_token: refreshToken,
//         grant_type: 'refresh_token'
//       }, {
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded',
//           'secret_key': appSecret
//         }
//       }).then(function(response) {
//         if (response.data.error) {
//           return callback(new Error(`Zalo API Error: ${response.data.error_description || response.data.error_name}`));
//         }
        
//         let expiresInSeconds = 90000;
//         if (response.data.expires_in) {
//           expiresInSeconds = parseInt(response.data.expires_in, 10);
//         }
//         if (isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
//           console.warn('Invalid expires_in from Zalo refresh, using default 90000 seconds');
//           expiresInSeconds = 90000;
//         }
        
//         const expiryTimestamp = Date.now() + (expiresInSeconds * 1000);
//         const expiryDate = new Date(expiryTimestamp);
        
//         if (isNaN(expiryDate.getTime())) {
//           return callback(new Error('Invalid expiry date calculated'));
//         }
        
//         const savePromises = [
//           Setting.upsert({ key: 'zalo_access_token', val: String(response.data.access_token) }),
//           Setting.upsert({ key: 'zalo_refresh_token', val: String(response.data.refresh_token) }),
//           Setting.upsert({ key: 'zalo_token_expiry', val: expiryDate.toISOString() })
//         ];
        
//         Promise.all(savePromises).then(function() {
//           callback(null);
//         }).catch(callback);
//       }).catch(callback);
//     }).catch(callback);
//   });
// }


async function refreshZaloTokenIfNeeded() {
    const Setting = app.models.Setting;
    const tokenExpiry = await Setting.findOne({
        where: { key: 'zalo_token_expiry' }
    });

    // Validate token expiry exists and is valid
    if (tokenExpiry && tokenExpiry.val) {
        try {
            const expiryDate = new Date(tokenExpiry.val);

            if (isNaN(expiryDate.getTime())) {
                console.warn('Invalid token expiry date, forcing refresh');
            } else {
                const oneDayFromNow = new Date(Date.now() + 86400000);

                if (expiryDate > oneDayFromNow) {
                    console.log('Token still valid, no refresh needed');
                    return;
                }
            }
        } catch (err) {
            console.error('Error parsing token expiry date:', err);
        }
    }

    // Validate required credentials
    const [appIdDoc, appSecretDoc, refreshTokenDoc] = await Promise.all([
        Setting.findOne({ where: { key: 'zalo_app_id' } }),
        Setting.findOne({ where: { key: 'zalo_app_secret' } }),
        Setting.findOne({ where: { key: 'zalo_refresh_token' } })
    ]);

    const appId = appIdDoc?.val;
    const appSecret = appSecretDoc?.val;
    const refreshToken = refreshTokenDoc?.val;

    if (!appId || !appSecret || !refreshToken) {
        throw new Error('Zalo credentials not configured properly. Missing: ' + 
            [!appId && 'app_id', !appSecret && 'app_secret', !refreshToken && 'refresh_token']
            .filter(Boolean).join(', '));
    }

    console.log('Refreshing Zalo token...');
    
    try {
        const response = await axios.post(
            'https://oauth.zaloapp.com/v4/oa/access_token', 
            {
                app_id: appId,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            }, 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'secret_key': appSecret
                },
                timeout: 10000
            }
        );

        if (response.data.error) {
            // ===== FIX: Xử lý lỗi refresh token cụ thể =====
            const errorCode = response.data.error;
            const errorMsg = response.data.error_description || response.data.error_name;
            
            console.error('Zalo refresh token error:', { errorCode, errorMsg });
            
            // Nếu refresh token hết hạn hoặc không hợp lệ, xóa token cũ
            if (errorCode === -14005 || errorCode === -216 || errorMsg?.includes('Invalid refresh token')) {
                console.warn('Refresh token invalid, clearing stored tokens...');
                
                // Xóa token cũ trong database
                await Promise.all([
                    Setting.destroyAll({ key: 'zalo_access_token' }),
                    Setting.destroyAll({ key: 'zalo_refresh_token' }),
                    Setting.destroyAll({ key: 'zalo_token_expiry' })
                ]);
                
                throw new Error('Zalo refresh token expired or invalid. Please re-authenticate via /api/zalo/setup');
            }
            
            throw new Error(`Zalo API Error: ${errorMsg}`);
        }

        // Validate response data
        if (!response.data.access_token || !response.data.refresh_token) {
            throw new Error('Invalid token refresh response from Zalo');
        }

        let expiresInSeconds = parseInt(response.data.expires_in, 10) || 90000;

        if (isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
            console.warn('Invalid expires_in from Zalo refresh, using default 90000 seconds');
            expiresInSeconds = 90000;
        }

        const expiryTimestamp = Date.now() + (expiresInSeconds * 1000);
        const expiryDate = new Date(expiryTimestamp);

        if (isNaN(expiryDate.getTime())) {
            throw new Error('Invalid expiry date calculated');
        }

        await Promise.all([
            saveZaloSetting('zalo_access_token', String(response.data.access_token)),
            saveZaloSetting('zalo_refresh_token', String(response.data.refresh_token)),
            saveZaloSetting('zalo_token_expiry', expiryDate.toISOString())
        ]);

        console.log('Zalo token refreshed successfully. Expires at:', expiryDate.toISOString());
        
    } catch (error) {
        console.error('Failed to refresh Zalo token:', error);
        throw error;
    }
}


/**
 * Upload file lên Zalo và lấy attachment_id
 * @param {Object} app - LoopBack app instance
 * @param {String} filePath - Đường dẫn file cần upload
 * @param {String} fileName - Tên file
 * @param {String} mimeType - MIME type của file
 * @param {Function} callback - (err, attachmentId) => {}
 */
async function uploadToZalo(app, filePath, fileName, mimeType, callback) {
  // Bước 1: Refresh token nếu cần
  await refreshZaloTokenIfNeeded(app, function(err) {
    if (err) {
      console.error('Error refreshing Zalo token:', err);
      return callback(err);
    }
    
    // Bước 2: Lấy access token
    const Setting = app.models.Setting;
    Setting.findOne({ where: { key: 'zalo_access_token' } }, function(err, tokenDoc) {
      if (err) return callback(err);
      
      if (!tokenDoc || typeof tokenDoc.val !== 'string') {
        return callback(new Error('Zalo access token not configured'));
      }
      
      const access_token = tokenDoc.val;
      
      // Bước 3: Đọc file
      fs.readFile(filePath, function(err, fileBuffer) {
        if (err) return callback(err);
        
        // Bước 4: Tạo FormData
        const formData = new FormData();
        formData.append('file', fileBuffer, {
          filename: fileName,
          contentType: mimeType
        });
        
        // Bước 5: Xác định endpoint
        const isImage = mimeType && mimeType.startsWith('image/');
        const uploadEndpoint = isImage 
          ? 'https://openapi.zalo.me/v2.0/oa/upload/image'
          : 'https://openapi.zalo.me/v2.0/oa/upload/file';
        
        // Bước 6: Upload lên Zalo
        axios.post(uploadEndpoint, formData, {
          headers: {
            ...formData.getHeaders(),
            'access_token': access_token
          }
        }).then(function(response) {
          // Lấy attachment_id từ response
          const attachmentId = response.data?.data?.token || response.data?.token || null;
          
          if (!attachmentId) {
            console.warn('Zalo upload response:', JSON.stringify(response.data));
            return callback(new Error('No attachment_id received from Zalo'));
          }
          
          callback(null, attachmentId);
        }).catch(function(error) {
          console.error('Error uploading to Zalo:', error);
          callback(error);
        });
      });
    });
  });
}

module.exports = {
  uploadToZalo: uploadToZalo,
  refreshZaloTokenIfNeeded: refreshZaloTokenIfNeeded
};