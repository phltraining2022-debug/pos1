// "use strict";

// module.exports = function (app) {
//   var bodyParser = require("body-parser");
//   var loopback = require("loopback");

//   // to support JSON-encoded bodies
//   app.use(bodyParser.json());
//   // to support URL-encoded bodies
//   app.use(
//     bodyParser.urlencoded({
//       extended: true,
//     })
//   );

//   //// The access token is only available after boot
//   app.use(
//     app.loopback.token({
//       model: app.models.accessToken,
//     })
//   );

//   app.use(loopback.cookieParser(app.get("cookieSecret")));
//   app.middleware(
//     "session",
//     loopback.session({
//       secret: app.get("cookieSecret"),
//       saveUninitialized: true,
//       resave: true,
//     })
//   );

//   var config = false;
//   try {
//     config = require("../../providers.test.json");
//   } catch (err) {
//     console.error(
//       "Please configure your passport strategy in `providers.json`."
//     );
//     console.error(
//       "Copy `providers.json.template` to `providers.json` and replace the clientID/clientSecret values with your own."
//     );
//   }

//   if (config) {
//     console.log("Configuring passport");

//     var AuthProvider = app.models.AuthProvider;
//     var loopbackPassport = require("loopback-component-passport");
//     var PassportConfigurator = loopbackPassport.PassportConfigurator;
//     var passportConfigurator = new PassportConfigurator(app);

//     // Initialize passport
//     passportConfigurator.init();

//     // Set up related models
//     // passportConfigurator.setupModels({
//     //   userModel: app.models.user,
//     //   userIdentityModel: app.models.userIdentity,
//     //   userCredentialModel: app.models.userCredential
//     // });

//     passportConfigurator.setupModels({
//       userModel: app.models.Customer, // Use Customer instead of User
//       userIdentityModel: app.models.userIdentity,
//       userCredentialModel: app.models.userCredential,
//     });

//     // Configure passport strategies for third party auth providers and add them to the API
//     AuthProvider.destroyAll();
//     for (var s in config) {
//       var c = config[s];

//       if (c.provider != "local") {
//         var providerClass = c.provider;
//         if (c.provider === "google") {
//           var providerClass = "google-plus";
//         }

//         var entry = {
//           name: s,
//           link: c.link,
//           authPath: c.authPath,
//           provider: c.provider,
//           class: providerClass,
//         };

//         AuthProvider.create(entry, function (err, data) {
//           if (err) {
//             console.log(err);
//           }
//         });

//         c.session = c.session !== false;

//         c.profileToUser = function (provider, profile, options) {
//           var customerData = {
//             name:
//               profile.displayName ||
//               profile.name?.givenName + " " + profile.name?.familyName ||
//               "Unknown",
//             email:
//               profile.emails && profile.emails[0]
//                 ? profile.emails[0].value.toLowerCase()
//                 : null,
//             phone: null,
//             oauthProvider: provider,
//             avatar:
//               profile.photos && profile.photos[0]
//                 ? profile.photos[0].value
//                 : null,
//             isActive: true,
//           };

//           if (provider === "facebook") {
//             customerData.facebookId = profile.id;
//           } else if (provider === "google") {
//             customerData.googleId = profile.id;
//           }

//           return customerData;
//         };
//         passportConfigurator.configureProvider(s, c);
//       }
//     }
//   }

//   var ensureLoggedIn = require("connect-ensure-login").ensureLoggedIn;

//   app.get("/auth/account", ensureLoggedIn("/"), function (req, res, next) {
//     console.log("Logged in", req.user);
//     //Copy the cookie over for our AppAuth service that looks for accessToken cookie
//     res.cookie("accessToken", req.signedCookies["access_token"], {
//       signed: true,
//     });
//     res.redirect("/#/app");
//   });

//   app.get("/auth/current", function (req, res, next) {
//     if (!req.isAuthenticated || !req.isAuthenticated()) {
//       return res.status(200).json({});
//     }
//     //poor man's copy
//     var ret = JSON.parse(JSON.stringify(req.user));
//     delete ret.password;
//     res.status(200).json(ret);
//   });

//   app.post("/auth/logout", function (req, res, next) {
//     req.session.destroy(function (err) {
//       res.redirect("/");
//     });
//   });

//   app.get(
//     "/auth/customer/account",
//     ensureLoggedIn("/"),
//     function (req, res, next) {
//       console.log("Customer logged in via OAuth:", req.user);

//       // Copy the cookie over for our AppAuth service
//       res.cookie("accessToken", req.signedCookies["access_token"], {
//         signed: true,
//       });

//       // Redirect to customer dashboard
//       res.redirect("/#/app");
//     }
//   );

