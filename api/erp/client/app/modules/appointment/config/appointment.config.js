/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';
    angular.module('com.module.appointment')
        .run(function ($rootScope, gettextCatalog) {
            $rootScope.addMenu(gettextCatalog.getString('Appointment'), 'app.appointment.list', 'ion-android-alarm-clock');
        });

})();
