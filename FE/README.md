# FE - Trích xuất tự động từ giấy tờ (giao diện giống AMIS MISA)

## Cấu trúc thư mục

```
FE/
├── index.html              # Trang chính, chứa 2 modal: Trích xuất & Danh sách hồ sơ
├── css/
│   └── style.css           # Toàn bộ style, biến màu theo tông xanh MISA
├── js/
│   ├── app.js               # File khởi chạy, kết nối các component
│   ├── data/choices.js      # Danh sách chọn: 54 dân tộc, ~200 quốc gia, nơi cấp, loại giấy tờ
│   └── components/
│       ├── sidebar.js       # Xử lý tab danh mục giấy tờ (CMND/CCCD, Hộ chiếu...)
│       ├── uploadForm.js    # Tải/kéo-thả/chụp camera ảnh 2 mặt, gọi BE crop chân dung + OCR
│       ├── ocrReview.js     # Hiển thị kết quả kiểm chứng OCR, tô vàng trường cần xem lại
│       ├── addressConvert.js # Khung "Địa giới hành chính": chuyển địa chỉ cũ -> mới theo tuỳ chọn
│       ├── choiceField.js   # Ô nhập có danh sách chọn dùng chung (tìm không dấu, bàn phím)
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
4. Địa chỉ HKTT giữ nguyên như trên thẻ (kể cả quận/huyện của địa chỉ cũ). Khung
   **"Địa giới hành chính"** trong mục HKTT cho biết địa chỉ theo địa giới cũ
   (trước 01/07/2025) hay mới và địa chỉ mới tương ứng (`data/addressMapping.json`):
   - **Chuyển HKTT sang địa chỉ mới** ↔ **Khôi phục địa chỉ trên giấy tờ**
     (địa chỉ gốc lưu kèm hồ sơ ở `diaChiHKTTTrenGiayTo`, `hkttTrenGiayTo`).
   - **Điền địa chỉ mới vào Chỗ ở hiện nay**.
   - Xã/phường cũ bị chia cho nhiều đơn vị mới: người dùng chọn trong danh sách.
   - Tuỳ chọn **tự động điền Chỗ ở hiện nay sau khi quét**: mặc định tắt, nhớ theo trình duyệt.
   - Sửa tay tỉnh/quận/xã ở HKTT thì khung tự kiểm tra lại.

   Cách xác định: địa chỉ có quận/huyện ghi rõ là địa chỉ cũ, tra bảng chuyển đổi trước
   (tránh nhầm xã cũ trùng tên xã mới); không có quận/huyện thì kiểm tra danh mục hiện
   hành trước. Nhận được viết tắt trên thẻ: `P.`, `X.`, `TT.`, `Q.`, `H.`, `TX.`, `TP.`,
   tỉnh `BRVT`, `TP.HCM`, `HN`, `TTH`.
5. Các trường có nhiều giá trị cố định dùng danh sách chọn (`choiceField.js`):
   giới tính, dân tộc (54), quốc tịch và quốc gia (~200), loại giấy tờ, nơi cấp
   (Cục CS QLHC về TTXH, Cục CS ĐKQL cư trú, Bộ Công an, Cục QLXNC, công an 63 tỉnh cũ),
   nơi sinh và nguyên quán (34 tỉnh hiện hành + 29 tỉnh trước 07/2025; chọn chỉ thay phần
   sau dấu phẩy cuối, VD "Trực Ninh, Nam Đ" -> "Trực Ninh, Nam Định").
   - Bấm là mở cả danh sách; gõ để lọc không phân biệt dấu, tìm cả tên khác
     (H'Mông -> Mông, Mỹ -> Hoa Kỳ, BRVT -> Bà Rịa - Vũng Tàu); ↑ ↓ Enter Esc.
   - Giá trị ngoài danh sách vẫn được giữ.
   - Giá trị OCR trùng một lựa chọn (không phân biệt hoa thường, dấu) được đổi về cách ghi
     chuẩn, VD "KINH" -> "Kinh". Tỉnh/thành, xã/phường dùng combobox địa chỉ (`addressForm.js`).
6. Bấm "Lưu vào hồ sơ" → lưu localStorage. "Danh sách hồ sơ": tìm kiếm, sửa, xoá,
   xuất Excel.

Camera cần trang mở qua `http://localhost` hoặc `https` và người dùng cho phép truy cập.

## Việc còn lại

`js/components/storage.js` vẫn lưu localStorage (kèm ảnh base64, dễ đầy bộ nhớ trình
duyệt). Khi có BE lưu hồ sơ, thay các hàm `getAllProfiles/saveProfile/deleteProfiles`
bằng `fetch()` tới API.
