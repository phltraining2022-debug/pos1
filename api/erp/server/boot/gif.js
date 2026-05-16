'use strict';

var path = require('path');
var moment = require('moment');
var exec = require('child_process').exec;

//var app = require('../server');


function merge(uimgs, fimgs, cwd) {
    if (!cwd)
        cwd = path.join(__dirname, '../', '../', 'storage' + "/files");

    var t = (new Date).getTime();
    var images = [];
    var removes = [];
    var cmd = "cd " + cwd;
    var r = "";
    var gif_cmd = "; convert -delay 200 ";
    
    for(var i=0; i < uimgs.length; i++) {
        var u = uimgs[i].replace("/api/containers/files/download/", "");
        var r = 0;

        // crop 
        var iu = "m-" + t + "l" + i + ".png";
        var ifriend;
        cmd = cmd + ";convert " + u + " -resize 100x200^ -gravity Center -crop 100x200+0+0 +repage " + iu;
        if (!fimgs) {
            cmd = cmd.replace("100x200", "200x200").replace("100x200", "200x200");
        } else {
            var f = fimgs[i].replace("/api/containers/files/download/", "");
            ifriend = "m-" + t + "r" + i + ".png";
            cmd = cmd + ";" + "convert " + f + " -resize 100x200^ -gravity Center -crop 100x200+0+0 +repage " + ifriend; 
        }

        // merge
        var frame = iu;
       images.push(frame);
        if (ifriend) {
            images.push(ifriend);
            cmd = cmd + ";convert +append " + iu + " " + ifriend + " m-" + t + i + ".png";
            frame = "m-" + t + i + ".png";
            images.push(frame);
        } 

        gif_cmd = gif_cmd + " -page +0+0 " + frame;
    }

    gif_cmd = gif_cmd + " m+" + t + ".gif";

    cmd = cmd + gif_cmd;
    console.log(cmd);
    for(var i=0;i<images.length;i++) {
        cmd = cmd + "; rm " + images[i];
    }

    exec(cmd, function(error, stdout, stderr) {
        console.log(stderr, stdout);
    });

    return "/api/containers/files/download/m+" + t + ".gif";
}

module.exports.gen = merge;

// var r = merge(["/api/containers/files/download/g1.png", "/api/containers/files/download/g2.png"], 
//               ["/api/containers/files/download/g3.png", "/api/containers/files/download/g4.png"]);


// r = merge(["/api/containers/files/download/g1.png", "/api/containers/files/download/g2.png"], 
//               null);
