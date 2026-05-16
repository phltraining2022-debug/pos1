
module.exports = function (app) {
  'use strict';

  const moment = require('moment');
  const _ = require('underscore');

  /**
   * Get dashboard overview statistics
   */
  app.get('/api/analytics/dashboard/overview', function (req, res) {
    const currentDate = moment();
    const startOfMonth = moment().startOf('month');
    const endOfMonth = moment().endOf('month');
    const startOfYear = moment().startOf('year');
    const endOfYear = moment().endOf('year');

    // Get current user context
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    // Parallel execution of different analytics queries
    Promise.all([
      // Total customers count
      app.models.Customer.count(),
      
      // Total leads count
      app.models.Lead.count(),
      
      // Total users count
      app.models.user.count(),
      
      // Monthly new customers
      app.models.Customer.count({
        createdAt: {
          gte: startOfMonth.toDate(),
          lte: endOfMonth.toDate()
        }
      }),
      
      // Monthly new leads
      app.models.Lead.count({
        createdAt: {
          gte: startOfMonth.toDate(),
          lte: endOfMonth.toDate()
        }
      }),
      
      // Yearly revenue (if transaction model exists)
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
      }) : Promise.resolve(0),
      
      // Monthly revenue
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
      }) : Promise.resolve(0)
    ])
      .then(([totalCustomers, totalLeads, totalUsers, monthlyCustomers, monthlyLeads, yearlyRevenue, monthlyRevenue]) => {
        res.json({
          success: true,
          data: {
            overview: {
              totalCustomers,
              totalLeads,
              totalUsers,
              monthlyCustomers,
              monthlyLeads,
              yearlyRevenue,
              monthlyRevenue
            },
            period: {
              currentMonth: currentDate.format('MMMM YYYY'),
              currentYear: currentDate.format('YYYY')
            }
          }
        });
      })
      .catch(error => {
        console.error('Analytics overview error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Flexible dashboard overview for any models
   */
  app.get('/api/analytics/dashboard/flexible', function (req, res) {
    const { models, dateField = 'createdAt', statusField, statusValue } = req.query;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    if (!models) {
      return res.status(400).json({
        success: false,
        message: 'Models parameter is required'
      });
    }

    const modelList = models.split(',');
    const currentDate = moment();
    const startOfMonth = moment().startOf('month');
    const endOfMonth = moment().endOf('month');
    const startOfPreviousMonth = moment().subtract(1, 'month').startOf('month');
    const endOfPreviousMonth = moment().subtract(1, 'month').endOf('month');

    // Validate models
    const validModels = [];
    const invalidModels = [];
    
    modelList.forEach(modelName => {
      if (app.models[modelName]) {
        validModels.push(modelName);
      } else {
        invalidModels.push(modelName);
      }
    });

    if (invalidModels.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid models: ${invalidModels.join(', ')}`
      });
    }

    // Build base filter
    const baseFilter = {};
    if (statusField && statusValue) {
      baseFilter[statusField] = statusValue;
    }

    // Get data for all models
    Promise.all(validModels.map(modelName => {
      const model = app.models[modelName];
      
      return Promise.all([
        // Total count
        model.count(baseFilter),
        
        // Current month count
        model.count({
          ...baseFilter,
          [dateField]: {
            gte: startOfMonth.toDate(),
            lte: endOfMonth.toDate()
          }
        }),
        
        // Previous month count
        model.count({
          ...baseFilter,
          [dateField]: {
            gte: startOfPreviousMonth.toDate(),
            lte: endOfPreviousMonth.toDate()
          }
        })
      ]).then(([total, currentMonth, previousMonth]) => {
        const change = previousMonth > 0 ? ((currentMonth - previousMonth) / previousMonth * 100).toFixed(2) : 0;
        return {
          modelName: modelName,
          total: total,
          currentMonth: currentMonth,
          previousMonth: previousMonth,
          change: parseFloat(change)
        };
      });
    }))
      .then(results => {
        res.json({
          success: true,
          data: {
            models: results,
            period: {
              currentMonth: currentDate.format('MMMM YYYY'),
              previousMonth: moment().subtract(1, 'month').format('MMMM YYYY')
            },
            summary: {
              totalModels: results.length,
              totalRecords: results.reduce((sum, model) => sum + model.total, 0),
              totalCurrentMonth: results.reduce((sum, model) => sum + model.currentMonth, 0),
              totalPreviousMonth: results.reduce((sum, model) => sum + model.previousMonth, 0)
            }
          }
        });
      })
      .catch(error => {
        console.error('Flexible dashboard error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Get available models
   */
  app.get('/api/analytics/models', function (req, res) {
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const availableModels = Object.keys(app.models).filter(modelName => {
      const model = app.models[modelName];
      return model && typeof model.count === 'function';
    });

    res.json({
      success: true,
      data: {
        models: availableModels,
        total: availableModels.length
      }
    });
  });

  /**
   * Get customer growth analytics
   */
  app.get('/api/analytics/customers/growth', function (req, res) {
    const period = req.query.period || 'monthly'; // monthly, quarterly, yearly
    const limit = parseInt(req.query.limit) || 12;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const getGrowthData = (model, periodType) => {
      const periods = [];
      const currentDate = moment();
      
      for (let i = limit - 1; i >= 0; i--) {
        const periodStart = moment().subtract(i, periodType).startOf(periodType);
        const periodEnd = moment().subtract(i, periodType).endOf(periodType);
        
        periods.push({
          period: periodStart.format('YYYY-MM'),
          start: periodStart.toDate(),
          end: periodEnd.toDate(),
          label: periodStart.format(periodType === 'month' ? 'MMM YYYY' : 'YYYY')
        });
      }

      return Promise.all(periods.map(period => {
        return model.count({
          createdAt: {
            gte: period.start,
            lte: period.end
          }
        }).then(count => ({
          period: period.period,
          label: period.label,
          count: count
        }));
      }));
    };

    const periodMap = {
      'monthly': 'month',
      'quarterly': 'quarter',
      'yearly': 'year'
    };

    const periodType = periodMap[period] || 'month';

    Promise.all([
      getGrowthData(app.models.Customer, periodType),
      getGrowthData(app.models.Lead, periodType)
    ])
      .then(([customerGrowth, leadGrowth]) => {
        res.json({
          success: true,
          data: {
            period: period,
            customerGrowth: customerGrowth,
            leadGrowth: leadGrowth
          }
        });
      })
      .catch(error => {
        console.error('Customer growth analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Get revenue analytics
   */
  app.get('/api/analytics/revenue', function (req, res) {
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

    // Check if Transaction model exists
    if (!app.models.Transaction) {
      return res.json({
        success: true,
        data: {
          period: period,
          revenue: [],
          message: 'Transaction model not available'
        }
      });
    }

    const periods = [];
    const currentDate = moment();
    
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

    Promise.all(periods.map(period => {
      return app.models.Transaction.find({
        where: {
          createdAt: {
            gte: period.start,
            lte: period.end
          },
          status: 'completed'
        }
      }).then(transactions => {
        const revenue = transactions.reduce((sum, transaction) => {
          return sum + (transaction.amount || 0);
        }, 0);
        
        return {
          period: period.period,
          label: period.label,
          revenue: revenue,
          transactionCount: transactions.length
        };
      });
    }))
      .then(revenueData => {
        res.json({
          success: true,
          data: {
            period: period,
            revenue: revenueData
          }
        });
      })
      .catch(error => {
        console.error('Revenue analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Get user activity analytics
   */
  app.get('/api/analytics/users/activity', function (req, res) {
    const days = parseInt(req.query.days) || 30;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const startDate = moment().subtract(days, 'days').startOf('day');
    const endDate = moment().endOf('day');

    Promise.all([
      // Active users in last N days
      app.models.user.count({
        lastLoginAt: {
          gte: startDate.toDate(),
          lte: endDate.toDate()
        }
      }),
      
      // New users in last N days
      app.models.user.count({
        createdAt: {
          gte: startDate.toDate(),
          lte: endDate.toDate()
        }
      }),
      
      // Total active users (ever logged in)
      app.models.user.count({
        lastLoginAt: {
          neq: null
        }
      }),
      
      // Users by role/type (if applicable)
      app.models.user.find({
        where: {
          createdAt: {
            gte: startDate.toDate(),
            lte: endDate.toDate()
          }
        },
        fields: {
          id: true,
          createdAt: true,
          role: true,
          type: true
        }
      })
    ])
      .then(([activeUsers, newUsers, totalActiveUsers, recentUsers]) => {
        // Group users by role/type if available
        const usersByType = {};
        recentUsers.forEach(user => {
          const type = user.role || user.type || 'unknown';
          usersByType[type] = (usersByType[type] || 0) + 1;
        });

        res.json({
          success: true,
          data: {
            period: `${days} days`,
            activeUsers,
            newUsers,
            totalActiveUsers,
            usersByType,
            totalUsers: recentUsers.length
          }
        });
      })
      .catch(error => {
        console.error('User activity analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Get conversion analytics (leads to customers)
   */
  app.get('/api/analytics/conversions', function (req, res) {
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

    const periods = [];
    const currentDate = moment();
    
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

    Promise.all(periods.map(period => {
      return Promise.all([
        // Leads created in this period
        app.models.Lead.count({
          createdAt: {
            gte: period.start,
            lte: period.end
          }
        }),
        
        // Customers created in this period
        app.models.Customer.count({
          createdAt: {
            gte: period.start,
            lte: period.end
          }
        })
      ]).then(([leads, customers]) => {
        const conversionRate = leads > 0 ? (customers / leads * 100).toFixed(2) : 0;
        
        return {
          period: period.period,
          label: period.label,
          leads: leads,
          customers: customers,
          conversionRate: parseFloat(conversionRate)
        };
      });
    }))
      .then(conversionData => {
        res.json({
          success: true,
          data: {
            period: period,
            conversions: conversionData
          }
        });
      })
      .catch(error => {
        console.error('Conversion analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Get real-time dashboard data
   */
  app.get('/api/analytics/realtime', function (req, res) {
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    // Use UTC to avoid timezone issues
    const today = moment().utc().startOf('day');
    const yesterday = moment().utc().subtract(1, 'day').startOf('day');
    const tomorrow = moment().utc().add(1, 'day').startOf('day');


    Promise.all([
      // Today's new customers
      app.models.Customer.count({
        createdAt: {
          gte: today.toDate(),
          lt: tomorrow.toDate()
        }
      }),
      
      // Today's new leads
      app.models.Lead.count({
        createdAt: {
          gte: today.toDate(),
          lt: tomorrow.toDate()
        }
      }),
      
      // Yesterday's new customers
      app.models.Customer.count({
        createdAt: {
          gte: yesterday.toDate(),
          lt: today.toDate()
        }
      }),
      
      // Yesterday's new leads
      app.models.Lead.count({
        createdAt: {
          gte: yesterday.toDate(),
          lt: today.toDate()
        }
      }),
      
      // Today's revenue
      app.models.Transaction ? app.models.Transaction.find({
        where: {
          createdAt: {
            gte: today.toDate(),
            lt: tomorrow.toDate()
          },
          status: 'completed'
        }
      }).then(transactions => {
        return transactions.reduce((sum, transaction) => {
          return sum + (transaction.amount || 0);
        }, 0);
      }) : Promise.resolve(0),
      
      // Yesterday's revenue
      app.models.Transaction ? app.models.Transaction.find({
        where: {
          createdAt: {
            gte: yesterday.toDate(),
            lt: today.toDate()
          },
          status: 'completed'
        }
      }).then(transactions => {
        return transactions.reduce((sum, transaction) => {
          return sum + (transaction.amount || 0);
        }, 0);
      }) : Promise.resolve(0)
    ])
      .then(([todayCustomers, todayLeads, yesterdayCustomers, yesterdayLeads, todayRevenue, yesterdayRevenue]) => {
        res.json({
          success: true,
          data: {
            today: {
              customers: todayCustomers,
              leads: todayLeads,
              revenue: todayRevenue
            },
            yesterday: {
              customers: yesterdayCustomers,
              leads: yesterdayLeads,
              revenue: yesterdayRevenue
            },
            changes: {
              customers: todayCustomers - yesterdayCustomers,
              leads: todayLeads - yesterdayLeads,
              revenue: todayRevenue - yesterdayRevenue
            },
            timestamp: new Date().toISOString()
          }
        });
      })
      .catch(error => {
        console.error('Real-time analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Get top performing metrics
   */
  app.get('/api/analytics/top-performers', function (req, res) {
    const limit = parseInt(req.query.limit) || 10;
    const period = req.query.period || 'monthly';
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const startDate = moment().startOf(period);
    const endDate = moment().endOf(period);

    Promise.all([
      // Top customers by activity (if applicable)
      app.models.Customer.find({
        where: {
          createdAt: {
            gte: startDate.toDate(),
            lte: endDate.toDate()
          }
        },
        limit: limit,
        order: 'createdAt DESC'
      }),
      
      // Top leads by potential (if applicable)
      app.models.Lead.find({
        where: {
          createdAt: {
            gte: startDate.toDate(),
            lte: endDate.toDate()
          }
        },
        limit: limit,
        order: 'createdAt DESC'
      }),
      
      // Top revenue transactions
      app.models.Transaction ? app.models.Transaction.find({
        where: {
          createdAt: {
            gte: startDate.toDate(),
            lte: endDate.toDate()
          },
          status: 'completed'
        },
        limit: limit,
        order: 'amount DESC'
      }) : Promise.resolve([])
    ])
      .then(([topCustomers, topLeads, topTransactions]) => {
        res.json({
          success: true,
          data: {
            period: period,
            topCustomers: topCustomers,
            topLeads: topLeads,
            topTransactions: topTransactions
          }
        });
      })
      .catch(error => {
        console.error('Top performers analytics error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Flexible dashboard overview for any models
   */
  app.get('/api/analytics/dashboard/flexible', function (req, res) {
    const { models, dateField = 'createdAt', statusField, statusValue } = req.query;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    if (!models) {
      return res.status(400).json({
        success: false,
        message: 'Models parameter is required'
      });
    }

    const modelList = models.split(',');
    const currentDate = moment();
    const startOfMonth = moment().startOf('month');
    const endOfMonth = moment().endOf('month');
    const startOfPreviousMonth = moment().subtract(1, 'month').startOf('month');
    const endOfPreviousMonth = moment().subtract(1, 'month').endOf('month');

    // Validate models
    const validModels = [];
    const invalidModels = [];
    
    modelList.forEach(modelName => {
      if (app.models[modelName]) {
        validModels.push(modelName);
      } else {
        invalidModels.push(modelName);
      }
    });

    if (invalidModels.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid models: ${invalidModels.join(', ')}`
      });
    }

    // Build base filter
    const baseFilter = {};
    if (statusField && statusValue) {
      baseFilter[statusField] = statusValue;
    }

    // Get data for all models
    Promise.all(validModels.map(modelName => {
      const model = app.models[modelName];
      
      return Promise.all([
        // Total count
        model.count(baseFilter),
        
        // Current month count
        model.count({
          ...baseFilter,
          [dateField]: {
            gte: startOfMonth.toDate(),
            lte: endOfMonth.toDate()
          }
        }),
        
        // Previous month count
        model.count({
          ...baseFilter,
          [dateField]: {
            gte: startOfPreviousMonth.toDate(),
            lte: endOfPreviousMonth.toDate()
          }
        })
      ]).then(([total, currentMonth, previousMonth]) => {
        const change = previousMonth > 0 ? ((currentMonth - previousMonth) / previousMonth * 100).toFixed(2) : 0;
        return {
          modelName: modelName,
          total: total,
          currentMonth: currentMonth,
          previousMonth: previousMonth,
          change: parseFloat(change)
        };
      });
    }))
      .then(results => {
        res.json({
          success: true,
          data: {
            models: results,
            period: {
              currentMonth: currentDate.format('MMMM YYYY'),
              previousMonth: moment().subtract(1, 'month').format('MMMM YYYY')
            },
            summary: {
              totalModels: results.length,
              totalRecords: results.reduce((sum, model) => sum + model.total, 0),
              totalCurrentMonth: results.reduce((sum, model) => sum + model.currentMonth, 0),
              totalPreviousMonth: results.reduce((sum, model) => sum + model.previousMonth, 0)
            }
          }
        });
      })
      .catch(error => {
        console.error('Flexible dashboard error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

 


  /**
   * Get analytics for any specific model
   */
  app.get('/api/analytics/model/:modelName', function (req, res) {
    const { modelName } = req.params;
    const { period = 'monthly', limit = 12, dateField = 'createdAt', statusField, statusValue } = req.query;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    if (!app.models[modelName]) {
      return res.status(400).json({
        success: false,
        message: `Model '${modelName}' not found`
      });
    }

    const model = app.models[modelName];
    const periodMap = {
      'monthly': 'month',
      'quarterly': 'quarter',
      'yearly': 'year'
    };
    const periodType = periodMap[period] || 'month';
    
    // Generate periods
    const periods = [];
    for (let i = parseInt(limit) - 1; i >= 0; i--) {
      const periodStart = moment().subtract(i, periodType).startOf(periodType);
      const periodEnd = moment().subtract(i, periodType).endOf(periodType);
      
      periods.push({
        period: periodStart.format('YYYY-MM'),
        start: periodStart.toDate(),
        end: periodEnd.toDate(),
        label: periodStart.format(periodType === 'month' ? 'MMM YYYY' : 'YYYY')
      });
    }

    const baseFilter = {};
    if (statusField && statusValue !== 'undefined') {
      baseFilter[statusField] = statusValue;
    }

    Promise.all(periods.map(period => {
      const filter = {
        ...baseFilter,
        [dateField]: {
          gte: period.start,
          lte: period.end
        }
      };

      return model.count(filter).then(count => ({
        period: period.period,
        label: period.label,
        count: count
      }));
    }))
      .then(data => {
        const counts = data.map(d => d.count);
      
        res.json({
          success: true,
          data: {
            modelName: modelName,
            period: period,
            data: data,
            summary: {
              total: counts.reduce((a, b) => a + b, 0),
              average: (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2)
            }
          }
        });
      })
      .catch(error => {
        console.error(`Model analytics error for ${modelName}:`, error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });

  /**
   * Compare multiple models
   */
  app.get('/api/analytics/compare', function (req, res) {
    const { models, period = 'monthly', limit = 12, dateField = 'createdAt' } = req.query;
    
    const loopbackContext = require('loopback-context').getCurrentContext();
    const currentUserId = loopbackContext && loopbackContext.get('currentUserId');

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    if (!models) {
      return res.status(400).json({
        success: false,
        message: 'Models parameter is required'
      });
    }

    const modelList = models.split(',');
    const periodMap = {
      'monthly': 'month',
      'quarterly': 'quarter',
      'yearly': 'year'
    };
    const periodType = periodMap[period] || 'month';
    
    // Generate periods
    const periods = [];
    for (let i = parseInt(limit) - 1; i >= 0; i--) {
      const periodStart = moment().subtract(i, periodType).startOf(periodType);
      const periodEnd = moment().subtract(i, periodType).endOf(periodType);
      
      periods.push({
        period: periodStart.format('YYYY-MM'),
        start: periodStart.toDate(),
        end: periodEnd.toDate(),
        label: periodStart.format(periodType === 'month' ? 'MMM YYYY' : 'YYYY')
      });
    }

    const validModels = [];
    const invalidModels = [];
    
    modelList.forEach(modelName => {
      if (app.models[modelName]) {
        validModels.push(modelName);
      } else {
        invalidModels.push(modelName);
      }
    });

    if (invalidModels.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid models: ${invalidModels.join(', ')}`
      });
    }

    Promise.all(validModels.map(modelName => {
      const model = app.models[modelName];
      
      return Promise.all(periods.map(period => {
        const filter = {
          [dateField]: {
            gte: period.start,
            lte: period.end
          }
        };

        return model.count(filter).then(count => ({
          period: period.period,
          label: period.label,
          count: count
        }));
      })).then(data => ({
        modelName: modelName,
        data: data
      }));
    }))
      .then(results => {
        res.json({
          success: true,
          data: {
            period: period,
            models: results,
            comparison: results.map(result => ({
              modelName: result.modelName,
              total: result.data.reduce((sum, item) => sum + item.count, 0),
              average: (result.data.reduce((sum, item) => sum + item.count, 0) / result.data.length).toFixed(2)
            }))
          }
        });
      })
      .catch(error => {
        console.error('Multi-model comparison error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      });
  });
}

/**
 * Flexible Analytics API
 * Generic analytics endpoints that can work with any model
 */

// module.exports = function(app) {
//   'use strict';

//   const moment = require('moment');

 

//   console.log('Flexible Analytics API routes loaded');
// }; 
 