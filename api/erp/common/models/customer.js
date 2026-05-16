'use strict';
var moment = require('moment');
var emailHandler = require('../../server/boot/email');
var smsHandler = require('../../server/boot/sms');
var app = require('../../server/server');
var utils = require('../../node_modules/loopback/lib/utils');
var utility = require('../../server/boot/utility');
var crypto = require('crypto');
var Q = require('q');
var _ = require('underscore');
const createLog = require('../hooks/create-log');

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
 

module.exports = function (Customer) {
    delete Customer.validations.email;
    delete Customer.validations.password;
    delete Customer.validations.username;


    Customer.login = function (credentials, include, fn) {
        var self = this;
        if (typeof include === 'function') {
            fn = include;
            include = undefined;
        }

        fn = fn || utils.createPromiseCallback();

        include = (include || '');
        if (Array.isArray(include)) {
            include = include.map(function (val) {
                return val.toLowerCase();
            });
        } else {
            include = include.toLowerCase();
        }

        var realmDelimiter;
        // Check if realm is required
        var realmRequired = !!(self.settings.realmRequired ||
            self.settings.realmDelimiter);
        if (realmRequired) {
            realmDelimiter = self.settings.realmDelimiter;
        }
        var query = self.normalizeCredentials(credentials, realmRequired,
            realmDelimiter);

        if (!query.email && !query.username && !query.phone) {
            var err2 = new Error('phone or email is required');
            err2.statusCode = 400;
            err2.code = 'USERNAME_EMAIL_REQUIRED';
            fn(err2);
            return fn.promise;
        }

        console.log("The query: ", query);
        query.isActive = true;

        self.findOne({ where: query }, function (err, user) {
            var defaultError = new Error('login failed');
            defaultError.statusCode = 401;
            defaultError.code = 'LOGIN_FAILED';

            function tokenHandler(err, token) {
                if (err) return fn(err);
                if (Array.isArray(include) ? include.indexOf('user') !== -1 : include === 'user') {
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
                console.log('An error is reported from User.findOne: %j', err);
                fn(defaultError);
            } else if (user) {
                user.hasPassword(credentials.password, function (err, isMatch) {
                    if (err) {
                        console.log('An error is reported from User.hasPassword: %j', err);
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
                            user.createAccessToken(credentials.ttl, credentials, tokenHandler);
                        }
                        // }
                    } else {
                        console.log('passsword should be ', credentials.password,  Customer.hashPassword(credentials.password) ) ;
                        console.log('The password is invalid for user %s', query.email || query.username || query.phone);
                        fn(defaultError);
                    }
                });
            } else {
                console.log('No matching record is found for user %s', query);
                fn(defaultError);
            }
        });
        return fn.promise;
    };


    Customer.logout = function(tokenId, fn) {
        fn = fn || utils.createPromiseCallback();
        this.relations.accessTokens.modelTo.findById(tokenId, function(err, accessToken) {
            if (err) {
                fn(err);
            } else if (accessToken) {
                accessToken.destroy(fn);
            } else {
                fn(new Error('could not find accessToken'));
            }
        });
        return fn.promise;
    };

    Customer.observe("after save", function (ctx, next) {
        var instance = ctx.instance || ctx.data;

        // get current data source name 
        var currentDatasource = Customer.currentDatasource;
        currentDatasource = currentDatasource || 'vb';

        async function syncUserToRocketChat(user) {
            const axios = require('axios');
            const rocketChatUrl = 'http://chat.vvs.vn:3000/api/v1/users.register';
            const rocketChat = {
                username: user.phone + '.' + currentDatasource,
                email: instance.phone + '.' + currentDatasource + '@vvs.vn',
                pass: '1%Sec1etPwd',
                name: user.name
            };

            try {
                const response = await axios.post(rocketChatUrl, rocketChat);
                console.log(response.data);
                // {
                //     "user": {
                //       "_id": "H5MSLHPXQEpSodvzR",
                //       "type": "user",
                //       "status": "offline",
                //       "active": true,
                //       "name": "ben",
                //       "username": "0903121555",
                //       "__rooms": ["GENERAL"]
                //     },
                //     "success": true
                //   }

                if (response.data.success) {
                    const rocketChatUser = response.data.user;
                    user.rocketChatId = rocketChatUser._id;
                    await user.save();
                }

            } catch (error) {
                console.error(error);
            }
        }

        if (ctx.isNewInstance) {
            syncUserToRocketChat(instance);
        }


        next();
    });

    Customer.observe('after save', function(ctx, next) {
        const instance = ctx.instance || ctx.data;
    
        // Check if instance doesn't have a referral code
        if (instance && !instance.referralCode) {
            try {
                console.log('Generating referral code for customer:', instance.objectId || 'new customer');
                
                // Use available identifiers as salt
                const id = instance.objectId || Date.now().toString();
                const email = instance.email || '';
                const phone = instance.phone || '';
                
                // Create a base string combining identifiers with salt
                const baseString = `${email}:${phone}:${id}`;
                
                // Create a hash from the base string
                const hash = crypto.createHash('sha256').update(baseString).digest('hex');
                
                // Take a section and convert to base36 for shorter result
                const section = hash.substring(8, 18);
                const num = parseInt(section, 16);
                let code = num.toString(36).toUpperCase();
                
                // Ensure code is between 5-7 characters
                if (code.length > 7) {
                    code = code.substring(0, 7);
                } else if (code.length < 5) {
                    // Pad with characters from another part of hash if too short
                    const padding = hash.substring(0, 5 - code.length).toUpperCase();
                    code = code + padding;
                }
                
                // Update the customer with the reference code
                const updateFilter = instance.objectId ? { objectId: instance.objectId } : { id: instance.id };
                Customer.updateAll(
                    updateFilter,
                    { referralCode: code }
                ).then(() => {
                    console.log(`Generated referral code ${code} for customer`);
                    next();
                }).catch(err => {
                    console.error('Error saving referral code:', err);
                    next();
                });
            } catch (err) {
                console.error('Error generating referral code:', err);
                next();
            }
        } else {
            // Skip if already has referral code
            next();
        }
    });
    
    // Add a method to find customer by reference code
    Customer.findByReferenceCode = function(code, cb) {
        Customer.findOne({ where: { referralCode: code } }, function(err, customer) {
            if (err) return cb(err);
            if (!customer) return cb(null, { found: false });
            
            cb(null, {
                found: true,
                customer: {
                    id: customer.id,
                    name: customer.name,
                    referralCode: customer.referralCode
                }
            });
        });
    };

    Customer.remoteMethod('findByReferralCode', {
        description: 'Find a customer by referral code',
        accepts: [
            { arg: 'code', type: 'string', required: true }
        ],
        returns: { arg: 'result', type: 'object', root: true },
        http: { path: '/findByCode', verb: 'get' }
    });

    // save the password in hash format
    Customer.observe("before save", function (ctx, next) {
        var instance = ctx.instance || ctx.data;
        // if (instance.password) {
        //     instance.password = Customer.hashPassword(instance.password);
        // }
        next();
    });

    Customer.observe("before save", function setCreatedAtAndUpdatedAt(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (modelInstance.id){
            modelInstance.updatedAt = moment.utc();
            next();
            return;
        }

        // create new patient
        modelInstance.createdAt = moment.utc();
        modelInstance.updatedAt = modelInstance.createdAt;

        next();
    });

    Customer.observe('after save', createLog);

    Customer.normalizeCredentials = function (credentials, realmRequired, realmDelimiter) {
        var query = {};
        credentials = credentials || {};
        if (!realmRequired) {
            if (credentials.email) {
                query.email = credentials.email;
            } else if (credentials.username) {
                query.username = credentials.username;
            }
            else if (credentials.phone) {
                query.phone = credentials.phone;
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
            }
        }
        return query;
    };

    Customer.remoteMethod('login', {
        description: 'Login a user with username/email/phone and password.',
        accepts: [
            { arg: 'credentials', type: 'object', required: true, http: { source: 'body' } },
            { arg: 'include', type: 'string', http: { source: 'query' },
                description: 'Related objects to include in the response. ' +
                'See the description of return value for more details.' },
        ],
        returns: {
            arg: 'accessToken', type: 'object', root: true,
            description:
                'The response body contains properties of the AccessToken created on login.\n' +
                'Depending on the value of `include` parameter, the body may contain ' +
                'additional properties:\n\n' +
                '  - `user` - `{User}` - Data of the currently logged in user. ' +
                '(`include=user`)'
        },
        http: { verb: 'post' },
    });

    Customer.remoteMethod('logout', {
        description: 'Logout a user with access token.',
        accepts: [
            { arg: 'tokenId', type: 'string', http: function(ctx) {
                var req = ctx && ctx.req;
                var tokenId = req && req.accessToken && req.accessToken.id;
                return tokenId;
            }, description: 'Do not supply this argument, it is automatically extracted ' +
                'from request headers.'
            },
        ],
        http: { verb: 'all' },
    });

    Customer.requestPasswordResetCode = function(email, cb) {
        Customer.findOne({ where: { email } }, function(err, user) {
          if (err || !user) return cb(new Error('Email not found'));
    
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    
          user.updateAttributes({
            resetCode: code,
            resetCodeExpiresAt: expiresAt
          }, function(err) {
            if (err) return cb(err);
    
            const msg = {
              to: email,
              from: 'noreply@live1.vn',
              subject: 'Your password reset code',
              html: `
                <p>Your password reset code is:</p>
                <h2>${code}</h2>
                <p>This code will expire in 10 minutes.</p>
              `
            };
    
            sgMail.send(msg)
              .then(() => cb(null, { message: 'Code sent to email' }))
              .catch(error => {
                console.error('SendGrid error:', error.response?.body || error.message);
                cb(new Error('Failed to send reset code'));
              });
          });
        });
      };
    
      Customer.remoteMethod('requestPasswordResetCode', {
        accepts: { arg: 'email', type: 'string', required: true },
        returns: { arg: 'message', type: 'string' },
        http: { path: '/request-reset-code', verb: 'post' }
      });
    
      // Reset with code
      Customer.resetPasswordWithCode = function(email, code, newPassword, cb) {
        Customer.findOne({ where: { email } }, function(err, user) {
          if (err || !user) return cb(new Error('Invalid email or code'));
    
          const now = new Date();
          if (user.resetCode !== code || !user.resetCodeExpiresAt || new Date(user.resetCodeExpiresAt) < now) {
            return cb(new Error('Invalid or expired reset code'));
          }
    
          user.updateAttributes({
            password: newPassword,
            resetCode: null,
            resetCodeExpiresAt: null
          }, function(err) {
            if (err) return cb(err);
            cb(null, { message: 'Password updated successfully' });
          });
        });
      };
    
      Customer.remoteMethod('resetPasswordWithCode', {
        accepts: [
          { arg: 'email', type: 'string', required: true },
          { arg: 'code', type: 'string', required: true },
          { arg: 'newPassword', type: 'string', required: true }
        ],
        returns: { arg: 'message', type: 'string' },
        http: { path: '/reset-password-code', verb: 'post' }
      });

    // Customer.definition.properties.facebookId = {
    //     type: 'string',
    //     description: 'Facebook OAuth ID'
    // };

    // Customer.definition.properties.googleId = {
    //     type: 'string',
    //     description: 'Google OAuth ID'
    // };

    // Customer.definition.properties.avatar = {
    //     type: 'string',
    //     description: 'Profile picture URL from OAuth provider'
    // };

    // Customer.definition.properties.oauthProvider = {
    //     type: 'string',
    //     description: 'OAuth provider name (facebook, google)'
    // };

    // // Add OAuth login methods
    // Customer.socialLogin = function(provider, profile, cb) {
    //     const self = this;
        
    //     // Find existing customer by OAuth ID
    //     const query = {};
    //     if (provider === 'facebook') {
    //         query.facebookId = profile.id;
    //     } else if (provider === 'google') {
    //         query.googleId = profile.id;
    //     }

    //     self.findOne({ where: query }, function(err, existingCustomer) {
    //         if (err) return cb(err);

    //         if (existingCustomer) {
    //             // Customer exists, create access token
    //             return self.createAccessTokenForCustomer(existingCustomer, cb);
    //         }

    //         // Check if customer exists by email
    //         if (profile.emails && profile.emails[0]) {
    //             self.findOne({
    //                 where: { email: profile.emails[0].value.toLowerCase() }
    //             }, function(err, customerByEmail) {
    //                 if (err) return cb(err);

    //                 if (customerByEmail) {
    //                     // Update existing customer with OAuth info
    //                     const updateData = {
    //                         oauthProvider: provider,
    //                         avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null
    //                     };

    //                     if (provider === 'facebook') {
    //                         updateData.facebookId = profile.id;
    //                     } else if (provider === 'google') {
    //                         updateData.googleId = profile.id;
    //                     }

    //                     customerByEmail.updateAttributes(updateData, function(err) {
    //                         if (err) return cb(err);
    //                         self.createAccessTokenForCustomer(customerByEmail, cb);
    //                     });
    //                 } else {
    //                     // Create new customer
    //                     self.createCustomerFromOAuth(provider, profile, cb);
    //                 }
    //             });
    //         } else {
    //             // No email, create new customer
    //             self.createCustomerFromOAuth(provider, profile, cb);
    //         }
    //     });
    // };

    // Customer.createAccessTokenForCustomer = function(customer, cb) {
    //     const ttl = 1209600; // 2 weeks
    //     customer.createAccessToken(ttl, function(err, token) {
    //         if (err) return cb(err);
            
    //         cb(null, {
    //             accessToken: token,
    //             customer: customer
    //         });
    //     });
    // };

    // Customer.createCustomerFromOAuth = function(provider, profile, cb) {
    //     const self = this;
        
    //     const customerData = {
    //         name: profile.displayName || profile.name?.givenName + ' ' + profile.name?.familyName || 'Unknown',
    //         email: profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : null,
    //         phone: null, // Will be required later
    //         oauthProvider: provider,
    //         avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
    //         isActive: true
    //     };

    //     if (provider === 'facebook') {
    //         customerData.facebookId = profile.id;
    //     } else if (provider === 'google') {
    //         customerData.googleId = profile.id;
    //     }

    //     self.create(customerData, function(err, newCustomer) {
    //         if (err) return cb(err);
            
    //         self.createAccessTokenForCustomer(newCustomer, cb);
    //     });
    // };

    // // Remote method for social login
    // Customer.remoteMethod('socialLogin', {
    //     description: 'Login or register customer using OAuth provider',
    //     accepts: [
    //         { arg: 'provider', type: 'string', required: true, description: 'OAuth provider (facebook, google)' },
    //         { arg: 'profile', type: 'object', required: true, description: 'OAuth profile data' }
    //     ],
    //     returns: { arg: 'result', type: 'object', root: true },
    //     http: { path: '/social-login', verb: 'post' }
    // });

    
     Customer.getOAuthInfo = function(userId, cb) {
        cb = cb || utils.createPromiseCallback();
        
        this.findById(userId, function(err, customer) {
            if (err) {
                return cb(err);
            }
            
            if (!customer) {
                return cb(new Error('Customer not found'));
            }
            
            cb(null, {
                oauthProvider: customer.oauthProvider,
                oauthId: customer.oauthId,
                avatar: customer.avatar
            });
        });
        
        return cb.promise;
    };

    Customer.remoteMethod('getOAuthInfo', {
        accepts: [
            { arg: 'userId', type: 'string', required: true }
        ],
        returns: { arg: 'oauthInfo', type: 'object', root: true },
        http: { path: '/oauth-info', verb: 'get' }
    });

};
