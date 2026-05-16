// Customer QR Ordering Controller
angular.module('karaApp').controller('CustomerController', 
    ['$scope', '$routeParams', '$interval', 'RoomService', 'MenuService', 'OrderService', 'SocketService',
    function($scope, $routeParams, $interval, RoomService, MenuService, OrderService, SocketService) {
        $scope.roomId = $routeParams.roomId;
        $scope.room = RoomService.getRoom($scope.roomId);
        
        if (!$scope.room || $scope.room.status !== 'occupied') {
            $scope.error = 'Phòng không hợp lệ hoặc chưa được mở!';
            return;
        }
        
        // Initialize
        $scope.categories = MenuService.getCategories();
        $scope.menuItems = [];
        $scope.selectedCategory = null;
        $scope.cart = [];
        $scope.searchQuery = '';
        $scope.showCart = false;
        
        // Select first category
        if ($scope.categories.length > 0) {
            $scope.selectCategory($scope.categories[0]);
        }
        
        $scope.selectCategory = function(category) {
            $scope.selectedCategory = category;
            $scope.menuItems = MenuService.getMenuItems(category.id);
        };
        
        $scope.searchMenu = function() {
            if ($scope.searchQuery) {
                var allItems = MenuService.getMenuItems();
                $scope.menuItems = allItems.filter(function(item) {
                    return item.name.toLowerCase().includes($scope.searchQuery.toLowerCase());
                });
            } else if ($scope.selectedCategory) {
                $scope.menuItems = MenuService.getMenuItems($scope.selectedCategory.id);
            }
        };
        
        $scope.addToCart = function(item) {
            var existingItem = $scope.cart.find(function(i) {
                return i.itemId === item.id;
            });
            
            if (existingItem) {
                existingItem.quantity++;
            } else {
                $scope.cart.push({
                    itemId: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: 1,
                    unit: item.unit,
                    note: ''
                });
            }
            
            $scope.calculateTotal();
        };
        
        $scope.updateQuantity = function(item, delta) {
            item.quantity += delta;
            if (item.quantity < 1) {
                var index = $scope.cart.indexOf(item);
                $scope.cart.splice(index, 1);
            }
            $scope.calculateTotal();
        };
        
        $scope.calculateTotal = function() {
            $scope.total = $scope.cart.reduce(function(sum, item) {
                return sum + (item.quantity * item.price);
            }, 0);
            $scope.totalItems = $scope.cart.reduce(function(sum, item) {
                return sum + item.quantity;
            }, 0);
        };
        
        $scope.toggleCart = function() {
            $scope.showCart = !$scope.showCart;
        };
        
        $scope.sendOrder = function() {
            if ($scope.cart.length === 0) {
                alert('Chưa có món nào để đặt!');
                return;
            }
            
            var order = OrderService.createOrder(
                $scope.room.id,
                $scope.room.billId,
                angular.copy($scope.cart),
                '',
                'Khách tự order'
            );
            
            if (order) {
                alert('Đã gửi order thành công!\n\nMã đơn: ' + order.id + '\nTổng tiền: ' + $scope.total.toLocaleString() + 'đ\n\nVui lòng chờ nhân viên phục vụ.');
                $scope.cart = [];
                $scope.calculateTotal();
                $scope.showCart = false;
            }
        };
        
        $scope.callStaff = function() {
            // Mock notification
            alert('Đã gọi nhân viên!\n\nNhân viên sẽ đến phòng ' + $scope.room.name + ' ngay.');
        };
        
        $scope.requestPayment = function() {
            // Mock notification
            alert('Đã yêu cầu thanh toán!\n\nThu ngân sẽ xử lý thanh toán cho phòng ' + $scope.room.name + '.');
        };
    }
]);
