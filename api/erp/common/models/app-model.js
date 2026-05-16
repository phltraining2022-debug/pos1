var moment = require('moment');
var app = require('../../server/server');
var LoopBackContext = require('loopback-context');
var Setting = app.models.Setting;
var Log = app.models.log;
// var _ = require('underscore');

const _ = require('lodash');
var redis = require("redis");

const { generateModelCode } = require('../../server/boot/code-generator');
redisClient = redis.createClient();

const redisGetAsync = (key) =>
  new Promise((resolve) => redisClient.get(key, (err, reply) => resolve(err ? null : reply)));

const redisSetAsync = (key, val) =>
  new Promise((resolve, reject) =>
    redisClient.set(key, val, (err) => (err ? reject(err) : resolve()))
  );

const escapeRegExp = (string) =>
  string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolvePlaceholders = (fmtProperties, instance) => {
  const resolved = {};
  const sortedKeys = Object.keys(fmtProperties || {}).sort((a, b) => b.length - a.length);
  let counterKey = null;

  sortedKeys.forEach((key) => {
    const definition = fmtProperties[key];
    if (typeof definition === 'string' && definition.startsWith('maxFmt')) {
      counterKey = key;
      return;
    }
    const obj = instance;
    try {
      resolved[key] = eval(definition); // eslint-disable-line no-eval
    } catch (_) {
      resolved[key] = '';
    }
    if (resolved[key] === undefined || resolved[key] === null) {
      resolved[key] = '';
    }
  });

  return { resolved, counterKey, sortedKeys };
};

const applyResolvedPlaceholders = (fmt, resolved, sortedKeys, counterKey) => {
  let current = fmt;
  sortedKeys.forEach((key) => {
    if (key === counterKey) return;
    if (Object.prototype.hasOwnProperty.call(resolved, key)) {
      current = current.replace(
        new RegExp(escapeRegExp(key), 'g'),
        String(resolved[key])
      );
    }
  });
  return current;
};

