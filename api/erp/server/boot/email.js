'use strict';

var loopback = require('loopback');
var _ = require('underscore');
var app = require('../../server/server');
var path = require('path');
var nunjucks = require('nunjucks');
var vm = require('vm');
var autoEmail = "care@doctornex.com";
var moment = require('moment');
var emailHandler = module.exports = function (app) {
};

emailHandler.EMAIL_TEMPLATES = {
    BIRTHDAY: "birthday",
    VERIFY_ACCOUNT: "Verify account",
    Insurance_New_Order: "New insurance order",
    Insurance_Company_New_Order: "Receive new insurance order",
    Lich_Tam_Soat: "Tam soat",
    Lich_Chung_Ngua: "Chung ngua",
    First_Come: "First come"
};

emailHandler.TEMPLATE_CAT = {
    Email: "email",
    Report: "report",
    Bill: "bill",
    Test: "test",
    Letter: "letter"
};

emailHandler.sendEmail = function (data, templateName, cb) {
    console.log("here 11: ", data.email);
    if (!data.email){
        cb();
        return;
    }
    var Patient = app.models.patient;
    var User = app.models.user;
    var MailTemplate = app.models.template;
    MailTemplate.findOne({
        where: {
            or: [
                {name: templateName},
                {id: templateName}
            ]
        }
    }, function (error, tpl) {
        if (error) {
            console.log(error);
            return cb();
        }

        if (!tpl) {
            console.log("Not fount " + templateName);
            return cb();
        }

	if (tpl.script) {
		data.moment = moment;
                var context = new vm.createContext(data);
                var script = new vm.Script(tpl.script);
                script.runInContext(context);
        }

        // var mailContent = _.template(tpl.content);
        // var htmlText = mailContent(data);
        var htmlText = nunjucks.renderString(tpl.content, data);
        console.log("DO send email");

        var mailData = {
            to: data.email,
            from: tpl.from || autoEmail,
            subject: tpl.subject
        };

        if (data.attachments) {
            console.log('having attachments...', data);
            mailData['attachments'] = data.attachments;
        }

        if(tpl.isHtml || /<[a-z][\s\S]*>/i.test(htmlText)){
            mailData.html = htmlText;
        } else {
            mailData.text = htmlText;
        }

        loopback.Email.send(mailData)
            .then(function (res) {
                console.log("Success: \n", res);
                if (cb) {
                    return cb(res);
                } else {
                    console.log('no cb');
                    return null;
                }
            })
            .catch(function (err) {
                console.log("There is error: ", err);
                return cb();
            });
    });
};

emailHandler.sendEmailWithoutTemplate = function(email, title, content, cb){

    var Patient = app.models.patient;
    var User = app.models.user;

    loopback.Email.send({
        to: email,
        from: autoEmail,
        subject: title,
        html: content
    })
        .then(function (res) {
            console.log("Success: \n", res);
            if (cb) {
                return cb(res);
            } else {
                return cb();
            }
        })
        .catch(function (err) {
            console.log("There is error: ", err)
            return cb();
        });
}
