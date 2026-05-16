/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';
    angular.module('com.module.transaction')
        .run(function ($rootScope, gettextCatalog) {
            $rootScope.addMenu(gettextCatalog.getString('Transaction'), 'app.transaction.list', 'ion-ios-loop-strong');
        });

})();