module.exports = function (AppModel) {
  AppModel.observe('before save', async function autoGenerateCode(ctx) {
    if (ctx.options && ctx.options.skipCodeHook) return;

    const instance = ctx.instance || ctx.data;
    if (!ctx.isNewInstance || !instance) return;

    const Model = ctx.Model;
    
    // Khai báo field name ở đây - thay đổi tùy theo nhu cầu
    const codeFieldName = 'code'; // Thay đổi field name ở đây
    
    // Skip nếu field đã có giá trị hợp lệ
    const currentCode = instance[codeFieldName];
    const hasMeaningfulCode = typeof currentCode === 'string'
      ? currentCode.trim().length > 0
      : currentCode !== null && currentCode !== undefined;

    if (hasMeaningfulCode) return;

    const app = Model.app;
    // const dataSource = (typeof Model.getDataSource === 'function' && Model.getDataSource()) || {};
    const dataSourceName = AppModel.currentDatasource;
    const modelKey = Model.modelName;

    if(modelKey === 'message') {
      return;
    }

    

    let cfg = _.get(app.dataSources[dataSourceName], `clinic.codeCfg.${modelKey}`);
    console.log('[AutoCode] cfg lookup', {
      dataSource: dataSourceName,
      model: modelKey,
      hasFmt: cfg && typeof cfg.fmt === 'string',
      hasFmtProps: cfg && typeof cfg.fmtProperties === 'object',
      cfg,
    });

    if (!cfg || typeof cfg.fmt !== 'string' || typeof cfg.fmtProperties !== 'object') {
      let prefix = modelKey.replace(/[a-z]/g, '').toUpperCase();
      if (!prefix || prefix.length < 2) {
        prefix = modelKey.substring(0, 3).toUpperCase();
      }
      const counterToken = '#'.repeat(5);
      cfg = {
        fmt: `${prefix}${counterToken}`,
        fmtProperties: {
          [counterToken]: 'maxFmt(fallbackCounter)',
        },
        groupBy: [],
        fallback: {
          prefix,
          counterLength: counterToken.length,
        },
      };
    }

    const { fmt, fmtProperties } = cfg;
    const { resolved, counterKey, sortedKeys } = resolvePlaceholders(fmtProperties, instance);

    const definitionGroup = cfg.groupBy;
    const modelGroup = _.get(Model, 'settings.codeGroupBy');
    const groupByFields = Array.isArray(definitionGroup) && definitionGroup.length
      ? definitionGroup
      : (Array.isArray(modelGroup) ? modelGroup : []);

    const groupValue = (groupByFields.length
      ? groupByFields.map((field) => _.get(instance, field) || 'all').join('|')
      : 'default') || 'default';

    const redisKey = ['code-seq', dataSourceName, modelKey, groupValue].join(':');

    if (counterKey) {
      const currentSeq = await redisGetAsync(redisKey);
      if (currentSeq === null) {
        const currentPattern = applyResolvedPlaceholders(fmt, resolved, sortedKeys, counterKey);
        const prefixPart = currentPattern.split(counterKey)[0] || '';

        const likeQuery = prefixPart ? { [codeFieldName]: { like: `${prefixPart}%` } } : {};
        const lastRecord = await Model.findOne({
          order: 'id DESC',
          fields: { [codeFieldName]: true },
          where: likeQuery,
        });

        let maxNumber = 0;
        if (lastRecord && lastRecord[codeFieldName]) {
          const regex = prefixPart
            ? new RegExp(`${escapeRegExp(prefixPart)}(\\d+)$`)
            : /(\d+)$/;
          const match = lastRecord[codeFieldName].match(regex);
          if (match) {
            maxNumber = parseInt(match[1], 10) || 0;
          }
        }

        console.log(`[AutoCode] Syncing Redis for ${modelKey} (${redisKey}). DB Max: ${maxNumber}`);
        await redisSetAsync(redisKey, maxNumber.toString());
      }
    }

    const fallbackCfg = cfg.fallback || {};

    const codeResult = await generateModelCode({
      Model,
      instance,
      options: {
        datasource: dataSourceName,
        modelKey,
        idProperty: codeFieldName,
        groupBy: groupByFields,
        useFallback: true,
        fallback: fallbackCfg,
      },
    });

    if (codeResult && codeResult.value) {
      instance[codeResult.idProperty || codeFieldName] = codeResult.value;
    }
  });
  // AppModel.observe('before save', function updateCreatedBy(ctx, next) {
  //   var model = app.models[ctx.Model.modelName];
  //   var ctx_ = LoopBackContext.getCurrentContext();
  //   var token = ctx_ && ctx_.get('accessToken');
  //   var userId = token && token.userId;
  //   var inst = ctx.instance || ctx.data;
  //   inst.updatedById = userId;
  //   console.log(ctx.Model.modelName);

  //   if (ctx.isNewInstance) {
  //     inst.createdAt = moment.utc(); inst.createdById = userId;
  //   }
  //   if (inst.updatedWithAction) {
  //     var val = {
  //       objectId: inst.id || ctx.where && ctx.where.id, createdAt: moment.utc(),
  //       event: inst.updatedWithAction.action,
  //       createdById: userId,
  //       model: ctx.Model.modelName,
  //       ...inst.updatedWithAction
  //     };
  //     if (!ctx.isNewInstance) {
  //       var Log = app.models.log;
  //       Log.create(val);
  //     }
  //     inst.updatedWithAction = null;
  //   }
  //   var Setting = app.models.Setting;
  //   Setting.findOne({ where: { model: ctx.Model.modelName } }).then(function (setting) {
  //     if (setting) {
  //       if (setting.beforeSave) {
  //         eval(setting.beforeSave);
  //       }
  //     }
  //     next();
  //   });
  // });


  // AppModel.observe('before save', function(ctx, next) {
  //   // Check if it's a new instance being created
  //   if (ctx.instance && ctx.isNewInstance) {
  //     // Retrieve the next auto-incremented integer from the sequence collection
  //     AppModel.app.models.Sequence.getNextSequence(ctx.Model.modelName, function(err, nextSequence) {
  //       if (err) return next(err);

  //       // Assign the next sequence as the ID for the new instance
  //       ctx.instance.id = nextSequence;

  //       // Continue with the save operation
  //       next();
  //     });
  //   } else {
  //     // Continue with the save operation for existing instances
  //     next();
  //   }
  // });


  AppModel.observe('after delete', function updateCreatedBy(ctx, next) {
    // console.log('Delete %s#%s', ctx.Model.modelName, ctx.instance.id);
    next();
  });
  // we want to create log after save event for all models, we will keep the changes from previous version
  // we should have the data and the changes in the log
  AppModel.observe('after save', function createLog(ctx, next) {

    next();
    var log = app.models.log;
    var model = app.models[ctx.Model.modelName];
    var token = ctx && ctx.get && ctx.get('accessToken');
    var userId = token && token.userId;
    console.log('After save %s#%s, Checking running', ctx.Model.modelName, ctx.instance && ctx.instance.id || ctx.data && ctx.data.id || 'unknown');
    // 
    var l = {
      model: ctx.Model.modelName,
      createdById: userId || ctx.options.accessToken && ctx.options.accessToken.userId,
      event: 'updated'
    };
    if (ctx.instance) {
      var inst = ctx.instance;
      // clone the inst and remove the relations, createdById, updatedById, createdAt, updatedAt, id  
      l.data = JSON.parse(JSON.stringify(inst));
      const fieldsToExclude = [ 'createdAt', 'updatedAt', 'id'];
      fieldsToExclude.forEach(field => {
        delete l.data[field];
      });

      // convert to ObjectId 
      l.objectId = inst.id;
      if (ctx.isNewInstance) {
        l.event = 'created';
        log.create(l);
      }  else {
        // depending on the model we can have different fields to check for changes
        // look the previous version of the instance and compare with the new one
        // just Object.keys(inst).forEach to check the changes
        // we can use lodash to compare the objects
        
        // find the previous version of the instance sync
        log.findOne({ where: { objectId: inst.id.toString() , model: ctx.Model.modelName }, order: 'createdAt DESC' }).then(function (prev) {
          if (prev) {
            var changes = {};
            Object.keys(l.data).forEach(function (key) {
              if (JSON.stringify(inst[key]) !== JSON.stringify(prev.data[key])) {
                changes[key] = { from: prev.data[key], to: inst[key] };
              }
            });

            Object.keys(prev.data).forEach(function (key) {
              if (!l.data[key]) {
                changes[key] = { from: prev.data[key], to: null };
              }
            });

            l.changes = changes;

          } else {
          }
          log.create(l);
        });

      }

    }

  });




  AppModel.observe('access', function logQuery(ctx, next) {
    next();
  });


  
    AppModel.updateLeadEmails = async function(cb) {
      console.log('🚀 Starting Lead email update script...');
      
      try {
          const Lead = AppModel.app.models.Lead;
          
          if (!Lead) {
              return cb(new Error('Lead model not found'));
          }
          const leads = await Lead.find({
              where: {
                  or: [
                      { email: { neq: null } },
                      { applicantEmail: { neq: null } }
                  ]
              }
          });
          
          console.log(`📊 Found ${leads.length} leads to process`);
          
          let updatedCount = 0;
          let skippedCount = 0;
          
          for (const lead of leads) {
              let needsUpdate = false;
              const updateData = {};
              
              if (lead.email && !lead.email.includes('+')) {
                  const givenNameToUse = lead.givenName || 'default_givenName';
                  
                  // if (!lead.originalEmail) {
                  //     updateData.originalEmail = lead.email;
                  // }
                  updateData.email = `${givenNameToUse}+${lead.originalEmail || lead.email}`;
                  needsUpdate = true;
                  
                  console.log(`📧 Email: ${lead.email} -> ${updateData.email}`);
              }
              
              if (lead.applicantEmail && !lead.applicantEmail.includes('+')) {
                  const applicantGivenNameToUse = lead.applicantGivenName || 'default_applicantGivenName';
                  
                  // if (!lead.originalApplicantEmail) {
                  //     updateData.originalApplicantEmail = lead.applicantEmail;
                  // }
                  
                  updateData.applicantEmail = `${applicantGivenNameToUse}+${lead.originalApplicantEmail || lead.applicantEmail}`;
                  needsUpdate = true;
                  
                  console.log(`📧 ApplicantEmail: ${lead.applicantEmail} -> ${updateData.applicantEmail}`);
              }
              
              if (needsUpdate) {
                  try {
                      await new Promise((resolve) => {
                          redisClient.set(`no-trigger:${lead.id}`, 'true', 'EX', 60, resolve);
                      });
                      
                      await lead.updateAttributes(updateData);
                      updatedCount++;
                      
                      console.log(`✅ Updated Lead ID: ${lead.id} (${lead.givenName || 'No name'})`);
                      
                      redisClient.del(`no-trigger:${lead.id}`);
                      
                  } catch (updateError) {
                      console.error(`❌ Error updating Lead ID ${lead.id}:`, updateError.message);
                  }
              } else {
                  skippedCount++;
                  console.log(`⏭️  Skipped Lead ID: ${lead.id} (already processed or no email)`);
              }
              await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          const result = {
              success: true,
              message: 'Lead emails updated successfully',
              statistics: {
                  totalProcessed: leads.length,
                  successfullyUpdated: updatedCount,
                  skipped: skippedCount
              }
          };
          
          console.log('\n🎉 Update completed!');
          console.log(`📈 Statistics:`, result.statistics);
          
          cb(null, result);
          
      } catch (error) {
          console.error('❌ Script failed:', error);
          cb(error);
      }
  };
  
  AppModel.remoteMethod('updateLeadEmails', {
      accepts: [],
      returns: { arg: 'response', type: 'object', root: true },
      http: { path: '/update-lead-emails', verb: 'post' },
      description: 'Update all Lead emails to format: {givenName}+{originalEmail} (runs once only)'
  });
  


AppModel.smartFind = function(params, cb) {
  // console.log('=== SMART FIND DEBUG START ===');

  let responseHandled = false;
  const safeCallback = (err, result) => {
      if (responseHandled) {
          //console.log('⚠️ Response already handled, ignoring duplicate');
          return;
      }
      responseHandled = true;
      clearTimeout(executionTimeout); // Ensure timeout is cleared
      //console.log('=== SMART FIND DEBUG END ===');
      setImmediate(() => cb(err, result));
  };

  const executionTimeout = setTimeout(() => {
      safeCallback(new Error('Query execution timeout after 30 seconds'));
  }, 30000);

  if (typeof cb !== 'function') {
      throw new Error('Callback must be a function');
  }

  let parsedParams;
  try {
      parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
  } catch (parseError) {
      //console.log('❌ JSON Parse Error:', parseError.message);
      return safeCallback(new Error('Invalid JSON format: ' + parseError.message));
  }

  const {
      modelName,
      filter = {},
      where = {},
      include,
      limit,
      offset,
      skip,
      order,
      fields
  } = parsedParams;

  if (!modelName) {
      return safeCallback(new Error('modelName is required'));
  }

  const MainModel = AppModel.app.models[modelName];
  if (!MainModel) {
      //console.log('❌ Model not found:', modelName);
      return safeCallback(new Error(`Model ${modelName} not found`));
  }

  const completeFilter = {
      ...filter,
      where: Object.assign({}, filter.where || {}, where)
  };

  if (include !== undefined) completeFilter.include = include;
  if (limit !== undefined) completeFilter.limit = limit;
  if (offset !== undefined) completeFilter.offset = offset;
  if (skip !== undefined) completeFilter.skip = skip;
  if (order !== undefined) completeFilter.order = order;
  if (fields !== undefined) completeFilter.fields = fields;

  //console.log('🔍 Initial complete filter:', JSON.stringify(completeFilter, null, 2));

  const IMPOSSIBLE_ID_PLACEHOLDER = '__impossible_value_to_find__';

  /**
   * Efficiently detect if a path refers to an embedded object array
   * Uses memoization and early termination for performance
   * Now properly handles nested paths like 'attendedEvents.citySchedules.city'
   */
  const arrayFieldCache = new Map();
  function isEmbeddedArrayField(model, path) {
    const cacheKey = `${model.modelName}:${path}`;
    
    // Clear cache for dynamic fields to ensure fresh evaluation
    if (path.includes('attendedEvents') || path.includes('citySchedules')) {
      arrayFieldCache.delete(cacheKey);
    }
    
    if (arrayFieldCache.has(cacheKey)) {
      return arrayFieldCache.get(cacheKey);
    }

    const pathParts = path.split('.');
    const fieldName = pathParts[0];

    // Early termination for common cases
    if (pathParts.length < 2) {
      arrayFieldCache.set(cacheKey, false);
      return false;
    }

    const fieldDef = model.definition && model.definition.properties
      ? model.definition.properties[fieldName]
      : undefined;

    let isArray = false;
    let isArrayOfObjects = false;

    if (fieldDef) {
      // LoopBack v2 supports multiple ways to define arrays
      if (Array.isArray(fieldDef.type)) {
        // e.g. "type": [ { ...object schema... } ] or ["object"]
        isArray = true;
        const firstItem = fieldDef.type[0];
        isArrayOfObjects = firstItem === 'object' || typeof firstItem === 'object';
      } else if (fieldDef.type === 'array') {
        isArray = true;
        // e.g. { type: 'array', itemType: 'object' } or { items: { type: 'object' } }
        if (fieldDef.itemType) {
          isArrayOfObjects = fieldDef.itemType === 'object' || typeof fieldDef.itemType === 'object';
        } else if (fieldDef.items) {
          isArrayOfObjects = (fieldDef.items.type === 'object') || (typeof fieldDef.items === 'object');
        } else if (fieldDef.model) {
          // e.g. { type: 'array', model: 'user' } -> treat as array of objects in Mongo
          isArrayOfObjects = true;
        }
      }
    }

    // If field is not defined in schema, assume it's a dynamic field
    // For dynamic fields, we'll treat them as potential arrays of objects
    // This is common in MongoDB where fields can be added dynamically
    if (!fieldDef) {
      // Do not assume dynamic fields are embedded; prefer relation or direct
      // If included as relation via 'include', treat as relation (not embedded)
      try {
        const incl = include; // captured from outer scope
        const isIncludedAsRelation = Array.isArray(incl) && incl.some(it => {
          if (!it) return false;
          if (typeof it === 'string') return it === fieldName;
          if (typeof it === 'object') return it.relation === fieldName;
          return false;
        });
        if (isIncludedAsRelation) {
          arrayFieldCache.set(cacheKey, false);
          return false;
        }
      } catch (e) {}
      
      // Check if this is a known relation field (even if not in include)
      const relationDef = model.relations && model.relations[fieldName];
      if (relationDef) {
        arrayFieldCache.set(cacheKey, false);
        return false;
      }
      
      // For dynamic fields with dot notation, assume they could be embedded arrays
      // This allows filtering on dynamic embedded array fields like attendedEvents.eventId
      if (pathParts.length >= 2) {
        console.log(`🔍 Dynamic field '${fieldName}' with dot notation - treating as potential embedded array`);
        console.log(`🔍 Full path: '${path}', fieldName: '${fieldName}', pathParts:`, pathParts);
        arrayFieldCache.set(cacheKey, true);
        return true;
      }
      
      arrayFieldCache.set(cacheKey, false);
      return false;
    }

    const result = isArray && isArrayOfObjects;
    arrayFieldCache.set(cacheKey, result);
    
    if (result) {
      console.log(`🔍 Path '${path}' identified as embedded array field (${fieldName} is array of objects)`);
    } else {
      console.log(`🔍 Path '${path}' NOT identified as embedded array field (${fieldName} is not array of objects)`);
    }
    
    return result;
  }

  /**
   * Check if a path refers to a relation (not an embedded array)
   */
  function isRelationPath(model, path) {
    if (!path.includes('.')) return false;
    
    const pathParts = path.split('.');
    const relationName = pathParts[0];
    
    // 1) Explicit relation in model definition
    const relationDef = model.relations && model.relations[relationName];
    if (relationDef) {
      return true;
    }

    // 2) Relation inferred from 'include' parameter
    try {
      const incl = include;
      const isIncludedAsRelation = Array.isArray(incl) && incl.some(it => {
        if (!it) return false;
        if (typeof it === 'string') return it === relationName;
        if (typeof it === 'object') return it.relation === relationName;
        return false;
      });
      if (isIncludedAsRelation) {
        return true;
      }
    } catch (e) {}

    // 3) Fallback: if not embedded, treat as direct field (not relation)
    return false;
  }

  /**
   * Enhanced embedded array search that properly handles nested "and" and "or" operators
   * This function recursively processes complex where clauses and applies proper logical operations
   */
  async function handleEmbeddedArraySearch(model, where, filter) {
    console.log('🔍 handleEmbeddedArraySearch called with model:', model ? model.modelName : 'UNDEFINED');
    
    // Validate model and data source
    if (!model) {
      throw new Error('Model is undefined in handleEmbeddedArraySearch');
    }
    
    if (!model.getDataSource) {
      throw new Error(`Model ${model.modelName} does not have getDataSource method`);
    }
    
    const dataSource = model.getDataSource();
    if (!dataSource) {
      throw new Error(`Model ${model.modelName} has no data source configured`);
    }
    
    console.log('🔍 Data source validation passed for model:', model.modelName);
    
    /**
     * Recursively extract and categorize conditions from the where clause
     * This handles nested "and" and "or" operators properly
     */
    function extractConditionsRecursively(whereObj, embeddedPaths = [], regularConditions = {}) {
      if (!whereObj || typeof whereObj !== 'object') {
        return { embeddedPaths, regularConditions };
      }
      
      console.log('🔍 Processing conditions:', JSON.stringify(whereObj, null, 2));
      
      // Handle logical operators
      if (whereObj.and || whereObj.or) {
        const logicalConditions = [];
        
        if (whereObj.and && Array.isArray(whereObj.and)) {
          console.log(`🔍 Found AND operator with ${whereObj.and.length} conditions`);
          logicalConditions.push({ operator: 'and', conditions: whereObj.and });
        }
        
        if (whereObj.or && Array.isArray(whereObj.or)) {
          console.log(`🔍 Found OR operator with ${whereObj.or.length} conditions`);
          logicalConditions.push({ operator: 'or', conditions: whereObj.or });
        }
        
        // Process each logical group
        logicalConditions.forEach(({ operator, conditions }) => {
          conditions.forEach((condition, index) => {
            console.log(`🔍 Processing ${operator.toUpperCase()}[${index}]:`, condition);
            const result = extractConditionsRecursively(condition, [], {});
            
            // Merge embedded paths
            embeddedPaths.push(...result.embeddedPaths);
            
            // Merge regular conditions (for AND, we combine; for OR, we keep separate)
            if (operator === 'and') {
              Object.assign(regularConditions, result.regularConditions);
            } else {
              // For OR, we need to handle this specially
              if (!regularConditions.or) regularConditions.or = [];
              regularConditions.or.push(result.regularConditions);
            }
          });
        });
        
        return { embeddedPaths, regularConditions };
      }
      
      // Handle regular field conditions
      for (const key in whereObj) {
        const value = whereObj[key];
        
        if (key.includes('.') && isEmbeddedArrayField(model, key)) {
          // Check if this is a MongoDB-style operator (like exists, ne, etc.)
          if (value && typeof value === 'object' && (
            value.exists !== undefined || 
            value.ne !== undefined || 
            value.$exists !== undefined || 
            value.$ne !== undefined ||
            value.$gt !== undefined ||
            value.$gte !== undefined ||
            value.$lt !== undefined ||
            value.$lte !== undefined ||
            value.$in !== undefined ||
            value.$nin !== undefined ||
            value.$regex !== undefined
          )) {
            // This is a MongoDB-style operator, treat as regular condition
            console.log(`🔍 Found MongoDB operator in embedded field: ${key} = ${JSON.stringify(value)}`);
            regularConditions[key] = value;
          } else {
            // This is a regular embedded array condition
            console.log(`🔍 Found embedded array condition: ${key} = ${JSON.stringify(value)}`);
            
            // Extract the base array field and nested path
            const pathParts = key.split('.');
            const baseArrayField = pathParts[0];
            const nestedPath = pathParts.slice(1).join('.');
            
            console.log(`🔍 Extracted: baseArrayField='${baseArrayField}', nestedPath='${nestedPath}'`);
            
            embeddedPaths.push({ 
              path: key, 
              baseArrayField: baseArrayField,
              nestedPath: nestedPath,
              value: value 
            });
          }
        } else if (key !== 'and' && key !== 'or') {
          // This is either a direct field or a relation field
          // For embedded array search, we only care about direct fields and embedded array fields
          // Relation fields will be handled separately by relation resolution
          if (!key.includes('.') || !isRelationPath(model, key)) {
            console.log(`🔍 Found regular condition: ${key} = ${JSON.stringify(value)}`);
            regularConditions[key] = value;
          } else {
            console.log(`🔍 Skipping relation condition in embedded array search: ${key} = ${JSON.stringify(value)}`);
            // Don't add relation conditions to regularConditions for embedded array search
          }
        }
      }
      
      return { embeddedPaths, regularConditions };
    }
    
    // Extract all conditions recursively
    const { embeddedPaths, regularConditions } = extractConditionsRecursively(where);
    
    console.log('🔍 Extracted conditions:');
    console.log('  - Embedded paths:', embeddedPaths);
    console.log('  - Regular conditions:', regularConditions);
    console.log('  - Original where clause:', JSON.stringify(where, null, 2));
    
    // Early return if no embedded searches
    if (embeddedPaths.length === 0) {
      console.log('🔍 No embedded array conditions found, returning regular filter');
      console.log('🔍 Final filter for regular search:', JSON.stringify({ ...filter, where: regularConditions }, null, 2));
      return new Promise((resolve, reject) => {
        model.find({ ...filter, where: regularConditions }, (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });
    }
    
    // Extract unique array field names
    const arrayFields = [...new Set(embeddedPaths.map(p => p.baseArrayField))];
    console.log('🔍 Array fields to process:', arrayFields);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Query timeout after 15 seconds'));
      }, 15000);
      
      // Build where clause for initial fetch
      const initialWhere = { ...regularConditions };
      console.log('🔍 Initial where clause for query:', JSON.stringify(initialWhere, null, 2));
      
      // Fetch documents that might contain matching arrays
      model.find({ ...filter, where: initialWhere }, (err, documents) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        
        console.log(`✅ Found ${documents.length} documents for array filtering`);
        
        if (documents.length === 0) {
          return resolve([]);
        }
        
        // Filter arrays based on embedded conditions
        const filteredDocuments = documents.map(doc => {
          // Memory optimization: Use structuredClone for deep copy instead of toObject()
          const filteredDoc = doc.toObject ? doc.toObject() : JSON.parse(JSON.stringify(doc));
          
          console.log(`🔍 Processing document ID: ${filteredDoc.id}`);
          
          // Process each array field
          arrayFields.forEach(arrayField => {
            if (filteredDoc[arrayField] && Array.isArray(filteredDoc[arrayField])) {
              // Get all conditions that apply to this specific array field
              const fieldConditions = embeddedPaths.filter(({ baseArrayField }) => {
                return baseArrayField === arrayField;
              });
              
              console.log(`🔍 Filtering array field '${arrayField}' with ${fieldConditions.length} conditions:`, fieldConditions);
              
              // Performance optimization: Early exit if no conditions
              if (fieldConditions.length === 0) return;
              
              // Memory optimization: Process arrays in chunks for large arrays
              const originalArray = filteredDoc[arrayField];
              const chunkSize = 1000; // Process 1000 elements at a time
              let filteredArray = [];
              
              for (let i = 0; i < originalArray.length; i += chunkSize) {
                const chunk = originalArray.slice(i, i + chunkSize);
                const filteredChunk = chunk.filter((arrayElement, elementIndex) => {
                  const matches = fieldConditions.every(({ nestedPath, value }) => {
                    // Navigate to the nested field using the nestedPath
                    // Handle nested object arrays properly
                    let fieldValue = arrayElement;
                    const pathParts = nestedPath.split('.');
                    
                    // Traverse the nested path, handling arrays at each level
                    let finalFieldValue = null;
                    let pathTraversalComplete = false;
                    
                    for (let i = 0; i < pathParts.length; i++) {
                      const part = pathParts[i];
                      
                      if (fieldValue && typeof fieldValue === 'object') {
                        if (Array.isArray(fieldValue)) {
                          // This is an array, we need to check if ANY element matches the remaining path
                          const remainingPath = pathParts.slice(i + 1).join('.');
                          if (remainingPath) {
                            // Check if any element in this array matches the remaining path
                            const arrayMatch = fieldValue.some((element, idx) => {
                              return checkNestedPath(element, remainingPath, value);
                            });
                            return arrayMatch;
                          } else {
                            // No remaining path, check if any element matches the value directly
                            const directMatch = fieldValue.some(element => {
                              return evaluateCondition(element, value);
                            });
                            return directMatch;
                          }
                        } else if (fieldValue[part] !== undefined) {
                          // This is an object, continue traversing
                          fieldValue = fieldValue[part];
                          
                          // If this is the last part, we've found our final value
                          if (i === pathParts.length - 1) {
                            finalFieldValue = fieldValue;
                            pathTraversalComplete = true;
                            break;
                          }
                        } else {
                          // Field doesn't exist at this level, can't match
                          return false;
                        }
                      } else {
                        // Field doesn't exist at this level, can't match
                        return false;
                      }
                    }
                    
                    // Now evaluate the condition on the final field value
                    if (pathTraversalComplete && finalFieldValue !== null) {
                      return evaluateCondition(finalFieldValue, value);
                    } else {
                      return false;
                    }
                  });
                  
                  return matches;
                });
                
                filteredArray.push(...filteredChunk);
                
                // Memory optimization: Clear chunk reference
                chunk.length = 0;
              }
              
              // Replace the original array with filtered results
              filteredDoc[arrayField] = filteredArray;
              
              console.log(`  🔍 Array '${arrayField}' filtered from ${originalArray.length} to ${filteredArray.length} elements`);
              
              // Memory optimization: Clear original array reference
              originalArray.length = 0;
            }
          });
          
          return filteredDoc;
        });
        
        // Only filter out documents with empty arrays IF the embedded conditions were in an AND context
        // For safety and correct OR semantics, keep documents even if arrays are empty
        const finalDocuments = filteredDocuments;
        
        // Apply fields filter if specified
        if (filter.fields && Array.isArray(filter.fields)) {
          finalDocuments.forEach(doc => {
            const filteredDoc = {};
            filter.fields.forEach(field => {
              if (doc[field] !== undefined) {
                filteredDoc[field] = doc[field];
              }
            });
            Object.assign(doc, filteredDoc);
          });
        }
        
        console.log(`✅ Returning ${finalDocuments.length} documents with filtered arrays`);
        resolve(finalDocuments);
      });
    });
  }
  
  /**
   * Helper function to evaluate a single condition
   */
  function evaluateCondition(fieldValue, conditionValue) {
    if (typeof conditionValue === 'string') {
      const cleanValue = conditionValue.trim();
      const matches = new RegExp(cleanValue, 'i').test(fieldValue);
      return matches;
    } else if (conditionValue && typeof conditionValue === 'object') {
      // Handle MongoDB-style operators
      if (conditionValue.$gt !== undefined) {
        return fieldValue > conditionValue.$gt;
      } else if (conditionValue.$gte !== undefined) {
        return fieldValue >= conditionValue.$gte;
      } else if (conditionValue.$lt !== undefined) {
        return fieldValue < conditionValue.$lt;
      } else if (conditionValue.$lte !== undefined) {
        return fieldValue <= conditionValue.$lte;
      } else if (conditionValue.$ne !== undefined) {
        return fieldValue !== conditionValue.$ne;
      } else if (conditionValue.$in !== undefined) {
        return conditionValue.$in.includes(fieldValue);
      } else if (conditionValue.$nin !== undefined) {
        return !conditionValue.$nin.includes(fieldValue);
      } else if (conditionValue.$regex !== undefined) {
        const options = conditionValue.$options || 'i';
        return new RegExp(conditionValue.$regex, options).test(fieldValue);
      } else if (conditionValue.inq !== undefined) {
        // Handle LoopBack's 'inq' operator
        return conditionValue.inq.includes(fieldValue);
      } else if (conditionValue.nin !== undefined) {
        // Handle LoopBack's 'nin' operator
        return !conditionValue.nin.includes(fieldValue);
      }
      // For other complex conditions, assume it matches
      return true;
    } else {
      return fieldValue === conditionValue;
    }
  }
  
  /**
   * Helper function to recursively check nested paths in object arrays
   * This handles cases like 'citySchedules.city' where citySchedules is an array
   */
  function checkNestedPath(obj, path, conditionValue) {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    
    const pathParts = path.split('.');
    
    // If this is the final field, evaluate the condition
    if (pathParts.length === 1) {
      const fieldName = pathParts[0];
      
      if (obj[fieldName] !== undefined) {
        return evaluateCondition(obj[fieldName], conditionValue);
      } else {
        return false;
      }
    }
    
    // If there are more path parts, continue traversing
    const currentField = pathParts[0];
    const remainingPath = pathParts.slice(1).join('.');
    
    if (obj[currentField] !== undefined) {
      if (Array.isArray(obj[currentField])) {
        // This is an array, check if any element matches the remaining path
        return obj[currentField].some((element, index) => {
          return checkNestedPath(element, remainingPath, conditionValue);
        });
      } else if (typeof obj[currentField] === 'object') {
        // This is an object, continue traversing
        return checkNestedPath(obj[currentField], remainingPath, conditionValue);
      } else {
        // This is a primitive value, can't match a nested path
        return false;
      }
    }
    
    return false;
  }

  function hasRelationConditions(whereObj, cache = new Set()) {
      if (!whereObj || typeof whereObj !== 'object' || cache.has(whereObj)) return false;
      cache.add(whereObj);
      
      for (const key in whereObj) {
          if (key.includes('.') && isRelationPath(MainModel, key)) return true;
          const value = whereObj[key];
          if ((key === 'and' || key === 'or') && Array.isArray(value)) {
              for (const item of value) {
                  if (hasRelationConditions(item, cache)) return true;
              }
          }
      }
      return false;
  }

  /**
   * Recursively resolves a relational path to find final IDs.
   * @returns {Promise<{keyToApplyOnParent: string, condition: {inq: Array}}>}
   */
  async function resolveRelationPath(currentModel, pathParts, targetValue) {
      const relationName = pathParts[0];
      const remainingPath = pathParts.slice(1);
      
      const relationDef = currentModel.relations && currentModel.relations[relationName];
      if (!relationDef) {
          // If not a relation, filter directly with full dot notation on the original model
          const dotPath = pathParts.join('.');
          const subWhere = { [dotPath]: targetValue };
          
          return new Promise((resolve, reject) => {
              const queryTimeout = setTimeout(() => reject(new Error(`Direct field query timeout for ${dotPath}`)), 15000);
              currentModel.find({ where: subWhere, fields: ['id'] }, (err, items) => {
                  clearTimeout(queryTimeout);
                  if (err) return reject(err);
                  const ids = (items || []).map(item => item.id).filter(id => id != null);
                  resolve({
                      keyToApplyOnParent: 'id',
                      condition: { inq: ids.length > 0 ? [...new Set(ids)] : [IMPOSSIBLE_ID_PLACEHOLDER] }
                  });
              });
          });
      }

      const RelatedModel = AppModel.app.models[relationDef.modelTo.modelName];
      if (!RelatedModel) {
          throw new Error(`Related model '${relationDef.modelTo.modelName}' not found.`);
      }

      let subWhere;
      if (remainingPath.length > 1) {
          // Recursive step: we need to go deeper
          const subResult = await resolveRelationPath(RelatedModel, remainingPath, targetValue);
          if (!subResult || !subResult.keyToApplyOnParent) {
               return { keyToApplyOnParent: relationDef.keyFrom, condition: { inq: [IMPOSSIBLE_ID_PLACEHOLDER] } };
          }
          subWhere = { [subResult.keyToApplyOnParent]: subResult.condition };
      } else {
          // Base case: the next part is the final field
          const fieldInRelated = remainingPath[0];
          subWhere = { [fieldInRelated]: targetValue };
      }
      
      return new Promise((resolve, reject) => {
          const queryTimeout = setTimeout(() => reject(new Error(`Relation query timeout for ${pathParts.join('.')}`)), 15000);
          
          RelatedModel.find({ where: subWhere, fields: [relationDef.keyTo] }, (err, items) => {
              clearTimeout(queryTimeout);
              if (err) return reject(err);
              
              const ids = (items || []).map(item => item[relationDef.keyTo]).filter(id => id != null);
              
              resolve({
                  keyToApplyOnParent: relationDef.keyFrom, // This is the FK on the currentModel
                  condition: { inq: ids.length > 0 ? [...new Set(ids)] : [IMPOSSIBLE_ID_PLACEHOLDER] }
              });
          });
      });
  }

  /**
   * Recursively processes a where clause, resolving relational paths.
   * ALWAYS returns a valid LoopBack where clause.
   * This function properly handles nested "and" and "or" operators with correct precedence.
   * IMPORTANT: This function handles ONLY relation conditions, NOT embedded array conditions
   * @returns {Promise<Object>} A new where clause with relations resolved to 'inq' queries.
   */
  async function resolveWhereClause(model, where) {
    console.log('🔍 resolveWhereClause processing:', JSON.stringify(where, null, 2));
    
    const directConditions = {};
    const logicalClauses = {}; // To hold 'and'/'or' results
    const relationPathPromises = [];

    // 1. Separate conditions into direct, logical, and relational
    for (const key in where) {
        const value = where[key];
        if (key === 'and' || key === 'or') {
            if (Array.isArray(value) && value.length > 0) {
                // Recursively resolve each sub-condition
                logicalClauses[key] = await Promise.all(value.map((cond, index) => {
                  return resolveWhereClause(model, cond);
                }));
            }
        } else if (key.includes('.') && isRelationPath(model, key)) {
            // Add relational path to be processed
            relationPathPromises.push(resolveRelationPath(model, key.split('.'), value));
        } else if (key !== 'and' && key !== 'or') {
            // This is a direct condition
            directConditions[key] = value;
        }
    }

    // 2. Resolve all relational paths in parallel
    const pathResults = await Promise.all(relationPathPromises);

    // 3. Group resolved path results by the foreign key they apply to
    const groupedByFk = {};
    for (const result of pathResults) {
        if (!groupedByFk[result.keyToApplyOnParent]) {
            groupedByFk[result.keyToApplyOnParent] = [];
        }
        groupedByFk[result.keyToApplyOnParent].push(result.condition.inq);
    }
    
    // 4. Intersect IDs for each FK group (implicit AND logic)
    const relationalConditions = {};
    for (const fk in groupedByFk) {
        const idLists = groupedByFk[fk];
        if (idLists.length === 0) continue;

        let finalIds = idLists[0].filter(id => id !== IMPOSSIBLE_ID_PLACEHOLDER);
        
        for (let i = 1; i < idLists.length; i++) {
            if (finalIds.length === 0) break;
            const currentIdSet = new Set(idLists[i]);
            finalIds = finalIds.filter(id => currentIdSet.has(id));
        }

        relationalConditions[fk] = { inq: finalIds.length > 0 ? finalIds : [IMPOSSIBLE_ID_PLACEHOLDER] };
    }

    // 5. Build the final where clause by combining all parts
    // All conditions at the same level are implicitly AND-ed together.
    const finalAndClause = [];

    // Add direct conditions if any
    if (Object.keys(directConditions).length > 0) {
        finalAndClause.push(directConditions);
    }
    
    // Add resolved relational conditions if any
    if (Object.keys(relationalConditions).length > 0) {
        finalAndClause.push(relationalConditions);
    }
    
    // Add resolved AND clauses
    if (logicalClauses.and) {
        finalAndClause.push(...logicalClauses.and);
    }

    let finalWhere = {};
    
    // If there's anything to AND together, put it in the 'and' clause
    if (finalAndClause.length > 0) {
        finalWhere.and = finalAndClause;
    }
    
    // Now, handle the OR clause with proper precedence
    if (logicalClauses.or) {
        
        if (finalWhere.and) {
            // If we have AND conditions, the OR must be part of the AND clause
            // This ensures proper precedence: (A AND B) AND (C OR D)
            finalWhere.and.push({ or: logicalClauses.or });
        } else {
            // Otherwise, it's a top-level OR
            finalWhere = { or: logicalClauses.or };
        }
    }

    // Cleanup: if the final result is { and: [ {one_condition} ] }, simplify it.
    if (finalWhere.and && finalWhere.and.length === 1) {
        return finalWhere.and[0];
    }

    return finalWhere;
  }

  // --- Main Execution Logic ---
  (async () => {
      const initialWhere = completeFilter.where;

      
      // Performance optimization: Early return for simple cases
      if (!initialWhere || Object.keys(initialWhere).length === 0) {
        return MainModel.find(completeFilter, safeCallback);
      }
      
      // Performance monitoring
      const startTime = Date.now();
      
      // Memory optimization: Check for potentially expensive operations
      const hasComplexConditions = (() => {
        function checkComplexity(whereObj, depth = 0) {
          if (depth > 5) return true; // Prevent infinite recursion
          if (!whereObj || typeof whereObj !== 'object') return false;
          
          for (const key in whereObj) {
            if (key === 'and' || key === 'or') {
              if (Array.isArray(whereObj[key]) && whereObj[key].length > 10) return true;
              for (const condition of whereObj[key]) {
                if (checkComplexity(condition, depth + 1)) return true;
              }
            }
          }
          return false;
        }
        return checkComplexity(initialWhere);
      })();
      
      if (hasComplexConditions) {
        console.log('⚠️ Complex conditions detected, enabling performance monitoring');
      }
      
      // Separate embedded array conditions from relation conditions
      const { embeddedArrayConditions, relationConditions, directConditions } = (() => {
        function separateConditions(whereObj, embeddedPaths = [], relationPaths = [], directPaths = {}) {
          if (!whereObj || typeof whereObj !== 'object') {
            return { embeddedPaths, relationPaths, directPaths };
          }
          
          for (const key in whereObj) {
            const value = whereObj[key];
            
            if (key === 'and' || key === 'or') {
              if (Array.isArray(value)) {
                value.forEach(condition => {
                  const result = separateConditions(condition, [], [], {});
                  embeddedPaths.push(...result.embeddedPaths);
                  relationPaths.push(...result.relationPaths);
                  Object.assign(directPaths, result.directPaths);
                });
              }
            } else if (key.includes('.')) {
              if (isEmbeddedArrayField(MainModel, key)) {
                // Check if this is a MongoDB-style operator
                if (value && typeof value === 'object' && (
                  value.exists !== undefined || 
                  value.ne !== undefined || 
                  value.$exists !== undefined || 
                  value.$ne !== undefined ||
                  value.$gt !== undefined ||
                  value.$gte !== undefined ||
                  value.$lt !== undefined ||
                  value.$lte !== undefined ||
                  value.$in !== undefined ||
                  value.$nin !== undefined ||
                  value.$regex !== undefined
                )) {
                  // MongoDB operator, treat as direct condition
                  directPaths[key] = value;
                } else {
                  // True embedded array condition
                  embeddedPaths.push({ path: key, value: value });
                }
              } else if (isRelationPath(MainModel, key)) {
                // Relation condition
                relationPaths.push({ path: key, value: value });
              } else {
                // Unknown dot notation, treat as direct
                directPaths[key] = value;
              }
            } else {
              // Direct field condition
              directPaths[key] = value;
            }
          }
          
          return { embeddedPaths, relationPaths, directPaths };
        }
        
        const rawSeparated = separateConditions(initialWhere);
        return {
          embeddedArrayConditions: rawSeparated.embeddedPaths,
          relationConditions: rawSeparated.relationPaths,
          directConditions: rawSeparated.directPaths,
        };
      })();

     
      // Case 1: Only embedded array conditions (no relations)
      if (embeddedArrayConditions.length > 0 && relationConditions.length === 0) {
        
        try {
          const results = await handleEmbeddedArraySearch(MainModel, initialWhere, completeFilter);
          return safeCallback(null, results);
        } catch (error) {
          console.error('❌ handleEmbeddedArraySearch error:', error);
          return safeCallback(error);
        }
      }

      // Case 2: Only relation conditions (no embedded arrays)
      if (relationConditions.length > 0 && embeddedArrayConditions.length === 0) {
        
        try {
          const finalWhere = await resolveWhereClause(MainModel, initialWhere);
          const finalFilter = { ...completeFilter, where: finalWhere };
          MainModel.find(finalFilter, safeCallback);
        } catch (error) {
          console.error('❌ resolveWhereClause error:', error);
          return safeCallback(error);
        }
      }

      // Case 3: Mixed conditions (both embedded arrays and relations)
      if (embeddedArrayConditions.length > 0 && relationConditions.length > 0) {
        
        try {
          // First, resolve relations to get base document IDs
          const relationWhere = { ...initialWhere };
          
          // Remove embedded array conditions temporarily for relation resolution
          embeddedArrayConditions.forEach(({ path }) => {
            const pathParts = path.split('.');
            let current = relationWhere;
            for (let i = 0; i < pathParts.length - 1; i++) {
              if (current[pathParts[i]]) {
                current = current[pathParts[i]];
              }
            }
            if (current && current[pathParts[pathParts.length - 1]] !== undefined) {
              delete current[pathParts[pathParts.length - 1]];
            }
          });

          const resolvedWhere = await resolveWhereClause(MainModel, relationWhere);
          const baseFilter = { ...completeFilter, where: resolvedWhere };
          
          // Fetch base documents using resolved relations
          const baseDocuments = await new Promise((resolve, reject) => {
            MainModel.find(baseFilter, (err, results) => {
              if (err) reject(err);
              else resolve(results);
            });
          });

          if (baseDocuments.length === 0) {
            return safeCallback(null, []);
          }

          // Now apply embedded array filtering on the base documents
          const finalResults = baseDocuments.map(doc => {
            const filteredDoc = { ...doc.toObject() };
            
            // Apply embedded array filtering logic here
            embeddedArrayConditions.forEach(({ path, value }) => {
              const pathParts = path.split('.');
              const baseArrayField = pathParts[0];
              const nestedPath = pathParts.slice(1).join('.');
              
              if (filteredDoc[baseArrayField] && Array.isArray(filteredDoc[baseArrayField])) {
                filteredDoc[baseArrayField] = filteredDoc[baseArrayField].filter(arrayElement => {
                  // Apply the same filtering logic as in handleEmbeddedArraySearch
                  // This is a simplified version for mixed conditions
                  return checkNestedPath(arrayElement, nestedPath, value);
                });
              }
            });
            
            return filteredDoc;
          });

          // Preserve OR semantics: do not drop documents solely because filtered arrays are empty
          const finalDocuments = finalResults;

          return safeCallback(null, finalDocuments);
        } catch (error) {
          console.error('❌ Mixed conditions handling error:', error);
          return safeCallback(error);
        }
      }

      // Case 4: No special conditions, use direct find
      if (embeddedArrayConditions.length === 0 && relationConditions.length === 0) {
        
        return MainModel.find(completeFilter, safeCallback);
      }
      
      // Performance monitoring for complex queries
      if (hasComplexConditions) {
        const endTime = Date.now();
        
      }

  })().catch(err => {
      console.error('❌ Unhandled error during smartFind execution:', err);
      safeCallback(err);
  });
};

