# BE - Quét CCCD: cắt chân dung + đọc thông tin (OCR) + kiểm chứng

## Cấu trúc

```
BE/
├── app.py                       # Flask app, expose API
├── requirements.txt             # Thư viện chạy (Docker/Render), Python >= 3.10
├── requirements-dev.txt         # + pytest cho dev/test
├── Dockerfile, .dockerignore    # Đóng gói deploy (xem docs/deploy-render.md)
├── .env.example                 # Mẫu cấu hình, sao chép thành .env
├── yolo11n.onnx                 # Model YOLO (COCO) tìm "person", chạy bằng cv2.dnn
├── yolo11n.pt                   # Model gốc, chỉ dùng để export lại ONNX
├── services/
│   ├── portrait_service.py      # Cắt ảnh chân dung (YOLO person + Haar face/eye)
│   ├── ocr_cccd.py              # Đọc CCCD bằng model đọc ảnh: OpenAI chính, Groq dự phòng
│   └── cccd_verify.py           # Kiểm chứng local: QR code, MRZ, cấu trúc số, logic ngày
├── tools/
│   ├── audit_ocr.py             # Audit độ chính xác theo chức năng trên bộ ảnh có nhãn
│   └── export_yolo_onnx.py      # Export yolo11n.pt -> yolo11n.onnx
└── tests/
    ├── test_cccd_verify.py      # QR / MRZ / cấu trúc số / luật kiểm tra (dữ liệu giả)
    └── test_api.py              # API + pipeline OCR với OpenAI/Groq giả, không gọi mạng
```

## Cài đặt & chạy

```bash
cd BE
python3.12 -m venv venv && source venv/bin/activate   # cần Python >= 3.10
pip install -r requirements-dev.txt
cp .env.example .env          # rồi điền OPENAI_API_KEY và/hoặc GROQ_API_KEY
python app.py
```

Server chạy ở `http://127.0.0.1:8000`. Mặc định chỉ nghe localhost, tắt debug
(xem `FLASK_HOST`, `FLASK_DEBUG` trong `.env.example`).

- Chưa có API key đọc ảnh nào: server vẫn chạy, `/api/portrait` vẫn dùng được,
  `/api/ocr-cccd` trả `503 OCR_NOT_CONFIGURED`.
- CORS chỉ cho phép origin trong `ALLOWED_ORIGINS` (mặc định FE ở cổng 5500).

## Test

```bash
cd BE && python -m pytest tests -v
```

Không gọi OpenAI/Groq thật. Test dùng ảnh trong `test_images/` nếu có, thiếu thì tự bỏ qua.

## API

### `GET /api/health`

### `POST /api/portrait`
- Body `multipart/form-data`, field `front` = ảnh mặt trước (JPG/PNG, kiểm tra theo
  nội dung file nên tên `blob` không đuôi từ camera vẫn được nhận; tối đa 10MB).
- 200: `{ success, image_base64 (data:image/jpeg), width: 600, height: 770, face, crop, detector }`
- 422 `code: NO_PORTRAIT`: không thấy chân dung (thường do chọn nhầm ảnh mặt sau).

Cách tìm chân dung (ảnh dò tìm chuẩn hoá cạnh dài 1280px):
1. YOLO (ONNX, `cv2.dnn`) tìm `person` (class 0 COCO) → Haar tìm mặt bên trong vùng đó.
2. Không có `person` → Haar trên toàn ảnh (thu về 960px) nhưng **bắt buộc thấy mắt** trong khung mặt.
3. Không thỏa → 422. (Haar trơn bắt nhầm vân tay / MRZ / chip ở mặt sau.)

Mỗi lần chỉ xử lý 1 ảnh để giữ RAM đỉnh dưới ~400MB (đo bằng gunicorn, 4 yêu cầu song song).

Đã đo trên 10 ảnh mẫu (5 mặt trước, 5 mặt sau): 10/10 đúng.

### `POST /api/ocr-cccd`
- Body `multipart/form-data`, field `front` + `back`.
- 200:
```json
{
  "success": true,
  "data": {
    "cardType": "old | new | unknown",
    "soGiayTo": "", "hoDem": "", "ten": "", "hoTen": "", "ngaySinh": "DD/MM/YYYY",
    "gioiTinh": "", "quocTich": "", "danToc": "", "nguyenQuan": "", "noiSinh": "",
    "noiCapGiayTo": "", "ngayCap": "", "ngayHetHan": "",
    "HKTT": { "quocGia": "", "tinh": "", "quanHuyen": "", "phuongXa": "", "soNha": "", "diaChiGoc": "" }
  },
  "validation": {
    "sources": { "qr": "matched | corrected | absent", "mrz": "valid | invalid | absent" },
    "corrections": [{ "field": "hoTen", "ocrValue": "...", "value": "...", "source": "QR" }],
    "warnings": [{ "field": "ngayHetHan", "message": "...", "suggestion": "..." }],
    "needsReview": ["ngayHetHan"]
  },
  "engine": { "provider": "openai", "model": "gpt-5.6-luna", "fallback": false, "inputTokens": 0, "outputTokens": 0 }
}
```
- Lỗi: 400 (thiếu/sai file), 422, 429 `OCR_RATE_LIMIT`, 502 `OCR_BAD_REQUEST` / `OCR_BAD_RESPONSE`,
  503 `OCR_NOT_CONFIGURED` / `OCR_AUTH` / `OCR_UNREACHABLE` / `OCR_UNAVAILABLE`.
  Chỉ trả lỗi khi **mọi** nhà cung cấp đều lỗi; `message` nêu lý do từng nơi.

