var moment = require('moment')
var app = require('../../server/server');
var Parse = require('parse/node');
var fs = require('fs');
var path = require('path');

const redis = require('redis');
const redisPublisher = redis.createClient();
// redisPublisher.connect();



module.exports = function (Log) {

    Log.observe("after save", async function (ctx) {
        // redisPublisher.get('no-trigger:' + ctx.instance.objectId, function(err, reply) {
        //     if (reply) {
        //         console.log('No trigger for this log');
        //         return;
        //     }

        try {

            const instance = ctx.instance;
            console.log('[Trigger] Checking:', instance.model, instance.event);

            // Load trigger from file: server/triggers/{appName}/{Model}.{event}.js
            const appName = process.env.DB_NAME || (app.hostname || '').split('.')[0] || 'default';
            const triggerFilePath = path.join(__dirname, '../../server/triggers', appName, `${instance.model}.${instance.event}.js`);

            if (fs.existsSync(triggerFilePath)) {
                try {
                    console.log('[Trigger] Loading:', triggerFilePath);
                    const triggerFn = require(triggerFilePath);
                    instance.createdById = instance.data && instance.data.createdById;
                    await triggerFn(instance);
                } catch (executionError) {
                    console.error('[Trigger Error]', triggerFilePath, executionError);
                }
            } else {
                console.log('[Trigger] No file for:', `${appName}/${instance.model}.${instance.event}.js`);
            }

            // only update on models [SaleOrder, SaleOrderItem, Visit, Apppointment]
            const models = ['SaleOrder', 'SaleOrderItem', 'Visit', 'Appointment', 'Lead', 'Opportunity', 'Room', 
                'Contract', 'Booking', 'Invoice', 'Attendance', 'Task', 'Project',
                'Customer', 'StockMove', 'Employee', 'Product', 'Mail', 'transaction', 'message'];

            if (models.includes(instance.model)) {
                if (instance.model === 'message') {
                    console.log('Check');
                    redisPublisher.publish('updates', JSON.stringify({
                        toId: instance.data.toId,
                        fromId: instance.data.fromId,
                        id: instance.objectId,
                        content: instance.data.content,
                        message: instance.data.message,
                        zaloAppId: instance.data.zaloAppId,
                        zaloMsgId: instance.data.zaloMsgId,
                        isReaded: instance.data.isReaded,
                        toLeadId: instance.data.toLeadId,
                        clinicShortName: instance.data.clinicShortName
                    }));
                } else if (instance.model === 'Lead' && (instance.event === 'updated' || instance.event === 'created')) {
                    if (instance.event === 'created' || (instance.changes && Object.keys(instance.changes).length > 0)) {
                        redisPublisher.publish('updates', JSON.stringify({
                            model: instance.model,
                            id: instance.objectId,
                            event: instance.event,
                            changes: instance.changes,
                            lastUpdated: instance.createdAt
                        }));
                    }
                } else {
                    let ds = Log.currentDatasource || app.hostname.split('.')[0];
                    console.log("Check3", ds);
                    redisPublisher.publish('updates', JSON.stringify({
                        model: instance.model,
                        id: instance.objectId,
                        logId: instance.id,
                        event: instance.event,
                        changes: instance.changes,
                        clinicShortName: ds
                    }));
                }
            }


        } catch (error) {
            console.error('Error in observer:', error);
        }

        // }
        // );

    });


}
