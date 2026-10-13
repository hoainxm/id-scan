"""
Kiểm chứng kết quả OCR CCCD bằng các nguồn có thể kiểm tra được, chạy 100% local.

Nguồn kiểm chứng (độ tin cậy giảm dần):
1. QR code trên thẻ (CCCD gắn chip 2021: mặt trước; Thẻ căn cước 2024: mặt sau).
   Dữ liệu do cơ quan cấp mã hoá -> chính xác tuyệt đối khi giải mã được.
   Định dạng: soCCCD|soCMND|hoTen|ngaySinh(DDMMYYYY)|gioiTinh|diaChi|ngayCap(DDMMYYYY)|...
2. MRZ (3 dòng mã máy đọc ở mặt sau, chuẩn ICAO 9303 TD1) có check digit.
   Chuỗi MRZ do LLM chép lại, nên chỉ tin khi check digit khớp.
3. Cấu trúc số định danh 12 số (Thông tư 59/2021/TT-BCA):
   3 số mã tỉnh + 1 số giới tính/thế kỷ + 2 số cuối năm sinh + 6 số ngẫu nhiên.
4. Ràng buộc logic giữa các trường (ngày tháng, giới tính, họ tên).

Chính sách:
- QR giải mã được -> ghi đè trường OCR sai (kèm danh sách corrections để FE hiển thị).
- MRZ / cấu trúc số / logic -> KHÔNG ghi đè, chỉ cảnh báo + gợi ý giá trị đúng.
"""

import re
import unicodedata
from datetime import date, datetime

import cv2
import numpy as np

try:
    import zxingcpp
except ImportError:  # Thiếu thư viện thì bỏ qua bước QR, không làm sập OCR.
    zxingcpp = None


# ============================================================
# TIỆN ÍCH
# ============================================================

def strip_accents(value: str) -> str:
    """'Nguyễn Văn Đức' -> 'NGUYEN VAN DUC' (dùng so khớp với MRZ)."""
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.replace("đ", "d").replace("Đ", "D")
    return " ".join(value.upper().split())


def _same_text(a: str, b: str) -> bool:
    return " ".join(unicodedata.normalize("NFC", a or "").casefold().split()) == " ".join(
        unicodedata.normalize("NFC", b or "").casefold().split()
    )


def parse_date(value: str):
    """'DD/MM/YYYY' -> date; sai định dạng -> None."""
    try:
        return datetime.strptime((value or "").strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _fmt(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _ddmmyyyy_to_date(value: str):
    try:
        return datetime.strptime(value, "%d%m%Y").date()
    except ValueError:
        return None


# ============================================================
# 1. QR CODE
# ============================================================

def _decode_qr_text(image) -> str:
    if zxingcpp is None or image is None:
        return ""

    candidates = [image]
    h, w = image.shape[:2]
    if max(h, w) < 2500:
        candidates.append(cv2.resize(image, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))

    for candidate in candidates:
        for result in zxingcpp.read_barcodes(candidate):
            if result.format == zxingcpp.BarcodeFormat.QRCode and "|" in result.text:
                return result.text
    return ""


def parse_qr_text(text: str):
    """Tách chuỗi QR CCCD. Không đúng cấu trúc -> None."""
    parts = (text or "").split("|")
    if len(parts) < 7 or not re.fullmatch(r"\d{12}", parts[0]):
        return None

    birth = _ddmmyyyy_to_date(parts[3])
    issue = _ddmmyyyy_to_date(parts[6])

    return {
        "soGiayTo": parts[0],
        "soCMND": parts[1],
        "hoTen": parts[2].strip(),
        "ngaySinh": _fmt(birth) if birth else "",
        "gioiTinh": parts[4].strip(),
        "diaChi": parts[5].strip(),
        "ngayCap": _fmt(issue) if issue else "",
    }


def read_qr(image_bytes_list):
    """Thử đọc QR trên lần lượt các ảnh. Trả dict hoặc None."""
    for image_bytes in image_bytes_list:
        if not image_bytes:
            continue
        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        parsed = parse_qr_text(_decode_qr_text(image))
        if parsed:
            return parsed
    return None


# ============================================================
# 2. MRZ (ICAO 9303 - TD1, 3 dòng x 30 ký tự)
# ============================================================

_MRZ_WEIGHTS = (7, 3, 1)


def mrz_check_digit(data: str) -> str:
    total = 0
    for i, ch in enumerate(data):
        if ch.isdigit():
            value = int(ch)
        elif "A" <= ch <= "Z":
            value = ord(ch) - 55
        else:  # '<'
            value = 0
        total += value * _MRZ_WEIGHTS[i % 3]
    return str(total % 10)


def _mrz_date(yymmdd: str, future: bool):
    if not re.fullmatch(r"\d{6}", yymmdd or ""):
        return None
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:])
    today = date.today()
    if future:
        year = 2000 + yy
    else:
        year = 2000 + yy if 2000 + yy <= today.year else 1900 + yy
    try:
        return date(year, mm, dd)
    except ValueError:
        return None


