// after created hook 
// Use this hook to alter values after they are created
module.exports = function(Mail) {
    Mail.observe('after save', async function(ctx, next) {
        // ctx.instance is the instance of the model that was created
        // ctx.data is the data that was passed to the model
        // ctx.where is the where clause that was used to find the instance
        // ctx.options is the options that were passed to the model
        // ctx.Model is the model that was used
       
    
        var mail = ctx.instance || ctx.data;
        const app = require('../../server/server');
        const sgMail = require('@sendgrid/mail');

        // Set your SendGrid API key
        sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

        try {

            const User = app.models.user;

            // Check if the mail instance is new instance
            if (ctx.isNewInstance) {
                console.log('New Mail instance created:', mail.id);   
                
                if (mail.status === 'inbox') {
                
                    // fix mail.to array to contain email within <email@domain>
                    const to = mail.to.map(email => {
                        // use regex email to extract email from to 
                        const match = email.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                        if (match) {
                            return match[0];
                        }
                        return email;
                    });
                    mail.to = to;
                    // find user has alias email to info@manglinehills.com ... add 'chau@manglinehills.com' to mail.to
                    to.forEach(async email => {
                        if (email === 'info@manglinehills.com') {
                            mail.to.push('chau@manglinehills.com');
                        }
                    });                      

                    await mail.updateAttributes({ to: mail.to });
                    console.log('mail to updated to:', mail.to);
                }


                // Load the full Mail object
                if (!['outbox', 'sent'].includes(mail.status)) {
                    console.log(`Mail status is '${mail.status}', skipping email send.`);
                    return;
                }

                const emailData = {
                    from: mail.from || 'no-reply@live1.vn',
                    to: mail.to,
                    subject: mail.subject,
                    html: mail.body
                };

                if (Array.isArray(mail.cc) && mail.cc.length) {
                    emailData.cc = mail.cc;
                }

                if (Array.isArray(mail.bcc) && mail.bcc.length) {
                    emailData.bcc = mail.bcc;
                }

                if (Array.isArray(mail.attachments) && mail.attachments.length) {
                    /*
                    "attachments": [
                        {
                            "type": "image/jpeg",
                            "url": "https://cdn.live1.vn/optimized/tl/IMG_9527.JPG",
                            "name": "IMG_9527.JPG",
                            "size": 12307
                        }
                    ] */
                    // Convert the attachments to the format required by SendGrid
                    const axios = require('axios');
                    let attachments = [];
                    for (const attachment of mail.attachments) {
                        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
                        const content = Buffer.from(response.data).toString('base64');
                        attachments.push({
                            content: content,
                            type: attachment.type,
                            filename: attachment.name || attachment.url.split('/').pop(),
                            disposition: 'attachment'
                        });
                    }
                    // Add the attachments to the email data
                    emailData.attachments = attachments;

                }

                // Send the email
                await sgMail.send(emailData);
                console.log('✅ Email sent to:', mail.to);

                // Optionally update status if sent from outbox
                if (mail.status === 'outbox') {
                    await mail.updateAttributes({ status: 'sent' });
                    console.log('✏️ Mail status updated to sent.');
                }

                

                console.log('Finished async operation for Mail instance:', instance.id);


            
            }
        } catch (error) {
            console.error('❌ Error sending email:', error.response?.body || error.message || error);
        }


        // next();
    });
}