// ... existing remoteMethod definition ...
AppModel.remoteMethod('smartFind', {
  accepts: [
      { 
          arg: 'params', 
          type: 'string', 
          required: true, 
          description: 'JSON string containing modelName (required), and optional filter, where (supports nested and/or with dot-notation relations), include, limit, offset, order, fields.' 
      }
  ],
  returns: { type: ['object'], root: true },
  http: { path: '/smartFind', verb: 'get' } // Changed to POST to handle complex/long JSON
});

AppModel.updateMany = function (updateItems, ids, modelName, where, trackChanges = true, cb) {
  const TargetModel = AppModel.app.models[modelName];
  const LogModel = app.models.log;

  if (!TargetModel) {
      return cb(new Error(`Invalid model name: ${modelName}`));
  }
  if (!updateItems) {
      return cb(new Error('updateItems is required'));
  }

  const loopbackCtx = LoopBackContext.getCurrentContext();
  const token = loopbackCtx && loopbackCtx.get('accessToken');
  const userId = token && token.userId;
  
  console.log('Update request received:', { updateItems, ids, modelName, where, trackChanges });
  
  // Enhanced field validation function - allows ALL fields except system fields
  function validateAndFilterFields(dataToValidate, existingRecord = null) {
      const validData = {};
      const modelProperties = Object.keys(TargetModel.definition.properties || {});
      const excludedFields = ['id', 'createdAt', 'updatedAt']; // System fields to exclude
      
      for (const key in dataToValidate) {
          // Skip system fields that shouldn't be manually updated
          if (excludedFields.includes(key)) {
            
              continue;
          }
          
          // Allow ALL other fields (model fields + dynamic fields)
          validData[key] = dataToValidate[key];
          
          // if (modelProperties.includes(key)) {
          //     console.log(`✅ Model field included: ${key}`);
          // } else {
          //     console.log(`🔧 Dynamic field included: ${key}`);
          // }
      }
      
      return validData;
  }
  
  // Handle bulk update (by ids or where condition)
  if (!Array.isArray(updateItems) || updateItems.length === 0 || !updateItems[0].id) {
      if (Array.isArray(updateItems) && updateItems.length === 0) {
          return cb(new Error('updateItems array cannot be empty if it is an array of data'));
      }
      
      let finalWhere = where || {};
      if (ids && ids.length) {
          finalWhere.id = { inq: ids.map(id => (TargetModel.definition.properties.id.type === Number && !isNaN(id)) ? Number(id) : id) };
      }
      
      var dataToUpdate = (Array.isArray(updateItems) && updateItems[0]) ? updateItems[0] : updateItems;
      
      if (!dataToUpdate || typeof dataToUpdate !== 'object' || Array.isArray(dataToUpdate)) {
          return cb(new Error('Update data must be a valid object for single update mode'));
      }
      
      TargetModel.find({ where: finalWhere })
      .then(originalRecords => {
          if (originalRecords.length === 0) {
              return Promise.reject({ statusCode: 404, message: 'No records found to update' });
          }
          
          // Always use individual updates to support dynamic fields
          console.log('🔧 Using individual updates for bulk operation to support all fields (including new dynamic fields)');
          
          const updatePromises = originalRecords.map(record => {
              return new Promise((resolve, reject) => {
                  // Allow all fields except system fields
                  const validData = validateAndFilterFields(dataToUpdate, record);
                  
                  if (Object.keys(validData).length === 0) {
                      return resolve({ 
                          recordId: record.id, 
                          success: false, 
                          message: 'No valid fields to update for this record.' 
                      });
                  }
                  
                  // Store original data for change tracking
                  const originalData = {};
                  Object.keys(validData).forEach(key => {
                      originalData[key] = record[key]; // Will be undefined for new dynamic fields
                  });
                  
                  record.updateAttributes(validData)
                  .then(updatedRecord => {
                      resolve({ 
                          recordId: record.id, 
                          success: true, 
                          originalData, 
                          updatedRecord,
                          validData
                      });
                  })
                  .catch(reject);
              });
          });
          
          return Promise.all(updatePromises);
      })
      .then(updateResults => {
          const successfulUpdates = updateResults.filter(r => r.success);
          const info = { count: successfulUpdates.length };
          
          if (!trackChanges || !LogModel || successfulUpdates.length === 0) {
              return cb(null, { 
                  message: 'Records updated successfully', 
                  count: info.count, 
                  changesTracked: false,
                  results: updateResults
              });
          }
          
          const logEntries = successfulUpdates.map(result => {
              const changes = {};
              Object.keys(result.validData).forEach(key => {
                  const oldValue = result.originalData[key];
                  const newValue = result.validData[key];
                  
                  // Track changes including new fields (from undefined to new value)
                  if (!_.isEqual(oldValue, newValue)) {
                      changes[key] = { 
                          from: oldValue, // Will be undefined for new dynamic fields
                          to: newValue 
                      };
                  }
              });
              
              return {
                  model: modelName,
                  event: 'updated',
                  objectId: result.recordId,
                  createdBy: userId,
                  data: { ...result.validData },
                  changes: changes, 
                  createdAt: moment.utc().toDate()
              };
          });
          
          return LogModel.create(logEntries)
              .then(() => {
                  cb(null, { 
                      message: 'Records updated successfully', 
                      count: info.count, 
                      changesTracked: true,
                      results: updateResults
                  });
              });
      })
      .catch(err => {
          if (err.statusCode === 404) {
              return cb(null, { message: err.message, count: 0 });
          }
          console.error("Error in batch update:", err);
          cb(err);
      });
  }
  // Handle array of individual updates  
  else {
      const updatePromises = updateItems.map(item => {
          return new Promise((resolve, reject) => {
              if (!item.id || !item.data || typeof item.data !== 'object') {
                  return resolve({ id: item.id, success: false, message: 'Invalid item structure (missing id or data is not an object)' });
              }
              
              const id = (TargetModel.definition.properties.id.type === Number && !isNaN(item.id)) ? Number(item.id) : item.id;
              
              TargetModel.findById(id)
              .then(record => {
                  if (!record) {
                      return Promise.reject({ statusCode: 404, message: 'Record not found' });
                  }
                  
                  // Allow all fields except system fields
                  const validDataForItem = validateAndFilterFields(item.data, record);
                  
                  if (Object.keys(validDataForItem).length === 0) {
                      return resolve({ id: item.id, success: false, message: 'No valid fields to update for this item.' });
                  }
                  
                  console.log(`📝 Individual update ${id} - Valid fields: ${Object.keys(validDataForItem).join(', ')}`);
                  
                  const originalData = {};
                  Object.keys(validDataForItem).forEach(key => {
                      originalData[key] = record[key]; // Will be undefined for new dynamic fields
                  });
                  
                  return record.updateAttributes(validDataForItem || {})
                      .then(updated => {
                          if (!trackChanges || !LogModel) {
                              return Promise.resolve({ success: true, updated });
                          }
                          
                          const changes = {};
                          Object.keys(validDataForItem).forEach(key => {
                              const oldValue = originalData[key];
                              const newValue = validDataForItem[key];
                              
                              // Track all changes including new fields
                              if (!_.isEqual(oldValue, newValue)) {
                                  changes[key] = { 
                                      from: oldValue, // Will be undefined for new dynamic fields
                                      to: newValue 
                                  };
                              }
                          });
                          
                          if (Object.keys(changes).length === 0) {
                              return Promise.resolve({ 
                                  success: true, 
                                  changesTracked: false,
                                  message: "Updated, no changes detected for logging"
                              });
                          }
                          
                          const logEntry = {
                              model: modelName,
                              event: 'updated',
                              objectId: record.id,
                              createdBy: userId,
                              data: { ...validDataForItem },
                              changes: changes, 
                              createdAt: moment.utc().toDate()
                          };
                          
                          return LogModel.create(logEntry)
                              .then(() => ({ 
                                  success: true, 
                                  changesTracked: true
                              }));
                      });
              })
              .then(result => {
                  resolve(Object.assign({ id }, result));
              })
              .catch(err => {
                  if (err.statusCode === 404) {
                      resolve({ id, success: false, message: err.message });
                  } else {
                      console.error(`Error updating item ${id}:`, err);
                      resolve({ id, success: false, error: err.message });
                  }
              });
          });
      });

      Promise.all(updatePromises)
          .then(results => {
              cb(null, {
                  message: 'Individual updates completed',
                  results: results,
                  successCount: results.filter(r => r.success).length
              });
          })
          .catch(err => {
              console.error("Critical error during individual updates processing:", err);
              cb(err);
          });
  }
};