//   app.post("/api/auth/customer/facebook/callback", async function (req, res) {
//     try {
//       const { code, state, redirectUri } = req.body;

//       if (!code) {
//         return res.status(400).json({
//           success: false,
//           error: "Missing authorization code",
//         });
//       }

//       // Exchange code for access token
//       const axios = require("axios");

//       // Get current domain for absolute redirect URI
//       const protocol = req.protocol;
//       const host = req.get("host");
//       //const redirectUri = `${protocol}://${host}/api/auth/customer/facebook/callback`;

//       const tokenResponse = await axios.post(
//         "https://graph.facebook.com/v23.0/oauth/access_token",
//         {
//           client_id: config["facebook-login"].clientID,
//           client_secret: config["facebook-login"].clientSecret,
//           redirect_uri:
//             redirectUri || `https://manglinehills.com/app/#/oauth-callback`, // Use absolute URL
//           code: code,
//         }
//       );

//       const accessToken = tokenResponse.data.access_token;

//       console.log("accessToken", accessToken);

//       // Get user profile from Facebook
//       const profileResponse = await axios.get(
//         `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
//       );
//       const profile = profileResponse.data;

//       // Use Customer model with correct datasource
//       const Customer = app.models.Customer;

//       // Set correct datasource based on subdomain
//       const hostname = req.hostname;
//       const clientName = hostname.split(".")[0];
//       const datasourceName = clientName;
//       const datasource = app.dataSources[datasourceName];

//       if (datasource) {
//         Customer.attachTo(datasource);
//         Customer.currentDatasource = datasourceName;
//       }

//       // Find or create Customer
//         let customer = await Customer.findOne({
//           where: {
//             $or: [
//               { oauthId: profile.id, oauthProvider: 'facebook' },
//               { email: profile.email }
//             ]
//           }
//         });

//         if (!customer) {
//           customer = await Customer.create({
//             name: profile.name,
//             email: profile.email,
//             phone: profile.phone || '0000000000',
//             oauthId: profile.id,
//             oauthProvider: 'facebook',
//             avatar: profile.picture?.data?.url,
//             isActive: true
//           });
//         } else {
//           // Update existing customer
//           await customer.updateAttributes({
//             name: profile.name,
//             oauthId: profile.id,
//             oauthProvider: 'facebook',
//             avatar: profile.picture?.data?.url,
//             isActive: true
//           });
//         }

//         // Generate LoopBack AccessToken with TTL
//         const ttl = 1209600; // 14 days in seconds
//         const accessTokenData = await customer.createAccessToken(ttl);

//         // Return response in LoopBack AccessToken format
//         res.json({
//           id: accessTokenData.id,
//           ttl: accessTokenData.ttl,
//           created: accessTokenData.created,
//           userId: accessTokenData.userId
//         });

//       } catch (error) {
//         console.error('Facebook OAuth error:', error);
//         res.status(500).json({
//           success: false,
//           error: 'OAuth authentication failed'
//         });
//       }

//     //   const existingCustomerByEmail = await Customer.findOne({
//     //     where: { email: profile.email },
//     //   });

//     //   const existingCustomerByOAuth = await Customer.findOne({
//     //     where: {
//     //       oauthId: profile.id,
//     //       oauthProvider: "facebook",
//     //     },
//     //   });

//     //   let customer;

//     //   if (existingCustomerByOAuth) {
//     //     // Trường hợp 1: Đã có tài khoản liên kết với OAuth ID này (cùng provider)
//     //     customer = existingCustomerByOAuth;

//     //     // Cập nhật thông tin mới nhất
//     //     await customer.updateAttributes({
//     //       name: profile.name,
//     //       avatar: profile.picture?.data?.url,
//     //       isActive: true,
//     //     });
//     //   } else if (existingCustomerByEmail) {
//     //     // Trường hợp 2: Email đã tồn tại - cần xử lý conflict

//     //     // Kiểm tra xem tài khoản hiện có có OAuth provider khác không
//     //     const hasOtherOAuth =
//     //       existingCustomerByEmail.oauthProvider &&
//     //       existingCustomerByEmail.oauthProvider !== "facebook";

//     //     // Kiểm tra xem tài khoản hiện có có mật khẩu không
//     //     const hasPassword = !!existingCustomerByEmail.password;

