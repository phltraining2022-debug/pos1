// Authentication Service
angular.module('karaApp').service('AuthService', ['$window', 'StorageService', 
    function($window, StorageService) {
        var currentUser = null;
        
        this.login = function(username, password, role) {
            // Mock authentication - replace with real API
            if (password === '123456') {
                currentUser = {
                    id: Date.now(),
                    username: username,
                    role: role, // cashier, waiter, kitchen, admin
                    loginTime: new Date()
                };
                StorageService.set('currentUser', currentUser);
                return true;
            }
            return false;
        };
        
        this.logout = function() {
            currentUser = null;
            StorageService.remove('currentUser');
        };
        
        this.isAuthenticated = function() {
            if (!currentUser) {
                currentUser = StorageService.get('currentUser');
            }
            return currentUser !== null;
        };
        
        this.getCurrentUser = function() {
            if (!currentUser) {
                currentUser = StorageService.get('currentUser');
            }
            return currentUser;
        };
        
        this.hasRole = function(role) {
            return currentUser && currentUser.role === role;
        };
    }
]);