AppModel.remoteMethod('updateMany', {
  accepts: [
      { arg: 'updateItems', type: 'any', required: true, description: 'Array of {id, data} objects or single data object. For single object, `ids` or `where` must be provided.' },
      { arg: 'ids', type: 'array', itemType: 'any', description: 'IDs when using single data object. Will be ignored if updateItems is an array of {id,data}.' },
      { arg: 'modelName', type: 'string', required: true },
      { arg: 'where', type: 'object', description: 'LoopBack where filter. Will be ignored if updateItems is an array of {id,data}.' },
      { arg: 'trackChanges', type: 'boolean', default: true }
  ],
  returns: { arg: 'response', type: 'object', root: true },
  http: { path: '/update-records', verb: 'put' }
});


  AppModel.search = function (modelName, query, callback) {
    var Model = AppModel.app.models[modelName];

    Model.find({
      where: {
        $text: { $search: query }
      }

    }, callback);
  };


  AppModel.remoteMethod(
    'search',
    {
      accepts: [{ arg: 'modelName', type: 'string', required: true }, { arg: 'query', type: 'string', required: true }],
      returns: { arg: 'result', type: 'array', root: true },
      http: { path: '/search', verb: 'get' }
    }
  );


  // Remote method to get counts for a specific field and value
  AppModel.getCountsByField = function (modelName, matchCriteria, fieldName, cb) {
    var Model = AppModel.app.models[modelName];

    if (!Model) {
      return cb(new Error('Model not found'));
    }

    console.log("Match Criteria ", JSON.stringify(matchCriteria || {}));

    // matchCriteria is optional and should be combined with { deletedById: null }
    if (typeof matchCriteria === 'string') {
      matchCriteria = JSON.parse(matchCriteria);
    }

    if (matchCriteria) {
      matchCriteria.deletedById = null;
    } else {
      matchCriteria = { deletedById: null };
    }

    // delete matchCriteria.and;

    console.log("Match Criteria ", JSON.stringify(matchCriteria));

    var aggregationPipeline = [
      { $match: matchCriteria },
      { $group: { _id: '$' + fieldName, count: { $sum: 1 } } }
    ];

    var collection = Model.getDataSource().connector.collection(modelName);

    collection.aggregate(aggregationPipeline).toArray(function (err, result) {
      if (err) {
        return cb(err);
      }

      var countsSummary = {};
      result.forEach(function (item) {
        countsSummary[item._id] = item.count;
      });

      cb(null, countsSummary);
    });
  };

  AppModel.remoteMethod('getCountsByField', {
    accepts: [
      { arg: 'modelName', type: 'string', required: true },
      { arg: 'matchCriteria', type: 'object' },
      { arg: 'fieldName', type: 'string', required: true },
    ],
    returns: { arg: 'summary', type: 'object', root: true },
    http: { verb: 'get', path: '/get-counts-by-field' },
  });

  AppModel.recover = function (ids, cb) {
    const DeletedObj = AppModel.app.models.DeletedObj;
  

    // Convert ids to number if they are numeric strings
    // if (ids && ids.length) {
    //   ids = ids.map(id => isNaN(id) ? id : Number(id));
    // }

    // Find records based on where condition
    DeletedObj.find({ where: { id: { inq: ids } } }, function (err, records) {
      if (err) return cb(err);

      

      if (records.length === 0) {
        return cb(null, { message: 'No records found to recover' });
      }

      const TargetModel = AppModel.app.models[records[0].modelName];

      const recoveredRecords = records.map(record => record.data);

      // Create records in original model
      TargetModel.create(recoveredRecords, function (err) {
        if (err) return cb(err);

        // Remove records from DeletedObj
        DeletedObj.destroyAll({ id: { inq: ids } }, function (err) {
          if (err) return cb(err);
          
          cb(null, { message: 'Records recovered successfully' });
        });

      });
    });
  };

  AppModel.remoteMethod('recover', {
    accepts: [
      { arg: 'ids', type: 'array', required: true },
    ],
    returns: { arg: 'response', type: 'object' },
    http: { path: '/recover', verb: 'post' }  

  });


  AppModel.delete = function (ids, modelName, where, soft, cb) {
    const TargetModel = AppModel.app.models[modelName];
    const DeletedObj = AppModel.app.models.DeletedObj;

    if (!TargetModel) {
        return cb(new Error('Invalid model name'));
    }

    // Convert ids to number if they are numeric strings
    if (ids && ids.length) {
        ids = ids.map(id => isNaN(id) ? id : Number(id));
    }

    // Construct final where condition
    let finalWhere = where || {};
    if (ids && ids.length) {
        finalWhere.id = { inq: ids };
    }

    console.log("Delete conditions:", JSON.stringify(finalWhere));

    // Find records based on where condition
    TargetModel.find({ where: finalWhere }, function (err, records) {
        if (err) return cb(err);

        console.log("Records found: ", records.length);

        if (records.length === 0) {
            return cb(null, { message: 'No records found to delete' });
        }

        const trashRecords = records.map(record => ({
            originalId: record.id,
            modelName: modelName,
            data: record,
            createdAt: new Date()
        }));

        if (soft) {
            // Soft delete: Update status instead of actual deletion
            TargetModel.updateAll(finalWhere, { status: 'deleted' }, function (err, info) {
                if (err) return cb(err);
                return cb(null, { message: 'Records soft deleted', details: info });
            });
        } else {
            // Hard delete: Move to DeletedObj and remove from original model
            DeletedObj.create(trashRecords, function (err) {
                if (err) return cb(err);

                TargetModel.destroyAll(finalWhere, function (err, info) {
                    if (err) return cb(err);

                    // Tạo log cho hard delete
                    const LogModel = app.models.log;
                    const loopbackCtx = LoopBackContext.getCurrentContext();
                    const token = loopbackCtx && loopbackCtx.get('accessToken');
                    const userId = token && token.userId;
                    const logEntries = records.map(record => ({
                        model: modelName,
                        event: 'deleted',
                        objectId: record.id,
                        createdById: userId,
                        data: JSON.parse(JSON.stringify(record)),
                        createdAt: new Date()
                    }));
                    LogModel.create(logEntries, function (logErr) {
                        if (logErr) console.error('[AppModel.delete] Lỗi tạo log:', logErr);
                    });

                    cb(null, { message: 'Records deleted and archived in trash', details: info });
                });
            });
        }
    });
};

  AppModel.archive = function (ids, modelName, soft, cb) {
    const TargetModel = AppModel.app.models[modelName];
    const ArchivedObj = AppModel.app.models.ArchivedObj;

    if (!TargetModel) {
      return cb(new Error('Invalid model name ' + JSON.stringify(modelName)));
    }

    // convert ids to number if it is a number in form of string
    ids = ids.map(id => isNaN(id) ? id : Number(id));

    console.log("delete ids ", ids);

    TargetModel.find({ where: { id: { inq: ids } } }, function (err, records) {
      if (err) return cb(err);

      if (records.length === 0) {
        return cb(null, { message: 'No records found to archive' });
      }

      const archiveRecords = records.map(record => ({
        originalId: record.id,
        modelName: modelName,
        data: record,
        createdAt: new Date()
      }));

      if (soft) {
        TargetModel.updateAll({ id: { inq: ids } }, {status: 'archived'}, function (err) {
          if (err) return cb(err);
        });
      } else {
        ArchivedObj.create(archiveRecords, function (err) {
          if (err) return cb(err);

          TargetModel.destroyAll({ id: { inq: ids } }, function (err) {
            if (err) return cb(err);

            cb(null, { message: 'Records archived' });
          });
        });
      }

    });
  };

  

