(function () {
    'use strict';

    angular
        .module('com.module.transaction')
        .config(function ($stateProvider) {
            $stateProvider
                .state('app.transaction', {
                    abstract: true,
                    url: '/transaction',
                    templateUrl: 'modules/transaction/views/main.html'
                })
                .state('app.transaction.list', {
                    url: '',
                    templateUrl: 'modules/transaction/views/list.html',
                    controller: 'TransactionListCtrl'

                })
                .state('app.transaction.add', {
                    url: '/add',
                    templateUrl: 'modules/transaction/views/form.html',
                    controllerAs: 'ctrl',
                    controller: "TransactionFormCtrl",
                    resolve: {
                        transaction: function () {
                            return {};
                        }
                    }
                })
                .state('app.transaction.edit', {
                    url: '/:id/edit',
                    templateUrl: 'modules/transaction/views/form.html',
                    controllerAs: 'ctrl',
                    controller: function ($state, PageService, page) {
                        this.editorOptions = {
                            theme: 'monokai',
                            lineWrapping: true,
                            lineNumbers: true,
                            mode: 'markdown'
                        };
                        this.page = page;
                        this.formFields = PageService.getFormFields();
                        this.formOptions = {};
                        this.submit = function () {
                            PageService.upsert(this.page).then(function () {
                                $state.go('^.list');
                            });
                        };
                    },
                    resolve: {
                        page: function ($stateParams, PageService) {
                            return PageService.findById($stateParams.id);
                        }
                    }
                })
                .state('app.transaction.view', {
                    url: '/:id',
                    templateUrl: 'modules/transaction/views/view.html',
                    controllerAs: 'ctrl',
                    controller: function (page) {
                        this.page = page;
                    },
                    resolve: {
                        page: function ($stateParams, PageService) {
                            return PageService.findById($stateParams.id);
                        }
                    }
                })
                .state('app.transaction.delete', {
                    url: '/:id/delete',
                    template: '',
                    controllerAs: 'ctrl',
                    controller: function ($stateParams, $state, PageService) {
                        PageService.delete($stateParams.id, function () {
                            $state.go('^.list');
                        }, function () {
                            $state.go('^.list');
                        });
                    }
                });
        });

})();
