/**
 * Created by phamh_000 on 5/11/2016.
 */


(function () {
    'use strict';

    angular
        .module('com.module.appointment')
        .config(function ($stateProvider) {
            $stateProvider
                .state('app.appointment', {
                    abstract: true,
                    url: '/appointment',
                    templateUrl: 'modules/appointment/views/main.html'
                })
                .state('app.appointment.list', {
                    url: '',
                    templateUrl: 'modules/appointment/views/list.html',
                    controller: 'AppointmentPackageListCtrl'
                })
                .state('app.appointment.add', {
                    url: '/add',
                    templateUrl: 'modules/appointment/views/form.html',
                    controllerAs: 'ctrl',
                    controller: "AppointmentFormCtrl",
                    resolve: {
                        appointment: function () {

                            return {};
                        }
                    }
                })
                .state('app.appointment.edit', {
                    url: '/:id/edit',
                    templateUrl: 'modules/appointment/views/form.html',
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
                .state('app.appointment.view', {
                    url: '/:id',
                    templateUrl: 'modules/appointment/views/view.html',
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
                .state('app.appointment.delete', {
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
