(function () {
    /**
     * Created by loc on 09/05/2016.
     */
    'use strict';

    angular.module("loopbackApp").factory("Address", function(){
        var Address = function() {
            this.street = "";
            this.city = "";
            this.country = "";
            this.ward = "";
            this.number = "";
        }

        Address.init = function(address) {
            this.street = address.street;
            this.city = address.city;
            this.country = address.country;
            this.war = address.ward;
            this.number = address.number;
        }

        return Address;
    });
});

