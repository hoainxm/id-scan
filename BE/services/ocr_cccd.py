"""
Đọc thông tin CCCD bằng model đọc ảnh (vision LLM) qua nhiều nhà cung cấp, rồi kiểm chứng local.

Thứ tự dùng nhà cung cấp lấy từ OCR_PROVIDERS (mặc định "openai,groq"); nhà cung cấp
chưa có API key thì bỏ qua. Khi nhà cung cấp trước lỗi (hết hạn mức, quá tải, sai key,
mất kết nối, trả kết quả hỏng) thì tự chuyển sang nhà cung cấp kế tiếp trong cùng yêu cầu.
"""

import os
import json
import base64
import logging
from typing import Any

import cv2
import groq
import numpy as np
import openai
from dotenv import load_dotenv

from services.cccd_verify import read_qr, verify_ocr_result


# ============================================================
# CONFIGURATION
# ============================================================

# Nạp .env từ thư mục backend, không phụ thuộc thư mục đang chạy lệnh.
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(BASE_DIR, ".env"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OCRConfigError(RuntimeError):
    """Chưa cấu hình API key OCR nào. App trả 503 thay vì sập cả server."""


class OCRProviderError(RuntimeError):
    """Lỗi từ nhà cung cấp OCR, đã quy về mã chung để app trả HTTP status phù hợp."""

    def __init__(self, code: str, message: str, provider: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.provider = provider


PROVIDERS = {
    "openai": {
        "label": "OpenAI",
        "key_env": "OPENAI_API_KEY",
        "model_env": "OPENAI_VISION_MODEL",
        "default_model": "gpt-5.6-luna",
        "sdk": openai,
    },
    "groq": {
        "label": "Groq",
        "key_env": "GROQ_API_KEY",
        "model_env": "GROQ_VISION_MODEL",
        "default_model": "qwen/qwen3.8-27b",
        "sdk": groq,
    },
}

# OpenAI tính token ảnh theo độ phân giải; "high" cần để đọc rõ chữ có dấu.
OPENAI_IMAGE_DETAIL = os.getenv("OPENAI_IMAGE_DETAIL", "high")

# Model suy luận (gpt-5*, o*) không nhận temperature; mức suy luận thấp để tiết kiệm.
# gpt-5.6-luna không nhận "minimal" (đã thử, bị từ chối), nên mặc định "low".
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "low")

_clients = {}


def provider_order() -> list:
    names = os.getenv("OCR_PROVIDERS", "openai,groq").split(",")
    return [n.strip().lower() for n in names if n.strip().lower() in PROVIDERS]


def configured_providers() -> list:
    return [p for p in provider_order() if os.getenv(PROVIDERS[p]["key_env"])]


def model_for(provider: str) -> str:
    info = PROVIDERS[provider]
    return os.getenv(info["model_env"]) or info["default_model"]


def _get_client(provider: str):
    """Khởi tạo client khi cần, để API chân dung vẫn chạy khi chưa có key."""
    if provider not in _clients:
        info = PROVIDERS[provider]
        api_key = os.getenv(info["key_env"])
        if not api_key:
            raise OCRConfigError(f"Chưa cấu hình {info['key_env']}.")
        # Thử lại 1 lần cho lỗi thoáng qua; lỗi kéo dài thì chuyển nhà cung cấp.
        client_cls = openai.OpenAI if provider == "openai" else groq.Groq
        _clients[provider] = client_cls(api_key=api_key, max_retries=1, timeout=90)
    return _clients[provider]


def _is_reasoning_model(model: str) -> bool:
    return model.startswith(("gpt-5", "o1", "o3", "o4"))


# ============================================================
# IMAGE HELPERS
# ============================================================

def _detect_mime_type(image_bytes: bytes) -> str:
    """Nhận diện MIME từ chữ ký ảnh phổ biến."""
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    # Dùng JPEG làm mặc định tương thích với đầu vào JPG/JPEG.
    return "image/jpeg"


def image_to_data_url(image_bytes: bytes, mime_type: str | None = None) -> str:
    """Chuyển bytes ảnh thành data URL để gửi tới model đọc ảnh."""
    if not image_bytes:
        raise ValueError("Dữ liệu ảnh CCCD đang rỗng.")

    detected_mime = mime_type or _detect_mime_type(image_bytes)
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{detected_mime};base64,{encoded}"


# Ảnh điện thoại 3-5MB vượt giới hạn ảnh base64 của nhà cung cấp và làm OCR chậm.
# 2000px cạnh dài vẫn đủ nét để đọc MRZ khi thẻ chiếm phần nhỏ khung hình.
LLM_MAX_SIDE = 2000
LLM_MAX_BYTES = 1_500_000


def prepare_image_for_llm(image_bytes: bytes) -> bytes:
    """Giải mã (xoay theo EXIF), thu nhỏ nếu quá lớn, nén lại JPEG."""
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Không đọc được ảnh CCCD. Hãy dùng ảnh JPG hoặc PNG.")

    h, w = image.shape[:2]
    scale = LLM_MAX_SIDE / max(h, w)
    if scale < 1:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    for quality in (90, 80, 70):
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok and len(encoded) <= LLM_MAX_BYTES:
            break
    if not ok:
        raise ValueError("Không thể nén ảnh CCCD.")
    return encoded.tobytes()


# ============================================================
# JSON SCHEMA
# ============================================================

CCCD_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "cardType": {"type": "string", "enum": ["old", "new", "unknown"]},
        "mrz": {"type": "string"},
        "soGiayTo": {"type": "string"},
        "hoDem": {"type": "string"},
        "ten": {"type": "string"},
        "hoTen": {"type": "string"},
        "ngaySinh": {"type": "string"},
        "gioiTinh": {"type": "string"},
        "quocTich": {"type": "string"},
        "danToc": {"type": "string"},
        "nguyenQuan": {"type": "string"},
        "noiSinh": {"type": "string"},
        "noiCapGiayTo": {"type": "string"},
        "ngayCap": {"type": "string"},
        "ngayHetHan": {"type": "string"},
        "HKTT": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "quocGia": {"type": "string"},
                "tinh": {"type": "string"},
                "quanHuyen": {"type": "string"},
                "phuongXa": {"type": "string"},
                "soNha": {"type": "string"},
                "diaChiGoc": {"type": "string"},
            },
            "required": [
                "quocGia",
                "tinh",
                "quanHuyen",
                "phuongXa",
                "soNha",
                "diaChiGoc",
            ],
        },
    },
    "required": [
        "cardType",
        "mrz",
        "soGiayTo",
        "hoDem",
        "ten",
        "hoTen",
        "ngaySinh",
        "gioiTinh",
        "quocTich",
        "danToc",
        "nguyenQuan",
        "noiSinh",
        "noiCapGiayTo",
        "ngayCap",
        "ngayHetHan",
        "HKTT",
    ],
}


