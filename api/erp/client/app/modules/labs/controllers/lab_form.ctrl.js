(function() {
    /**
     * Created by loc on 09/05/2016.
     */
    'use strict';

    angular.module("com.module.labs").controller("LabFormCtrl", function($scope, $state, LabService, lab) {
        console.log("LabFormCtrl");

        console.log("This is lab: ", lab);
        this.lab = lab;

        this.formFields = LabService.getFormFields();
        this.formOptions = {};
        this.submit = function () {
            console.log("Updated lab: ", this.lab);
            LabService.upsert(this.lab).then(function () {
                $state.go('^.list');
            });
        };
    });
})();

