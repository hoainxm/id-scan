"""
Chạy: cd BE && python -m pytest tests -v

Toàn bộ dữ liệu trong file này là dữ liệu GIẢ, tự sinh MRZ có check digit đúng.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.cccd_verify import (  # noqa: E402
    check_id_structure,
    mrz_check_digit,
    parse_mrz,
    parse_qr_text,
    strip_accents,
    verify_ocr_result,
)


def build_mrz(id12="001099012345", dob="900101", sex="M", expiry="300101",
              name="NGUYEN<<VAN<MAU"):
    """Sinh MRZ TD1 hợp lệ theo bố cục CCCD Việt Nam."""
    doc9 = id12[3:]
    line1 = f"IDVNM{doc9}{mrz_check_digit(doc9)}{id12}<<{mrz_check_digit(id12)}"
    line2 = f"{dob}{mrz_check_digit(dob)}{sex}{expiry}{mrz_check_digit(expiry)}VNM" + "<" * 11
    composite = line1[5:30] + line2[0:7] + line2[8:15] + line2[18:29]
    line2 += mrz_check_digit(composite)
    line3 = name.ljust(30, "<")
    return "\n".join((line1, line2, line3))


def sample_ocr(**overrides):
    data = {
        "cardType": "old",
        "soGiayTo": "001090012345",
        "hoDem": "NGUYỄN VĂN",
        "ten": "MẪU",
        "hoTen": "NGUYỄN VĂN MẪU",
        "ngaySinh": "01/01/1990",
        "gioiTinh": "Nam",
        "quocTich": "Việt Nam",
        "danToc": "",
        "nguyenQuan": "",
        "noiSinh": "",
        "noiCapGiayTo": "",
        "ngayCap": "01/01/2021",
        "ngayHetHan": "01/01/2030",
        "HKTT": {"quocGia": "", "tinh": "", "quanHuyen": "", "phuongXa": "", "soNha": "", "diaChiGoc": "Số 1, Phường A, Tỉnh B"},
    }
    data.update(overrides)
    return data


class TestMRZ(unittest.TestCase):
    def test_check_digit_icao_example(self):
        # Ví dụ chuẩn ICAO 9303: số hộ chiếu L898902C3 -> check digit 6.
        self.assertEqual(mrz_check_digit("L898902C3"), "6")

    def test_parse_valid_mrz(self):
        mrz = parse_mrz(build_mrz(id12="001090012345", dob="900101", expiry="300101"))
        self.assertTrue(mrz["valid"], mrz["errors"])
        self.assertEqual(mrz["soGiayTo"], "001090012345")
        self.assertEqual(mrz["ngaySinh"], "01/01/1990")
        self.assertEqual(mrz["ngayHetHan"], "01/01/2030")
        self.assertEqual(mrz["gioiTinh"], "Nam")
        self.assertEqual(mrz["hoTenKhongDau"], "NGUYEN VAN MAU")

    def test_detects_misread_character(self):
        text = build_mrz(dob="900101")
        lines = text.split("\n")
        lines[1] = "910101" + lines[1][6:]  # LLM chép sai 1 chữ số ngày sinh
        mrz = parse_mrz("\n".join(lines))
        self.assertFalse(mrz["valid"])
        self.assertIn("check digit ngày sinh", mrz["errors"])

    def test_llm_miscounted_filler_is_repaired(self):
        # Lỗi thật gặp khi audit: LLM chép thiếu ký tự "<" (dòng 2 còn 29, dòng 3 còn 28).
        lines = build_mrz(id12="001090012345").split("\n")
        lines[1] = lines[1][:18] + lines[1][19:]
        lines[2] = lines[2][:-2]
        mrz = parse_mrz("\n".join(lines))
        self.assertTrue(mrz["valid"], mrz["errors"])
        self.assertEqual(mrz["soGiayTo"], "001090012345")

    def test_filler_repair_does_not_hide_wrong_digits(self):
        lines = build_mrz().split("\n")
        lines[1] = "910101" + lines[1][6:18] + lines[1][19:]  # sai ngày sinh + thiếu "<"
        self.assertFalse(parse_mrz("\n".join(lines))["valid"])

    def test_wrong_shape(self):
        self.assertFalse(parse_mrz("IDVNM123\nabc")["valid"])
        self.assertIsNone(parse_mrz(""))


class TestIdStructure(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(check_id_structure("001090012345", "Nam", "01/01/1990"), [])
        self.assertEqual(check_id_structure("079303012345", "Nữ", "05/05/2003"), [])

    def test_gender_and_year_mismatch(self):
        errors = check_id_structure("001090012345", "Nữ", "01/01/1991")
        self.assertEqual(len(errors), 2)

    def test_bad_format(self):
        self.assertTrue(check_id_structure("00109001234", "Nam", ""))
        self.assertTrue(check_id_structure("999090012345", "Nam", "01/01/1990"))


class TestQR(unittest.TestCase):
    def test_parse(self):
        qr = parse_qr_text("001090012345|123456789|Nguyễn Văn Mẫu|01011990|Nam|Số 1, Phường A, Tỉnh B|01012021")
        self.assertEqual(qr["ngaySinh"], "01/01/1990")
        self.assertEqual(qr["ngayCap"], "01/01/2021")
        self.assertEqual(qr["hoTen"], "Nguyễn Văn Mẫu")

    def test_reject_non_cccd(self):
        self.assertIsNone(parse_qr_text("https://example.com"))
        self.assertIsNone(parse_qr_text("abc|def|g|h|i|j|k"))


class TestVerify(unittest.TestCase):
    def test_clean_result_has_no_warnings(self):
        out = verify_ocr_result(sample_ocr(), mrz_text=build_mrz(id12="001090012345"))
        self.assertEqual(out["validation"]["warnings"], [])
        self.assertEqual(out["validation"]["sources"]["mrz"], "valid")

    def test_qr_overrides_wrong_ocr(self):
        qr = parse_qr_text("001090012345||NGUYỄN VĂN MẪU|01011990|Nam|Số 1, Phường A|01012021")
        no_address = {"quocGia": "", "tinh": "", "quanHuyen": "", "phuongXa": "", "soNha": "", "diaChiGoc": ""}
        out = verify_ocr_result(
            sample_ocr(soGiayTo="001090012346", hoTen="NGUYỄN VĂN MẨU", ten="MẨU", HKTT=no_address), qr=qr
        )
        self.assertEqual(out["data"]["soGiayTo"], "001090012345")
        self.assertEqual(out["data"]["ten"], "MẪU")
        self.assertEqual(out["data"]["HKTT"]["diaChiGoc"], "Số 1, Phường A")
        self.assertEqual(out["validation"]["sources"]["qr"], "corrected")
        fields = {c["field"] for c in out["validation"]["corrections"]}
        self.assertTrue({"soGiayTo", "hoTen", "HKTT.diaChiGoc"} <= fields)

    def test_qr_name_keeps_uppercase_like_card(self):
        qr = parse_qr_text("001090012345||Nguyễn Văn Mẫu|01011990|Nam|addr|01012021")
        out = verify_ocr_result(sample_ocr(hoTen="NGUYỄN VĂN MẨU", ten="MẨU"), qr=qr)
        self.assertEqual(out["data"]["hoTen"], "NGUYỄN VĂN MẪU")

    def test_empty_required_field_is_flagged(self):
        out = verify_ocr_result(sample_ocr(ngayCap=""))
        self.assertIn("ngayCap", out["validation"]["needsReview"])

    def test_mrz_flags_but_does_not_override(self):
        out = verify_ocr_result(
            sample_ocr(ngayHetHan="01/01/2031"),
            mrz_text=build_mrz(id12="001090012345", expiry="300101"),
        )
        self.assertEqual(out["data"]["ngayHetHan"], "01/01/2031")
        warn = [w for w in out["validation"]["warnings"] if w["field"] == "ngayHetHan"]
        self.assertEqual(warn[0]["suggestion"], "01/01/2030")

    def test_invalid_mrz_is_not_used(self):
        bad = build_mrz().replace("NGUYEN<<VAN<MAU", "TRAN<<VAN<KHAC")
        bad = bad.split("\n")
        bad[1] = bad[1][:-1] + ("0" if bad[1][-1] != "0" else "1")
        out = verify_ocr_result(sample_ocr(), mrz_text="\n".join(bad))
        self.assertEqual(out["validation"]["sources"]["mrz"], "invalid")
        self.assertNotIn("hoTen", out["validation"]["needsReview"])

    def test_logic_rules(self):
        out = verify_ocr_result(sample_ocr(ngayCap="01/01/1980", gioiTinh="Male"))
        self.assertTrue({"ngayCap", "gioiTinh"} <= set(out["validation"]["needsReview"]))

        out = verify_ocr_result(sample_ocr(ngaySinh="1/1/90"))
        self.assertIn("ngaySinh", out["validation"]["needsReview"])

    def test_no_expiry_is_allowed(self):
        out = verify_ocr_result(sample_ocr(ngayHetHan="Không thời hạn"))
        self.assertNotIn("ngayHetHan", out["validation"]["needsReview"])

    def test_input_not_mutated(self):
        data = sample_ocr()
        qr = parse_qr_text("001090012399||X Y|01011990|Nam|addr|01012021")
        verify_ocr_result(data, qr=qr)
        self.assertEqual(data["soGiayTo"], "001090012345")
        self.assertEqual(data["HKTT"]["diaChiGoc"], "Số 1, Phường A, Tỉnh B")

    def test_strip_accents(self):
        self.assertEqual(strip_accents("Đặng Thị Ánh"), "DANG THI ANH")


if __name__ == "__main__":
    unittest.main()
