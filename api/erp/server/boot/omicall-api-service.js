// 'use strict';

// const axios = require('axios');
// const moment = require('moment');

// module.exports = function(app) {
    
//     console.log('[OmiCall API Service] Starting initialization...');
    
//     // OmiCall API Configuration
//     const OMICALL_CONFIG = {
//         baseURL: process.env.OMICALL_API_BASE_URL || 'https://public-v1-stg.omicall.com',
//         apiKey: process.env.OMICALL_API_KEY || 'AFAF1B0DD628DF0989F4378AD05BFB47CD92A93445BD615552841762C0813CC0',
//         tokenEndpoint: '/api/auth',
//         callCenterEndpoint: '/api/call_center/internal_phone/list',
//         agentEndpoint: '/api/agent/invite'
//     };
    
//     console.log('[OmiCall API Service] Config:', {
//         baseURL: OMICALL_CONFIG.baseURL,
//         hasApiKey: !!OMICALL_CONFIG.apiKey,
//         tokenEndpoint: OMICALL_CONFIG.tokenEndpoint,
//         callCenterEndpoint: OMICALL_CONFIG.callCenterEndpoint
//     });
    
//     // Token cache with 24h expiration
//     let tokenCache = {
//         token: null,
//         expiresAt: null
//     };
    
//     /**
//      * Get authentication token from OmiCall API
//      * According to: https://api.omicall.com/omicall-api/authentication
//      * @param {boolean} forceRefresh - Force refresh token even if cached
//      * @returns {Promise<string>} - Authentication token
//      */
//     async function getOmiCallToken(forceRefresh = false) {
//         try {
//             // Check if we have a valid cached token (23 hours to be safe)
//             if (!forceRefresh && tokenCache.token && tokenCache.expiresAt && moment().isBefore(tokenCache.expiresAt)) {
//                 console.log('[OmiCall API] Using cached token');
//                 return tokenCache.token;
//             }
            
//             console.log('[OmiCall API] Requesting new token from OmiCall API');
//             console.log('[OmiCall API] URL:', `${OMICALL_CONFIG.baseURL}${OMICALL_CONFIG.tokenEndpoint}?apiKey=${OMICALL_CONFIG.apiKey}`);
            
//             // According to documentation: GET /api/auth?apiKey=
//             const response = await axios({
//                 method: 'GET',
//                 url: `${OMICALL_CONFIG.baseURL}${OMICALL_CONFIG.tokenEndpoint}?apiKey=${OMICALL_CONFIG.apiKey}`,
//                 headers: {
//                     'Content-Type': 'application/json',
//                     'Accept': 'application/json'
//                 },
//                 timeout: 10000
//             });
            
//             console.log('[OmiCall API] Token response status:', response.status);
//             console.log('[OmiCall API] Token response data:', response.data);
            
//             if (response.data && response.data.payload && response.data.payload.access_token) {
//                 // Cache token with expiration (23 hours to be safe)
//                 tokenCache.token = response.data.payload.access_token;
//                 tokenCache.expiresAt = moment().add(23, 'hours');
                
//                 console.log('[OmiCall API] Token obtained successfully');
//                 console.log('[OmiCall API] Token type:', response.data.payload.token_type);
//                 console.log('[OmiCall API] Access type:', response.data.payload.access_type);
                
//                 return response.data.payload.access_token;
//             } else {
//                 throw new Error('Invalid token response from OmiCall API - missing access_token in payload');
//             }
            
//         } catch (error) {
//             console.error('[OmiCall API] Error getting auth token:', error.message);
//             console.error('[OmiCall API] Error details:', {
//                 status: error.response?.status,
//                 statusText: error.response?.statusText,
//                 data: error.response?.data,
//                 config: {
//                     url: error.config?.url,
//                     method: error.config?.method,
//                     headers: error.config?.headers
//                 }
//             });
            
//             // If it's a network error and we have a cached token, try to use it
//             if (tokenCache.token && tokenCache.expiresAt && moment().isBefore(tokenCache.expiresAt)) {
//                 console.log('[OmiCall API] Using cached token due to network error');
//                 return tokenCache.token;
//             }
            
//             throw error;
//         }
//     }
    
