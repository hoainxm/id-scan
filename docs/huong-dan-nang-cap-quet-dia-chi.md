# Hướng dẫn nâng cấp chức năng quét địa chỉ CCCD

Tài liệu cho dev mới vào dự án `id-scan`. Đọc hết phần 1–5 (khoảng 30 phút) trước khi sửa code,
rồi chọn một việc ở phần 7 để làm. Mỗi việc có: vì sao cần, sửa ở đâu, các bước, và thế nào là xong.

Cập nhật: 15/10/2026, theo code ở commit `1c764da2`.

---

## 1. Bài toán trong 3 phút

Từ **01/07/2025**, Việt Nam sắp xếp lại đơn vị hành chính:

| | Trước 01/07/2025 (địa giới **cũ**) | Từ 01/07/2025 (địa giới **mới**) |
|---|---|---|
| Số cấp | 3 cấp: Tỉnh → Quận/Huyện → Xã/Phường | 2 cấp: Tỉnh → Xã/Phường/Đặc khu |
| Số tỉnh | 63 | 34 |
| Ví dụ | Phường 9, TP. Vũng Tàu, Bà Rịa - Vũng Tàu | Phường Tam Thắng, Hồ Chí Minh |

CCCD cấp trước ngày đó **vẫn in địa chỉ cũ**. Hệ thống phải:

1. Đọc địa chỉ trên thẻ (OCR) và giữ **đúng như trên thẻ** ở mục Hộ khẩu thường trú (HKTT).
2. Biết địa chỉ đó là **cũ hay mới**.
3. Nếu cũ: tìm **địa chỉ mới tương ứng**, để người dùng **tự chọn** có chuyển hay không.

Ba tình huống khó cần nhớ:

- **Xã bị chia**: một xã cũ chia cho 2–3 xã mới. Không được tự đoán, phải để người dùng chọn.
- **Trùng tên**: xã cũ có thể trùng tên một xã mới khác (VD Xã Tân Hiệp, Hóc Môn cũ ≠ Xã Tân Hiệp hiện nay).
- **OCR/thẻ ghi tắt**: `P.`, `X.`, `TT.`, `Q.`, `H.`, `TX.`, `TP.`, tỉnh `BRVT`, `BR - VT`, `TP.HCM`...

### Từ ngữ dùng trong code

| Từ | Nghĩa |
|---|---|
| HKTT | Hộ khẩu thường trú: địa chỉ trên thẻ ("Nơi thường trú" / "Nơi cư trú") |
| Chỗ ở hiện nay | Địa chỉ người dùng đang ở, luôn theo địa giới mới |
| `old*` / `new*` | Tên theo địa giới cũ / mới (VD `oldWard`, `newProvince`) |
| mapping | Bảng chuyển đổi xã cũ → xã mới (`FE/data/addressMapping.json`) |
| hierarchy | Danh mục đơn vị hành chính **hiện hành** (`FE/data/hierarchy.json`) |
| `soNha` | Phần chi tiết: số nhà, đường, thôn, xóm, ấp |

---

## 2. Luồng dữ liệu

```
Ảnh CCCD 2 mặt
   │
   ▼  BE (Render)  POST /api/ocr-cccd
BE/services/ocr_cccd.py      Model đọc ảnh trả JSON, có object HKTT:
                             { tinh, quanHuyen, phuongXa, soNha, diaChiGoc }
BE/services/cccd_verify.py   Đọc QR; nếu OCR thiếu diaChiGoc thì lấy địa chỉ từ QR
   │
   ▼  FE (Vercel)
FE/js/components/uploadForm.js   nhận JSON, phát sự kiện "cccdOCRCompleted"
   │
   ▼
FE/js/app.js  fillFormFromOCR()
   ├─ tách địa chỉ nếu OCR chỉ có 1 chuỗi      splitOldAddressText()
   ├─ điền mục HKTT đúng như trên thẻ           setFormData()
   └─ đối chiếu địa giới                        resolveAddressConversion()
         ├─ chuẩn hoá tên        (FE/js/addressMapping.js) normalizeAdministrativeName()
         ├─ cũ hay mới?          checkCurrentAddress()
         ├─ tra bảng chuyển đổi  findMappingForHKTT()
         ├─ đối chiếu danh mục   toCurrentTarget()
         └─ làm sạch số nhà      cleanCurrentHouseAddress()
   │
   ▼
FE/js/components/addressConvert.js   khung "Địa giới hành chính" + các nút
```

