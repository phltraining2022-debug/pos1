const inflection = require('inflection');

module.exports = function () {
  return function countRecords(req, res, next) {
  
    if (req.headers['x-request-count'] === 'true' || req.query.tnuoc) {
      console.log('Counting records');

      // Extract the model name from the URL
      const urlParts = req.path.split('/');
      const pluralModelName = urlParts.length > 2 ? urlParts[2] : null;


      console.log('Model name:', pluralModelName);

      if (!pluralModelName) {
        console.error('Model name not found in the URL');
        return next();
      }

      // Convert the plural model name to its singular form
      const modelName = inflection.singularize(pluralModelName);

      console.log('Model name:', modelName);

      // Get the model from the app's models
      const Model = req.app.models[modelName] || req.app.models[pluralModelName];

      if (!Model) {
        console.error(`Model ${modelName} not found`);
        return next();
      }

      const filter = req.query.filter ? JSON.parse(req.query.filter) : {};

      // Count the records based on the filter
      Model.count(filter.where, (err, count) => {
        if (err) {
          console.error('Error counting records:', err);
          return next(err);
        }

        // Set the X-Total-Count header
        res.set('X-Total-Count', count);
        next();
      });
    } else {
      next();
    }
  };
};
