import os

from flask import Flask, request, jsonify
from flask_cors import CORS

from services.portrait_service import (
    crop_portrait_from_bytes
)

# ============================================================
# GROQ OCR
# ============================================================

from services.groq_cccd import extract_cccd, OCRConfigError

from groq import (
    APIConnectionError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)


# ============================================================
# FLASK
# ============================================================

app = Flask(__name__)

# Chỉ cho FE đã biết gọi API (ảnh CCCD là dữ liệu cá nhân).
# Thêm origin khác qua biến môi trường, phân tách bằng dấu phẩy.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500"
    ).split(",")
    if origin.strip()
]

CORS(app, origins=ALLOWED_ORIGINS)


# ============================================================
# CONFIG
# ============================================================

MAX_CONTENT_LENGTH = 10 * 1024 * 1024

app.config[
    "MAX_CONTENT_LENGTH"
] = MAX_CONTENT_LENGTH


# ============================================================
# CHECK FILE
# ============================================================

def is_supported_image(file_bytes):
    """
    Kiểm tra theo nội dung (magic bytes) thay vì đuôi file:
    ảnh chụp từ camera/clipboard thường có tên "blob" không có đuôi.
    """

    return (
        file_bytes.startswith(b"\xff\xd8\xff")
        or file_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.route(
    "/api/health",
    methods=["GET"]
)
def health():

    return jsonify({
        "success": True,
        "status": "ok",
        "service": "portrait-extraction + groq-ocr"
    })


# ============================================================
# PORTRAIT API
# ============================================================

@app.route(
    "/api/portrait",
    methods=["POST"]
)
def portrait():

    try:

        # ----------------------------------------------------
        # Kiểm tra file
        # ----------------------------------------------------

        if "front" not in request.files:

            return jsonify({
                "success": False,
                "message":
                    "Chưa gửi ảnh CCCD mặt trước"
            }), 400

        file = request.files["front"]

        if file.filename == "":

            return jsonify({
                "success": False,
                "message":
                    "Tên file không hợp lệ"
            }), 400

        # ----------------------------------------------------
        # Đọc ảnh trực tiếp vào RAM
        # ----------------------------------------------------

        file_bytes = file.read()

        if not file_bytes:

            return jsonify({
                "success": False,
                "message":
                    "File ảnh rỗng"
            }), 400

        # ----------------------------------------------------
        # Kiểm tra định dạng
        # ----------------------------------------------------

        if not is_supported_image(
            file_bytes
        ):

            return jsonify({
                "success": False,
                "message":
                    "Chỉ chấp nhận PNG, JPG, JPEG"
            }), 400

        # ----------------------------------------------------
        # Crop chân dung
        #
        # KHÔNG LƯU FILE
        # ----------------------------------------------------

        result = crop_portrait_from_bytes(
            file_bytes
        )

        # ----------------------------------------------------
        # Trả ảnh Base64
        # ----------------------------------------------------

        return jsonify({
            "success": True,

            "message":
                "Đã crop chân dung thành công",

            "image_base64":
                result["image_base64"],

            "width":
                result["width"],

            "height":
                result["height"],

            "face":
                result["face"],

            "crop":
                result["crop"],

            "detector":
                result["detector"]
        }), 200

    except ValueError as e:

        return jsonify({
            "success": False,
            "code": "NO_PORTRAIT",
            "message": str(e)
        }), 422

    except Exception as e:

        print(
            "Lỗi API portrait:",
            repr(e)
        )

        return jsonify({
            "success": False,
            "message":
                "Có lỗi xảy ra khi xử lý ảnh"
        }), 500


# ============================================================
# OCR CCCD - GROQ VISION
# ============================================================

@app.route(
    "/api/ocr-cccd",
    methods=["POST"]
)
def ocr_cccd():

    try:

        # ----------------------------------------------------
        # KIỂM TRA MẶT TRƯỚC
        # ----------------------------------------------------

        if "front" not in request.files:

            return jsonify({
                "success": False,
                "message":
                    "Chưa gửi ảnh CCCD mặt trước"
            }), 400

        # ----------------------------------------------------
        # KIỂM TRA MẶT SAU
        # ----------------------------------------------------

        if "back" not in request.files:

            return jsonify({
                "success": False,
                "message":
                    "Chưa gửi ảnh CCCD mặt sau"
            }), 400

        front_file = request.files["front"]
        back_file = request.files["back"]

        # ----------------------------------------------------
        # KIỂM TRA TÊN FILE
        # ----------------------------------------------------

        if front_file.filename == "":
            return jsonify({
                "success": False,
                "message":
                    "Tên file mặt trước không hợp lệ"
            }), 400

        if back_file.filename == "":
            return jsonify({
                "success": False,
                "message":
                    "Tên file mặt sau không hợp lệ"
            }), 400

        # ----------------------------------------------------
        # ĐỌC ẢNH VÀO RAM
        #
        # Không lưu ảnh CCCD xuống ổ đĩa
        # ----------------------------------------------------

        front_bytes = front_file.read()
        back_bytes = back_file.read()

        if not front_bytes:

            return jsonify({
                "success": False,
                "message":
                    "Ảnh CCCD mặt trước rỗng"
            }), 400

        if not back_bytes:

            return jsonify({
                "success": False,
                "message":
                    "Ảnh CCCD mặt sau rỗng"
            }), 400

        # ----------------------------------------------------
        # KIỂM TRA ĐỊNH DẠNG
        # ----------------------------------------------------

        if not is_supported_image(
            front_bytes
        ):

            return jsonify({
                "success": False,
                "message":
                    "Ảnh mặt trước chỉ chấp nhận PNG, JPG, JPEG"
            }), 400

        if not is_supported_image(
            back_bytes
        ):

            return jsonify({
                "success": False,
                "message":
                    "Ảnh mặt sau chỉ chấp nhận PNG, JPG, JPEG"
            }), 400

        # ----------------------------------------------------
        # GỌI GROQ VISION + KIỂM CHỨNG (QR / MRZ / LOGIC)
        # ----------------------------------------------------

        result = extract_cccd(
            front_bytes,
            back_bytes
        )

        # ----------------------------------------------------
        # TRẢ KẾT QUẢ
        #
        # data: giữ nguyên các trường cũ + cardType
        # validation: trường cần người dùng kiểm tra lại
        # ----------------------------------------------------

        return jsonify({
            "success": True,
            "message":
                "Đã đọc thông tin CCCD thành công",
            "data":
                result["data"],
            "validation":
                result["validation"]
        }), 200

    except ValueError as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 422

    except OCRConfigError as e:

        return jsonify({
            "success": False,
            "code": "OCR_NOT_CONFIGURED",
            "message": str(e)
        }), 503

    except AuthenticationError as e:
        print("Groq từ chối API key:", repr(e))

        return jsonify({
            "success": False,
            "code": "GROQ_AUTH",
            "message": "GROQ_API_KEY không hợp lệ hoặc đã bị thu hồi."
        }), 503

    except APIConnectionError as e:
        print("Không kết nối được Groq:", repr(e))

        return jsonify({
            "success": False,
            "code": "GROQ_UNREACHABLE",
            "message": "Không kết nối được dịch vụ OCR. Kiểm tra mạng và thử lại."
        }), 503

    except BadRequestError as e:
        print("Groq từ chối yêu cầu:", repr(e))

        return jsonify({
            "success": False,
            "code": "GROQ_BAD_REQUEST",
            "message": (
                "Dịch vụ OCR từ chối yêu cầu (ảnh quá lớn hoặc model "
                "không hỗ trợ). Kiểm tra GROQ_VISION_MODEL."
            )
        }), 502

    except RateLimitError as e:
        print("Groq hết hạn mức OCR:", repr(e))

        return jsonify({
            "success": False,
            "code": "GROQ_RATE_LIMIT",
            "message": (
                "Groq đã hết hạn mức xử lý OCR. "
                "Vui lòng thử lại sau."
            )
        }), 429

    except Exception as e:
        print("Lỗi API OCR CCCD:", repr(e))

        return jsonify({
            "success": False,
            "message": "Có lỗi xảy ra khi đọc thông tin CCCD"
        }), 500


# ============================================================
# FILE TOO LARGE
# ============================================================

@app.errorhandler(413)
def file_too_large(_error):

    return jsonify({
        "success": False,
        "message":
            "File ảnh quá lớn. Giới hạn 10MB."
    }), 413


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    # Mặc định chỉ nghe localhost và tắt debug: Werkzeug debugger
    # mở ra mạng LAN cho phép chạy code từ xa.
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_PORT", "8000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1"
    )