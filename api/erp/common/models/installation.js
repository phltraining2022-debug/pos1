const { all } = require('bluebird');
const fs = require('fs');

module.exports = function (Installation) {
    const admin = require('firebase-admin');
    var allAdmin = {};

    function createApnProvider(app) {
        const apn = require('apn');
        const keyId = process.env.APNS_KEY_ID;
        const teamId = process.env.APNS_TEAM_ID;
        const production = process.env.APNS_PRODUCTION !== 'false';
        const keyPathFromEnv = process.env.APNS_AUTH_KEY_PATH;
        const keyPathDefault = keyId ? `/home/ubuntu/certs/${app}/AuthKey_${keyId}.p8` : null;
        const keyPath = keyPathFromEnv || keyPathDefault;

        // Prefer token-based auth with .p8 when env vars are available.
        if (keyId && teamId && keyPath && fs.existsSync(keyPath)) {
            return new apn.Provider({
                token: {
                    key: keyPath,
                    keyId,
                    teamId
                },
                production
            });
        }

        return new apn.Provider({
            cert: `/home/ubuntu/certs/${app}/cert.pem`,
            key: `/home/ubuntu/certs/${app}/key.pem`,
            production
        });
    }

    Installation.doInitFCM = function doInitFCM(app) {
        if (allAdmin[app] === undefined) {

            const serviceAccount = require(`/home/ubuntu/certs/${app}/android.json`);
            allAdmin[app] = {
                admin: require('firebase-admin')
            }
            allAdmin[app].admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }

        return allAdmin[app].admin;
    }

    Installation.findByUserIds = async function findInstallations(userIds) {
        try {
            const installations = await Installation.find({
                where: { userId: { inq: userIds } }
            });
            console.log('Installations found:', installations);
            return installations;
        } catch (error) {
            console.error('Error finding installations:', error);
            throw error;
        }
    }

    Installation.sendApnNotifications = async function sendApnNotifications(installations, notificationData, bundleId, app, enableFCMTokenPush) {
        const apnProvider = createApnProvider(app);

        const iosInstallations = installations.filter(installation => installation.osVersion.toLowerCase().includes('ios'));
        var iosDeviceTokens = iosInstallations.map(installation => installation.deviceToken);

        if (!iosDeviceTokens.length) {
            console.log('[APNs] No iOS device tokens to send.');
        }

        try {
            // Create a new notification object
            var notification = new apn.Notification();
            notification.alert = {
                title: notificationData.title,
                body: notificationData.message
            };

            if (enableFCMTokenPush)
                notification['content-available'] = 1; // For silent notifications

            notification.sound = "default"; // Notification sound
            notification.topic = bundleId; // Replace with your app's bundle ID
            var data = {};
            notificationData.data && Object.keys(notificationData.data).forEach(key => {
                const v = notificationData.data[key];
                data[key] = typeof v === 'object' ? JSON.stringify(v) : v;
            });

            notification.payload = data; // Custom payload

            console.log('bundleId ', bundleId);
            // Send the notification
            const result = await apnProvider.send(notification, iosDeviceTokens);

            // Log the result
            if (result.failed.length > 0) {
                console.error(`APNs failed for device token ${iosDeviceTokens}:`, result.failed);
            } else {
                console.log(`Push notification sent successfully to iOS device:`, result.sent);
            }
        } catch (error) {
            console.error(`Error sending push notification to iOS device:`, error.message);
        } finally {
            if (apnProvider && typeof apnProvider.shutdown === 'function') {
                apnProvider.shutdown();
            }
        }

        // push android notification
        // Path to your service account key JSON file
        if (allAdmin[app] === undefined) {

            const serviceAccount = require(`/home/ubuntu/certs/${app}/android.json`);
            allAdmin[app] = {
                admin: require('firebase-admin')
            }
            allAdmin[app].admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        Installation.doInitFCM(app);
  
        const androidInstallations = installations.filter(installation => installation.osVersion.toLowerCase().includes('android'));
        var androidDeviceTokens = androidInstallations.map(installation => installation.deviceToken);

        // loop through the android device tokens and send the notification
        androidDeviceTokens.forEach(token => {
            // Define the message payload
            var data = {};
            notificationData.data && Object.keys(notificationData.data).forEach(key => {
                const v = notificationData.data[key];
                data[key] = typeof v === 'object' ? JSON.stringify(v) : v;
            });
            const message = {
                notification: {
                    title: notificationData.title,
                    body: notificationData.message,
                },
                data: data, //
                token: token
            };

            allAdmin[app].admin.messaging().send(message)
                .then((response) => {
                    console.log('Successfully sent message:', response);
                })
                .catch((error) => {
                    console.error('Error sending message:', error);
                });
        });

        if (enableFCMTokenPush) {
            const fcmPushTokens = installations.filter(installation => installation.fcmToken).map(installation => installation.fcmToken);
            fcmPushTokens.forEach(token => {
                // Define the message payload
                var data = {};
                notificationData.data && Object.keys(notificationData.data).forEach(key => {
                    const v = notificationData.data[key];
                    data[key] = typeof v === 'object' ? JSON.stringify(v) : v;
                });
                const message = {
                    notification: {
                        title: notificationData.title,
                        body: notificationData.message
                    },
                    data: data, //
                    token: token       
                };

                if (notificationData.apns) {
                    message.apns = notificationData.apns;
                }

                if (notificationData.android) {
                    message.android = notificationData.android;
                }

                console.log('message', message);

                allAdmin[app].admin.messaging().send(message)
                    .then((response) => {
                        console.log('Successfully sent message:', response);
                    })
                    .catch((error) => {
                        console.error('Error sending message:', error);
                    });
            });
        }



    }

    // Send web push notification to a list of userIds
    // Data object should include `url` for click action
    Installation.sendWebPushToUsers = async function(userIds, title, body, data) {
        const webPush = require('web-push');
        const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BIGZUF2tfVeEvnRccCdeD_slfj6ymIhWhjEue5_lGZxYXRRkR1s9yO6ojy0QazJJ3eBl6c7C5CxRjkv8WKZBBcY';
        const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'O-UQn7dLp91Br3zfPzTOAsTB9HUFhBJY87HSBT71MdU';
        webPush.setVapidDetails('mailto:admin@live1.vn', publicVapidKey, privateVapidKey);

        const installations = await Installation.find({
            where: { osVersion: 'web-push', userId: { inq: userIds } }
        });

        if (!installations || !installations.length) return;

        const url = (data && data.url) || '/';
        const payload = JSON.stringify({
            title,
            body,
            icon: '/assets/icons/icon-96x96.png',
            data: { url, ...(data || {}) },
            url,
            ...(data || {})
        });

        installations.forEach(inst => {
            if (!inst.endpoint || !inst.keys) return;
            webPush.sendNotification({ endpoint: inst.endpoint, keys: inst.keys }, payload)
                .catch(err => {
                    console.error('[WebPush Error]', err.statusCode);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        Installation.destroyById(inst.id, delErr => {
                            if (delErr) console.error('[WebPush] Error destroying installation:', delErr);
                            else console.log('[WebPush] Deleted expired token:', inst.id);
                        });
                    }
                });
        });

        console.log(`[WebPush] Sent to ${installations.length} devices.`);
    };
};
