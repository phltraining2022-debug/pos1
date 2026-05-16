// Menu Service
angular.module('karaApp').service('MenuService', ['StorageService', '$http', 'ApiService',
    function(StorageService, $http, ApiService) {
        var menuItems = [];
        var categories = []; // Will be built from actual product data
        
        this.initMenu = function() {
            var saved = StorageService.get('menuItems');
            var savedCategories = StorageService.get('categories');
            
            var CACHE_VERSION = 'v3'; // bump when menu item schema changes
            var cacheValid = saved && saved.length && savedCategories && savedCategories.length &&
                             StorageService.get('menuItemsCacheVersion') === CACHE_VERSION;

            // Always fetch from server to keep data fresh (stale-while-revalidate)
            var fetchFromServer = function() {
                return ApiService.getAll('products').then(function(data) {
                    var products = data || [];
                    var catMap = {};
                    var catList = [];
                    menuItems = [];
                    categories = [];

                    products.forEach(function(p) {
                        var catName = (p.category && p.category.toString().trim()) || 'Khác';
                        if (!catMap[catName]) { catMap[catName] = true; catList.push(catName); }
                    });

                    catList.forEach(function(catName) {
                        var icon = 'fas ';
                        if (catName.toLowerCase().indexOf('bia') >= 0) icon += 'fa-beer';
                        else if (catName.toLowerCase().indexOf('nước') >= 0) icon += 'fa-glass-water';
                        else if (catName.toLowerCase().indexOf('khô') >= 0) icon += 'fa-fish';
                        else if (catName.toLowerCase().indexOf('trái cây') >= 0) icon += 'fa-apple-whole';
                        else if (catName.toLowerCase().indexOf('giờ') >= 0) icon += 'fa-clock';
                        else if (catName.toLowerCase().indexOf('phí') >= 0 || catName.toLowerCase().indexOf('phụ thu') >= 0) icon += 'fa-clock';
                        else if (catName.toLowerCase().indexOf('thuốc') >= 0) icon += 'fa-smoking';
                        else if (catName.toLowerCase().indexOf('rượu') >= 0) icon += 'fa-wine-glass';
                        else if (catName.toLowerCase().indexOf('đồ ăn') >= 0) icon += 'fa-utensils';
                        else icon += 'fa-box';
                        categories.push({ id: catName, name: catName, icon: icon });
                    });

                    categories.sort(function(a, b) {
                        if (a.name.toLowerCase().indexOf('giờ') >= 0) return -1;
                        if (b.name.toLowerCase().indexOf('giờ') >= 0) return 1;
                        return a.name.localeCompare(b.name);
                    });

                    products.forEach(function(p, idx) {
                        if (p.code && p.code.indexOf('{DEL}') >= 0) return;
                        if (p.name && p.name.indexOf('{DEL}') >= 0) return;
                        var catName = (p.category && p.category.toString().trim()) || 'Khác';
                        var price = (p.sellingPrice && p.sellingPrice > 0) ? p.sellingPrice : (p.price || 0);
                        var isTimeBased = p.isTimeBased === 1 || p.type === 'Dịch vụ';
                        menuItems.push({
                            id: p.id || p._id || p.code || ('item-' + (idx+1)),
                            categoryId: catName,
                            name: p.name || p.code || ('item-' + (idx+1)),
                            price: price,
                            cost: p.price || 0,
                            unit: p.unitOfMeasure || p.unit || p.uomId || 'phần',
                            stock: 9999,
                            image: p.avatar || (p.images && p.images.length > 0 && p.images[0].url) || p.image || '',
                            images: p.images || [],
                            code: p.code || '',
                            description: p.description || '',
                            alcoholic: p.alcoholic || false,
                            isTimeBased: isTimeBased,
                            type: p.type || 'Hàng hóa thường',
                            variants: p.variants || [],
                            isActive: p.isActive !== false,
                            originalData: p
                        });
                    });

                    StorageService.set('menuItems', menuItems);
                    StorageService.set('categories', categories);
                    StorageService.set('menuItemsCacheVersion', CACHE_VERSION);
                    console.log('✅ Menu refreshed from server:', menuItems.length, 'items');
                    return menuItems;
                }).catch(function(err) {
                    console.warn('⚠️ Failed to refresh menu from server (offline?):', err);
                    return menuItems; // keep whatever is in memory
                });
            };

            if (cacheValid) {
                // Serve cache immediately for fast UI
                menuItems = saved;
                categories = savedCategories;
                categories.sort(function(a, b) {
                    if (a.name.toLowerCase().indexOf('giờ') >= 0) return -1;
                    if (b.name.toLowerCase().indexOf('giờ') >= 0) return 1;
                    return a.name.localeCompare(b.name);
                });
                // Refresh in background — updated data will be available on next user interaction
                fetchFromServer();
                return Promise.resolve(menuItems);
            }

            // No valid cache — must wait for server
            return fetchFromServer();
        };
        
        this.getCategories = function() {
            return categories;
        };
        
        this.getMenuItems = function(categoryId) {
            if (menuItems.length === 0) {
                this.initMenu();
            }
            if (categoryId) {
                return menuItems.filter(item => item.categoryId == categoryId && item.stock > 0);
            }
            return menuItems.filter(item => item.stock > 0);
        };
        
        this.getItem = function(itemId) {
            return menuItems.find(item => item.id == itemId);
        };
        
        this.updateStock = function(itemId, quantity) {
            var item = this.getItem(itemId);
            if (item) {
                item.stock += quantity;
                this.saveMenu();
                return item;
            }
            return null;
        };
        
        this.setOutOfStock = function(itemId) {
            var item = this.getItem(itemId);
            if (item) {
                item.stock = 0;
                this.saveMenu();
                return item;
            }
            return null;
        };
        
        this.saveMenu = function() {
            StorageService.set('menuItems', menuItems);
        };
        
        // Calculate surcharge quantity based on time
        this.calculateSurchargeQuantity = function(surchargeItem, startTime, endTime) {
            if (!surchargeItem.isSurcharge || !surchargeItem.surchargeConfig) {
                return 0;
            }
            
            if (!endTime) endTime = new Date();
            var start = new Date(startTime);
            var end = new Date(endTime);
            
            var config = surchargeItem.surchargeConfig;
            
            // If manual, return 0 (cashier will add manually)
            if (!config.autoCalculate) {
                return 0;
            }
            
            var totalBlocks = 0;
            var currentTime = new Date(start);
            var blockMinutes = 30; // Default block size
            
            while (currentTime < end) {
                var hour = currentTime.getHours();
                var dayOfWeek = currentTime.getDay();
                var shouldCharge = false;
                
                // Check time-based surcharge
                if (config.startHour !== undefined && config.endHour !== undefined) {
                    if (config.endHour > config.startHour) {
                        // Normal range (e.g., 8h-18h)
                        shouldCharge = hour >= config.startHour && hour < config.endHour;
                    } else {
                        // Overnight range (e.g., 22h-6h)
                        shouldCharge = hour >= config.startHour || hour < config.endHour;
                    }
                }
                
                // Check day-of-week surcharge
                if (config.daysOfWeek && config.daysOfWeek.length > 0) {
                    shouldCharge = config.daysOfWeek.includes(dayOfWeek);
                }
                
                if (shouldCharge) {
                    totalBlocks++;
                }
                
                currentTime = new Date(currentTime.getTime() + blockMinutes * 60 * 1000);
            }
            
            return totalBlocks;
        };
        
        // Get all surcharge items that should be auto-applied
        this.getAutoSurcharges = function(startTime, endTime) {
            var surchargeItems = menuItems.filter(item => item.isSurcharge && item.surchargeConfig.autoCalculate);
            var result = [];
            
            surchargeItems.forEach(item => {
                var quantity = this.calculateSurchargeQuantity(item, startTime, endTime);
                if (quantity > 0) {
                    result.push({
                        item: item,
                        quantity: quantity,
                        totalAmount: item.price * quantity
                    });
                }
            });
            
            return result;
        };
        
        // Initialize on service load
        this.initMenu();
    }
]);
