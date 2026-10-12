import cv2
import base64
import numpy as np
from ultralytics import YOLO


# =========================================================
# YOLO MODEL
# =========================================================

MODEL_PATH = "yolo11n.pt"

model = YOLO(MODEL_PATH)


# =========================================================
# HÀM TÌM KHUÔN MẶT / PERSON
# =========================================================

def detect_person(image):
    """
    Dùng YOLO để tìm người trong ảnh.

    Lưu ý:
    yolo11n mặc định không có class "face".
    Vì vậy ở giai đoạn này YOLO sẽ tìm class person.

    Sau đó OpenCV sẽ tìm khuôn mặt bên trong vùng person.
    """

    results = model.predict(
        source=image,
        conf=0.20,
        iou=0.45,
        verbose=False
    )

    if not results:
        return None

    result = results[0]

    if result.boxes is None:
        return None

    best_box = None
    best_area = 0

    for box in result.boxes:
        cls_id = int(box.cls[0])
        confidence = float(box.conf[0])

        # COCO class 0 = person
        if cls_id != 0:
            continue

        x1, y1, x2, y2 = box.xyxy[0].tolist()

        x1 = int(x1)
        y1 = int(y1)
        x2 = int(x2)
        y2 = int(y2)

        area = (x2 - x1) * (y2 - y1)

        if confidence >= 0.20 and area > best_area:
            best_area = area
            best_box = {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "confidence": confidence
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


def detect_face(image):
    """
    Tìm khuôn mặt bằng Haar Cascade.
    Dùng làm fallback / bước xác nhận.
    """

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    gray = cv2.equalizeHist(gray)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.05,
        minNeighbors=3,
        minSize=(20, 20)
    )

    if len(faces) == 0:
        return None

    # Chọn khuôn mặt lớn nhất
    faces = sorted(
        faces,
        key=lambda item: item[2] * item[3],
        reverse=True
    )

    x, y, w, h = faces[0]

    return {
        "x": int(x),
        "y": int(y),
        "width": int(w),
        "height": int(h)
    }


# =========================================================
# CROP CHÂN DUNG
# =========================================================

def crop_portrait_from_bytes(file_bytes: bytes):

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
    # 2. Resize ảnh để YOLO dễ nhận diện
    # -----------------------------------------------------

    detect_image = image.copy()

    scale = 1.0

    if original_w < 1600:

        scale = 1600 / original_w

        new_w = int(original_w * scale)
        new_h = int(original_h * scale)

        detect_image = cv2.resize(
            image,
            (new_w, new_h),
            interpolation=cv2.INTER_CUBIC
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

        else:
            # Nếu YOLO tìm person nhưng Haar
            # không tìm được mặt
            face_info = None

    else:

        face_info = None


    # -----------------------------------------------------
    # 5. Fallback:
    #    tìm mặt trên toàn bộ ảnh
    # -----------------------------------------------------

    if face_info is None:

        face_info = detect_face(
            detect_image
        )


    # -----------------------------------------------------
    # 6. Nếu vẫn không tìm được
    # -----------------------------------------------------

    if face_info is None:

        raise ValueError(
            "Không tìm thấy khuôn mặt trên ảnh CCCD"
        )


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

    left_expand = int(w * 1.0)
    right_expand = int(w * 1.0)

    top_expand = int(h * 1.2)
    bottom_expand = int(h * 1.5)

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
            "YOLO + Haar fallback"
    }