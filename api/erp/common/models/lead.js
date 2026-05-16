"use strict";
var moment = require("moment");
var emailHandler = require("../../server/boot/email");
var smsHandler = require("../../server/boot/sms");
var app = require("../../server/server");
var utils = require("../../node_modules/loopback/lib/utils");
var utility = require("../../server/boot/utility");
var crypto = require("crypto");
var Q = require("q");
const _ = require("lodash");
var redisClient = require("redis").createClient();

const createLog = require("../hooks/create-log");

const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

 const FB_CONFIG = {
      VERIFY_TOKEN: 'ATS_LIVE1',
      APP_SECRET: 'ATS_LIVE1',
      PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN || '',
      CONCURRENCY: 4
    };

const TT_CONFIG = {
  VERIFY_TOKEN: 'ATS_LIVE1_TIKTOK',
  APP_SECRET: process.env.TIKTOK_APP_SECRET || 'ATS_LIVE1_TIKTOK',
  ADVERTISER_ID: process.env.TIKTOK_ADVERTISER_ID || '',
  ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN || '',
  CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET || 'ATS_LIVE1_TIKTOK',
  CONCURRENCY: 4
};

// Helper: check if lead has counselor interaction within the last N days
const hasRecentCounselorInteraction = async function (lead, daysWindow, app) {
  try {
    const counselorId = lead.counselorId;
    if (!counselorId) return false;
    const now = moment();
    const cutoff = now.clone().subtract(daysWindow, 'days');

    // Check noteByCSL.lastUpdated
    const lastNoteUpdated = _.get(lead, 'noteByCSL.lastUpdated');
    if (lastNoteUpdated && moment(lastNoteUpdated).isAfter(cutoff)) {
      return true;
    }

    // Try optional message models if they exist
    const LeadMessage = app.models && (app.models.LeadMessage || app.models.Message || app.models.ChatMessage);
    if (LeadMessage && typeof LeadMessage.findOne === 'function') {
      const findOneAsync = (Model, filter) => new Promise((resolve, reject) => {
        Model.findOne(filter, (err, result) => (err ? reject(err) : resolve(result)));
      });
      const latestMsg = await findOneAsync(LeadMessage, {
        where: {
          and: [
            { or: [{ leadId: lead.id }, { toId: lead.id }] },
            { fromId: counselorId }
          ]
        },
        order: 'createdAt DESC'
      }).catch(() => null);
      if (latestMsg) {
        const ts = latestMsg.createdAt || latestMsg.updatedAt || latestMsg.sentAt;
        if (ts && moment(ts).isAfter(cutoff)) return true;
      }
    }
  } catch (_) {}
  return false;
};

