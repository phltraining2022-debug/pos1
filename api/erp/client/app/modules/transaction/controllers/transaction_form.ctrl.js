(function() {
    /**
     * Created by loc on 09/05/2016.
     */
    'use strict';

    angular.module("com.module.transaction").controller("TransactionFormCtrl", function($scope, $state, TransactionService, transaction) {
        console.log("TransactionFormCtrl");

        console.log("This is transaction: ", transaction);
        this.lab = transaction;

        this.formFields = TransactionService.getFormFields();
        this.formOptions = {};
        this.submit = function () {
            console.log("Updated transaction: ", this.transaction);
            // LabService.upsert(this.page).then(function () {
            //     $state.go('^.list');
            // });
        };
    });
})();

