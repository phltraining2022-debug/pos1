'use strict';

const fs = require('fs');
const path = require('path');

// Lazy load app để tránh circular dependency
let app = null;
function getApp() {
  if (!app) {
    app = require('../server');
  }
  return app;
}

/**
 * Cache để lưu translations, tránh đọc file nhiều lần
 */
const cache = {};

/**
 * Load translations từ cache hoặc file (sync version)
 * @param {string} tenant - Tên tenant (subdomain) - chỉ dùng để log, không ảnh hưởng logic
 * @param {string} lang - Mã ngôn ngữ (vi, en, ja, ko, etc.)
 * @returns {object} Object chứa các cặp key-value translation
 */
function loadTranslations(tenant, lang = 'vi') {
  const cacheKey = lang; // Chỉ cache theo language, không theo tenant
  
  // Kiểm tra cache trước (có thể đã được load từ DB trước đó)
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }
  
  // Load từ file (fallback)
  const defaultPath = path.join(__dirname, '../translations/default', `${lang}.json`);
  let translations = {};
  
  try {
    if (fs.existsSync(defaultPath)) {
      const data = fs.readFileSync(defaultPath, 'utf8');
      translations = JSON.parse(data);
      console.log(`[i18n] Loaded translations from file for language: ${lang}`);
    } else {
      console.warn(`[i18n] Translation file not found: ${defaultPath}`);
    }
  } catch (error) {
    console.error(`[i18n] Error loading translation file for ${lang}:`, error.message);
    translations = {};
  }
  
  // Lưu vào cache
  cache[cacheKey] = translations;
  
  return translations;
}

/**
 * Load translations từ database (async version)
 * @param {string} tenant - Tên tenant (chỉ để log, không ảnh hưởng)
 * @param {string} lang - Mã ngôn ngữ (vi, en, ja, ko, etc.)
 * @returns {Promise<object>} Object chứa các cặp key-value translation
 */
function loadTranslationsAsync(tenant, lang = 'vi') {
  return new Promise((resolve) => {
    const cacheKey = lang;
    
    // Kiểm tra cache trước
    if (cache[cacheKey]) {
      return resolve(cache[cacheKey]);
    }
    
    try {
      const appInstance = getApp();
      const Translation = appInstance && appInstance.models && appInstance.models.Translation;
      
      if (Translation) {
        // Load translations từ DB theo language
        Translation.findOne({
          where: { language: lang }
        }, function(err, translationRecord) {
          if (!err && translationRecord && translationRecord.translations) {
            let translations = typeof translationRecord.translations === 'string' 
              ? JSON.parse(translationRecord.translations)
              : translationRecord.translations;
            
            if (Object.keys(translations).length > 0) {
              cache[cacheKey] = translations;
              console.log(`[i18n] Loaded translations from DB for language: ${lang}`);
              return resolve(translations);
            }
          }
          
          // Fallback về file nếu không có trong DB
          loadTranslationsFromFile(tenant, lang).then(fileTranslations => {
            cache[cacheKey] = fileTranslations;
            resolve(fileTranslations);
          });
        });
      } else {
        // Fallback về file nếu model chưa sẵn sàng
        loadTranslationsFromFile(tenant, lang).then(fileTranslations => {
          cache[cacheKey] = fileTranslations;
          resolve(fileTranslations);
        });
      }
    } catch (error) {
      console.error(`[i18n] Error loading translations from DB:`, error.message);
      // Fallback về file
      loadTranslationsFromFile(tenant, lang).then(fileTranslations => {
        cache[cacheKey] = fileTranslations;
        resolve(fileTranslations);
      });
    }
  });
}

/**
 * Load translations từ file (helper function)
 */
