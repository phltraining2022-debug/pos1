var process = require('process');
const fs = require('fs');
var loopback = require('loopback');
var app = loopback();
const heicConvert = require('heic-convert');
const redis = require("redis");
const client = redis.createClient();

const crypto = require("crypto");


function hashObjectMD5(obj) {
    const jsonString = JSON.stringify(obj); // Convert object to string
    return crypto.createHash("md5").update(jsonString).digest("hex"); // Generate MD5 hash
}

const axios = require('axios');
const { url } = require('inspector');
const { finished } = require('stream');


const apiKey = process.env.OPENAI_API_KEY || "";

const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
};

async function convertHEICtoJPEG(inputPath, outputPath) {
    const inputBuffer = fs.readFileSync(inputPath);
    const outputBuffer = await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.8
    }); 
    fs.writeFileSync(outputPath, outputBuffer);
}


function extractJSON(content) {
    // Find the JSON block in the assistant's message
    const jsonStartIndex = content.indexOf('```json');
    const jsonEndIndex = content.lastIndexOf('```');

    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      // Extract and parse the JSON
      const jsonString = content.substring(jsonStartIndex + 7, jsonEndIndex);
      return JSON.parse(jsonString);
    }
    else {
      try {
        return JSON.parse(content);
      }
      catch (error) {
        console.error('Error parsing JSON:', error);
        return {};
      }
    }
}
    
// Function to download an image from a URL and convert it to Base64
async function readImageAsBase64(imageUrl, size=1000) {
  var imagePath = imageUrl.replace('https://tl.prod.live1.vn/api/containers/imgs/download/', 
    '/home/ubuntu/ats/api/storage/imgs/');
  
  console.log('imagePath', imagePath);

  const ext = '.' + imagePath.split('.').pop();
  
  const sharp = require('sharp');
  const buffer = await sharp(imagePath)
    .resize(size)
    .jpeg({ mozjpeg: true })
    .toBuffer();
  console.log('buffer length', size, buffer.length);
  return buffer.toString('base64');
}

