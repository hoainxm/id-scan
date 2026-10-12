"""
test_face_service.py
Chạy: python3 -m pytest BE/tests/test_face_service.py -v
(hoặc: python3 -m unittest BE.tests.test_face_service -v)

Test các phần có thể kiểm được mà không cần ảnh khuôn mặt thật:
- decode_image: đọc đúng / báo lỗi khi ảnh hỏng
- center_crop_fallback: luôn trả về ảnh vuông đúng kích thước OUTPUT_SIZE
- encode_to_base64_png: chuỗi base64 giải mã lại được, đúng định dạng PNG
- crop_portrait: khung càng lớn/càng lệch biên vẫn không vỡ (clamp đúng biên ảnh)
- extract_portrait: luồng đầy đủ không lỗi khi ảnh không có khuôn mặt (ảnh nền trơn)

Việc kiểm tra "có phát hiện đúng khuôn mặt thật hay không" cần ảnh CCCD thật,
sẽ test thủ công bằng lệnh curl ở bước sau (xem README.md).
"""

import base64
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # để import được services/

from services import face_service  # noqa: E402


def make_jpeg_bytes(width=800, height=600, color=(200, 200, 200)):
    img = np.full((height, width, 3), color, dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


class TestDecodeImage(unittest.TestCase):
    def test_decode_valid_image(self):
        data = make_jpeg_bytes(100, 80)
        img = face_service.decode_image(data)
        self.assertEqual(img.shape[0], 80)
        self.assertEqual(img.shape[1], 100)

    def test_decode_empty_bytes_raises(self):
        with self.assertRaises(ValueError):
            face_service.decode_image(b"")

    def test_decode_garbage_bytes_raises(self):
        with self.assertRaises(ValueError):
            face_service.decode_image(b"day khong phai la anh that")


class TestCenterCropFallback(unittest.TestCase):
    def test_output_is_square_and_correct_size(self):
        img = np.zeros((600, 900, 3), dtype=np.uint8)  # ảnh chữ nhật nằm ngang
        out = face_service.center_crop_fallback(img)
        self.assertEqual(out.shape[0], face_service.OUTPUT_SIZE)
        self.assertEqual(out.shape[1], face_service.OUTPUT_SIZE)

    def test_works_with_portrait_orientation(self):
        img = np.zeros((900, 600, 3), dtype=np.uint8)  # ảnh chữ nhật đứng
        out = face_service.center_crop_fallback(img)
        self.assertEqual(out.shape[0], face_service.OUTPUT_SIZE)
        self.assertEqual(out.shape[1], face_service.OUTPUT_SIZE)


class TestEncodeBase64(unittest.TestCase):
    def test_encode_and_decode_roundtrip(self):
        img = np.full((50, 50, 3), 128, dtype=np.uint8)
        data_url = face_service.encode_to_base64_png(img)
        self.assertTrue(data_url.startswith("data:image/png;base64,"))
        raw_b64 = data_url.split(",", 1)[1]
        decoded_bytes = base64.b64decode(raw_b64)
        arr = np.frombuffer(decoded_bytes, dtype=np.uint8)
        decoded_img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        self.assertIsNotNone(decoded_img)
        self.assertEqual(decoded_img.shape[0], 50)
        self.assertEqual(decoded_img.shape[1], 50)


class TestCropPortrait(unittest.TestCase):
    def test_crop_near_edge_does_not_crash(self):
        img = np.zeros((300, 300, 3), dtype=np.uint8)
        # khung mặt giả định nằm sát góc ảnh -> test việc clamp biên
        box = (5, 5, 40, 40)
        out = face_service.crop_portrait(img, box)
        self.assertEqual(out.shape[0], face_service.OUTPUT_SIZE)
        self.assertEqual(out.shape[1], face_service.OUTPUT_SIZE)

    def test_crop_center_box(self):
        img = np.zeros((400, 400, 3), dtype=np.uint8)
        box = (150, 150, 100, 100)
        out = face_service.crop_portrait(img, box)
        self.assertEqual(out.shape[:2], (face_service.OUTPUT_SIZE, face_service.OUTPUT_SIZE))


class TestExtractPortraitFlow(unittest.TestCase):
    def test_no_face_image_still_returns_result(self):
        # ảnh nền trơn chắc chắn không có khuôn mặt -> face_detected = False nhưng vẫn success
        data = make_jpeg_bytes(400, 400, color=(220, 220, 220))
        result = face_service.extract_portrait(data)
        self.assertTrue(result.success)
        self.assertFalse(result.face_detected)
        self.assertIsNotNone(result.image_base64)

    def test_invalid_image_returns_failure_not_exception(self):
        result = face_service.extract_portrait(b"not-an-image")
        self.assertFalse(result.success)
        self.assertFalse(result.face_detected)
        self.assertIsNone(result.image_base64)
        self.assertTrue(len(result.message) > 0)


if __name__ == "__main__":
    unittest.main()
