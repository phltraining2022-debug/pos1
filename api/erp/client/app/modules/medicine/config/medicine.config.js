/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';
    angular.module('com.module.medicine')
        .run(function ($rootScope, gettextCatalog) {
            $rootScope.addMenu(gettextCatalog.getString('Medicine'), 'app.medicine.list', 'fa-plus-square');
        });

})();