const json2xls = require("json-as-xlsx");
const { parse } = require("json2csv");

AppModel.export = function (modelName, _fields = [], where = {}, format = "json", req, res) {
  const Model = AppModel.app.models[modelName];

  // Convert _fields array into an object for LoopBack's "fields" option
  const selectedFields = _fields.map(field => field.name || field.value).filter(Boolean);
  const fieldsToInclude = selectedFields.length ? Object.fromEntries(selectedFields.map(f => [f, true])) : null;

  Model.find({ where: where, fields: fieldsToInclude }, function (err, data) {
    if (err) {
      return res.status(500).send({ error: err.message });
    }

    if (format === "xlsx") {
      try {
        const csv = parse(data, { fields: selectedFields });

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=${modelName}_export.csv`);
        return res.send(csv);
      } catch (csvErr) {
        return res.status(500).send({ error: csvErr.message });
      }
    } else if (format === "csv") {
      try {
        // Convert data to Excel format
        let xlsxData = [
          {
            sheet: modelName,
            columns: _fields.map(field => ({ label: field.title, value: field.name })),
            // content: data, 
          },
        ];

        let data = [
          {
            sheet: "Adults",
            columns: [
              { label: "User", value: "user" }, // Top level data
              { label: "Age", value: (row) => row.age + " years" }, // Custom format
              { label: "Phone", value: (row) => (row.more ? row.more.phone || "" : "") }, // Run functions
            ],
            content: [
              { user: "Andrea", age: 20, more: { phone: "11111111" } },
              { user: "Luis", age: 21, more: { phone: "12345678" } },
            ],
          },
          {
            sheet: "Children",
            columns: [
              { label: "User", value: "user" }, // Top level data
              { label: "Age", value: "age", format: '# "years"' }, // Column format
              { label: "Phone", value: "more.phone", format: "(###) ###-####" }, // Deep props and column format
            ],
            content: [
              { user: "Manuel", age: 16, more: { phone: 9999999900 } },
              { user: "Ana", age: 17, more: { phone: 8765432135 } },
            ],
          },
        ]

        let xlsx = json2xls(data);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=${modelName}_export.xlsx`);
        return res.send(Buffer.from(xlsx, "binary"));
      } catch (xlsxErr) {
        return res.status(500).send({ error: xlsxErr.message });
      }
    } else {
      return res.json(data);
    }
  });
};