**Phần lớn việc nâng cấp địa chỉ nằm ở FE**, vì FE có dữ liệu mapping và hierarchy. BE chỉ đọc chữ.

---

## 3. Bản đồ file

| File | Vai trò | Sửa khi nào |
|---|---|---|
| `FE/js/addressMapping.js` | Chuẩn hoá tên (bỏ dấu, bỏ tiền tố, tên tắt tỉnh); tải mapping | Thêm cách viết tắt, tiền tố, tên tắt tỉnh |
| `FE/js/app.js` (khoảng dòng 60–1170) | **Toàn bộ logic nhận diện và tra cứu địa chỉ** | Sửa cách nhận diện cũ/mới, cách tra bảng |
| `FE/js/components/addressConvert.js` | Giao diện khung "Địa giới hành chính", nút chuyển / khôi phục / điền | Đổi giao diện, thêm trạng thái mới |
| `FE/js/components/addressForm.js` | Danh sách chọn Tỉnh/Thành, Xã/Phường (theo địa giới **mới**) | Gợi ý tỉnh/xã khi nhập tay |
| `FE/js/components/choiceField.js` | Danh sách chọn dùng chung (dân tộc, quốc tịch, nơi sinh...) | Cần thêm ô có danh sách chọn |
| `FE/js/data/choices.js` | Dữ liệu danh sách chọn, tên tắt tỉnh cho ô nơi sinh/nguyên quán | Thêm lựa chọn |
| `FE/data/addressMapping.json` | 10.591 bản ghi xã cũ → xã mới | Chỉ khi có nghị quyết mới (xem việc N7) |
| `FE/data/hierarchy.json` | 34 tỉnh, 3.321 xã/phường/đặc khu hiện hành | Như trên |
| `FE/tools/address-audit.js` | **Bộ kiểm tra hồi quy**, chạy trên trình duyệt | Thêm ca kiểm tra khi sửa lỗi mới |
| `BE/services/ocr_cccd.py` | Câu lệnh hướng dẫn model đọc địa chỉ; chuẩn hoá kết quả | Model tách địa chỉ sai |

> ⚠️ **Bẫy**: `FE/js/addressMapping.js` có hàm `findAddressMapping()` và `findAddressMappingFromText()`
> nhưng **không còn được dùng**. Logic đang chạy là `findMappingForHKTT()` trong `app.js`.
> Sửa nhầm hàm cũ sẽ không có tác dụng.

---

## 4. Dữ liệu

### `addressMapping.json`

```json
{
  "oldProvince": "Thành phố Hà Nội",
  "oldDistrict": "Quận Ba Đình",
  "oldWard": "Phường Phúc Xá",
  "newProvince": "Hà Nội",
  "newWard": "Hồng Hà",
  "newWardCode": "00097",
  "type": "merged",
  "confidence": "high",
  "source": "1656/NQ-UBTVQH15: Sắp xếp các đơn vị hành chính cấp xã của thành phố Hà Nội",
  "effectiveDate": "2025-07-01"
}
```

- Mỗi bản ghi = một cặp (xã cũ → xã mới). Xã cũ bị chia thì có **nhiều bản ghi** cùng `old*`, khác `new*`.
- `type`: `merged` (9.579 bản ghi) hoặc `split` (1.012).
- Tên cũ **có tiền tố** ("Tỉnh", "Huyện", "Phường"...). Tên mới **không có tiền tố**.
- Tên huyện trong dữ liệu là tên **ngay trước 01/07/2025**: VD Long Điền + Đất Đỏ đã gộp thành
  "Huyện Long Đất", nên thẻ ghi "Long Điền" sẽ không khớp huyện (code có đường lùi, xem 5.3).

