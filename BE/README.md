# BE - Quét CCCD: cắt chân dung + đọc thông tin (OCR) + kiểm chứng

## Cấu trúc

```
BE/
├── app.py                       # Flask app, expose API
├── requirements.txt             # Python >= 3.10
├── .env.example                 # Mẫu cấu hình, sao chép thành .env
├── yolo11n.pt                   # Model YOLO (COCO) dùng tìm "person" trên ảnh thẻ
├── services/
│   ├── portrait_service.py      # Cắt ảnh chân dung (YOLO person + Haar face/eye)
│   ├── groq_cccd.py             # OCR bằng Groq Vision (LLM), schema JSON strict
│   └── cccd_verify.py           # Kiểm chứng local: QR code, MRZ, cấu trúc số, logic ngày
└── tests/
    ├── test_cccd_verify.py      # QR / MRZ / cấu trúc số / luật kiểm tra (dữ liệu giả)
    └── test_api.py              # API + pipeline OCR với Groq giả, không gọi mạng
```

## Cài đặt & chạy

```bash
cd BE
python3.12 -m venv venv && source venv/bin/activate   # cần Python >= 3.10
pip install -r requirements.txt
cp .env.example .env          # rồi điền GROQ_API_KEY
python app.py
```

Server chạy ở `http://127.0.0.1:8000`. Mặc định chỉ nghe localhost, tắt debug
(xem `FLASK_HOST`, `FLASK_DEBUG` trong `.env.example`).

- Thiếu `GROQ_API_KEY`: server vẫn chạy, `/api/portrait` vẫn dùng được,
  `/api/ocr-cccd` trả `503 OCR_NOT_CONFIGURED`.
- CORS chỉ cho phép origin trong `ALLOWED_ORIGINS` (mặc định FE ở cổng 5500).

## Test

```bash
cd BE && python -m pytest tests -v
```

Không gọi Groq thật. Test dùng ảnh trong `test_images/` nếu có, thiếu thì tự bỏ qua.

## API

### `GET /api/health`

### `POST /api/portrait`
- Body `multipart/form-data`, field `front` = ảnh mặt trước (JPG/PNG, kiểm tra theo
  nội dung file nên tên `blob` không đuôi từ camera vẫn được nhận; tối đa 10MB).
- 200: `{ success, image_base64 (data:image/jpeg), width: 600, height: 770, face, crop, detector }`
- 422 `code: NO_PORTRAIT`: không thấy chân dung (thường do chọn nhầm ảnh mặt sau).

Cách tìm chân dung:
1. YOLO tìm `person` (class 0 COCO) → Haar tìm mặt bên trong vùng đó.
2. Không có `person` → Haar trên toàn ảnh nhưng **bắt buộc thấy mắt** trong khung mặt.
3. Không thỏa → 422. (Haar trơn bắt nhầm vân tay / MRZ / chip ở mặt sau.)

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
  }
}
```
- Lỗi: 400 (thiếu/sai file), 422, 429 `GROQ_RATE_LIMIT`, 502 `GROQ_BAD_REQUEST`,
  503 `OCR_NOT_CONFIGURED` / `GROQ_AUTH` / `GROQ_UNREACHABLE`.

Luồng xử lý:
1. Đọc QR code trên ảnh gốc (local, `zxing-cpp`).
2. Thu nhỏ ảnh (cạnh dài ≤ 2000px, JPEG ≤ 1.5MB) rồi gửi Groq Vision. Model trả JSON
   theo schema strict, gồm cả `cardType` và chuỗi `mrz` chép nguyên văn.
3. Kiểm chứng local (`cccd_verify.py`):
   - **QR** (dữ liệu do cơ quan cấp mã hoá): lệch thì **ghi đè** số CCCD, họ tên,
     ngày sinh, giới tính, ngày cấp; ghi vào `corrections`.
   - **MRZ** (ICAO 9303 TD1): chỉ dùng khi mọi check digit khớp; lệch thì **cảnh báo + gợi ý**.
   - **Cấu trúc số định danh**: mã tỉnh 001-096, chữ số thứ 4 = giới tính/thế kỷ,
     chữ số 5-6 = 2 số cuối năm sinh.
   - **Logic**: định dạng ngày, ngày cấp sau ngày sinh, hết hạn sau ngày cấp, giới tính Nam/Nữ...

Ảnh CCCD chỉ xử lý trong RAM, không lưu xuống đĩa; log không chứa dữ liệu cá nhân.
Lưu ý: ảnh được gửi tới Groq (dịch vụ cloud bên thứ ba).
