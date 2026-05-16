/**
 * Created by loc on 09/05/2016.
 */

(function () {
    'use strict';
    angular.module('com.module.labs')
        .run(function ($rootScope, gettextCatalog) {
            $rootScope.addMenu(gettextCatalog.getString('Labs'), 'app.labs.list', 'fa-ambulance');
        });

})();