### `hierarchy.json`

```json
{ "data": [ { "name": { "local": "Hà Nội" }, "ward": [ { "name": { "local": "Ba Đình" } } ] } ] }
```

Chỉ có địa giới **mới**, tên **không có tiền tố** (kể cả đặc khu: "Phú Quốc", không phải "Đặc khu Phú Quốc").

---

## 5. Thuật toán, đi qua một ví dụ

Ví dụ OCR trả về (số nhà là dữ liệu giả):

```json
{ "tinh": "BRVT", "quanHuyen": "Thành phố Vũng Tàu", "phuongXa": "P. Thắng Nhất", "soNha": "Số 2 Đường Mẫu" }
```

### 5.1 Chuẩn hoá tên: `normalizeAdministrativeName(value, kind)` (`addressMapping.js`)

Mục tiêu: hai cách ghi khác nhau của **cùng một nơi** ra **cùng một chuỗi** để so sánh.

| Bước | `"P. Thắng Nhất"` (kind = ward) | `"BRVT"` (kind = province) |
|---|---|---|
| Bỏ dấu, chữ thường, bỏ dấu câu và dấu nháy | `p thang nhat` | `brvt` |
| Bỏ tiền tố theo `kind` (regex `prefixes`) | `thang nhat` | `brvt` |
| Tên tắt tỉnh (`PROVINCE_ALIASES`) | | `ba ria vung tau` |

Tiền tố được bỏ theo từng loại:

- province: `tinh`, `thanh pho`, `tp`
- district: `quan`, `huyen`, `thi xa`, `thanh pho`, `tp`, `tx`, `q`, `h`
- ward: `phuong`, `p`, `xa`, `x`, `thi tran`, `tt`

### 5.2 Cũ hay mới: đầu `resolveAddressConversion()` (`app.js`)

Quy tắc quan trọng nhất:

> **Có quận/huyện ghi rõ ⇒ chắc chắn là địa chỉ cũ ⇒ tra bảng chuyển đổi trước.**
> Không có quận/huyện ⇒ thử xem có phải địa chỉ mới (`checkCurrentAddress`), không phải mới thì tra bảng.

Vì sao không kiểm tra "đã là địa chỉ mới" trước? Vì xã cũ có thể trùng tên xã mới trong cùng tỉnh
(Xã Tân Hiệp, Huyện Hóc Môn cũ đã nhập vào xã Hóc Môn mới, trong khi vẫn có một xã Tân Hiệp mới khác).
Kiểm tra "mới" trước sẽ giữ nguyên địa chỉ cũ và cho ra kết quả **trông hợp lệ nhưng sai**.
Trước khi sửa, lỗi này gây 66/300 kết quả sai.

"Quận/huyện ghi rõ" là ô `quanHuyen`, hoặc tách từ chuỗi đúng trong tỉnh đó.
**Không** tính tên huyện tình cờ xuất hiện trong chuỗi (VD "Bình Minh, Nghệ An" chứa tên Thị xã Bình Minh của Vĩnh Long).

### 5.3 Tra bảng: `findMappingForHKTT()` (`app.js`)

1. Lọc bản ghi theo **xã** (so tên đã chuẩn hoá).
2. Lọc tiếp theo **tỉnh**.
3. Có huyện thì lọc theo **huyện**; nếu lọc huyện ra rỗng thì **bỏ qua bước huyện**
   (huyện trên thẻ có thể đã đổi tên, như Long Điền → Long Đất).
