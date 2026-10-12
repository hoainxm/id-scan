from flask import Flask, request, jsonify
from flask_cors import CORS

from services.portrait_service import (
    crop_portrait_from_bytes
)

# ============================================================
# GROQ OCR
# ============================================================

from services.groq_cccd import extract_cccd

from groq import RateLimitError


# ============================================================
# FLASK
# ============================================================

app = Flask(__name__)

CORS(app)


# ============================================================
# CONFIG
# ============================================================

MAX_CONTENT_LENGTH = 10 * 1024 * 1024

app.config[
    "MAX_CONTENT_LENGTH"
] = MAX_CONTENT_LENGTH


ALLOWED_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg"
}


# ============================================================
# CHECK FILE
# ============================================================

def allowed_file(filename):

    return (
        "."
        in filename
        and
        filename.rsplit(
            ".",
            1
        )[1].lower()
        in ALLOWED_EXTENSIONS
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
        # Kiểm tra định dạng
        # ----------------------------------------------------

        if not allowed_file(
            file.filename
        ):

            return jsonify({
                "success": False,
                "message":
                    "Chỉ chấp nhận PNG, JPG, JPEG"
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
                result["crop"]
        }), 200

    except ValueError as e:

        return jsonify({
            "success": False,
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
        # KIỂM TRA ĐỊNH DẠNG
        # ----------------------------------------------------

        if not allowed_file(
            front_file.filename
        ):

            return jsonify({
                "success": False,
                "message":
                    "Ảnh mặt trước chỉ chấp nhận PNG, JPG, JPEG"
            }), 400

        if not allowed_file(
            back_file.filename
        ):

            return jsonify({
                "success": False,
                "message":
                    "Ảnh mặt sau chỉ chấp nhận PNG, JPG, JPEG"
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
        # GỌI GROQ VISION
        # ----------------------------------------------------

        result = extract_cccd(
            front_bytes,
            back_bytes
        )

        # ----------------------------------------------------
        # TRẢ KẾT QUẢ
        # ----------------------------------------------------

        return jsonify({
            "success": True,
            "message":
                "Đã đọc thông tin CCCD thành công",
            "data":
                result
        }), 200

    except ValueError as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 422

    

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

    except ValueError as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 422

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

    app.run(
        host="0.0.0.0",
        port=8000,
        debug=True
    )