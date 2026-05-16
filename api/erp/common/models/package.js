
var app = require('../../server/server');
var LoopBackContext = require('loopback-context');
var Q = require('q');
var utils = require('../../server/boot/utility');
module.exports = function (Package) {


    Package.observe('before save', function (ctx, next) {
        var instance = ctx.instance || ctx.data;
        validateName(instance.clinicId, instance.name, instance.id).then(function (isValid) {
            console.log("Is valid????", isValid);
            if (!isValid) {
                var err = new Error(instance.name + ' already exists');
                err.statusCode = '403';
                next(err);
            } else {
                next();
            }
        }, function (error) {
            console.log("Package: Validate name error: ", error);
            next(error);
        });
    });

    Package.observe("before save", function setDefaultValue(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        modelInstance.name = modelInstance.name.trim();
        var removedDiariticsName = utils.removeDiacritics(modelInstance.name).toLowerCase();
        modelInstance.searchKeywords = [modelInstance.name.toLowerCase(), removedDiariticsName];
        modelInstance.searchName = modelInstance.name.toLowerCase();
        modelInstance.searchWithoutDiacritics = removedDiariticsName;

        next();
    });


    function validateName(clinicId, name, instanceId) {
        var dfd = Q.defer();
        var Package = app.models.package;
        Package.findOne({
            where: {
                clinicId: clinicId,
                name: name.trim(),
                deletedById: { "exists": false }
            }
        }).then(function (result) {
            console.log("Validate name syscfg: ", result);
            if (result && result.id.toString() != instanceId) {
                dfd.resolve(false);
            } else {
                dfd.resolve(true);
            }
        }, function (error) {
            dfd.reject(error);
        });
        return dfd.promise;
    }
}
