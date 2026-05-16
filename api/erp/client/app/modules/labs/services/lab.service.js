/**
 * Created by loc on 09/05/2016.
 */

(function () {
    'use strict';
    angular
        .module('com.module.labs')
        .service('LabService', function ($state, CoreService, Labs, gettextCatalog) {
            this.getLabs = function(){
                return Labs.find().$promise;
            }
        });

})();
