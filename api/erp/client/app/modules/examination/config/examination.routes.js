/**
 * Created by phamh_000 on 5/11/2016.
 */
(function () {
    'use strict';

    angular
        .module('com.module.examination')
        .config(function ($stateProvider) {
            $stateProvider
                .state('app.examination', {
                    abstract: true,
                    url: '/examination',
                    templateUrl: 'modules/examination/views/main.html'
                })
                .state('app.examination.list', {
                    url: '',
                    templateUrl: 'modules/examination/views/list.html',
                    controller: 'ExaminationListCtrl'

                })
                .state('app.examination.add', {
                    url: '/add',
                    templateUrl: 'modules/examination/views/form.html',
                    controllerAs: 'ctrl',
                    controller: "ExaminationFormCtrl",
                    resolve: {
                        examination: function () {
                            return {};
                        }
                    }
                })
                .state('app.examination.edit', {
                    url: '/:id/edit',
                    templateUrl: 'modules/examination/views/form.html',
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
                .state('app.examination.view', {
                    url: '/:id',
                    templateUrl: 'modules/examination/views/view.html',
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
                .state('app.examination.delete', {
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

