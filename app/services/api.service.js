// API Base URL Configuration
const API_BASE_URL = 'https://kara.test.live1.vn/api/';

// ApiService.js
angular.module('karaApp') // Or your actual application module name
  .config(function ($provide, $httpProvider) {

    $provide.factory('httpInterceptor', ['$q', '$injector', function ($q, $injector) {
      function reportAuthExpired(response, reason) {
        try {
          var apiService = $injector.get('ApiService');
          if (apiService && typeof apiService.reportAuthExpired === 'function') {
            apiService.reportAuthExpired(response, reason || '401');
          }
        } catch (e) {
          console.warn('httpInterceptor reportAuthExpired failed:', e);
        }
      }

      return {
        // Intercept request
        request: function (config) {
          // Don't add Authorization header for CDN uploads or login requests
          if (!config.url.includes('cdn.live1.vn') && !/\/login(\?|$)/.test(config.url)) {
            config.headers['Authorization'] = localStorage.getItem('$LoopBack$accessTokenId'); // Example header
          }
          return config;
        },
        response: function (response) {
          // Check if the response contains JSON data
          if (response.headers('content-type') && response.headers('content-type').indexOf('application/json') !== -1) {
            // Customize parsing of the JSON response data here
            response.data = JSON.parse(JSON.stringify(response.data), function (key, value) {
              // Example: Convert ISO date strings to Date objects
              if (typeof value === 'string' && value.length === 24) {
                if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)) {
                  return new Date(value);
                }
              }
              // Return other values as is
              return value;
            });
          }
          return response || $q.when(response);
        },
        responseError: function (response) {
          var requestUrl = response && response.config && response.config.url ? response.config.url : '';
          if (response && response.status === 401 && !/\/login(\?|$)/.test(requestUrl)) {
            reportAuthExpired(response, 'http-interceptor-401');
          }
          return $q.reject(response);
        }
      };
    }]);

    $httpProvider.interceptors.push('httpInterceptor');
  })
  .factory('ApiService', ['$http', '$q', '$rootScope', 'SocketService', function ($http, $q, $rootScope, SocketService) {
    // --- Pre-loaded Data Stores ---
    let _cfgData = null; // Populated by loadAllCfgInternal() at startup
    let _modelSchemas = null; // Populated by loadModelSchemasInternal() at startup
    let _cfgMap = {}; // id to cfg map for quick lookup
    // --- Promises to manage initial loading state ---
    let _cfgLoadingPromise = null;
    let _schemasLoadingPromise = null;
    let _xobjs = {}; // id to object map for caching fetched objects

    // --- Internal Helper: Get Base API URL (centralized within ApiService) ---
    function getBaseUrl() {
      // This should be your application's configured API base URL.
      // It could come from an Angular constant, a config service, or be hardcoded here.
      return API_BASE_URL; // EXAMPLE: Replace with your actual base URL or config mechanism
    }

    // --- Internal Helper: Get plural model name ---
    // Hardcoded overrides for models whose plural doesn't follow English rules
    const _pluralOverrides = {
      'log':   'log',
      'staff': 'staff',
      'news':  'news',
    };

    function getPluralModelName(modelName) {
      if (_modelSchemas && _modelSchemas[modelName] && _modelSchemas[modelName].plural) {
        return _modelSchemas[modelName].plural.toLowerCase();
      }
      // Hardcoded fallback for known irregular plurals
      if (_pluralOverrides[modelName.toLowerCase()]) {
        return _pluralOverrides[modelName.toLowerCase()];
      }
      // Fallback: simple pluralization
      const lowerModel = modelName.toLowerCase();
      if (lowerModel.endsWith('s')) {
        return lowerModel; // Already plural
      } else if (lowerModel.endsWith('y') && !lowerModel.endsWith('ay') && !lowerModel.endsWith('ey') && !lowerModel.endsWith('iy') && !lowerModel.endsWith('oy') && !lowerModel.endsWith('uy')) {
        return lowerModel.slice(0, -1) + 'ies';
      } else if (lowerModel.endsWith('ch') || lowerModel.endsWith('sh') || lowerModel.endsWith('x') || lowerModel.endsWith('z') || lowerModel.endsWith('s')) {
        return lowerModel + 'es';
      } else {
        return lowerModel + 's';
      }
    }

    // --- Internal Helper: Build Filter Config for $http (LoopBack style) ---
    function buildHttpConfigWithFilter(filter, include) {
      const config = { params: {} };
      const filterObj = {};

      if (filter && Object.keys(filter).length > 0) {
        angular.extend(filterObj, filter);
      }

      if (include) {
        filterObj.include = include;
      }

      if (Object.keys(filterObj).length > 0) {
        config.params.filter = JSON.stringify(filterObj);
      }

      return config;
    }

    function getTokenExpiry() {
      var raw = localStorage.getItem('$LoopBack$tokenExpiry');
      if (!raw) {
        return null;
      }

      var expiry = Number(raw);
      return isNaN(expiry) ? null : expiry;
    }

    function clearStoredSession() {
      [
        '$LoopBack$accessTokenId',
        '$LoopBack$tokenExpiry',
        '$LoopBack$user',
        '$LoopBack$rememberModel',
        '$LoopBack$rememberCreds',
        'userProfile',
        'currentUser'
      ].forEach(function(key) {
        localStorage.removeItem(key);
      });
    }

    function normalizeAuthError(error) {
      var statusCode = null;
      var message = '';

      if (typeof error === 'string') {
        message = error;
      } else if (error && typeof error === 'object') {
        statusCode = error.statusCode || error.status || (error.data && error.data.error && error.data.error.statusCode) || null;
        if (error.data && error.data.error && error.data.error.message) {
          message = error.data.error.message;
        } else if (error.message) {
          message = error.message;
        } else if (error.statusText) {
          message = error.statusText;
        }
      }

      return {
        statusCode: statusCode ? Number(statusCode) : null,
        message: message || ''
      };
    }

    function isAuthError(error) {
      var info = normalizeAuthError(error);
      var normalizedMessage = (info.message || '').toLowerCase();
      return info.statusCode === 401 ||
        normalizedMessage.indexOf('invalid or expired access token') >= 0 ||
        normalizedMessage.indexOf('access token required') >= 0 ||
        normalizedMessage.indexOf('unauthorized') >= 0 ||
        normalizedMessage.indexOf('token expired') >= 0 ||
        normalizedMessage.indexOf('session expired') >= 0;
    }

    // --- Internal Loading Functions for Startup ---
    function loadAllCfgInternal(forceRefresh = false) {
      if (_cfgData && !forceRefresh) {
        return $q.resolve(angular.copy(_cfgData));
      }
      if (_cfgLoadingPromise && !forceRefresh) {
        return _cfgLoadingPromise;
      }
      const deferred = $q.defer();
      _cfgLoadingPromise = deferred.promise;

      const filter = {
      };
      $http.get(getBaseUrl() + 'Cfgs', buildHttpConfigWithFilter(filter)) // Assuming plural 'Cfgs'
        .then(function (response) {
          _cfgData = angular.copy(response.data);
          deferred.resolve(angular.copy(_cfgData));
        })
        .catch(function (error) {
          console.error('ApiService.loadAllCfgInternal: FATAL Error loading Cfg data:', error.data || error);
          _cfgData = null;
          deferred.reject(error.data || error);
        })
        .finally(function () {
          _cfgLoadingPromise = null;
        });
      return deferred.promise;
    }

    function loadModelSchemasInternal(forceRefresh = false) {
      if (_modelSchemas && !forceRefresh) { return $q.resolve(angular.copy(_modelSchemas)); }
      if (_schemasLoadingPromise && !forceRefresh) { return _schemasLoadingPromise; }
      const deferred = $q.defer();
      _schemasLoadingPromise = deferred.promise;
      $http.get(getBaseUrl() + '_models') // Your endpoint for all model definitions
        .then(function (response) {
          const schemasArray = response.data;
          let tempSchemas = {};
          if (Array.isArray(schemasArray)) {
            schemasArray.forEach(function (schema) { if (schema && schema.name) { tempSchemas[schema.name] = schema; } });
          } else if (typeof schemasArray === 'object' && schemasArray !== null) {
            tempSchemas = angular.copy(schemasArray); // If API returns an object map
          } else {
            console.warn('ApiService.loadModelSchemasInternal: Expected an array or object of schemas, received:', schemasArray);
          }
          _modelSchemas = tempSchemas;
          deferred.resolve(angular.copy(_modelSchemas));
        })
        .catch(function (error) {
          console.error('ApiService.loadModelSchemasInternal: FATAL Error loading model schemas:', error.data || error);
          _modelSchemas = null;
          deferred.reject(error.data || error);
        })
        .finally(function () { _schemasLoadingPromise = null; });
      return deferred.promise;
    }

    // --- Public Service Object ---
    const service = {
      getBaseUrl: getBaseUrl, // Expose if other services/parts might need it (though ideally not)
      buildConfigWithFilter: buildHttpConfigWithFilter, // Expose if other services/parts might need it

      initializeAppCriticalData: function () {
        console.log("ApiService.initializeAppCriticalData: Pre-loading critical data for the app...");
        return $q.all({
          configs: loadAllCfgInternal(),
          schemas: loadModelSchemasInternal()
        });
      },

      loadCfgsMap: function () {
        console.log("ApiService.loadCfgsMap: Loading Cfgs map...");
        return loadAllCfgInternal().then(function (cfgs) {

          cfgs.forEach(function (cfg) {
            _cfgMap[cfg.id] = cfg;
          });
          return _cfgMap;
        });
      },

      getCfgs: function (associatedModel, cfgType) {
        if (!_cfgData) {
          const errorMsg = "ApiService.getCfgs: Cfg data not pre-loaded. Ensure initializeAppCriticalData() was successful during app startup.";
          console.error(errorMsg);
          return $q.reject(errorMsg);
        }
        let filtered = _cfgData;
        if (associatedModel) {
          filtered = filtered.filter(cfg => cfg.models && Array.isArray(cfg.models) && cfg.models.includes(associatedModel));
        }
        if (cfgType) {
          filtered = filtered.filter(cfg => cfg.fields && cfg.fields.includes(cfgType));
        }
        const result = filtered
          .map(cfg => ({
            id: cfg.id, name: cfg.nameVi || cfg.name, originalId: cfg.id, order: cfg.order || 0,
            type: cfg.type, models: cfg.models, raw: cfg
          }))
          .sort((a, b) => (a.order !== b.order) ? a.order - b.order : (a.name || '').localeCompare(b.name || ''));
        return $q.when(result);
      },

      getModelSchema: function (modelName) {
        if (!_modelSchemas) {
          const errorMsg = "ApiService.getModelSchema: Model Schemas not found. Ensure initializeAppCriticalData() was successful.";
          console.error(errorMsg);
          return $q.reject(errorMsg);
        }
        const schema = _modelSchemas[modelName] ? angular.copy(_modelSchemas[modelName]) : undefined;
        return $q.when(schema);
      },

      getAll: function (modelName, filter, forceRefresh = false, httpConfig = {}) {
        const deferred = $q.defer();
        // Caching for getAll can be added here if needed, using _cache.
        // For simplicity, this example doesn't include complex caching for getAll with filters.
        const finalHttpConfig = angular.extend({}, buildHttpConfigWithFilter(filter), httpConfig);

        const url = getBaseUrl() + getPluralModelName(modelName);
        console.log('ApiService.getAll:', {
          modelName: modelName,
          filter: filter,
          url: url,
          finalHttpConfig: finalHttpConfig
        });

        $http.get(url, finalHttpConfig)
          .then(function (response) {

            if (Object.keys(_cfgMap).length === 0) {
              for (const key in _cfgData) {
                _cfgMap[_cfgData[key].id] = _cfgData[key];
              }
            }

            // update xobjs cache
            if (Array.isArray(response.data)) {
              response.data.forEach(item => {
                if (item && item.id) {
                  _xobjs[item.id] = item; // Cache by ID

                  // find all relations of this object
                  for (const key in item) {
                    // if item.key is object and has id, then it is a relation
                    if (key === 'eventType') {
                      item[key + 'Name'] = _cfgMap[item[key]] && (_cfgMap[item[key]].nameVi || _cfgMap[item[key]].name || '');
                    }

                    if (item[key] && typeof item[key] === 'object' && item[key].id) {
                      // Cache the related object by its ID
                      _xobjs[item[key].id] = item[key];
                    }
                  }
                }
              });
            }
            // Resolve with the data
            return deferred.resolve(response.data);
          })
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      getById: function (modelName, id, filter, include, forceRefresh = false, httpConfig = {}) {
        const deferred = $q.defer();
        const finalHttpConfig = angular.extend({}, buildHttpConfigWithFilter(filter, include), httpConfig);
        $http.get(getBaseUrl() + getPluralModelName(modelName) + '/' + id, finalHttpConfig)
          .then((response) => {
            if (response.data && response.data.id) {
              _xobjs[response.data.id] = response.data; // Cache by ID
              // find all relations of this object
              for (const key in response.data) {
                // if response.data[key] is object and has id, then it is a relation
                if (response.data[key] && typeof response.data[key] === 'object' && response.data[key].id) {
                  // Cache the related object by its ID
                  _xobjs[response.data[key].id] = response.data[key];
                }
              }
            }
            // Resolve with the data
            return deferred.resolve(response.data);
          })
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      count: function (modelName, whereFilter = {}) {
        const deferred = $q.defer();
        // Ensure whereFilter is an object, even if empty
        const params = { where: JSON.stringify(angular.isObject(whereFilter) ? whereFilter : {}) };
        $http.get(getBaseUrl() + getPluralModelName(modelName) + '/count', { params: params })
          .then(response => deferred.resolve(response.data)) // Expects {count: X}
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      create: function (modelName, data) {
        if (!data.createdById) {
          data.createdById = this.getCurrentUser() ? this.getCurrentUser().id : null;
        }

        const deferred = $q.defer();
        $http.post(getBaseUrl() + getPluralModelName(modelName), data)
          .then(response => deferred.resolve(response.data))
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      save: function (modelName, data, create = false) {
        console.log('ApiService.save: Saving data for model:', modelName);
        if (create || !data || (!data.id && modelName != 'cfgs') || (modelName == 'cfgs' && !data.createdAt)) {
          // If no ID, treat as create
          return this.create(modelName, data);
        } else {
          return this.update(modelName, data.id, data);
        }
      },

      login: function (modelName, credentials) {
        const deferred = $q.defer();
        // TTL 30 ngày (giây) – tránh token hết hạn khi PWA đóng rồi mở lại
        var loginBody = angular.extend({ ttl: 2592000 }, credentials);
        $http.post(getBaseUrl() + modelName + '/login?include=user', loginBody)
          .then(response => {
            // save access token in localStorage
            localStorage.setItem('$LoopBack$accessTokenId', response.data.id);
            // save token expiry
            localStorage.setItem('$LoopBack$tokenExpiry', Date.now() + 2592000 * 1000);

            // save user data in localStorage as JSON string
            if (response.data && response.data.user) {
              localStorage.setItem('$LoopBack$user', JSON.stringify(response.data.user));

              // Store user data in xobjs cache
              _xobjs[response.data.user.id] = response.data.user;
              deferred.resolve(response.data.user);
            } else {
              deferred.reject('Login response did not contain user data');
            }
          })
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      // Lưu credentials để auto re-login khi token bị xóa (iOS PWA)
      saveRememberMe: function(modelName, credentials) {
        try {
          localStorage.setItem('$LoopBack$rememberModel', modelName);
          localStorage.setItem('$LoopBack$rememberCreds', JSON.stringify(credentials));
        } catch(e) {}
      },

      isSessionExpired: function() {
        var expiry = getTokenExpiry();
        return expiry !== null && Date.now() >= expiry;
      },

      isAuthError: isAuthError,

      reportAuthExpired: function(error, reason) {
        var info = normalizeAuthError(error);
        var message = info.message || 'Phiên đăng nhập đã hết hạn';
        var payload = {
          visible: true,
          message: message,
          reason: reason || 'auth-expired',
          statusCode: info.statusCode || 401
        };

        if ($rootScope.authSessionAlert && $rootScope.authSessionAlert.visible) {
          return info;
        }

        $rootScope.authSessionAlert = payload;
        if (typeof $rootScope.$broadcast === 'function') {
          $rootScope.$broadcast('kara:auth-expired', payload);
        }

        return info;
      },

      hasValidSession: function() {
        var token = localStorage.getItem('$LoopBack$accessTokenId');
        var userData = localStorage.getItem('$LoopBack$user');

        if (!token || !userData) {
          return false;
        }

        return !this.isSessionExpired();
      },

      forceLogout: function(reason) {
        console.warn('Forcing logout:', reason || 'unknown');
        this.clearCache();
        clearStoredSession();

        $rootScope.authSessionAlert = {
          visible: false,
          message: '',
          reason: reason || 'logout',
          statusCode: null
        };

        try {
          if (SocketService && typeof SocketService.disconnect === 'function') {
            SocketService.disconnect();
          }
        } catch (e) {
          console.warn('ApiService.forceLogout: failed to disconnect socket', e);
        }

        try {
          if (typeof $rootScope.$broadcast === 'function') {
            $rootScope.$broadcast('kara:auth-cleared', { reason: reason || 'logout' });
          }
        } catch (e) {}

        return true;
      },

      clearRememberMe: function() {
        localStorage.removeItem('$LoopBack$rememberModel');
        localStorage.removeItem('$LoopBack$rememberCreds');
      },

      // Tự động re-login bằng credentials đã lưu
      restoreSession: function() {
        var self = this;
        var deferred = $q.defer();
        try {
          var model = localStorage.getItem('$LoopBack$rememberModel');
          var creds = JSON.parse(localStorage.getItem('$LoopBack$rememberCreds') || 'null');
          if (!model || !creds) { deferred.reject('no_saved_creds'); return deferred.promise; }
          self.login(model, creds).then(function(user) {
            deferred.resolve(user);
          }).catch(function(err) {
            // credentials sai / server lỗi → hard logout để tránh giữ session nửa sống nửa chết
            self.forceLogout('restore-session-failed');
            deferred.reject(err);
          });
        } catch(e) { deferred.reject(e); }
        return deferred.promise;
      },

      update: function (modelName, id, data) {
        const deferred = $q.defer();

        if (data.protectData) {
          // make sure only the owner/admin can update
          const currentUser = this.getCurrentUser();
          if (!currentUser || (data.createdById && currentUser.id !== data.createdById
            && !currentUser.fullName.toLowerCase().includes('admin'))
            || (data.assignedToId && currentUser.employeeId !== data.assignedToId)
          ) {
            deferred.reject('Unauthorized: You do not have permission to update this record.');
            return deferred.promise;
          }
        }


        $http.put(getBaseUrl() + getPluralModelName(modelName) + '/' + id, data)
          .then(response => deferred.resolve(response.data))
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      getCurrentUser: function () {
        const userJson = localStorage.getItem('$LoopBack$user');
        if (userJson) {
          try {
            const user = JSON.parse(userJson);
            // Cache the user object
            if (user && user.id) {
              _xobjs[user.id] = user;
            }
            return user;
          } catch (e) {
            console.error('ApiService.getCurrentUser: Error parsing user JSON from localStorage', e);
            return null;
          }
        }
        return null;
      },

      delete: function (modelName, id) {
        // Default to soft delete using the updated method
        const deferred = $q.defer();
        $http.delete(getBaseUrl() + getPluralModelName(modelName) + '/' + id)
          .then(response => {
            // Clear cache
            if (_xobjs[id]) {
              delete _xobjs[id];
            }
            deferred.resolve(response.data);
          })
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      // Sửa lại softDelete method để match backend definition
      softDelete: function (modelName, ids = null, where = null, soft = true) {
        const deferred = $q.defer();

        // Validate input parameters
        if (!modelName) {
          deferred.reject('ModelName is required for softDelete');
          return deferred.promise;
        }

        // Build request data based on LoopBack2 remote method signature
        const requestData = {
          modelName: modelName,
          soft: soft // true for soft delete, false for hard delete
        };

        // Add ids array if provided
        if (ids) {
          if (Array.isArray(ids)) {
            requestData.ids = ids;
          } else {
            // Convert single id to array
            requestData.ids = [ids];
          }
        }

        // Add where clause if provided 
        if (where && typeof where === 'object') {
          requestData.where = where;
        }

        // Make DELETE request to the delete remote method (HTTP verb is DELETE)
        $http.delete(getBaseUrl() + 'AppModels/delete', {
          data: requestData,
          headers: {
            'Content-Type': 'application/json'
          }
        })
          .then(function (response) {
            // Clear cache for deleted items if available
            if (requestData.ids && Array.isArray(requestData.ids)) {
              requestData.ids.forEach(function (id) {
                if (_xobjs[id]) {
                  delete _xobjs[id];
                }
              });
            }

            deferred.resolve(response.data);
          })
          .catch(function (err) {
            const errorMsg = err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error');
            console.error('ApiService.softDelete error:', errorMsg);
            deferred.reject(errorMsg);
          });

        return deferred.promise;
      },

      // Convenience method for soft deleting single item by ID
      softDeleteById: function (modelName, id) {
        return this.softDelete(modelName, [id], null, true);
      },

      // Convenience method for hard deleting multiple items
      hardDelete: function (modelName, ids = null, where = null) {
        return this.softDelete(modelName, ids, where, false);
      },

      // Convenience method for soft deleting by where clause
      softDeleteWhere: function (modelName, whereClause) {
        return this.softDelete(modelName, null, whereClause, true);
      },

      // Method for permanent delete (bypass soft delete)
      permanentDelete: function (modelName, id) {
        const deferred = $q.defer();
        $http.delete(getBaseUrl() + modelName + '/' + id)
          .then(response => {
            // Clear cache
            if (_xobjs[id]) {
              delete _xobjs[id];
            }
            deferred.resolve(response.data);
          })
          .catch(err => deferred.reject(err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error')));
        return deferred.promise;
      },

      // Method để restore nhiều item đã xóa (soft deleted)
      restore: function (modelName, ids = null, where = null) {
        const deferred = $q.defer();

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          deferred.reject('IDs array is required for restore');
          return deferred.promise;
        }

        // Backend chỉ cần ids array, không cần modelName và where
        const requestData = {
          ids: ids
        };

        // Make POST request to the recover remote method
        $http.post(getBaseUrl() + 'AppModels/recover', requestData)
          .then(function (response) {
            // Clear cache for restored items nếu có
            ids.forEach(function (id) {
              if (_xobjs[id]) {
                delete _xobjs[id]; // Clear cache để force reload
              }
            });

            deferred.resolve(response.data);
          })
          .catch(function (err) {
            const errorMsg = err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error');
            console.error('ApiService.restore error:', errorMsg);
            deferred.reject(errorMsg);
          });

        return deferred.promise;
      },

      // Convenience method for restoring single item by DeletedObj ID
      restoreById: function (deletedObjId) {
        return this.restore(null, [deletedObjId]);
      },

      getBusinessName: function () {
        const host = window.location.hostname; // e.g. business-name.test.live1.vn
        const [businessName] = host.split('.');
        return businessName;
      },

      // Method để lấy danh sách các item đã bị xóa (soft deleted)
      getDeletedItems: function (modelName = null, filter = {}) {
        const deferred = $q.defer();

        const whereFilter = {};
        if (modelName) {
          whereFilter.modelName = modelName;
        }

        // Merge với filter bổ sung nếu có
        if (filter.where) {
          angular.extend(whereFilter, filter.where);
        }

        const finalFilter = angular.extend({}, filter, { where: whereFilter });

        $http.get(getBaseUrl() + 'DeletedObjs', buildHttpConfigWithFilter(finalFilter))
          .then(function (response) {
            deferred.resolve(response.data);
          })
          .catch(function (err) {
            const errorMsg = err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error');
            console.error('ApiService.getDeletedItems error:', errorMsg);
            deferred.reject(errorMsg);
          });

        return deferred.promise;
      },

      getXObjs() {
        return _xobjs;
      },

      // Clear all internal cache (useful for logout)
      clearCache: function () {
        _xobjs = {};
        _cfgData = null;
        _modelSchemas = null;
      },

      // Force browser cache refresh (useful for critical updates)
      forceCacheRefresh: function () {

        // Clear browser cache if possible
        if ('caches' in window) {
          caches.keys().then(function (names) {
            names.forEach(function (name) {
              caches.delete(name);
            });
          });
        }

        // Add timestamp to force reload CSS and JS
        var version = new Date().getTime();

        // Force reload critical CSS
        var stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
        stylesheets.forEach(function (link) {
          if (link.href.includes('builder-1')) {
            var newHref = link.href.split('?')[0] + '?v=' + version;
            link.href = newHref;
          }
        });

      },

      // --- Stats Methods for LoopBack 2 ---
      getStats: function (modelName, statsConfig) {
        const deferred = $q.defer();

        if (!statsConfig || !Array.isArray(statsConfig)) {
          deferred.resolve([]);
          return deferred.promise;
        }

        // Build promises for each stat using LoopBack count API
        const statPromises = statsConfig.map(function (stat) {
          return this.getCount(modelName, stat.where || {}).then(function (count) {
            return {
              key: stat.key,
              value: count,
              label: stat.label,
              icon: stat.icon,
              color: stat.color,
              bgColor: stat.bgColor,
              suffix: stat.suffix || ''
            };
          }).catch(function (error) {
            console.warn('Stat error for ' + stat.key + ':', error);
            return {
              key: stat.key,
              value: 0,
              label: stat.label,
              icon: stat.icon,
              color: stat.color,
              bgColor: stat.bgColor,
              suffix: stat.suffix || ''
            };
          });
        }.bind(this));

        $q.all(statPromises).then(function (results) {
          deferred.resolve(results);
        }).catch(function (error) {
          console.error('ApiService.getStats: Error calculating stats:', error);
          deferred.resolve([]);
        });

        return deferred.promise;
      },

      // LoopBack 2 count API call
      getCount: function (modelName, where) {
        const deferred = $q.defer();

        // LoopBack 2 count endpoint: GET /api/{model}/count?where={whereFilter}
        const params = {};
        if (where && Object.keys(where).length > 0) {
          params.where = JSON.stringify(where);
        }

        $http.get(this.getBaseUrl() + '/' + modelName + '/count', { params: params })
          .then(function (response) {
            // LoopBack 2 returns: { count: number }
            const count = response.data && response.data.count ? response.data.count : 0;
            deferred.resolve(count);
          }).catch(function (error) {
            console.error('ApiService.getCount error for ' + modelName + ':', error);
            deferred.resolve(0); // Return 0 on error instead of rejecting
          });

        return deferred.promise;
      },

      // Thêm vào service:
      // uploadFile: function(formData) {
      //     return $http.post('https://cdn.live1.vn/xupload', formData, {
      //         headers: { 'Content-Type': undefined }
      //     }).then(function(res) {
      //         return res.data;
      //     });
      // },

      uploadFile: function (formData, additionalHeaders) {
        var headers = { 'Content-Type': undefined };
        // Merge additional headers nếu có và là object
        if (additionalHeaders && typeof additionalHeaders === 'object' && !Array.isArray(additionalHeaders)) {
          Object.keys(additionalHeaders).forEach(function (key) {
            headers[key] = additionalHeaders[key];
          });
        }
        return $http.post('https://cdn.live1.vn/xupload', formData, {
          headers: headers
        }).then(function (res) {
          return res;
        });
      },

      /**
       * Call a custom remote method on a LoopBack model
       * @param {string} modelName - Name of the model
       * @param {string} methodName - Name of the remote method
       * @param {object} params - Parameters to pass to the method
       * @param {string} httpVerb - HTTP verb (GET, POST, PUT, DELETE) - defaults to POST
       * @returns {Promise}
       */
      callMethod: function (modelName, methodName, params, httpVerb = 'POST') {
        const deferred = $q.defer();

        if (!modelName || !methodName) {
          deferred.reject('ModelName and MethodName are required for callMethod');
          return deferred.promise;
        }

        // Build URL for remote method
        const url = getBaseUrl() + modelName + '/' + methodName;

        // Prepare request config
        let requestConfig = {
          method: httpVerb.toUpperCase(),
          url: url,
          headers: {
            'Content-Type': 'application/json'
          }
        };

        // Add params based on HTTP verb
        if (httpVerb.toUpperCase() === 'GET') {
          // For GET, params go in query string
          requestConfig.params = params;
        } else {
          // For POST/PUT/DELETE, params go in request body
          requestConfig.data = params;
        }

        // Make the HTTP request
        $http(requestConfig)
          .then(function (response) {
            deferred.resolve(response.data);
          })
          .catch(function (err) {
            const errorMsg = err.data && err.data.error ? err.data.error : (err.statusText || err.message || 'Unknown error');
            console.error('ApiService.callMethod error:', modelName, methodName, errorMsg);
            deferred.reject(errorMsg);
          });

        return deferred.promise;
      },

      callGetMethod: function (modelName, methodName, params) {
        return this.callMethod(modelName, methodName, params, 'GET');
      },

      callPostMethod: function (modelName, methodName, params) {
        return this.callMethod(modelName, methodName, params, 'POST');
      },

    };
    return service;
  }])

  // Service mới để handle authenticated requests cho các API tối ưu
  .factory('AuthenticatedHttpService', ['$http', '$q', 'ApiService', function ($http, $q, ApiService) {

    /**
     * Helper function to make authenticated API calls
     */
    function makeAuthenticatedRequest(method, url, data, additionalHeaders) {
      // Check if user is still logged in before making request
      var token = localStorage.getItem('$LoopBack$accessTokenId');
      var userData = localStorage.getItem('$LoopBack$user');


      if (!token || !userData) {
        return $q.reject({
          status: 401,
          statusText: 'Unauthorized',
          data: { error: { message: 'No valid authentication token' } }
        });
      }

      var config = {
        method: method,
        url: url,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        cache: false // Disable Angular $http caching
      };

      // Don't add Authorization header for CDN requests
      if (!url.includes('cdn.live1.vn')) {
        config.headers['Authorization'] = token;
      }

      // Merge additional headers if provided
      if (additionalHeaders) {
        angular.extend(config.headers, additionalHeaders);
      }

      if (data) {
        config.data = data;
      }


      return $http(config).then(function (response) {
        return response;
      }).catch(function (error) {
        // Log error với context
        console.error('AuthenticatedHttpService Error:', {
          method: method,
          url: url,
          status: error.status,
          statusText: error.statusText,
          data: error.data
        });

        // If 401, try silent re-login trước khi xóa session
        if (error.status === 401) {
          ApiService.reportAuthExpired(error, 'authenticated-http-401');
        }

        return $q.reject(error);
      });
    }

    return {
      get: function (url, additionalHeaders) {
        // Add cache busting timestamp for permission-related endpoints
        var cacheBustingUrl = url;
        if (url.startsWith('/api/user/') || url.startsWith('/api/users/')) {
          var separator = url.includes('?') ? '&' : '?';
          cacheBustingUrl = url + separator + '_t=' + Date.now();
        }
        return makeAuthenticatedRequest('GET', cacheBustingUrl, null, additionalHeaders);
      },

      post: function (url, data, additionalHeaders) {
        return makeAuthenticatedRequest('POST', url, data, additionalHeaders);
      },

      put: function (url, data, additionalHeaders) {
        return makeAuthenticatedRequest('PUT', url, data, additionalHeaders);
      },

      delete: function (url, additionalHeaders) {
        return makeAuthenticatedRequest('DELETE', url, null, additionalHeaders);
      },

      patch: function (url, data, additionalHeaders) {
        return makeAuthenticatedRequest('PATCH', url, data, additionalHeaders);
      },

      // Method để build query string từ object
      buildQueryString: function (params) {
        return Object.keys(params)
          .filter(key => params[key] !== '' && params[key] !== null && params[key] !== undefined)
          .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
          .join('&');
      },

      // Các helper methods cho các API endpoints cụ thể
      getUserProfile: function () {
        return this.get('/api/users/profile');
      },

      getUserProfileById: function (userId) {
        return this.get('/api/user/' + userId + '/profile');
      },

      getUsersWithRoles: function (params) {
        var queryString = this.buildQueryString(params || {});
        var url = '/api/users/with-roles';
        if (queryString) {
          url += '?' + queryString;
        }
        return this.get(url);
      },

      updateUserRoles: function (userId, roleIds) {
        return this.put('/api/user/' + userId + '/roles', { roleIds: roleIds });
      }
    };
  }]);
