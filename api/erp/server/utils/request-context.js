const { AsyncLocalStorage } = require('async_hooks');
const tenantStorage = new AsyncLocalStorage();

module.exports = {
    tenantStorage,
    // Helper để lấy store hiện tại an toàn
    getStore: () => tenantStorage.getStore(),
    // Helper để lấy datasource name hiện tại
    getCurrentDatasourceName: () => {
        const store = tenantStorage.getStore();
        return store ? store.datasourceName : 'db'; // Fallback về 'db' gốc
    }
   
};