/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';
    angular.module('com.module.examination')
        .run(function ($rootScope, gettextCatalog) {
            $rootScope.addMenu(gettextCatalog.getString('Examination'), 'app.examination.list', 'fa-clipboard');
        });

})();
