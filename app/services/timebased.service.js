// TimeBasedService - Handle automatic quantity calculation for time-based products
angular.module('karaApp').service('TimeBasedService', ['$interval', 'StorageService', '$rootScope', 
    function($interval, StorageService, $rootScope) {
        var activeTimers = {}; // roomId -> timer info
        var fastUpdateTimers = {}; // roomId -> fast timer for cart updates
        
        /**
         * Start tracking time-based items for a room
         * @param {Object} room - Room object
         * @param {Array} cart - Cart items array (will be modified)
         * @param {Array} sentItems - Sent items array (will be modified)
         */
        this.startTracking = function(room, cart, sentItems) {
            // Stop existing timers if any
            this.stopTracking(room.id);
            
            // Create fast timer for cart (real-time updates)
            var fastTimer = $interval(function() {
                this.updateTimeBasedQuantities(room.id, cart, null, true); // fast = true
            }.bind(this), 1000); // Update every 1 second for cart
            
            // Create normal timer for sent items
            var normalTimer = $interval(function() {
                this.updateTimeBasedQuantities(room.id, null, sentItems, false); // fast = false
            }.bind(this), 5000); // Update every 5 seconds for sent items
            
            activeTimers[room.id] = {
                fastTimer: fastTimer,
                normalTimer: normalTimer,
                cart: cart,
                sentItems: sentItems
            };
            
            // Do initial update
            this.updateTimeBasedQuantities(room.id, cart, sentItems);
        };
        
        /**
         * Stop tracking time-based items for a room
         * @param {string} roomId - Room ID
         */
        this.stopTracking = function(roomId) {
            if (activeTimers[roomId]) {
                if (activeTimers[roomId].fastTimer) {
                    $interval.cancel(activeTimers[roomId].fastTimer);
                }
                if (activeTimers[roomId].normalTimer) {
                    $interval.cancel(activeTimers[roomId].normalTimer);
                }
                delete activeTimers[roomId];
            }
        };
        
        /**
         * Calculate current quantity for a time-based item (real-time)
         * @param {Object} item - Product item with isTimeBased=true
         * @param {Date} startTime - Start time
         * @param {Date} endTime - End time (default: now)
         * @returns {Object} - { quantity, note }
         */
        this.calculateTimeBasedQuantity = function(item, startTime, endTime) {
            // Validate inputs
            if (!startTime) {
                console.error('startTime is undefined');
                return { quantity: 1, note: 'Lỗi: Thời gian bắt đầu không có' };
            }
            
            // Ensure startTime and endTime are Date objects
            if (typeof startTime === 'string') {
                startTime = new Date(startTime);
            }
            endTime = endTime || new Date();
            if (typeof endTime === 'string') {
                endTime = new Date(endTime);
            }
            
            // Validate Date objects
            if (isNaN(startTime.getTime())) {
                console.error('Invalid startTime:', startTime);
                return { quantity: 1, note: 'Lỗi: Thời gian bắt đầu không hợp lệ' };
            }
            if (isNaN(endTime.getTime())) {
                console.error('Invalid endTime:', endTime);
                endTime = new Date();
            }
            
            // Floor startTime về ranh giới phút (giây = 0, ms = 0)
            var startFloored = new Date(Math.floor(startTime.getTime() / 60000) * 60000);

            // Đếm phút theo kiểu bao-gồm-hai-đầu: phút bắt đầu VÀ phút kết thúc đều tính
            // Ví dụ: 18:24 → 20:39 = (20*60+39) - (18*60+24) + 1 = 136 phút
            var startMinuteIdx = Math.floor(startFloored.getTime() / 60000);
            var endMinuteIdx   = Math.floor(endTime.getTime() / 60000);
            var diffMinutes = endMinuteIdx - startMinuteIdx + 1;
            var hours = Math.floor(diffMinutes / 60);
            var minutes = diffMinutes % 60;
            
            var quantity = 0;
            var note = '';
            var blockMinutes = (item.timeBasedPricing && item.timeBasedPricing.blockMinutes) || 5;
            
            // Tính theo block (mặc định 5 phút/block)
            var blocks = Math.ceil(diffMinutes / blockMinutes);
            if (blocks < 1) blocks = 1; // Tối thiểu 1 block
            
            // Chuyển block sang giờ (ví dụ: 1 block 5 phút = 0.083 giờ)
            quantity = (blocks * blockMinutes) / 60;
            
            // Round to 3 decimal places
            quantity = Math.round(quantity * 1000) / 1000;
            
            // Generate note with time details
            var startStr = formatDateTime(startFloored);
            var endStr = formatDateTime(endTime);
            note = 'Từ ' + startStr + ' đến ' + endStr + ' (' + hours + ' giờ ' + minutes + ' phút)';
            note += ' - ' + blocks + ' block x ' + blockMinutes + 'p'
            
            return {
                quantity: quantity,
                note: note
            };
        };
        
        /**
         * Real-time calculation for immediate updates (no interval dependency)
         * @param {Object} cartItem - Cart item with time-based data
         * @returns {Object} - Updated cart item with real-time quantity
         */
        this.calculateRealTimeQuantity = function(cartItem) {
            if (!cartItem.isTimeBased) return cartItem;

            // Respect manual overrides set by the cashier (edit-time modal)
            var rawStart = cartItem._manualStartTime ||
                           cartItem.createdAt || cartItem.addedAt || cartItem.startTime;
            var itemStartTime = rawStart ? new Date(rawStart) : new Date();

            var endTime = cartItem._manualEndTime ? new Date(cartItem._manualEndTime) : new Date();

            var itemData = {
                id: cartItem.itemId,
                name: cartItem.name,
                price: cartItem.price,
                unit: cartItem.unit,
                timeBasedPricing: cartItem.timeBasedConfig
            };
            
            var result = this.calculateTimeBasedQuantity(itemData, itemStartTime, endTime);

            // Update cart item with real-time data
            cartItem.quantity = result.quantity;
            cartItem.note = result.note;
            
            return cartItem;
        };
        
        /**
         * Add or update time-based item in cart
         * @param {Array} cart - Cart array
         * @param {Object} item - Product item
         * @param {Date} startTime - Start time
         */
        this.addOrUpdateTimeBasedItem = function(cart, item, startTime) {
            // Ensure startTime is a Date object
            if (typeof startTime === 'string') {
                startTime = new Date(startTime);
            }
            
            // For initial display, assume at least 1 minute has passed
            var initialEndTime = new Date(startTime.getTime() + 60000);
            var result = this.calculateTimeBasedQuantity(item, startTime, initialEndTime);
            
            // Find existing time-based item - check itemId matches item.id
            var existing = cart.find(function(cartItem) {
                return cartItem.isTimeBased === true && cartItem.itemId === item.id;
            });
            
            if (existing) {
                // Update existing
                existing.quantity = result.quantity;
                existing.note = result.note;
                existing.startTime = startTime;
            } else {
                // Add new
                cart.push({
                    itemId: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: result.quantity,
                    unit: item.unit,
                    note: result.note,
                    isTimeBased: true,
                    startTime: startTime,
                    timeBasedConfig: item.timeBasedPricing,
                    createdAt: startTime
                });
            }
            
            return cart;
        };
        
        /**
         * Calculate initial quantities for time-based items (one-time calculation)
         * @param {Array} cart - Cart items array
         * @param {Date} startTime - Room start time
         */
        this.calculateInitialQuantities = function(cart, startTime) {
            if (!cart || !Array.isArray(cart)) return;
            
            cart.forEach(function(item) {
                if (item.isTimeBased && (item._manualStartTime || item.startTime)) {
                    // Respect manually-set start/end times (from the edit-time modal)
                    var effectiveStart = item._manualStartTime || item.startTime;
                    var effectiveEnd   = item._manualEndTime   ? new Date(item._manualEndTime) : new Date();
                    var result = this.calculateTimeBasedQuantity(item, effectiveStart, effectiveEnd);
                    item.quantity = result.quantity;
                    item.note = result.note;
                }
            }.bind(this));
        };
        
        /**
         * Force real-time update for cart items (immediate calculation)
         * @param {Array} cart - Cart array to update
         */
        this.updateCartRealTime = function(cart) {
            if (!cart || cart.length === 0) return;
            
            var timeBasedItems = cart.filter(function(item) {
                return item.isTimeBased;
            });
            
            timeBasedItems.forEach(function(cartItem) {
                this.calculateRealTimeQuantity(cartItem);
            }.bind(this));
        };
        
        /**
         * Get current time-based calculation for a single item (utility function)
         * @param {Object} cartItem - Cart item
         * @returns {Object} - { quantity, note, totalPrice }
         */
        this.getCurrentTimeCalculation = function(cartItem) {
            if (!cartItem.isTimeBased) {
                return {
                    quantity: cartItem.quantity || 1,
                    note: cartItem.note || '',
                    totalPrice: (cartItem.quantity || 1) * (cartItem.price || 0)
                };
            }
            
            var updatedItem = this.calculateRealTimeQuantity(Object.assign({}, cartItem));
            return {
                quantity: updatedItem.quantity,
                note: updatedItem.note,
                totalPrice: updatedItem.quantity * (updatedItem.price || 0)
            };
        };
        
        // Private helper functions
        this.updateTimeBasedQuantities = function(roomId, cart, sentItems, isFastUpdate) {
            // For fast updates, only update cart items
            if (isFastUpdate && cart && cart.length > 0) {
                var cartTimeBasedItems = cart.filter(function(item) {
                    return item.isTimeBased;
                });
                
                cartTimeBasedItems.forEach(function(cartItem) {
                    this.calculateRealTimeQuantity(cartItem);
                }.bind(this));
                return;
            }
            
            // For normal updates, update both cart and sent items
            if (cart && cart.length > 0) {
                var cartTimeBasedItems = cart.filter(function(item) {
                    return item.isTimeBased;
                });
                
                cartTimeBasedItems.forEach(function(cartItem) {
                    this.calculateRealTimeQuantity(cartItem);
                }.bind(this));
            }
            
            // Update sent items (only in normal updates)
            if (sentItems && sentItems.length > 0) {
                sentItems.forEach(function(group) {
                    if (group.items && group.items.length > 0) {
                        group.items.forEach(function(sentItem) {
                            if (sentItem.isTimeBased) {
                                this.calculateRealTimeQuantity(sentItem);
                            }
                        }.bind(this));
                    }
                }.bind(this));
            }
        };
        
        function formatDateTime(date) {
            var d = new Date(date);
            var day = pad(d.getDate());
            var month = pad(d.getMonth() + 1);
            var year = d.getFullYear();
            var hours = pad(d.getHours());
            var minutes = pad(d.getMinutes());
            return day + '/' + month + '/' + year + ' ' + hours + ':' + minutes;
        }
        
        function pad(num) {
            return num < 10 ? '0' + num : num;
        }
    }
]);
