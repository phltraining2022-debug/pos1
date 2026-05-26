// Sync Service for offline-first support with queue management
angular.module('karaApp').service('SyncService', ['$interval', '$q', 'StorageService', 'ApiService',
    function($interval, $q, StorageService, ApiService) {
        var syncInterval = null;
        var isOnline = navigator.onLine;
        var syncQueue = [];
        var isSyncing = false;
        var self = this;
        
        // Monitor online/offline status
        window.addEventListener('online', () => {
            isOnline = true;
            console.log('🌐 Online - starting sync');
            self.processSyncQueue();
        });
        
        window.addEventListener('offline', () => {
            isOnline = false;
            console.log('📡 Offline mode');
        });
        
        this.isOnline = function() {
            return isOnline;
        };
        
        // Cancel a pending 'create' queue entry for a local- item (called when item is deleted before sync)
        this.cancelPendingCreate = function(model, localId) {
            var before = syncQueue.length;
            syncQueue.forEach(function(q) {
                if (q.action === 'create' && q.model === model && q.localId === localId) {
                    if (q.status === 'pending') {
                        // Not yet sent — remove it entirely
                        q.status = 'cancelled';
                    } else if (q.status === 'syncing') {
                        // Already in-flight — flag it so the success handler deletes from server
                        q._deleteAfterCreate = true;
                        console.warn('⚠ Create in-flight for', model, localId, '— will delete from server after create completes');
                    }
                }
            });
            syncQueue = syncQueue.filter(function(q) { return q.status !== 'cancelled'; });
            if (syncQueue.length < before) {
                console.log('🗑 Cancelled pending create for:', model, localId);
            }
            this.saveSyncQueue();
        };

        // Add action to sync queue
        this.addToQueue = function(action, model, data, options) {
            // Guard: never queue a delete for a locally-generated ID (local- prefix)
            if (action === 'delete') {
                var itemId = data && (data.id || data._id);
                if (itemId && String(itemId).startsWith('local-')) {
                    console.warn('⚠ addToQueue: ignoring delete for local-only item:', itemId);
                    return null;
                }
            }

            // Dedup: if there's already a PENDING update for the same model+id,
            // replace its data instead of adding a new entry.
            if (action === 'update') {
                var dedupId = data && (data.id || data._id);
                if (dedupId) {
                    var dupIdx = syncQueue.findIndex(function(q) {
                        return q.action === 'update' &&
                               q.model === model &&
                               q.localId === dedupId &&
                               q.status === 'pending';
                    });
                    if (dupIdx >= 0) {
                        syncQueue[dupIdx].data = data;
                        syncQueue[dupIdx].createdAt = new Date();
                        this.saveSyncQueue();
                        console.log('🔁 [addToQueue] Dedup update for:', model, dedupId);
                        if (isOnline && !isSyncing) { this.processSyncQueue(); }
                        return syncQueue[dupIdx].id;
                    }
                }
            }

            var queueItem = {
                id: 'sync-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                action: action, // 'create', 'update', 'delete'
                model: model,
                data: data,
                options: options || {},
                status: 'pending',
                retryCount: 0,
                maxRetries: (options && options.maxRetries) || 3,
                createdAt: new Date(),
                localId: data.id || data._id
            };
            
            syncQueue.push(queueItem);
            this.saveSyncQueue();
            
            console.log('📥 Added to sync queue:', action, model, queueItem.id);
            
            // Try sync immediately if online and not already syncing
            if (isOnline && !isSyncing) {
                this.processSyncQueue();
            }
            
            return queueItem.id;
        };
        
        // Process sync queue sequentially (one by one)
        this.processSyncQueue = function() {
            if (!isOnline || isSyncing) return;
            
            var pendingItems = syncQueue.filter(item => item.status === 'pending' && item.retryCount < item.maxRetries);
            
            if (pendingItems.length === 0) {
                console.log('✓ Sync queue empty');
                return;
            }
            
            isSyncing = true;
            
            // Process first item only
            var currentItem = pendingItems[0];
            console.log('🔄 Processing sync item:', currentItem.action, currentItem.model, '(' + (syncQueue.indexOf(currentItem) + 1) + '/' + syncQueue.length + ')');
            
            // Sync current item
            this.syncItem(currentItem).then(() => {
                // Success - process next item
                console.log('✅ Item synced, processing next...');
                isSyncing = false;
                this.cleanupSyncQueue();
                
                // Process next item if any
                if (isOnline) {
                    this.processSyncQueue();
                }
            }).catch(() => {
                // Error - stop processing for now
                console.warn('⚠ Sync error, will retry later');
                isSyncing = false;
                this.saveSyncQueue();
            });
        };
        
        // Sync individual item
        this.syncItem = function(item) {
            var deferred = $q.defer();
            item.status = 'syncing';
            
            var apiCall;
            switch(item.action) {
                case 'create': {
                    // Strip client-only fields before sending to server
                    var createPayload = angular.copy(item.data);
                    delete createPayload._localOnly;
                    delete createPayload.id;   // local- ID must not be sent; server generates its own
                    delete createPayload._id;
                    apiCall = ApiService.create(item.model, createPayload);
                    break;
                }
                case 'update': {
                    // Strip client-only fields before sending to server
                    var updatePayload = angular.copy(item.data);
                    delete updatePayload._localOnly;
                    apiCall = ApiService.update(item.model, updatePayload.id || updatePayload._id, updatePayload);
                    break;
                }
                case 'delete':
                    // Skip delete for locally-generated IDs that were never persisted to the server
                    var deleteId = item.data.id || item.data._id;
                    if (deleteId && String(deleteId).startsWith('local-')) {
                        console.warn('⚠ Skipping delete for local-only item (never persisted):', deleteId);
                        item.status = 'synced';
                        item.syncedAt = new Date();
                        this.saveSyncQueue();
                        deferred.resolve(null);
                        return deferred.promise;
                    }
                    var _modelNameMap = {
                        'saleorderitems': 'SaleOrderItem',
                        'saleorders': 'SaleOrder',
                        'rooms': 'Room',
                        'invoices': 'Invoice',
                        'products': 'Product'
                    };
                    var _pascalModel = _modelNameMap[item.model] || item.model;
                    apiCall = ApiService.hardDelete(_pascalModel, null, { id: deleteId });
                    break;
                default:
                    console.error('Unknown sync action:', item.action);
                    item.status = 'error';
                    deferred.reject('Unknown action');
                    return deferred.promise;
            }
            
            apiCall.then(result => {
                item.status = 'synced';
                item.syncedAt = new Date();
                item.serverId = result.id || result._id;
                
                console.log('✅ Synced:', item.action, item.model, item.localId, '->', item.serverId);
                
                // After a successful CREATE, update localStorage to replace local- ID with real server ID.
                // This ensures subsequent deletes/updates can reach the server instead of being skipped.
                if (item.action === 'create' && item.localId && String(item.localId).startsWith('local-') && item.serverId) {
                    if (item._deleteAfterCreate) {
                        console.warn('🗑️ [syncItem CREATE] Item was marked for deletion after create _deleteAfterCreate=true');
                        console.warn('🗑️ [syncItem CREATE] Server ID:', item.serverId, 'calling DELETE to cleanup...');
                        ApiService.delete(item.model, item.serverId).then(function(result) {
                            console.log('🗑️ [syncItem CREATE] ✅ Cleanup delete SUCCESS - item removed from server:', item.serverId);
                        }).catch(function(err) {
                            console.error('🗑️ [syncItem CREATE] ❌ Cleanup delete FAILED!!', err, '— item remains on server. Will cause re-load when page refreshes!');
                        });
                        // Also remove the local- entry from localStorage if it still exists
                        var storedItems2 = StorageService.get(item.model) || [];
                        var localIdx2 = storedItems2.findIndex(function(m) { return m.id === item.localId; });
                        if (localIdx2 >= 0) {
                            storedItems2.splice(localIdx2, 1);
                            StorageService.set(item.model, storedItems2);
                            console.log('🗑️ [syncItem CREATE] Removed local- entry from localStorage:', item.localId);
                        } else {
                            console.log('🗑️ [syncItem CREATE] Local entry not found in localStorage (already deleted manually):', item.localId);
                        }
                    } else {
                        console.log('📝 [syncItem CREATE] Updating localStorage: local- ID', item.localId, '→ server ID', item.serverId);
                        var storedItems = StorageService.get(item.model) || [];
                        var localIdx = storedItems.findIndex(function(m) { return m.id === item.localId; });
                        if (localIdx >= 0) {
                            storedItems[localIdx].id = item.serverId;
                            storedItems[localIdx]._localOnly = false;
                            StorageService.set(item.model, storedItems);
                            console.log('📝 [syncItem CREATE] ✅ localStorage updated, item now has real server ID');
                        } else {
                            console.warn('📝 [syncItem CREATE] ⚠️ Could not find local- entry in localStorage. entry was already deleted?', item.localId);
                        }
                    }
                }
                
                // Callback to update local data with server ID
                if (item.options.onSuccess) {
                    item.options.onSuccess(result, item.localId);
                }
                
                this.saveSyncQueue();
                deferred.resolve(result);
            }).catch(error => {
                // --- 404 handling: resource deleted on another device ---
                // Detect Not Found from LoopBack error objects, statusText strings, etc.
                var isNotFound = error && (
                    error.statusCode === 404 ||
                    error.status === 404 ||
                    (typeof error === 'string' && (error.indexOf('404') >= 0 || error.toLowerCase().indexOf('not found') >= 0)) ||
                    (error.message && (error.message.indexOf('404') >= 0 || error.message.toLowerCase().indexOf('not found') >= 0))
                );

                if (isNotFound && (item.action === 'update' || item.action === 'delete')) {
                    console.warn('🗑️ [sync] 404 — resource gone on server, purging stale local record:', item.model, item.localId);
                    item.retryCount = item.maxRetries;
                    item.status = 'failed';
                    item.lastError = 'Not Found (404) — removed stale local record';

                    // Remove from localStorage so it won't be re-queued
                    var staleId = item.localId;
                    if (staleId && !String(staleId).startsWith('local-')) {
                        var storedRecords = StorageService.get(item.model) || [];
                        var before = storedRecords.length;
                        storedRecords = storedRecords.filter(function(r) { return r.id !== staleId && r._id !== staleId; });
                        if (storedRecords.length < before) {
                            StorageService.set(item.model, storedRecords);
                            console.warn('🗑️ [sync] Removed stale record from localStorage:', item.model, staleId);
                        }
                    }

                    // Also drop any other pending queue entries for the same record
                    syncQueue.forEach(function(q) {
                        if (q.id !== item.id && q.model === item.model && q.localId === staleId && q.status === 'pending') {
                            q.status = 'failed';
                            q.lastError = 'Superseded by 404 purge';
                        }
                    });

                    this.saveSyncQueue();
                    deferred.reject(error);
                    return;
                }

                var isLockedBillError = error && (
                    error.code === 'SALE_ORDER_LOCKED' ||
                    error.statusCode === 422 ||
                    error.status === 422 ||
                    (error.message && error.message.indexOf('Bill đã in hoặc đã khóa') >= 0)
                );

                if (isLockedBillError && item.model === 'saleorderitems') {
                    console.warn('🔒 [sync] SaleOrderItem bị chặn do bill đã khóa:', item.action, item.localId);
                    item.retryCount = item.maxRetries;
                    item.status = 'failed';
                    item.lastError = error.message || 'Bill locked';

                    var failedId = item.localId;
                    if (failedId) {
                        var storedRecordsLocked = StorageService.get(item.model) || [];
                        var beforeLocked = storedRecordsLocked.length;
                        storedRecordsLocked = storedRecordsLocked.filter(function(record) {
                            return record.id !== failedId && record._id !== failedId;
                        });
                        if (storedRecordsLocked.length < beforeLocked) {
                            StorageService.set(item.model, storedRecordsLocked);
                            console.warn('🔒 [sync] Removed locked local record from localStorage:', item.model, failedId);
                        }

                        syncQueue.forEach(function(q) {
                            if (q.id !== item.id && q.model === item.model && q.localId === failedId && q.status === 'pending') {
                                q.status = 'failed';
                                q.lastError = 'Bill locked';
                            }
                        });
                    }

                    this.saveSyncQueue();
                    deferred.reject(error);
                    return;
                }

                item.retryCount++;
                item.status = item.retryCount >= item.maxRetries ? 'failed' : 'pending';
                item.lastError = error.message || error;
                
                console.warn('❌ Sync failed:', item.action, item.model, item.retryCount + '/' + item.maxRetries, error);
                
                if (item.options.onError) {
                    item.options.onError(error, item);
                }
                
                this.saveSyncQueue();
                deferred.reject(error);
            });

            return deferred.promise;
        };
        
        // Cleanup old synced items
        this.cleanupSyncQueue = function() {
            var cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
            syncQueue = syncQueue.filter(item => {
                if (item.status === 'synced' && new Date(item.syncedAt) < cutoffDate) {
                    return false; // Remove old synced items
                }
                return true;
            });
            this.saveSyncQueue();
        };
        
        this.saveSyncQueue = function() {
            StorageService.set('syncQueue', syncQueue);
        };
        
        this.loadSyncQueue = function() {
            syncQueue = StorageService.get('syncQueue') || [];
            console.log('📋 Loaded sync queue:', syncQueue.length, 'items');
        };
        
        this.getSyncQueue = function() {
            return syncQueue;
        };
        
        this.getPendingCount = function() {
            return syncQueue.filter(item => item.status === 'pending' || item.status === 'syncing').length;
        };
        
        this.startAutoSync = function(intervalMs) {
            if (syncInterval) {
                $interval.cancel(syncInterval);
            }
            
            syncInterval = $interval(() => {
                if (isOnline) {
                    this.processSyncQueue();
                }
            }, intervalMs || 30000); // Default 30 seconds
        };
        
        this.stopAutoSync = function() {
            if (syncInterval) {
                $interval.cancel(syncInterval);
                syncInterval = null;
            }
        };
        
        this.clearSyncQueue = function() {
            syncQueue = [];
            this.saveSyncQueue();
            console.log('🗑️ Cleared sync queue');
        };
        
        // Legacy sync methods - deprecated, use queue instead
        this.syncAll = function() {
            if (!isOnline) return;
            this.processSyncQueue();
        };
        
        this.syncOrders = function() {
            // Legacy method - now handled by queue
            this.processSyncQueue();
        };
        
        this.syncBills = function() {
            // Legacy method - now handled by queue
            this.processSyncQueue();
        };
        
        this.syncAuditLogs = function() {
            // Legacy method - now handled by queue
            this.processSyncQueue();
        };
        
        // Initialize
        this.loadSyncQueue();
        this.startAutoSync();
        
        console.log('🚀 SyncService initialized - Offline-first mode');
    }
]);
