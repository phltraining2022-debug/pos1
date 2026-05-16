/**
 * Analytics Cache and Advanced Analytics
 * Provides caching mechanism and advanced analytics features
 */

module.exports = function(app) {
  'use strict';

  const moment = require('moment');
  const redis = require('redis');
  const client = redis.createClient();

  // Cache configuration
  const CACHE_TTL = 300; // 5 minutes
  const CACHE_PREFIX = 'analytics:';

  /**
   * Cache helper functions
   */
  const cacheHelper = {
    /**
     * Get cached data
     */
    get: (key) => {
      return new Promise((resolve, reject) => {
        client.get(CACHE_PREFIX + key, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data ? JSON.parse(data) : null);
          }
        });
      });
    },

    /**
     * Set cached data
     */
    set: (key, data, ttl = CACHE_TTL) => {
      return new Promise((resolve, reject) => {
        client.setex(CACHE_PREFIX + key, ttl, JSON.stringify(data), (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },

    /**
     * Delete cached data
     */
    del: (key) => {
      return new Promise((resolve, reject) => {
        client.del(CACHE_PREFIX + key, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },

    /**
     * Clear all analytics cache
     */
    clearAll: () => {
      return new Promise((resolve, reject) => {
        client.keys(CACHE_PREFIX + '*', (err, keys) => {
          if (err) {
            reject(err);
          } else if (keys.length > 0) {
            client.del(keys, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          } else {
            resolve();
          }
        });
      });
    }
  };

  /**
   * Advanced analytics helper functions
   */
  const analyticsHelper = {
    /**
     * Calculate percentage change
     */
    calculatePercentageChange: (current, previous) => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }
      return ((current - previous) / previous * 100).toFixed(2);
    },

    /**
     * Calculate moving average
     */
    calculateMovingAverage: (data, period = 7) => {
      const result = [];
      for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
      }
      return result;
    },

    /**
     * Calculate trend direction
     */
    calculateTrend: (data) => {
      if (data.length < 2) return 'stable';
      
      const recent = data.slice(-3);
      const previous = data.slice(-6, -3);
      
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
      
      const change = ((recentAvg - previousAvg) / previousAvg * 100);
      
      if (change > 5) return 'increasing';
      if (change < -5) return 'decreasing';
      return 'stable';
    }
  };

  /**
   * Get cached analytics data with fallback
   */
  app.get('/api/analytics/cached/overview', function(req, res) {
    const cacheKey = 'overview:' + moment().format('YYYY-MM-DD');
    
    cacheHelper.get(cacheKey)
      .then(cachedData => {
        if (cachedData) {
          return res.json({
            success: true,
            data: cachedData,
            cached: true,
            timestamp: new Date().toISOString()
          });
        }
        
        // If no cache, fetch fresh data
        return fetchOverviewData()
          .then(data => {
            // Cache the result
            return cacheHelper.set(cacheKey, data)
              .then(() => {
                res.json({
                  success: true,
                  data: data,
                  cached: false,
                  timestamp: new Date().toISOString()
                });
              });
          });
      })
      .catch(error => {
        console.error('Cached overview analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Fetch overview data (helper function)
   */
  function fetchOverviewData() {
    const currentDate = moment();
    const startOfMonth = moment().startOf('month');
    const endOfMonth = moment().endOf('month');
    const startOfYear = moment().startOf('year');
    const endOfYear = moment().endOf('year');
    const startOfPreviousMonth = moment().subtract(1, 'month').startOf('month');
    const endOfPreviousMonth = moment().subtract(1, 'month').endOf('month');

    return Promise.all([
      // Current month data
      app.models.Customer.count({
        createdAt: {
          gte: startOfMonth.toDate(),
          lte: endOfMonth.toDate()
        }
      }),
      
      app.models.Lead.count({
        createdAt: {
          gte: startOfMonth.toDate(),
          lte: endOfMonth.toDate()
        }
      }),
      
      app.models.Transaction ? app.models.Transaction.find({
        where: {
          createdAt: {
            gte: startOfMonth.toDate(),
            lte: endOfMonth.toDate()
          },
          status: 'completed'
        }
      }).then(transactions => {
        return transactions.reduce((sum, transaction) => {
          return sum + (transaction.amount || 0);
        }, 0);
      }) : Promise.resolve(0),
      
      // Previous month data for comparison
      app.models.Customer.count({
        createdAt: {
          gte: startOfPreviousMonth.toDate(),
          lte: endOfPreviousMonth.toDate()
        }
      }),
      
      app.models.Lead.count({
        createdAt: {
          gte: startOfPreviousMonth.toDate(),
          lte: endOfPreviousMonth.toDate()
        }
      }),
      
      app.models.Transaction ? app.models.Transaction.find({
        where: {
          createdAt: {
            gte: startOfPreviousMonth.toDate(),
            lte: endOfPreviousMonth.toDate()
          },
          status: 'completed'
        }
      }).then(transactions => {
        return transactions.reduce((sum, transaction) => {
          return sum + (transaction.amount || 0);
        }, 0);
      }) : Promise.resolve(0),
      
      // Yearly totals
      app.models.Customer.count({
        createdAt: {
          gte: startOfYear.toDate(),
          lte: endOfYear.toDate()
        }
      }),
      
      app.models.Lead.count({
        createdAt: {
          gte: startOfYear.toDate(),
          lte: endOfYear.toDate()
        }
      }),
      
      app.models.Transaction ? app.models.Transaction.find({
        where: {
          createdAt: {
            gte: startOfYear.toDate(),
            lte: endOfYear.toDate()
          },
          status: 'completed'
        }
      }).then(transactions => {
        return transactions.reduce((sum, transaction) => {
          return sum + (transaction.amount || 0);
        }, 0);
      }) : Promise.resolve(0)
    ])
    .then(([monthlyCustomers, monthlyLeads, monthlyRevenue, prevMonthlyCustomers, prevMonthlyLeads, prevMonthlyRevenue, yearlyCustomers, yearlyLeads, yearlyRevenue]) => {
      return {
        currentMonth: {
          customers: monthlyCustomers,
          leads: monthlyLeads,
          revenue: monthlyRevenue
        },
        previousMonth: {
          customers: prevMonthlyCustomers,
          leads: prevMonthlyLeads,
          revenue: prevMonthlyRevenue
        },
        yearly: {
          customers: yearlyCustomers,
          leads: yearlyLeads,
          revenue: yearlyRevenue
        },
        trends: {
          customers: analyticsHelper.calculatePercentageChange(monthlyCustomers, prevMonthlyCustomers),
          leads: analyticsHelper.calculatePercentageChange(monthlyLeads, prevMonthlyLeads),
          revenue: analyticsHelper.calculatePercentageChange(monthlyRevenue, prevMonthlyRevenue)
        },
        period: {
          currentMonth: currentDate.format('MMMM YYYY'),
          previousMonth: moment().subtract(1, 'month').format('MMMM YYYY'),
          currentYear: currentDate.format('YYYY')
        }
      };
    });
  }

  /**
   * Get advanced analytics with trends and predictions
   */
  app.get('/api/analytics/advanced/trends', function(req, res) {
    const period = req.query.period || 'monthly';
    const limit = parseInt(req.query.limit) || 12;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const cacheKey = `trends:${period}:${limit}`;
    
    cacheHelper.get(cacheKey)
      .then(cachedData => {
        if (cachedData) {
          return res.json({
            success: true,
            data: cachedData,
            cached: true
          });
        }

        // Generate periods for trend analysis
        const periods = [];
        for (let i = limit - 1; i >= 0; i--) {
          const periodStart = moment().subtract(i, 'month').startOf('month');
          const periodEnd = moment().subtract(i, 'month').endOf('month');
          
          periods.push({
            period: periodStart.format('YYYY-MM'),
            start: periodStart.toDate(),
            end: periodEnd.toDate(),
            label: periodStart.format('MMM YYYY')
          });
        }

        // Fetch data for all periods
        Promise.all(periods.map(period => {
          return Promise.all([
            app.models.Customer.count({
              createdAt: {
                gte: period.start,
                lte: period.end
              }
            }),
            
            app.models.Lead.count({
              createdAt: {
                gte: period.start,
                lte: period.end
              }
            }),
            
            app.models.Transaction ? app.models.Transaction.find({
              where: {
                createdAt: {
                  gte: period.start,
                  lte: period.end
                },
                status: 'completed'
              }
            }).then(transactions => {
              return transactions.reduce((sum, transaction) => {
                return sum + (transaction.amount || 0);
              }, 0);
            }) : Promise.resolve(0)
          ]).then(([customers, leads, revenue]) => ({
            period: period.period,
            label: period.label,
            customers: customers,
            leads: leads,
            revenue: revenue
          }));
        }))
        .then(trendData => {
          // Calculate trends and moving averages
          const customerTrends = trendData.map(d => d.customers);
          const leadTrends = trendData.map(d => d.leads);
          const revenueTrends = trendData.map(d => d.revenue);

          const result = {
            period: period,
            data: trendData,
            trends: {
              customers: {
                trend: analyticsHelper.calculateTrend(customerTrends),
                movingAverage: analyticsHelper.calculateMovingAverage(customerTrends, 3)
              },
              leads: {
                trend: analyticsHelper.calculateTrend(leadTrends),
                movingAverage: analyticsHelper.calculateMovingAverage(leadTrends, 3)
              },
              revenue: {
                trend: analyticsHelper.calculateTrend(revenueTrends),
                movingAverage: analyticsHelper.calculateMovingAverage(revenueTrends, 3)
              }
            },
            summary: {
              totalCustomers: customerTrends.reduce((a, b) => a + b, 0),
              totalLeads: leadTrends.reduce((a, b) => a + b, 0),
              totalRevenue: revenueTrends.reduce((a, b) => a + b, 0),
              averageCustomers: (customerTrends.reduce((a, b) => a + b, 0) / customerTrends.length).toFixed(2),
              averageLeads: (leadTrends.reduce((a, b) => a + b, 0) / leadTrends.length).toFixed(2),
              averageRevenue: (revenueTrends.reduce((a, b) => a + b, 0) / revenueTrends.length).toFixed(2)
            }
          };

          // Cache the result
          return cacheHelper.set(cacheKey, result, 600) // 10 minutes cache
            .then(() => {
              res.json({
                success: true,
                data: result,
                cached: false
              });
            });
        });
      })
      .catch(error => {
        console.error('Advanced trends analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Clear analytics cache
   */
  app.post('/api/analytics/cache/clear', function(req, res) {
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    cacheHelper.clearAll()
      .then(() => {
        res.json({
          success: true,
          message: 'Analytics cache cleared successfully'
        });
      })
      .catch(error => {
        console.error('Clear cache error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to clear cache',
          error: error.message
        });
      });
  });

  /**
   * Get analytics cache status
   */
  app.get('/api/analytics/cache/status', function(req, res) {
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    client.keys(CACHE_PREFIX + '*', (err, keys) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Failed to get cache status',
          error: err.message
        });
      }

      res.json({
        success: true,
        data: {
          totalCachedItems: keys.length,
          cachePrefix: CACHE_PREFIX,
          cacheTTL: CACHE_TTL,
          keys: keys.map(key => key.replace(CACHE_PREFIX, ''))
        }
      });
    });
  });

  console.log('Analytics Cache and Advanced Analytics loaded');
}; 