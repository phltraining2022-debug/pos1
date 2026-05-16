
var moment = require('moment');
var _ = require('underscore');
var vm = require('vm');

var nunjucks = require('nunjucks');
var env = new nunjucks.Environment();
var app = require('../../server/server');

var templateEngine = nunjucks.configure('public', {
  autoescape: true,
  express: app
});


module.exports = function (Block) {

  Block.observe('before save', async function(ctx, next) {
    try {
      // If updating an existing instance
      if (ctx.instance && !ctx.isNewInstance) {
        // Check if the updated content contains the exclude start tag
        const updatedContent = ctx.instance.content;

        if (updatedContent.includes('<!--exclude start-->')) {
          // Fetch the current content from the database
          const currentBlock = await Block.findById(ctx.instance.id);
          const originalContent = currentBlock.content;

          // Define the regex to split the content into three parts
          const regex = /(<!--exclude start-->)([\s\S]*?)(<!--exclude end-->)/;

          // Split the original content into three parts
          const originalParts = originalContent.split(regex);

          if (originalParts.length === 5) {
            const beforeExclude = originalParts[0];
            const excludedSection = originalParts[2];
            const afterExclude = originalParts[4];

            // Split the updated content into three parts
            const updatedParts = updatedContent.split(regex);

            // Ensure that updated content is also split into three parts correctly
            if (updatedParts.length === 5) {
              const updatedBeforeExclude = updatedParts[0];
              const updatedAfterExclude = updatedParts[4];

              // Combine the first and last parts from the updated content with the excluded part from the original content
              const combinedContent = updatedBeforeExclude + originalParts[1] + excludedSection + updatedAfterExclude;
              ctx.instance.content = combinedContent;
            }
          }
        }
        // If the tag is not present, or after processing, proceed as normal
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  Block.observe('before save', (ctx,next) => {
    if(ctx.isNewInstance && ctx.instance) {
      if(!ctx.instance.createdAt) {
        ctx.instance.createdAt = moment.utc();
        return;
      }

    }
    if (ctx.data){
      ctx.data.updatedAt = moment.utc();
    } else if(ctx.instance) {
      ctx.instance.updatedAt = moment.utc();
    }
    next();
  })

 

  Block.renderBlock = function (blockId, req, res, cb) {
    const urlPrefix = req.protocol + '://' + req.get('host');

    // Fetch the block by ID
    Block.findById(blockId, function (err, blockInstance) {
      if (err) {
        return cb(err);
      }
      if (!blockInstance) {
        return res.status(404).send("Block not found");
      }

      const block = blockInstance.toJSON();
      const content = block.content;
      const queries = block.model ? JSON.parse(block.model) : {};

      const compiledContent = nunjucks.compile(content, env);

      const doc = {
        urlPrefix: urlPrefix,
        app: app,
        block: block,
        req: req,
        html: req.param('html') == 'true',
        moment: moment,
        path: require('path'),
        exec: require('child_process').execSync,
        fs: require('fs'),
        _: _
      };

      const queryPromises = [];

      for (const key in queries) {
        const query = queries[key];
        const model = app.models[query.model];
        if (model) {
          replaceDatePlaceholders(query.filter);
          queryPromises.push(
            model.find(query.filter).then(result => {
              doc[key] = result;
            })
          );
        }
      }

      Promise.all(queryPromises).then(() => {
        compiledContent.render(doc, function (err, result) {
          if (err) {
            return cb(err);
          }
          if (req.param('html')) {
            res.send(result);
          } else {
            res.send('not supported');
          }
        });
      }).catch(err => {
        console.log('Error executing queries:', err);
        res.status(500).send('Error rendering block');
      });
    });
  };

  Block.remoteMethod('renderBlock', {
    http: { path: '/:blockId/render', verb: 'get' },
    accepts: [
      { arg: 'blockId', type: 'string', required: true, http: { source: 'path' } },
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } }
    ],
    returns: { arg: 'content', type: 'string' }
  });
};

function replaceDatePlaceholders(filter) {
  const today = new Date();
  for (const key in filter) {
    if (typeof filter[key] === 'object' && filter[key] !== null) {
      replaceDatePlaceholders(filter[key]);
    } else if (typeof filter[key] === 'string' && filter[key] === '$today') {
      filter[key] = today;
    }
  }
}




function displayDate(d, sFormat) {
  var theDate = moment(d);
  return theDate.isValid() ? theDate.format(sFormat) : "";
};

function sumByProp(arrData, prop) {
  var valuesToSum = _.map(arrData, function (d) {
    return d[prop];
  });

  console.log("valuesToSum: ", valuesToSum);

  var result = valuesToSum.reduce(function (a, b) { return a + b; }, 0);

  return result;
};

function displayCurrency(n) {
  return " " + n.toFixed(0).replace(/./g, function (c, i, a) {
    return i && c !== "." && ((a.length - i) % 3 === 0) ? ',' + c : c;
  }) + " VNĐ";
}

function displayAddress(address) {
  console.log("address");
  if (!address) {
    return "";
  }

  var street = address.street ? (address.street.trim().length > 0 ? (address.street) : "") : "";
  var ward = address.ward ? (address.ward.trim().length > 0 ? (address.ward) : "") : "";
  var district = address.district ? (address.district.trim().length > 0 ? (address.district) : "") : "";
  var city = address.city ? ((address.city.trim().length > 0) ? (address.city) : "") : "";

  return [street, ward, district, city].join(", ");
}

function displayGender(g) {
  return gender[g.toLowerCase()];
}

function getObject(id, modelName, attr, cb) {
  var query = { where: { id: id } };
  utils.getDataByQuery(modelName, query).then(function (obj) {
    //dfd.resolve({r: obj});
    cb(null, obj[0][attr]);
  }, function (error) {
    console.log("error");
    cb(error);
  });
}



env.addFilter('displayDate', displayDate);
env.addFilter('sumByProp', sumByProp);
env.addFilter('displayCurrency', displayCurrency);
env.addFilter('displayAddress', displayAddress);
env.addFilter('displayGender', displayGender);
env.addFilter('getObject', getObject, true);