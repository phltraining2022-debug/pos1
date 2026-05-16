/**
 * Created by phamh_000 on 5/12/2016.
 */
(function () {
    'use strict';
    angular
        .module('com.module.labs')
        .controller('LabsListCtrl', function ($scope, uiGridConstants, labs) {

            $scope.dataset = [];
            console.log(labs);

            var loadData = function () {

                for (var i = 1; i < 10; i++) {
                    var newRow = {
                        'id': '1' + i,
                        'name': 'name' + i,
                        'address': '' + i,
                        'labId': '',
                        'type': '',
                        'phoneNumber': '777777777' + i,
                        'fax': '',
                        'lisenceNo': '',
                        'bankInfo': '',
                        'MST': '',
                        'website': ''

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
                        field: 'address'

                    },
                    {
                        field: 'type'

                    },
                    {
                        field: 'phoneNumber'

                    },
                    {
                        field: 'fax'

                    },
                    {
                        field: 'lisenceNo'
                    },
                    {
                        field: 'bankInfo'

                    },
                    {
                        field: 'edit',
                        enableFiltering: false,
                        width:'7%',
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

