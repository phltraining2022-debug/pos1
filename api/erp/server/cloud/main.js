
const app = require("../../server/server")
const async = require("async")


Parse.Cloud.define("newGameScore", function (req, res) {

    console.log("Hello");

    var GameScore = Parse.Object.extend("warehouseItem");
    var gameScore = new GameScore();

    gameScore.set("warehouseId", "1234");
    gameScore.set("quantity", 20);
    gameScore.set("itemName", "name7");

    gameScore.save({ useMasterKey: false }, {
        success: function (gameScore) {
            // Execute any logic that should take place after the object is saved.
            console.log("Awesome");
            alert('New object created with objectId: ' + gameScore.id);
        },
        error: function (gameScore, error) {
            console.log(error);
            // Execute any logic that should take place if the save fails.
            // error is a Parse.Error with an error code and message.
            alert('Failed to create new object, with error code: ' + error.message);
        }
    });
})

Parse.Cloud.define("orderWarehouseItems", (req, res) => {

    // 1. Look at the req.
    var warehouseId = req.params.warehouseId;
    var wareHouseItems = req.params.items; // [{name:name, quantity}]
    
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
            
            // 3. Get WarehouseItem by drug name.
            var WarehouseItem = Parse.Object.extend("warehouseItem");
            var query = new Parse.Query(WarehouseItem);

            query.equalTo("objectId", id);
            query.equalTo("warehouseId", warehouseId);

            query.find({

                success: function(items) {

                    // Case 1: Item not found.
                    if (items.length == 0) {
                        console.log("Không tìm thấy thuốc: " + this.id);
                        resData.notFound.push({ id: this.id });
                        callback(null);
                    }

                    // Case 2: Item found.
                    else {

                        for(var i = 0; i < items.length; i++){
                            console.log("Item: ", JSON.stringify(items[i]));
                        }

                        // 2. Calculate total quantity.
                        var totalQuantity = 0;

                        for (var i = 0; i < items.length; i++) {

                            totalQuantity += items[i].get("quantity");
                            console.log("Item: " + items[i].get("itemName") + ", Quantity: " + items[i].get("quantity"))
                        }

                        console.log("Total quantity: ", totalQuantity);

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

                                if (item.get("quantity") - this.requiredQuantity >= 0) {

                                    item.set("quantity", item.get("quantity") - this.requiredQuantity);
                                    this.requiredQuantity = 0;

                                    break;
                                }
                                else {
                                    this.requiredQuantity -= item.get("quantity");
                                    item.set("quantity", 0);
                                }

                            }

                            addedValidItems = addedValidItems.concat(items);

                            callback(null);
                        }
                    }

                }.bind({ requiredQuantity: requiredQuantity, id: id }),

                error: function(error) {

                    // Case 1: Item not found.
                    console.log("Không tìm thấy thuốc: " + this.id);
                    resData.notFound.push({ id: this.id });
                    callback(null);

                }.bind({ requiredQuantity: requiredQuantity, id: id })
            })

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
                    console.log("id: " + addedValidItems[i].id + ", quantity: " + addedValidItems[i].get("quantity"));
                }

                resData.status = "Error";
                res.success(resData);
            }
            // If success then update db.
            else {

                console.log("Success");

                // 1. Update ordered warehouseItems.
                for (var i = 0; i < addedValidItems.length; i++) {

                    addedValidItems[i].save({useMasterKey:false}, {
                        sucess: function(item){
                            console.log("Save success");
                        },
                        error: function(item, error){
                            console.log("Error saving: " + error);
                        }
                    })
                }

                // 2. Create order.
                var Order =  Parse.Object.extend("Order");
                var order = new Order();

                order.set("items", req.params.items);
                order.set("warehouseId", req.params.warehouseId);

                order.save({},{

                    success: function(result){
                        res.success(resData);
                    },
                    error: function(error){

                        console.log("Error: ", error);
                        resData.status = "Error";
                        res.success(resData);
                        
                    }

                })

            }


        }
    })


})