def _fix_filler(line: str, trailing: bool) -> str:
    """
    LLM chép MRZ đúng ký tự dữ liệu nhưng hay đếm sai số ký tự đệm "<".
    Co/giãn dải "<" dài nhất (dòng 3: dải cuối) cho đủ 30 ký tự.
    Không tự "sửa" dữ liệu: check digit vẫn quyết định MRZ có hợp lệ hay không.
    """
    if len(line) == 30:
        return line
    if trailing:
        return line.rstrip("<").ljust(30, "<")[:30]

    runs = list(re.finditer(r"<{2,}", line))
    if not runs:
        return line
    run = max(runs, key=lambda m: m.end() - m.start())
    new_len = (run.end() - run.start()) + (30 - len(line))
    if new_len < 1:
        return line
    return line[: run.start()] + "<" * new_len + line[run.end():]


def parse_mrz(text: str):
    """
    Trả None nếu không có MRZ, ngược lại dict:
    { valid: bool, errors: [...], soGiayTo, ngaySinh, gioiTinh, ngayHetHan, hoTenKhongDau }
    """
    raw = (text or "").upper().replace("«", "<").replace(" ", "")
    lines = [line for line in re.split(r"[\r\n]+", raw) if line]
    if not lines:
        return None

    if len(lines) == 3:
        lines = [
            _fix_filler(lines[0], trailing=False),
            _fix_filler(lines[1], trailing=False),
            _fix_filler(lines[2], trailing=True),
        ]

    if len(lines) != 3 or any(len(line) != 30 for line in lines):
        return {"valid": False, "errors": ["MRZ không đủ 3 dòng x 30 ký tự"]}

    l1, l2, l3 = lines
    errors = []

    doc_number = l1[5:14]
    if mrz_check_digit(doc_number) != l1[14]:
        errors.append("check digit số giấy tờ")
    if mrz_check_digit(l2[0:6]) != l2[6]:
        errors.append("check digit ngày sinh")
    if l2[8:14].isdigit() and mrz_check_digit(l2[8:14]) != l2[14]:
        errors.append("check digit ngày hết hạn")
    composite = l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]
    if mrz_check_digit(composite) != l2[29]:
        errors.append("check digit tổng")

    # CCCD Việt Nam: phần optional dòng 1 bắt đầu bằng số định danh 12 số.
    # Ký tự cuối dòng 1 là check digit của 12 số đó (đã đối chiếu với thẻ thật).
    full_id = l1[15:27] if re.fullmatch(r"\d{12}", l1[15:27]) else ""
    if full_id and l1[29].isdigit() and mrz_check_digit(full_id) != l1[29]:
        errors.append("check digit số định danh 12 số")

    sex = {"M": "Nam", "F": "Nữ"}.get(l2[7], "")
    birth = _mrz_date(l2[0:6], future=False)
    expiry = _mrz_date(l2[8:14], future=True)

    name = l3.rstrip("<").replace("<<", " ").replace("<", " ")

    return {
        "valid": not errors,
        "errors": errors,
        "soGiayTo": full_id,
        "soGiayTo9": doc_number,
        "ngaySinh": _fmt(birth) if birth else "",
        "gioiTinh": sex,
        "ngayHetHan": _fmt(expiry) if expiry else "",
        "hoTenKhongDau": " ".join(name.split()),
    }


