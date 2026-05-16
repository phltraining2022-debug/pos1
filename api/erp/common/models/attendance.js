// Attendance Model - LoopBack 2.x
(function() {
    'use strict';

    var fs = require('fs');
    var path = require('path');

    module.exports = function(Attendance) {

        // Before Save Hook
        Attendance.observe('before save', function(ctx, next) {
            var data = ctx.instance || ctx.data;

            console.log('Attendance before save hook triggered');

            // --- Resolve userId ---
            var currentUser = null;
            if (ctx.options && ctx.options.accessToken && ctx.options.accessToken.userId) {
                currentUser = ctx.options.accessToken.userId;
            }
            if (!currentUser && ctx.options && ctx.options.accessToken && ctx.options.accessToken.user) {
                currentUser = ctx.options.accessToken.user.id || ctx.options.accessToken.user;
            }
            if (!currentUser && data.userId) {
                currentUser = data.userId;
            }
            if (!data.userId && currentUser) {
                data.userId = currentUser.toString();
            }
            if (!data.userId && ctx.instance && ctx.instance.userId) {
                data.userId = ctx.instance.userId;
            }
            if (!data.userId) {
                var authErr = new Error('userId is required - please ensure you are authenticated');
                authErr.statusCode = 401;
                return next(authErr);
            }

            // --- Normalise date ---
            if (data.date && typeof data.date === 'string' && data.date.includes('T')) {
                data.date = data.date.split('T')[0];
            }

            // --- Validate location ---
            var locationToCheck = data.checkInLocation || data.checkOutLocation;
            if (locationToCheck && typeof locationToCheck === 'object') {
                if (!locationToCheck.latitude || !locationToCheck.longitude) {
                    var locErr = new Error('Location must include latitude and longitude');
                    locErr.statusCode = 400;
                    return next(locErr);
                }
            }

            // --- Process photos (base64 → file) ---
            var photoPromises = [];

            if (data.checkInPhoto && isBase64Image(data.checkInPhoto)) {
                photoPromises.push(
                    saveBase64ToFile(data.checkInPhoto, 'checkin', data.userId, data.date)
                        .then(function(url) {
                            data.checkInPhotoUrl = url;
                            delete data.checkInPhoto;  // remove raw base64 from DB
                            console.log('Saved check-in photo:', url);
                        })
                );
            }

            if (data.checkOutPhoto && isBase64Image(data.checkOutPhoto)) {
                photoPromises.push(
                    saveBase64ToFile(data.checkOutPhoto, 'checkout', data.userId, data.date)
                        .then(function(url) {
                            data.checkOutPhotoUrl = url;
                            delete data.checkOutPhoto;  // remove raw base64 from DB
                            console.log('Saved check-out photo:', url);
                        })
                );
            }

            Promise.all(photoPromises)
                .then(function() {
                    // Xóa base64 trên cả ctx.instance và ctx.data nếu có
                    if (ctx.instance) {
                        delete ctx.instance.checkInPhoto;
                        delete ctx.instance.checkOutPhoto;
                        ctx.instance.checkInPhoto = null;
                        ctx.instance.checkOutPhoto = null;
                    }
                    if (ctx.data) {
                        delete ctx.data.checkInPhoto;
                        delete ctx.data.checkOutPhoto;
                        ctx.data.checkInPhoto = null;
                        ctx.data.checkOutPhoto = null;
                    }

                    console.log('Final data:', JSON.stringify(data, null, 2));
                    next();
                })
                .catch(function(err) {
                    console.error('Error processing photos:', err);
                    next(err);
                });
        });

        // Helper: detect base64 image string
        function isBase64Image(str) {
            return typeof str === 'string' && str.startsWith('data:image/');
        }

        // Helper function to save base64 image to file
        function saveBase64ToFile(base64Data, type, userId, date) {
            return new Promise(function(resolve, reject) {
                try {
                    // Extract base64 data (remove data:image/jpeg;base64, prefix)
                    var matches = base64Data.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
                    if (!matches) {
                        reject(new Error('Invalid base64 image data'));
                        return;
                    }

                    var imageType = matches[1]; // jpeg, png, etc.
                    var base64Image = matches[2];

                    // Create uploads directory if it doesn't exist
                    var uploadsDir = path.join(__dirname, '../../uploads/attendance');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }


                    // Format date as YYYYMMDD
                    var formattedDate = date;
                    if (typeof date === 'string' && date.length >= 10) {
                        // date is like '2026-03-11' or '2026/03/11'
                        var d = date.replace(/[-\/]/g, '');
                        if (d.length >= 8) {
                            formattedDate = d.substring(0, 8);
                        } else {
                            formattedDate = d;
                        }
                    }
                    var timestamp = Date.now();
                    var filename = userId + '_' + formattedDate + '_' + type + '_' + timestamp + '.' + imageType;
                    var filePath = path.join(uploadsDir, filename);

                    // Convert base64 to buffer and save
                    var imageBuffer = Buffer.from(base64Image, 'base64');
                    fs.writeFile(filePath, imageBuffer, function(err) {
                        if (err) {
                            console.error('Error saving image file:', err);
                            reject(err);
                        } else {
                            console.log('Image saved successfully:', filename);
                            // Return relative path for storage in database
                            resolve('/uploads/attendance/' + filename);
                        }
                    });

                } catch (err) {
                    console.error('Error in saveBase64ToFile:', err);
                    reject(err);
                }
            });
        }

        // After Save Hook (optional - for logging or additional processing)
        Attendance.observe('after save', function(ctx, next) {
            console.log('Attendance record saved successfully:', ctx.instance.id);
            next();
        });

        // Remote hooks for additional validation
        Attendance.beforeRemote('create', function(ctx, instance, next) {
            console.log('Attendance create remote hook');
            next();
        });

        Attendance.beforeRemote('updateAttributes', function(ctx, instance, next) {
            console.log('Attendance update remote hook');
            next();
        });

    };
})();