import os
import cv2
import base64
import threading
import numpy as np


# =========================================================
# YOLO MODEL (ONNX, chạy bằng cv2.dnn)
# =========================================================

# Dùng bản ONNX thay vì ultralytics + PyTorch: image Docker nhỏ hơn ~700MB
# và vừa RAM 512MB của Render gói free. yolo11n.onnx được export từ
# yolo11n.pt bằng tools/export_yolo_onnx.py; kết quả đã đối chiếu với
# ultralytics trên 10 ảnh mẫu: cùng quyết định 10/10, khung lệch <= 6px.
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL_PATH = os.path.join(BASE_DIR, "yolo11n.onnx")

YOLO_INPUT = 640

# Cạnh dài của ảnh dùng để dò người/mặt (đo RAM + độ chính xác: xem README)
DETECT_LONG_SIDE = 1280

# Cạnh dài khi phải quét Haar toàn ảnh (không thấy người)
FALLBACK_LONG_SIDE = 960
PERSON_CONF = 0.20
PERSON_IOU = 0.45

_model = None

# Mỗi lần chỉ xử lý 1 ảnh: giữ RAM đỉnh ~350MB dù nhiều yêu cầu đến cùng lúc.
_crop_lock = threading.Lock()

# Giới hạn luồng nội bộ của OpenCV (Render free chỉ có 0.1 CPU).
if os.getenv("OPENCV_THREADS"):
    cv2.setNumThreads(int(os.getenv("OPENCV_THREADS")))


def get_model():
    global _model
    if _model is None:
        if not os.path.isfile(MODEL_PATH):
            raise RuntimeError(f"Không tìm thấy model YOLO tại {MODEL_PATH}")
        _model = cv2.dnn.readNetFromONNX(MODEL_PATH)
    return _model


NO_PORTRAIT_MESSAGE = (
    "Không tìm thấy ảnh chân dung. Hãy kiểm tra đã chọn đúng ảnh MẶT TRƯỚC "
    "của CCCD, ảnh rõ nét, đủ sáng và không bị lóa."
)


# =========================================================
# HÀM TÌM KHUÔN MẶT / PERSON
# =========================================================

def _letterbox(image):
    """Co ảnh về 640x640 giữ tỉ lệ, đệm màu xám 114 (giống ultralytics)."""
    h, w = image.shape[:2]
    ratio = min(YOLO_INPUT / h, YOLO_INPUT / w)
    new_w, new_h = round(w * ratio), round(h * ratio)

    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    left = (YOLO_INPUT - new_w) // 2
    top = (YOLO_INPUT - new_h) // 2

    canvas = np.full((YOLO_INPUT, YOLO_INPUT, 3), 114, dtype=np.uint8)
    canvas[top:top + new_h, left:left + new_w] = resized

    return canvas, ratio, left, top


def detect_person(image):
    """
    Dùng YOLO để tìm người trong ảnh.

    Lưu ý:
    yolo11n mặc định không có class "face".
    Vì vậy ở giai đoạn này YOLO sẽ tìm class person.

    Sau đó OpenCV sẽ tìm khuôn mặt bên trong vùng person.
    """

    canvas, ratio, left, top = _letterbox(image)

    blob = cv2.dnn.blobFromImage(
        canvas,
        1 / 255.0,
        (YOLO_INPUT, YOLO_INPUT),
        swapRB=True
    )

    net = get_model()
    net.setInput(blob)

    # Đầu ra (1, 84, 8400): 4 toạ độ (cx, cy, w, h) + điểm 80 class COCO
    predictions = net.forward()[0].T

    # COCO class 0 = person
    scores = predictions[:, 4]
    keep = scores >= PERSON_CONF

    if not keep.any():
        return None

    boxes = predictions[keep, :4]
    scores = scores[keep]

    # Đổi toạ độ từ ảnh 640x640 về ảnh gốc
    x = (boxes[:, 0] - boxes[:, 2] / 2 - left) / ratio
    y = (boxes[:, 1] - boxes[:, 3] / 2 - top) / ratio
    w = boxes[:, 2] / ratio
    h = boxes[:, 3] / ratio

    rects = np.stack([x, y, w, h], axis=1)

    indices = cv2.dnn.NMSBoxes(
        rects.tolist(),
        scores.tolist(),
        PERSON_CONF,
        PERSON_IOU
    )

    img_h, img_w = image.shape[:2]

    best_box = None
    best_area = 0

    for i in np.array(indices).flatten():
        bx, by, bw, bh = rects[i]

        x1 = int(max(0, bx))
        y1 = int(max(0, by))
        x2 = int(min(img_w, bx + bw))
        y2 = int(min(img_h, by + bh))

        area = (x2 - x1) * (y2 - y1)

        if area > best_area:
            best_area = area
            best_box = {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "confidence": float(scores[i])
            }

    return best_box


