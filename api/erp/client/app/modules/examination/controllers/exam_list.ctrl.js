/**
 * Created by phamh_000 on 5/12/2016.
 */
(function () {
    'use strict';
    angular
        .module('com.module.examination')
        .controller('ExaminationListCtrl', function ($scope, uiGridConstants) {

            $scope.dataset = [];

            var loadData = function () {

                for (var i = 1; i < 10; i++) {
                    var newRow = {
                        'id': '1' + i,
                        'name': 'name' + i,
                        'type': '1' + i,
                        'isActive': 'true',
                        'group': 'false',
                        'unitPrice': '',
                        'numberOfExam': '01'+ i,
                        'desciption': '',
                        'normalValue':'',
                        'unit':'',
                        'totalPrice': ''
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
                        field: 'type'

                    },
                    {
                        field: 'isActive'

                    },
                    {
                        field: 'group'
                    },
                    {
                        field: 'desciption'
                    },
                    {
                        field: 'normalValue'
                    },
                    {
                        field: 'unit'
                    },
                    {
                        field: 'numberOfExam'

                    },
                    {
                        field: 'untiPrice'

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

