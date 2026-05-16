var moment = require('moment');
module.exports = function(Attachment) {
    Attachment.observe('before save', function(ctx, next){
        var instance = ctx.instance || ctx.data;

        console.log(JSON.stringify(instance))

        if (instance.jpg_file && !instance.patient_dob) {
            var parts = instance.jpg_file.split('__');
            if (parts.length > 1)
                instance.patient_dob = parts[1].substring(0,10);;
        }

        if(!ctx.isNewInstance){
            instance.updatedAt = moment.utc();
            next();
            return;
        } else {

            if (ctx.isNewInstance) {
                instance.createdAt = moment.utc();
                instance.updatedAt = instance.createdAt;

                // convert pdf to images
                if (instance.path && instance.name.toLowerCase().indexOf('.pdf') != -1) {
                    var path = require('path');
                    var mime = require('mime');
                    var file = path.resolve('storage/files/' + instance.name);
                    console.log(file);
                    var exec = require('child_process').exec;
                    var cmd = 'convert -density 100 -trim "' + file + '" -quality 80 -verbose "' + file+ '_%04d.jpg"' ;
                    console.log(cmd)
                    instance.images = []
                    exec(cmd, function (error, stdout, stderr) {
                        // instance.
                        console.log('!!! Number of pages ', stdout.split('\n').length -1)
                        function pad(num, size) {
                            var s = "0000" + num;
                            return s.substr(s.length-size);
                        }
                        var no = stdout.split('\n').length - 1;
                        if (no > 0) {
                            for(var i=0; i<no;i++) {
                                instance.images.push(instance.path + '_' + pad(i, 4) + '.jpg')
                            }
                        }

                        console.log(instance.images)
                        next();
                    });
                } else {
                    next();
                }
            }
        }

    });
};
