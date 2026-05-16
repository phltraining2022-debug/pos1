const { google } = require('googleapis');
const util = require('util');
const cron = require('node-cron');
const vm = require('vm');
const fs = require('fs');
var app = require('../../server/server');
const slugify = require('slugify'); // Import slugify
const path = require('path');
const axios = require('axios');
const sgMail = require('@sendgrid/mail');

const sleep = util.promisify(setTimeout);

module.exports = function (BackgroundJob) {
  // Set the createdAt date before saving a new job
  BackgroundJob.observe('before save', function setCreatedAt(ctx, next) {
    if (ctx.instance) {
      if (ctx.isNewInstance) {
        ctx.instance.createdAt = new Date();
      } else if (ctx.data && ctx.data.scheduledAt) {
        ctx.instance.status = 'scheduled';
      }
    } else if (ctx.data.scheduledAt) {
      ctx.data.status = 'scheduled';
    }

    if (ctx.data && ctx.data.status == 'scheduled') {
      setTimeout(() => {
        BackgroundJob.executeJob(ctx.data.id, function (err) {
          if (err) {
            console.error('Error executing scheduled job:', ctx.data.id, err);
          } else {
            console.log('Successfully started scheduled job:', ctx.data.id);
          }
        });
      }, 500);
    }

    next();
  });

  // Method to execute a job
  BackgroundJob.executeJob = async function (jobId, cb) {
    try {
      const job = await BackgroundJob.findById(jobId);
      if (!job) return cb(new Error('Job not found'));
      // if (job.status !== 'scheduled') return cb(new Error('Job is not scheduled'));

      job.status = 'running';
      await job.save();

      // Run the job's code asynchronously
      try {
        const script = new vm.Script(job.codeToRun);
        const context = vm.createContext({ google, util, sleep, job, fs, console, app, slugify, path, axios, Buffer, sgMail });
        await script.runInContext(context);

        job.status = 'completed';
        job.completedAt = new Date();
        await job.save();
      } catch (err) {
        job.status = 'failed';
        job.result = { error: err.message };
        await job.save();
      }

      cb && cb(null, { status: 'Job started' });
    } catch (err) {
      cb && cb(err);
    }
  };

  // Remote method to expose the executeJob function
  BackgroundJob.remoteMethod('executeJob', {
    accepts: { arg: 'jobId', type: 'string', required: true },
    returns: { arg: 'result', type: 'object' },
    http: { path: '/executeJob', verb: 'post' }
  });

  // Schedule a task to check for and run due jobs every minute
  cron.schedule('* * * * *', function () {
    const now = new Date();
    BackgroundJob.find({
      where: {
        status: 'scheduled-disabled', // Change this to 'scheduled' to enable scheduled jobs
        scheduledAt: { lte: now }
      }
    }, function (err, jobs) {
      if (err) {
        console.error('Error fetching scheduled jobs:', err);
        return;
      }

      jobs.forEach(function (job) {
        BackgroundJob.executeJob(job.id, function (err) {
          if (err) {
            console.error('Error executing job:', job.id, err);
          } else {
            console.log('Successfully started job:', job.id);
          }
        });
      });
    });
  });

  // Utility function to sleep for a given number of milliseconds
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Main loop to run every 5 seconds
  async function startJobProcessing() {
    while (true) {
      try {
        const now = new Date();
        const jobs = await BackgroundJob.find({
          where: { type: 'service' }
        });

        jobs.forEach(async function (job) {
          try {
            await BackgroundJob.executeJob(job.id);
            console.log('Successfully started job:', job.id);
          } catch (err) {
            console.error('Error executing job:', job.id, err);
          }
        });
      } catch (err) {
        console.error('Error fetching scheduled jobs:', err);
      }

      // Sleep for 5 seconds before the next iteration
      await sleep(1000000);
    }
  }


};
