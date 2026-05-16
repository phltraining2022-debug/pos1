/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';

    angular
        .module('com.module.medicine')
        .config(function ($stateProvider) {
            $stateProvider
                .state('app.medicine', {
                    abstract: true,
                    url: '/medicine',
                    templateUrl: 'modules/medicine/views/main.html'
                })
                .state('app.medicine.list', {
                    url: '',
                    templateUrl: 'modules/medicine/views/list.html',
                    controller: 'MedicineListCtrl'
                })
                .state('app.medicine.add', {
                    url: '/add',
                    templateUrl: 'modules/medicine/views/form.html',
                    controllerAs: 'ctrl',
                    controller: "MedicineFormCtrl",
                    resolve: {
                        medicine: function () {
                            return {};
                        }
                    }

                });
        });

})();
