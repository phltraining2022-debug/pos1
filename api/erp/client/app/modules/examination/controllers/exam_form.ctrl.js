/**
 * Created by phamh_000 on 5/11/2016.
 */
(function() {

    'use strict';

    angular.module("com.module.examination").controller("ExaminationFormCtrl", function($scope, $state, ExaminationService, examination) {
        console.log("ExaminationFormCtrl");

        console.log("This is examination: ", examination);
        this.examination = examination;

        this.formFields = ExaminationService.getFormFields();
        this.formOptions = {};
        this.submit = function () {
            console.log("Updated examination: ", this.examination);
            ExaminationService.upsert(this.examination).then(function () {
                $state.go('^.list');
            });
        };
    });
})();
