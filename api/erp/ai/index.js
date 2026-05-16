// index.js (Sử dụng ES Module)

// KHÔI PHỤC cú pháp import
import 'dotenv/config'; 
import { GoogleGenAI } from "@google/genai"; 

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;

// Khởi tạo client
const ai = new GoogleGenAI({});

async function runVertexTest() {
  if (!PROJECT_ID || !LOCATION) {
    console.error("Thiếu biến môi trường. Vui lòng kiểm tra file .env hoặc cấu hình.");
    return;
  }
  
  const prompt = "Giải thích ngắn gọn Vertex AI là gì?";
  const modelName = "gemini-2.5-flash"; 

  console.log(`Đang chạy trên Project: ${PROJECT_ID} tại Location: ${LOCATION}`);
  
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });

    console.log("\n--- Phản hồi từ Gemini ---");
    console.log(response.text);

  } catch (error) {
    console.error("Lỗi gọi API:", error.message);
  }
}

runVertexTest();
