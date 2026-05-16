'use strict';

// to enable these logs set `DEBUG=boot:03-load-content` or `DEBUG=boot:*`
var log = require('debug')('boot:03-load-content');

module.exports = function (app) {

  if (app.dataSources.db.name !== 'Memory' && !process.env.INITDB) {
    return;
  }

  log('Creating categories and products');

};
