'use strict'
var app = require("../server");
var request = require('request');
var _ = require('underscore');
var Q = require('q');


var kAppCode = "54E35-1E379";
var kAPIAccessKey = "oM6lA4y8ZlCbA5yLHpL1mnBgSofHYZngklI8ZfdsUPWj42uMAhI5UFjkcGg8yYiIgh4PVvsWfN7yJpri0xQU";

// For gaurun
var kGaurunAPI = "http://k2.vastbit.com/gaurun-fami/push"

// Example
// var options = {
// data: {
//     username: 'bob smith',
//         email: 'bob@example.com'
// },
// devices: ['deviceToken1', 'deviceToken2', 'deviceToken3']
// };
// client.sendMessage('Hello world', 'device token', options, function(error, response) {
//     ...
// });
// Testing device token: APA91bHBwzv5vT21ZXOLDWC06wviCSvQyAw116ya0_gRIcOI9-bFlO_fU11SvxZFhEBnpER5L4L7Q09romt15j-xwdovkEV6g1CJ_ptWykgO9719k6h7Ty3NtJBiYbsJEnsvpwQ-tlfO
// Loc device token: fe4d886ecd026d8d59291a8f61073f1e87fecf24e8d70c7c048517c0bf4add27
// End example

// End for pushwoosh


// Send notification with pushwoosh
module.exports.preparePayload = function(deviceTokens, message){
    var result = {
        devices: deviceTokens
    };

    return result;
};

module.exports.pushNotification = function(msg, options, cb){
    // client.sendMessage(msg, options, cb);
};

// End send notification with pushwoosh

// Send notification with gaurun
module.exports.prepareGaurunPayload = function(installations, message){
    var result = {
        android: {notifications: []},
        ios: {notifications: []}
    }

    var androidTokens = _.filter(installations, function(i){
        return i.osVersion.indexOf('Android') > -1;
    });

    var iosTokens = _.filter(installations, function(i){
        return i.osVersion.indexOf('Android') < 0;
    });

    result.android.notifications.push({
        token: androidTokens,
        platform: 2,
        message: message
    });

    result.ios.notifications.push({
        token: iosTokens,
        platform: 1,
        message: message
    });

    return result;
};

module.exports.sendGaurunNotifications = function(gaurunPayloads){
    var androidPayload = gaurunPayloads.android;
    var iosPayload = gaurunPayloads.ios;
    request.post({
        header: {'content-type': 'appliecation/json'},
        url: kGaurunAPI,
        body: androidPayload
    }).then(function(res){
        console.log("Send gaurun android notification success: ", res);
    }).catch(function(error){
        console.log("Send gaurun android notification error: ", error);
    });

    request.post({
        header: {'content-type': 'appliecation/json'},
        url: kGaurunAPI,
        body: iosPayload
    }).then(function(res){
        console.log("Send gaurun ios notification success: ", res);
    }).catch(function(error){
        console.log("Send gaurun ios notification error: ", error);
    });
}
// End send notification with gaurun

// Input: ids is an array of user id
module.exports.getDeviceTokenByUserIds = function(ids){
    var Installation = app.models.Installation;
    var dfd = Q.defer();

    Installation.find({
        where: {
            userId: {inq: ids}
        }
    }).then(function(installations){
        dfd.resolve(installations);
    }, function(error){
        console.log("Get installations error: ", error);
        dfd.reject(error);
    });

    return dfd.promise;
};

module.exports.sendNotifications = function(installations, msg){
    var tokens = _.map(installations, function(i){
        return i.deviceToken;
    });

    // Send with pushwoosh
    var payload = module.exports.preparePayload(tokens, msg);
    module.exports.pushNotification(msg, payload, function(error, response){
        console.log("Error: ", error);
        console.log("Response: ", response);
    });

    // send with gaurun
    var gaurunPayloads = module.exports.prepareGaurunPayload(installations, msg);
    module.exports.sendGaurunNotifications(gaurunPayloads);
};

function testing(){
    var opts = module.exports.preparePayload(["eSNkvdH791I:APA91bG1vAUtDbHuyG1PBiEtqdUiDiXzn5VxVSeE8_euXMD0o1Gf0L60EOzOBO75pHdAuOv4TWORklqqA6F7hrPbwfzY-FxAN0SL3SxJyC97iYLXXq1UgbmYnBGLSxVwf2YLYM3wSZ0z"], "HEHEHEHE");
    module.exports.pushNotification("HEHEHE", opts, function(error, response){
        console.log("Error: ", error);
        console.log("Response: ", response);
    });
}