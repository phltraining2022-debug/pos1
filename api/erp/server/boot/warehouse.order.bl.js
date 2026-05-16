
//----- Directives.
const app = require("../../server/server")
const async = require("async")


module.exports.exportItems = function (req, res) {

    // 1. Look at the req.
    var warehouseId = req.body.warehouseId;
    var wareHouseItems = req.body.items; // [{name:name, quantity}]

    // Init.
    var resData = { status: "Ok", notEnough: [], notFound: [] };
    var addedValidItems = []; // For update database if success.
    var parQuantity = 0;

    var asyncTasks = [];

    // 1. Loop through each items.
    for (var i = 0; i < wareHouseItems.length; i++) {

        var task = function (callback) {

            // 2. Get Id and quantity.
            var requiredItem = this.wareHouseItem;
            var id = requiredItem.id;
            var requiredQuantity = requiredItem.quantity;

            console.log(requiredItem);
            // 3. Get WarehouseItem by drug name.
            var WarehouseItem = app.models.warehouseItem;

            WarehouseItem.find(
                {
                    where: { id: id, warehouseId: warehouseId }

                }, function (error, items) {

                    console.log("\n ------ Medicine " + this.id + "------");

                    // Case 1: Item not found.
                    if (error || items.length == 0) {

                        console.log("Không tìm thấy thuốc: " + this.id);

                        resData.notFound.push({ id: this.id });
                        callback(null);
                    }
                    // Case 2: Item found.
                    else {

                        // 1. Sort by expired date ascending.
                        items.sort(function (a, b) {
                            return new Date(a.expiredDate) - new Date(b.expiredDate);
                        })

                        // 2. Calculate total quantity.
                        var totalQuantity = 0;

                        for (var i = 0; i < items.length; i++) {

                            totalQuantity += items[i].quantity;
                            console.log("Month: " + items[i].expiredDate.getMonth() + ", Quantity: " + items[i].quantity)
                        }

                        // Case 3: Not enough quantity.
                        if (totalQuantity < this.requiredQuantity) {

                            console.log("Không đủ thuốc: ", this.id);

                            resData.notEnough.push({ id: this.id, desiredQuantity: this.requiredQuantity, remainQuantity: totalQuantity })

                            if (totalQuantity < parQuantity) {
                                console.log("Notice: The quantity of " + items[0].id + " is run out of stock")
                            }

                            callback(null);
                        }

                        // Case 4: Found and Enough.
                        else {

                            // 7. Algorithm
                            for (var i = 0; i < items.length; i++) {

                                var item = items[i];

                                if (item.quantity - this.requiredQuantity >= 0) {

                                    item.quantity -= this.requiredQuantity;
                                    this.requiredQuantity = 0;

                                    break;
                                }
                                else {
                                    this.requiredQuantity -= item.quantity;
                                    item.quantity = 0;
                                }

                            }

                            addedValidItems = addedValidItems.concat(items);

                            callback(null);
                        }
                    }

                }.bind({ requiredQuantity: requiredQuantity, id: id }))

        }.bind({ wareHouseItem: wareHouseItems[i] })

        asyncTasks.push(task);
    }

    async.parallel(asyncTasks, function (error, result) {

        console.log("----------- Done ----------");

        if (error) {

            console.log(error);
        }
        else {

            
            var notFound = resData.notFound;
            var notEnough = resData.notEnough;

            // If not success all.
            if (notFound.length > 0 || notEnough.length > 0) {

                console.log("Not found");
                for (var i = 0; i < notFound.length; i++) {
                    console.log(notFound[i]);
                }

                console.log("Not enough");
                for (var i = 0; i < notEnough.length; i++) {
                    console.log(notEnough[i]);
                }

                console.log("Valid");
                for (var i = 0; i < addedValidItems.length; i++) {
                    console.log(addedValidItems[i].id + ", quantity: " + addedValidItems[i].quantity);
                }

                resData.status = "Error";
                res.send(resData);
            }
            // If success then update db.
            else {

                console.log("Success");

                // 1. Update ordered warehouseItems.
                for (var i = 0; i < addedValidItems.length; i++) {

                    addedValidItems[i].updateAttributes({ quantity: addedValidItems[i].quantity }, function (error, data) {

                        if (error) {
                            console.log(error);

                        }
                        else {
                            console.log("Updated: " + "Month: " + data.expiredDate.getMonth() + ", Quantity: " + data.quantity)

                        }

                    })
                }

                // 2. Create order.
                var Order = app.models.Order;

                if(!req.body.appointmentDate)
                {
                    req.body.appointmentDate = new Date();
                }
            
                Order.create(req.body, function(error, result){
                    
                    if(error)
                    {
                        console.log("Error: ", error);
                        resData.status = "Error";
                        res.send(resData);
                    }
                    else
                    {
                        // 3. Reponse to client.
                        res.send(resData);
                    }

                });
            }


        }
    })
}

module.exports.getAlmostOverItems = function (req, res) {

    // param.
    var clinicId = req.query.clinicId;

    // 1.
    var WarehouseItem = app.models.warehouseItem;
    var parQuantity = 10;   // 10 quantity.

    // 2.
    var addedWareHouseItems = [];

    // 3.
    WarehouseItem.find(
        {
            where: { clinicId: clinicId }

        }, function (error, results) {

            if (error) {

            }
            else {

                for (var i = 0; i < results.length; i++) {

                    var item = results[i];
                    var quantity = item.quantity;

                    if (quantity < parQuantity) {
                        addedWareHouseItems.push(item);
                    }
                }

            }

            res.send(addedWareHouseItems);

        });
}

