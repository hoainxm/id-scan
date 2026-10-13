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
│       ├── uploadForm.js    # Tải/kéo-thả/chụp camera ảnh 2 mặt, gọi BE crop chân dung + OCR
│       ├── ocrReview.js     # Hiển thị kết quả kiểm chứng OCR, tô vàng trường cần xem lại
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

## Luồng hoạt động

Cần chạy BE (`http://127.0.0.1:8000`, xem `BE/README.md`) cùng lúc với FE.
Đổi địa chỉ BE: sửa `API_BASE` đầu file `js/components/uploadForm.js`.

1. Bấm "Mở Trích xuất tự động từ giấy tờ".
2. Đưa ảnh mặt trước (chọn file, kéo-thả, hoặc nút "📷 Chụp ... bằng camera"):
   - FE gọi `POST /api/portrait` → ảnh chân dung vào khung tròn avatar.
   - Chọn nhầm ảnh mặt sau → báo lỗi ngay dưới tiêu đề, không đổi avatar.
3. Đưa ảnh mặt sau → khi đủ 2 mặt FE gọi `POST /api/ocr-cccd` (song song với crop
   chân dung nếu vừa đổi mặt trước) và tự điền form.
   - Dòng trạng thái hiển thị "Đang đọc..." / "Đã đọc xong" / lỗi.
   - Khung vàng phía trên form liệt kê trường cần kiểm tra (lệch MRZ, sai cấu trúc số,
     sai logic ngày...) kèm gợi ý; các ô đó được tô vàng, sửa ô thì hết tô.
   - Trường đã được tự sửa theo QR code trên thẻ cũng được liệt kê.
4. Địa chỉ HKTT giữ nguyên như trên thẻ. "Chỗ ở hiện nay" được map sang địa giới
   hành chính mới (`data/addressMapping.json`) khi thẻ là loại cũ (`cardType: "old"`)
   hoặc địa chỉ còn cấp quận/huyện.
5. Bấm "Lưu vào hồ sơ" → lưu localStorage. "Danh sách hồ sơ": tìm kiếm, sửa, xoá,
   xuất Excel.

Camera cần trang mở qua `http://localhost` hoặc `https` và người dùng cho phép truy cập.

## Việc còn lại

`js/components/storage.js` vẫn lưu localStorage (kèm ảnh base64, dễ đầy bộ nhớ trình
duyệt). Khi có BE lưu hồ sơ, thay các hàm `getAllProfiles/saveProfile/deleteProfiles`
bằng `fetch()` tới API.