//     //     // Trả về thông tin chi tiết để frontend xử lý
//     //     return res.status(409).json({
//     //       success: false,
//     //       error: "EMAIL_EXISTS",
//     //       message: "Email đã được sử dụng bởi tài khoản khác",
//     //       conflictType: hasOtherOAuth ? "OAUTH_TO_OAUTH" : "OAUTH_TO_REGULAR",
//     //       existingAccount: {
//     //         id: existingCustomerByEmail.id,
//     //         name: existingCustomerByEmail.name,
//     //         email: existingCustomerByEmail.email,
//     //         hasPassword: hasPassword,
//     //         oauthProvider: existingCustomerByEmail.oauthProvider,
//     //         oauthId: existingCustomerByEmail.oauthId,
//     //       },
//     //       newOAuthProfile: {
//     //         id: profile.id,
//     //         name: profile.name,
//     //         email: profile.email,
//     //         picture: profile.picture?.data?.url,
//     //         provider: "facebook",
//     //       },
//     //     });
//     //   } else {
//     //     // Trường hợp 3: Tạo tài khoản mới
//     //     customer = await Customer.create({
//     //       name: profile.name,
//     //       email: profile.email,
//     //       phone: profile.phone || "0000000000",
//     //       oauthId: profile.id,
//     //       oauthProvider: "facebook",
//     //       avatar: profile.picture?.data?.url,
//     //       isActive: true,
//     //     });
//     //   }

//     //   // Generate LoopBack AccessToken with TTL
//     //   const ttl = 1209600; // 14 days in seconds
//     //   const accessTokenData = await customer.createAccessToken(ttl);

//     //   res.json({
//     //     success: true,
//     //     id: accessTokenData.id,
//     //     ttl: accessTokenData.ttl,
//     //     created: accessTokenData.created,
//     //     userId: accessTokenData.userId,
//     //   });
//     // } catch (error) {
//     //   console.error("Facebook OAuth error:", error);
//     //   res.status(500).json({
//     //     success: false,
//     //     error: "OAuth authentication failed",
//     //   });
//     // }
//   });

//   app.post("/api/auth/customer/google/callback", async function (req, res) {
//     try {
//       const { code, state, redirectUri } = req.body;

//       if (!code) {
//         return res.status(400).json({
//           success: false,
//           error: "Missing authorization code",
//         });
//       }

//       // Exchange code for access token
//       const axios = require("axios");

//       // Get current domain for absolute redirect URI
//       const protocol = req.protocol;
//       const host = req.get("host");
//       //const redirectUri = `${protocol}://${host}/api/auth/customer/google/callback`;

//       const tokenResponse = await axios.post(
//         "https://oauth2.googleapis.com/token",
//         {
//           client_id: config["google-login"].clientID,
//           client_secret: config["google-login"].clientSecret,
//           redirect_uri:
//             redirectUri || `https://manglinehills.com/app/oauth-callback.html`, // Use absolute URL
//           grant_type: "authorization_code",
//           code: code,
//         }
//       );

//       const accessToken = tokenResponse.data.access_token;

//       // Get user profile from Google
//       const profileResponse = await axios.get(
//         `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
//       );
//       const profile = profileResponse.data;

//       // Use Customer model with correct datasource
//       const Customer = app.models.Customer;

//       // Set correct datasource based on subdomain
//       const hostname = req.hostname;
//       const clientName = hostname.split(".")[0];
//       const datasourceName = clientName;
//       const datasource = app.dataSources[datasourceName];

//       if (datasource) {
//         Customer.attachTo(datasource);
//         Customer.currentDatasource = datasourceName;
//       }

//       // Find or create Customer
//         let customer = await Customer.findOne({
//           where: {
//             $or: [
//               { oauthId: profile.id, oauthProvider: 'google' },
//               { email: profile.email }
//             ]
//           }
//         });

//         if (!customer) {
//           customer = await Customer.create({
//             name: profile.name,
//             email: profile.email,
//             phone: null,
//             oauthId: profile.id,
//             oauthProvider: 'google',
//             avatar: profile.picture,
//             isActive: true
//           });
//         } else {
//           // Update existing customer
//           await customer.updateAttributes({
//             name: profile.name,
//             oauthId: profile.id,
//             oauthProvider: 'google',
//             avatar: profile.picture,
//             isActive: true
//           });
//         }

//         // Generate LoopBack AccessToken with TTL
//         const ttl = 1209600; // 14 days in seconds
//         const accessTokenData = await customer.createAccessToken(ttl);

//         // Return response in LoopBack AccessToken format
//         res.json({
//           id: accessTokenData.id,
//           ttl: accessTokenData.ttl,
//           created: accessTokenData.created,
//           userId: accessTokenData.userId
//         });

//       } catch (error) {
//         console.error('Google OAuth error:', error);
//         res.status(500).json({
//           success: false,
//           error: 'OAuth authentication failed'
//         });
//         }

//       //   const existingCustomerByEmail = await Customer.findOne({
//       //   where: { email: profile.email }
//       // });

//       // const existingCustomerByOAuth = await Customer.findOne({
//       //   where: {
//       //     oauthId: profile.id,
//       //     oauthProvider: 'google'
//       //   }
//       // });