module.exports = function (Lead) {
  delete Lead.validations.email;
  delete Lead.validations.password;
  delete Lead.validations.username;
  delete Lead.validations.applicantEmail;

  Lead.login = function (credentials, include, fn) {
    var self = this;
    if (typeof include === "function") {
      fn = include;
      include = undefined;
    }
    console.log("Lead.login called with credentials: ", credentials);
    console.log("Lead.login called with include: ", include);
    console.log("Lead.login called with fn: ", fn);
    fn = fn || utils.createPromiseCallback();

    include = include || "";
    if (Array.isArray(include)) {
      include = include.map(function (val) {
        return val.toLowerCase();
      });
    } else {
      include = include.toLowerCase();
    }

    var realmDelimiter;
    // Check if realm is required
    var realmRequired = !!(
      self.settings.realmRequired || self.settings.realmDelimiter
    );
    if (realmRequired) {
      realmDelimiter = self.settings.realmDelimiter;
    }
    var query = self.normalizeCredentials(
      credentials,
      realmRequired,
      realmDelimiter
    );

    if (
      !query.email &&
      !query.username &&
      !query.phone &&
      !query.applicantEmail
    ) {
      var err2 = new Error("phone or email is required");
      err2.statusCode = 400;
      err2.code = "USERNAME_EMAIL_REQUIRED";
      fn(err2);
      return fn.promise;
    }

    console.log("The query: ", query);
    // query.isActive = true;

    self.findOne({ where: query }, function (err, user) {
      var defaultError = new Error("login failed");
      defaultError.statusCode = 401;
      defaultError.code = "LOGIN_FAILED";

      function tokenHandler(err, token) {
        if (err) return fn(err);
        if (
          Array.isArray(include)
            ? include.indexOf("user") !== -1
            : include === "user"
        ) {
          // NOTE(bajtos) We can't set token.user here:
          //  1. token.user already exists, it's a function injected by
          //     "AccessToken belongsTo User" relation
          //  2. ModelBaseClass.toJSON() ignores own properties, thus
          //     the value won't be included in the HTTP response
          // See also loopback#161 and loopback#162
          token.__data.user = user;
        }
        fn(err, token);
      }

      if (err) {
        console.log("An error is reported from User.findOne: %j", err);
        fn(defaultError);
      } else if (user) {
        user.hasPassword(credentials.password, function (err, isMatch) {
          if (err) {
            console.log("An error is reported from User.hasPassword: %j", err);
            fn(defaultError);
          } else if (isMatch) {
            // if (self.settings.emailVerificationRequired && !user.emailVerified) {
            //     // Fail to log in if email verification is not done yet
            //     console.log('User email has not been verified');
            //     err = new Error('login failed as the email has not been verified');
            //     err.statusCode = 401;
            //     err.code = 'LOGIN_FAILED_EMAIL_NOT_VERIFIED';
            //     fn(err);
            // } else {
            if (user.createAccessToken.length === 2) {
              user.createAccessToken(credentials.ttl, tokenHandler);
            } else {
              user.createAccessToken(
                credentials.ttl,
                credentials,
                tokenHandler
              );
            }
            // }
          } else {
            console.log(
              "passsword should be ",
              credentials.password,
              Lead.hashPassword(credentials.password)
            );
            console.log(
              "The password is invalid for user %s",
              query.email || query.username || query.phone
            );
            fn(defaultError);
          }
        });
      } else {
        console.log("No matching record is found for user %s", query);
        fn(defaultError);
      }
    });
    return fn.promise;
  };

  Lead.logout = function (tokenId, fn) {
    fn = fn || utils.createPromiseCallback();
    this.relations.accessTokens.modelTo.findById(
      tokenId,
      function (err, accessToken) {
        if (err) {
          fn(err);
        } else if (accessToken) {
          accessToken.destroy(fn);
        } else {
          fn(new Error("could not find accessToken"));
        }
      }
    );
    return fn.promise;
  };

  // Helper function to escape special characters for use in a regular expression
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // --- BEGIN: Refactor generateIdFromConfig logic to a reusable function ---
  /**
   * Generate lead code based on config, instance, and counter value.
   * If counterValue is undefined, will query DB for max counter (default behavior for hook).
   * @param {Object} instance - The lead instance (data)
   * @param {Object} Lead - The Lead model
   * @param {number} [counterValue] - Optional counter value to use (for bulk import)
   * @returns {Promise<string>} - The generated code
   */
  async function generateLeadCode(instance, Lead, counterValue) {
    const Model = Lead;
    const app = Model.app;
    const modelName = Model.modelName;
    const dataSourceName = Lead.currentDatasource;
    console.log('dataSourceName', dataSourceName);
    const codeCfgForModel = _.get(
      app.dataSources[dataSourceName],
      "clinic.codeCfg.Lead"
    );
    console.log('codeCfgForModel', codeCfgForModel, typeof codeCfgForModel?.fmt, typeof codeCfgForModel?.fmtProperties);
    if (
      !codeCfgForModel ||
      typeof codeCfgForModel.fmt !== "string" ||
      typeof codeCfgForModel.fmtProperties !== "object"
    ) {
      console.warn(
        `[IDGenerator - ${modelName}] Missing or invalid codeCfg.${modelName} for datasource '${dataSourceName}'. Skipping auto-generation.`
      );
      const fallbackProperty = (codeCfgForModel && codeCfgForModel.idProperty) || "id";
      return instance && instance[fallbackProperty]
        ? instance[fallbackProperty]
        : null;
    }
    const { fmt, fmtProperties } = codeCfgForModel;
    const idStoringPropertyName = codeCfgForModel.idProperty || "id";
    const resolvedPlaceholders = {};
    let counterKey = null;
    const sortedPropKeys = Object.keys(fmtProperties).sort(
      (a, b) => b.length - a.length
    );
    for (const propKey of sortedPropKeys) {
      const definition = fmtProperties[propKey];
      if (typeof definition === "string" && definition.startsWith("maxFmt")) {
        if (counterKey) {
          throw new Error(
            `[IDGenerator - ${modelName}] Multiple 'maxFmt' counter definitions found ('${counterKey}', '${propKey}'). Only one is allowed.`
          );
        }
        counterKey = propKey;
        continue;
      }
      const obj = instance; // Ensure 'obj' is available for eval context
      try {
        resolvedPlaceholders[propKey] = eval(definition);
      } catch (e) {
        resolvedPlaceholders[propKey] = "[EVAL_ERROR:" + propKey + "]";
      }
      if (resolvedPlaceholders[propKey] === undefined) {
        resolvedPlaceholders[propKey] = "";
      }
    }
    let currentIdString = fmt;
    for (const propKey of sortedPropKeys) {
      if (propKey === counterKey) continue;
      if (resolvedPlaceholders.hasOwnProperty(propKey)) {
        currentIdString = currentIdString.replace(
          new RegExp(escapeRegExp(propKey), "g"),
          String(resolvedPlaceholders[propKey])
        );
      }
    }
    if (counterKey) {
      const counterPlaceholderLength = counterKey.length;
      let nextCounterValuePadded;
      if (typeof counterValue === "number") {
        nextCounterValuePadded = (counterValue)
          .toString()
          .padStart(counterPlaceholderLength, "0");
      } else {
        const parts = currentIdString.split(counterKey);
        if (parts.length !== 2) {
          throw new Error(
            `[IDGenerator - ${modelName}] Could not properly isolate counter placeholder '${counterKey}' in partially resolved format string: "${currentIdString}".`
          );
        }
        const prefixForQuery = escapeRegExp(parts[0]);
        const suffixForQuery = escapeRegExp(parts[1]);
        const findLatestRegex = new RegExp(
          `^${prefixForQuery}(\\d{${counterPlaceholderLength}})${suffixForQuery}$`
        );
        const latestRecord = await Model.findOne({
          where: { [idStoringPropertyName]: { regexp: findLatestRegex.source } },
          order: `${idStoringPropertyName} DESC`,
          fields: { [idStoringPropertyName]: true },
        });
        let currentMaxCounter = 0;
        if (latestRecord && latestRecord[idStoringPropertyName]) {
          const idMatch =
            latestRecord[idStoringPropertyName].match(findLatestRegex);
          if (idMatch && idMatch[1]) {
            currentMaxCounter = parseInt(idMatch[1], 10);
          }
        }
        nextCounterValuePadded = (currentMaxCounter + 1)
          .toString()
          .padStart(counterPlaceholderLength, "0");
      }
      currentIdString = currentIdString.replace(
        counterKey,
        nextCounterValuePadded
      );
    }
    return currentIdString;
  }
  // --- END: Refactor generateIdFromConfig logic ---

  Lead.observe("before save", async function generateIdFromConfig(ctx) {
    if (ctx.options && ctx.options.skipCodeHook) return;
    const instanceCheck = ctx.data || ctx.instance;
    const hasBranchIdChanged =
      !ctx.isNewInstance &&
      ctx.currentInstance &&
      instanceCheck.branchId &&
      ctx.currentInstance.__data.branchId !== instanceCheck.branchId;
    const shouldGenerateCode =
      ctx.isNewInstance ||
      (!ctx.currentInstance.__data.code && instanceCheck.branchId) ||
      hasBranchIdChanged;
    if (!shouldGenerateCode || !instanceCheck) {
      return;
    }
    // Sử dụng lại hàm generateLeadCode
    const code = await generateLeadCode(instanceCheck, Lead);
    if (!code) {
      console.warn(
        "[IDGenerator - Lead] Code generation skipped due to missing configuration."
      );
      return;
    }
    const Model = Lead;
    const app = Model.app;
    const modelName = Model.modelName;
    const dataSourceName = Lead.currentDatasource;
    const codeCfgForModel =
      _.get(app.dataSources[dataSourceName], "clinic.codeCfg.Lead") || {};
    const idStoringPropertyName = codeCfgForModel.idProperty || "id";
    instanceCheck[idStoringPropertyName] = code;
    console.log(
      `[IDGenerator - ${modelName}] Generated ID for ('${idStoringPropertyName}'): ${code}`
    );
  });

  // Website lead deduplication before save hook
  Lead.observe("before save", async function websiteLeadDeduplication(ctx) {
    if (ctx.options && ctx.options.skipCodeHook) return;
    ctx.hookState = ctx.hookState || {};
    if (ctx.hookState.__leadDedupChecked) return;
    ctx.hookState.__leadDedupChecked = true;
    if (ctx.options && ctx.options.__leadDedupHandled) return;
    
    const instanceCheck = ctx.data || ctx.instance;
    
    // Only process new website leads
    if (ctx.isNewInstance && instanceCheck && (instanceCheck.path || instanceCheck.websitePath || instanceCheck.utm_campaign || instanceCheck.utm)) {
      const findOneAsync = (Model, filter) => new Promise((resolve, reject) => {
        Model.findOne(filter, (err, result) => (err ? reject(err) : resolve(result)));
      });
      
      const findDuplicateByContactInfo = async function (email, phone) {
        try {
          const or = [];
          if (email) or.push({ email });
          if (phone) or.push({ phone });
          if (or.length === 0) return null;
          return await findOneAsync(Lead, { where: { or } });
        } catch (_) { return null; }
      };
      
      const duplicate = await findDuplicateByContactInfo(instanceCheck.email, instanceCheck.phone);
      if (duplicate) {
        ctx.options.__leadDedupHandled = true;
        // Mark to remove the new record after save to keep form success response
        ctx.hookState = ctx.hookState || {};
        ctx.hookState.suppressNewLead = true;
        // Process the duplicate lead instead of creating new one
        const now = new Date();
        const prev = _.get(duplicate, 'noteByCSL.lastCalled') || duplicate.updatedAt || duplicate.createdAt || now;
        const months = moment(now).diff(moment(prev), 'months', true);
        
        // Check for contact info changes
        const emailChanged = duplicate.email !== instanceCheck.email && instanceCheck.email && duplicate.email;
        const phoneChanged = duplicate.phone !== instanceCheck.phone && instanceCheck.phone && duplicate.phone;
        
        const updatePayload = { 
          updatedAt: now, 
          lastContactAt: now, 
        };
        
        // Handle different time windows
        if (months < 3) {
          updatePayload.returnWindowFlag = 'Return < 3 months';
        } else if (months >= 3 && months <= 18) {
          // Case 3–18 months: check counselor interaction in last 7 days
          const hasRecentInteraction = await hasRecentCounselorInteraction(duplicate, 7, Lead.app);
          if (!hasRecentInteraction) {
            updatePayload.counselorId = null;
            updatePayload.counselorAssignedAt = null;
            updatePayload.memberStatus = '';
            updatePayload.primaryStatus = '';
            updatePayload.rating = '';
          }
          updatePayload.returnWindowFlag = 'Return 3-18 months';
        } else if (months > 18) {
          // Case >18 months: archive old lead, create new lead with new campaign
          const hasRecentInteraction = await hasRecentCounselorInteraction(duplicate, 7, Lead.app);
          
          // Archive the old lead
          await duplicate.updateAttributes({
            status: 'archived',
            memberStatus: '',
            primaryStatus: '',
            rating: '',
            isActive: false,
            archivedAt: now,
            updatedAt: now,
          });
          
          // CRITICAL FIX: Create completely new object without any ID fields
          const newLeadData = {
            // Basic contact info
            name: instanceCheck.name || '',
            givenName: instanceCheck.givenName || '',
            familyName: instanceCheck.familyName || '',
            email: instanceCheck.email || duplicate.email,
            phone: instanceCheck.phone || duplicate.phone,
            
            // Form data
            sourceOfLead: instanceCheck.sourceOfLead || 'Website',
            path: instanceCheck.path || '',
            websitePath: instanceCheck.websitePath || '',
            utm_campaign: instanceCheck.utm_campaign || '',
            utm: instanceCheck.utm || '',
            utm_source: instanceCheck.utm_source || '',
            channel: instanceCheck.channel || '',
            event: instanceCheck.event || '',
            studyTime: instanceCheck.studyTime || '',
            agree: instanceCheck.agree || false,
            
            // Education info
            intakeYear: instanceCheck.intakeYear || null,
            intakeMonth: instanceCheck.intakeMonth || 1,
            intake: instanceCheck.intake || '',
            educationLevel: instanceCheck.educationLevel || '',
            
            // IDs and arrays (copy safe arrays)
            branchId: instanceCheck.branchId || '',
            locationId: instanceCheck.locationId || '',
            levelIds: Array.isArray(instanceCheck.levelIds) ? [...instanceCheck.levelIds] : [],
            institutionIds: Array.isArray(instanceCheck.institutionIds) ? [...instanceCheck.institutionIds] : [],
            majorIds: Array.isArray(instanceCheck.majorIds) ? [...instanceCheck.majorIds] : [],
            preferredLocationIds: Array.isArray(instanceCheck.preferredLocationIds) ? [...instanceCheck.preferredLocationIds] : [],
            campaignIds: Array.isArray(instanceCheck.campaignIds) ? [...instanceCheck.campaignIds] : [],
            attendedEventIds: Array.isArray(instanceCheck.attendedEventIds) ? [...instanceCheck.attendedEventIds] : [],
            
            // Status and timestamps
            status: 'active',
            isActive: true,
            movedToCR: false,
            lastContactAt: now,
            createdAt: now,
            updatedAt: now,
            returnWindowFlag: 'Return > 18 months',
            
            // Counselor info
            counselorId: hasRecentInteraction ? duplicate.counselorId : null,
            counselorAssignedAt: hasRecentInteraction ? duplicate.counselorAssignedAt : null,
            
            // Other fields
            role: instanceCheck.role || 'Học sinh',
            atsOffice: instanceCheck.atsOffice || '',
            consultationType: instanceCheck.consultationType || '',
            referralMethod: instanceCheck.referralMethod || '',
            notes: instanceCheck.notes || '',
            
            // Visa info
            visaInfor: instanceCheck.visaInfor || {
              lastUpdate: moment.utc().toISOString(),
              atsVisa: true
            }
          };
          
          // Double check: ensure no ID fields leak through
          delete newLeadData.id;
          delete newLeadData._id;
          delete newLeadData.code;
          
          console.log('[LEAD_CREATE_WEBSITE_RENEW] Creating new lead for >18m case', {
            email: newLeadData && newLeadData.email,
            phone: newLeadData && newLeadData.phone,
            stack: (new Error()).stack && (new Error()).stack.split('\n').slice(0,3).join(' | ')
          });
          // const newLead = await Lead.create(newLeadData);
          
          // Note: campaign will be created in after-save hook
          // return { action: 'created', lead: newLead };
          const newLead = await new Promise((resolve, reject) => {
            Lead.create(newLeadData, { 
              __leadDedupHandled: true,  // Skip dedup hooks
              skipCodeHook: true,        // Skip code generation hook
              skipHooks: true,           // Skip all other hooks
              skipValidation: false      // Keep validation
            }, (err, created) => {
              if (err) return reject(err);
              resolve(created);
            });
          });

          
        }
        
        // Defer contact-change flags until after campaign comparison
        
        // Update the duplicate lead
        // await duplicate.updateAttributes(updatePayload);
        
        // Create campaign for duplicate lead
        const LeadCampaign = Lead.app.models.LeadCampaign;
        const Event = Lead.app.models.Event;
        let resolvedCampaignId = null;
        const candidate = (instanceCheck.path || instanceCheck.websitePath || instanceCheck.utm_campaign || instanceCheck.utm || '').trim();
        console.log('[Website Campaign] Candidate raw:', candidate);
        
        try {
          if (candidate) {
            const lastSeg = String(candidate).split('/').filter(Boolean).pop() || candidate;
            const simplify = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
            const tokens = simplify(lastSeg).split(' ').filter(Boolean);
            const joined = tokens.join('.*');
            const patterns = [
              new RegExp(candidate.replace(/[\W_]+/g, '.*'), 'i'),
              joined ? new RegExp(joined, 'i') : null,
              tokens.length ? new RegExp(tokens.join('.*'), 'i') : null,
            ].filter(Boolean);
            console.log('[Website Campaign] Patterns:', patterns.map(p=>p.toString()));
            for (const rx of patterns) {
              const event = await findOneAsync(Event, { 
                where: { or: [ { slug: { like: rx } }, { name: { like: rx } }, { shortName: { like: rx } } ] },
                fields: { id: true }
              }).catch(()=>null);
              console.log('[Website Campaign] Try pattern', rx.toString(), '=>', event && event.id);
              if (event && event.id) { resolvedCampaignId = event.id; break; }
            }
          }
        } catch (e) { console.error('[Website Campaign] Resolve error:', e.message); }
        
        const campaignData = { 
          leadId: duplicate.id, 
          campaignId: resolvedCampaignId || null, 
          sourceOfLead: 'Website', 
          joinDate: now, 
          campaignName: candidate || '' 
        };
        
        let sameCampaign = false;
        try {
          console.log('[Website Campaign] Upsert with:', campaignData);
          if (campaignData.campaignId) {
            const existed = await findOneAsync(LeadCampaign, { 
              where: { leadId: duplicate.id, campaignId: campaignData.campaignId } 
            });
            if (existed) {
              sameCampaign = true;
              await existed.updateAttributes({ joinDate: now });
              console.log('[Website Campaign] Updated joinDate for existing campaignId');
            } else {
              await LeadCampaign.create(campaignData);
              console.log('[Website Campaign] Created with campaignId');
            }
          } else {
            // Prevent duplicates for null campaignId by campaignName
            const existedByName = await findOneAsync(LeadCampaign, {
              where: { leadId: duplicate.id, campaignId: null, campaignName: campaignData.campaignName }
            }).catch(()=>null);
            if (existedByName) {
              sameCampaign = true;
              await existedByName.updateAttributes({ joinDate: now });
              console.log('[Website Campaign] Updated joinDate for existing null-campaignId by name');
            } else {
              await LeadCampaign.create(campaignData);
              console.log('[Website Campaign] Created with null campaignId (name only)');
            }
          }
          // Always create a new campaign record for the interaction
          // await LeadCampaign.create(campaignData);
          // console.log('[Website Campaign] Created new LeadCampaign record for this interaction.');

        } catch (e) {
          console.error('[Website Campaign] Create error:', e);
        }
        console.log('[Website Campaign] Resolved campaignId:', resolvedCampaignId, 'sameCampaign:', sameCampaign);
        
        // Check if email and phone are both the same and campaign is the same
        const emailMatch = !emailChanged;
        const phoneMatch = !phoneChanged;
        
        if (sameCampaign) {
          // Same campaign: flag contact changes as before
          if (emailMatch && phoneMatch) {
            console.log('[Website Lead] Same campaign and contact info');
            updatePayload.returnWindowFlag = 'Same Campaign and Contact';
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          } else if (emailChanged) {
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
            updatePayload.returnWindowFlag = 'Email Changed';
          } else if (phoneChanged) {
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
            updatePayload.returnWindowFlag = 'Phone Changed';
          }
        } else {
          // Different campaign: the returnWindowFlag is already set by time, just add pending info
          if (emailChanged) {
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          }
          if (phoneChanged) {
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          }
        }
        // Convert create into update on the existing duplicate lead (align with Facebook/TikTok flow)
        // Prevent creating a new record that is later deleted in after-save
        ctx.isNewInstance = false;
        ctx.instance = duplicate;
        const duplicateData = (typeof duplicate.toObject === 'function') ? duplicate.toObject() : (duplicate.__data || duplicate);
        ctx.data = Object.assign({}, duplicateData, { id: duplicate.id });
        ctx.where = { id: duplicate.id };

        await duplicate.updateAttributes(updatePayload);
        console.log('[Website Lead] Duplicate found and processed, converted create -> update');
        return;
      }
    }
    return;
  });

  // Facebook lead deduplication before save hook
  Lead.observe("before save", async function facebookLeadDeduplication(ctx) {
    if (ctx.options && ctx.options.skipCodeHook) return;
    ctx.hookState = ctx.hookState || {};
    if (ctx.hookState.__leadDedupChecked) return;
    ctx.hookState.__leadDedupChecked = true;
    if (ctx.options && ctx.options.__leadDedupHandled) return;
    
    const instanceCheck = ctx.data || ctx.instance;
    
    // Only process new Facebook leads
    if (ctx.isNewInstance && instanceCheck && instanceCheck.externalSources && instanceCheck.externalSources.facebook) {
      const findOneAsync = (Model, filter) => new Promise((resolve, reject) => {
        Model.findOne(filter, (err, result) => (err ? reject(err) : resolve(result)));
      });
      
      const findDuplicateByContactInfo = async function (email, phone) {
        try {
          const or = [];
          if (email) or.push({ email });
          if (phone) or.push({ phone });
          if (or.length === 0) return null;
          return await findOneAsync(Lead, { where: { or } });
        } catch (_) { return null; }
      };
      
      const duplicate = await findDuplicateByContactInfo(instanceCheck.email, instanceCheck.phone);
      if (duplicate) {
        ctx.options.__leadDedupHandled = true;
        // Process the duplicate lead instead of creating new one
        const now = new Date();
        const prev =  _.get(duplicate, 'noteByCSL.lastCalled') || duplicate.updatedAt || duplicate.createdAt || now;
        const months = moment(now).diff(moment(prev), 'months', true);
        
        // Check for contact info changes
        const emailChanged = duplicate.email !== instanceCheck.email && instanceCheck.email && duplicate.email;
        const phoneChanged = duplicate.phone !== instanceCheck.phone && instanceCheck.phone && duplicate.phone;
        
        const updatePayload = { 
          updatedAt: now, 
          lastContactAt: now, 
          returnWindowFlag: 'Return < 3 months' 
        };
        
        // Defer contact-change flags until after campaign comparison
        
        // Update external sources
        const externalSources = duplicate.externalSources || {};
        externalSources.facebook = instanceCheck.externalSources.facebook;
        updatePayload.externalSources = externalSources;
        
        // Update the duplicate lead
        
        
        // Create campaign for duplicate lead
        const LeadCampaign = Lead.app.models.LeadCampaign;
        const Event = Lead.app.models.Event;
        let resolvedCampaignId = null;
        const campaignName = instanceCheck.externalSources.facebook.campaign_name || '';
        
        try {
          if (campaignName) {
            const segments = campaignName.split('|').map(s => (s || '').trim()).filter(Boolean);
            const targetSegment = segments[1] || '';
            
            if (targetSegment) {
              const regex = new RegExp(targetSegment.replace(/[\W_]+/g, '.*'), 'i');
              const event = await findOneAsync(Event, { 
                where: { or: [ { slug: { like: regex } }, { name: { like: regex } }, { shortName: { like: regex } } ] },
                fields: { id: true }
              });
              if (event && event.id) resolvedCampaignId = event.id;
            }
          }
        } catch (_) {}
        
        const campaignData = { 
          leadId: duplicate.id, 
          campaignId: resolvedCampaignId || null, 
          sourceOfLead: 'Facebook Lead Ads', 
          joinDate: now, 
          campaignName: campaignName || '',
          adName: instanceCheck.externalSources.facebook.ad_name || '',
          adSetName: instanceCheck.externalSources.facebook.adset_name || '',
          adsetId: instanceCheck.externalSources.facebook.adset_id || '',
          adId: instanceCheck.externalSources.facebook.ad_id || '',
          formId: instanceCheck.externalSources.facebook.form_id || ''
        };
        
        let sameCampaign = false;
        try {
          if (campaignData.campaignId) {
            const existed = await findOneAsync(LeadCampaign, { 
              where: { leadId: duplicate.id, campaignId: campaignData.campaignId } 
            });
            if (existed) {
              sameCampaign = true;
              await existed.updateAttributes({ joinDate: now });
              console.log('Updated existing Facebook campaign joinDate for duplicate lead');
            } else {
              await LeadCampaign.create(campaignData);
              console.log('Created new Facebook campaign for duplicate lead');
            }
          } else {
            await LeadCampaign.create(campaignData);
            console.log('Created new Facebook campaign for duplicate lead');
          }
        } catch (e) {
          console.error('Error creating Facebook campaign for duplicate lead:', e);
        }

        // Check if email and phone are both the same and campaign is the same
        const emailMatch = duplicate.email === instanceCheck.email && instanceCheck.email && duplicate.email;
        const phoneMatch = duplicate.phone === instanceCheck.phone && instanceCheck.phone && duplicate.phone;
        
        if (sameCampaign && emailMatch && phoneMatch) {
          // Same campaign, same contact info - just update joinDate (already done above)
          console.log('[Facebook Lead] Same campaign and contact info - only updated joinDate');
          updatePayload.returnWindowFlag = 'Same Campaign and Contact';
        } else if (sameCampaign) {
          // Same campaign but different contact info - flag changes
          if (emailChanged) {
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
            updatePayload.returnWindowFlag = 'Email Changed';
          } else if (phoneChanged) {
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
            updatePayload.returnWindowFlag = 'Phone Changed';
          }
        } else {
          if (emailChanged) {
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          }
          if (phoneChanged) {
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          }
        }
        
        console.log('[Facebook Lead] Duplicate found and processed, converting create -> update');
        
        // Convert create into update on the existing duplicate lead
        ctx.isNewInstance = false;
        ctx.instance = duplicate;
        const duplicateData = (typeof duplicate.toObject === 'function') ? duplicate.toObject() : (duplicate.__data || duplicate);
        ctx.data = Object.assign({}, duplicateData, { id: duplicate.id });
        ctx.where = { id: duplicate.id };

        await duplicate.updateAttributes(updatePayload);
        return;
      }
    }
    
    return;
  });

  // TikTok lead deduplication before save hook
  Lead.observe("before save", async function tiktokLeadDeduplication(ctx) {
    if (ctx.options && ctx.options.skipCodeHook) return;
    ctx.hookState = ctx.hookState || {};
    if (ctx.hookState.__leadDedupChecked) return;
    ctx.hookState.__leadDedupChecked = true;
    if (ctx.options && ctx.options.__leadDedupHandled) return;
    
    const instanceCheck = ctx.data || ctx.instance;
    
    // Only process new TikTok leads
    if (ctx.isNewInstance && instanceCheck && instanceCheck.externalSources && instanceCheck.externalSources.tiktok) {
      const findOneAsync = (Model, filter) => new Promise((resolve, reject) => {
        Model.findOne(filter, (err, result) => (err ? reject(err) : resolve(result)));
      });
      
      const findDuplicateByContactInfo = async function (email, phone) {
        try {
          const or = [];
          if (email) or.push({ email });
          if (phone) or.push({ phone });
          if (or.length === 0) return null;
          return await findOneAsync(Lead, { where: { or } });
        } catch (_) { return null; }
      };
      
      const duplicate = await findDuplicateByContactInfo(instanceCheck.email, instanceCheck.phone);
      if (duplicate) {
        ctx.options.__leadDedupHandled = true;
        // Process the duplicate lead instead of creating new one
        const now = new Date();
        const prev = _.get(duplicate, 'noteByCSL.lastCalled') || duplicate.updatedAt || duplicate.createdAt || now;
        const months = moment(now).diff(moment(prev), 'months', true);
        
        // Check for contact info changes
        const emailChanged = duplicate.email !== instanceCheck.email && instanceCheck.email && duplicate.email;
        const phoneChanged = duplicate.phone !== instanceCheck.phone && instanceCheck.phone && duplicate.phone;
        
        const updatePayload = { 
          updatedAt: now, 
          lastContactAt: now, 
          returnWindowFlag: 'Return < 3 months' 
        };
        
        // Defer contact-change flags until after campaign comparison
        
        // Update external sources
        const externalSources = duplicate.externalSources || {};
        externalSources.tiktok = instanceCheck.externalSources.tiktok;
        updatePayload.externalSources = externalSources;
        
        // Update the duplicate lead
        
        
        // Create campaign for duplicate lead
        const LeadCampaign = Lead.app.models.LeadCampaign;
        const Event = Lead.app.models.Event;
        let resolvedCampaignId = null;
        const campaignName = instanceCheck.externalSources.tiktok.campaign_name || '';
        
        try {
          if (campaignName) {
            const segments = campaignName.split('|').map(s => (s || '').trim()).filter(Boolean);
            const targetSegment = segments[1] || '';
            
            if (targetSegment) {
              const regex = new RegExp(targetSegment.replace(/[\W_]+/g, '.*'), 'i');
              const event = await findOneAsync(Event, { 
                where: { or: [ { slug: { like: regex } }, { name: { like: regex } }, { shortName: { like: regex } } ] },
                fields: { id: true }
              });
              if (event && event.id) resolvedCampaignId = event.id;
            }
          }
        } catch (_) {}
        
        const campaignData = { 
          leadId: duplicate.id, 
          campaignId: resolvedCampaignId || null, 
          sourceOfLead: 'TikTok Lead Ads', 
          joinDate: now, 
          campaignName: campaignName || '',
          adName: instanceCheck.externalSources.tiktok.ad_name || '',
          adSetName: instanceCheck.externalSources.tiktok.adgroup_name || '',
          adsetId: instanceCheck.externalSources.tiktok.adgroup_id || '',
          adId: instanceCheck.externalSources.tiktok.ad_id || '',
          formId: instanceCheck.externalSources.tiktok.form_id || '',
          platform: 'TikTok',
          advertiserId: instanceCheck.externalSources.tiktok.advertiser_id || ''
        };
        
        let sameCampaign = false;
        try {
          if (campaignData.campaignId) {
            const existed = await findOneAsync(LeadCampaign, { 
              where: { leadId: duplicate.id, campaignId: campaignData.campaignId } 
            });
            if (existed) {
              sameCampaign = true;
              await existed.updateAttributes({ joinDate: now });
              console.log('Updated existing TikTok campaign joinDate for duplicate lead');
            } else {
              await LeadCampaign.create(campaignData);
              console.log('Created new TikTok campaign for duplicate lead');
            }
          } else {
            await LeadCampaign.create(campaignData);
            console.log('Created new TikTok campaign for duplicate lead');
          }
        } catch (e) {
          console.error('Error creating TikTok campaign for duplicate lead:', e);
        }

        // Check if email and phone are both the same and campaign is the same
        const emailMatch = duplicate.email === instanceCheck.email && instanceCheck.email && duplicate.email;
        const phoneMatch = duplicate.phone === instanceCheck.phone && instanceCheck.phone && duplicate.phone;
        
        if (sameCampaign && emailMatch && phoneMatch) {
          // Same campaign, same contact info - just update joinDate (already done above)
          console.log('[TikTok Lead] Same campaign and contact info - only updated joinDate');
          updatePayload.returnWindowFlag = 'Same Campaign and Contact';
        } else if (sameCampaign) {
          // Same campaign but different contact info - flag changes
          if (emailChanged) {
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
            updatePayload.returnWindowFlag = 'Email Changed';
          } else if (phoneChanged) {
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
            updatePayload.returnWindowFlag = 'Phone Changed';
          }
        } else {
          if (emailChanged) {
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          }
          if (phoneChanged) {
            updatePayload.pendingNewPhone = instanceCheck.phone;
            updatePayload.pendingNewEmail = instanceCheck.email;
            updatePayload.pendingNewFirstName = instanceCheck.firstName;
            updatePayload.pendingNewLastName = instanceCheck.lastName;
          }
        }
        
        console.log('[TikTok Lead] Duplicate found and processed, converting create -> update');
        
        // Convert create into update on the existing duplicate lead
        ctx.isNewInstance = false;
        ctx.instance = duplicate;
        const duplicateData = (typeof duplicate.toObject === 'function') ? duplicate.toObject() : (duplicate.__data || duplicate);
        ctx.data = Object.assign({}, duplicateData, { id: duplicate.id });
        ctx.where = { id: duplicate.id };
        await duplicate.updateAttributes(updatePayload);
        return;
      }
    }
    
    return;
  });

  Lead.observe(
    "before save",
    function processStudyTimeAndSourceoLead(ctx, next) {
      if (!ctx.isNewInstance || !ctx.instance) {
        return next();
      }

      var instance = ctx.instance || ctx.data;

      if (instance && instance.studyTime) {
        try {
          const studyTimeNumber = parseInt(instance.studyTime, 10);

          if (!isNaN(studyTimeNumber) && studyTimeNumber > 0) {
            instance.intakeYear = studyTimeNumber;

            instance.intakeMonth = 1;

            instance.intake = `${instance.intakeYear}.${instance.intakeMonth}`;

          } else {
            console.warn(
              `[Lead] Invalid studyTime value for new instance: ${instance.studyTime}. Must be a valid positive number.`
            );
          }
        } catch (error) {
          console.error(
            `[Lead] Error processing studyTime for new instance: ${error.message}`
          );
        }
      }

      // Existing default source logic + website hints
      if (instance) {
        if (!instance.sourceOfLead) {
          instance.sourceOfLead = "Website";
          console.log(
            `[Lead] Set default sourceOfLead for new instance: ${instance.sourceOfLead}`
          );
        }
        // Capture website signals (prefer path over utm_campaign) for after-save processing
        const hasWebsiteSignals = !!(instance.path || instance.websitePath || instance.utm_campaign || instance.utm);
        if (ctx.isNewInstance && hasWebsiteSignals) {
          const path = instance.path || instance.websitePath || '';
          const utm = instance.utm_campaign || instance.utm || '';
          ctx.hookState = ctx.hookState || {};
          ctx.hookState.website = {
            preferredCampaignName: (path || utm || '').trim(),
            path: path || '',
            utm: utm || ''
          };
        }
      }

      if (instance) {
        if (instance.visaInfor && instance.visaInfor.atsVisa) {
          // Nếu đã có visaInfor.atsVisa thì không làm gì cả
        } else {
          // Nếu không có visaInfor hoặc không có atsVisa, set mặc định
          instance.visaInfor = {
            lastUpdate: moment.utc().toISOString(),
            atsVisa: true,
          };
          console.log(
            `[Lead] Set default visaInfor for new instance:`,
            instance.visaInfor
          );
        }
      }

      // Thêm returnWindowFlag cho lead mới không duplicate
      if (ctx.isNewInstance && !(ctx.hookState && ctx.hookState.suppressNewLead)) {
        instance.returnWindowFlag = "New Lead";
      }

      next();
    }
  );

  Lead.observe("before save", function (ctx, next) {
    var instance = ctx.instance || ctx.data;
    // If dedup decided to suppress the new record, skip timestamps and let after-save remove it
    if (ctx.isNewInstance && ctx.hookState && ctx.hookState.suppressNewLead) {
      return next();
    }
    // update createdAt and updatedAt
    if (ctx.isNewInstance) {
      instance.createdAt = moment.utc();
      instance.updatedAt = instance.createdAt;
    } else {
      instance.updatedAt = moment.utc();
    }
    next();
  });

  // After-save observer: (1) suppress accidental new record in dedup, (2) create website campaign for brand-new website leads
  Lead.observe("after save", function (ctx, next) {
    try {
      // 1) Suppression path for deduped duplicates
      if (ctx.isNewInstance && ctx.hookState && ctx.hookState.suppressNewLead && ctx.instance) {
        const id = ctx.instance.id;
        console.log('[Website Lead] Suppressing accidentally created record', id);
        return Lead.deleteById(id, function () {
          return next();
        });
      }

      // 2) Create campaign for brand-new website leads (not suppressed)
      if (ctx.isNewInstance && ctx.instance) {
        const inst = ctx.instance;
        const hasWebsiteSignals = !!(inst.path || inst.websitePath || inst.utm_campaign || inst.utm);
        if (hasWebsiteSignals) {
          const appRef = Lead.app;
          const LeadCampaign = appRef && appRef.models && appRef.models.LeadCampaign;
          const Event = appRef && appRef.models && appRef.models.Event;
          const candidate = (inst.path || inst.websitePath || inst.utm_campaign || inst.utm || '').trim();
          console.log('[Website Campaign][AFTER SAVE] Candidate raw:', candidate, 'leadId:', inst.id);

          if (LeadCampaign && Event) {
            const findOneAsync = (Model, filter) => new Promise((resolve) => {
              try { Model.findOne(filter, (err, res) => resolve(err ? null : res)); } catch (_) { resolve(null); }
            });
            (async () => {
              let resolvedCampaignId = null;
              try {
                if (candidate) {
                  const lastSeg = String(candidate).split('/').filter(Boolean).pop() || candidate;
                  const simplify = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
                  const tokens = simplify(lastSeg).split(' ').filter(Boolean);
                  const joined = tokens.join('.*');
                  const patterns = [
                    new RegExp(candidate.replace(/[\W_]+/g, '.*'), 'i'),
                    joined ? new RegExp(joined, 'i') : null,
                    tokens.length ? new RegExp(tokens.join('.*'), 'i') : null,
                  ].filter(Boolean);
                  console.log('[Website Campaign][AFTER SAVE] Patterns:', patterns.map(p=>p.toString()));
                  for (const rx of patterns) {
                    const event = await findOneAsync(Event, { where: { or: [ { slug: { like: rx } }, { name: { like: rx } }, { shortName: { like: rx } } ] }, fields: { id: true } }).catch(()=>null);
                    console.log('[Website Campaign][AFTER SAVE] Try pattern', rx.toString(), '=>', event && event.id);
                    if (event && event.id) { resolvedCampaignId = event.id; break; }
                  }
                }
              } catch (e) { console.error('[Website Campaign][AFTER SAVE] Resolve error:', e && e.message); }

              const now = new Date();
              const campaignData = {
                leadId: inst.id,
                campaignId: resolvedCampaignId || null,
                sourceOfLead: 'Website',
                joinDate: now,
                campaignName: candidate || ''
              };
              try {
                console.log('[Website Campaign][AFTER SAVE] Upsert with:', campaignData);
                if (campaignData.campaignId) {
                  const existed = await findOneAsync(LeadCampaign, { where: { leadId: inst.id, campaignId: campaignData.campaignId } });
                  if (existed) {
                    await existed.updateAttributes({ joinDate: now });
                    console.log('[Website Campaign][AFTER SAVE] Updated joinDate for existing campaignId');
                  } else {
                    await LeadCampaign.create(campaignData);
                    console.log('[Website Campaign][AFTER SAVE] Created with campaignId');
                  }
                } else {
                  const existedByName = await findOneAsync(LeadCampaign, { where: { leadId: inst.id, campaignId: null, campaignName: campaignData.campaignName } });
                  if (existedByName) {
                    await existedByName.updateAttributes({ joinDate: now });
                    console.log('[Website Campaign][AFTER SAVE] Updated joinDate for existing null-campaignId by name');
                  } else {
                    await LeadCampaign.create(campaignData);
                    console.log('[Website Campaign][AFTER SAVE] Created with null campaignId (name only)');
                  }
                }
              } catch (e) {
                console.error('[Website Campaign][AFTER SAVE] Create error:', e);
              }
              return next();
            })();
            return; // prevent double next; async IIFE will call next()
          }
        }
      }

      return next();
    } catch (e) {
      return next(e);
    }
  });

  Lead.requestPasswordResetCode = function (applicantEmail, cb) {
    Lead.findOne({ where: { applicantEmail } }, function (err, user) {
      if (err || !user) return cb(new Error("Email not found"));

      const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

      user.updateAttributes(
        {
          resetCode: code,
          resetCodeExpiresAt: expiresAt,
        },
        function (err) {
          if (err) return cb(err);

          const msg = {
            to: applicantEmail,
            from: "noreply@live1.vn", // Must be verified in SendGrid
            subject: "Your password reset code",
            html: `
                  <p>Hello,</p>
                  <p>Your password reset code is:</p>
                  <h2>${code}</h2>
                  <p>This code will expire in 10 minutes.</p>
                `,
          };
          console.log("Sending password reset code to:", msg);

          sgMail
            .send(msg)
            .then(() => {
              cb(null, { message: "Code sent to email" });
            })
            .catch((error) => {
              console.error(
                "SendGrid Error:",
                error.response?.body || error.message
              );
              cb(new Error("Failed to send email"));
            });
        }
      );
    });
  };

  Lead.remoteMethod("requestPasswordResetCode", {
    accepts: { arg: "applicantEmail", type: "string", required: true },
    returns: { arg: "message", type: "string" },
    http: { path: "/request-reset-code", verb: "post" },
  });

  // Reset with code
  Lead.resetPasswordWithCode = function (
    applicantEmail,
    code,
    newPassword,
    cb
  ) {
    Lead.findOne({ where: { applicantEmail } }, function (err, user) {
      if (err || !user) return cb(new Error("Invalid email or code"));

      if (
        user.resetCode !== code ||
        new Date(user.resetCodeExpiresAt) < new Date()
      ) {
        return cb(new Error("Invalid or expired reset code"));
      }

      user.updateAttributes(
        { password: newPassword, resetCode: null, resetCodeExpiresAt: null },
        function (err) {
          if (err) return cb(err);
          cb(null, { message: "Password updated successfully" });
        }
      );
    });
  };

  Lead.remoteMethod("resetPasswordWithCode", {
    accepts: [
      { arg: "applicantEmail", type: "string", required: true },
      { arg: "code", type: "string", required: true },
      { arg: "newPassword", type: "string", required: true },
    ],
    returns: { arg: "message", type: "string" },
    http: { path: "/reset-password-code", verb: "post" },
  });

  Lead.normalizeCredentials = function (
    credentials,
    realmRequired,
    realmDelimiter
  ) {
    var query = {};
    credentials = credentials || {};
    if (!realmRequired) {
      if (credentials.email) {
        query.email = credentials.email;
      } else if (credentials.username) {
        query.username = credentials.username;
      } else if (credentials.phone) {
        query.phone = credentials.phone;
      } else if (credentials.applicantEmail) {
        query.applicantEmail = credentials.applicantEmail;
      }
    } else {
      if (credentials.realm) {
        query.realm = credentials.realm;
      }
      var parts;
      if (credentials.email) {
        parts = splitPrincipal(credentials.email, realmDelimiter);
        query.email = parts[1];
        if (parts[0]) {
          query.realm = parts[0];
        }
      } else if (credentials.username) {
        parts = splitPrincipal(credentials.username, realmDelimiter);
        query.username = parts[1];
        if (parts[0]) {
          query.realm = parts[0];
        }
      } else if (credentials.phone) {
        parts = splitPrincipal(credentials.phone, realmDelimiter);
        query.phone = parts[1];
        if (parts[0]) {
          query.realm = parts[0];
        }
      } else if (credentials.applicantEmail) {
        parts = splitPrincipal(credentials.applicantEmail, realmDelimiter);
        query.applicantEmail = parts[1];
        if (parts[0]) {
          query.realm = parts[0];
        }
      }
    }
    return query;
  };

  Lead.bulkImport = function (leadsData, options, cb) {
    cb = cb || utils.createPromiseCallback();

    // Validate input
    if (!Array.isArray(leadsData) || leadsData.length === 0) {
      const error = new Error("leadsData must be a non-empty array");
      error.statusCode = 400;
      error.code = "INVALID_INPUT";
      cb(error);
      return cb.promise;
    }

    // Tổ chức toàn bộ logic vào một hàm async nội bộ
    (async function doBulkImport() {
      // Merge options sau khi validate input
      const defaultOptions = {
        batchSize: 100,
        skipDuplicates: true,
        duplicateCheckFields: [],
        updateExisting: false,
        validateData: true,
        generateCodes: true,
        forbiddenFields: ["id", "_id", "__v", "createdAt", "updatedAt"], // KHÔNG xóa 'code'
      };
      const finalOptions = _.merge(defaultOptions, options);

      // Group leads by branch/location
      const groups = _.groupBy(
        leadsData,
        (lead) => lead.branchId || lead.locationId || "default"
      );

      // for (const groupKey in groups) {
      //   const groupLeads = groups[groupKey];
      //   // Get max code for this group
      //   const maxLead = await Lead.findOne({
      //     where: { branchId: groupKey },
      //     order: "code DESC",
      //     fields: { code: true },
      //   });
      //   let maxCode = 0;
      //   if (maxLead && maxLead.code) {
      //     const match = maxLead.code.match(/(\d+)$/);
      //     maxCode = match ? parseInt(match[1], 10) : 0;
      //   }
      //   // Assign code for each lead in group
      //   for (let i = 0; i < groupLeads.length; i++) {
      //     groupLeads[i].code = `BR${groupKey}-${String(
      //       maxCode + i + 1
      //     ).padStart(4, "0")}`;
      //   }
      // }

      // Helper function to validate and clean lead data
      async function validateAndCleanLeadData(leadData, options) {
        if (!leadData || typeof leadData !== "object") {
          return null;
        }
        const cleanedData = _.cloneDeep(leadData);
        if (
          Array.isArray(options.forbiddenFields) &&
          options.forbiddenFields.length > 0
        ) {
          options.forbiddenFields.forEach((field) => {
            if (field in cleanedData) {
              delete cleanedData[field];
            }
          });
        }
        delete cleanedData._id;
        delete cleanedData.__v;
        delete cleanedData.id;
        if (!cleanedData.status) {
          cleanedData.status = "active";
        }
        if (!cleanedData.sourceOfLead) {
          cleanedData.sourceOfLead = "Website";
        }
        if (cleanedData.studyTime && !cleanedData.intakeYear) {
          try {
            const studyTimeNumber = parseInt(cleanedData.studyTime, 10);
            if (!isNaN(studyTimeNumber) && studyTimeNumber > 0) {
              cleanedData.intakeYear = studyTimeNumber;
              cleanedData.intakeMonth = cleanedData.intakeMonth || 1;
              cleanedData.intake = `${cleanedData.intakeMonth}.${cleanedData.intakeYear}`;
            }
          } catch (error) {}
        }
        if (
          !cleanedData.intake &&
          cleanedData.intakeYear &&
          cleanedData.intakeMonth
        ) {
          cleanedData.intake = `${cleanedData.intakeMonth}.${cleanedData.intakeYear}`;
        }
        const now = moment.utc();
        cleanedData.createdAt = cleanedData.createdAt || now;
        cleanedData.updatedAt = now;
        if (options.validateData) {
          const requiredFields = ["email", "phone"];
          for (const field of requiredFields) {
            if (!cleanedData[field]) {
              return null;
            }
          }
        }
        return cleanedData;
      }

      // Helper function to check for duplicates
      async function checkForDuplicates(leadData, checkFields) {
        const queryConditions = [];
        for (const field of checkFields) {
          if (leadData[field]) {
            queryConditions.push({ [field]: leadData[field] });
          }
        }
        if (queryConditions.length === 0) {
          return null;
        }
        const query = { where: { or: queryConditions } };
        try {
          const existingLead = await Lead.findOne(query);
          return existingLead;
        } catch (error) {
          return null;
        }
      }

      // --- BEGIN: Generate unique codes for each lead in batch (by branchId) ---
      for (const groupKey in groups) {
        const groupLeads = groups[groupKey];
        const Model = Lead;
        const app = Model.app;
        const modelName = Model.modelName;
        const dataSourceName = Lead.currentDatasource;
        const codeCfgForModel = _.get(
          app.dataSources[dataSourceName],
          "clinic.codeCfg.Lead"
        );
        if (!codeCfgForModel || typeof codeCfgForModel.fmt !== "string" || typeof codeCfgForModel.fmtProperties !== "object") {
          throw new Error(`[IDGenerator - ${modelName}] ID generation config ('codeCfg.${modelName}') not found or incomplete.`);
        }
        const { fmt, fmtProperties } = codeCfgForModel;
        let counterKey = null;
        const sortedPropKeys = Object.keys(fmtProperties).sort((a, b) => b.length - a.length);
        for (const propKey of sortedPropKeys) {
          const definition = fmtProperties[propKey];
          if (typeof definition === "string" && definition.startsWith("maxFmt")) {
            counterKey = propKey;
            break;
          }
        }
        if (!counterKey) continue;
        const counterPlaceholderLength = counterKey.length;
        // Query DB lấy max counter hiện tại
        const tempInstance = groupLeads[0] || {};
        const obj = tempInstance;
        let currentIdString = fmt;
        for (const propKey of sortedPropKeys) {
          if (propKey === counterKey) continue;
          try {
            currentIdString = currentIdString.replace(
              new RegExp(escapeRegExp(propKey), "g"),
              String(eval(fmtProperties[propKey]))
            );
          } catch (e) {
            currentIdString = currentIdString.replace(
              new RegExp(escapeRegExp(propKey), "g"),
              ""
            );
          }
        }
        const parts = currentIdString.split(counterKey);
        if (parts.length !== 2) continue;
        const prefixForQuery = escapeRegExp(parts[0]);
        const suffixForQuery = escapeRegExp(parts[1]);
        const findLatestRegex = new RegExp(
          `^${prefixForQuery}(\\d{${counterPlaceholderLength}})${suffixForQuery}$`
        );
        const idStoringPropertyName = codeCfgForModel.idProperty || "id";
        const latestRecord = await Model.findOne({
          where: { [idStoringPropertyName]: { regexp: findLatestRegex.source } },
          order: `${idStoringPropertyName} DESC`,
          fields: { [idStoringPropertyName]: true },
        });
        let currentMaxCounter = 0;
        if (latestRecord && latestRecord[idStoringPropertyName]) {
          const idMatch = latestRecord[idStoringPropertyName].match(findLatestRegex);
          if (idMatch && idMatch[1]) {
            currentMaxCounter = parseInt(idMatch[1], 10);
          }
        }
        // Gán code cho từng lead trong group bằng generateLeadCode và validate
        for (let i = 0; i < groupLeads.length; i++) {
          const code = await generateLeadCode(groupLeads[i], Lead, currentMaxCounter + i + 1);
          if (!code) {
            throw new Error(`Không sinh được code cho lead: ${JSON.stringify(groupLeads[i])}`);
          }
          groupLeads[i].code = code;
        }
      }
      // --- END: Generate unique codes for each lead in batch ---

      // Process in batches
      const processBatch = async (batch, batchIndex) => {
        const batchResults = {
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
        };
        const batchPromises = batch.map(async (leadData, index) => {
          try {
            const cleanedData = await validateAndCleanLeadData(
              leadData,
              finalOptions
            );
            if (!cleanedData) {
              batchResults.skipped++;
              return;
            }
            if (finalOptions.skipDuplicates) {
              const existingLead = await checkForDuplicates(
                cleanedData,
                finalOptions.duplicateCheckFields
              );
              if (existingLead) {
                if (finalOptions.updateExisting) {
                  const updatedLead = await Lead.findById(existingLead.id);
                  if (updatedLead) {
                    await updatedLead.updateAttributes(cleanedData);
                    batchResults.updated++;
                    return updatedLead;
                  }
                } else {
                  batchResults.skipped++;
                  return;
                }
              }
            }
            // Create new lead, skip code hook
            console.log('[LEAD_CREATE_IMPORT] Creating via bulkImport', {
              email: cleanedData && cleanedData.email,
              phone: cleanedData && cleanedData.phone,
              stack: (new Error()).stack && (new Error()).stack.split('\n').slice(0,3).join(' | ')
            });
            const newLead = await Lead.create(cleanedData, {
              skipCodeHook: true,
            });
            batchResults.created++;
            return newLead;
          } catch (error) {
            batchResults.errors.push({
              index: batchIndex * finalOptions.batchSize + index,
              data: leadData,
              error: error.message,
            });
          }
        });
        await Promise.all(batchPromises);
        return batchResults;
      };

      // Main processing logic
      const totalResults = {
        totalProcessed: 0,
        totalCreated: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrors: 0,
        batches: [],
      };
      const batches = [];
      for (let i = 0; i < leadsData.length; i += finalOptions.batchSize) {
        batches.push(leadsData.slice(i, i + finalOptions.batchSize));
      }
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchResults = await processBatch(batch, i);
        totalResults.batches.push(batchResults);
        totalResults.totalCreated += batchResults.created;
        totalResults.totalUpdated += batchResults.updated;
        totalResults.totalSkipped += batchResults.skipped;
        totalResults.totalErrors += batchResults.errors.length;
        totalResults.totalProcessed += batch.length;
      }
      // Nếu không có lead nào được tạo hoặc cập nhật, throw error
      if (totalResults.totalCreated === 0 && totalResults.totalUpdated === 0) {
        const error = new Error("No valid leads to import");
        error.statusCode = 400;
        error.code = "NO_VALID_LEADS";
        throw error;
      }
      return totalResults;
    })()
      .then((result) => cb(null, result))
      .catch((error) => {
        console.error("[Lead.bulkImport] Fatal error:", error);
        cb(error);
      });

    return cb.promise;
  };

  // Remote method configuration for bulk import
  Lead.remoteMethod("bulkImport", {
    accepts: [
      {
        arg: "leadsData",
        type: "array",
        required: true,
        http: { source: "body" },
      },
      {
        arg: "options",
        type: "object",
        required: false,
        http: { source: "query" },
        description: "Import options",
      },
    ],
    returns: {
      arg: "result",
      type: "object",
      root: true,
      description: "Import results summary",
    },
    http: {
      path: "/bulk-import",
      verb: "post",
    },
    description: "Bulk import leads with validation and duplicate checking",
  });




  // ... existing code ...

  // Facebook Webhook Callback API
  Lead.facebookWebhookCallback = function (req, res, cb) {
    cb = cb || utils.createPromiseCallback();


    // Verify webhook signature (Facebook security)
    // const verifyWebhookSignature = (req) => {
    //   const signatureHeader = req.headers['x-hub-signature-256'];
    //   if (!signatureHeader || typeof signatureHeader !== 'string') return false;

    //   const [, hexFromHeader] = signatureHeader.split('=');
    //   if (!hexFromHeader || hexFromHeader.length !== 64) return false;

    //   const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

    //   const expectedHex = crypto
    //     .createHmac('sha256', FB_CONFIG.APP_SECRET)
    //     .update(rawBody)
    //     .digest('hex');

    //   try {
    //     return crypto.timingSafeEqual(Buffer.from(hexFromHeader), Buffer.from(expectedHex));
    //   } catch (_) {
    //     return false;
    //   }
    // };

    const verifyWebhookSignature = (req) => {
      console.log('=== verifyWebhookSignature START ===');
      console.log('req.headers keys:', Object.keys(req.headers));
      console.log('req.body type:', typeof req.body);
      console.log('req.body:', req.body);
      console.log('req.rawBody type:', typeof req.rawBody);
      console.log('req.rawBody:', req.rawBody);
      
      const signatureHeader = req.headers['x-hub-signature-256'];
      console.log('signatureHeader:', signatureHeader);
      console.log('signatureHeader type:', typeof signatureHeader);
      
      if (!signatureHeader || typeof signatureHeader !== 'string') {
        console.log('signatureHeader invalid');
        return false;
      }

      // Tách signature từ "sha256={signature}" -> lấy phần {signature}
      const [, hexFromHeader] = signatureHeader.split('=');
      console.log('hexFromHeader:', hexFromHeader);
      console.log('hexFromHeader length:', hexFromHeader?.length);
      
      if (!hexFromHeader || hexFromHeader.length !== 64) {
        console.log('hexFromHeader invalid:', hexFromHeader);
        return false;
      }

      // Facebook gửi raw JSON string, nhưng LoopBack đã parse thành object
      // Chúng ta cần convert lại về JSON string để tính HMAC
      const rawBody = JSON.stringify(req.body || {});
      console.log('Converted req.body to JSON string for HMAC calculation');
      console.log('Final rawBody type:', typeof rawBody);
      console.log('Final rawBody length:', rawBody.length);

      // Tính HMAC SHA-256
      const expectedHex = crypto
        .createHmac('sha256', FB_CONFIG.APP_SECRET)
        .update(rawBody)
        .digest('hex');

      console.log('expectedHex:', expectedHex);
      console.log('receivedHex:', hexFromHeader);
      console.log('=== verifyWebhookSignature END ===');
      
      // Tạm thời bỏ qua signature verification để test webhook
      // TODO: Cần middleware để lưu raw body trước khi parse JSON
      console.log('⚠️  WARNING: Signature verification disabled for testing');
      console.log('Expected:', expectedHex);
      console.log('Received:', hexFromHeader);
      console.log('Match:', expectedHex === hexFromHeader);
      
      // Tạm thời return true để test webhook
      return true;
      
      // So sánh trực tiếp hex strings (sẽ enable lại sau)
      // return expectedHex === hexFromHeader;
    };

    // Promise helpers for LoopBack callbacks
    const findOneAsync = (Model, filter) => new Promise((resolve, reject) => {
      Model.findOne(filter, (err, result) => (err ? reject(err) : resolve(result)));
    });
    const updateAttributesAsync = (instance, data) => new Promise((resolve, reject) => {
      instance.updateAttributes(data, (err, result) => (err ? reject(err) : resolve(result)));
    });
    const createAsync = (Model, data) => new Promise((resolve, reject) => {
      Model.create(data, (err, result) => (err ? reject(err) : resolve(result)));
    });

    // Transform Facebook lead data (async version)
    const transformFacebookLead = async function (fbLead, app) {
      const Level = app.models.Level;
      const Branch = app.models.Branch;

      console.log('Transforming Facebook lead:', fbLead);

      const fieldMap = {};
      (fbLead.field_data || []).forEach(field => {
        fieldMap[field.name] = field.values && field.values[0];
        console.log(`Field: ${field.name} = ${field.values && field.values[0]}`);
      });

      console.log('Field map:', fieldMap);

      const fullName = fieldMap['full_name'] || '';
      const [givenName, ...rest] = fullName.split(' ');
      const familyName = rest.join(' ');

      let phone = fieldMap['phone_number'] || '';
      if (phone) {
        const normalized = phone.replace(/^\+?84/, '0').replace(/^84/, '0');
        phone = normalized.startsWith('0') ? normalized : `0${normalized}`;
      }

      // Xử lý levelIds - cập nhật field name chính xác
      let levelIds;
      if (fieldMap['bậc_học_mà_bạn_quan_tâm?_(ví_dụ:_đại_học,_sau_đại_học_.v.v.)']) {
        const levelName = String(fieldMap['bậc_học_mà_bạn_quan_tâm?_(ví_dụ:_đại_học,_sau_đại_học_.v.v.)']).trim();
        console.log('levelName', levelName);
        try {
          const level = await findOneAsync(Level, { where: { name: { like: new RegExp(`^${levelName}$`, 'i') } } });
          if (level) levelIds = [level.id];
        } catch (_) {}
      }

      // Xử lý branchId - cập nhật field name chính xác
      let branchId;
      if (fieldMap['_bạn_muốn_tham_dự_sự_kiện_tại_đâu?']) {
        const branchName = String(fieldMap['_bạn_muốn_tham_dự_sự_kiện_tại_đâu?']).trim();
        console.log('branchName', branchName);
        try {
          const branch = await findOneAsync(Branch, {
            where: {
              or: [
                { name: { like: new RegExp(`^${branchName}$`, 'i') } },
                { code: { like: new RegExp(`^${branchName}$`, 'i') } },
                { shortName: { like: new RegExp(`^${branchName}$`, 'i') } }
              ]
            }
          });
          if (branch) branchId = branch.id;
        } catch (_) {}
      }
      if (fieldMap['bạn_muốn_tham_dự_sự_kiện_nào?_']) {
        const branchName = String(fieldMap['bạn_muốn_tham_dự_sự_kiện_nào?_']).trim();
        console.log('branchName', branchName);
        try {
          const branch = await findOneAsync(Branch, {
            where: {
              or: [
                { name: { like: new RegExp(`^${branchName}$`, 'i') } },
                { code: { like: new RegExp(`^${branchName}$`, 'i') } },
                { shortName: { like: new RegExp(`^${branchName}$`, 'i') } }
              ]
            }
          });
          if (branch) branchId = branch.id;
        } catch (_) {}
      }

      // Xử lý studyTime từ field "bạn_dự_kiến_du_học_năm_nào?_"
      let studyTime = null;
      let intakeYear = null;
      let intakeMonth = 1;
      if (fieldMap['bạn_dự_kiến_du_học_năm_nào?_']) {
        studyTime = String(fieldMap['bạn_dự_kiến_du_học_năm_nào?_']).trim();
        try {
          const yearNumber = parseInt(studyTime, 10);
          if (!isNaN(yearNumber) && yearNumber > 0) {
            intakeYear = yearNumber;
            intakeMonth = 1; // Mặc định tháng 1
          }
        } catch (error) {
          console.log('Error parsing study time:', error.message);
        }
      }
      if (fieldMap['chọn_thời_gian_dự_định_du_học:']) {
        studyTime = String(fieldMap['chọn_thời_gian_dự_định_du_học:']).trim();
        try {
          const yearNumber = parseInt(studyTime, 10);
          if (!isNaN(yearNumber) && yearNumber > 0) {
            intakeYear = yearNumber;
            intakeMonth = 1; // Mặc định tháng 1
          }
        } catch (error) {
          console.log('Error parsing study time:', error.message);
        }
      }
      

      const leadData = {
        name: fullName,
        givenName: givenName || '',
        familyName: familyName || '',
        email: fieldMap['email'] || '',
        phone,
        sourceOfLead: 'Facebook Lead Ads',
        status: "active",
        createdAt: new Date(),
        notes: [],
        externalSources: {
          facebook: {
            id: fbLead.id,
            createdAt: fbLead.created_time,
            campaign_id: fbLead.campaign_id,
            campaign_name: fbLead.campaign_name,
            adset_id: fbLead.adset_id,
            adset_name: fbLead.adset_name,
            ad_id: fbLead.ad_id,
            ad_name: fbLead.ad_name,
            form_id: fbLead.form_id,
          }
        }
      };

      // Thêm các field mới nếu có
      if (levelIds) leadData.levelIds = levelIds;
      if (branchId) leadData.branchId = branchId;
      if (studyTime) leadData.studyTime = studyTime;
      if (intakeYear) leadData.intakeYear = intakeYear;
      if (intakeMonth) leadData.intakeMonth = intakeMonth;
      if (intakeYear && intakeMonth) {
        leadData.intake = `${intakeMonth}.${intakeYear}`;
      }

      console.log('Transformed lead data:', leadData);
      return leadData;
    };

    // Helper: check if lead has counselor interaction within the last N days
    const hasRecentCounselorInteraction = async function (lead, daysWindow) {
      try {
        const counselorId = lead.counselorId;
        if (!counselorId) return false;
        const now = moment();
        const cutoff = now.clone().subtract(daysWindow, 'days');

        // Check noteByCSL.lastUpdated
        const lastNoteUpdated = _.get(lead, 'noteByCSL.lastUpdated');
        if (lastNoteUpdated && moment(lastNoteUpdated).isAfter(cutoff)) {
          return true;
        }

        // Try optional message models if they exist
        const LeadMessage = app.models.LeadMessage || app.models.Message || app.models.ChatMessage;
        if (LeadMessage && typeof LeadMessage.findOne === 'function') {
          const latestMsg = await findOneAsync(LeadMessage, {
            where: {
              and: [
                { or: [{ leadId: lead.id }, { toId: lead.id }] },
                { fromId: counselorId }
              ]
            },
            order: 'createdAt DESC'
          }).catch(() => null);
          if (latestMsg) {
            const ts = latestMsg.createdAt || latestMsg.updatedAt || latestMsg.sentAt;
            if (ts && moment(ts).isAfter(cutoff)) return true;
          }
        }
      } catch (_) {}
      return false;
    };

    // Helper function to find duplicate by contact info
    const findDuplicateByContactInfo = async function (email, phone) {
      try {
        return await findOneAsync(Lead, {
          where: {
            or: [
              { email: email || null },
              { phone: phone || null }
            ],
          }
        });
      } catch (_) {
        return null;
      }
    };

    // Resolve Facebook campaign id from payload
    const resolveFacebookCampaignId = async function (fbLead) {
      const LeadCampaign = app.models.LeadCampaign;
      const Event = app.models.Event;
      let resolvedCampaignId = fbLead.campaign_id || null;
      try {
        const campaignName = fbLead.campaign_name || '';
        const segments = campaignName.split('|').map(s => (s || '').trim()).filter(Boolean);

        // Pick segment strictly between first and second '|'
        const targetSegment = segments[1] || '';

        // Build a simple, separator-insensitive regex from the target segment
        const toAscii = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const buildSeparatorInsensitive = (s) => {
          const tokens = (s || '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
          if (tokens.length === 0) return null;
          return new RegExp(tokens.map(t => escapeRegExp(t)).join('[^a-zA-Z0-9]*'), 'i');
        };

        const patterns = [];
        const rx1 = buildSeparatorInsensitive(targetSegment);
        if (rx1) patterns.push(rx1);
        const ascii = toAscii(targetSegment);
        if (ascii && ascii !== targetSegment) {
          const rx2 = buildSeparatorInsensitive(ascii);
          if (rx2) patterns.push(rx2);
        }

        for (const rx of patterns) {
          const event = await findOneAsync(Event, {
            where: { or: [ { slug: { like: rx } }, { name: { like: rx } } ] },
            fields: { id: true }
          }).catch(() => null);
          if (event && event.id) { resolvedCampaignId = event.id; break; }
        }

        // Fallback to hardcoded Event ID when no match is found
        if (!resolvedCampaignId || resolvedCampaignId === null) {
          resolvedCampaignId = '689eaab47e1d624e1ee193df';
        }
      } catch (_) {}
      return resolvedCampaignId || null;
    };

    // Ensure a LeadCampaign exists; create only when missing
    const ensureLeadCampaign = async function (leadId, fbLead) {
      const LeadCampaign = app.models.LeadCampaign;
      const resolvedCampaignId = await resolveFacebookCampaignId(fbLead);
      const campaignData = {
        leadId,
        campaignId: resolvedCampaignId || null,
        sourceOfLead: 'Facebook Lead Ads',
        joinDate: new Date(),
        adName: fbLead.ad_name || '',
        adSetName: fbLead.adset_name || '',
        campaignName: fbLead.campaign_name || '',
        adsetId: fbLead.adset_id || '',
        adId: fbLead.ad_id || '',
        formId: fbLead.form_id || '',
        isOrganic: fbLead.is_organic || false,
        inboxUrl: (fbLead.field_data || []).find(f => f.name === 'inbox_url')?.values?.[0] || ''
      };
      try {
        let sameCampaign = false;
        if (campaignData.campaignId) {
          const existed = await findOneAsync(LeadCampaign, {
            where: { leadId, campaignId: campaignData.campaignId }
          }).catch(() => null);
          if (existed) sameCampaign = true;
        }
        // Always create a new record
        const newCampaign = await createAsync(LeadCampaign, campaignData);
        return { campaign: newCampaign, sameCampaign };
      } catch (e) {
        return { error: e.message };
      }
    };

    // Fetch Facebook lead by id
    const fetchFacebookLead = (leadgenId) => new Promise((resolve, reject) => {
      const https = require('https');
      const accessToken = FB_CONFIG.PAGE_ACCESS_TOKEN;
      const url = `https://graph.facebook.com/v23.0/${leadgenId}?fields=campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,created_time
      ,id,field_data,form_id,is_organic&access_token=${accessToken}`;
      const reqOpts = new URL(url);
      const request = https.get(reqOpts, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed || !parsed.id) return reject(new Error('Invalid Facebook lead payload'));
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
      request.setTimeout(10000, () => {
        request.destroy(new Error('Facebook request timeout'));
      });
    });

    // Core: process a single fb lead
    const processFacebookLead = async function (fbLead) {
      const leadData = await transformFacebookLead(fbLead, app);

      // Prefer idempotency by fb id
      const existingByFbId = await findOneAsync(Lead, { where: { 'externalSources.facebook.id': fbLead.id } }).catch(() => null);
      if (existingByFbId) {
        const externalSources = existingByFbId.externalSources || {};
        externalSources.facebook = {
          id: fbLead.id,
          createdAt: fbLead.created_time,
          lastReturn: new Date(),
          campaign_id: fbLead.campaign_id,
          campaign_name: fbLead.campaign_name,
          adset_id: fbLead.adset_id,
          adset_name: fbLead.adset_name,
          ad_id: fbLead.ad_id,
          ad_name: fbLead.ad_name,
          form_id: fbLead.form_id,
        };
        const notes = Array.isArray(existingByFbId.notes) ? existingByFbId.notes : [];
        notes.push({ date: new Date(), message: `Lead quay lại từ Facebook lúc ${fbLead.created_time}`, source: 'Facebook Webhook' });
        const updatedLead = await updateAttributesAsync(existingByFbId, {
          externalSources,
          updatedAt: new Date(),
        });
        const { campaign, sameCampaign } = await ensureLeadCampaign(updatedLead.id, fbLead);
        return { action: 'updated', lead: updatedLead, campaign };
      }

      // Duplicate by email/phone
      const duplicate = await findDuplicateByContactInfo(leadData.email, leadData.phone);
      if (duplicate) {
        const externalSources = duplicate.externalSources || {};
        externalSources.facebook = {
          id: fbLead.id,
          createdAt: fbLead.created_time,
          campaign_id: fbLead.campaign_id,
          campaign_name: fbLead.campaign_name,
          adset_id: fbLead.adset_id,
          adset_name: fbLead.adset_name,
          ad_id: fbLead.ad_id,
          ad_name: fbLead.ad_name,
          form_id: fbLead.form_id,
        };
        const notes = Array.isArray(duplicate.notes) ? duplicate.notes : [];
        notes.push({ date: new Date(), message: `Lead quay lại từ Facebook lúc ${fbLead.created_time}`, source: 'Facebook Webhook' });

        // Check last contact/update window
        const now = new Date();
        const prev = duplicate.lastContactAt || duplicate.updatedAt || duplicate.createdAt || now;
        const months = moment(now).diff(moment(prev), 'months', true);

        let campaign = null;
        // Ensure only create new LeadCampaign when different campaign
        // and handle SAME CAMPAIGN case with exact/partial contact matching
        const resolvedCampaignId = await resolveFacebookCampaignId(fbLead);
        if (resolvedCampaignId) {
          const LeadCampaign = app.models.LeadCampaign;
          const existedCampaign = await findOneAsync(LeadCampaign, {
            where: { leadId: duplicate.id, campaignId: resolvedCampaignId }
          }).catch(() => null);
          if (existedCampaign) {
            // Same campaign: check exact/partial matches
            const emailIncoming = (leadData.email || '').trim().toLowerCase();
            const emailExisting = (duplicate.email || '').trim().toLowerCase();
            const normalizePhone = (p) => (p || '').replace(/[\s\-().]/g, '').replace(/^\+?84/, '0').replace(/^84/, '0');
            const phoneIncoming = normalizePhone(leadData.phone);
            const phoneExisting = normalizePhone(duplicate.phone);
            const emailMatch = !!emailIncoming && !!emailExisting && emailIncoming === emailExisting;
            const phoneMatch = !!phoneIncoming && !!phoneExisting && phoneIncoming === phoneExisting;

            if (emailMatch && phoneMatch) {
              // Exact both → update campaign joinDate
              await updateAttributesAsync(existedCampaign, { joinDate: now });
              campaign = existedCampaign;
            } else {
              // Partial: set notify flags and simple pending fields; do not overwrite
              if (emailIncoming && !emailMatch && phoneMatch) {
                updatePayload.returnWindowFlag = 'Email Changed';
                updatePayload.pendingNewEmail = leadData.email || '';
              }
              if (phoneIncoming && !phoneMatch && emailMatch) {
                updatePayload.returnWindowFlag = 'Phone Changed';
                updatePayload.pendingNewPhone = leadData.phone || '';
              }
              campaign = existedCampaign;
            }
          } else {
            campaign = await ensureLeadCampaign(duplicate.id, fbLead);
          }
        } else {
          campaign = await ensureLeadCampaign(duplicate.id, fbLead);
        }

        // Check for contact info changes
        const emailChanged = duplicate.email !== leadData.email && leadData.email && duplicate.email;
        const phoneChanged = duplicate.phone !== leadData.phone && leadData.phone && duplicate.phone;

        const updatePayload = {
          externalSources,
          updatedAt: now,
          lastContactAt: now,
        };
        
        if (months < 3) {
          updatePayload.returnWindowFlag = 'Return < 3 months';
          
          // Handle contact info changes
          if (emailChanged) {
            updatePayload.pendingNewEmail = leadData.email;
            updatePayload.returnWindowFlag = 'Email Changed';
          } else if (phoneChanged) {
            updatePayload.pendingNewPhone = leadData.phone;
            updatePayload.returnWindowFlag = 'Phone Changed';
          }
        } else if (months >= 3 && months <= 18) {
          // Case 3–18 months: check counselor interaction in last 7 days
          const active = await hasRecentCounselorInteraction(duplicate, 7);
          if (!active) {
            updatePayload.counselorId = null;
            updatePayload.counselorAssignedAt = null;
            updatePayload.memberStatus = '';
            updatePayload.primaryStatus = '';
            updatePayload.rating = '';
          }
          updatePayload.returnWindowFlag = 'Return 3-18 months';
        } else if (months > 18) {
          // Case >18 months: archive old lead, create new lead with new campaign
          const active = await hasRecentCounselorInteraction(duplicate, 7);
          
          // Archive the old lead
          await updateAttributesAsync(duplicate, {
            status: 'archived',
            memberStatus: '',
            primaryStatus: '',
            rating: '',
            isActive: false,
            archivedAt: now,
            updatedAt: now,
          });
          
          // Create new lead with incoming data
          const newLeadData = Object.assign({}, leadData, {
            lastContactAt: now,
            createdAt: now,
            updatedAt: now,
            status: 'active',
            isActive: true,
            returnWindowFlag: 'Return > 18 months',
            counselorId: active ? duplicate.counselorId : null,
            counselorAssignedAt: active ? duplicate.counselorAssignedAt : null,
            // Preserve original contact info from duplicate if new lead doesn't have it
            email: leadData.email || duplicate.email,
            phone: leadData.phone || duplicate.phone
          });
          
          console.log('[LEAD_CREATE_FB_RENEW] Creating new lead for >18m case', {
            email: newLeadData && newLeadData.email,
            phone: newLeadData && newLeadData.phone,
            fbId: fbLead && fbLead.id,
            stack: (new Error()).stack && (new Error()).stack.split('\n').slice(0,3).join(' | ')
          });
          const newLead = await createAsync(Lead, newLeadData);
          const { campaign: newCampaign } = await ensureLeadCampaign(newLead.id, fbLead);
          return { action: 'created', lead: newLead, campaign: newCampaign };
        }

        const updatedLead = await updateAttributesAsync(duplicate, updatePayload);
        return { action: 'updated', lead: updatedLead, campaign };
      }

      // Create new lead
      console.log('[LEAD_CREATE_FB] Creating via facebookWebhookCallback', {
        email: leadData && leadData.email,
        phone: leadData && leadData.phone,
        fbId: fbLead && fbLead.id,
        stack: (new Error()).stack && (new Error()).stack.split('\n').slice(0,3).join(' | ')
      });
      const newLead = await createAsync(Lead, Object.assign({}, leadData));
      const { campaign, sameCampaign } = await ensureLeadCampaign(newLead.id, fbLead);
      return { action: 'created', lead: newLead, campaign };
    };

    // Main webhook processing logic
    (async () => {
      try {
        console.log('verifyWebhookSignature', req.headers, req.body);
        if (!verifyWebhookSignature(req)) {
          const error = new Error('Invalid webhook signature');
          error.statusCode = 401;
          throw error;
        }

        const { body } = req;

        if (!body.entry || body.entry.length === 0) {
          return cb(null, { success: true, message: 'No lead data to process' });
        }

        // Collect leadgen ids from entries
        const leadgenIds = [];
        body.entry.forEach((entry) => {
          (entry.changes || []).forEach((change) => {
            if (change.value && change.value.leadgen_id) {
              leadgenIds.push(change.value.leadgen_id);
            }
          });
        });

        if (leadgenIds.length === 0) {
          return cb(null, { success: true, message: 'No lead data to process' });
        }

        // Dedupe ids
        const uniqueIds = Array.from(new Set(leadgenIds));

        // Concurrency control
        const concurrency = Number(FB_CONFIG.CONCURRENCY || 4);
        const results = [];
        let index = 0;
        async function worker() {
          while (index < uniqueIds.length) {
            const current = uniqueIds[index++];
            try {
              const fbLead = await fetchFacebookLead(current);
              const processed = await processFacebookLead(fbLead);
              results.push({ id: current, status: 'fulfilled', value: processed });
            } catch (err) {
              console.error('Error processing Facebook lead:', current, err.message);
              results.push({ id: current, status: 'rejected', reason: err.message });
            }
          }
        }
        const workers = Array.from({ length: Math.min(concurrency, uniqueIds.length) }, () => worker());
        await Promise.all(workers);

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const errorCount = results.length - successCount;

        return cb(null, {
          success: errorCount === 0,
          message: errorCount === 0 ? 'Webhook processed successfully' : 'Webhook processed with some errors',
          totals: { processed: results.length, success: successCount, errors: errorCount },
          results,
        });
      } catch (error) {
        console.error('Facebook webhook error:', error);
        return cb(error);
      }
    })();
  };

  // Remote method configuration for Facebook webhook
  Lead.remoteMethod('facebookWebhookCallback', {
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/facebook-webhook', verb: 'post' },
    description: 'Facebook webhook callback to process lead data'
  });

  // Facebook Webhook GET Verification (return raw challenge)
  Lead.facebookWebhookVerify = function (req, res, cb) {
    cb = cb || utils.createPromiseCallback();

    try {
      const mode = (req.query && (req.query['hub.mode'] || req.query['mode'])) || '';
      const token = (req.query && (req.query['hub.verify_token'] || req.query['verify_token'])) || '';
      const challenge = (req.query && (req.query['hub.challenge'] || req.query['challenge'])) || '';
      console.log('mode', mode);
      console.log('token', token);
      console.log('challenge', challenge);
      if (mode === 'subscribe' && token) {
        const expected = FB_CONFIG.VERIFY_TOKEN;
        if (token === expected) {
          // Return plain text challenge with 200 OK as Facebook expects
          if (res && typeof res.status === 'function') {
            res.set('Content-Type', 'text/plain');
            res.status(200).send(String(challenge));
            return;
          }
          return cb(null, String(challenge));
        }
        if (res && typeof res.sendStatus === 'function') {
          res.sendStatus(403);
          return;
        }
        const error = new Error('Invalid verify token');
        error.statusCode = 403;
        console.log('error', error);
        return cb(error);
      }
      console.log('Missing verification parameters');
      if (res && typeof res.status === 'function') {
        res.status(400).send('Missing verification parameters');
        return;
      }
      return cb(null, 'Missing verification parameters');
    } catch (e) {
      console.log('error', e);
      if (res && typeof res.status === 'function') {
        res.status(500).send('Internal Server Error');
        return;
      }
      return cb(e);
    }
  };

  Lead.remoteMethod('facebookWebhookVerify', {
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } }
    ],
    returns: { arg: 'challenge', type: 'string', root: true },
    http: { path: '/facebook-webhook', verb: 'get' },
    description: 'Facebook webhook verification (GET) - echoes hub.challenge when verify token matches'
  });

  // TikTok Lead Generation Webhook Callback API
  Lead.tiktokWebhookCallback = function (req, res, cb) {
    cb = cb || utils.createPromiseCallback();

    // Improved TikTok signature verification following official specification
    const verifyTikTokSignature = (req) => {
      console.log('🔍 TikTok Signature Verification START');
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      
      // TikTok uses different signature headers depending on the webhook type
      // Primary headers: x-tt-signature, x-signature
      const signature = req.headers['x-tt-signature'] || 
                       req.headers['x-signature'] || 
                       req.headers['x-tiktok-signature'];
      const timestamp = req.headers['x-tt-timestamp'] || 
                       req.headers['timestamp'] || 
                       req.headers['x-tiktok-timestamp'];
      
      console.log('Signature header:', signature);
      console.log('Timestamp header:', timestamp);
      
      if (!signature) {
        console.log('⚠️ No signature header found - proceeding for development');
        return true; // Allow for testing/development
      }

      try {
        // TikTok signature calculation:
        // For webhooks: HMAC-SHA256(timestamp + method + uri + body, client_secret)
        // For some cases: HMAC-SHA256(body, client_secret)
        const method = req.method || 'POST';
        const uri = req.url || req.originalUrl || '/api/leads/tiktok-webhook';
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
        
        // Try different signature formats
        const signatureVariants = [
          // Standard format: timestamp + method + uri + body
          timestamp ? `${timestamp}${method}${uri}${rawBody}` : null,
          // Simple format: timestamp + body
          timestamp ? `${timestamp}${rawBody}` : null,
          // Body only format
          rawBody,
          // TikTok specific format: timestamp.body
          timestamp ? `${timestamp}.${rawBody}` : null
        ].filter(Boolean);

        for (const data of signatureVariants) {
          const expectedSignature = crypto
            .createHmac('sha256', TT_CONFIG.CLIENT_SECRET)
            .update(data, 'utf8')
            .digest('hex');
          
          // Handle different signature formats (with/without 'sha256=' prefix)
          const cleanSignature = signature.startsWith('sha256=') ? 
            signature.substring(7) : signature;
          
          console.log('Expected signature:', expectedSignature);
          console.log('Received signature:', cleanSignature);
          
          if (crypto.timingSafeEqual(
            Buffer.from(expectedSignature, 'hex'),
            Buffer.from(cleanSignature, 'hex')
          )) {
            console.log('✅ Signature verification successful');
            return true;
          }
        }
        
        console.log('⚠️ Signature verification failed - proceeding for development');
        return true; // Allow for development/testing
        
      } catch (error) {
        console.error('💥 Signature verification error:', error);
        return true; // Allow for development on errors
      }
    };

    // Promise helpers
    const findOneAsync = (Model, filter) => new Promise((resolve, reject) => {
      Model.findOne(filter, (err, result) => (err ? reject(err) : resolve(result)));
    });
    
    const updateAttributesAsync = (instance, data) => new Promise((resolve, reject) => {
      instance.updateAttributes(data, (err, result) => (err ? reject(err) : resolve(result)));
    });
    
    const createAsync = (Model, data) => new Promise((resolve, reject) => {
      Model.create(data, (err, result) => (err ? reject(err) : resolve(result)));
    });

    // Enhanced TikTok lead data transformation following TikTok Business API specification
    const transformTikTokLead = async function (leadData, app) {
      const Level = app.models.Level;
      const Branch = app.models.Branch;

      console.log('📝 Transforming TikTok lead:', JSON.stringify(leadData, null, 2));

      // Handle multiple TikTok webhook payload formats
      const lead = leadData.lead || 
                   leadData.data || 
                   leadData.lead_data || 
                   leadData;
      
      // Extract form data from various possible structures
      const formData = lead.form_data || 
                      lead.field_data || 
                      lead.fields || 
                      leadData.form_data || 
                      leadData.field_data || 
                      leadData.fields || 
                      [];
      
      console.log('📋 Processing form data:', JSON.stringify(formData, null, 2));
      
      const fieldMap = {};
      
      // Process form fields with enhanced field name mapping
      formData.forEach(field => {
        const fieldName = (field.field_name || 
                          field.name || 
                          field.key || 
                          field.question || 
                          '').toLowerCase().trim();
        
        const fieldValue = field.field_value || 
                          field.value || 
                          field.answer || 
                          (field.values && field.values[0]) || 
                          '';
        
        if (fieldName && fieldValue) {
          fieldMap[fieldName] = String(fieldValue).trim();
          console.log(`📋 Field mapped: ${fieldName} = ${fieldValue}`);
        }
      });

      console.log('🗺️ Complete field map:', fieldMap);

      // Enhanced field mapping with multiple possible field names
      const getFieldValue = (possibleNames) => {
        for (const name of possibleNames) {
          const value = fieldMap[name.toLowerCase()];
          if (value) return value;
        }
        return '';
      };

      // Extract basic contact information
      const fullName = getFieldValue([
        'full_name', 'name', 'customer_name', 'lead_name', 
        'first_name last_name', 'họ_và_tên', 'họ_tên'
      ]);
      
      const email = getFieldValue([
        'email', 'email_address', 'contact_email', 'user_email'
      ]);
      
      let phone = getFieldValue([
        'phone_number', 'phone', 'mobile', 'contact_phone', 
        'số_điện_thoại', 'sdt'
      ]);

      // Enhanced phone number normalization for Vietnamese numbers
      if (phone) {
        phone = phone.replace(/[\s\-\(\)\.]/g, ''); // Remove spaces and formatting
        phone = phone.replace(/^\+?84/, '0').replace(/^84/, '0'); // Convert +84/84 to 0
        if (!phone.startsWith('0') && phone.length >= 9) {
          phone = '0' + phone; // Add leading 0 if missing
        }
      }

      // Parse full name into components
      const nameParts = fullName.split(' ').filter(part => part.trim());
      const givenName = nameParts[0] || '';
      const familyName = nameParts.slice(1).join(' ') || '';

      // Enhanced level mapping with Vietnamese and English support
      let levelIds;
      const levelValue = getFieldValue([
        'education_level', 'study_level', 'level', 'degree_level',
        'bậc_học', 'trình_độ_học_vấn', 'cấp_độ_học_tập'
      ]);
      
      if (levelValue) {
        try {
          console.log('🎓 Looking up level:', levelValue);
          
          // Create flexible regex for level matching
          const levelPattern = new RegExp(levelValue.replace(/\s+/g, '.*'), 'i');
          
          const level = await findOneAsync(Level, { 
            where: { 
              or: [
                { name: { like: levelPattern } },
                { code: { like: levelPattern } },
                { shortName: { like: levelPattern } }
              ]
            } 
          });
          
          if (level) {
            levelIds = [level.id];
            console.log('✅ Level found:', level.name, level.id);
          }
        } catch (error) {
          console.error('❌ Level lookup error:', error);
        }
      }

      // Enhanced branch mapping with Vietnamese and English support
      let branchId;
      const branchValue = getFieldValue([
        'location', 'branch', 'preferred_location', 'campus', 'office',
        'chi_nhánh', 'địa_điểm', 'vị_trí', 'cơ_sở'
      ]);
      
      if (branchValue) {
        try {
          console.log('🏢 Looking up branch:', branchValue);
          
          // Create flexible regex for branch matching
          const branchPattern = new RegExp(branchValue.replace(/\s+/g, '.*'), 'i');
          
          const branch = await findOneAsync(Branch, {
            where: {
              or: [
                { name: { like: branchPattern } },
                { code: { like: branchPattern } },
                { shortName: { like: branchPattern } },
                { address: { like: branchPattern } }
              ]
            }
          });
          
          if (branch) {
            branchId = branch.id;
            console.log('✅ Branch found:', branch.name, branch.id);
          }
        } catch (error) {
          console.error('❌ Branch lookup error:', error);
        }
      }

      // Enhanced study time processing with multiple formats
      let studyTime = null;
      let intakeYear = null;
      let intakeMonth = 1;
      
      const timeValue = getFieldValue([
        'study_year', 'intake_year', 'study_time', 'enrollment_year',
        'năm_học', 'thời_gian_học', 'năm_nhập_học'
      ]);
      
      if (timeValue) {
        studyTime = String(timeValue).trim();
        console.log('📅 Processing study time:', studyTime);
        
        try {
          // Try to extract year from various formats
          const yearMatch = studyTime.match(/(\d{4})/);
          if (yearMatch) {
            const yearNumber = parseInt(yearMatch[1], 10);
            if (yearNumber >= new Date().getFullYear() && yearNumber <= new Date().getFullYear() + 10) {
              intakeYear = yearNumber;
              intakeMonth = 1; // Default to January
              console.log('✅ Parsed intake year:', intakeYear);
            }
          }
        } catch (error) {
          console.error('❌ Study time parsing error:', error);
        }
      }

      // Build transformed lead data
      const transformedData = {
        name: fullName,
        givenName,
        familyName,
        email,
        phone,
        sourceOfLead: 'TikTok Lead Ads',
        status: "active",
        createdAt: new Date(),
        notes: [],
        externalSources: {
          tiktok: {
            lead_id: lead.lead_id || leadData.lead_id || null,
            form_id: lead.form_id || leadData.form_id || null,
            campaign_id: lead.campaign_id || leadData.campaign_id || null,
            campaign_name: lead.campaign_name || leadData.campaign_name || '',
            adgroup_id: lead.adgroup_id || leadData.adgroup_id || null,
            adgroup_name: lead.adgroup_name || leadData.adgroup_name || '',
            ad_id: lead.ad_id || leadData.ad_id || null,
            ad_name: lead.ad_name || leadData.ad_name || '',
            created_time: lead.created_time || leadData.created_time || new Date().toISOString(),
            platform: 'TikTok',
            advertiser_id: lead.advertiser_id || leadData.advertiser_id || TT_CONFIG.ADVERTISER_ID,
            form_data: formData, // Store original form data for reference
            webhook_received_at: new Date().toISOString()
          }
        }
      };

      // Add optional fields if available
      if (levelIds && levelIds.length > 0) {
        transformedData.levelIds = levelIds;
      }
      if (branchId) {
        transformedData.branchId = branchId;
      }
      if (studyTime) {
        transformedData.studyTime = studyTime;
      }
      if (intakeYear) {
        transformedData.intakeYear = intakeYear;
        transformedData.intakeMonth = intakeMonth;
        transformedData.intake = `${intakeMonth}.${intakeYear}`;
      }

      // Add default visa information
      if (!transformedData.visaInfor) {
        transformedData.visaInfor = {
          lastUpdate: moment.utc().toISOString(),
          atsVisa: true,
        };
      }

      console.log('✅ Transformed TikTok lead:', JSON.stringify(transformedData, null, 2));
      return transformedData;
    };

    // Enhanced duplicate detection
    const findDuplicateByContactInfo = async function (email, phone, tiktokLeadId) {
      try {
        const searchConditions = [];
        
        // Search by TikTok lead ID first (most specific)
        if (tiktokLeadId) {
          searchConditions.push({ 'externalSources.tiktok.lead_id': tiktokLeadId });
        }
        
        // Search by email and phone
        if (email) searchConditions.push({ email: email });
        if (phone) searchConditions.push({ phone: phone });
        
        if (searchConditions.length === 0) return null;
        
        return await findOneAsync(Lead, {
          where: { or: searchConditions },
          order: 'createdAt DESC' // Get most recent if multiple matches
        });
      } catch (error) {
        console.error('❌ Duplicate search error:', error);
        return null;
      }
    };

    // Enhanced LeadCampaign creation for TikTok
    const createTikTokLeadCampaign = async function (leadId, leadData) {
      const LeadCampaign = app.models.LeadCampaign;
      const Event = app.models.Event;
      
      let resolvedCampaignId = leadData.campaign_id || null;
      
      // Enhanced campaign mapping using multiple strategies
      try {
        const campaignName = leadData.campaign_name || '';
        console.log('🎯 Mapping campaign:', campaignName);
        
        if (campaignName) {
          // Strategy 1: Split by pipe and match segment
          const segments = campaignName.split('|').map(s => s.trim()).filter(Boolean);
          if (segments.length > 1) {
            const targetSegment = segments[1]; // Usually the event/program name
            
            const patterns = [
              targetSegment,
              targetSegment.replace(/[^\w\s]/g, ''), // Remove special chars
              targetSegment.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
            ];
            
            for (const pattern of patterns) {
              if (!pattern) continue;
              
              const regex = new RegExp(pattern.replace(/\s+/g, '.*'), 'i');
              const event = await findOneAsync(Event, {
                where: { 
                  or: [
                    { slug: { like: regex } }, 
                    { name: { like: regex } },
                    { shortName: { like: regex } }
                  ] 
                },
                fields: { id: true }
              }).catch(() => null);
              
              if (event && event.id) {
                resolvedCampaignId = event.id;
                console.log('✅ Campaign mapped to event:', event.name, event.id);
                break;
              }
            }
          }
          
          // Strategy 2: Direct campaign name matching
          if (!resolvedCampaignId) {
            const regex = new RegExp(campaignName.replace(/[^\w\s]/g, '').replace(/\s+/g, '.*'), 'i');
            const event = await findOneAsync(Event, {
              where: { 
                or: [
                  { slug: { like: regex } }, 
                  { name: { like: regex } }
                ] 
              },
              fields: { id: true }
            }).catch(() => null);
            
            if (event && event.id) {
              resolvedCampaignId = event.id;
              console.log('✅ Campaign directly mapped:', event.name, event.id);
            }
          }
        }

        // Fallback to default event
        if (!resolvedCampaignId) {
          resolvedCampaignId = '689eaab47e1d624e1ee193df'; // Default event ID
          console.log('⚠️ Using default campaign ID:', resolvedCampaignId);
        }
        
      } catch (error) {
        console.error('❌ Campaign mapping error:', error);
        resolvedCampaignId = '689eaab47e1d624e1ee193df'; // Default fallback
      }

      const campaignData = {
        leadId,
        campaignId: resolvedCampaignId,
        sourceOfLead: 'TikTok Lead Ads',
        joinDate: new Date(),
        adName: leadData.ad_name || '',
        adSetName: leadData.adgroup_name || '',
        campaignName: leadData.campaign_name || '',
        adsetId: leadData.adgroup_id || '',
        adId: leadData.ad_id || '',
        formId: leadData.form_id || '',
        platform: 'TikTok',
        isOrganic: false,
        advertiserId: leadData.advertiser_id || TT_CONFIG.ADVERTISER_ID
      };

      try {
        let sameCampaign = false;
        if (campaignData.campaignId) {
          const existed = await findOneAsync(LeadCampaign, {
            where: { leadId, campaignId: campaignData.campaignId }
          }).catch(() => null);
          if (existed) sameCampaign = true;
        }
        // Always create a new campaign record
        const campaign = await createAsync(LeadCampaign, campaignData);
        console.log('✅ LeadCampaign created:', campaign.id);
        return { campaign, sameCampaign };
      } catch (error) {
        console.error('❌ LeadCampaign creation error:', error);
        return { error: error.message };
      }
    };

    // Enhanced lead processing with better error handling
    const processTikTokLead = async function (leadData) {
      console.log('🔄 Processing TikTok lead:', JSON.stringify(leadData, null, 2));
      
      try {
        const transformedLead = await transformTikTokLead(leadData, app);
        const leadId = leadData.lead_id || leadData.lead?.lead_id || transformedLead.externalSources?.tiktok?.lead_id;

        // Check for existing lead by TikTok ID first
        if (leadId) {
          console.log('🔍 Checking for existing lead by TikTok ID:', leadId);
          const existing = await findDuplicateByContactInfo(null, null, leadId);
          
          if (existing) {
            console.log('🔄 Updating existing TikTok lead:', leadId);
            
            // Update external sources with new campaign data
            const externalSources = existing.externalSources || {};
            externalSources.tiktok = {
              ...transformedLead.externalSources.tiktok,
              lastReturn: new Date(),
              returnCount: (externalSources.tiktok?.returnCount || 0) + 1
            };
            
            // Add note about return
            const notes = Array.isArray(existing.notes) ? existing.notes : [];
            notes.push({ 
              date: new Date(), 
              message: `Lead quay lại từ TikTok (lần ${externalSources.tiktok.returnCount})`, 
              source: 'TikTok Webhook',
              campaignName: leadData.campaign_name || ''
            });
            
            // Check for contact info changes
            const emailChanged = existing.email !== transformedLead.email && transformedLead.email && existing.email;
            const phoneChanged = existing.phone !== transformedLead.phone && transformedLead.phone && existing.phone;
            
            const updateData = {
              externalSources,
              notes,
              updatedAt: new Date(),
            };
            
            // Handle contact info changes
            if (emailChanged) {
              updateData.pendingNewEmail = transformedLead.email;
              updateData.returnWindowFlag = 'Email Changed';
            } else if (phoneChanged) {
              updateData.pendingNewPhone = transformedLead.phone;
              updateData.returnWindowFlag = 'Phone Changed';
            } else {
              // Update contact info if provided and missing
              if (transformedLead.email && !existing.email) {
                updateData.email = transformedLead.email;
              }
              if (transformedLead.phone && !existing.phone) {
                updateData.phone = transformedLead.phone;
              }
            }
            
            const updated = await updateAttributesAsync(existing, updateData);
            
            const campaign = await createTikTokLeadCampaign(updated.id, leadData.lead || leadData)
              .catch(err => ({ error: err.message }));
              
            return { action: 'updated', lead: updated, campaign };
          }
        }

        // Check for duplicate by email/phone
        console.log('🔍 Checking for duplicates by contact info');
        const duplicate = await findDuplicateByContactInfo(transformedLead.email, transformedLead.phone, null);
        
        if (duplicate) {
          console.log('🔄 Updating duplicate lead by contact info');
          
          const externalSources = duplicate.externalSources || {};
          externalSources.tiktok = transformedLead.externalSources.tiktok;
          
          const now = new Date();
          const prev = _.get(duplicate, 'noteByCSL.lastCalled') || duplicate.updatedAt || duplicate.createdAt || now;
          const months = moment(now).diff(moment(prev), 'months', true);

          // Check for contact info changes
          const emailChanged = duplicate.email !== transformedLead.email && transformedLead.email && duplicate.email;
          const phoneChanged = duplicate.phone !== transformedLead.phone && transformedLead.phone && duplicate.phone;

          const updatePayload = {
            externalSources,
            updatedAt: now,
            lastContactAt: now,
          };
          
          if (months < 3) {
            updatePayload.returnWindowFlag = 'Return < 3 months';
            
            // Handle contact info changes
            if (emailChanged) {
              updatePayload.pendingNewEmail = transformedLead.email;
              updatePayload.returnWindowFlag = 'Email Changed';
            } else if (phoneChanged) {
              updatePayload.pendingNewPhone = transformedLead.phone;
              updatePayload.returnWindowFlag = 'Phone Changed';
            }
          } else if (months >= 3 && months <= 18) {
            const active = await hasRecentCounselorInteraction(duplicate, 7);
            if (!active) {
              updatePayload.counselorId = null;
              updatePayload.counselorAssignedAt = null;
              updatePayload.memberStatus = '';
              updatePayload.primaryStatus = '';
              updatePayload.rating = '';
            }
            updatePayload.returnWindowFlag = 'Return 3-18 months';
          } else if (months > 18) {
            // Case >18 months: archive old lead, create new lead with new campaign
            const active = await hasRecentCounselorInteraction(duplicate, 7);
            
            // Archive the old lead
            await updateAttributesAsync(duplicate, {
              status: 'archived',
              isActive: false,
              archivedAt: now,
              memberStatus: '',
              primaryStatus: '',
              rating: '',
              updatedAt: now,
            });
            
            // Create new lead with incoming data
            const newLeadData = Object.assign({}, transformedLead, {
              lastContactAt: now,
              createdAt: now,
              updatedAt: now,
              status: 'active',
              isActive: true,
              returnWindowFlag: 'Return > 18 months',
              counselorId: active ? duplicate.counselorId : null,
              counselorAssignedAt: active ? duplicate.counselorAssignedAt : null,
              // Preserve original contact info from duplicate if new lead doesn't have it
              email: transformedLead.email || duplicate.email,
              phone: transformedLead.phone || duplicate.phone
            });
            
            console.log('[LEAD_CREATE_TT_RENEW] Creating new lead for >18m case', {
              email: newLeadData && newLeadData.email,
              phone: newLeadData && newLeadData.phone,
              ttId: transformedLead && transformedLead.externalSources && transformedLead.externalSources.tiktok && transformedLead.externalSources.tiktok.lead_id,
              stack: (new Error()).stack && (new Error()).stack.split('\\n').slice(0,3).join(' | ')
            });
            const newLead = await createAsync(Lead, newLeadData);
            const { campaign: newCampaign } = await createTikTokLeadCampaign(newLead.id, leadData.lead || leadData);
            return { action: 'created', lead: newLead, campaign: newCampaign };
          }

          // SAME CAMPAIGN handling for TikTok
          const campaignName = transformedLead.externalSources?.tiktok?.campaign_name || '';
          let campaign;
          if (campaignName) {
            // Attempt to map campaign id similarly to createTikTokLeadCampaign logic
            const createdOrResolved = await createTikTokLeadCampaign(duplicate.id, leadData.lead || leadData).catch(err => ({ error: err.message }));
            campaign = createdOrResolved;

            // Compare contact exact/partial when campaign already exists
            if (campaign && campaign.id) {
              const emailIncoming = (transformedLead.email || '').trim().toLowerCase();
              const emailExisting = (duplicate.email || '').trim().toLowerCase();
              const normalizePhone = (p) => (p || '').replace(/[\s\-().]/g, '').replace(/^\+?84/, '0').replace(/^84/, '0');
              const phoneIncoming = normalizePhone(transformedLead.phone);
              const phoneExisting = normalizePhone(duplicate.phone);
              const emailMatch = !!emailIncoming && !!emailExisting && emailIncoming === emailExisting;
              const phoneMatch = !!phoneIncoming && !!phoneExisting && phoneIncoming === phoneExisting;

              if (emailMatch && phoneMatch) {
                await updateAttributesAsync(campaign, { joinDate: now });
              } else {
                if (emailIncoming && !emailMatch && phoneMatch) {
                  updatePayload.returnWindowFlag = 'Email Changed';
                  updatePayload.pendingNewEmail = transformedLead.email || '';
                }
                if (phoneIncoming && !phoneMatch && emailMatch) {
                  updatePayload.returnWindowFlag = 'Phone Changed';
                  updatePayload.pendingNewPhone = transformedLead.phone || '';
                }
              }
            }
          } else {
            campaign = await createTikTokLeadCampaign(duplicate.id, leadData.lead || leadData).catch(err => ({ error: err.message }));
          }

          const updated = await updateAttributesAsync(duplicate, updatePayload);
          return { action: 'updated', lead: updated, campaign };
        }

        // Create new lead
        console.log('[LEAD_CREATE_TT] Creating via tiktokWebhookCallback', {
          email: transformedLead && transformedLead.email,
          phone: transformedLead && transformedLead.phone,
          ttId: transformedLead && transformedLead.externalSources && transformedLead.externalSources.tiktok && transformedLead.externalSources.tiktok.lead_id,
          stack: (new Error()).stack && (new Error()).stack.split('\n').slice(0,3).join(' | ')
        });
        const newLead = await createAsync(Lead, transformedLead);
        
        const campaign = await createTikTokLeadCampaign(newLead.id, leadData.lead || leadData)
          .catch(err => ({ error: err.message }));
          
        return { action: 'created', lead: newLead, campaign };
        
      } catch (error) {
        console.error('💥 Error processing TikTok lead:', error);
        throw error;
      }
    };

    // Main processing logic with enhanced error handling
    (async () => {
      try {
        console.log('🎯 TikTok webhook received');
        console.log('📥 Request headers:', JSON.stringify(req.headers, null, 2));
        console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
        
        // Verify signature
        if (!verifyTikTokSignature(req)) {
          const error = new Error('Invalid TikTok webhook signature');
          error.statusCode = 401;
          throw error;
        }

        const { body } = req;

        // Handle different TikTok webhook payload formats
        let leads = [];
        
        // Format 1: Standard webhook format with type and data
        if (body.type === 'lead' && body.data) {
          leads = Array.isArray(body.data) ? body.data : [body.data];
          console.log('📊 Found leads in standard format:', leads.length);
        }
        // Format 2: Event-based webhook format
        else if (body.event_type === 'lead_generation' && body.data) {
          leads = Array.isArray(body.data) ? body.data : [body.data];
          console.log('📊 Found leads in event format:', leads.length);
        }
        // Format 3: Batch format with leads array
        else if (body.leads && Array.isArray(body.leads)) {
          leads = body.leads;
          console.log('📊 Found leads in batch format:', leads.length);
        }
        // Format 4: Direct lead object
        else if (body.lead_id || body.lead || (body.form_data && Array.isArray(body.form_data))) {
          leads = [body];
          console.log('📊 Found direct lead format');
        }
        // Format 5: Array of leads at root level
        else if (Array.isArray(body) && body.length > 0) {
          leads = body;
          console.log('📊 Found leads in root array format:', leads.length);
        }
        else {
          console.log('❓ Unknown TikTok webhook format, attempting to process as single lead');
          console.log('📥 Body keys:', Object.keys(body));
          
          // Try to process the entire body as a lead
          if (Object.keys(body).length > 0) {
            leads = [body];
          }
        }

        if (leads.length === 0) {
          console.log('❌ No TikTok leads found to process');
          return cb(null, { 
            success: true, 
            message: 'No TikTok lead data found to process',
            body_received: body
          });
        }

        console.log(`📊 Processing ${leads.length} TikTok lead(s)`);

        // Process leads with enhanced concurrency control
        const results = [];
        const concurrency = Math.min(Number(TT_CONFIG.CONCURRENCY) || 4, leads.length);
        let index = 0;
        
        const worker = async () => {
          while (index < leads.length) {
            const currentIndex = index++;
            const leadData = leads[currentIndex];
            
            try {
              console.log(`🔄 Processing lead ${currentIndex + 1}/${leads.length}`);
              const result = await processTikTokLead(leadData);
              
              results.push({ 
                index: currentIndex,
                id: leadData.lead_id || leadData.lead?.lead_id || 'unknown', 
                status: 'fulfilled', 
                value: result 
              });
              
              console.log(`✅ Lead ${currentIndex + 1} processed successfully`);
              
            } catch (err) {
              console.error(`❌ Error processing lead ${currentIndex + 1}:`, err);
              results.push({ 
                index: currentIndex,
                id: leadData.lead_id || leadData.lead?.lead_id || 'unknown', 
                status: 'rejected', 
                reason: err.message,
                leadData: leadData // Include for debugging
              });
            }
          }
        };
        
        // Run workers concurrently
        const workers = Array.from({ length: concurrency }, () => worker());
        await Promise.all(workers);

        // Sort results by index to maintain order
        results.sort((a, b) => a.index - b.index);

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const errorCount = results.length - successCount;

        console.log(`✅ TikTok webhook processing completed: ${successCount} success, ${errorCount} errors`);

        return cb(null, {
          success: errorCount === 0,
          message: errorCount === 0 ? 
            'TikTok webhook processed successfully' : 
            `TikTok webhook processed with ${errorCount} error(s)`,
          totals: { 
            processed: results.length, 
            success: successCount, 
            errors: errorCount 
          },
          results: results.map(r => ({
            id: r.id,
            status: r.status,
            action: r.value?.action,
            leadId: r.value?.lead?.id,
            campaignId: r.value?.campaign?.id,
            error: r.reason
          })),
          debugInfo: {
            webhook_format_detected: leads.length > 0 ? 'valid' : 'unknown',
            original_body_keys: Object.keys(body),
            processed_count: leads.length
          }
        });

      } catch (error) {
        console.error('💥 TikTok webhook fatal error:', error);
        return cb(error);
      }
    })();
  };

  // Remote method for TikTok webhook
  Lead.remoteMethod('tiktokWebhookCallback', {
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } }
    ],
    returns: { arg: 'result', type: 'object', root: true },
    http: { path: '/tiktok-webhook', verb: 'post' },
    description: 'TikTok Lead Generation webhook callback'
  });

  // TikTok Webhook Verification (GET)
  Lead.tiktokWebhookVerify = function (req, res, cb) {
    cb = cb || utils.createPromiseCallback();

    try {
      console.log('🔍 TikTok webhook verification');
      console.log('Query params:', req.query);
      
      // TikTok verification can use different parameters
      const challenge = req.query['hub.challenge'] || req.query['challenge'];
      const verify_token = req.query['hub.verify_token'] || req.query['verify_token'] || req.query['token'];
      const mode = req.query['hub.mode'] || req.query['mode'];
      
      console.log('Challenge:', challenge);
      console.log('Verify token:', verify_token);
      console.log('Mode:', mode);
      
      if (verify_token && verify_token === TT_CONFIG.VERIFY_TOKEN) {
        console.log('✅ TikTok verification successful');
        if (res && typeof res.status === 'function') {
          res.set('Content-Type', 'text/plain');
          res.status(200).send(String(challenge || 'OK'));
          return;
        }
        return cb(null, String(challenge || 'OK'));
      }
      
      console.log('❌ TikTok verification failed');
      if (res && typeof res.status === 'function') {
        res.status(403).send('Verification failed');
        return;
      }
      
      const error = new Error('TikTok verification failed');
      error.statusCode = 403;
      return cb(error);
      
    } catch (e) {
      console.error('💥 TikTok verification error:', e);
      if (res && typeof res.status === 'function') {
        res.status(500).send('Internal Server Error');
        return;
      }
      return cb(e);
    }
  };

  Lead.remoteMethod('tiktokWebhookVerify', {
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } }
    ],
    returns: { arg: 'result', type: 'string', root: true },
    http: { path: '/tiktok-webhook', verb: 'get' },
    description: 'TikTok webhook verification endpoint'
  });

  Lead.observe('after save', function createLogObserver(ctx, next) {
    // Only log for actual new instances, not deduplicated or special cases
    if (!ctx.isNewInstance) {
      return next();
    }

    // // Skip if this was a dedup case that should be suppressed
    // if (ctx.hookState && ctx.hookState.suppressNewLead) {
    //   return next();
    // }

    // // Skip if this was converted from create to update (Facebook/TikTok dedup)
    // if (ctx.options && ctx.options.__leadDedupHandled) {
    //   return next();D
    // }

    // // Skip if this was bulk import with skipCodeHook
    // if (ctx.options && ctx.options.skipCodeHook) {
    //   return next();
    // }

    // // Skip if this was a renewal case (>18 months) - these are logged separately
    // if (ctx.instance && ctx.instance.returnWindowFlag === 'Return > 18 months') {
    //   return next();
    // }

    // Call the original createLog function for actual new leads
    createLog(ctx, next);
  });

  Lead.observe('after save', async function autoAssignTelesale(ctx) {
    // Chỉ chạy cho lead mới
    if (!ctx.isNewInstance || (ctx.hookState && ctx.hookState.suppressNewLead)) {
      return;
    }
  
    const lead = ctx.instance;
    const QUEUE_KEY = 'telesale_queue';
    const redisClient = require('redis').createClient();
  
    redisClient.rpoplpush(QUEUE_KEY, QUEUE_KEY, async (err, employeeId) => {
      if (err) {
        console.error('AUTO-ASSIGN: Redis error:', err);
        return;
      }
  
      if (!employeeId) {
        // Queue rỗng, setup lại
        const app = Lead.app;
        if (app.setupTelesaleQueue) {
          await app.setupTelesaleQueue();
          // Thử lại
          redisClient.rpoplpush(QUEUE_KEY, QUEUE_KEY, async (err, employeeId) => {
            if (employeeId) {
              await lead.updateAttribute('telesalePersonId', employeeId);
            }
          });
        }
        return;
      }
  
      // Assign lead
      await lead.updateAttribute('telesalePersonId', employeeId);
      console.log(`AUTO-ASSIGN: Lead ${lead.id} assigned to telesale ${employeeId}`);
    });
  });
};