AppModel.remoteMethod("export", {
  accepts: [
    { arg: "modelName", type: "string", required: true },
    { arg: "fields", type: "array", required: false },
    { arg: "where", type: "object", required: false },
    { arg: "format", type: "string", required: false },
    { arg: "req", type: "object", http: { source: "req" } },
    { arg: "res", type: "object", http: { source: "res" } },
  ],
  http: { path: "/export", verb: "get" },
});


// Register remote method
AppModel.remoteMethod('delete', {
  accepts: [
      { arg: 'ids', type: 'array', itemType: 'string', required: false },
      { arg: 'modelName', type: 'string', required: true },
      { arg: 'where', type: 'object', required: false },
      { arg: 'soft', type: 'boolean', required: false }
  ],
  returns: { arg: 'response', type: 'object' },
  http: { path: '/delete', verb: 'delete' }
});
  

  AppModel.remoteMethod('archive', {
    accepts: [
      { arg: 'ids', type: 'array', itemType: 'string', required: true },
      { arg: 'modelName', type: 'string', required: true },
      { arg: 'soft', type: 'boolean', required: false }
    ],
    returns: { arg: 'response', type: 'object' },
    http: { path: '/archive', verb: 'delete' }
  });

  function generateSlug(name) {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')         // Replace spaces with -
      .replace(/[^\w\-]+/g, '')     // Remove all non-word chars
      .replace(/\-\-+/g, '-')       // Replace multiple - with single -
      .replace(/^-+/, '')           // Trim - from start of text
      .replace(/-+$/, '');          // Trim - from end of text
  }

  AppModel.observe('before save', function generateSlug(ctx, next) {
    const model = ctx.Model;
    const inst = ctx.instance || ctx.data;

    console.log('Before save: ....');

    // model can be null, how can get the model from other info
    if (!model) {
      return next && next();
    }


    // Access model properties from settings
    const modelSettings = model.definition.properties;
    console.log(modelSettings);

    if (modelSettings.name && modelSettings.slug && inst && 'name' in inst && !inst.slug) {
      inst.slug = generateSlug(inst.name);
    }

    if (!inst.name && inst.familyName && inst.givenName) {
      inst.name = inst.givenName + ' ' + inst.familyName;
    }

    if (modelSettings.price && modelSettings.quantity && modelSettings.subTotal && inst && inst.price && inst.quantity) {
      inst.subTotal = inst.price * inst.quantity;
    }

     next();
  });



  AppModel.fullTextSearch = function(modelName, query, fields, relationModel, callback) {
    const ds = this.getDataSource().connector;
    const collection = ds.collection(modelName.toLowerCase());
  
    const matchStage = { $match: { $text: { $search: query } } };
    const sortStage = { $sort: { score: { $meta: "textScore" } } };
    const scoreStage = { score: { $meta: "textScore" } };
    let pipeline = [matchStage];
  
    if (relationModel && fields && fields.length > 0) {
      pipeline.push(
        {
          $lookup: {
            from: relationModel.toLowerCase(),  // Use the dynamic relationModel name
            localField: `${relationModel.toLowerCase()}Id`,
            foreignField: '_id',
            as: `${relationModel}Data`
          }
        },
        { $unwind: `$${relationModel}Data` }
      );
  
      // Build dynamic regex-based filtering for fields within relationModel
      const fieldMatches = fields.map(field => ({
        [`${relationModel}Data.${field}`]: new RegExp(query, 'i')
      }));
  
      pipeline.push({ $match: { $or: fieldMatches } });
    }
  
    pipeline.push(sortStage);
  
    collection.aggregate(pipeline).toArray(callback);
  };

  AppModel.remoteMethod('fullTextSearch', {
    accepts: [
      { arg: 'modelName', type: 'string', required: true },
      { arg: 'query', type: 'string', required: true },
      { arg: 'fields', type: 'array', required: false },
      { arg: 'relationModel', type: 'string', required: false }
    ],
    returns: { arg: 'results', type: 'array' },
    http: { path: '/fullTextSearch', verb: 'get' }
  });

  // remote method to print the model with the same template name, using nunjucks
  AppModel.print = function (modelName, id, cb) {
    const Model = AppModel.app.models[modelName];
    if (!Model) {
      return cb(new Error('Model not found'));
    }

    Model.findById(id, function (err, instance) {
      if (err) {
        return cb(err);
      }

      if (!instance) {
        return cb(new Error('Instance not found'));
      }

      const templateName = modelName.toLowerCase();
      const template = app.get('templates')[templateName];

      if (!template) {
        return cb(new Error('Template not found'));
      }

      const nunjucks = require('nunjucks');
      const env = nunjucks.configure('views', { autoescape: true });

      const html = nunjucks.renderString(template, instance);
      cb(null, { html });
    });
  };


  AppModel.remoteMethod('print', {
    accepts: [
      { arg: 'modelName', type: 'string', required: true },
      { arg: 'id', type: 'string', required: true }
    ],
    returns: { arg: 'response', type: 'object' },
    http: { path: '/print', verb: 'get' }
  });


  AppModel.helloTestDang = function(cb) {
    cb(null, 'Hello Test Dang!');
  };

  AppModel.remoteMethod('helloTestDang', {
    http: {
      path: '/hello-test-dang/',
      verb: 'get'
    },
    returns: { arg: 'result', type: 'string' },
    isStatic: true // quan trọng
  });
  
  

};