//     //   let customer;

//     //   if (existingCustomerByOAuth) {
//     //     // Trường hợp 1: Đã có tài khoản liên kết với OAuth ID này (cùng provider)
//     //     customer = existingCustomerByOAuth;

//     //     // Cập nhật thông tin mới nhất
//     //     await customer.updateAttributes({
//     //       name: profile.name,
//     //       avatar: profile.picture,
//     //       isActive: true,
//     //     });
//     //   } else if (existingCustomerByEmail) {
//     //     // Trường hợp 2: Email đã tồn tại - cần xử lý conflict

//     //     // Kiểm tra xem tài khoản hiện có có OAuth provider khác không
//     //     const hasOtherOAuth =
//     //       existingCustomerByEmail.oauthProvider &&
//     //       existingCustomerByEmail.oauthProvider !== "google";

//     //     // Kiểm tra xem tài khoản hiện có có mật khẩu không
//     //     const hasPassword = !!existingCustomerByEmail.password;

//     //     // Trả về thông tin chi tiết để frontend xử lý
//     //     return res.status(409).json({
//     //       success: false,
//     //       error: "EMAIL_EXISTS",
//     //       message: "Email đã được sử dụng bởi tài khoản khác",
//     //       conflictType: hasOtherOAuth ? "OAUTH_TO_OAUTH" : "OAUTH_TO_REGULAR",
//     //       existingAccount: {
//     //         id: existingCustomerByEmail.id,
//     //         name: existingCustomerByEmail.name,
//     //         email: existingCustomerByEmail.email,
//     //         hasPassword: hasPassword,
//     //         oauthProvider: existingCustomerByEmail.oauthProvider,
//     //         oauthId: existingCustomerByEmail.oauthId,
//     //       },
//     //       newOAuthProfile: {
//     //         id: profile.id,
//     //         name: profile.name,
//     //         email: profile.email,
//     //         picture: profile.picture,
//     //         provider: "google",
//     //       },
//     //     });
//     //   } else {
//     //     // Trường hợp 3: Tạo tài khoản mới
//     //     customer = await Customer.create({
//     //       name: profile.name,
//     //       email: profile.email,
//     //       phone: null,
//     //       oauthId: profile.id,
//     //       oauthProvider: "google",
//     //       avatar: profile.picture,
//     //       isActive: true,
//     //     });
//     //   }

//     //   // Generate LoopBack AccessToken with TTL
//     //   const ttl = 1209600; // 14 days in seconds
//     //   const accessTokenData = await customer.createAccessToken(ttl);

//     //   res.json({
//     //     success: true,
//     //     id: accessTokenData.id,
//     //     ttl: accessTokenData.ttl,
//     //     created: accessTokenData.created,
//     //     userId: accessTokenData.userId,
//     //   });
//     // } catch (error) {
//     //   console.error("Google OAuth error:", error);
//     //   res.status(500).json({
//     //     success: false,
//     //     error: "OAuth authentication failed",
//     //   });
//     // }
//   });

//   app.post("/api/auth/customer/link-account", async function (req, res) {
//     try {
//       const {
//         email,
//         password,
//         oauthProvider,
//         oauthId,
//         oauthProfile,
//         conflictType,
//         existingAccountId,
//       } = req.body;

//       if (!email || !oauthProvider || !oauthId) {
//         return res.status(400).json({
//           success: false,
//           error: "Missing required fields",
//         });
//       }

//       const Customer = app.models.Customer;

//       // Set correct datasource
//       const hostname = req.hostname;
//       const clientName = hostname.split(".")[0];
//       const datasourceName = clientName;
//       const datasource = app.dataSources[datasourceName];

//       if (datasource) {
//         Customer.attachTo(datasource);
//         Customer.currentDatasource = datasourceName;
//       }

//       let customer;

//       if (existingAccountId) {
//         // Trường hợp OAuth to OAuth: Sử dụng existingAccountId
//         customer = await Customer.findById(existingAccountId);
//       } else {
//         // Trường hợp OAuth to Regular: Tìm theo email
//         customer = await Customer.findOne({
//           where: { email: email },
//         });
//       }

//       if (!customer) {
//         return res.status(404).json({
//           success: false,
//           error: "Account not found",
//         });
//       }

//       // Kiểm tra mật khẩu (chỉ khi có password và conflictType là OAUTH_TO_REGULAR)
//       if (
//         conflictType === "OAUTH_TO_REGULAR" &&
//         customer.password &&
//         password
//       ) {
//         const bcrypt = require("bcrypt");
//         const isValidPassword = await bcrypt.compare(
//           password,
//           customer.password
//         );