module.exports.getAlmostExpiredItems = function (req, res) {

    // Param. 
    var clinicId = req.query.clinicId;

    // 1.
    var WarehouseItem = app.models.warehouseItem;
    var parExpiredDate = 30; // 30 ngày.
    var currentDate = new Date();

    // 2.
    var addedWareHouseItems = [];

    // 3.
    WarehouseItem.find(
        {
            where: { clinicId: clinicId }

        }, function (error, results) {

            if (error) {

            }
            else {

                for (var i = 0; i < results.length; i++) {

                    var item = results[i];
                    var expiredDate = item.expiredDate;
                    var diff = Math.round(expiredDate - currentDate) / 86400000;

                    if (diff < parExpiredDate) {
                        addedWareHouseItems.push(item);
                    }
                }

            }

            res.send(addedWareHouseItems);

        });
}

module.exports.exportItems2 = function (req, res) {

    // 1. Look at the req.
    var warehouseId = req.body.warehouseId;
    var wareHouseItems = req.body.items; // [{name:name, quantity}]

    // Init.
    var resData = { status: "Ok", notEnough: [], notFound: [] };
    var addedValidItems = []; // For update database if success.
    var parQuantity = 0;

    var asyncTasks = [];

    // 1. Loop through each items.
    for (var i = 0; i < wareHouseItems.length; i++) {

        var task = function (callback) {

            // 2. Get Id and quantity.
            var requiredItem = this.wareHouseItem;
            var id = requiredItem.id;
            var requiredQuantity = requiredItem.quantity;

            console.log(requiredItem);
            // 3. Get WarehouseItem by drug name.
            var WarehouseItem = app.models.warehouseItem;

            WarehouseItem.find(
                {
                    where: { id: id, warehouseId: warehouseId }

                }, function (error, items) {

                    console.log("\n ------ Medicine " + this.id + "------");

                    // Case 1: Item not found.
                    if (error || items.length == 0) {

                        console.log("Không tìm thấy thuốc: " + this.id);

                        resData.notFound.push({ id: this.id });
                        callback(null);
                    }
                    // Case 2: Item found.
                    else {

                        // 1. Sort by expired date ascending.
                        items.sort(function (a, b) {
                            return new Date(a.expiredDate) - new Date(b.expiredDate);
                        })

                        // 2. Calculate total quantity.
                        var totalQuantity = 0;

                        for (var i = 0; i < items.length; i++) {

                            totalQuantity += items[i].quantity;
                            console.log("Month: " + items[i].expiredDate.getMonth() + ", Quantity: " + items[i].quantity)
                        }

                        // Case 3: Not enough quantity.
                        if (totalQuantity < this.requiredQuantity) {

                            console.log("Không đủ thuốc: ", this.id);

                            resData.notEnough.push({ id: this.id, desiredQuantity: this.requiredQuantity, remainQuantity: totalQuantity })

                            if (totalQuantity < parQuantity) {
                                console.log("Notice: The quantity of " + items[0].id + " is run out of stock")
                            }

                            callback(null);
                        }

                        // Case 4: Found and Enough.
                        else {

                            // 7. Algorithm
                            for (var i = 0; i < items.length; i++) {

                                var item = items[i];

                                if (item.quantity - this.requiredQuantity >= 0) {

                                    item.quantity -= this.requiredQuantity;
                                    this.requiredQuantity = 0;

                                    break;
                                }
                                else {
                                    this.requiredQuantity -= item.quantity;
                                    item.quantity = 0;
                                }

                            }

                            addedValidItems = addedValidItems.concat(items);

                            callback(null);
                        }
                    }

                }.bind({ requiredQuantity: requiredQuantity, id: id }))

        }.bind({ wareHouseItem: wareHouseItems[i] })

        asyncTasks.push(task);
    }

    async.parallel(asyncTasks, function (error, result) {

        console.log("----------- Done ----------");

        if (error) {

            console.log(error);
        }
        else {

            
            var notFound = resData.notFound;
            var notEnough = resData.notEnough;

            // If not success all.
            if (notFound.length > 0 || notEnough.length > 0) {

                console.log("Not found");
                for (var i = 0; i < notFound.length; i++) {
                    console.log(notFound[i]);
                }

                console.log("Not enough");
                for (var i = 0; i < notEnough.length; i++) {
                    console.log(notEnough[i]);
                }

                console.log("Valid");
                for (var i = 0; i < addedValidItems.length; i++) {
                    console.log(addedValidItems[i].id + ", quantity: " + addedValidItems[i].quantity);
                }

                resData.status = "Error";
                res.send(resData);
            }
            // If success then update db.
            else {

                console.log("Success");

                // 1. Update ordered warehouseItems.
                for (var i = 0; i < addedValidItems.length; i++) {

                    addedValidItems[i].updateAttributes({ quantity: addedValidItems[i].quantity }, function (error, data) {

                        if (error) {
                            console.log(error);

                        }
                        else {
                            console.log("Updated: " + "Month: " + data.expiredDate.getMonth() + ", Quantity: " + data.quantity)

                        }

                    })
                }

                // 2. Create order.
                var Order = app.models.Order;

                if(!req.body.appointmentDate)
                {
                    req.body.appointmentDate = new Date();
                }
            
                Order.create(req.body, function(error, result){
                    
                    if(error)
                    {
                        console.log("Error: ", error);
                        resData.status = "Error";
                        res.send(resData);
                    }
                    else
                    {
                        // 3. Reponse to client.
                        res.send(resData);
                    }

                });
            }


        }
    })
}

// Next task, noti.