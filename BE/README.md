# BE - Khâu 1: Quét & cắt chân dung từ ảnh CCCD mặt trước

## Cấu trúc

```
BE/
├── app.py                       # Flask app, expose API
├── requirements.txt
├── services/
│   └── face_service.py          # Logic phát hiện khuôn mặt (OpenCV Haar Cascade) + cắt ảnh
└── tests/
    └── test_face_service.py     # Unit test riêng phần xử lý ảnh (không cần chạy server)
```

## Vì sao dùng Haar Cascade (OpenCV) thay vì YOLO ngay từ đầu?

- Haar Cascade có sẵn trong thư viện `opencv-python`, chạy 100% local, **không cần tải model**
  qua internet — phù hợp để làm khâu đầu tiên nhanh, test được ngay.
- Với ảnh CCCD/CMND (khuôn mặt rõ, chính diện, nền đơn giản) thì độ chính xác của Haar Cascade
  là đủ dùng.
- Nếu sau này cần chính xác hơn (ảnh nghiêng, mờ, ngược sáng...), chỉ cần thay nội dung hàm
  `detect_largest_face()` trong `services/face_service.py` bằng model YOLO-face, **không phải
  sửa gì ở app.py hay FE** — vì API trả ra vẫn giữ nguyên format.

## Cài đặt & chạy

```bash
cd BE
python3 -m venv venv && source venv/bin/activate   # khuyến khích dùng venv
pip install -r requirements.txt
python3 app.py
```

Server chạy ở: `http://localhost:8000`

## Đã test (tự động, trước khi gộp)

Chạy: `python3 -m unittest tests.test_face_service -v` (đã chạy — 10/10 test pass):
- Đọc ảnh hợp lệ / báo lỗi đúng khi ảnh hỏng.
- Ảnh dự phòng (khi không thấy mặt) luôn ra đúng kích thước vuông.
- Mã hoá/giải mã base64 PNG round-trip đúng.
- Cắt ảnh không vỡ khi khung mặt nằm sát biên ảnh.
- Luồng `extract_portrait()` không văng lỗi (exception) ra ngoài dù ảnh xấu.

Cũng đã test thủ công qua `curl` với server thật:
- `GET /api/health` → trả `{"status":"ok"}`
- `POST /api/portrait/extract` thiếu file → lỗi 400 đúng thông báo.
- Gửi file không phải ảnh / sai định dạng → lỗi rõ ràng, không crash server.
- Gửi ảnh hợp lệ nhưng không có khuôn mặt thật (ảnh test tổng hợp) → trả về
  `face_detected: false` kèm ảnh cắt giữa tạm thời, đúng thiết kế fallback.

## ⚠️ Cần bạn test thêm 1 bước bằng ảnh CCCD thật

Vì mình không có internet để tải ảnh mặt người thật vào môi trường này, Haar Cascade
chưa được test với ảnh khuôn mặt thật. Bạn chạy lệnh sau với 1 ảnh CCCD mặt trước thật
để kiểm tra:

```bash
curl -X POST -F "image=@duong_dan_anh_mat_truoc.jpg" http://localhost:8000/api/portrait/extract
```

Kết quả mong đợi: `"face_detected": true` và `image_base64` là ảnh đã cắt riêng khuôn mặt.

Nếu `face_detected` ra `false` dù ảnh có mặt rõ ràng (ví dụ ảnh quá tối, mặt bị che,
ảnh nghiêng nhiều), báo lại mình để mình tinh chỉnh tham số (`scaleFactor`, `minNeighbors`)
hoặc đổi qua YOLO-face cho chính xác hơn.

## API

### `GET /api/health`
Kiểm tra server sống.

### `POST /api/portrait/extract`
- Body: `multipart/form-data`, field `image` = file ảnh (png/jpg/jpeg, tối đa 10MB)
- Response 200:
```json
{
  "success": true,
  "face_detected": true,
  "image_base64": "data:image/png;base64,....",
  "message": "Đã phát hiện và cắt chân dung thành công."
}
```
- Response lỗi (400/413/422): `success: false`, kèm `message` giải thích lý do.

## Đã nối vào FE

`FE/js/components/uploadForm.js` đã được cập nhật: khi bạn chọn/kéo-thả ảnh **mặt trước**
vào FE, JS sẽ tự gọi `POST http://localhost:8000/api/portrait/extract`, chờ kết quả rồi
đưa đúng ảnh khuôn mặt đã cắt (không phải cả ảnh CCCD) vào khung tròn avatar phía trên form.

→ Để test đúng luồng đầu-cuối: chạy BE (`python3 app.py`, port 8000) **và** chạy FE
(`python3 -m http.server 5500` trong thư mục `FE`) cùng lúc, rồi mở `http://localhost:5500`.

Nếu bạn đổi port BE, sửa biến `BE_BASE_URL` ở đầu file `FE/js/components/uploadForm.js`.

## Bước tiếp theo (chưa làm)

Khâu OCR đọc thông tin (họ tên, số CCCD, ngày sinh...) bằng PaddleOCR + YOLO để tự điền
form — sẽ làm ở component `services/ocr_service.py` riêng, test độc lập rồi mới gộp vào
`app.py`, giống cách đã làm với khâu chân dung này.