4. Gom các **xã mới khác nhau** (`uniqueMappingTargets`):
   - 1 đích → `matched`
   - nhiều đích → thử so tên xã **có dấu** (`wardNameWithTones`), vì cùng huyện có thể có
     "Hoằng Đông" và "Hoằng Đồng"; vẫn nhiều đích → `multiple` (xã bị chia, người dùng chọn)
   - 0 đích → `none`

Với ví dụ: xã `thang nhat` + tỉnh `ba ria vung tau` + huyện `vung tau` → 1 đích: **Rạch Dừa, Hồ Chí Minh**.

### 5.4 Đối chiếu danh mục và số nhà

- `toCurrentTarget()`: tìm đúng tên tỉnh, xã trong `hierarchy.json` (bảo đảm điền vào ô được).
- `cleanCurrentHouseAddress()`: bỏ các phần hành chính lẫn trong số nhà ("Số 2 Đường Mẫu, P. Thắng Nhất" → "Số 2 Đường Mẫu").

### 5.5 Kết quả và giao diện

`resolveAddressConversion()` trả:

```js
{ status, targets: [{ province, ward, source }], house, country }
```

| `status` | Ý nghĩa | Khung hiển thị |
|---|---|---|
| `current` | Đã là địa chỉ mới | "Địa giới mới" + nút điền Chỗ ở hiện nay |
| `matched` | Cũ, có 1 địa chỉ mới | "Địa giới cũ" + địa chỉ mới + nghị quyết + 2 nút |
| `multiple` | Cũ, xã bị chia | Danh sách chọn, nút khoá đến khi chọn |
| `none` | Không tìm thấy | "Chưa xác định", hướng dẫn chọn tay |
| `insufficient` | Thiếu tỉnh hoặc xã | Ẩn khung |

Khung lưu địa chỉ trên thẻ vào 3 ô ẩn (`diaChiHKTTTrenGiayTo`, `hkttTrenGiayTo`, `hkttDaChuyenDoi`)
để **khôi phục** được sau khi chuyển, kể cả khi mở lại hồ sơ đã lưu.

### 5.6 Các bẫy đã gặp (đừng làm hỏng lại)

