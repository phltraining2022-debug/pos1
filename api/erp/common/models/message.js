var moment = require('moment');
var app = require('../../server/server.js');
// const r = require('run-sequence');

module.exports = function(Message) {
    Message.observe('before save', function(ctx, next){
        var instance = ctx.data || ctx.instance;
        if(ctx.isNewInstance){
            instance.createdAt = moment.utc();
        }
        instance.updatedAt = instance.createdAt;
        next();
    });
    
    Message.observe('after save', function(ctx, next) {
        // do send push notification here
        // instance have data below
        // channel_id: "5oqAJcNa7oPtdcAxwttYkzHuEFmYEZYmiL"
        // user_id: "5oqAJcNa7oPtdcAxw"
        // user_name: "0903121558.lawyer.pl
        // text: "hi"


        var instance = ctx.data || ctx.instance;
        var message = instance.text;
        var userId = instance.user_id;

        if (instance.fromId || instance.toId) return next();
        

        // find both user and receiver
        const User = app.models.user;
        const Customer = app.models.Customer;
        const Installation = app.models.installation;

        // channel_id containts user_id and receiver_id
        var channel = instance.channel_id;
        var receiverId = channel && channel.replace(userId, '');

        const ids = [userId, receiverId];
        // find sync users {rocketChatId: {inq: ids}}
        User.find({where: {rocketChatId: {inq: ids}}}, function(err, users){
            if(err) return next(err);

            var senders = users.filter(function(u){ return u.rocketChatId == userId; });
            var sender = null;
            var receiver = null;
            if (senders.length > 0)
                sender = senders[0];

            var receivers = users.filter(function(u){ return u.rocketChatId == receiverId; });
            if (receivers.length > 0)
                receiver = receivers[0];

            Customer.find({where: {rocketChatId: {inq: ids}}}, function(err, customers) {
                if (err) return next(err);

                if (!sender) {
                    senders = customers.filter(function(u){ return u.rocketChatId == userId; }) ;
                    if (senders.length > 0)
                        sender = senders[0];
                }

                if (!receiver) {
                    receivers = customers.filter(function(u){ return u.rocketChatId == receiverId; });

                    if (receivers.length > 0)
                        receiver = receivers[0];
                }

                if (!receiver)
                    return next(new Error('receiver not found'));

                console.log('sender', sender);

                // find the receiver installation
               
                Installation.find({where: {userId: receiver.id}}, function(err, installations){
                    if(err) return next(err);

                    var currentDatasource = Message.currentDatasource || 'vb';

                    if(installations.length > 0){
                        var pushData = {
                            title: sender && (sender.name || sender.fullName),
                            message: message,
                            data: {
                                type: 'message',
                                user: {
                                    id: sender.id,
                                    rocketChatUserName: sender.user_name,
                                    roomId: instance.channel_id,
                                    name: sender.name || sender.fullName   
                                }
                            }
                        }; 

                        // send push notification
                        var bundleId = 'com.vb.' + currentDatasource;
                        if (currentDatasource == 'pl')
                            bundleId = 'com.vb.law';

                        if (currentDatasource == 'tl')
                            bundleId = 'com.vb.garage';

                        console.log(installations);
                        Installation.sendApnNotifications(installations, pushData, bundleId, currentDatasource);
                    }
                });
            });
        
        });

    
        next();
    });

    /**
     * GET /messages/unread-summary?limit=50
     */
    Message.getUnreadSummary = function(req, res, cb) {
        var parsedLimit = parseInt(req.query && req.query.limit, 10);
        var limit = parsedLimit && parsedLimit > 0 ? parsedLimit : 50;
        if (limit > 200)
            limit = 200;

        var agentId = req && req.accessToken && req.accessToken.userId;
        if (!agentId)
            return cb(new Error('Agent not authenticated'));

        var filter = {
            where: {
                isRead: {neq: true},
                fromId: {neq: agentId}
            },
            fields: ['channel_id', 'fromId', 'toLeadId', 'createdAt'],
            order: 'createdAt DESC',
            limit: 1000
        };

        Message.find(filter, function(err, messages) {
            if (err)
                return cb(err);

            var summaryMap = {};
            messages.forEach(function(message) {
                var key = message.channel_id || message.toLeadId || message.fromId;
                if (!key)
                    return;

                if (!summaryMap[key]) {
                    summaryMap[key] = {
                        channelId: message.channel_id || null,
                        leadId: message.toLeadId || message.fromId || null,
                        unreadCount: 0,
                        latestCreatedAt: message.createdAt
                    };
                }

                summaryMap[key].unreadCount += 1;
                if (summaryMap[key].latestCreatedAt < message.createdAt)
                    summaryMap[key].latestCreatedAt = message.createdAt;
            });

            var summaryList = Object.keys(summaryMap).map(function(key) {
                return summaryMap[key];
            }).sort(function(a, b) {
                if (b.unreadCount !== a.unreadCount)
                    return b.unreadCount - a.unreadCount;

                var aTime = a.latestCreatedAt ? new Date(a.latestCreatedAt).getTime() : 0;
                var bTime = b.latestCreatedAt ? new Date(b.latestCreatedAt).getTime() : 0;
                return bTime - aTime;
            }).slice(0, limit).map(function(item) {
                delete item.latestCreatedAt;
                return item;
            });

            res.json(summaryList);
        });
    };

    Message.remoteMethod('getUnreadSummary', {
        http: {path: '/unread-summary', verb: 'get'},
        accepts: [
            {arg: 'req', type: 'object', http: {source: 'req'}},
            {arg: 'res', type: 'object', http: {source: 'res'}}
        ],
        returns: {type: 'array', root: true}
    });
};
