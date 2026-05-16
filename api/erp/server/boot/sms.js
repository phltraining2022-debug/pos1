var smsHandler = module.exports = function (app) {
};

var request = require('request');

var smsApiConfig = {
    smsHost: "http://api.esms.vn",
    smsApi: "/MainService.svc/xml/SendMultipleSMS_v3",
    apiKey: "6523795DA9E4158B93FD6F9D7B5A04",
    secretKey: "A7E406D3DE298C99C56DE6F9E915CA",
    brandNamme: "vastbit",
    smsType: 7,
    requestId: 1
}
var urlSuffix = "&ApiKey=" + smsApiConfig.apiKey
    + "&SecretKey=" + smsApiConfig.secretKey
    + "&IsUnicode=false&Brandnamme=" + smsApiConfig.brandNamme
    + "&SmsType=" + smsApiConfig.smsType
    + "&RequestID=" + smsApiConfig.requestId;

// Example result url:
// http://api.esms.vn/MainService.svc/xml/SendMultipleSMS_v3?Phone=0986998413&Content=test&ApiKey=6523795DA9E4158B93FD6F9D7B5A04&SecretKey=A7E406D3DE298C99C56DE6F9E915CA&IsUnicode=false&Brandnamme=vastbit&SmsType=7&RequestID=1

smsHandler.sendSms = function (phone, content, cb) {
    content = encodeURI(content);
    console.log("PHone number: ", phone);
    var url = smsApiConfig.smsHost + smsApiConfig.smsApi + "?Phone=" + phone + "&Content=" + content + urlSuffix;
    console.log("This is sms url: ", url);
    request(url, function (error, res, body) {
        if (error) {
            console.log("Make request sms error: ");
            cb && cb();
            return;
        }

        cb && cb(res);
    });

}
