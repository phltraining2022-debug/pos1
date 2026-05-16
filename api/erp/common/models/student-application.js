'use strict';
var moment = require('moment');
var emailHandler = require('../../server/boot/email');
var smsHandler = require('../../server/boot/sms');
var app = require('../../server/server');
var utils = require('../../node_modules/loopback/lib/utils');
var utility = require('../../server/boot/utility');
var crypto = require('crypto');
var Q = require('q');
var _ = require('underscore');
var LoopBackContext = require('loopback-context');
const cls = require('cls-hooked');



module.exports = function (StudentApplication) {
    


   StudentApplication.observe('access', function logQuery(ctx, next) {
        var ctx_ = LoopBackContext.getCurrentContext();
        // var req = ctx.req || ctx_ && ctx_.get('http').req;
        // var xuser = req && req.currentUser;
        
        var currentLeadId = ctx_ && ctx_.get('currentLeadId');

        if (currentLeadId) {
            console.log('>>> found user', currentLeadId);
            ctx.query.where = {leadId: currentLeadId};
        } 
    

        next();
    });
};