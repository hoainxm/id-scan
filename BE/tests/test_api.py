"""
Test API + OCR pipeline, không gọi OpenAI/Groq thật (client được thay bằng bản giả).
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
import httpx  # noqa: E402
import openai  # noqa: E402

from services import ocr_cccd  # noqa: E402
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


class FakeClient:
    """Client giả: trả payload, hoặc ném lỗi nếu truyền error."""

    def __init__(self, payload=None, error=None, prompt_tokens=5000, completion_tokens=300):
        self.chat = mock.Mock()
        if error is not None:
            self.chat.completions.create.side_effect = error
        else:
            message = mock.Mock(content=json.dumps(payload, ensure_ascii=False))
            usage = mock.Mock(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
            self.chat.completions.create.return_value = mock.Mock(choices=[mock.Mock(message=message)], usage=usage)


def rate_limit_error(sdk=openai):
    response = httpx.Response(429, request=httpx.Request("POST", "https://api.example/v1/chat/completions"))
    return sdk.RateLimitError("rate limit", response=response, body=None)


def ocr_payload(**overrides):
    return {**sample_ocr(**overrides), "mrz": build_mrz(id12="001090012345")}


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
    KEYS = {"OPENAI_API_KEY": "test-openai", "GROQ_API_KEY": "test-groq", "OCR_PROVIDERS": "openai,groq"}

    def setUp(self):
        self.client = app_module.app.test_client()
        ocr_cccd._clients.clear()
        self.env = mock.patch.dict(os.environ, self.KEYS)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        ocr_cccd._clients.clear()

    def ocr(self):
        return post(self.client, "/api/ocr-cccd", front=(jpeg_bytes(), "f.jpg"), back=(jpeg_bytes(), "b.jpg"))

    def test_missing_back(self):
        r = post(self.client, "/api/ocr-cccd", front=(jpeg_bytes(), "f.jpg"))
        self.assertEqual(r.status_code, 400)

    def test_no_api_key_returns_503(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": "", "OPENAI_API_KEY": ""}):
            r = self.ocr()
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.get_json()["code"], "OCR_NOT_CONFIGURED")

    def test_openai_is_primary(self):
        openai_fake = FakeClient(ocr_payload(ngayHetHan="01/01/2031"))
        groq_fake = FakeClient(ocr_payload())
        ocr_cccd._clients.update(openai=openai_fake, groq=groq_fake)

        r = self.ocr()

        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["engine"]["provider"], "openai")
        self.assertFalse(body["engine"]["fallback"])
        self.assertEqual(body["engine"]["inputTokens"], 5000)
        self.assertEqual(body["data"]["cardType"], "old")
        self.assertNotIn("mrz", body["data"])
        self.assertEqual(body["validation"]["needsReview"], ["ngayHetHan"])
        groq_fake.chat.completions.create.assert_not_called()

        kwargs = openai_fake.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "gpt-4.1-mini")
        self.assertEqual(kwargs["temperature"], 0)
        schema = kwargs["response_format"]["json_schema"]["schema"]
        self.assertIn("cardType", schema["required"])
        self.assertIn("mrz", schema["required"])
        images = [part for part in kwargs["messages"][1]["content"] if part["type"] == "image_url"]
        self.assertEqual([i["image_url"]["detail"] for i in images], ["high", "high"])

    def test_falls_back_to_groq_when_openai_rate_limited(self):
        ocr_cccd._clients.update(openai=FakeClient(error=rate_limit_error()), groq=FakeClient(ocr_payload()))

        r = self.ocr()

        self.assertEqual(r.status_code, 200)
        engine = r.get_json()["engine"]
        self.assertEqual(engine["provider"], "groq")
        self.assertTrue(engine["fallback"])

    def test_falls_back_on_invalid_json(self):
        broken = FakeClient()
        broken.chat.completions.create.return_value = mock.Mock(
            choices=[mock.Mock(message=mock.Mock(content="không phải json"))], usage=None
        )
        ocr_cccd._clients.update(openai=broken, groq=FakeClient(ocr_payload()))
        self.assertEqual(self.ocr().get_json()["engine"]["provider"], "groq")

    def test_all_providers_fail(self):
        import groq
        ocr_cccd._clients.update(
            openai=FakeClient(error=rate_limit_error(openai)),
            groq=FakeClient(error=rate_limit_error(groq)),
        )

        r = self.ocr()

        self.assertEqual(r.status_code, 429)
        body = r.get_json()
        self.assertEqual(body["code"], "OCR_RATE_LIMIT")
        self.assertIn("OpenAI", body["message"])
        self.assertIn("Groq", body["message"])

    def test_provider_without_key_is_skipped(self):
        groq_fake = FakeClient(ocr_payload())
        ocr_cccd._clients.update(groq=groq_fake)
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            body = self.ocr().get_json()
        self.assertEqual(body["engine"]["provider"], "groq")
        self.assertFalse(body["engine"]["fallback"])

    def test_provider_order_from_env(self):
        ocr_cccd._clients.update(openai=FakeClient(ocr_payload()), groq=FakeClient(ocr_payload()))
        with mock.patch.dict(os.environ, {"OCR_PROVIDERS": "groq,openai"}):
            self.assertEqual(self.ocr().get_json()["engine"]["provider"], "groq")

    def test_reasoning_model_has_no_temperature(self):
        fake = FakeClient(ocr_payload())
        ocr_cccd._clients.update(openai=fake)
        with mock.patch.dict(os.environ, {"OPENAI_VISION_MODEL": "gpt-5-mini"}):
            self.ocr()
        kwargs = fake.chat.completions.create.call_args.kwargs
        self.assertNotIn("temperature", kwargs)
        self.assertEqual(kwargs["reasoning_effort"], "low")

    def test_health_lists_configured_providers(self):
        providers = self.client.get("/api/health").get_json()["ocrProviders"]
        self.assertEqual([p["provider"] for p in providers], ["openai", "groq"])


class TestCorsConfig(unittest.TestCase):
    def test_messy_values_are_normalized(self):
        for raw in ('https://a.vercel.app/', '"https://a.vercel.app"', " 'https://a.vercel.app/' "):
            self.assertEqual(app_module.parse_origin(raw), "https://a.vercel.app")

    def test_wildcard_matches_only_own_project(self):
        pattern = app_module.parse_origin("https://id-scan-*-hoainxms-projects.vercel.app")
        with mock.patch.object(app_module, "ALLOWED_ORIGINS", [pattern]):
            self.assertTrue(app_module.origin_allowed("https://id-scan-ctisy4k6d-hoainxms-projects.vercel.app"))
            self.assertFalse(app_module.origin_allowed("https://evil-hoainxms-projects.vercel.app"))
            self.assertFalse(app_module.origin_allowed("https://id-scan-x.evil.com"))
            self.assertFalse(app_module.origin_allowed("https://id-scan-a.b-hoainxms-projects.vercel.app"))


class TestConfigHygiene(unittest.TestCase):
    def test_env_example_has_no_secret(self):
        # .env.example được commit: tuyệt đối không chứa key thật.
        for line in (BE_DIR / ".env.example").read_text(encoding="utf-8").splitlines():
            for key in ("GROQ_API_KEY=", "OPENAI_API_KEY="):
                if line.startswith(key):
                    self.assertEqual(line, key, "Đừng điền key vào .env.example, hãy dùng BE/.env")


class TestPrepareImage(unittest.TestCase):
    def test_downscale_large_image(self):
        out = ocr_cccd.prepare_image_for_llm(jpeg_bytes(4000, 3000))
        image = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(max(image.shape[:2]), ocr_cccd.LLM_MAX_SIDE)
        self.assertLessEqual(len(out), ocr_cccd.LLM_MAX_BYTES)

    def test_small_image_kept_size(self):
        out = ocr_cccd.prepare_image_for_llm(jpeg_bytes(800, 500))
        image = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(image.shape[:2], (500, 800))

    def test_invalid_image(self):
        with self.assertRaises(ValueError):
            ocr_cccd.prepare_image_for_llm(b"garbage")

    def test_unknown_card_type_normalized(self):
        result = ocr_cccd._normalize_result({**sample_ocr(), "cardType": "abc"})
        self.assertEqual(result["cardType"], "unknown")


if __name__ == "__main__":
    unittest.main()