//         if (!isValidPassword) {
//           return res.status(401).json({
//             success: false,
//             error: "Invalid password",
//           });
//         }
//       }

//       // Kiểm tra xem OAuth ID đã được sử dụng bởi tài khoản khác chưa
//       const existingOAuthAccount = await Customer.findOne({
//         where: {
//           oauthId: oauthId,
//           oauthProvider: oauthProvider,
//           id: { neq: customer.id }, // Không phải tài khoản hiện tại
//         },
//       });

//       if (existingOAuthAccount) {
//         return res.status(409).json({
//           success: false,
//           error: "OAUTH_ALREADY_LINKED",
//           message: "Tài khoản OAuth này đã được liên kết với tài khoản khác",
//         });
//       }

//       // Cập nhật tài khoản hiện có với OAuth mới
//       const updateData = {
//         oauthId: oauthId,
//         oauthProvider: oauthProvider,
//         isActive: true,
//       };

//       // Chỉ cập nhật avatar nếu chưa có hoặc nếu là OAuth to OAuth
//       if (!customer.avatar || conflictType === "OAUTH_TO_OAUTH") {
//         updateData.avatar = oauthProfile?.picture || customer.avatar;
//       }

//       // Cập nhật tên nếu là OAuth to OAuth hoặc nếu tên hiện tại là rỗng
//       if (
//         conflictType === "OAUTH_TO_OAUTH" ||
//         !customer.name ||
//         customer.name.trim() === ""
//       ) {
//         updateData.name = oauthProfile?.name || customer.name;
//       }

//       await customer.updateAttributes(updateData);

//       // Generate AccessToken
//       const ttl = 1209600;
//       const accessTokenData = await customer.createAccessToken(ttl);

//       res.json({
//         success: true,
//         id: accessTokenData.id,
//         ttl: accessTokenData.ttl,
//         created: accessTokenData.created,
//         userId: accessTokenData.userId,
//       });
//     } catch (error) {
//       console.error("Link account error:", error);
//       res.status(500).json({
//         success: false,
//         error: "Failed to link account",
//       });
//     }
//   });
// };

'use strict';