//     /**
//      * Make authenticated request to OmiCall API
//      * @param {string} method - HTTP method
//      * @param {string} path - API path
//      * @param {object} data - Request data
//      * @param {object} options - Additional options
//      * @returns {Promise<object>} - API response
//      */
//     async function makeOmiCallRequest(method, path, data = null, options = {}) {
//         try {
//             const token = await getOmiCallToken();
            
//             const requestConfig = {
//                 method: method,
//                 url: `${OMICALL_CONFIG.baseURL}${path}`,
//                 headers: {
//                     'Authorization': `Bearer ${token}`,
//                     'Content-Type': 'application/json',
//                     'Accept': 'application/json',
//                     'User-Agent': 'ERP-System/1.0'
//                 },
//                 timeout: options.timeout || 30000
//             };
            
//             if (data) {
//                 requestConfig.data = data;
//             }
            
//             if (options.params) {
//                 requestConfig.params = options.params;
//             }
            
//             console.log(`[OmiCall API] Making ${method} request to ${path}`);
            
//             const response = await axios(requestConfig);
            
//             console.log(`[OmiCall API] Request successful: ${response.status}`);
//             return response.data;
            
//         } catch (error) {
//             console.error(`[OmiCall API] Request failed: ${error.message}`);
            
//             // If it's an authentication error, try to refresh token and retry once
//             if (error.response && error.response.status === 401) {
//                 console.log('[OmiCall API] Token expired, refreshing and retrying');
//                 try {
//                     const newToken = await getOmiCallToken(true);
                    
//                     // Retry with new token
//                     const retryConfig = {
//                         method: method,
//                         url: `${OMICALL_CONFIG.baseURL}${path}`,
//                         headers: {
//                             'Authorization': `Bearer ${newToken}`,
//                             'Content-Type': 'application/json',
//                             'Accept': 'application/json',
//                             'User-Agent': 'ERP-System/1.0'
//                         },
//                         timeout: options.timeout || 30000
//                     };
                    
//                     if (data) {
//                         retryConfig.data = data;
//                     }
                    
//                     if (options.params) {
//                         retryConfig.params = options.params;
//                     }
                    
//                     const retryResponse = await axios(retryConfig);
//                     console.log(`[OmiCall API] Retry successful: ${retryResponse.status}`);
//                     return retryResponse.data;
                    
//                 } catch (retryError) {
//                     console.error('[OmiCall API] Retry failed:', retryError.message);
//                     throw retryError;
//                 }
//             }
            
//             throw error;
//         }
//     }
    
//     /**
//      * Get call center internal phone list from OmiCall
//      * @param {object} filters - Optional filters
//      * @returns {Promise<object>} - Phone list data
//      */
//     async function getCallCenterPhoneList(filters = {}) {
//         try {
//             console.log('[OmiCall API] Fetching call center internal phone list');
            
//             const response = await makeOmiCallRequest('GET', OMICALL_CONFIG.callCenterEndpoint, null, {
//                 params: filters
//             });
            
//             return {
//                 success: true,
//                 data: response,
//                 timestamp: moment().toISOString()
//             };
            
//         } catch (error) {
//             console.error('[OmiCall API] Error fetching call center phone list:', error.message);
            
//             return {
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             };
//         }
//     }
    
//     /**
//      * Create new agent in OmiCall system
//      * @param {object} agentData - Agent information
//      * @returns {Promise<object>} - Created agent data
//      */
//     async function createAgent(agentData) {
//         try {
//             console.log('[OmiCall API] Creating new agent');
            
//             const response = await makeOmiCallRequest('POST', OMICALL_CONFIG.agentEndpoint, agentData);
            
//             return {
//                 success: true,
//                 data: response,
//                 timestamp: moment().toISOString()
//             };
            
//         } catch (error) {
//             console.error('[OmiCall API] Error creating agent:', error.message);
            
//             return {
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             };
//         }
//     }
    
//     /**
//      * Get call transaction history
//      * @param {object} filters - Optional filters
//      * @returns {Promise<object>} - Call history data
//      */
//     async function getCallHistory(filters = {}) {
//         try {
//             console.log('[OmiCall API] Fetching call history');
            
//             const response = await makeOmiCallRequest('GET', '/api/call_transaction', null, {
//                 params: filters
//             });
            
