// Audit Log Service
angular.module('karaApp').service('AuditService', ['StorageService', 
    function(StorageService) {
        var logs = [];
        
        this.log = function(action, user, description, data) {
            var logEntry = {
                id: 'LOG-' + Date.now(),
                action: action,
                user: user,
                description: description,
                data: data,
                timestamp: new Date(),
                ipAddress: null // Could be added if available
            };
            
            logs.push(logEntry);
            
            // Keep only last 1000 logs in memory
            if (logs.length > 1000) {
                logs = logs.slice(-1000);
            }
            
            this.saveLogs();
            return logEntry;
        };
        
        this.getLogs = function(filters) {
            if (logs.length === 0) {
                this.initLogs();
            }
            
            var filtered = logs;
            
            if (filters) {
                if (filters.action) {
                    filtered = filtered.filter(l => l.action === filters.action);
                }
                if (filters.user) {
                    filtered = filtered.filter(l => l.user === filters.user);
                }
                if (filters.startDate) {
                    filtered = filtered.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
                }
                if (filters.endDate) {
                    filtered = filtered.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
                }
            }
            
            return filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        };
        
        this.saveLogs = function() {
            StorageService.set('auditLogs', logs);
        };
        
        this.initLogs = function() {
            var savedLogs = StorageService.get('auditLogs');
            if (savedLogs && savedLogs.length > 0) {
                logs = savedLogs;
            } else {
                // Initialize with demo logs
                logs = this.getInitialDemoLogs();
                this.saveLogs();
            }
        };
        
        // Demo audit logs
        this.getInitialDemoLogs = function() {
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            return [
                {
                    id: 'LOG-001',
                    action: 'login',
                    user: 'admin',
                    description: 'User logged in',
                    data: { role: 'admin' },
                    timestamp: new Date(today.getTime() + 7*60*60*1000),
                    ipAddress: null
                },
                {
                    id: 'LOG-002',
                    action: 'room_checkin',
                    user: 'admin',
                    description: 'Checked in room 1',
                    data: { roomId: 1, customerName: 'Nguyễn Văn A' },
                    timestamp: new Date(today.getTime() + 8*60*60*1000),
                    ipAddress: null
                },
                {
                    id: 'LOG-003',
                    action: 'order_created',
                    user: 'admin',
                    description: 'Order created: ORD-003',
                    data: { orderId: 'ORD-003', items: 3 },
                    timestamp: new Date(today.getTime() + 8.5*60*60*1000),
                    ipAddress: null
                },
                {
                    id: 'LOG-004',
                    action: 'payment_completed',
                    user: 'admin',
                    description: 'Payment completed for bill BILL-003',
                    data: { billId: 'BILL-003', total: 448000, method: 'qr' },
                    timestamp: new Date(today.getTime() + 10*60*60*1000),
                    ipAddress: null
                },
                {
                    id: 'LOG-005',
                    action: 'discount_applied',
                    user: 'admin',
                    description: 'Discount applied to bill BILL-005',
                    data: { billId: 'BILL-005', discount: 100000, reason: 'Khách VIP' },
                    timestamp: new Date(today.getTime() - 2*24*60*60*1000 + 22*60*60*1000),
                    ipAddress: null
                },
                {
                    id: 'LOG-006',
                    action: 'stock_updated',
                    user: 'admin',
                    description: 'Updated stock for: Heineken',
                    data: { item: 'Heineken', change: -6 },
                    timestamp: new Date(today.getTime() + 10*60*60*1000),
                    ipAddress: null
                }
            ];
        };
        
        // Initialize
        this.initLogs();
    }
]);
