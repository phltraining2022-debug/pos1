/**
 * Created by phamh_000 on 5/12/2016.
 */
(function () {
    'use strict';
    angular
        .module('com.module.examinationPackage')
        .controller('ExaminationPackageListCtrl', function ($scope, uiGridConstants) {

            $scope.dataset = [];

            var loadData = function () {

                for (var i = 1; i < 10; i++) {
                    var newRow = {
                        'id': '',
                        'name': 'name' + i,
                        'isActive': 'true',
                        'examinations': '',
                        'description': '',
                        'isDefault': 'false',
                        'price': '',
                        'unit': '',
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
                        field: 'name'

                    },
                    {
                        field: 'isActive'
                    },
                    {
                        field: 'examinations'
                    },
                    {
                        field:'description'
                    },
                    {
                        field:'isDefault'
                    },
                    {
                        field:'price'
                    },
                    {
                        field: 'unit'
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

