/**
 * Created by phamh_000 on 5/11/2016.
 */
(function() {
  
    'use strict';

    angular.module("com.module.medicine").controller("MedicineFormCtrl", function($scope, $state, MedicineService, medicine) {
        console.log("MedicineFormCtrl");

        console.log("This is medicine: ", medicine);
        this.medicine = medicine;

        this.formFields = MedicineService.getFormFields();
        this.formOptions = {};
        this.submit = function () {
            console.log("Updated medicine: ", this.medicine);
              MedicineService.upsert(this.medicine).then(function () {
                $state.go('^.list');
              });
            
        };
    });
})();
