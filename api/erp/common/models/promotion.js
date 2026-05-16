'use strict';
var moment = require('moment');
module.exports = function (Promotion) {
    Promotion.observe("before save", function removeInlcudedObjs(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        
        var properties = "serviceList servicePackageList".split(" ");
        properties.forEach(function (p) {
            delete modelInstance[p];
        });
        next();
    });

    Promotion.observe("before save", function setCreatedAtAndUpdatedAt(ctx, next) {
        var modelInstance = ctx.data ? ctx.data : ctx.instance;
        if (modelInstance.id) {
            modelInstance.updatedAt = moment.utc();
            next();
            return;
        }

        // Create new order
        modelInstance.createdAt = moment.utc();
        modelInstance.updatedAt = modelInstance.createdAt;
        next();
    });

    // API endpoint to validate promotion code
        Promotion.validateCode = function(code, totalAmount, items, callback) {
        if (!code || typeof code !== 'string') {
            return callback(null, {
                success: false,
                valid: false,
                message: 'Mã giảm giá không hợp lệ'
            });
        }

        var normalizedCode = code.toUpperCase().trim();
        var now = moment.utc();

        // Find all promotions and filter manually since LoopBack MongoDB queries can be tricky
        Promotion.find({
            where: {
                and: [
                    { active: true },
                    {
                        or: [
                            { startDate: null },
                            { startDate: { lte: now.toDate() } }
                        ]
                    },
                    {
                        or: [
                            { endDate: null },
                            { endDate: { gte: now.toDate() } }
                        ]
                    }
                ]
            }
        }, function(err, promotions) {
            if (err) {
                console.log('Error finding promotions:', err);
                return callback(null, {
                    success: false,
                    valid: false,
                    message: 'Lỗi hệ thống'
                });
            }

            console.log('All active promotions:', promotions.length);
            
            // Find promotion with matching code
            var promotion = null;
            if (promotions && promotions.length > 0) {
                for (var i = 0; i < promotions.length; i++) {
                    var p = promotions[i];
                    
                    // Check promoCode field (old single code)
                    if (p.promoCode && p.promoCode === normalizedCode) {
                        promotion = p;
                        break;
                    }
                    
                    // Check promoCodes array (new multiple codes)
                    if (p.promoCodes && Array.isArray(p.promoCodes)) {
                        for (var j = 0; j < p.promoCodes.length; j++) {
                            var pc = p.promoCodes[j];
                            if (pc && pc.code === normalizedCode) {
                                promotion = p;
                                break;
                            }
                        }
                        if (promotion) break;
                    }
                }
            }

            console.log('Found promotion for code', normalizedCode, ':', promotion ? promotion.id : 'none');
            
            if (!promotion) {
                return callback(null, {
                    success: false,
                    valid: false,
                    message: 'Mã giảm giá không tồn tại hoặc đã hết hạn'
                });
            }

            // Find specific promo code details if using promoCodes array
            var promoCodeDetails = null;
            if (promotion.promoCodes && Array.isArray(promotion.promoCodes)) {
                promoCodeDetails = promotion.promoCodes.find(function(pc) {
                    return pc && pc.code === normalizedCode;
                });
            }

            // Check minimum purchase amount
            var minPurchaseAmount = promoCodeDetails ? promoCodeDetails.minPurchaseAmount : promotion.minPurchaseAmount;
            if (minPurchaseAmount && totalAmount && totalAmount < minPurchaseAmount) {
                return callback(null, {
                    success: false,
                    valid: false,
                    message: 'Đơn hàng chưa đạt giá trị tối thiểu ' + minPurchaseAmount.toLocaleString() + ' VND'
                });
            }
            var discountType = (promoCodeDetails && promoCodeDetails.discountType) ? promoCodeDetails.discountType : promotion.discountType;
            var discountValue = (promoCodeDetails && promoCodeDetails.discountValue !== undefined) ? promoCodeDetails.discountValue : promotion.discountValue;
            var maxDiscountValue = promoCodeDetails ? promoCodeDetails.maxDiscountValue : promotion.maxDiscountValue;

            // Prepare successful response
            var result = {
                success: true,
                valid: true,
                discountType: discountType,
                discountValue: discountValue,
                maxDiscountValue: maxDiscountValue,
                minPurchaseAmount: minPurchaseAmount,
                promotionName: promotion.name,
                promotion: {
                    id: promotion.id,
                    name: promotion.name,
                    description: promotion.description,
                    discountType: discountType,
                    discountValue: discountValue,
                    scope: promotion.scope,
                    maxQuantity: promotion.maxQuantity,
                    buyQuantity: promotion.buyQuantity,
                    giftItems: promotion.giftItems || [],
                    discountLines: promotion.discountLines || [],
                    productIds: promotion.productIds || [],
                    isStackable: promotion.isStackable || false,
                    startDate: promotion.startDate,
                    endDate: promotion.endDate
                }
            };

            // Add promoCode details if available
            if (promoCodeDetails) {
                result.promoCode = {
                    code: promoCodeDetails.code,
                    minPurchaseAmount: promoCodeDetails.minPurchaseAmount,
                    maxDiscountValue: promoCodeDetails.maxDiscountValue,
                    usageCount: promoCodeDetails.usageCount
                };
            }

            // Add promoCode details if available
            if (promoCodeDetails) {
                result.promoCode = {
                    code: promoCodeDetails.code,
                    minPurchaseAmount: promoCodeDetails.minPurchaseAmount,
                    maxDiscountValue: promoCodeDetails.maxDiscountValue,
                    usageCount: promoCodeDetails.usageCount
                };
            }

            callback(null, result);
        });
    };

    // Register the remote method
    Promotion.remoteMethod('validateCode', {
        accepts: [
            {
                arg: 'code',
                type: 'string',
                required: true,
                description: 'Mã giảm giá cần kiểm tra'
            },
            {
                arg: 'totalAmount',
                type: 'number',
                description: 'Tổng giá trị đơn hàng'
            },
            {
                arg: 'items',
                type: 'array',
                description: 'Danh sách sản phẩm trong giỏ hàng'
            }
        ],
        returns: {
            arg: 'result',
            type: 'object',
            description: 'Kết quả kiểm tra mã giảm giá'
        },
        http: {
            path: '/validate-code',
            verb: 'post'
        },
        description: 'Kiểm tra và lấy thông tin mã giảm giá'
    });
};