async function doMagic(visit, prompt) {
    // new need 3 images
    
  const requirements = visit.requirements.join(' ,');
  var content = '';
  try {
    var payload = {
      model: "gpt-4.5-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
              Hiện trạng xe như sau:
 • Biển số: [trích xuất từ hình ảnh]
 • Hãng xe: [trích xuất từ hình ảnh]
 • Tên xe: [trích xuất từ hình ảnh]
 • Năm sản xuất: [trích xuất từ hình ảnh]
 • Dung tích động cơ: [trích xuất từ hình ảnh]
 • Số vin: [trích xuất từ hình ảnh]
 • Số kilomet (ODO): [trích xuất từ hình ảnh]
 • Thông tin đăng kiểm: [trích xuất từ hình ảnh]
 • Lịch sử bảo dưỡng/sửa chữa trước đó: [trích xuất từ dữ liệu]
 • Mã lỗi hoặc cảnh báo trên xe (nếu có): [trích xuất từ hình ảnh/cảm biến]

Khách hàng yêu cầu dịch vụ: “${requirements}”.

Dựa trên các thông tin thu thập được từ hình ảnh, lịch sử sửa chữa và dữ liệu hệ thống, hãy:
 1. Tư vấn dịch vụ phù hợp cho khách hàng dựa trên tình trạng hiện tại của xe.
 2. Đề xuất hướng dẫn sửa chữa chi tiết cho kỹ thuật viên, bao gồm các bước thực hiện và linh kiện có thể cần thay thế.
 3. Kiểm tra các vấn đề tiềm ẩn, nếu có dấu hiệu hao mòn, lỗi tiềm ẩn hoặc dịch vụ bảo dưỡng định kỳ sắp đến, hãy đề xuất kiểm tra bổ sung.
 4. Gợi ý các dịch và bảo dưỡng đi kèm phù hợp để nâng cao hiệu suất và tuổi thọ của xe theo kilomet(odo) của xe

              `
            }
          ]
        }
      ],
      max_tokens: 5000
    };
    
    var images = [];
    var c = visit.checkInForm;
    if (c.images) 
        for(var i=0;i<c.images.length && i < 2; i++) {
            var e = c.images[i];
            e.size = 500;
            images.push(e);  
        };
        
    if (c.imagesKm) 
        c.imagesKm.forEach(e => {
            e.size = 500;
            images.push(e);  
        });
    
    if (c.imagesVin) 
        c.imagesVin.forEach(e => {
            images.push(e);  
        });
      

    for(var i=0; i < images.length;i++)
    {
        var e = images[i];
        try {
            console.log('downloading images');
            const base64Image = await readImageAsBase64(e.path, e.size);
            var item = 
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            };
            
            payload.messages[0].content.push(item);
        } catch(error) {
            console.log(error);
        }
    }
    
    console.log('call api ');

    const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, { headers });
    content = response.data.choices[0].message.content;

    console.log('call api ', content);

    payload = {
      model: "gpt-4.5-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "trích xuất json {brand, licensePlate, vin, model, year, odometer} từ nội dung sau đây " + content
            }
          ]
        }
      ],
      max_tokens: 5000
    };

    const response2 = await axios.post("https://api.openai.com/v1/chat/completions", payload, { headers });
    const content2 = response2.data.choices[0].message.content;

    var vehicle = extractJSON(content2);
    Object.keys(vehicle).forEach(key => {
      console.log(key, vehicle[key]);
      if (vehicle[key]) {
        visit.vehicle[key] = vehicle[key];
      }
    }
    );
    console.log('vehicle visit', visit.vehicle);

    // update visit
    await visit.save();


    return {
      answer: content, 
      question: payload.messages[0].content[0].text,
      objLastUpdated: visit.updatedAt,
      finishedAt: new Date(),
      finisedIn: new Date() - prompt.startedAt,
      tokenUsed: response.headers['x-openai-usage-token-count'],
      status: 'finished'
    };
    
  } catch (error) {
    // show the reason of the error from openai
    console.log('error', error.response && error.response.data);
    if (!error.response)
    console.log(error);
  }
  
  return {};
}


async function convertImagesToJPEG(images, convertedImages) {
    // Convert all images to JPEG format
    console.log(images);
    for (const image of images) {
        const ext = image.path.split('.').pop();
        const extIndex = image.path.lastIndexOf('.');
        console.log(ext); 

        if (ext.toLowerCase() === 'heic') {
            console.log('Converting image to JPEG:', image.path);
            

            const path = '/home/ubuntu/ats/api/storage/imgs/';
            var fileName = path + image.path.split('/').pop();
            const convertImageToJPEG = async (fileName) => {
                // use the const convert = require('heic-convert');
                const newFileName = fileName.replace('.' + ext, '.jpeg');
                // read file to buffer
                convertHEICtoJPEG(fileName, newFileName);
                // save the new file to the same directory
                
                console.log('newFileName', newFileName); 
                // fs.writeFileSync(newFileName, jpegImage);
                image.path = image.path.replace('.' + ext, '.jpeg');
                return image;
            }
            const jpegImage = await convertImageToJPEG(fileName);

            convertedImages.push(jpegImage);
        }
    }
        
    return convertedImages;
}


(async function (obj) {
    const app = require('./worker'); 
    const Visit = app.models.visit;
    const Prompt = app.models.Prompt;
    const Installation = app.models.Installation;
    const User = app.models.user;
    const Notification = app.models.Notification;
    // set current db 
    const subdomain = 'tl';
    const dbName = subdomain;
    const dataSource = app.dataSources[dbName];
    Visit.attachTo(dataSource); Prompt.attachTo(dataSource); Installation.attachTo(dataSource); User.attachTo(dataSource); Notification.attachTo(dataSource);
    const visit = await Visit.findById(obj.id); 

    if (!visit) {
        console.log('Visit not found');
        return;
    }
    

    var convertedImages = [];
    var images = [];
    var c = visit.checkInForm;
    await convertImagesToJPEG(c.images, convertedImages);
    await convertImagesToJPEG(c.imagesKm, convertedImages);
    await convertImagesToJPEG(c.imagesVin, convertedImages);
    visit.checkInForm = c;
    if (convertedImages.length > 0) {
        client.setex("no-trigger:" + visit.id, 30, "active", (err, reply) => {
          if (err) console.error(err);
          else console.log("SETEX Response:", reply);
        });
        await visit.save();
    }

    // check changes by using hash of c.images, c.imagesKm, c.imagesVin and c.requirements
    var data = {images: c.images, imagesKm: c.imagesKm, imagesVin: c.imagesVin, requirements: c.requirements}; 

    // find the Prompt for this visit
    var prompt = await Prompt.findOne({ where: { objectId: obj.id } });

    const hash = hashObjectMD5(data);
    console.log('hash', hash);
    if (prompt && prompt.hash === hash) {
        console.log('No changes in images or requirements');
        return;
    }

    if (!prompt) {
        prompt = await Prompt.create({ 
          objectId: obj.id, startedAt: new Date(), status: 'in-progress', hash: hash, answer: '***Vui lòng chờ 30-60s***' });
    } else {
        prompt.hash = hash;
        prompt.startedAt = new Date();
        // prompt.answer = '***Đang xử lý lòng chờ 30-60s***'
        prompt.status = 'in-progress';
        await prompt.save();
    }

    var result  = await doMagic(visit, prompt);

    await prompt.updateAttributes(result);

    const allUserIds = await User.find({ fields: { id: true } });

    var  userIds = allUserIds.map(u => u.id);
    // visit has updatedById and receptionistId .. they can be null 
    userIds = [visit.updatedById, visit.receptionistId].filter(u => u);
    
    var installations = await Installation.findByUserIds(userIds);

    const notificationData = {
        title: 'AI Tư vấn đã sẵn sàng',
        message: `Xe ${visit.vehicle.brand} ${visit.vehicle.licensePlate}`,
        data: {
            objectId: visit.id || 'none',
            model: "visit",
            type: "visit"
        }
    };

    Installation.sendApnNotifications(installations, notificationData, "com.vb.garage", "tl")
    Notification.create(
      {
        title: 'AI Tư vấn đã sẵn sàng',
          content:`Xe ${visit.vehicle.brand} ${visit.vehicle.licensePlate}`,
          receiverIds: userIds,
          data: {
              objectId: visit.id || 'none',
              model:  "visit",
              type: "Visit"
          }
          
      });
    

})(obj);
