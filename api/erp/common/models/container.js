const os = require('os');
os.tmpDir = os.tmpdir;

const path = require('path');

module.exports = function (Container) {
  function getFilename(req, file, cb) {
    // Pass the original filename as the new filename
    cb(null, file.originalname);
  }

  // Container.create({
  //   name: 'file-container',
  //   getFilename: getFilename
  // }, function(err, container) {
  //   if (err) throw err;
  //   console.log('Container created:', container);
  // });

  Container.afterRemote('upload', function (ctx, modelInstance, next) {
    const Media = Container.app.models.Media;


    console.log('File uploaded:', ctx.result.result);
    const fileInfo = ctx.result.result.files.file[0]; // Assuming single file upload
    
    console.log('File uploaded:', fileInfo);
    // Create a new instance of Media model using the uploaded file information
    Media.create({
      filename: fileInfo.name,
      url: '/api/containers/' + fileInfo.container + '/download/' + fileInfo.name,
      type: fileInfo.type,
      description: 'Your description here', // You can set this based on your requirement
      uploadDate: new Date(), // Set the upload date
      mime: fileInfo.type.split('/')[1], // Extract mime type from content-type
      extension: fileInfo.name.split('.').pop(), // Extract file extension
      container: fileInfo.container // Set the file path
    }, function (err, mediaInstance) {
      if (err) {
        console.error('Error creating media instance:', err);
        return next(err);
      }

      console.log('Media instance created:', mediaInstance);
       if (ctx.result && ctx.result.result) {
        ctx.result.result.files.file[0].id = mediaInstance.id;
      }
      next();
    });

    // const fileInfo = ctx.result;
    // // fileInfo object contains information about the uploaded file
    // console.log('File uploaded:', fileInfo);
    // File uploaded: { result: { files: { file: [Array] }, fields: {} } }
    // // You can perform any action you want here, such as sending notifications, updating database, etc.

    // next(); // Call next() to continue with the next middleware
  });

  
};
