var moment = require('moment');
var app = require('../../server/server');
var emailHandler = require('../../server/boot/email');
var utils = require('../../server/boot/utility');
var Q = require('q');

const redisClient = require('redis').createClient();
redisClient.on('error', function(err) {
    console.error('Redis error: ', err);
});


module.exports = function (Clinic) {
    Clinic.validatesUniquenessOf('domain', { message: 'Domain đã được sử dung.' });

    Clinic.observe('before save', function (ctx, next) {
        var instance = ctx.instance || ctx.data;

        if (typeof(instance.domain) == 'string') instance.domain = instance.domain.toLowerCase();
        next();
    });

    Clinic.observe('before save', function (ctx, next) {
        if (ctx.isNewInstance) {
            var instance = ctx.instance || ctx.data;
            createClinicCode().then(function (code) {
                instance.code = code;
                next();
            }, function (error) {
                next(new Error('Can not create code for clinic'));
            });
        } else {
            next();
        }
    })
    Clinic.observe('after save', function updateRedis(ctx, next) {
        var instance = ctx.data || ctx.instance;
        redisClient.set('ds-' + instance.shortName, JSON.stringify(instance), function(err) {
            if (err) {
                console.error('Error saving clinic to Redis:', err);
            }
        });
        next();
    }
    );

    Clinic.observe('after save', function sendEmailActiveClinic(ctx, next) {
        var instance = ctx.data || ctx.instance;

        if (!ctx.isNewInstance && instance.isSendActiveEmail) {
            var User = app.models.user;
            User.findOne({
                where: {
                    clinicId: instance.id
                }
            }).then(function (u) {
                emailHandler.sendEmailWithoutTemplate(u.email, "Thông báo kích hoạt", "Clinic của bạn đã được kích hoạt.", function (res) {
                    console.log(res);
                    instance.updateAttributes({ isSendActiveEmail: false }).then(function (result) {
                        console.log("update isSendEmail success.");
                        next();
                    }, function (error) {
                        console.log(error);
                        next();
                    })
                });
            }, function (error) {
                next();
            });
        } else {
            next();
        }
    });

    Clinic.observe('after save', function initDefaultData(ctx, next) {
        var instance = ctx.instance || ctx.data;
        // if (!instance || instance.id == '') next();
        if (!instance.isInitialized && instance.isActive) {
            console.log("Init data!");
            instance.updateAttributes({
                isInitialized: true
            }, function (error, c) {
                if (!error && c) {
                    initData(instance.id);
                    next();
                } else {
                    next();
                }
            });
        } else {
            next();
        }
    });

    function initGeneralRoleInformation(permissions, clinicId) {
        return {
            created: new Date(),
            isActive: true,
            clinicId: clinicId,
            permissions: permissions
        };
    }

    function initNurse(permissions, clinicId) {
        var nurse = initGeneralRoleInformation(permissions, clinicId);
        nurse.name = "nurse";
        nurse.description = "nurse role";

        return nurse;
    }

    function initDoctor(permissions, clinicId) {
        var doctor = initGeneralRoleInformation(permissions, clinicId);
        doctor.name = "Doctor";
        doctor.description = "Doctor role";

        return doctor;
    }

    function initData(clinicId) {

        utils.initSysCfgs(clinicId);
        utils.initPatientGroup(clinicId);
        utils.initMedicineFami(clinicId);
        utils.initReportTemplate(clinicId);
        utils.initParameter(clinicId);
        utils.initSpecialization(clinicId);
        utils.initDepartment(clinicId);
        utils.initTemplate(clinicId);
        utils.initGroupService(clinicId, function (dictGroup) {
            utils.initServiceType(clinicId, dictGroup, function (dictType) {
                utils.initService(clinicId, dictGroup, dictType, function (dictService) {
                    utils.initServicePackage(clinicId, dictService, function () {
                        // utils.initGoiXetNghiemMau(clinicId, dictService, function () {

                        // });
                    });
                })
            });
        });
        utils.initMedicine();
    }

    function generateCode() {
        var text = "C";
        var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

        for (var i = 0; i < 4; i++)
            text += possible.charAt(Math.floor(Math.random() * possible.length));

        return text;
    }

    function validateCode(code) {
        var Clinic = app.models.clinic;
        var dfd = Q.defer();
        Clinic.findOne({
            where: {
                code: code
            }
        }).then(function (c) {
            if (!c) {
                dfd.resolve(true);
            } else {
                dfd.resolve(false);
            }
        }, function (error) {
            dfd.reject(error);
        })

        return dfd.promise;
    }

    function createClinicCode() {
        var dfd = Q.defer();
        var code = generateCode();
        validateCode(code).then(function (isValid) {
            if (isValid) {
                dfd.resolve(code);
            } else {
                dfd.resolve(createClinicCode());
            }
        }, function (error) {
            console.log("create clinic code error: ", error);
            dfd.reject(error);
        });
        return dfd.promise;
    }
};
