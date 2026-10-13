"""
Test API + OCR pipeline, không gọi Groq thật (client được thay bằng bản giả).
Test dùng ảnh trong BE/test_images nếu có; thiếu ảnh thì tự bỏ qua.
"""

import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np

BE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BE_DIR))

import app as app_module  # noqa: E402
from services import groq_cccd  # noqa: E402
from tests.test_cccd_verify import build_mrz, sample_ocr  # noqa: E402

FRONT = BE_DIR / "test_images" / "front.jpg"
BACK = BE_DIR / "test_images" / "back.jpg"
HAS_SAMPLES = FRONT.is_file() and BACK.is_file()


def jpeg_bytes(width=800, height=500, color=(200, 200, 200)):
    image = np.full((height, width, 3), color, dtype=np.uint8)
    return cv2.imencode(".jpg", image)[1].tobytes()


def post(client, path, **files):
    data = {name: (io.BytesIO(content), filename) for name, (content, filename) in files.items()}
    return client.post(path, data=data, content_type="multipart/form-data")


class FakeGroq:
    def __init__(self, payload):
        content = json.dumps(payload, ensure_ascii=False)
        message = mock.Mock(content=content)
        self.chat = mock.Mock()
        self.chat.completions.create.return_value = mock.Mock(choices=[mock.Mock(message=message)])


class TestPortraitAPI(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_missing_file(self):
        self.assertEqual(self.client.post("/api/portrait").status_code, 400)

    def test_not_an_image(self):
        r = post(self.client, "/api/portrait", front=(b"not an image", "a.jpg"))
        self.assertEqual(r.status_code, 400)

    def test_blank_image_rejected(self):
        r = post(self.client, "/api/portrait", front=(jpeg_bytes(), "blank.jpg"))
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.get_json()["code"], "NO_PORTRAIT")

    @unittest.skipUnless(HAS_SAMPLES, "thiếu BE/test_images")
    def test_front_without_extension_is_accepted(self):
        # Ảnh chụp từ camera trình duyệt có tên "blob", không có đuôi.
        r = post(self.client, "/api/portrait", front=(FRONT.read_bytes(), "blob"))
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["image_base64"].startswith("data:image/jpeg;base64,"))
        self.assertEqual((body["width"], body["height"]), (600, 770))

    @unittest.skipUnless(HAS_SAMPLES, "thiếu BE/test_images")
    def test_back_side_is_rejected(self):
        r = post(self.client, "/api/portrait", front=(BACK.read_bytes(), "back.jpg"))
        self.assertEqual(r.status_code, 422)

    def test_cors_only_known_origin(self):
        evil = self.client.get("/api/health", headers={"Origin": "http://evil.example"})
        ok = self.client.get("/api/health", headers={"Origin": "http://localhost:5500"})
        self.assertIsNone(evil.headers.get("Access-Control-Allow-Origin"))
        self.assertEqual(ok.headers.get("Access-Control-Allow-Origin"), "http://localhost:5500")


class TestOcrAPI(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()
        groq_cccd._client = None

    def tearDown(self):
        groq_cccd._client = None

    def test_missing_back(self):
        r = post(self.client, "/api/ocr-cccd", front=(jpeg_bytes(), "f.jpg"))
        self.assertEqual(r.status_code, 400)

    def test_no_api_key_returns_503(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            r = post(self.client, "/api/ocr-cccd", front=(jpeg_bytes(), "f.jpg"), back=(jpeg_bytes(), "b.jpg"))
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.get_json()["code"], "OCR_NOT_CONFIGURED")

    def test_pipeline_with_fake_groq(self):
        payload = {**sample_ocr(ngayHetHan="01/01/2031"), "mrz": build_mrz(id12="001090012345")}
        fake = FakeGroq(payload)
        groq_cccd._client = fake

        r = post(self.client, "/api/ocr-cccd", front=(jpeg_bytes(), "f.jpg"), back=(jpeg_bytes(), "b.jpg"))

        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["data"]["cardType"], "old")
        self.assertNotIn("mrz", body["data"])
        self.assertEqual(body["validation"]["sources"]["mrz"], "valid")
        self.assertEqual(body["validation"]["needsReview"], ["ngayHetHan"])

        # Ảnh gửi Groq đã qua nén lại và schema yêu cầu cardType + mrz.
        kwargs = fake.chat.completions.create.call_args.kwargs
        schema = kwargs["response_format"]["json_schema"]["schema"]
        self.assertIn("cardType", schema["required"])
        self.assertIn("mrz", schema["required"])


class TestPrepareImage(unittest.TestCase):
    def test_downscale_large_image(self):
        out = groq_cccd.prepare_image_for_llm(jpeg_bytes(4000, 3000))
        image = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(max(image.shape[:2]), groq_cccd.LLM_MAX_SIDE)
        self.assertLessEqual(len(out), groq_cccd.LLM_MAX_BYTES)

    def test_small_image_kept_size(self):
        out = groq_cccd.prepare_image_for_llm(jpeg_bytes(800, 500))
        image = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(image.shape[:2], (500, 800))

    def test_invalid_image(self):
        with self.assertRaises(ValueError):
            groq_cccd.prepare_image_for_llm(b"garbage")

    def test_unknown_card_type_normalized(self):
        result = groq_cccd._normalize_result({**sample_ocr(), "cardType": "abc"})
        self.assertEqual(result["cardType"], "unknown")


if __name__ == "__main__":
    unittest.main()