# ============================================================
# 3. CẤU TRÚC SỐ ĐỊNH DANH 12 SỐ
# ============================================================

# Chữ số thứ 4: (giới tính, thế kỷ sinh)
_ID_GENDER_CENTURY = {
    "0": ("Nam", 1900), "1": ("Nữ", 1900),
    "2": ("Nam", 2000), "3": ("Nữ", 2000),
    "4": ("Nam", 2100), "5": ("Nữ", 2100),
}


def check_id_structure(so_giay_to: str, gioi_tinh: str, ngay_sinh: str):
    """Trả danh sách lỗi (rỗng = hợp lệ)."""
    errors = []
    if not re.fullmatch(r"\d{12}", so_giay_to or ""):
        return ["Số định danh phải gồm đúng 12 chữ số"]

    province = int(so_giay_to[:3])
    if not 1 <= province <= 96:
        errors.append("3 số đầu (mã tỉnh nơi đăng ký khai sinh) không hợp lệ")

    gender_century = _ID_GENDER_CENTURY.get(so_giay_to[3])
    birth = parse_date(ngay_sinh)

    if gender_century:
        gender, century = gender_century
        if gioi_tinh and gioi_tinh != gender:
            errors.append(f"Chữ số thứ 4 cho biết giới tính {gender}, khác giới tính đọc được")
        if birth and century + int(so_giay_to[4:6]) != birth.year:
            errors.append("Chữ số 4-6 (thế kỷ + năm sinh) không khớp ngày sinh")
    else:
        errors.append("Chữ số thứ 4 (mã giới tính/thế kỷ) không hợp lệ")

    return errors


# ============================================================
# 4. HÀM CHÍNH
# ============================================================

