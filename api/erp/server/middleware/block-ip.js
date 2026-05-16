module.exports = function(options) {
  const blockedIps = ['::ffff:38.54.14.207', '::ffff:167.94.138.189', '::ffff:104.152.52.233',
    '::ffff:123.160.223.74', '::ffff:111.7.96.165','::ffff:123.160.223.72','::ffff:111.7.106.104'];

  return function(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    if (blockedIps.includes(ip)) {
      res.status(403).send('Forbidden');
    } else {
      next();
    }
  };
};
