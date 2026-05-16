const app = require("../../server/server")
const async = require("async")
var moment = require('moment');

module.exports.doIndexing = function (req, res) {
    var model = req.param('model')
    console.log('model ', model)
    var Model = app.models[model];
    Model.find({where:{isLabOrder: true}}, function(err, results) {
        console.log('results ', results.length)
        for(var i=0;i<results.length;i++) {
            var r = results[i];
            if (r.labTestOrderDate) 
                r.labTestOrderDates = [r.labTestOrderDate];

            r.flagSendNotification = null;
            r.save(function(err, r){
                
            })
        }
    })

    res.send({ isSuccess: true, result: 'kk', errMsg: "" });
}
