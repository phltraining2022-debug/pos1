var LoopBackContext = require('loopback-context');
var utils = require('../../server/boot/utility');
var app = require('../../server/server');

module.exports = function (Company) {
    Company.validatesUniquenessOf('taxId', {message: 'Tax ID is not unique'});

    Company.observe('before save', function (ctx, next) {
        var instance = ctx.instance || ctx.data;
        instance.searchName = instance.name.toLowerCase();
        if (instance.address)
            instance.searchAddress = JSON.stringify(instance.address).replace(/{/g, '').replace(/}/g, '').toLowerCase();

        console.log(instance.searchAddress)
        next();
    });
};
