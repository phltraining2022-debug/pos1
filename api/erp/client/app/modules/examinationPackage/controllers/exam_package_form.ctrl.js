/**
 * Created by phamh_000 on 5/11/2016.
 */
(function() {

    'use strict';

    angular.module("com.module.examinationPackage").controller("ExaminationPackageFormCtrl", function($scope, $state, ExaminationPackageService, examinationPackage) {
        console.log("ExaminationPackageFormCtrl");

        console.log("This is examinationPackage: ", examinationPackage);
        this.examinationPackage = examinationPackage;

        this.formFields = ExaminationPackageService.getFormFields();
        this.formOptions = {};
        this.submit = function () {
            console.log("Updated examinationPackage: ", this.examinationPackage);
            // LabService.upsert(this.page).then(function () {
            //     $state.go('^.list');
            // });
        };
    });
})();
