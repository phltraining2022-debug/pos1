var loopback = require('loopback');

module.exports = function (ipNotification) {
    var app = require('../../server/server');
    var loopback = require('loopback');
    var _ = require('underscore');
    var path = require('path');
    var moment = require('moment');
    var Parse = require('parse/node');

    ipNotification.observe('after save', function sendNotiNewAnswerFromPatient(ctx, next) {
        var instance = ctx.instance || ctx.data;
        if (ctx.isNewInstance) {

            Parse.initialize("hat-app");
            Parse.serverURL = 'http://127.0.0.1:1338/parse';
            var Notification = Parse.Object.extend("piNotification");
            var n = new Notification();
            var User = app.models.user;
            var Role = app.models.Role;
            var roleMapping = app.models.RoleMapping;
            var targets = [];
            Role.find({
                filter: {
                    where: { clinicId: instance.clinicId }
                }
            }).then(function (roles) {
                var roleViewAppointment = _.map(roles, function (rol) {
                    if ((rol && rol['permissions'] && rol['permissions']['MedicalHistory'] && rol['permissions']['MedicalHistory']['v']) ||
                        (rol && rol['permissions']['MedicalHistory'] && (rol['permissions']['MedicalHistory']['general'] ||
                            rol['permissions']['MedicalHistory']['BoneMineralDensity'])))
                        return rol
                });
                if (roleViewAppointment && roleViewAppointment.length) {
                    var ids = _.map(roleViewAppointment, function (r) {
                        return r && r.id
                    })
                    if (ids[0] == null) {
                        next();
                        return;
                    }
                    roleMapping.find({
                        filter: {
                            where: {
                                roleId: { inq: ids }
                            }
                        }
                    }).then(function (rolmap) {
                        var userIds = _.map(rolmap, function (m) {
                            return m && m.principalId
                        });

                        if (!userIds) {
                            next();
                            return
                        }

                        targets = _.uniq(userIds)
                        n.set({ "targets": targets });
                        n.set("noti", "New Answer MedicalQuestion");
                        n.set("patientId", instance.patientId);
                        n.set("mode", instance.mode);
                        n.set("from", "Client: " + instance.client);
                        n.set("isRead", false)
                        n.save(null, {
                            success: function (_n) {
                                // Execute any logic that should take place after the object is saved.
                                console.log('New object created with objectId: ' + _n.id);
                                next();
                            },
                            error: function (_n, error) {
                                // Execute any logic that should take place if the save fails.
                                // error is a Parse.Error with an error code and message.
                                console.log('Failed to create new object, with error code: ' + error.message);
                                next();
                            }
                        });
                    })

                }
            }, function (error) {
                next();

            })

        } else {
            next();
        }
    })

};
