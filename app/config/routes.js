// Route Configuration
angular.module('karaApp').config(['$routeProvider', '$locationProvider', 
    function($routeProvider, $locationProvider) {
        $routeProvider
            .when('/login', {
                templateUrl: 'app/views/login.html',
                controller: 'LoginController',
                requireAuth: false
            })
            .when('/cashier', {
                templateUrl: 'app/views/cashier.html',
                controller: 'CashierController',
                requireAuth: true,
                requiredRoles: ['cashier', 'admin', 'manager']
            })
            .when('/customer/:roomId', {
                templateUrl: 'app/views/customer.html',
                controller: 'CustomerController',
                requireAuth: false
            })
            .when('/waiter', {
                templateUrl: 'app/views/waiter.html',
                controller: 'WaiterController',
                requireAuth: true,
                requiredRoles: ['waiter', 'admin', 'manager']
            })
            .when('/kitchen', {
                templateUrl: 'app/views/kitchen.html',
                controller: 'KitchenController',
                requireAuth: true,
                requiredRoles: ['kitchen', 'chef', 'bartender', 'admin', 'manager']
            })
            .otherwise({
                redirectTo: '/login'
            });
    }
]);
