# Deploy BE lên Render (Docker)

Hướng dẫn đưa máy chủ quét CCCD (thư mục `BE/`) lên [Render](https://render.com) bằng Docker,
rồi nối giao diện trên Vercel vào.

## Tổng quan

```
Trình duyệt ──> Vercel (giao diện, thư mục FE/)
                   │  gọi API theo biến API_BASE
                   ▼
              Render (máy chủ, thư mục BE/, Docker)
                   │  gửi ảnh để đọc thông tin
                   ▼
                 Groq
```

Các tệp liên quan:

| Tệp | Vai trò |
|---|---|
| `BE/Dockerfile` | Đóng gói máy chủ: Python 3.12, chạy bằng gunicorn ở cổng `$PORT` |
| `BE/.dockerignore` | Loại khỏi image: `.env`, ảnh CCCD thật, test, công cụ dev, `yolo11n.pt` |
| `BE/requirements.txt` | Thư viện chạy (không có PyTorch) |
| `render.yaml` | Cấu hình Render Blueprint, tạo dịch vụ bằng vài cú nhấp |

Image chỉ chứa 6 mục: `app.py`, `services/`, `yolo11n.onnx`, `README.md`, hai tệp requirements.

## Vì sao chạy được trên gói Free (512MB RAM)

| Thay đổi | Trước | Sau |
|---|---|---|
| Chạy YOLO bằng ONNX + OpenCV thay cho PyTorch + ultralytics | ~1GB thư viện | ~200MB |
| Chuẩn hoá cạnh dài ảnh dò tìm về 1280px (trước phóng chiều rộng lên 1600px) | RAM đỉnh 812MB | 354MB |
| Quét Haar toàn ảnh ở 960px khi không thấy người | +150MB | +91MB |
| Mỗi lần chỉ cắt 1 ảnh, OpenCV 1 luồng, `MALLOC_ARENA_MAX=2` | | |

Đo trên máy (gunicorn, 2 lượt x 10 ảnh mẫu, 4 yêu cầu song song): RAM đỉnh **397MB**,
kết quả vẫn đúng 10/10 (5 mặt trước ra chân dung, 5 mặt sau bị từ chối).
Model ONNX đã đối chiếu với ultralytics: cùng quyết định 10/10, khung lệch tối đa 6px.

## Bước 0. Chuẩn bị

1. Tài khoản Render: đăng nhập bằng GitHub tại https://dashboard.render.com.
2. Cho Render đọc repo private `hoainxm/id-scan`: lần đầu kết nối GitHub, chọn
   **Only select repositories** → chọn `id-scan`.
3. Groq API key (lấy tại https://console.groq.com/keys). **Chỉ dán key vào màn hình Render,
   không ghi vào tệp nào trong repo.**
4. Địa chỉ giao diện trên Vercel: Vercel → Project → **Settings** → **Domains**.
   Lưu ý `id-scan.vercel.app` là trang của người khác, không phải project này.

## Bước 1. Tạo dịch vụ

### Cách A (khuyên dùng): Blueprint từ `render.yaml`

1. Dashboard → **New** → **Blueprint**.
2. Chọn repo `hoainxm/id-scan`, nhánh `main`. Render tự đọc `render.yaml` ở gốc repo.
3. Render hỏi giá trị cho các biến đánh dấu `sync: false`:
   - `OPENAI_API_KEY`: dán OpenAI key (nhà cung cấp chính).
   - `GROQ_API_KEY`: dán Groq key (dự phòng; để trống nếu không dùng).
   - `ALLOWED_ORIGINS`: địa chỉ giao diện, ví dụ `https://<domain-vercel-của-bạn>`.
     Nhiều địa chỉ thì cách nhau bằng dấu phẩy, **không có dấu `/` ở cuối**.
4. Bấm **Apply**. Render build image (khoảng 3-5 phút lần đầu) rồi chạy.

Blueprint đã cấu hình sẵn: Docker, vùng Singapore, gói Free, kiểm tra sức khoẻ ở
`/api/health`, chỉ deploy lại khi có thay đổi trong `BE/`.

### Cách B: tạo tay Web Service

Dashboard → **New** → **Web Service** → chọn repo `hoainxm/id-scan`, rồi điền:

| Mục | Giá trị |
|---|---|
| Name | `id-scan-api` |
| Language | `Docker` |
| Branch | `main` |
| Region | `Singapore` |
| Root Directory | `BE` |
| Dockerfile Path | `./Dockerfile` |
| Instance Type | `Free` |

Mở **Advanced**:

| Mục | Giá trị |
|---|---|
| Health Check Path | `/api/health` |
| Auto-Deploy | `On Commit` |

Thêm **Environment Variables** như bảng ở Bước 2, rồi bấm **Deploy Web Service**.

## Bước 2. Biến môi trường

| Biến | Bắt buộc | Giá trị | Ghi chú |
|---|---|---|---|
| `OPENAI_API_KEY` | Ít nhất 1 trong 2 key | OpenAI key | Nhà cung cấp đọc ảnh chính |
| `GROQ_API_KEY` | Ít nhất 1 trong 2 key | Groq key | Dự phòng khi OpenAI lỗi/hết hạn mức. Thiếu cả hai thì `/api/ocr-cccd` trả 503 `OCR_NOT_CONFIGURED`, cắt chân dung vẫn chạy |
| `OCR_PROVIDERS` | Không | `openai,groq` | Thứ tự thử nhà cung cấp |
| `OPENAI_VISION_MODEL` | Không | `gpt-4.1-mini` | Model OpenAI đọc ảnh |
| `OPENAI_IMAGE_DETAIL` | Không | `high` | `low` rẻ hơn nhưng dễ đọc sai chữ nhỏ |
| `GROQ_VISION_MODEL` | Không | `qwen/qwen3.8-27b` | Model Groq đọc ảnh |
| `ALLOWED_ORIGINS` | Có | xem Bước 4 | Địa chỉ giao diện được gọi API |
| `PORT` | Không | Render tự đặt | Không cần khai báo |

Service tạo bằng Blueprint trước đây chưa có các biến OpenAI: vào **Environment** thêm tay
`OPENAI_API_KEY`, `OPENAI_VISION_MODEL`, `OCR_PROVIDERS` rồi **Save Changes**.
Kiểm tra: `GET /api/health` liệt kê `ocrProviders` theo thứ tự sẽ dùng.

Không cần `FLASK_HOST`, `FLASK_DEBUG`: trên Render máy chủ chạy bằng gunicorn, không dùng `app.run()`.

## Bước 3. Kiểm tra sau khi deploy

Render cấp địa chỉ dạng `https://id-scan-api.onrender.com` (xem ở đầu trang dịch vụ).

```bash
curl https://id-scan-api.onrender.com/api/health
```

Kết quả đúng: `{"service":"portrait-extraction + groq-ocr","status":"ok","success":true}`

Thử cắt chân dung bằng một ảnh mặt trước:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -F "front=@BE/test_images/front.jpg" https://id-scan-api.onrender.com/api/portrait
```

Kết quả đúng: `200`. Gửi ảnh mặt sau phải ra `422`.

## Bước 4. Nối giao diện Vercel vào máy chủ

1. Vercel → Project `id-scan` → **Settings** → **Environment Variables** → thêm:
   - Key: `API_BASE`
   - Value: `https://id-scan-api.onrender.com` (không có `/` ở cuối)
   - Environments: Production (và Preview nếu cần)
2. **Deployments** → bản mới nhất → **Redeploy**. `scripts/build-fe.sh` sẽ ghi địa chỉ này vào `config.js`.
3. Mở trang Vercel, tải ảnh mặt trước: khung avatar hiện chân dung là đã nối thành công.

### Cấu hình `ALLOWED_ORIGINS` (nguyên nhân số 1 của lỗi "Failed to fetch")

Giá trị là danh sách địa chỉ cách nhau bằng dấu phẩy. Khuyên dùng:

```
https://id-scan-*-hoainxms-projects.vercel.app,https://<domain-production-của-bạn>,http://localhost:5500
```

- `*` thay cho phần ngẫu nhiên Vercel tạo mỗi lần deploy, nên mọi URL deploy của project đều được phép.
  `*` chỉ khớp chữ, số và `-`, không khớp dấu `.` nên domain lạ không lọt qua.
- Máy chủ tự bỏ khoảng trắng, dấu nháy và `/` cuối nếu lỡ nhập thừa.
- Khi khởi động, Logs trên Render in dòng `CORS cho phép: [...]`. Mỗi yêu cầu bị chặn in
  `CORS từ chối origin: <địa chỉ>`: chép đúng địa chỉ đó vào `ALLOWED_ORIGINS`.
- Đổi biến xong phải lưu (**Save Changes**) để Render khởi động lại.

## Lưu ý về gói Free

- **Ngủ sau 15 phút không có yêu cầu.** Yêu cầu đầu tiên sau đó chờ khoảng 30-60 giây để máy chủ thức dậy.
  Giao diện sẽ hiện "Đang cắt ảnh chân dung..." lâu hơn bình thường.
- **0.1 CPU**: cắt một ảnh chân dung mất khoảng 1-3 giây (trên máy dev là 0,1-1 giây).
- **512MB RAM**: đỉnh đo được 397MB. Nếu Render báo `Out of memory` (Events → "Instance failed"),
  nâng lên gói Starter hoặc Standard.
- **750 giờ chạy miễn phí mỗi tháng** cho toàn bộ dịch vụ Free của tài khoản.
- Groq gói miễn phí chỉ đủ khoảng 33 thẻ/ngày, nên dùng làm dự phòng; OpenAI là nhà cung cấp chính.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Deploy báo "Health check failed" | Máy chủ không nghe đúng cổng | Không đặt cứng `PORT`; Dockerfile đã dùng `$PORT` của Render |
| Logs có `Out of memory` / instance restart | Ảnh quá lớn hoặc nhiều yêu cầu cùng lúc | Nâng gói; giữ `--workers 1` |
| `503 OCR_NOT_CONFIGURED` | Chưa có `OPENAI_API_KEY` lẫn `GROQ_API_KEY` | Thêm biến, lưu, chờ Render khởi động lại |
| `503 OCR_AUTH` | Key sai, đã thu hồi, hoặc tài khoản OpenAI chưa nạp tiền | Kiểm tra key và Billing |
| `429 OCR_RATE_LIMIT` | Mọi nhà cung cấp đều hết hạn mức | Chờ, hoặc nâng hạn mức |
| `503 OCR_UNAVAILABLE` | Nhà cung cấp quá tải | Thử lại sau ít phút |
| `502 OCR_BAD_REQUEST` | Tên model sai hoặc model không đọc được ảnh | Kiểm tra `OPENAI_VISION_MODEL` / `GROQ_VISION_MODEL` |
| "Failed to fetch" / "Không kết nối được máy chủ" | `ALLOWED_ORIGINS` không khớp, hoặc máy chủ đang ngủ | Xem Logs có dòng `CORS từ chối origin`; nếu máy chủ ngủ thì đợi 30-60 giây rồi thử lại |
| Giao diện báo "Chưa cấu hình địa chỉ BE" | Thiếu `API_BASE` trên Vercel | Xem Bước 4, nhớ Redeploy |

Xem log: trang dịch vụ → **Logs**. Log không chứa dữ liệu cá nhân, chỉ ghi trạng thái
(ví dụ `OCR hoàn tất; QR: matched; MRZ: valid; số trường cần kiểm tra: 0`).

## Chạy thử image trên máy (cần Docker Desktop)

```bash
docker build -t id-scan-api BE
```

```bash
docker run --rm -p 10000:10000 --env-file BE/.env -e ALLOWED_ORIGINS=http://localhost:5500 id-scan-api
```

Sau đó mở `http://localhost:10000/api/health`.

## Bảo mật

- `.env` không bao giờ vào image (đã loại trong `.dockerignore`) và không commit vào repo.
- Ảnh CCCD thật trong `BE/test_images/` không vào image.
- Image chạy bằng người dùng thường (`appuser`), không phải root.
- Máy chủ chỉ nhận yêu cầu từ các địa chỉ trong `ALLOWED_ORIGINS`.
- Ảnh CCCD vẫn được gửi tới Groq (dịch vụ đám mây bên thứ ba) khi đọc thông tin.