function loadTranslationsFromFile(tenant, lang = 'vi') {
  return new Promise((resolve) => {
    let translations = {};
    
    // Load translations từ file
    const defaultPath = path.join(__dirname, '../translations/default', `${lang}.json`);
    
    try {
      if (fs.existsSync(defaultPath)) {
        const data = fs.readFileSync(defaultPath, 'utf8');
        translations = JSON.parse(data);
        console.log(`[i18n] Loaded translations from file for language: ${lang}`);
      }
    } catch (error) {
      console.error(`[i18n] Error loading translation file for ${lang}:`, error.message);
    }
    
    resolve(translations);
  });
}

/**
 * Dịch một key
 * @param {string} key - Key cần dịch
 * @param {string} tenant - Tên tenant
 * @param {string} lang - Mã ngôn ngữ
 * @param {object} params - Tham số để thay thế trong text (optional)
 * @returns {string} Text đã dịch
 */
function translate(key, tenant, lang = 'vi', params = {}) {
  const translations = loadTranslations(tenant, lang);
  let text = translations[key] || key;
  
  // Thay thế placeholders như {{name}}, {{count}}, etc.
  if (params && typeof params === 'object') {
    Object.keys(params).forEach(param => {
      const regex = new RegExp(`{{${param}}}`, 'g');
      text = text.replace(regex, params[param]);
    });
  }
  
  return text;
}

/**
 * Auto-translate HTML content
 * Tự động replace các text trong HTML theo translation mapping
 * @param {string} html - HTML content cần translate
 * @param {string} tenant - Tên tenant
 * @param {string} lang - Ngôn ngữ đích
 * @returns {string} HTML đã được translate
 */
function autoTranslateHTML(html, tenant, lang = 'vi') {
  // Nếu là tiếng Việt (default), không cần translate
  if (lang === 'vi') return html;
  
  const translations = loadTranslations(tenant, lang);
  const viTranslations = loadTranslations(tenant, 'vi');
  
  // Tạo reverse mapping: Vietnamese text -> Target language text
  const mapping = {};
  Object.keys(translations).forEach(key => {
    const viText = viTranslations[key];
    const targetText = translations[key];
    if (viText && targetText && viText !== targetText) {
      mapping[viText] = targetText;
    }
  });
  
  // Replace text trong HTML
  // Sort by length descending để replace chuỗi dài trước (tránh replace sai)
  const sortedTexts = Object.keys(mapping).sort((a, b) => b.length - a.length);
  
  let result = html;
  let replaceCount = 0;
  
  sortedTexts.forEach(viText => {
    const targetText = mapping[viText];
    // Escape special regex characters
    const escapedText = viText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedText, 'g');
    const matches = result.match(regex);
    if (matches) {
      replaceCount += matches.length;
      result = result.replace(regex, targetText);
    }
  });
  
  if (replaceCount > 0) {
    console.log(`[i18n] Auto-translated ${replaceCount} text segments to ${lang}`);
  }
  
  return result;
}

/**
 * Lấy danh sách ngôn ngữ có sẵn
 * @returns {array} Mảng các mã ngôn ngữ
 */
function getAvailableLanguages() {
  // Lấy từ file (vì đây là sync function, không thể query DB)
  try {
    const defaultPath = path.join(__dirname, '../translations/default');
    if (fs.existsSync(defaultPath)) {
      const files = fs.readdirSync(defaultPath);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    }
  } catch (error) {
    console.error('[i18n] Error getting available languages:', error.message);
  }
  
  return ['vi', 'en']; // fallback
}

/**
 * Xóa cache (dùng khi update translations)
 * @param {string} tenant - Tên tenant (không dùng, chỉ để tương thích)
 * @param {string} lang - Mã ngôn ngữ (optional)
 */
function clearCache(tenant = null, lang = null) {
  if (lang) {
    delete cache[lang];
    console.log(`[i18n] Cache cleared for language: ${lang}`);
  } else {
    Object.keys(cache).forEach(key => delete cache[key]);
    console.log('[i18n] All translation cache cleared');
  }
}

module.exports = {
  loadTranslations,
  loadTranslationsAsync,
  translate,
  autoTranslateHTML,
  getAvailableLanguages,
  clearCache
};

