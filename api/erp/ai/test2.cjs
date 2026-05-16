// import 'dotenv/config'; 
// import { GoogleGenAI } from "@google/genai"; 

const { GoogleGenAI } = require("@google/genai");
require('dotenv').config();


// --- Cấu hình ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION;
const modelName = "gemini-2.5-flash"; // Hoặc gemini-1.5-flash

const ai = new GoogleGenAI({
  vertexai: true,
  project: PROJECT_ID,
  location: LOCATION
});

const conversation = `
Chào ad, Công ty mình đang tìm venue để tổ chức YEP, ad cho mình hỏi là bên mình có nhận tiệc nhỏ với thông tin bên dưới ko nhie. 
+ Thời gian: ngày 24/01/2026 hoặc 31/01/2026 (trang trí: từ 15h; tiệc: từ 18h30) 
+ Quy mô: 30 ~ 40 người
10 thg 11
Thứ Ba, 11 tháng 11, 2025
Dạ chị cho em xin số điện thoại nhân viên hỗ trợ mình nha
11 thg 11 
0784855333 (Trân)
11 thg 11
mình gửi nhé
`;

async function analyzeLeadSmart() {
  // --- SỬA LỖI TẠI ĐÂY: Dùng String thay vì SchemaType ---
  const schema = {
    type: "OBJECT",
    properties: {
      customer_profile: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Tên người liên hệ" },
          phone: { type: "STRING", description: "Số điện thoại đã chuẩn hóa" },
          type: { type: "STRING", enum: ["Cá nhân", "Doanh nghiệp"], description: "Phân loại khách hàng" }
        }
      },
      event_details: {
        type: "OBJECT",
        properties: {
          event_type: { type: "STRING", description: "Loại sự kiện (VD: YEP, Sinh nhật...)" },
          guest_count_min: { type: "INTEGER", description: "Số lượng khách tối thiểu" },
          guest_count_max: { type: "INTEGER", description: "Số lượng khách tối đa" },
          potential_dates_iso: { 
            type: "ARRAY", 
            items: { type: "STRING" },
            description: "Danh sách ngày dự kiến định dạng YYYY-MM-DD"
          },
          logistics_note: { type: "STRING", description: "Ghi chú về giờ giấc, setup" }
        }
      },
      sales_intelligence: {
        type: "OBJECT",
        properties: {
          intent_score: { type: "INTEGER", description: "Điểm tiềm năng từ 1-10" },
          buying_stage: { type: "STRING", enum: ["Tìm hiểu", "Cân nhắc", "Quyết định"] },
          missing_info: { type: "ARRAY", items: { type: "STRING" }, description: "Thông tin còn thiếu" },
          suggested_action: { type: "STRING", description: "Hành động tiếp theo" }
        }
      }
    },
    required: ["customer_profile", "event_details", "sales_intelligence"]
  };

  const systemInstruction = `
    Bạn là Chuyên gia Phân tích Dữ liệu CRM. 
    Nhiệm vụ: Phân tích đoạn hội thoại, trích xuất dữ liệu JSON, chuẩn hóa ngày tháng về ISO 8601.
  `;

  try {
    console.log("Đang phân tích hội thoại...");
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [conversation],
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema, 
      }
    });

    // Thường thư viện mới sẽ trả về object luôn nếu dùng responseSchema,
    // nhưng để chắc chắn ta vẫn check text
    const resultText = response.text;
    const result = JSON.parse(resultText); 
    
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("Lỗi:", error);
  }
}

analyzeLeadSmart();
