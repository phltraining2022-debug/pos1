const axios = require("axios");
const apiKey = process.env.OPENAI_API_KEY || "";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
};

const askAi = async function (params) {
  try {
    if (!params || !params.messages) {
      return { error: "messages is required" };
    }

    const payload = {
      model: "gpt-4-turbo", //Cost-sensitive, gpt-4.1 faster
      messages: params.messages,
      max_tokens: 256,
    };

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      payload,
      { headers }
    );

    if (response.status !== 200) {
      return { error: "Fail to response" };
    }

    return {
      content: response.data.choices[0].message.content,
    };
  } catch (error) {
    console.error("Error in askAi:", error);
    return { error: "An error occurred while processing your request." };
  }
};

module.exports = {
  askAi,
};
