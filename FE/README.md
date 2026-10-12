# FE - Trích xuất tự động từ giấy tờ (giao diện giống AMIS MISA)

## Cấu trúc thư mục

```
FE/
├── index.html              # Trang chính, chứa 2 modal: Trích xuất & Danh sách hồ sơ
├── css/
│   └── style.css           # Toàn bộ style, biến màu theo tông xanh MISA
├── js/
│   ├── app.js               # File khởi chạy, kết nối các component
│   └── components/
│       ├── sidebar.js       # Xử lý tab danh mục giấy tờ (CMND/CCCD, Hộ chiếu...)
│       ├── uploadForm.js    # Xử lý tải ảnh mặt trước/sau + cập nhật avatar tròn
│       ├── profileForm.js   # Đọc/ghi dữ liệu form, tự ghép Họ tên & Địa chỉ
│       ├── profileList.js   # Danh sách hồ sơ: tìm kiếm, chọn, xóa, xuất Excel
│       └── storage.js       # Lớp lưu trữ tạm (localStorage) — sẽ thay bằng API khi có BE
└── assets/                  # (để trống, dùng khi cần ảnh/icon tĩnh)
```

## Cách chạy thử (bắt buộc chạy qua local server, KHÔNG mở trực tiếp file:// vì dùng ES module)

Cách 1 — dùng Python có sẵn:
```bash
cd FE
python3 -m http.server 5500
```
Sau đó mở trình duyệt: http://localhost:5500

Cách 2 — dùng VSCode extension "Live Server".

## Luồng hoạt động hiện tại (FE thuần, chưa nối BE)

1. Bấm "Mở Trích xuất tự động từ giấy tờ" → hiện modal trích xuất (giống ảnh mẫu).
2. Chọn danh mục bên sidebar trái (CMND/CCCD, Hộ chiếu, Bằng cấp, Chứng chỉ, CV).
3. Tải ảnh mặt trước / mặt sau → ảnh mặt trước sẽ tự hiển thị vào khung tròn avatar phía trên form (chỉ cập nhật ảnh, không tự điền dữ liệu vì OCR chưa nối BE).
4. Điền tay các trường thông tin (khi có BE + PaddleOCR/YOLO sẽ tự động điền).
5. Bấm "Lưu vào hồ sơ" → lưu vào danh sách (hiện tại lưu ở localStorage trình duyệt).
6. Bấm "Danh sách hồ sơ" (góc dưới trái modal) để xem danh sách đã lưu:
   - Tìm theo họ tên / số giấy tờ
   - Chọn tất cả / xóa các hồ sơ đã chọn
   - Mỗi dòng có nút "Sửa" (mở lại form để chỉnh) và "Xóa"
   - Nút "Xuất file Excel" ở góc dưới phải → tải file .xlsx với dữ liệu chia cột rõ ràng.

## Điểm nối với BE (OCR local: PaddleOCR + YOLO) sau này

Chỉ cần sửa trong `js/components/uploadForm.js`, hàm `handleImageSelected`:
- Gửi file ảnh lên API BE (ví dụ `POST /api/ocr/cccd`).
- Nhận JSON kết quả OCR trả về.
- Gọi `setFormData(result)` (từ `profileForm.js`) để tự động điền form.

Và trong `js/components/storage.js`, thay các hàm `getAllProfiles/saveProfile/deleteProfiles`
bằng các lời gọi `fetch()` tới API BE (ví dụ `/api/profiles`), để dữ liệu lưu vào database
thay vì localStorage — phần giao diện không cần sửa gì thêm.