| Tình huống | Cách code đang xử lý | Ca kiểm tra trong `address-audit.js` |
|---|---|---|
| Xã cũ trùng tên xã mới | Có huyện ⇒ tra bảng trước (5.2) | "Xã cũ trùng tên xã mới cùng tỉnh" |
| Thành phố trùng tên tỉnh (476 bản ghi, VD TP. Tuyên Quang) | `isProvinceCopiedAsDistrict()` chỉ xoá huyện nếu không phải huyện có thật | "Thành phố trùng tên tỉnh" |
| Xã chỉ khác dấu cùng huyện | So có dấu khi nhiều đích (5.3) | "Hai xã chỉ khác dấu" |
| Tên xã bắt đầu "Phương" (bị hiểu nhầm là "P.") | Thử cả tên chưa bỏ tiền tố | "Tên xã bắt đầu bằng Phương" |
| Dấu nháy `'` và `’` (Ea M'nang) | Bỏ dấu nháy khi chuẩn hoá | (mẫu ngẫu nhiên) |
| Chỉ có chuỗi địa chỉ | Tách theo tên **cũ** trong mapping trước (`splitOldAddressText`) | "Chỉ có chuỗi địa chỉ" |

---

## 6. Chạy, gỡ lỗi, kiểm tra

### Chạy giao diện trên máy

```bash
cd FE && python3 -m http.server 5500
```

Mở http://localhost:5500. Không cần chạy BE để làm việc với địa chỉ.

> ⚠️ Trình duyệt **giữ bản JS cũ** (ES module). Sau khi sửa code: mở DevTools → tab Network →
> tích **Disable cache**, hoặc bấm Cmd+Shift+R (Windows: Ctrl+Shift+R).

### Gỡ lỗi

Mở DevTools → Console. Mỗi lần đối chiếu, code ghi:

- `Địa chỉ OCR sau chuẩn hóa: {...}`: tỉnh/huyện/xã sau khi tách
- `Số bản ghi khớp xã/phường: N`, `... + tỉnh: N`: số bản ghi còn lại sau mỗi bước lọc
- `Mapping không có một đích duy nhất`: xã bị chia hoặc lọc chưa đủ
- `Kết quả đối chiếu địa giới HKTT: {status, targets}`: kết quả cuối

Giả lập một kết quả OCR mà không cần ảnh (dán vào Console, dữ liệu giả):

```js
window.dispatchEvent(new CustomEvent("cccdOCRCompleted", { detail: {
  cardType: "old",
  HKTT: { tinh: "BRVT", quanHuyen: "Thành phố Vũng Tàu", phuongXa: "P. Thắng Nhất", soNha: "Số 2 Đường Mẫu", diaChiGoc: "" }
}}));
```

### Bộ kiểm tra hồi quy (bắt buộc trước khi push)

```js
const { runAddressAudit } = await import("/tools/address-audit.js");
await runAddressAudit();
```

Chạy khoảng 1 phút. Kết quả hiện tại:

- 11/11 ca cố định ✅. Ca "Tiền tố Đặc khu" ❌ (chưa hỗ trợ) là bài tập N1.
- 300 xã cũ lấy mẫu × 4 cách ghi: **300/300 đúng, 0 sai** ở cả 4 cách.

**Yêu cầu**: sau khi sửa, cột "Sai" vẫn bằng 0 và không ca cố định nào chuyển từ ✅ sang ❌.
Sửa một lỗi mới ⇒ **thêm ca vào `FIXED_CASES`** trong `FE/tools/address-audit.js` (dùng số nhà giả).

BE có bộ test riêng (`cd BE && python -m pytest tests -q`), cần chạy khi sửa file trong `BE/`.

---

## 7. Danh sách nâng cấp

Làm theo thứ tự. Mỗi việc là một commit riêng.

### N1. Nhận tiền tố "Đặc khu" (dễ, ~1 giờ), nên làm đầu tiên để quen code

**Vì sao**: địa giới mới có 13 đặc khu (Phú Quốc, Côn Đảo, Vân Đồn, Lý Sơn...). Thẻ mới / OCR ghi
"Đặc khu Phú Quốc" nhưng `hierarchy.json` ghi "Phú Quốc". Hiện tại chuẩn hoá không bỏ tiền tố
"đặc khu" ⇒ không nhận ra ⇒ khung báo "Chưa xác định".

**Sửa ở đâu**:

1. `FE/js/addressMapping.js`, hàm `normalizeAdministrativeName`, regex `prefixes.ward`: thêm `dac khu`.
2. `FE/js/app.js`, hàm `wardNameWithTones`: thêm `đặc khu` vào regex bỏ tiền tố.
3. `FE/js/app.js`, hàm `normalizeOCRWard`: cân nhắc chuẩn hoá cách viết tắt nếu có (VD `ĐK.`).

**Xong khi**: ca "Tiền tố Đặc khu" trong `address-audit.js` ✅. Bỏ `todo: true` của ca đó và
thêm ít nhất 1 ca đặc khu khác (VD "Đặc khu Côn Đảo, Hồ Chí Minh"). Cột "Sai" vẫn 0.

### N2. Thêm tên tắt tỉnh (dễ, ~30 phút mỗi lần)

**Vì sao**: thẻ ghi tắt tỉnh theo nhiều kiểu chưa có trong danh sách.

**Sửa ở đâu**: **hai nơi**, phải sửa cả hai:

- `FE/js/addressMapping.js` → `PROVINCE_ALIASES` (dùng để **tra cứu**). Khoá là tên đã bỏ dấu và bỏ khoảng trắng.
- `FE/js/data/choices.js` → `PROVINCE_ALIASES` (dùng cho **ô gợi ý** nơi sinh, nguyên quán).

**Quy tắc**: **không** thêm viết tắt mơ hồ, như `ĐN` (Đà Nẵng hay Đồng Nai?) hoặc `HT` (Hà Tĩnh hay Hà Tây?).

**Xong khi**: thêm 1 ca vào `FIXED_CASES` dùng tên tắt mới, kiểm tra ✅.

### N3. Chịu lỗi chính tả OCR ở tên xã (vừa, ~1 ngày)

**Vì sao**: OCR thỉnh thoảng đọc sai 1–2 ký tự ("Thắng Nhứt" thay vì "Thắng Nhất") ⇒ không khớp ⇒ `none`.

**Gợi ý cách làm**:

1. `addressMapping.js` đã có `similarAdministrativeName()` (cho phép lệch 1–2 ký tự, bỏ qua tên < 6 ký tự).
   Export hàm này.
2. Trong `findMappingForHKTT()`: **chỉ khi** lọc theo xã ra 0 bản ghi, mới lọc lại bằng
   `similarAdministrativeName`, **giới hạn trong đúng tỉnh**.
3. Chỉ nhận khi ra **đúng 1 đích**. Gắn cờ `fuzzy: true` vào kết quả.
4. `addressConvert.js`: khi `fuzzy`, hiện thêm câu cảnh báo, VD "Tên xã trên thẻ có thể bị đọc sai,
   hãy kiểm tra lại", và **không** cho tự động điền.

**Xong khi**: thêm 3 ca có lỗi chính tả vào `FIXED_CASES` ✅; cột "Sai" của mẫu ngẫu nhiên **vẫn 0**
(fuzzy không được làm sai các ca đang đúng).

### N4. Đồng bộ quy tắc "huyện trùng tên tỉnh" ở BE (dễ–vừa, ~2 giờ, có Python)

**Vì sao**: `BE/services/ocr_cccd.py`, hàm `_normalize_result`, đang **xoá quận/huyện nếu trùng tên tỉnh**.
FE đã sửa lỗi này (thành phố trùng tên tỉnh như TP. Tuyên Quang là huyện có thật), BE chưa.
Nếu model trả `quanHuyen: "Tuyên Quang"`, BE xoá mất ⇒ FE mất dấu hiệu "địa chỉ cũ".

**Gợi ý**: bỏ quy tắc xoá ở BE, để FE quyết định (FE có dữ liệu mapping để biết huyện có thật hay không).
Sửa/xoá test liên quan trong `BE/tests/`.

**Xong khi**: `python -m pytest tests -q` đạt; thêm test BE cho trường hợp `tinh = quanHuyen = "Tuyên Quang"`
(BE giữ nguyên `quanHuyen`).

### N5. Gợi ý huyện/xã **cũ** khi nhập tay HKTT (vừa–khó, ~2 ngày)

**Vì sao**: ô Tỉnh và Xã của HKTT chỉ gợi ý theo địa giới **mới**. Người dùng gõ tay địa chỉ cũ
không có gợi ý, dễ gõ sai.

**Gợi ý**:

- Ô `quanHuyenHKTT` hiện là ô nhập thường. Đổi markup sang `.combobox` (xem ô `noiSinh` trong
  `index.html`) và gắn `initChoiceField("quanHuyenHKTT", { options: () => ... })` với danh sách
  huyện cũ lấy từ `addressMappingRecords`, lọc theo tỉnh đang ghi ở `HKTT_Tinh`.
- Ô `phuongXaHKTT` đang do `addressForm.js` điều khiển (gợi ý xã **mới**). Khi `quanHuyenHKTT` có giá trị
  (địa chỉ cũ), cần gợi ý xã **cũ** của huyện đó. Phải sửa `renderWards()` trong `addressForm.js`
  hoặc tách logic; **không** gắn thêm `choiceField` vào ô đã có combobox (hai bộ xử lý sự kiện sẽ đè nhau).
- Làm bản nháp, nhờ người review trước khi hoàn thiện.

**Xong khi**: gõ "Bà Rịa - Vũng Tàu" → ô huyện gợi ý "Thành phố Vũng Tàu"..., chọn huyện → ô xã gợi ý
xã cũ của huyện đó; khung "Địa giới hành chính" ra đúng địa chỉ mới; `address-audit` vẫn đạt.

### N6. Tách logic địa chỉ khỏi `app.js` để có test tự động (khó, ~2–3 ngày, nên làm trước khi mở rộng nhiều)

**Vì sao**: logic nằm lẫn trong `app.js` (≈1.400 dòng) và đọc trực tiếp DOM ⇒ chỉ kiểm tra được trên trình duyệt.

**Gợi ý**:

1. Tạo `FE/js/address/resolveAddress.js` chứa các hàm **thuần** (không đụng `document`):
   chuẩn hoá, `splitOldAddressText`, `parseOldAddress`, `findMappingForHKTT`, `checkCurrentAddress`,
   `resolveAddressConversion`. Dữ liệu (`records`, `provinces`) truyền vào qua tham số thay vì biến toàn cục.
2. `app.js` import và gọi lại, **không đổi hành vi**.
3. Viết `FE/tests/address.test.mjs` dùng `node:test`, đọc `FE/data/*.json`, chuyển các ca trong
   `address-audit.js` sang. Chạy: `node --test FE/tests/`.
4. Xoá `findAddressMapping()` và `findAddressMappingFromText()` cũ không dùng trong `addressMapping.js`.

**Xong khi**: `node --test FE/tests/` đạt; `address-audit.js` cho kết quả **y hệt** trước khi tách.

### N7. Cập nhật dữ liệu khi có nghị quyết mới (vừa, theo đợt)

1. Cập nhật bộ dữ liệu gốc trong `20250701-main/` (hoặc nguồn mới).
2. `convert_address_mapping.py` đang ghi cứng `ROOT = Path(r"D:\cmnd")`: đổi thành
   `Path(__file__).resolve().parent` rồi chạy `python3 convert_address_mapping.py`.
3. **Xem diff** `FE/data/addressMapping.json`: số bản ghi thay đổi, các xã bị chia mới. Ghi lại trong commit.
4. Chạy `address-audit.js`. Ca cố định nào đổi đáp án do dữ liệu mới thì sửa `expect` và ghi lý do.

---

## 8. Quy trình làm việc

1. Tạo nhánh từ `main`: `git checkout -b nang-cap/n1-dac-khu`.
2. Sửa code. Mỗi việc ở phần 7 là một commit.
3. Kiểm tra trước khi push:
   - [ ] `node --check` cho mọi file `.js` đã sửa (bắt lỗi cú pháp)
   - [ ] `address-audit.js`: cột "Sai" = 0, không ca nào từ ✅ sang ❌
   - [ ] Thử tay trên giao diện: quét (hoặc giả lập) → bấm "Chuyển HKTT sang địa chỉ mới" → "Khôi phục"
     → "Điền vào Chỗ ở hiện nay" → Lưu hồ sơ → mở lại hồ sơ
   - [ ] Sửa `BE/` thì chạy `python -m pytest tests -q`
   - [ ] Cập nhật `FE/README.md` nếu đổi hành vi người dùng thấy được
4. Push nhánh, tạo Pull Request, mô tả **trước/sau** bằng số liệu của `address-audit.js`.
5. Chờ review rồi mới gộp vào `main` (gộp vào `main` là tự deploy lên Vercel/Render).

### Quy tắc bắt buộc

- **Không** commit ảnh CCCD thật, địa chỉ / họ tên / số CCCD của người thật, kể cả trong test.
  Dùng số nhà, tên đường giả; tên tỉnh/huyện/xã là dữ liệu công khai, dùng được.
- **Không** commit file `.env` hay API key.
- Không sửa `FE/data/*.json` bằng tay. Dữ liệu sinh lại bằng script (việc N7).
- Không tự chọn một đích khi xã bị chia: luôn để người dùng chọn.
