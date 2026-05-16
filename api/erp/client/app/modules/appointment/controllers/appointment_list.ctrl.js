/**
 * Created by phamh_000 on 5/12/2016.
 */
(function () {
    'use strict';
    angular
        .module('com.module.appointment')
        .controller('AppointmentPackageListCtrl', function ($scope, uiGridConstants) {

            $scope.dataset = [];

            var loadData = function () {

                for (var i = 1; i < 10; i++) {
                    var newRow = {
                        'id': '',
                        'userId': 'name' + i,
                        'date': '',
                        'patientId': '',
                        'note': '',
                        'packageId': 'false',
                        'isActive': '',
                        'promoCode': '',
                        'labId':'',
                        'cameAt':'',
                        'createdAt': Date.now()

                    };

                    $scope.dataset.push(newRow)

                }
            };

            $scope.init = loadData();
            $scope.gridOptions = {
                showGridFooter: true,
                showColumnFooter: true,
                enableFiltering: true,
                columnDefs: [
                    {
                        field: 'Doctor'

                    },
                    {
                        field: 'isActive'
                    },
                    {
                        field: 'date'
                    },
                    {
                        field:'patient'
                    },
                    {
                        field:'promoCode'
                    },
                    {
                        field:'note'
                    },
                    {
                        field: 'cameAt'
                    },
                    {
                        field: 'createdAt'
                    },
                    {
                        field: 'edit',
                        width: '7%',
                        enableFiltering: false,
                        cellTemplate: '<button class="btn btn-xs btn-default" ng-click = "edit()"><i class="fa fa-pencil"></i></button> '
                    }
                ],
                data: $scope.dataset,
                onRegisterApi: function (gridApi) {
                    $scope.gridApi = gridApi;
                }
            };

        });

})();

