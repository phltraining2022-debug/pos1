/**
 * Created by phamh_000 on 5/12/2016.
 */
(function () {
    'use strict';
    angular
        .module('com.module.medicine')
        .controller('MedicineListCtrl', function ($scope, uiGridConstants) {

            $scope.dataset = [];

            var loadData = function () {

                for (var i = 1; i < 10; i++) {
                    var newRow = {
                        'id': '1' + i,
                        'name': 'name' + i,
                        'ingredients': 'ingredients' + i,
                        'isActive': 'true',
                        'isInsuranceMedicine': 'false',
                        'unit': '',
                        'createdAt': Date.now(),
                        'updateAt': ''
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
                        field: 'ingredients'

                    },
                    {
                        field: 'isActive'


                    },
                    {
                        field: 'isInsuranceMedicine'

                    },
                    {
                        field: 'unit'

                    },
                    {
                        field: 'createdAt'

                    },
                    {
                        field: 'edit',
                        width:'7%',

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

