/**
 * Created by phamh_000 on 5/11/2016.
 */
(function() {
  
    'use strict';

    angular.module("com.module.appointment").controller("AppointmentFormCtrl", function($scope, $state, AppointmentService, appointment) {
        console.log("AppointmentFormCtrl");

        console.log("This is appointment: ", appointment);
        this.lab = appointment;

        this.formFields = AppointmentService.getFormFields();
        this.formOptions = {};
        this.submit = function () {
            console.log("Updated appointment: ", this.appointment);

            AppointmentService.upsert(this.appointment).then(function () {
                $state.go('^.list');
            });
        };
    });
})();
