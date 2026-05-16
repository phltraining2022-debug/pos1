'use strict';

module.exports = {
    cloudfone: {
        // API kết nối trang quản trị tổng đài
        adminBaseURL: process.env.CLOUDFONE_ADMIN_BASE_URL || 'https://api.cloudfone.vn/api/CloudFone',
        serviceName: process.env.CLOUDFONE_SERVICE_NAME || 'CF-PBX0001682',
        authUser: process.env.CLOUDFONE_AUTH_USER || 'ODS010748',
        authKey: process.env.CLOUDFONE_AUTH_KEY || '530156d4-6f26-400e-94b4-6119559ddd3f',
        
        // API kết nối Autocall
        autocallBaseURL: process.env.CLOUDFONE_AUTOCALL_BASE_URL || 'http://apiai.cloudfone.vn/api',
        autocallAuthUser: process.env.CLOUDFONE_AUTOCALL_AUTH_USER || 'ODS010748',
        autocallAuthKey: process.env.CLOUDFONE_AUTOCALL_AUTH_KEY || '530156d4-6f26-400e-94b4-6119559ddd3f',
        serviceCode: process.env.CLOUDFONE_SERVICE_CODE || 'CF-PBX0001682',
        
        timeout: parseInt(process.env.CLOUDFONE_API_TIMEOUT) || 30000,
        retryAttempts: parseInt(process.env.CLOUDFONE_API_RETRY_ATTEMPTS) || 3
    }
};