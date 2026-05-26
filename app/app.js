// Main AngularJS Application Module
var APP_VERSION = '1.1.02'; // Bump this value to clear localStorage on next load

angular.module('karaApp', ['ngRoute', 'ngAnimate'])
    .run(['$rootScope', '$location', 'ApiService', 'SocketService', function($rootScope, $location, ApiService, SocketService) {
        console.log('karaApp running...');

        // Clear localStorage when app version changes, but keep auth keys so user stays logged in
        var storedVersion = localStorage.getItem('appVersion');
        if (storedVersion !== APP_VERSION) {
            console.log('🔄 App updated (' + (storedVersion || 'none') + ' → ' + APP_VERSION + '): clearing localStorage...');
            var AUTH_KEYS = [
                '$LoopBack$accessTokenId',
                '$LoopBack$tokenExpiry',
                '$LoopBack$user',
                '$LoopBack$rememberModel',
                '$LoopBack$rememberCreds',
                'userProfile',
                'currentUser'  // cần cho WebSocket subscribe khi socket connect
            ];
            // Save auth values before clearing
            var saved = {};
            AUTH_KEYS.forEach(function(k) {
                var v = localStorage.getItem(k);
                if (v !== null) saved[k] = v;
            });
            localStorage.clear();
            // Restore auth values
            Object.keys(saved).forEach(function(k) { localStorage.setItem(k, saved[k]); });
            localStorage.setItem('appVersion', APP_VERSION);
            console.log('✅ localStorage cleared (auth keys preserved)');
        }
        // Expose version to all views
        $rootScope.appVersion = APP_VERSION;        
        // Helper function to check if user has required role
        function hasRequiredRole(requiredRoles) {
            if (!requiredRoles || requiredRoles.length === 0) {
                return true; // No role requirements
            }
            
            var currentUser = ApiService.getCurrentUser();
            if (!currentUser) {
                return false;
            }
            
            // Get user roles from localStorage (stored during login)
            var userRoles = [];
            try {
                var profileData = localStorage.getItem('userProfile');
                if (profileData) {
                    var profile = JSON.parse(profileData);
                    if (profile.roles) {
                        userRoles = profile.roles.map(function(role) {
                            return role.name;
                        });
                    }
                }
            } catch (e) {
                console.warn('Error parsing user profile for roles:', e);
            }
            
            // Check if user has any of the required roles
            return requiredRoles.some(function(requiredRole) {
                return userRoles.includes(requiredRole);
            });
        }
        
        // Check authentication and authorization on route change
        $rootScope.$on('$routeChangeStart', function(event, next) {
            // Check authentication first
            if (next.requireAuth && !ApiService.getCurrentUser()) {
                // Thử restore session từ credentials đã lưu (iOS PWA mất token)
                if (localStorage.getItem('$LoopBack$rememberCreds')) {
                    event.preventDefault();
                    ApiService.restoreSession().then(function(user) {
                        console.log('[Session] Auto re-login OK:', user.username);
                        // Tiếp tục navigate đến route ban đầu
                        if (next.originalPath) { $location.path(next.originalPath); }
                    }).catch(function() {
                        $location.path('/login');
                    });
                    return;
                }
                event.preventDefault();
                $location.path('/login');
                return;
            }
            
            // Check role authorization
            if (next.requireAuth && next.requiredRoles && !hasRequiredRole(next.requiredRoles)) {
                event.preventDefault();
                console.warn('Access denied: User does not have required role for', next.originalPath);
                // Could redirect to an access denied page or back to login
                $location.path('/login');
                return;
            }
        });
        
        // Detect device type
        $rootScope.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        $rootScope.isTablet = /iPad|Android/i.test(navigator.userAgent) && window.innerWidth >= 768;
        $rootScope.isLandscape = window.innerWidth > window.innerHeight;
        
        // Update orientation on resize
        window.addEventListener('resize', function() {
            $rootScope.$apply(function() {
                $rootScope.isLandscape = window.innerWidth > window.innerHeight;
            });
        });
        
        // Initialize WebSocket for real-time updates
        console.log('🔌 Initializing real-time WebSocket connection...');
        SocketService.init({
            clinicShortName: 'kara'
        });
    }]);
