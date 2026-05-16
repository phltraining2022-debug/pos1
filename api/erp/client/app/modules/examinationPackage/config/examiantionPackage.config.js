/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';
    angular.module('com.module.examinationPackage')
        .run(function ($rootScope, gettextCatalog) {
            $rootScope.addMenu(gettextCatalog.getString('ExaminationPackage'), 'app.examinationPackage.list', 'fa-list-alt');
        });

})();
