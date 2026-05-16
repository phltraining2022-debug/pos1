var process = require('process');
const fs = require('fs');
var loopback = require('loopback');
var app = loopback();
const heicConvert = require('heic-convert');
const redis = require("redis");
const client = redis.createClient();

console.log('Processing visit message ... ', obj); 
console.log('Current working directory:', process.cwd());
const crypto = require("crypto");


function hashObjectMD5(obj) {
    const jsonString = JSON.stringify(obj); // Convert object to string
    return crypto.createHash("md5").update(jsonString).digest("hex"); // Generate MD5 hash
}


// 67c170c4702187feaf56fc2a

const axios = require('axios');
const { url } = require('inspector');


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
    return {};
}
    
// Function to download an image from a URL and convert it to Base64
async function downloadImageAsBase64(imageUrl) {
  // resize to 1000x1000

  var imagePath = imageUrl.replace('https://tl.prod.live1.vn/api/containers/imgs/download/', 
    '/home/ubuntu/ats/api/storage/imgs/');
  
  console.log('imagePath', imagePath);

  // get file extension 
  const ext = '.' + imagePath.split('.').pop();
  const extIndex = imagePath.lastIndexOf('.');
  
  // convert -resize 1000x1000 input.jpg output.jpg using sharp asy
  const sharp = require('sharp');
  const newFileName = imagePath.replace(ext, '-1000x1000' + ext);
  sharp(imagePath)
    .resize(1000, 1000)
    .toFile(imagePath.replace(ext, '-1000x1000' + ext), (err, info) => {
      if (err) {
        console.error(err);
      } else {
        console.log(info);
      }
    });

  
  // read the newFileName to buffer
  const buffer = fs.readFileSync(newFileName);
  // convert buffer to base64
  return buffer.toString('base64');

  // console.log(imageUrl);
  // try {
  //   const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  //   const base64Image = Buffer.from(response.data).toString('base64');
  //   return base64Image;
  // } catch (error) {
  //   console.error(`Error downloading image: ${error.message}`);
  //   throw error;
  // }
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

Nếu dữ liệu chưa đầy đủ, hãy yêu cầu bổ sung thông tin cần thiết trước khi tư vấn.

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
            // resize image to 1000x1000 using convert command
            // convert -resize 1000x1000 input.jpg output.jpg
            // const base64Image = await downloadImageAsBase64(e.path);
            // var item =
            // {
            //   type: "image_url",
            //   image_url: {
            //     url: `data:image/jpeg;base64,${base64Image}`
            //   }
            // };
            // payload.messages[0].content.push(item);


            images.push(e.path);  
        };
        
    if (c.imagesKm) 
        c.imagesKm.forEach(e => {
            images.push(e.path);  
        });
    
    if (c.imagesVin) 
        c.imagesVin.forEach(e => {
            images.push(e.path);  
        });
      

    for(var i=0; i < images.length;i++)
    {
        var e = images[i];
        try {
            console.log('downloading images');
            const base64Image = await downloadImageAsBase64(e);
            var item = 
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
              
            };

            // const base64Image = await downloadImageAsBase64(e);
            // var item = 
            // {
            //   type: "image_url",
            //   image_url: {
            //     url: e
            //   }
            // };

            // var item = 
            // {
            //   type: "image_url",
            //   image_url: {
            //     url: e.replace('tl.prod.live1.vn', 'ycdn.live1.vn'),
            //     "detail": "high"
            //   }
            // };
            
            payload.messages[0].content.push(item);
        } catch(error) {
            console.log(error);
        }
    }
    
    console.log('call api ');
  //   return {};
  //   payload.messages = [
  //     {
  //         "role": "user",
  //         "content": [
  //             {"type": "text", "text": "What's in this image?"},
  //             {
  //                 "type": "image_url",
  //                 "image_url": {
  //                   // url: "https://cdn.live1.vn/ats2/v2/public/americaqeen.jpg",
  //                     // "url": "https://drive.usercontent.google.com/download?id=1KsPvbYyM-XKZlOEhZEZeRHVtZLxL2oJ0&authuser=0",
  //                     // "url": "http://ycdn.live1.vn/10d522d1-5383-4be8-88a0-3b8ddc3f893e.jpeg",
  //                     // url: "https://imt-soft.com/wp-content/themes/restly-child/assets/images/who-we-are-2023.webp",
  //                     // url: "https://www.vastbit.info/assets/img/portfolio/kara1.png",
  //                     url: "http://ycdn.live1.vn/b8393983-839b-4917-b0d8-d1f8322603aa.JPG",
  //                     // url: "http://c2.vvs.vn/Plugins/Theme.Tiffany/Content/images/special-home-collection-right.png",
  //                     "detail": "high",
  //                 },
  //             },
  //         ],
  //     }
  // ];

    // const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, { headers });
    // const content = response.data.choices[0].message.content;
    // const content = prompt.anwser;

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

    var vehicle = {
    "brand": "DAEWOO (CHEVROLET)",
    "licensePlate": "49A-568.17",
    "vin": "",
    "model": "LACETTI PREMIERE CDX",
    "year": 2010,
    "odometer": "61,296 km"
    }
    // const response2 = await axios.post("https://api.openai.com/v1/chat/completions", payload, { headers });
    // const content2 = response2.data.choices[0].message.content;



    // console.log(content2);

    // var vehicle = extractJSON(content2);
    Object.keys(vehicle).forEach(key => {
      console.log(key, vehicle[key]);
      if (vehicle[key]) {
        visit.vehicle[key] = vehicle[key];
      }
    }
    );
    console.log('vehicle', visit.vehicle);

    // update visit
    await visit.save();

    // update visit.vehicle with the extracted information from the assistant's message

    return {
      answer: content, 
      question: payload.messages[0].content[0].text,
      objLastUpdated: visit.updatedAt,
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
    // set current db 
    const subdomain = 'tl';
    const dbName = subdomain;
    const dataSource = app.dataSources[dbName];
    Visit.attachTo(dataSource); Prompt.attachTo(dataSource);
    const visit = await Visit.findById(obj.id); 

    // visit.vehicle.brand = 'Deawoo';
    // visit.save();
    // console.log('Visit save');

    // return;

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
        client.setex("no-trigger:" + visit.id, 5, "active", (err, reply) => {
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
        // return;
    }

    if (!prompt) {
        prompt = await Prompt.create({ objectId: obj.id, status: 'in-progress', hash: hash, answer: '***Vui lòng chờ 30-60s***' });
    } else {
        prompt.hash = hash;
        // prompt.answer = '***Đang xử lý lòng chờ 30-60s***'
        // prompt.status = 'in-progress';
        await prompt.save();
    }

    var result  = await doMagic(visit, prompt);

    // await prompt.updateAttributes(result);

    // visit has the property vehicle: {brand, licensePlate, vin, model, year, odometer }

    // "trích xuất json {brand, licensePlate, vin, model, year, odometer }"

    // update vehicle information


})(obj);