Luồng xử lý:
1. Đọc QR code trên ảnh gốc (local, `zxing-cpp`).
2. Thu nhỏ ảnh (cạnh dài ≤ 2000px, JPEG ≤ 1.5MB) rồi gửi model đọc ảnh theo thứ tự
   `OCR_PROVIDERS` (mặc định OpenAI `gpt-5.6-luna`, dự phòng Groq). Nhà cung cấp lỗi
   (hết hạn mức, quá tải, sai key, mất mạng, JSON hỏng) thì tự chuyển sang nhà cung cấp kế tiếp.
   Model trả JSON theo schema strict, gồm cả `cardType` và chuỗi `mrz` chép nguyên văn.
3. Kiểm chứng local (`cccd_verify.py`):
   - **QR** (dữ liệu do cơ quan cấp mã hoá): lệch thì **ghi đè** số CCCD, họ tên,
     ngày sinh, giới tính, ngày cấp; ghi vào `corrections`.
   - **MRZ** (ICAO 9303 TD1): chỉ dùng khi mọi check digit khớp; lệch thì **cảnh báo + gợi ý**.
   - **Cấu trúc số định danh**: mã tỉnh 001-096, chữ số thứ 4 = giới tính/thế kỷ,
     chữ số 5-6 = 2 số cuối năm sinh.
   - **Logic**: định dạng ngày, ngày cấp sau ngày sinh, hết hạn sau ngày cấp, giới tính Nam/Nữ...

## Chọn model OpenAI (benchmark 13/10/2026)

Chạy `tools/audit_ocr.py` trên 5 thẻ có nhãn đúng, chỉ dùng OpenAI. Giá theo bảng giá
OpenAI (Standard, USD / 1M token vào / ra); chi phí/thẻ tính từ token đo thật, quy đổi 26.500 VND/USD.

| Model | Giá vào / ra | Trường đúng | Thẻ đúng hết | Token vào + ra / thẻ | VND / thẻ | Thời gian |
|---|---|---|---|---|---|---|
| **gpt-5.6-luna** (mặc định) | 0,20 / 1,20 | **150/150** (3 lượt) | **15/15** | 5.025 + ~790 | **~51** | ~9 s |
| gpt-4.1-mini | 0,40 / 1,60 | 46/50 | 2/5 | 6.183 + 242 | 76 | 2,6 s |
| gpt-5-mini | 0,25 / 2,00 | 45/50 | 2/5 | 5.149 + 1.467 | 112 | 14 s |
| gpt-5.4-nano | 0,20 / 1,25 | 43/50 | 1/5 | 5.026 + 1.100 | 63 | 8,5 s |
| gpt-5-nano | 0,05 / 0,40 | 40/50 | 1/5 | 5.885 + 1.814 | 27 | 16 s |
| gpt-4.1-nano | 0,10 / 0,40 | 36/50 | 0/5 | 8.250 + 182 | 24 | 2 s |
| gpt-4o-mini | 0,15 / 0,60 | 83/100 (2 lượt) | 0/10 | **64.533** + 256 | 261 | 3,9 s |
| (Groq qwen3.8-27b, đo trước đó) | gói miễn phí | 46/50 sau kiểm chứng | 6/10 | ~5.400 + 340 | 0 | 2-3 s* |

gpt-4o-mini tính token ảnh rất cao (~64.500 token/thẻ so với ~5.000 của model khác) nên đắt nhất dù giá/token thấp.

\* Groq gói miễn phí giới hạn 8.000 token/phút, 200.000 token/ngày (~33 thẻ/ngày).
Bộ thử còn nhỏ (5 thẻ); chạy lại benchmark khi có thêm ảnh có nhãn.

## Deploy

Docker lên Render: xem [docs/deploy-render.md](../docs/deploy-render.md).

Ảnh CCCD chỉ xử lý trong RAM, không lưu xuống đĩa; log không chứa dữ liệu cá nhân.
Lưu ý: ảnh được gửi tới OpenAI/Groq (dịch vụ cloud bên thứ ba).

`GET /api/health` liệt kê nhà cung cấp OCR đã có key và model đang dùng (không lộ key).
