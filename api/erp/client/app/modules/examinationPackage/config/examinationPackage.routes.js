/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';

    angular
        .module('com.module.examinationPackage')
        .config(function ($stateProvider) {
            $stateProvider
                .state('app.examinationPackage', {
                    abstract: true,
                    url: '/examinationPackage',
                    templateUrl: 'modules/examinationPackage/views/main.html'
                })
                .state('app.examinationPackage.list', {
                    url: '',
                    templateUrl: 'modules/examinationPackage/views/list.html',
                    controller: 'ExaminationListCtrl'
                })
                .state('app.examinationPackage.add', {
                    url: '/add',
                    templateUrl: 'modules/examinationPackage/views/form.html',
                    controllerAs: 'ctrl',
                    controller: "ExaminationPackageFormCtrl",
                    resolve: {
                        examinationPackage: function () {
                            return {};
                        }
                    }
                })
                .state('app.examinationPackage.edit', {
                    url: '/:id/edit',
                    templateUrl: 'modules/examinationPackage/views/form.html',
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
                .state('app.examinationPackage.view', {
                    url: '/:id',
                    templateUrl: 'modules/examinationPackage/views/view.html',
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
                .state('app.examinationPackage.delete', {
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

