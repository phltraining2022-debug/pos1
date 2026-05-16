var fs = require('fs');
var path = require('path');
var xlsxj = require("xlsx-to-json-depfix");

module.exports.readFile = function(fileName, callback){
    var filePath = path.join(__dirname, fileName);

    fs.readFile(filePath, { encoding: 'utf-8' }, callback);
};

module.exports.convertExcelToJson = function(path, output, cb){
    xlsxj({
        input: path,
        output: output
    }, cb);
};
