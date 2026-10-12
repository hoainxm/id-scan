import requests


# ============================================================
# ĐƯỜNG DẪN ẢNH CCCD
# ============================================================

front_path = r"D:\cmnd\BE\test_images\front.jpg"
back_path = r"D:\cmnd\BE\test_images\back.jpg"


# ============================================================
# MỞ 2 ẢNH
# ============================================================

with open(front_path, "rb") as front:
    with open(back_path, "rb") as back:

        files = {
            "front": (
                "front.jpg",
                front,
                "image/jpeg"
            ),

            "back": (
                "back.jpg",
                back,
                "image/jpeg"
            )
        }

        print("Đang gửi 2 ảnh CCCD lên Backend...")
        print()

        response = requests.post(
            "http://127.0.0.1:8000/api/ocr-cccd",
            files=files
        )


# ============================================================
# HIỂN THỊ KẾT QUẢ
# ============================================================

print("HTTP Status:", response.status_code)
print()

print("Kết quả:")
print(response.text)