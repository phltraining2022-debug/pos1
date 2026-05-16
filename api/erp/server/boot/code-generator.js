'use strict';

const _ = require('lodash');
const redis = require('redis');
const moment = require('moment');
const client = redis.createClient();

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
    const obj = instance; // eslint-disable-line no-unused-vars
    try {
      // eslint-disable-next-line no-eval
      resolved[key] = eval(definition);
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

const incrSequence = ({ datasource, modelKey, groupKey }) =>
  new Promise((resolve, reject) => {
    const redisKey = ['code-seq', datasource || 'default', modelKey, groupKey || 'default']
      .filter(Boolean)
      .join(':');
    client.incr(redisKey, (err, value) => (err ? reject(err) : resolve(value)));
  });

const buildFallbackCfg = (modelKey, options = {}) => {
  const prefix =
    options.prefix ||
    (modelKey && modelKey[0] ? modelKey[0].toUpperCase() : 'X');
  const length = options.counterLength || 4;
  const counterToken = '#'.repeat(length);

  return {
    idProperty: options.idProperty || 'code',
    fmt: `${prefix}${counterToken}`,
    fmtProperties: {
      [counterToken]: 'maxFmt(fallbackCounter)',
    },
  };
};

const generateModelCode = async ({ Model, instance, options = {} }) => {
  const app = Model.app;
  const dataSourceName =
    options.datasource ||
    Model.dataSource?.name ||
    Model.currentDatasource ||
    'default';
  const modelKey = options.modelKey || Model.modelName;

  let cfg = _.get(
    app.dataSources[dataSourceName],
    `clinic.codeCfg.${modelKey}`
  );

  if (
    (!cfg || typeof cfg.fmt !== 'string' || typeof cfg.fmtProperties !== 'object') &&
    options.useFallback !== false
  ) {
    cfg = buildFallbackCfg(modelKey, options.fallback || {});
  }

  if (!cfg || typeof cfg.fmt !== 'string' || typeof cfg.fmtProperties !== 'object') {
    return null;
  }

  const { fmt, fmtProperties } = cfg;
  const idProperty = cfg.idProperty || options.idProperty || 'code';

  const { resolved, counterKey, sortedKeys } = resolvePlaceholders(
    fmtProperties,
    instance
  );

  let currentIdString = applyResolvedPlaceholders(fmt, resolved, sortedKeys, counterKey);

  if (counterKey) {
    const groupValue = (options.groupBy || [])
      .map((field) => _.get(instance, field) || 'all')
      .join('|') || 'default';

    const nextNumber = await incrSequence({
      datasource: dataSourceName,
      modelKey,
      groupKey: groupValue,
    });

    const padded = String(nextNumber).padStart(counterKey.length, '0');
    currentIdString = currentIdString.replace(counterKey, padded);
  }

  return { idProperty, value: currentIdString };
};

module.exports = { generateModelCode };