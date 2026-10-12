import os
import base64

from dotenv import load_dotenv
from groq import Groq

# Đọc .env
load_dotenv()

api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise RuntimeError("❌ Không tìm thấy GROQ_API_KEY trong file .env")

client = Groq(api_key=api_key)

# Đường dẫn ảnh
image_path = os.path.join(
    os.path.dirname(__file__),
    "test_images",
    "cccd.jpg"
)

# Kiểm tra ảnh tồn tại
if not os.path.exists(image_path):
    raise FileNotFoundError(
        f"❌ Không tìm thấy ảnh:\n{image_path}"
    )

# Đọc ảnh
with open(image_path, "rb") as image_file:
    image_base64 = base64.b64encode(image_file.read()).decode("utf-8")

# Xác định loại ảnh
ext = os.path.splitext(image_path)[1].lower()

if ext == ".png":
    mime_type = "image/png"
elif ext == ".webp":
    mime_type = "image/webp"
else:
    mime_type = "image/jpeg"

image_url = f"data:{mime_type};base64,{image_base64}"

print("⏳ Đang gửi ảnh CCCD lên Groq...")

response = client.chat.completions.create(
    model="qwen/qwen3.8-27b",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": """
Đây là ảnh mặt trước của CCCD Việt Nam.

Hãy đọc toàn bộ thông tin có thể nhìn thấy trong ảnh.

Trả lời theo dạng:

- Số CCCD:
- Họ và tên:
- Ngày sinh:
- Giới tính:
- Quốc tịch:
- Quê quán:
- Nơi thường trú:
- Ngày cấp:
- Ngày hết hạn:

Nếu thông tin nào không nhìn thấy thì ghi:
KHÔNG ĐỌC ĐƯỢC

Không tự đoán hoặc bịa thông tin.
""",
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_url
                    },
                },
            ],
        }
    ],
    temperature=0,
)

result = response.choices[0].message.content

print("\n" + "=" * 60)
print("KẾT QUẢ ĐỌC CCCD")
print("=" * 60)
print(result)
print("=" * 60)