//             return {
//                 success: true,
//                 data: response,
//                 timestamp: moment().toISOString()
//             };
            
//         } catch (error) {
//             console.error('[OmiCall API] Error fetching call history:', error.message);
            
//             return {
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             };
//         }
//     }
    
//     // Expose functions to app context
//     app.omicallApiService = {
//         getOmiCallToken,
//         makeOmiCallRequest,
//         getCallCenterPhoneList,
//         createAgent,
//         getCallHistory,
//         refreshToken: () => getOmiCallToken(true)
//     };
    
//     // Create custom routes for OmiCall API
//     app.use('/api/omicall', function(req, res, next) {
//         console.log('[OmiCall API] Request to:', req.method, req.path);
//         next();
//     });
    
//     // Test endpoint
//     app.get('/api/omicall/test', function(req, res) {
//         console.log('[OmiCall API] Test endpoint called');
        
//         res.json({
//             success: true,
//             message: 'OmiCall API service is working',
//             timestamp: moment().toISOString(),
//             config: {
//                 baseURL: OMICALL_CONFIG.baseURL,
//                 hasApiKey: !!OMICALL_CONFIG.apiKey,
//                 tokenEndpoint: OMICALL_CONFIG.tokenEndpoint
//             }
//         });
//     });
    
//     // Get call center phone list
//     app.get('/api/omicall/phone-list', async function(req, res) {
//         try {
//             console.log('[OmiCall API] Phone list endpoint called with query:', req.query);
            
//             const result = await getCallCenterPhoneList(req.query);
//             res.json(result);
            
//         } catch (error) {
//             console.error('[OmiCall API] Phone list endpoint error:', error);
//             res.status(500).json({
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             });
//         }
//     });
    
//     // Create agent
//     app.post('/api/omicall/create-agent', async function(req, res) {
//         try {
//             console.log('[OmiCall API] Create agent endpoint called with body:', req.body);
            
//             const result = await createAgent(req.body);
//             res.json(result);
            
//         } catch (error) {
//             console.error('[OmiCall API] Create agent endpoint error:', error);
//             res.status(500).json({
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             });
//         }
//     });
    
//     // Get call history
//     app.get('/api/omicall/call-history', async function(req, res) {
//         try {
//             console.log('[OmiCall API] Call history endpoint called with query:', req.query);
            
//             const result = await getCallHistory(req.query);
//             res.json(result);
            
//         } catch (error) {
//             console.error('[OmiCall API] Call history endpoint error:', error);
//             res.status(500).json({
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             });
//         }
//     });
    
//     // Refresh token
//     app.post('/api/omicall/refresh-token', async function(req, res) {
//         try {
//             console.log('[OmiCall API] Refresh token endpoint called');
            
//             const token = await getOmiCallToken(true);
//             res.json({
//                 success: true,
//                 token: token,
//                 message: 'OmiCall token refreshed successfully',
//                 timestamp: moment().toISOString()
//             });
            
//         } catch (error) {
//             console.error('[OmiCall API] Refresh token endpoint error:', error);
//             res.status(500).json({
//                 success: false,
//                 error: error.message,
//                 timestamp: moment().toISOString()
//             });
//         }
//     });
    
//     // Get current token info
//     app.get('/api/omicall/token-info', function(req, res) {
//         console.log('[OmiCall API] Token info endpoint called');
        
//         res.json({
//             success: true,
//             hasToken: !!tokenCache.token,
//             expiresAt: tokenCache.expiresAt ? tokenCache.expiresAt.toISOString() : null,
//             isExpired: tokenCache.expiresAt ? moment().isAfter(tokenCache.expiresAt) : true,
//             timestamp: moment().toISOString()
//         });
//     });
    
//     console.log('[OmiCall API Service] Service initialized successfully');
//     console.log('[OmiCall API Service] Available endpoints:');
//     console.log('  GET  /api/omicall/test');
//     console.log('  GET  /api/omicall/phone-list');
//     console.log('  POST /api/omicall/create-agent');
//     console.log('  GET  /api/omicall/call-history');
//     console.log('  POST /api/omicall/refresh-token');
//     console.log('  GET  /api/omicall/token-info');
// }; 