module.exports = function (app) {
  var bodyParser = require('body-parser');
  var loopback = require('loopback');

  // to support JSON-encoded bodies
  app.use(bodyParser.json());
  // to support URL-encoded bodies
  app.use(
    bodyParser.urlencoded({
      extended: true,
    })
  );

  //// The access token is only available after boot
  app.use(
    app.loopback.token({
      model: app.models.accessToken,
    })
  );

  app.use(loopback.cookieParser(app.get('cookieSecret')));
  app.middleware(
    'session',
    loopback.session({
      secret: app.get('cookieSecret'),
      saveUninitialized: true,
      resave: true,
    })
  );

  var config = false;
  try {
    config = require('../../providers.test.json');
  } catch (err) {
    console.error(
      'Please configure your passport strategy in `providers.json`.'
    );
    console.error(
      'Copy `providers.json.template` to `providers.json` and replace the clientID/clientSecret values with your own.'
    );
  }

  if (config) {
    console.log('Configuring passport');

    var AuthProvider = app.models.AuthProvider;
    var loopbackPassport = require('loopback-component-passport');
    var PassportConfigurator = loopbackPassport.PassportConfigurator;
    var passportConfigurator = new PassportConfigurator(app);

    // Initialize passport
    passportConfigurator.init();

    // Set up related models
    passportConfigurator.setupModels({
      userModel: app.models.Customer, // Use Customer instead of User
      userIdentityModel: app.models.userIdentity,
      userCredentialModel: app.models.userCredential,
    });

    // Configure passport strategies for third party auth providers and add them to the API
    AuthProvider.destroyAll();
    for (var s in config) {
      var c = config[s];

      if (c.provider != 'local') {
        var providerClass = c.provider;
        if (c.provider === 'google') {
          var providerClass = 'google-plus';
        }

        var entry = {
          name: s,
          link: c.link,
          authPath: c.authPath,
          provider: c.provider,
          class: providerClass,
        };

        AuthProvider.create(entry, function (err, data) {
          if (err) {
            console.log(err);
          }
        });

        c.session = c.session !== false;

        c.profileToUser = function (provider, profile, options) {
          var customerData = {
            name:
              profile.displayName ||
              profile.name?.givenName + ' ' + profile.name?.familyName ||
              'Unknown',
            email:
              profile.emails && profile.emails[0]
                ? profile.emails[0].value.toLowerCase()
                : null,
            phone: '0',
            oauthProvider: provider,
            avatar:
              profile.photos && profile.photos[0]
                ? profile.photos[0].value
                : null,
            isActive: true,
          };

          if (provider === 'facebook') {
            customerData.facebookId = profile.id;
          } else if (provider === 'google') {
            customerData.googleId = profile.id;
          }

          return customerData;
        };
        passportConfigurator.configureProvider(s, c);
      }
    }
  }

  var ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn;

  app.get('/auth/account', ensureLoggedIn('/'), function (req, res, next) {
    console.log('Logged in', req.user);
    //Copy the cookie over for our AppAuth service that looks for accessToken cookie
    res.cookie('accessToken', req.signedCookies['access_token'], {
      signed: true,
    });
    res.redirect('/#/app');
  });

  app.get('/auth/current', function (req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(200).json({});
    }
    //poor man's copy
    var ret = JSON.parse(JSON.stringify(req.user));
    delete ret.password;
    res.status(200).json(ret);
  });

  app.post('/auth/logout', function (req, res, next) {
    req.session.destroy(function (err) {
      res.redirect('/');
    });
  });

  app.get(
    '/auth/customer/account',
    ensureLoggedIn('/'),
    function (req, res, next) {
      console.log('Customer logged in via OAuth:', req.user);

      // Copy the cookie over for our AppAuth service
      res.cookie('accessToken', req.signedCookies['access_token'], {
        signed: true,
      });

      // Redirect to customer dashboard
      res.redirect('/#/app');
    }
  );

  app.post('/api/auth/customer/facebook/callback', async function (req, res) {
    try {
      const { code, state, redirectUri } = req.body;

      console.log('🔍 Facebook OAuth Callback:', { code, redirectUri });

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Missing authorization code',
        });
      }

      // Exchange code for access token
      const axios = require('axios');

      const tokenResponse = await axios.post(
        'https://graph.facebook.com/v23.0/oauth/access_token',
        {
          client_id: config['facebook-login'].clientID,
          client_secret: config['facebook-login'].clientSecret,
          redirect_uri:
            redirectUri || `https://manglinehills.com/app/#/oauth-callback`,
          code: code,
        }
      );

      const accessToken = tokenResponse.data.access_token;

      console.log('accessToken', accessToken);

      // Get user profile from Facebook
      const profileResponse = await axios.get(
        `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
      );
      const profile = profileResponse.data;

      // Use Customer model with correct datasource
      const Customer = app.models.Customer;

      // Set correct datasource based on subdomain
      const hostname = req.hostname;
      const clientName = hostname.split('.')[0];
      const datasourceName = clientName;
      const datasource = app.dataSources[datasourceName];

      if (datasource) {
        Customer.attachTo(datasource);
        Customer.currentDatasource = datasourceName;
      }

      // Kiểm tra conflict
      const existingCustomerByEmail = await Customer.findOne({
        where: { email: profile.email },
      });

      const existingCustomerByOAuth = await Customer.findOne({
        where: {
          oauthId: profile.id,
          oauthProvider: 'facebook',
        },
      });

      console.log('🔍 Conflict Check:', {
        existingByEmail: !!existingCustomerByEmail,
        existingByOAuth: !!existingCustomerByOAuth,
        email: profile.email,
        oauthId: profile.id,
      });

      let customer;

      if (existingCustomerByOAuth) {
        // Trường hợp 1: Đã có tài khoản liên kết với OAuth ID này
        console.log('✅ Existing OAuth account found');
        customer = existingCustomerByOAuth;
        await customer.updateAttributes({
          name: profile.name,
          avatar: profile.picture?.data?.url,
          isActive: true,
        });
      } else if (existingCustomerByEmail) {
        // Trường hợp 2: Email đã tồn tại - cần xử lý conflict
        console.log('⚠️ Email conflict detected, returning 409');
        const hasOtherOAuth =
          existingCustomerByEmail.oauthProvider &&
          existingCustomerByEmail.oauthProvider !== 'facebook';

        const hasPassword = !!existingCustomerByEmail.password;

        return res.status(409).json({
          success: false,
          error: 'EMAIL_EXISTS',
          message: 'Email đã được sử dụng bởi tài khoản khác',
          conflictType: hasOtherOAuth ? 'OAUTH_TO_OAUTH' : 'OAUTH_TO_REGULAR',
          existingAccount: {
            id: existingCustomerByEmail.id,
            name: existingCustomerByEmail.name,
            email: existingCustomerByEmail.email,
            hasPassword: hasPassword,
            oauthProvider: existingCustomerByEmail.oauthProvider,
            oauthId: existingCustomerByEmail.oauthId,
          },
          newOAuthProfile: {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            picture: profile.picture?.data?.url,
            provider: 'facebook',
          },
        });
      } else {
        // Trường hợp 3: Tạo tài khoản mới
        console.log('✅ Creating new account');
        customer = await Customer.create({
          name: profile.name,
          email: profile.email,
          phone: profile.phone || '0000000000',
          oauthId: profile.id,
          oauthProvider: 'facebook',
          avatar: profile.picture?.data?.url,
          isActive: true,
        });
      }

      // Generate LoopBack AccessToken with TTL
      const ttl = 1209600; // 14 days in seconds
      const accessTokenData = await customer.createAccessToken(ttl);

      res.json({
        success: true,
        id: accessTokenData.id,
        ttl: accessTokenData.ttl,
        created: accessTokenData.created,
        userId: accessTokenData.userId,
      });
    } catch (error) {
      console.error('❌ Facebook OAuth error:', error);
      res.status(500).json({
        success: false,
        error: 'OAuth authentication failed',
      });
    }
  });

  app.post('/api/auth/customer/google/callback', async function (req, res) {
    try {
      const { code, state, redirectUri } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Missing authorization code',
        });
      }

      // Exchange code for access token
      const axios = require('axios');

      const tokenResponse = await axios.post(
        'https://oauth2.googleapis.com/token',
        {
          client_id: config['google-login'].clientID,
          client_secret: config['google-login'].clientSecret,
          redirect_uri:
            redirectUri || `https://manglinehills.com/app/oauth-callback.html`,
          grant_type: 'authorization_code',
          code: code,
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Get user profile from Google
      const profileResponse = await axios.get(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
      );
      const profile = profileResponse.data;

      // Use Customer model with correct datasource
      const Customer = app.models.Customer;

      // Set correct datasource based on subdomain
      const hostname = req.hostname;
      const clientName = hostname.split('.')[0];
      const datasourceName = clientName;
      const datasource = app.dataSources[datasourceName];

      if (datasource) {
        Customer.attachTo(datasource);
        Customer.currentDatasource = datasourceName;
      }

      // Kiểm tra conflict
      const existingCustomerByEmail = await Customer.findOne({
        where: { email: profile.email },
      });

      const existingCustomerByOAuth = await Customer.findOne({
        where: {
          oauthId: profile.id,
          oauthProvider: 'google',
        },
      });

      let customer;

      if (existingCustomerByOAuth) {
        // Trường hợp 1: Đã có tài khoản liên kết với OAuth ID này
        customer = existingCustomerByOAuth;
        await customer.updateAttributes({
          name: profile.name,
          avatar: profile.picture,
          isActive: true,
        });
      } else if (existingCustomerByEmail) {
        // Trường hợp 2: Email đã tồn tại - cần xử lý conflict
        const hasOtherOAuth =
          existingCustomerByEmail.oauthProvider &&
          existingCustomerByEmail.oauthProvider !== 'google';

        const hasPassword = !!existingCustomerByEmail.password;

        return res.status(409).json({
          success: false,
          error: 'EMAIL_EXISTS',
          message: 'Email đã được sử dụng bởi tài khoản khác',
          conflictType: hasOtherOAuth ? 'OAUTH_TO_OAUTH' : 'OAUTH_TO_REGULAR',
          existingAccount: {
            id: existingCustomerByEmail.id,
            name: existingCustomerByEmail.name,
            email: existingCustomerByEmail.email,
            hasPassword: hasPassword,
            oauthProvider: existingCustomerByEmail.oauthProvider,
            oauthId: existingCustomerByEmail.oauthId,
          },
          newOAuthProfile: {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            picture: profile.picture,
            provider: 'google',
          },
        });
      } else {
        // Trường hợp 3: Tạo tài khoản mới
        customer = await Customer.create({
          name: profile.name,
          email: profile.email,
          phone: '0',
          oauthId: profile.id,
          oauthProvider: 'google',
          avatar: profile.picture,
          isActive: true,
        });
      }

      // Generate LoopBack AccessToken with TTL
      const ttl = 1209600; // 14 days in seconds
      const accessTokenData = await customer.createAccessToken(ttl);

      res.json({
        success: true,
        id: accessTokenData.id,
        ttl: accessTokenData.ttl,
        created: accessTokenData.created,
        userId: accessTokenData.userId,
      });
    } catch (error) {
      console.error('Google OAuth error:', error);
      res.status(500).json({
        success: false,
        error: 'OAuth authentication failed',
      });
    }
  });

  app.post('/api/auth/customer/link-account', async function (req, res) {
    try {
      const {
        email,
        password,
        oauthProvider,
        oauthId,
        oauthProfile,
        conflictType,
        existingAccountId,
      } = req.body;

      if (!email || !oauthProvider || !oauthId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
        });
      }

      const Customer = app.models.Customer;

      // Set correct datasource
      const hostname = req.hostname;
      const clientName = hostname.split('.')[0];
      const datasourceName = clientName;
      const datasource = app.dataSources[datasourceName];

      if (datasource) {
        Customer.attachTo(datasource);
        Customer.currentDatasource = datasourceName;
      }

      let customer;

      if (existingAccountId) {
        // Trường hợp OAuth to OAuth: Sử dụng existingAccountId
        customer = await Customer.findById(existingAccountId);
      } else {
        // Trường hợp OAuth to Regular: Tìm theo email
        customer = await Customer.findOne({
          where: { email: email },
        });
      }

      if (!customer) {
        return res.status(404).json({
          success: false,
          error: 'Account not found',
        });
      }

      // Kiểm tra mật khẩu (chỉ khi có password và conflictType là OAUTH_TO_REGULAR)
      if (
        conflictType === 'OAUTH_TO_REGULAR' &&
        customer.password &&
        password
      ) {
        const bcrypt = require('bcrypt');
        const isValidPassword = await bcrypt.compare(
          password,
          customer.password
        );

        if (!isValidPassword) {
          return res.status(401).json({
            success: false,
            error: 'Invalid password',
          });
        }
      }

      // Kiểm tra xem OAuth ID đã được sử dụng bởi tài khoản khác chưa
      const existingOAuthAccount = await Customer.findOne({
        where: {
          oauthId: oauthId,
          oauthProvider: oauthProvider,
          id: { neq: customer.id }, // Không phải tài khoản hiện tại
        },
      });

      if (existingOAuthAccount) {
        return res.status(409).json({
          success: false,
          error: 'OAUTH_ALREADY_LINKED',
          message: 'Tài khoản OAuth này đã được liên kết với tài khoản khác',
        });
      }

      // Cập nhật tài khoản hiện có với OAuth mới
      const updateData = {
        oauthId: oauthId,
        oauthProvider: oauthProvider,
        isActive: true,
      };

      // Chỉ cập nhật avatar nếu chưa có hoặc nếu là OAuth to OAuth
      if (!customer.avatar || conflictType === 'OAUTH_TO_OAUTH') {
        updateData.avatar = oauthProfile?.picture || customer.avatar;
      }

      // Cập nhật tên nếu là OAuth to OAuth hoặc nếu tên hiện tại là rỗng
      if (
        conflictType === 'OAUTH_TO_OAUTH' ||
        !customer.name ||
        customer.name.trim() === ''
      ) {
        updateData.name = oauthProfile?.name || customer.name;
      }

      await customer.updateAttributes(updateData);

      // Generate AccessToken
      const ttl = 1209600;
      const accessTokenData = await customer.createAccessToken(ttl);

      res.json({
        success: true,
        id: accessTokenData.id,
        ttl: accessTokenData.ttl,
        created: accessTokenData.created,
        userId: accessTokenData.userId,
      });
    } catch (error) {
      console.error('Link account error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to link account',
      });
    }
  });

  // API để handle regular login conflict
  app.post('/api/auth/customer/login', async function (req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Missing email or password',
        });
      }

      const Customer = app.models.Customer;

      // Set correct datasource
      const hostname = req.hostname;
      const clientName = hostname.split('.')[0];
      const datasourceName = clientName;
      const datasource = app.dataSources[datasourceName];

      if (datasource) {
        Customer.attachTo(datasource);
        Customer.currentDatasource = datasourceName;
      }

      // Tìm customer theo email
      const customer = await Customer.findOne({
        where: { email: email.toLowerCase() },
      });

      if (!customer) {
        return res.status(404).json({
          success: false,
          error: 'Account not found',
        });
      }

      // Kiểm tra nếu tài khoản có OAuth provider
      if (customer.oauthProvider && customer.oauthProvider !== 'local') {
        return res.status(409).json({
          success: false,
          error: 'EMAIL_EXISTS',
          message: 'Email này đã được sử dụng với đăng nhập mạng xã hội',
          conflictType: 'REGULAR_TO_OAUTH',
          existingAccount: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            hasPassword: !!customer.password,
            oauthProvider: customer.oauthProvider,
            oauthId: customer.oauthId,
          },
          newLoginMethod: {
            type: 'regular',
            email: email,
          },
        });
      }

      // Kiểm tra mật khẩu
      const bcrypt = require('bcrypt');
      const isValidPassword = await bcrypt.compare(password, customer.password);

      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: 'Invalid password',
        });
      }

      // Generate AccessToken
      const ttl = 1209600;
      const accessTokenData = await customer.createAccessToken(ttl);

      res.json({
        success: true,
        id: accessTokenData.id,
        ttl: accessTokenData.ttl,
        created: accessTokenData.created,
        userId: accessTokenData.userId,
        user: customer,
      });
    } catch (error) {
      console.error('Regular login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed',
      });
    }
  });
};
