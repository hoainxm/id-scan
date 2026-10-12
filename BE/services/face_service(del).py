"""
face_service.py
----------------
Module xử lý: nhận ảnh CCCD/CMND mặt trước -> phát hiện khuôn mặt -> cắt ra
vùng chân dung (có đệm thêm cho tóc/cằm) -> trả về ảnh PNG dạng base64.

Dùng Haar Cascade có sẵn trong OpenCV (chạy hoàn toàn local, không cần tải
model, không cần internet) để phát hiện khuôn mặt. Đây là bước "quét chân
dung" đầu tiên theo yêu cầu. Sau này nếu cần độ chính xác cao hơn (ảnh mờ,
nghiêng, nhiều khuôn mặt phụ trên nền hoa văn CCCD...), có thể thay thế bằng
model YOLO-face mà không cần đổi API bên ngoài (chỉ sửa hàm detect_largest_face).
"""

import base64
import io
from dataclasses import dataclass, field
from typing import Optional, Tuple

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Cấu hình
# ---------------------------------------------------------------------------

# Dùng 2 cascade: alt2 (chính xác hơn) và default (dự phòng) để tăng khả năng bắt được mặt
_CASCADE_FILES = [
    "haarcascade_frontalface_alt2.xml",
    "haarcascade_frontalface_default.xml",
]

_cascades = []
for _name in _CASCADE_FILES:
    _path = cv2.data.haarcascades + _name
    _clf = cv2.CascadeClassifier(_path)
    if not _clf.empty():
        _cascades.append(_clf)

if not _cascades:
    raise RuntimeError("Không tải được cascade phát hiện khuôn mặt của OpenCV.")

OUTPUT_SIZE = 400          # kích thước ảnh chân dung đầu ra (px, ảnh vuông)
EXPAND_RATIO = 0.35        # nới rộng khung mặt sang 2 bên (tỉ lệ theo chiều rộng mặt)
TOP_EXTRA_RATIO = 0.55     # nới thêm phía trên (để lấy trọn tóc/trán)
BOTTOM_EXTRA_RATIO = 0.45  # nới thêm phía dưới (để lấy cằm/cổ áo)


@dataclass
class PortraitResult:
    success: bool
    face_detected: bool
    image_base64: Optional[str] = None
    message: str = ""
    box: Optional[Tuple[int, int, int, int]] = field(default=None)  # (x, y, w, h) khung mặt gốc đã dùng


# ---------------------------------------------------------------------------
# Các bước xử lý
# ---------------------------------------------------------------------------

def decode_image(file_bytes: bytes) -> np.ndarray:
    """Giải mã bytes ảnh (jpg/png...) thành ảnh OpenCV (BGR). Ném ValueError nếu ảnh hỏng."""
    if not file_bytes:
        raise ValueError("File ảnh rỗng.")
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Không đọc được ảnh. File có thể bị hỏng hoặc không đúng định dạng.")
    return img


def detect_largest_face(img_bgr: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """Trả về khung (x, y, w, h) của khuôn mặt lớn nhất tìm được, hoặc None nếu không thấy."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)  # tăng tương phản, giúp nhận diện tốt hơn trên ảnh chụp CCCD

    h_img, w_img = gray.shape[:2]
    min_size = max(30, int(min(h_img, w_img) * 0.08))

    best_box = None
    best_area = 0

    for cascade in _cascades:
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.08,
            minNeighbors=6,
            minSize=(min_size, min_size),
        )
        for (x, y, w, h) in faces:
            area = w * h
            if area > best_area:
                best_area = area
                best_box = (int(x), int(y), int(w), int(h))
        if best_box is not None:
            break  # cascade đầu tiên đã tìm thấy thì không cần thử cascade dự phòng

    return best_box


def crop_portrait(img_bgr: np.ndarray, box: Tuple[int, int, int, int]) -> np.ndarray:
    """Cắt vùng chân dung quanh khung mặt, có đệm thêm, rồi resize về ảnh vuông OUTPUT_SIZE."""
    img_h, img_w = img_bgr.shape[:2]
    x, y, w, h = box

    pad_x = w * EXPAND_RATIO
    top_pad = h * TOP_EXTRA_RATIO
    bottom_pad = h * BOTTOM_EXTRA_RATIO

    x1 = x - pad_x
    x2 = x + w + pad_x
    y1 = y - top_pad
    y2 = y + h + bottom_pad

    # Làm cho khung cắt thành hình vuông, canh giữa theo khung hiện tại
    box_w = x2 - x1
    box_h = y2 - y1
    side = max(box_w, box_h)
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    x1, x2 = cx - side / 2, cx + side / 2
    y1, y2 = cy - side / 2, cy + side / 2

    # Giới hạn trong biên ảnh gốc
    x1 = max(0, int(round(x1)))
    y1 = max(0, int(round(y1)))
    x2 = min(img_w, int(round(x2)))
    y2 = min(img_h, int(round(y2)))

    if x2 <= x1 or y2 <= y1:
        # trường hợp hi hữu khung tính ra rỗng -> dùng lại khung mặt gốc
        x1, y1, x2, y2 = x, y, x + w, y + h

    cropped = img_bgr[y1:y2, x1:x2]
    resized = cv2.resize(cropped, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_AREA)
    return resized


def center_crop_fallback(img_bgr: np.ndarray) -> np.ndarray:
    """Khi không tìm thấy khuôn mặt: cắt vuông ở giữa ảnh làm phương án dự phòng."""
    h, w = img_bgr.shape[:2]
    side = min(h, w)
    x1 = (w - side) // 2
    y1 = (h - side) // 2
    cropped = img_bgr[y1:y1 + side, x1:x1 + side]
    return cv2.resize(cropped, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_AREA)


def encode_to_base64_png(img_bgr: np.ndarray) -> str:
    success, buf = cv2.imencode(".png", img_bgr)
    if not success:
        raise ValueError("Không mã hóa được ảnh kết quả.")
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


# ---------------------------------------------------------------------------
# Hàm chính, dùng bởi app.py
# ---------------------------------------------------------------------------

def extract_portrait(file_bytes: bytes) -> PortraitResult:
    """
    Nhận bytes ảnh CCCD/CMND mặt trước -> trả PortraitResult chứa ảnh chân dung base64.
    Không ném exception ra ngoài; mọi lỗi được gói vào PortraitResult.success = False.
    """
    try:
        img = decode_image(file_bytes)
    except ValueError as e:
        return PortraitResult(success=False, face_detected=False, message=str(e))

    box = detect_largest_face(img)

    if box is not None:
        try:
            cropped = crop_portrait(img, box)
        except Exception as e:  # phòng hờ lỗi tính toán khung ảnh
            return PortraitResult(success=False, face_detected=False, message=f"Lỗi khi cắt ảnh: {e}")
        image_b64 = encode_to_base64_png(cropped)
        return PortraitResult(
            success=True,
            face_detected=True,
            image_base64=image_b64,
            message="Đã phát hiện và cắt chân dung thành công.",
            box=box,
        )

    # Không tìm thấy khuôn mặt -> vẫn trả ảnh (cắt giữa) để FE có cái hiển thị tạm,
    # nhưng báo rõ face_detected = False để FE có thể cảnh báo người dùng.
    fallback = center_crop_fallback(img)
    image_b64 = encode_to_base64_png(fallback)
    return PortraitResult(
        success=True,
        face_detected=False,
        image_base64=image_b64,
        message="Không phát hiện được khuôn mặt rõ ràng trong ảnh. Đã dùng ảnh cắt giữa tạm thời.",
    )