# ============================================================
# OCR PROMPT
# ============================================================



OCR_PROMPT = """
Bạn là hệ thống OCR chuyên đọc CCCD và thẻ căn cước Việt Nam.
Đọc cả hai ảnh do người dùng gửi: ảnh mặt trước và ảnh mặt sau.

Chỉ trả về một JSON object đúng schema đã cung cấp.
Không trả Markdown, không thêm giải thích.

I. NHẬN DIỆN LOẠI THẺ VÀ VỊ TRÍ ĐỊA CHỈ

1. Kiểm tra riêng từng ảnh để xác định mặt trước và mặt sau.
2. CCCD cũ thường có thông tin "Nơi thường trú" ở mặt trước.
3. Thẻ căn cước/CCCD gắn chip mới thường có thông tin
   "Nơi cư trú / Place of residence" ở mặt sau.
4. Đây chỉ là dấu hiệu nhận biết, không phải điều kiện tuyệt đối.
5. Không phân loại chỉ dựa vào số định danh 9 hay 12 chữ số.
6. Ưu tiên nhãn thực tế nhìn thấy trên ảnh.
7. Nếu không tìm thấy địa chỉ ở mặt thường được dự đoán,
   hãy kiểm tra ảnh còn lại trước khi kết luận địa chỉ không có.
8. Không lấy thông tin từ ảnh này để thay thế trường khác
   khi chưa xác định được nhãn tương ứng.
9. Nếu không đọc được, trả chuỗi rỗng "".
10. cardType:
    - "old": thẻ có nhãn "Nơi thường trú / Place of residence"
      (CCCD mẫu 2016 hoặc CCCD gắn chip 2021, tiêu đề "CĂN CƯỚC CÔNG DÂN").
    - "new": thẻ có nhãn "Nơi cư trú / Place of residence"
      (Thẻ căn cước mẫu 2024, tiêu đề "CĂN CƯỚC").
    - "unknown": không xác định được.
11. mrz: chép NGUYÊN VĂN 3 dòng mã MRZ ở mặt sau (dòng bắt đầu bằng "IDVNM"),
    mỗi dòng đúng 30 ký tự gồm chữ in hoa, số và "<",
    các dòng cách nhau bằng ký tự xuống dòng "\\n".
    Không sửa, không suy luận; đếm đủ ký tự "<". Không có MRZ thì trả "".

II. NGUYÊN TẮC CHUNG

1. Đọc trực tiếp nội dung nhìn thấy trên ảnh.
2. Không suy đoán, không bịa và không tự sửa tên riêng.
3. Giữ nguyên tiếng Việt có dấu, địa danh và thứ tự chữ.
4. Không đổi địa giới hành chính cũ sang mới.
5. Tất cả giá trị phải là chuỗi, không dùng null.
6. Ngày tháng rõ ràng thì chuẩn hóa DD/MM/YYYY.
7. Phân biệt nhãn trường với nội dung của trường.
8. Không dùng ví dụ trong prompt làm dữ liệu mặc định.

III. THÔNG TIN CÁ NHÂN

Đọc chính xác:
- soGiayTo: số định danh cá nhân/số căn cước.
- hoTen: toàn bộ họ tên.
- hoDem: họ và tên đệm, không gồm tên cuối.
- ten: tên cuối.
- ngaySinh: ngày sinh.
- gioiTinh: giới tính.
- quocTich: quốc tịch.
- danToc: dân tộc nếu có.
- nguyenQuan: nội dung tại nhãn
  "Nơi đăng ký khai sinh / Place of birth" nếu có.
- noiSinh: chỉ đọc trường nơi sinh nếu có nhãn riêng.
- noiCapGiayTo: cơ quan/nơi cấp.
- ngayCap: ngày cấp.
  + CCCD gắn chip 2021: ở MẶT SAU, nhãn "Ngày, tháng, năm / Date, month, year"
    (ngay trên dòng "CỤC TRƯỞNG CỤC CẢNH SÁT...").
  + Thẻ căn cước 2024: ở mặt sau, nhãn "Ngày, tháng, năm cấp / Date of issue".
- ngayHetHan: ngày hết hạn.

QUAN TRỌNG VỀ NGUYÊN QUÁN:
- Kiểm tra cả hai ảnh để tìm đúng nhãn
  "Nơi đăng ký khai sinh / Place of birth".
- Không nhầm nhãn này với "Nơi cư trú / Place of residence".
- Không lấy địa chỉ cư trú để điền nguyên quán.
- Không tự suy ra nguyên quán từ HKTT.
- Nếu nhãn không có hoặc không đọc được, trả "".

IV. HỌ TÊN

Giữ nguyên thứ tự họ tên trên thẻ.
Ví dụ minh họa "NGUYỄN VĂN AN":
hoTen = "NGUYỄN VĂN AN"
hoDem = "NGUYỄN VĂN"
ten = "AN"

V. ĐỊA CHỈ NƠI CƯ TRÚ / HKTT

Chỉ lấy địa chỉ theo nhãn thực tế trên thẻ:
- "Nơi thường trú" trên thẻ cũ nếu nhãn này xuất hiện.
- "Nơi cư trú / Place of residence" trên thẻ mới nếu nhãn này xuất hiện.

Không mặc định địa chỉ luôn nằm ở mặt trước hoặc mặt sau.
Hãy kiểm tra cả hai ảnh, tìm nhãn địa chỉ rồi mới trích xuất.

1. HKTT.diaChiGoc:
   Giữ toàn bộ địa chỉ đúng thứ tự trên thẻ.
   Chỉ chuẩn hóa khoảng trắng thừa.
2. HKTT.tinh:
   Chỉ điền tỉnh/thành cấp tỉnh khi có căn cứ rõ ràng.
3. HKTT.quanHuyen:
   Chỉ điền huyện/quận/thành phố thuộc tỉnh nếu có căn cứ.
   Nếu không có hoặc không chắc chắn, để rỗng.
4. HKTT.phuongXa:
   Chỉ điền phường/xã/thị trấn khi đọc được rõ ràng.
5. HKTT.soNha:
   Giữ phần địa chỉ chi tiết như số nhà, đường, xóm, thôn,
   ấp, tổ hoặc khu phố nếu đọc được.
   Không nhầm xóm/thôn với xã/phường.
6. Không tự đổi "Thị Tứ" thành "Thị Tư" hoặc ngược lại.
7. Nếu không chắc cách tách địa chỉ:
   - Giữ nguyên toàn bộ địa chỉ trong diaChiGoc.
   - Chỉ điền thành phần có căn cứ rõ ràng.
   - Không tự tạo thêm thành phần hành chính.
8. HKTT.quocGia:
   Chỉ điền khi có căn cứ; nếu không chắc thì để rỗng.
9. Không lấy nguyên quán, nơi sinh hoặc nơi cấp làm HKTT.
10. Không tự chuyển địa chỉ sang địa giới hành chính mới.
11. QUY TẮC XỬ LÝ ĐỊA CHỈ TRÊN CCCD CŨ:
- Địa chỉ trên CCCD cũ có thể sử dụng địa giới hành chính trước khi sắp xếp đơn vị hành chính.
- Không bắt buộc địa chỉ phải có đủ tỉnh, huyện, xã.
- Đọc địa chỉ theo đúng thứ tự và cách viết trên thẻ, không tự suy luận cấp hành chính chỉ dựa vào tên địa danh.
- Phải phân biệt phần địa chỉ chi tiết như số nhà, đường, xóm, thôn, tổ dân phố với tên phường/xã và quận/huyện.
- Không tự động coi thành phần đứng trước tên tỉnh là quận/huyện.
- Nếu không xác định chắc chắn được một thành phần hành chính, giữ nguyên địa chỉ trong HKTT.diaChiGoc và để trường thành phần đó là chuỗi rỗng.
- Không được làm mất bất kỳ phần nào của địa chỉ gốc khi tách thành các trường.
- Không dùng thông tin của một CCCD khác làm căn cứ điền địa chỉ.

VI. KIỂM TRA CUỐI

- Đối chiếu nguyên quán với đúng nhãn nơi đăng ký khai sinh.
- Đối chiếu HKTT với đúng nhãn địa chỉ cư trú.
- Kiểm tra không nhầm tỉnh với huyện.
- Kiểm tra không nhầm xóm/thôn với xã/phường.
- Giữ nguyên tên địa danh; không tự sửa chữ khi không chắc.
- Nếu không đọc được thành phần nào, trả chuỗi rỗng.
- Chỉ trả về JSON đúng schema.
"""




