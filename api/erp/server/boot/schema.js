module.exports = function (app) {
  var app = require('../../server/server');

  app.post('/api/xa/:filename', function (req, res) {
    // Get the filename parameter from the request
    var filename = req.params.filename;

    // Get the JSON data from the request body
    var jsonData = req.body;

    // Save the JSON data to the specified file
    var fs = require('fs');
    fs.writeFile("../common/models/" + filename + ".json", JSON.stringify(jsonData, null, "\t"), function (err) {
      if (err) {
        console.error('Error saving data:', err);
        res.status(500).send('Error saving data');
      } else {
        console.log('Data saved successfully');
        fs.readFile("model-config.json", 'utf8', function (err, data) {
          var modelCfg = JSON.parse(data);
          modelCfg[jsonData.name] = { "dataSource": "db", "public": true };
          fs.writeFile("model-config.json", JSON.stringify(modelCfg, null, "\t"), function (err) { });
          const { exec } = require('child_process');

          // Example command: list the files in the current directory
          const command = 'pm2 reload vats';

          exec(command, (error, stdout, stderr) => {
            if (error) {
              console.error(`Error executing command: ${error.message}`);
              return;
            }

            if (stderr) {
              console.error(`Command execution error: ${stderr}`);
              return;
            }

            console.log(`Command output:\n${stdout}`);
          });
        });


        res.status(200).send('Data saved successfully');
      }
    });
  });


  app.get('/api/_models', function (req, res) {
    const fs = require('fs');
    const path = require('path');

    // Specify the directory where your model definition JSON files are stored
    const modelsDirectory = '../common/models';

    // Read all JSON files in the specified directory
    fs.readdir(modelsDirectory, (err, files) => {
      if (err) {
        console.error('Error reading directory:', err);
        res.status(500).send('Error reading directory');
        return;
      }

      // Array to store model definitions
      const models = [];

      // Read each JSON file
      files.forEach(file => {
        const filePath = path.join(modelsDirectory, file);

        if (filePath.indexOf('.json') != -1) {

          // Read the JSON file
          const data = fs.readFileSync(filePath, 'utf8');

          try {
            // Parse the JSON data
            const jsonData = JSON.parse(data);
            jsonData.path = path.basename(filePath);
            jsonData.path = jsonData.path && jsonData.path.replace('.json', '');
            models.push(jsonData);
          } catch (parseError) {
            console.error('Error parsing JSON in file:', file, parseError);
            // Handle parsing error if needed
          }
        }
      });

      // Send the array of model definitions
      res.status(200).json(models);
    });
  });


  app.get('/api/_model/:filename', function (req, res) {
    // Get the filename parameter from the request
    var filename = req.params.filename;

    // Read the JSON file
    var fs = require('fs');
    fs.readFile("../common/models/" + filename, 'utf8', function (err, data) {
      if (err) {
        console.error('Error reading data:', err);
        res.status(500).send('Error reading data');
      } else {
        // Parse the JSON data
        var jsonData = JSON.parse(data);
        res.status(200).json(jsonData);
      }
    });
  });
};
