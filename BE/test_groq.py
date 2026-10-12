import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise RuntimeError("❌ Không tìm thấy GROQ_API_KEY trong file .env")

client = Groq(api_key=api_key)

response = client.chat.completions.create(
    model="qwen/qwen3.8-27b",
    messages=[
        {
            "role": "user",
            "content": "Xin chào! Hãy trả lời đúng một câu: Groq API đang hoạt động."
        }
    ],
    temperature=0,
)

print("\n========== GROQ RESPONSE ==========")
print(response.choices[0].message.content)
print("====================================")