# ============================================================
# NORMALIZATION
# ============================================================

TEXT_FIELDS = [
    "soGiayTo",
    "hoDem",
    "ten",
    "hoTen",
    "ngaySinh",
    "gioiTinh",
    "quocTich",
    "danToc",
    "nguyenQuan",
    "noiSinh",
    "noiCapGiayTo",
    "ngayCap",
    "ngayHetHan",
]


def _as_string(value: Any) -> str:
    """Đảm bảo giá trị là chuỗi, không biến None thành 'None'."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value).strip()
    return ""



def _normalize_result(data: dict) -> dict:
    """Chuẩn hóa OCR, không suy đoán địa chỉ còn thiếu."""
    result = {
        field: _as_string(data.get(field, ""))
        for field in TEXT_FIELDS
    }

    card_type = _as_string(data.get("cardType", "")).lower()
    result["cardType"] = card_type if card_type in ("old", "new") else "unknown"

    hktt = data.get("HKTT", {})
    if not isinstance(hktt, dict):
        hktt = {}

    address = {
        "quocGia": _as_string(hktt.get("quocGia", "")),
        "tinh": _as_string(hktt.get("tinh", "")),
        "quanHuyen": _as_string(hktt.get("quanHuyen", "")),
        "phuongXa": _as_string(hktt.get("phuongXa", "")),
        "soNha": _as_string(hktt.get("soNha", "")),
        "diaChiGoc": _as_string(hktt.get("diaChiGoc", "")),
    }

    # Tránh ghi tên tỉnh vào cả trường tỉnh và huyện.
    def normalize_name(value: str) -> str:
        import unicodedata

        value = unicodedata.normalize("NFC", value or "")
        value = " ".join(value.casefold().split())
        return value

    if (
        address["tinh"]
        and address["quanHuyen"]
        and normalize_name(address["tinh"])
        == normalize_name(address["quanHuyen"])
    ):
        address["quanHuyen"] = ""

    # Nếu OCR chưa tách được địa chỉ, vẫn giữ chuỗi gốc.
    if not address["diaChiGoc"]:
        address["diaChiGoc"] = ", ".join(
            part
            for part in (
                address["soNha"],
                address["phuongXa"],
                address["quanHuyen"],
                address["tinh"],
            )
            if part
        )

    result["HKTT"] = address

    # Không lấy HKTT hoặc nơi sinh để tự điền nguyên quán.
    # Giữ nguyên giá trị OCR trả về.
    result["nguyenQuan"] = _as_string(data.get("nguyenQuan", ""))

    # Chỉ tách họ tên khi có họ tên nhưng thiếu trường ten.
    if result["hoTen"] and not result["ten"]:
        name_parts = result["hoTen"].split()
        if len(name_parts) >= 2:
            result["ten"] = name_parts[-1]
            result["hoDem"] = " ".join(name_parts[:-1])

    return result



# ============================================================
# GỌI MODEL ĐỌC ẢNH
# ============================================================

SYSTEM_PROMPT = (
    "Bạn là hệ thống OCR tài liệu CCCD Việt Nam. "
    "Đọc chính xác chữ nhìn thấy trong ảnh. "
    "Phân biệt mặt trước và mặt sau. "
    "Không suy đoán hoặc tự điền thông tin còn thiếu. "
    "Chỉ trả về JSON đúng schema được cung cấp."
)


def _build_messages(provider: str, front_image: str, back_image: str) -> list:
    def image_part(url):
        image = {"url": url}
        if provider == "openai":
            image["detail"] = OPENAI_IMAGE_DETAIL
        return {"type": "image_url", "image_url": image}

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        OCR_PROMPT
                        + "\n\nẢNH 1 là mặt trước CCCD. "
                        "Hãy đọc các trường xuất hiện trên mặt trước, "
                        "bao gồm số giấy tờ, họ tên, ngày sinh, "
                        "giới tính, quốc tịch, quê quán và nơi cư trú "
                        "nếu những trường đó xuất hiện."
                    ),
                },
                image_part(front_image),
                {
                    "type": "text",
                    "text": (
                        "ẢNH 2 là mặt sau CCCD. "
                        "Kiểm tra xem mặt sau có thông tin cần trích xuất "
                        "hay không. Chỉ sử dụng nội dung thực sự nhìn thấy. "
                        "Không lấy nội dung của trường này thay cho trường khác."
                    ),
                },
                image_part(back_image),
            ],
        },
    ]


def _error_code(sdk, error) -> str:
    if isinstance(error, sdk.RateLimitError):
        return "RATE_LIMIT"
    if isinstance(error, (sdk.AuthenticationError, sdk.PermissionDeniedError)):
        return "AUTH"
    if isinstance(error, sdk.APIConnectionError):
        return "UNREACHABLE"
    if isinstance(error, sdk.InternalServerError):
        return "UNAVAILABLE"
    if isinstance(error, (sdk.BadRequestError, sdk.NotFoundError)):
        return "BAD_REQUEST"
    return "UNAVAILABLE"


def _error_message(provider: str, code: str) -> str:
    info = PROVIDERS[provider]
    label = info["label"]
    return {
        "RATE_LIMIT": f"{label} đã hết hạn mức",
        "AUTH": f"{info['key_env']} không hợp lệ hoặc hết quyền",
        "UNREACHABLE": f"không kết nối được {label}",
        "UNAVAILABLE": f"{label} đang quá tải",
        "BAD_REQUEST": f"{label} từ chối yêu cầu (kiểm tra {info['model_env']})",
        "BAD_RESPONSE": f"{label} trả kết quả không hợp lệ",
    }[code]


def _call_provider(provider: str, front_image: str, back_image: str):
    """Gọi 1 nhà cung cấp. Trả (dict kết quả, usage). Lỗi quy về OCRProviderError."""
    info = PROVIDERS[provider]
    sdk = info["sdk"]
    model = model_for(provider)

    kwargs = {
        "model": model,
        "messages": _build_messages(provider, front_image, back_image),
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "cccd", "strict": True, "schema": CCCD_SCHEMA},
        },
    }
    if provider == "openai" and _is_reasoning_model(model):
        # Token suy luận cũng tính vào giới hạn này.
        kwargs["reasoning_effort"] = OPENAI_REASONING_EFFORT
        kwargs["max_completion_tokens"] = 4000
    else:
        kwargs["temperature"] = 0
        kwargs["max_completion_tokens"] = 1200

    try:
        response = _get_client(provider).chat.completions.create(**kwargs)
    except sdk.APIError as error:
        code = _error_code(sdk, error)
        logger.warning("OCR %s/%s lỗi %s: %s", provider, model, code, type(error).__name__)
        raise OCRProviderError(code, _error_message(provider, code), provider) from error

    content = response.choices[0].message.content
    try:
        data = json.loads(content or "")
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        logger.warning("OCR %s/%s trả JSON không hợp lệ", provider, model)
        raise OCRProviderError("BAD_RESPONSE", _error_message(provider, "BAD_RESPONSE"), provider)

    usage = getattr(response, "usage", None)
    return data, {
        "inputTokens": getattr(usage, "prompt_tokens", None),
        "outputTokens": getattr(usage, "completion_tokens", None),
    }


def extract_cccd(front_bytes: bytes, back_bytes: bytes) -> dict:
    """
    Nhận bytes ảnh CCCD hai mặt, đọc bằng model đọc ảnh rồi kiểm chứng local.
    Trả { "data", "validation", "engine": nhà cung cấp/model/token đã dùng }.
    """
    if not front_bytes:
        raise ValueError("Chưa có ảnh mặt trước CCCD.")
    if not back_bytes:
        raise ValueError("Chưa có ảnh mặt sau CCCD.")

    providers = configured_providers()
    if not providers:
        raise OCRConfigError(
            "Chưa cấu hình API key đọc ảnh (OPENAI_API_KEY hoặc GROQ_API_KEY). "
            "Hãy thêm vào BE/.env (xem BE/.env.example)."
        )

    # QR đọc trên ảnh gốc (độ phân giải cao nhất), trước khi nén gửi đi.
    qr = read_qr([front_bytes, back_bytes])

    front_image = image_to_data_url(prepare_image_for_llm(front_bytes))
    back_image = image_to_data_url(prepare_image_for_llm(back_bytes))

    errors = []
    for provider in providers:
        try:
            data, usage = _call_provider(provider, front_image, back_image)
        except OCRProviderError as error:
            errors.append(error)
            continue

        verified = verify_ocr_result(
            _normalize_result(data),
            qr=qr,
            mrz_text=_as_string(data.get("mrz", "")),
        )
        verified["engine"] = {
            "provider": provider,
            "model": model_for(provider),
            "fallback": provider != providers[0],
            **usage,
        }

        # Không ghi log ảnh hoặc thông tin cá nhân, chỉ ghi trạng thái.
        logger.info(
            "OCR hoàn tất bằng %s/%s (%s+%s token); QR: %s; MRZ: %s; số trường cần kiểm tra: %d",
            provider,
            model_for(provider),
            usage["inputTokens"],
            usage["outputTokens"],
            verified["validation"]["sources"]["qr"],
            verified["validation"]["sources"]["mrz"],
            len(verified["validation"]["needsReview"]),
        )
        return verified

    # Mọi nhà cung cấp đều lỗi: trả lỗi của nhà cung cấp cuối, kèm lý do từng nơi.
    detail = "; ".join(e.message for e in errors)
    raise OCRProviderError(errors[-1].code, f"Không đọc được thông tin CCCD: {detail}.")