def verify_ocr_result(data: dict, qr=None, mrz_text: str = "") -> dict:
    """
    Đối chiếu + sửa kết quả OCR. Trả { data, validation }.
    data được copy, không sửa dict đầu vào.
    """
    data = {**data, "HKTT": dict(data.get("HKTT") or {})}
    warnings = []
    corrections = []

    def warn(field, message, suggestion=""):
        item = {"field": field, "message": message}
        if suggestion:
            item["suggestion"] = suggestion
        warnings.append(item)

    # ---------- QR: ghi đè ----------
    qr_status = "absent"
    if qr:
        qr_status = "matched"
        for field in ("soGiayTo", "hoTen", "ngaySinh", "gioiTinh", "ngayCap"):
            qr_value = qr.get(field, "")
            # QR lưu họ tên dạng "Nguyễn Văn A"; thẻ in hoa -> giữ kiểu in hoa như OCR.
            if field == "hoTen" and data.get(field, "").isupper():
                qr_value = qr_value.upper()
            if qr_value and not _same_text(qr_value, data.get(field, "")):
                corrections.append({
                    "field": field,
                    "ocrValue": data.get(field, ""),
                    "value": qr_value,
                    "source": "QR",
                })
                data[field] = qr_value
                qr_status = "corrected"

        if any(c["field"] == "hoTen" for c in corrections):
            parts = data["hoTen"].split()
            data["ten"] = parts[-1] if parts else ""
            data["hoDem"] = " ".join(parts[:-1])

        if qr.get("diaChi") and not data["HKTT"].get("diaChiGoc"):
            data["HKTT"]["diaChiGoc"] = qr["diaChi"]
            corrections.append({"field": "HKTT.diaChiGoc", "ocrValue": "", "value": qr["diaChi"], "source": "QR"})

    # ---------- MRZ: cảnh báo ----------
    mrz = parse_mrz(mrz_text)
    mrz_status = "absent"
    if mrz:
        mrz_status = "valid" if mrz["valid"] else "invalid"
        if mrz["valid"]:
            pairs = [
                ("soGiayTo", mrz["soGiayTo"]),
                ("ngaySinh", mrz["ngaySinh"]),
                ("gioiTinh", mrz["gioiTinh"]),
                ("ngayHetHan", mrz["ngayHetHan"]),
            ]
            for field, mrz_value in pairs:
                if mrz_value and data.get(field) and mrz_value != data[field]:
                    warn(field, "Khác với dữ liệu MRZ mặt sau (đã qua check digit)", mrz_value)
            if (
                mrz["hoTenKhongDau"]
                and data.get("hoTen")
                and strip_accents(data["hoTen"]) != mrz["hoTenKhongDau"]
            ):
                warn("hoTen", "Họ tên (bỏ dấu) khác với MRZ mặt sau", mrz["hoTenKhongDau"])
        # MRZ chép sai check digit: không dùng để kết luận, chỉ ghi nhận trạng thái.

    # ---------- Cấu trúc số định danh ----------
    so = data.get("soGiayTo", "")
    if so:
        for message in check_id_structure(so, data.get("gioiTinh", ""), data.get("ngaySinh", "")):
            warn("soGiayTo", message)
    else:
        warn("soGiayTo", "Không đọc được số định danh")

    # ---------- Trường bắt buộc bị trống ----------
    for field in ("hoTen", "ngaySinh", "gioiTinh", "ngayCap", "ngayHetHan"):
        if not data.get(field):
            warn(field, "Không đọc được, cần nhập tay")
    if not data["HKTT"].get("diaChiGoc"):
        warn("HKTT.diaChiGoc", "Không đọc được địa chỉ, cần nhập tay")

    # ---------- Logic ngày tháng / giới tính / họ tên ----------
    today = date.today()
    birth = parse_date(data.get("ngaySinh", ""))
    issue = parse_date(data.get("ngayCap", ""))
    expiry_raw = data.get("ngayHetHan", "")
    expiry = parse_date(expiry_raw)

    for field, value, parsed in (
        ("ngaySinh", data.get("ngaySinh", ""), birth),
        ("ngayCap", data.get("ngayCap", ""), issue),
    ):
        if value and not parsed:
            warn(field, "Ngày không đúng định dạng DD/MM/YYYY")

    if expiry_raw and not expiry and "thời hạn" not in expiry_raw.casefold():
        warn("ngayHetHan", "Ngày không đúng định dạng DD/MM/YYYY")

    if birth and birth > today:
        warn("ngaySinh", "Ngày sinh ở tương lai")
    if issue and issue > today:
        warn("ngayCap", "Ngày cấp ở tương lai")
    if birth and issue and issue <= birth:
        warn("ngayCap", "Ngày cấp phải sau ngày sinh")
    if issue and expiry and expiry <= issue:
        warn("ngayHetHan", "Ngày hết hạn phải sau ngày cấp")
    if expiry and expiry < today:
        warn("ngayHetHan", "Giấy tờ đã hết hạn")

    if data.get("gioiTinh") and data["gioiTinh"] not in ("Nam", "Nữ"):
        warn("gioiTinh", "Giới tính chỉ nhận 'Nam' hoặc 'Nữ'")

    if data.get("hoTen") and data.get("ten"):
        joined = " ".join(p for p in (data.get("hoDem", ""), data["ten"]) if p)
        if not _same_text(joined, data["hoTen"]):
            warn("hoTen", "Họ đệm + Tên không ghép đúng thành Họ và tên")

    needs_review = sorted({w["field"] for w in warnings})

    return {
        "data": data,
        "validation": {
            "sources": {"qr": qr_status, "mrz": mrz_status},
            "corrections": corrections,
            "warnings": warnings,
            "needsReview": needs_review,
        },
    }