# =========================================================
# HAAR CASCADE FALLBACK
# =========================================================

FACE_CASCADE_PATH = (
    cv2.data.haarcascades
    + "haarcascade_frontalface_default.xml"
)

face_cascade = cv2.CascadeClassifier(
    FACE_CASCADE_PATH
)


EYE_CASCADE_PATH = (
    cv2.data.haarcascades
    + "haarcascade_eye_tree_eyeglasses.xml"
)

eye_cascade = cv2.CascadeClassifier(
    EYE_CASCADE_PATH
)


def _find_faces(image):
    """Danh sách khung mặt Haar, lớn nhất trước."""

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    gray = cv2.equalizeHist(gray)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.05,
        minNeighbors=3,
        minSize=(20, 20)
    )

    return sorted(
        (tuple(int(v) for v in face) for face in faces),
        key=lambda item: item[2] * item[3],
        reverse=True
    )


def _to_face_info(face):
    x, y, w, h = face
    return {"x": x, "y": y, "width": w, "height": h}


def _has_eye(image, face):
    """
    Xác nhận khung Haar là mặt người thật: phải thấy ít nhất 1 mắt
    ở nửa trên khung mặt. Haar trơn (minNeighbors=3) bắt nhầm vân tay,
    dải MRZ, chip ở mặt sau; các vùng đó không có mắt.
    """
    x, y, w, h = face
    roi = cv2.cvtColor(image[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY)
    upper = roi[: int(h * 0.65)]
    min_eye = max(8, w // 10)
    eyes = eye_cascade.detectMultiScale(
        upper,
        scaleFactor=1.1,
        minNeighbors=3,
        minSize=(min_eye, min_eye)
    )
    return len(eyes) > 0


def detect_face(image):
    """
    Tìm khuôn mặt lớn nhất bằng Haar Cascade (dùng trong vùng YOLO person).
    """

    faces = _find_faces(image)

    if not faces:
        return None

    return _to_face_info(faces[0])


def detect_face_with_eyes(image):
    """
    Fallback khi YOLO không thấy người: chỉ nhận khung Haar có mắt.
    """

    for face in _find_faces(image):
        if _has_eye(image, face):
            return _to_face_info(face)

    return None


# =========================================================
# CROP CHÂN DUNG
# =========================================================

def crop_portrait_from_bytes(file_bytes: bytes):

    with _crop_lock:
        return _crop_portrait(file_bytes)


def _crop_portrait(file_bytes: bytes):

    # -----------------------------------------------------
    # 1. Đọc ảnh
    # -----------------------------------------------------

    image_array = np.frombuffer(
        file_bytes,
        dtype=np.uint8
    )

    image = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR
    )

    if image is None:
        raise ValueError(
            "Không đọc được ảnh CCCD"
        )

    original_h, original_w = image.shape[:2]


    # -----------------------------------------------------
    # 2. Chuẩn hoá cạnh dài của ảnh dò tìm
    #
    # Trước đây phóng chiều rộng lên 1600px: ảnh dọc từ điện thoại
    # thành ~1600x2130 và Haar quét tháp ảnh rất lớn (~800MB RAM).
    # Chuẩn hoá theo cạnh dài giữ RAM thấp (Render free 512MB).
    # -----------------------------------------------------

    scale = DETECT_LONG_SIDE / max(original_w, original_h)

    if abs(scale - 1.0) < 0.01:

        scale = 1.0

        detect_image = image

    else:

        detect_image = cv2.resize(
            image,
            (int(original_w * scale), int(original_h * scale)),
            interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        )


    # -----------------------------------------------------
    # 3. YOLO tìm người
    # -----------------------------------------------------

    person = detect_person(
        detect_image
    )


    # -----------------------------------------------------
    # 4. Nếu YOLO tìm được person
    #    → tìm mặt bên trong vùng đó
    # -----------------------------------------------------

    if person is not None:

        px1 = person["x1"]
        py1 = person["y1"]
        px2 = person["x2"]
        py2 = person["y2"]

        person_crop = detect_image[
            py1:py2,
            px1:px2
        ]

        face = detect_face(
            person_crop
        )

        if face is not None:

            fx = face["x"]
            fy = face["y"]
            fw = face["width"]
            fh = face["height"]

            # Chuyển tọa độ về ảnh detect_image
            fx += px1
            fy += py1

            face_info = {
                "x": fx,
                "y": fy,
                "width": fw,
                "height": fh
            }

            detector = "yolo+haar"

        else:
            # Nếu YOLO tìm person nhưng Haar
            # không tìm được mặt
            face_info = None

    else:

        face_info = None


    # -----------------------------------------------------
    # 5. Fallback:
    #    tìm mặt trên toàn bộ ảnh, BẮT BUỘC thấy mắt
    #    (chặn ảnh mặt sau bị nhận nhầm là chân dung)
    # -----------------------------------------------------

    if face_info is None:

        # Quét Haar toàn ảnh tốn RAM theo diện tích ảnh: chạy ở cạnh dài
        # FALLBACK_LONG_SIDE (đo trên 10 ảnh mẫu: vẫn 10/10, RAM thêm 150 -> 91MB).
        fb_scale = min(1.0, FALLBACK_LONG_SIDE / max(detect_image.shape[:2]))

        fallback_image = detect_image if fb_scale == 1.0 else cv2.resize(
            detect_image,
            None,
            fx=fb_scale,
            fy=fb_scale,
            interpolation=cv2.INTER_AREA
        )

        face_info = detect_face_with_eyes(
            fallback_image
        )

        if face_info is not None and fb_scale != 1.0:
            face_info = {
                key: int(value / fb_scale)
                for key, value in face_info.items()
            }

        detector = "haar+eyes"


    # -----------------------------------------------------
    # 6. Nếu vẫn không tìm được
    # -----------------------------------------------------

    if face_info is None:

        raise ValueError(NO_PORTRAIT_MESSAGE)


    # -----------------------------------------------------
    # 7. Đưa tọa độ về ảnh gốc
    # -----------------------------------------------------

    x = face_info["x"]
    y = face_info["y"]
    w = face_info["width"]
    h = face_info["height"]

    if scale != 1.0:

        x = int(x / scale)
        y = int(y / scale)
        w = int(w / scale)
        h = int(h / scale)


    # -----------------------------------------------------
    # 8. Mở rộng vùng crop
    # -----------------------------------------------------

    # Ảnh thẻ trên CCCD rộng ~1.8 lần khung mặt Haar;
    # mở rộng 1.0w mỗi bên (như trước) bị dính chữ "Số/No." bên phải.
    left_expand = int(w * 0.38)
    right_expand = int(w * 0.38)

    top_expand = int(h * 0.6)
    bottom_expand = int(h * 0.75)

    x1 = max(
        0,
        x - left_expand
    )

    y1 = max(
        0,
        y - top_expand
    )

    x2 = min(
        original_w,
        x + w + right_expand
    )

    y2 = min(
        original_h,
        y + h + bottom_expand
    )


    # -----------------------------------------------------
    # 9. Crop
    # -----------------------------------------------------

    portrait = image[
        y1:y2,
        x1:x2
    ]


    if portrait.size == 0:

        raise ValueError(
            "Không crop được vùng chân dung"
        )


    # -----------------------------------------------------
    # 10. Chuẩn hóa tỷ lệ
    # -----------------------------------------------------

    target_ratio = 0.78

    ph, pw = portrait.shape[:2]

    current_ratio = pw / ph


    if current_ratio > target_ratio:

        new_width = int(
            ph * target_ratio
        )

        center_x = pw // 2

        crop_x1 = max(
            0,
            center_x - new_width // 2
        )

        crop_x2 = min(
            pw,
            crop_x1 + new_width
        )

        portrait = portrait[
            :,
            crop_x1:crop_x2
        ]

    else:

        new_height = int(
            pw / target_ratio
        )

        center_y = ph // 2

        crop_y1 = max(
            0,
            center_y - new_height // 2
        )

        crop_y2 = min(
            ph,
            crop_y1 + new_height
        )

        portrait = portrait[
            crop_y1:crop_y2,
            :
        ]


    # -----------------------------------------------------
    # 11. Resize ảnh chân dung
    # -----------------------------------------------------

    portrait = cv2.resize(
        portrait,
        (600, 770),
        interpolation=cv2.INTER_CUBIC
    )


    # -----------------------------------------------------
    # 12. Encode JPG
    # -----------------------------------------------------

    success, encoded = cv2.imencode(
        ".jpg",
        portrait,
        [
            cv2.IMWRITE_JPEG_QUALITY,
            95
        ]
    )

    if not success:

        raise ValueError(
            "Không thể mã hóa ảnh chân dung"
        )


    # -----------------------------------------------------
    # 13. Base64
    # -----------------------------------------------------

    image_base64 = base64.b64encode(
        encoded.tobytes()
    ).decode("utf-8")


    image_data_url = (
        "data:image/jpeg;base64,"
        + image_base64
    )


    # -----------------------------------------------------
    # 14. Trả kết quả
    # -----------------------------------------------------

    return {

        "success": True,

        "image_base64":
            image_data_url,

        "width":
            portrait.shape[1],

        "height":
            portrait.shape[0],

        "face": {

            "x": x,
            "y": y,
            "width": w,
            "height": h
        },

        "crop": {

            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2
        },

        "detector":
            detector
    }