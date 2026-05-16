'use strict';

module.exports = {
    omicall: {
        baseURL: process.env.OMICALL_API_BASE_URL || 'https://public-v1-stg.omicall.com',
        apiKey: process.env.OMICALL_API_KEY || 'AFAF1B0DD628DF0989F4378AD05BFB47CD92A93445BD615552841762C0813CC0',
        timeout: parseInt(process.env.OMICALL_API_TIMEOUT) || 30000,
        retryAttempts: parseInt(process.env.OMICALL_API_RETRY_ATTEMPTS) || 3
    },
    
    tokenCache: {
        // Cache token for 23 hours (slightly less than 24h to be safe)
        duration: 23 * 60 * 60 * 1000, // 23 hours in milliseconds
        // Force refresh if token expires in less than 1 hour
        refreshThreshold: 60 * 60 * 1000 // 1 hour in milliseconds
    }
};