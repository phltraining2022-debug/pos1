// Local Storage Service with offline support
angular.module('karaApp').service('StorageService', ['$window', 
    function($window) {
        this.set = function(key, value) {
            try {
                $window.localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch(e) {
                console.error('Storage error:', e);
                return false;
            }
        };
        
        this.get = function(key) {
            try {
                var item = $window.localStorage.getItem(key);
                return item ? JSON.parse(item) : null;
            } catch(e) {
                console.error('Storage error:', e);
                return null;
            }
        };
        
        this.remove = function(key) {
            try {
                $window.localStorage.removeItem(key);
                return true;
            } catch(e) {
                console.error('Storage error:', e);
                return false;
            }
        };
        
        this.clear = function() {
            try {
                $window.localStorage.clear();
                return true;
            } catch(e) {
                console.error('Storage error:', e);
                return false;
            }
        };
    }
]);
