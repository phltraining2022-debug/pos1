var moment = require('moment');
var utils = require('../../server/boot/utility');
var Q = require('q');

const slugify = require('./slugify');


module.exports = function (SysCfg) {
    var app = require('../../server/server');
    SysCfg.observe('before save', function (ctx, next) {
        var inst = ctx.instance || ctx.data;
        // Generate slug
        const slug = slugify(inst.name, {
            replacement: '-',   // Replace spaces with '-'
            lower: true         // Convert to lowercase
        });
        inst.id = (inst.parentId || inst.category) + '>' + slug;
        next();
    });
};
