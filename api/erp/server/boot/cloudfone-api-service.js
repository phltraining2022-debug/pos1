'use strict';

const axios = require('axios');
const moment = require('moment');

module.exports = function(app) {
    
    console.log('[CloudFone API Service] Starting initialization...');
    
    // CloudFone API Configuration based on official documentation
    const CLOUDFONE_CONFIG = {
        // API kết nối trang quản trị tổng đài
        adminBaseURL: process.env.CLOUDFONE_ADMIN_BASE_URL || 'https://api.cloudfone.vn/api/CloudFone',
        // API kết nối Autocall
        autocallBaseURL: process.env.CLOUDFONE_AUTOCALL_BASE_URL || 'http://apiai.cloudfone.vn/api',
        
        // Authentication for Admin API
        serviceName: process.env.CLOUDFONE_SERVICE_NAME || 'CF-PBX0001682',
        authUser: process.env.CLOUDFONE_AUTH_USER || 'ODS010748',
        authKey: process.env.CLOUDFONE_AUTH_KEY || '530156d4-6f26-400e-94b4-6119559ddd3f',
        
        // Authentication for Autocall API
        autocallAuthUser: process.env.CLOUDFONE_AUTOCALL_AUTH_USER || 'ODS010748',
        autocallAuthKey: process.env.CLOUDFONE_AUTOCALL_AUTH_KEY || '530156d4-6f26-400e-94b4-6119559ddd3f',
        serviceCode: process.env.CLOUDFONE_SERVICE_CODE || 'CF-PBX0001682',
        
        timeout: parseInt(process.env.CLOUDFONE_API_TIMEOUT) || 30000,
        retryAttempts: parseInt(process.env.CLOUDFONE_API_RETRY_ATTEMPTS) || 3
    };
    
    console.log('[CloudFone API Service] Config:', {
        adminBaseURL: CLOUDFONE_CONFIG.adminBaseURL,
        autocallBaseURL: CLOUDFONE_CONFIG.autocallBaseURL,
        serviceName: CLOUDFONE_CONFIG.serviceName,
        authUser: CLOUDFONE_CONFIG.authUser,
        hasAuthKey: !!CLOUDFONE_CONFIG.authKey
    });
    
    /**
     * Make request to CloudFone Admin API
     * @param {string} endpoint - API endpoint
     * @param {object} data - Request data
     * @param {object} options - Additional options
     * @returns {Promise<object>} - API response
     */
    async function makeAdminRequest(endpoint, data = {}, options = {}) {
        try {
            // Add authentication parameters to all admin requests
            const requestData = {
                ServiceName: CLOUDFONE_CONFIG.serviceName,
                AuthUser: CLOUDFONE_CONFIG.authUser,
                AuthKey: CLOUDFONE_CONFIG.authKey,
                ...data
            };
            
            const requestConfig = {
                method: 'POST',
                url: `${CLOUDFONE_CONFIG.adminBaseURL}/${endpoint}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'ERP-System/1.0'
                },
                data: requestData,
                timeout: options.timeout || CLOUDFONE_CONFIG.timeout
            };
            
            //console.log(`[CloudFone Admin API] Making request to ${endpoint}`);
            //console.log(`[CloudFone Admin API] Request data:`, requestData);
            
            const response = await axios(requestConfig);
            
            //console.log(`[CloudFone Admin API] Response status: ${response.status}`);
            //console.log(`[CloudFone Admin API] Response data:`, response.data);
            
            return response.data;
            
        } catch (error) {
            console.error(`[CloudFone Admin API] Request failed: ${error.message}`);
            console.error(`[CloudFone Admin API] Error details:`, {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }
    
    /**
     * Make request to CloudFone Autocall API
     * @param {string} endpoint - API endpoint
     * @param {object} data - Request data
     * @param {object} options - Additional options
     * @returns {Promise<object>} - API response
     */
    async function makeAutocallRequest(endpoint, data = {}, options = {}) {
        try {
            // Add authentication parameters to all autocall requests
            const requestData = {
                ServiceCode: CLOUDFONE_CONFIG.serviceCode,
                AuthUser: CLOUDFONE_CONFIG.autocallAuthUser,
                AuthKey: CLOUDFONE_CONFIG.autocallAuthKey,
                ...data
            };
            
            const requestConfig = {
                method: 'POST',
                url: `${CLOUDFONE_CONFIG.autocallBaseURL}/${endpoint}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'ERP-System/1.0'
                },
                data: requestData,
                timeout: options.timeout || CLOUDFONE_CONFIG.timeout
            };
            
            //console.log(`[CloudFone Autocall API] Making request to ${endpoint}`);
            //console.log(`[CloudFone Autocall API] Request data:`, requestData);
            
            const response = await axios(requestConfig);
            
            //console.log(`[CloudFone Autocall API] Response status: ${response.status}`);
            //console.log(`[CloudFone Autocall API] Response data:`, response.data);
            
            return response.data;
            
        } catch (error) {
            console.error(`[CloudFone Autocall API] Request failed: ${error.message}`);
            console.error(`[CloudFone Autocall API] Error details:`, {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }
    
    // ==================== 26 API ENDPOINTS ACCORDING TO DOCUMENTATION ====================
    
    /**
     * 1. Lấy thông tin lịch sử cuộc gọi của tổng đài
     * API: GetCallHistory
     */
    async function getCallHistory(filters = {}) {
        try {
            console.log('[CloudFone API] Getting call history');
            
            const defaultFilters = {
                // TypeGet: 0, // 0: tất cả, 1: gọi đến, 2: gọi đi, 3: gọi nội bộ, 4: gợi nhở, 5: gọi nhóm
                // CallNum: '',
                // ReceiveNum: '',
                // Key: '',
            };
            
            const requestData = { ...defaultFilters, ...filters };
            const response = await makeAdminRequest('GetCallHistory', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting call history:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 2. Chức năng ClickToCall gọi cho khách hàng theo thông tin truyền vào – Not WebRTC
     * API: AutoCall
     */
    async function clickToCall(callData) {
        try {
            console.log('[CloudFone API] Creating ClickToCall');
            
            const defaultData = {
                Prefix: '0', // mặc định là 0
                Ext: '',
                PhoneName: '',
                PhoneNumber: '',
                KeySearch: '' // nếu không truyền CF tự động random key trả về
            };
            
            const requestData = { ...defaultData, ...callData };
            const response = await makeAdminRequest('AutoCall', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error creating ClickToCall:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 3. Chức năng tự động gọi cho khách hàng theo thông tin truyền vào
     * API: AutoCallV2
     */
    async function autoCallV2(callData) {
        try {
            console.log('[CloudFone API] Creating AutoCallV2');
            
            const response = await makeAdminRequest('AutoCallV2', callData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error creating AutoCallV2:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 4. Thêm chiến dịch
     * API: Autocall/StartCampaign
     */
    async function startCampaign(campaignData) {
        try {
            console.log('[CloudFone API] Starting campaign');
            
            const response = await makeAutocallRequest('Autocall/StartCampaign', campaignData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error starting campaign:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 5. Lấy danh sách chiến dịch
     * API: Autocall/GetCampaignList
     */
    async function getCampaignList(filters = {}) {
        try {
            console.log('[CloudFone API] Getting campaign list');
            
            const defaultFilters = {
                // Status: 0, // 0:đang chờ,1:đang chạy,2:đã chạy xong,3:lấy tất cả
                // PageIndex: 1,
                // PageSize: 20,
                // Key: ''
            };
            
            const requestData = { ...defaultFilters, ...filters };
            const response = await makeAutocallRequest('Autocall/GetCampaignList', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting campaign list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 6. Lấy danh sách hành động của phím bấm cấu hình mặc định
     * API: Autocall/GetListAction
     */
    async function getListAction() {
        try {
            console.log('[CloudFone API] Getting list action');
            
            const response = await makeAutocallRequest('Autocall/GetListAction', {});
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting list action:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 7. Xóa chiến dịch
     * API: Autocall/DeleteCampaign
     */
    async function deleteCampaign(campaignData) {
        try {
            console.log('[CloudFone API] Deleting campaign');
            
            const response = await makeAutocallRequest('Autocall/DeleteCampaign', campaignData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error deleting campaign:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 8. Lấy thông tin chi tiết của Chiến dịch
     * API: Autocall/GetCampaignDetail
     */
    async function getCampaignDetail(campaignData) {
        try {
            console.log('[CloudFone API] Getting campaign detail');
            
            const response = await makeAutocallRequest('Autocall/GetCampaignDetail', campaignData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting campaign detail:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 9. Lấy danh sách trunk(Mã DV) của KH
     * API: Autocall/GetTrunkList
     */
    async function getTrunkList() {
        try {
            console.log('[CloudFone API] Getting trunk list');
            
            const response = await makeAutocallRequest('Autocall/GetTrunkList', {});
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting trunk list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 10. Tạo file âm thanh từ api
     * API: Audio/CreateTTSAudio
     */
    async function createTTSAudio(audioData) {
        try {
            console.log('[CloudFone API] Creating TTS audio');
            
            const response = await makeAutocallRequest('Audio/CreateTTSAudio', audioData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error creating TTS audio:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 11. Lấy danh sách file âm thanh
     * API: Audio/GetAudioList
     */
    async function getAudioList(filters = {}) {
        try {
            console.log('[CloudFone API] Getting audio list');
            
            const defaultFilters = {
                // Key: '',
                // PageIndex: 1,
                // PageSize: 20
            };
            
            const requestData = { ...defaultFilters, ...filters };
            const response = await makeAutocallRequest('Audio/GetAudioList', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting audio list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 12. Xóa file audio
     * API: Audio/DeleteAudio
     */
    async function deleteAudio(audioData) {
        try {
            console.log('[CloudFone API] Deleting audio');
            
            const response = await makeAutocallRequest('Audio/DeleteAudio', audioData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error deleting audio:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 13. Thêm danh bạ
     * API: Contact/AddContact
     */
    async function addContact(contactData) {
        try {
            console.log('[CloudFone API] Adding contact');
            
            const response = await makeAutocallRequest('Contact/AddContact', contactData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error adding contact:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 14. Thêm nhóm danh bạ
     * API: Contact/AddContactGroup
     */
    async function addContactGroup(groupData) {
        try {
            console.log('[CloudFone API] Adding contact group');
            
            const response = await makeAutocallRequest('Contact/AddContactGroup', groupData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error adding contact group:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 15. Thêm danh bạ vào nhóm danh bạ
     * API: Contact/AddContactToGroup
     */
    async function addContactToGroup(contactGroupData) {
        try {
            console.log('[CloudFone API] Adding contact to group');
            
            const response = await makeAutocallRequest('Contact/AddContactToGroup', contactGroupData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error adding contact to group:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 16. Lấy danh sách nhóm danh bạ
     * API: Contact/GetContactGroupList
     */
    async function getContactGroupList(filters = {}) {
        try {
            console.log('[CloudFone API] Getting contact group list');
            
            const defaultFilters = {
                // Key: '',
                // PageIndex: 1,
                // PageSize: 20
            };
            
            const requestData = { ...defaultFilters, ...filters };
            const response = await makeAutocallRequest('Contact/GetContactGroupList', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting contact group list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 17. Lấy danh sách danh bạ trong nhóm danh bạ (chi tiết nhóm danh bạ)
     * API: Contact/GetContactGroupDetailList
     */
    async function getContactGroupDetailList(groupData) {
        try {
            console.log('[CloudFone API] Getting contact group detail list');
            
            const defaultFilters = {
                // Key: '',
                // PageIndex: 1,
                // PageSize: 20
            };
            
            const requestData = { ...defaultFilters, ...groupData };
            const response = await makeAutocallRequest('Contact/GetContactGroupDetailList', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting contact group detail list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 18. Lấy danh sách danh bạ
     * API: Contact/GetContactList
     */
    async function getContactList(filters = {}) {
        try {
            console.log('[CloudFone API] Getting contact list');
            
            const defaultFilters = {
                // Key: '',
                // PageIndex: 1,
                // PageSize: 20
            };
            
            const requestData = { ...defaultFilters, ...filters };
            const response = await makeAutocallRequest('Contact/GetContactList', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting contact list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 19. Xóa danh bạ
     * API: Contact/DeleteContact
     */
    async function deleteContact(contactData) {
        try {
            console.log('[CloudFone API] Deleting contact');
            
            const response = await makeAutocallRequest('Contact/DeleteContact', contactData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error deleting contact:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 20. Xóa danh bạ khỏi nhóm danh bạ
     * API: Contact/DeleteContactFromGroup
     */
    async function deleteContactFromGroup(contactGroupData) {
        try {
            console.log('[CloudFone API] Deleting contact from group');
            
            const response = await makeAutocallRequest('Contact/DeleteContactFromGroup', contactGroupData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error deleting contact from group:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 21. Lấy danh sách báo cáo kết quả chạy chiến dịch
     * API: Autocall/GetCampaignReport
     */
    async function getCampaignReport(filters = {}) {
        try {
            console.log('[CloudFone API] Getting campaign report');
            
            const defaultFilters = {
                // ReportType: 0, // 0: Tất cả,1: Gọi thành công,2: Không bắt máy, 3: KH bấm bận, 4: Người dùng chặn số, 5: Không thể kết nối đến số điện thoại
                // CampaignId: '',
                // PageIndex: 1,
                // PageSize: 20,
                // Key: ''
            };
            
            const requestData = { ...defaultFilters, ...filters };
            const response = await makeAutocallRequest('Autocall/GetCampaignReport', requestData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting campaign report:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 22. Tạo/cập nhật mẫu
     * API: CFAuthen/AddUpdateSameple
     */
    async function addUpdateSample(sampleData) {
        try {
            console.log('[CloudFone API] Adding/Updating sample');
            
            const response = await makeAutocallRequest('CFAuthen/AddUpdateSameple', sampleData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error adding/updating sample:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 23. Lấy danh sách trunk(đầu số)
     * API: CFAuthen/GetTrunkCFAList
     */
    async function getTrunkCFAList() {
        try {
            console.log('[CloudFone API] Getting trunk CFA list');
            
            const response = await makeAutocallRequest('CFAuthen/GetTrunkCFAList', {});
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error getting trunk CFA list:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 24. Bắt đầu cuộc gọi
     * API: CFAuthen/StartCallAuthenCode
     */
    async function startCallAuthenCode(callData) {
        try {
            console.log('[CloudFone API] Starting call authen code');
            
            const response = await makeAutocallRequest('CFAuthen/StartCallAuthenCode', callData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error starting call authen code:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 25. Xóa mẫu
     * API: CFAuthen/DeleteSameple
     */
    async function deleteSample(sampleData) {
        try {
            console.log('[CloudFone API] Deleting sample');
            
            const response = await makeAutocallRequest('CFAuthen/DeleteSameple', sampleData);
            
            return {
                success: true,
                data: response,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error deleting sample:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    /**
     * 26. Webhook handler (for incoming calls)
     * This is not an API call but a webhook endpoint that CloudFone will call
     */
    async function handleWebhook(webhookData) {
        try {
            console.log('[CloudFone API] Handling webhook:', webhookData);
            
            // Process webhook data
            const {
                ApiKey,
                CallNumber,
                CallName,
                ReceiptNumber,
                Key,
                KeyRinging,
                Status,
                Message
            } = webhookData;
            
            // Here you can implement your webhook logic
            // For example: save to database, trigger notifications, etc.
            
            return {
                success: true,
                message: 'Webhook processed successfully',
                data: webhookData,
                timestamp: moment().toISOString()
            };
            
        } catch (error) {
            console.error('[CloudFone API] Error handling webhook:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
    
    // Expose all 26 API functions to app context
    app.cloudfoneApiService = {
        // Core request functions
        makeAdminRequest,
        makeAutocallRequest,
        
        // 26 API endpoints according to documentation
        getCallHistory,              // 1. Lấy thông tin lịch sử cuộc gọi
        clickToCall,                 // 2. ClickToCall
        autoCallV2,                  // 3. AutoCallV2
        startCampaign,               // 4. Thêm chiến dịch
        getCampaignList,             // 5. Lấy danh sách chiến dịch
        getListAction,               // 6. Lấy hành động phím bấm mặc định
        deleteCampaign,              // 7. Xóa chiến dịch
        getCampaignDetail,           // 8. Chi tiết chiến dịch
        getTrunkList,                // 9. Danh sách trunk (Mã DV)
        createTTSAudio,              // 10. Tạo file âm thanh
        getAudioList,                // 11. Danh sách file âm thanh
        deleteAudio,                 // 12. Xóa file audio
        addContact,                  // 13. Thêm danh bạ
        addContactGroup,             // 14. Thêm nhóm danh bạ
        addContactToGroup,           // 15. Thêm danh bạ vào nhóm
        getContactGroupList,         // 16. Danh sách nhóm danh bạ
        getContactGroupDetailList,   // 17. Danh bạ trong nhóm (chi tiết)
        getContactList,              // 18. Danh sách danh bạ
        deleteContact,               // 19. Xóa danh bạ
        deleteContactFromGroup,      // 20. Xóa danh bạ khỏi nhóm
        getCampaignReport,           // 21. Báo cáo chiến dịch
        addUpdateSample,             // 22. Tạo/cập nhật mẫu
        getTrunkCFAList,             // 23. Danh sách trunk (đầu số)
        startCallAuthenCode,         // 24. Bắt đầu cuộc gọi
        deleteSample,                // 25. Xóa mẫu
        handleWebhook                // 26. Webhook handler
    };
    
    // Create custom routes for CloudFone API
    app.use('/api/cloudfone', function(req, res, next) {
        console.log('[CloudFone API] Request to:', req.method, req.path);
        next();
    });
    
    // Test endpoint
    app.get('/api/cloudfone/test', function(req, res) {
        console.log('[CloudFone API] Test endpoint called');
        
        res.json({
            success: true,
            message: 'CloudFone API service is working',
            timestamp: moment().toISOString(),
            config: {
                adminBaseURL: CLOUDFONE_CONFIG.adminBaseURL,
                autocallBaseURL: CLOUDFONE_CONFIG.autocallBaseURL,
                serviceName: CLOUDFONE_CONFIG.serviceName,
                authUser: CLOUDFONE_CONFIG.authUser,
                hasAuthKey: !!CLOUDFONE_CONFIG.authKey
            }
        });
    });
    
    // ==================== API ENDPOINTS FOR FRONTEND ====================
    
    // 1. Call History
    app.post('/api/cloudfone/call-history', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get call history endpoint called with body:', req.body);
            const result = await getCallHistory(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get call history endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 2. ClickToCall
    app.post('/api/cloudfone/click-to-call', async function(req, res) {
        try {
            //console.log('[CloudFone API] ClickToCall endpoint called with body:', req.body);
            const result = await clickToCall(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] ClickToCall endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 3. AutoCallV2
    app.post('/api/cloudfone/auto-call-v2', async function(req, res) {
        try {
            //console.log('[CloudFone API] AutoCallV2 endpoint called with body:', req.body);
            const result = await autoCallV2(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] AutoCallV2 endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 4. Campaign Management
    app.post('/api/cloudfone/campaigns/start', async function(req, res) {
        try {
            //console.log('[CloudFone API] Start campaign endpoint called with body:', req.body);
            const result = await startCampaign(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Start campaign endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/campaigns/list', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get campaign list endpoint called with body:', req.body);
            const result = await getCampaignList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get campaign list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/campaigns/delete', async function(req, res) {
        try {
            //console.log('[CloudFone API] Delete campaign endpoint called with body:', req.body);
            const result = await deleteCampaign(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Delete campaign endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/campaigns/detail', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get campaign detail endpoint called with body:', req.body);
            const result = await getCampaignDetail(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get campaign detail endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/campaigns/report', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get campaign report endpoint called with body:', req.body);
            const result = await getCampaignReport(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get campaign report endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 5. Key Actions
    app.post('/api/cloudfone/key-actions', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get key actions endpoint called with body:', req.body);
            const result = await getListAction(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get key actions endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 6. Trunk Management
    app.post('/api/cloudfone/trunks', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get trunk list endpoint called with body:', req.body);
            const result = await getTrunkList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get trunk list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/trunks/cfa', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get trunk CFA list endpoint called with body:', req.body);
            const result = await getTrunkCFAList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get trunk CFA list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 7. Audio File Management
    app.post('/api/cloudfone/audio/create', async function(req, res) {
        try {
            //console.log('[CloudFone API] Create audio endpoint called with body:', req.body);
            const result = await createTTSAudio(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Create audio endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/audio/list', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get audio list endpoint called with body:', req.body);
            const result = await getAudioList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get audio list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/audio/delete', async function(req, res) {
        try {
            //console.log('[CloudFone API] Delete audio endpoint called with body:', req.body);
            const result = await deleteAudio(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Delete audio endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 8. Contact Management
    app.post('/api/cloudfone/contacts', async function(req, res) {
        try {
            //console.log('[CloudFone API] Add contact endpoint called with body:', req.body);
            const result = await addContact(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Add contact endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/contacts/list', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get contact list endpoint called with body:', req.body);
            const result = await getContactList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get contact list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/contacts/delete', async function(req, res) {
        try {
            //console.log('[CloudFone API] Delete contact endpoint called with body:', req.body);
            const result = await deleteContact(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Delete contact endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 9. Contact Group Management
    app.post('/api/cloudfone/contact-groups', async function(req, res) {
        try {
            //console.log('[CloudFone API] Add contact group endpoint called with body:', req.body);
            const result = await addContactGroup(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Add contact group endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/contact-groups/list', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get contact group list endpoint called with body:', req.body);
            const result = await getContactGroupList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get contact group list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/contact-groups/detail', async function(req, res) {
        try {
            //console.log('[CloudFone API] Get contact group detail list endpoint called with body:', req.body);
            const result = await getContactGroupDetailList(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Get contact group detail list endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/contact-groups/add-contact', async function(req, res) {
        try {
            //console.log('[CloudFone API] Add contact to group endpoint called with body:', req.body);
            const result = await addContactToGroup(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Add contact to group endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    app.post('/api/cloudfone/contact-groups/remove-contact', async function(req, res) {
        try {
            //console.log('[CloudFone API] Remove contact from group endpoint called with body:', req.body);
            const result = await deleteContactFromGroup(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Remove contact from group endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 10. Sample Management
    app.post('/api/cloudfone/samples', async function(req, res) {
        try {
            //console.log('[CloudFone API] Add/Update sample endpoint called with body:', req.body);
            const result = await addUpdateSample(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Add/Update sample endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
   // ... existing code ...

    app.post('/api/cloudfone/samples/delete', async function(req, res) {
        try {
            //console.log('[CloudFone API] Delete sample endpoint called with body:', req.body);
            const result = await deleteSample(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Delete sample endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 11. Call Authentication
    app.post('/api/cloudfone/calls/start-authen', async function(req, res) {
        try {
            //console.log('[CloudFone API] Start call authen endpoint called with body:', req.body);
            const result = await startCallAuthenCode(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Start call authen endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // 12. Webhook endpoint for incoming calls
    app.post('/api/cloudfone/webhook', async function(req, res) {
        try {
            //console.log('[CloudFone API] Webhook endpoint called with body:', req.body);
            const result = await handleWebhook(req.body);
            res.json(result);
        } catch (error) {
            console.error('[CloudFone API] Webhook endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            });
        }
    });
    
    // console.log('[CloudFone API Service] Service initialized successfully');
    // console.log('[CloudFone API Service] Available endpoints (26 APIs according to documentation):');
    // console.log('  GET  /api/cloudfone/test');
    // console.log('  POST /api/cloudfone/call-history');
    // console.log('  POST /api/cloudfone/click-to-call');
    // console.log('  POST /api/cloudfone/auto-call-v2');
    // console.log('  POST /api/cloudfone/campaigns/start');
    // console.log('  POST /api/cloudfone/campaigns/list');
    // console.log('  POST /api/cloudfone/campaigns/delete');
    // console.log('  POST /api/cloudfone/campaigns/detail');
    // console.log('  POST /api/cloudfone/campaigns/report');
    // console.log('  POST /api/cloudfone/key-actions');
    // console.log('  POST /api/cloudfone/trunks');
    // console.log('  POST /api/cloudfone/trunks/cfa');
    // console.log('  POST /api/cloudfone/audio/create');
    // console.log('  POST /api/cloudfone/audio/list');
    // console.log('  POST /api/cloudfone/audio/delete');
    // console.log('  POST /api/cloudfone/contacts');
    // console.log('  POST /api/cloudfone/contacts/list');
    // console.log('  POST /api/cloudfone/contacts/delete');
    // console.log('  POST /api/cloudfone/contact-groups');
    // console.log('  POST /api/cloudfone/contact-groups/list');
    // console.log('  POST /api/cloudfone/contact-groups/detail');
    // console.log('  POST /api/cloudfone/contact-groups/add-contact');
    // console.log('  POST /api/cloudfone/contact-groups/remove-contact');
    // console.log('  POST /api/cloudfone/samples');
    // console.log('  POST /api/cloudfone/samples/delete');
    // console.log('  POST /api/cloudfone/calls/start-authen');
    // console.log('  POST /api/cloudfone/webhook');
    
    // console.log('[CloudFone API Service] API Documentation:');
    // console.log('  Admin API Base URL:', CLOUDFONE_CONFIG.adminBaseURL);
    // console.log('  Autocall API Base URL:', CLOUDFONE_CONFIG.autocallBaseURL);
    // console.log('  Service Name:', CLOUDFONE_CONFIG.serviceName);
    // console.log('  Auth User:', CLOUDFONE_CONFIG.authUser);
    // console.log('  Autocall Auth User:', CLOUDFONE_CONFIG.autocallAuthUser);
    // console.log('  Service Code:', CLOUDFONE_CONFIG.serviceCode);
};