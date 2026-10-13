"""
Audit độ chính xác chức năng quét CCCD trên bộ ảnh có nhãn (ground truth).

Chạy:
    cd BE && python -m tools.audit_ocr --labels <labels.json> --runs 2 --out <report.json>

labels.json (KHÔNG commit, chứa dữ liệu cá nhân) là mảng các object:
    { "id", "front", "back" (đường dẫn tính từ gốc repo), "cardType",
      "soGiayTo", "hoTen", "ngaySinh", "gioiTinh", "quocTich", "nguyenQuan",
      "ngayCap", "ngayHetHan", "diaChiGoc", "mrz" (3 dòng, cách nhau bởi \\n) }

Đo theo chức năng:
1. Cắt chân dung: mặt trước phải ra chân dung, mặt sau phải bị từ chối.
2. QR: tỉ lệ giải mã được.
3. OCR Groq: độ chính xác từng trường TRƯỚC và SAU bước kiểm chứng (QR/MRZ/logic).
4. MRZ do LLM chép: tỉ lệ qua check digit, tỉ lệ chép đúng nguyên văn.
5. Cảnh báo: đúng (trường sai được cảnh báo), báo nhầm, bỏ sót.
"""

import argparse
import json
import re
import statistics
import time
import unicodedata
from pathlib import Path

from groq import RateLimitError

from services import groq_cccd
from services.cccd_verify import parse_mrz, read_qr
from services.portrait_service import crop_portrait_from_bytes

REPO_DIR = Path(__file__).resolve().parents[2]

FIELDS = [
    "cardType", "soGiayTo", "hoTen", "ngaySinh", "gioiTinh", "quocTich",
    "nguyenQuan", "ngayCap", "ngayHetHan", "diaChiGoc",
]


def norm(value: str) -> str:
    value = unicodedata.normalize("NFC", value or "").casefold()
    return " ".join(value.split())


def norm_address(value: str) -> str:
    """So địa chỉ bỏ qua dấu câu và khoảng trắng (OCR hay đổi ',' '.' '-')."""
    return re.sub(r"[\s.,\-–]", "", norm(value))


def field_value(data: dict, field: str) -> str:
    if field == "diaChiGoc":
        return (data.get("HKTT") or {}).get("diaChiGoc", "")
    return data.get(field, "")


def is_correct(field: str, got: str, expected: str) -> bool:
    if field == "diaChiGoc":
        return norm_address(got) == norm_address(expected)
    return norm(got) == norm(expected)


def run_ocr(front: bytes, back: bytes, retries: int = 3):
    """Gọi pipeline thật, đồng thời giữ lại kết quả OCR thô trước kiểm chứng."""
    captured = {}
    original = groq_cccd.verify_ocr_result

    def spy(data, qr=None, mrz_text=""):
        captured["raw"] = data
        captured["mrz_text"] = mrz_text
        return original(data, qr=qr, mrz_text=mrz_text)

    groq_cccd.verify_ocr_result = spy
    try:
        for attempt in range(retries):
            try:
                start = time.time()
                verified = groq_cccd.extract_cccd(front, back)
                return captured, verified, time.time() - start
            except RateLimitError:
                time.sleep(20 * (attempt + 1))
        raise RuntimeError("Hết hạn mức Groq sau nhiều lần thử")
    finally:
        groq_cccd.verify_ocr_result = original


def audit(labels, runs: int, pause: float):
    report = {"portrait": [], "qr": [], "ocr": []}

    for label in labels:
        front = (REPO_DIR / label["front"]).read_bytes()
        back = (REPO_DIR / label["back"]).read_bytes()

        # 1. Chân dung
        for side, data, expect_face in (("front", front, True), ("back", back, False)):
            start = time.time()
            try:
                crop_portrait_from_bytes(data)
                got_face = True
            except ValueError:
                got_face = False
            report["portrait"].append({
                "id": label["id"], "side": side,
                "correct": got_face == expect_face,
                "seconds": round(time.time() - start, 2),
            })

        # 2. QR
        report["qr"].append({"id": label["id"], "decoded": read_qr([front, back]) is not None})

        # 3-5. OCR
        for run in range(runs):
            captured, verified, seconds = run_ocr(front, back)
            raw, final = captured["raw"], verified["data"]
            validation = verified["validation"]

            mrz_text = captured["mrz_text"]
            mrz = parse_mrz(mrz_text)
            expected_mrz = label["mrz"].replace(" ", "")

            fields = {}
            for field in FIELDS:
                expected = label.get(field, "")
                fields[field] = {
                    "expected": expected,
                    "raw": field_value(raw, field),
                    "final": field_value(final, field),
                    "rawCorrect": is_correct(field, field_value(raw, field), expected),
                    "finalCorrect": is_correct(field, field_value(final, field), expected),
                }

            wrong = {f for f, r in fields.items() if not r["finalCorrect"]}
            warned = set(validation["needsReview"]) & set(FIELDS)

            report["ocr"].append({
                "id": label["id"], "run": run + 1, "seconds": round(seconds, 2),
                "fields": fields,
                "mrz": {
                    "text": mrz_text,
                    "returned": bool(mrz_text),
                    "valid": bool(mrz and mrz.get("valid")),
                    "exact": mrz_text.replace(" ", "").strip() == expected_mrz,
                },
                "data": final,
                "sources": validation["sources"],
                "corrections": validation["corrections"],
                "warnings": validation["warnings"],
                "warn": {
                    "truePositive": sorted(wrong & warned),
                    "falsePositive": sorted(warned - wrong),
                    "missed": sorted(wrong - warned),
                },
            })
            time.sleep(pause)

    return report


def summarize(report) -> dict:
    ocr = report["ocr"]
    pct = lambda n, d: f"{n}/{d} ({100 * n / d:.0f}%)" if d else "-"

    per_field = {}
    for field in FIELDS:
        rows = [r["fields"][field] for r in ocr]
        per_field[field] = {
            "raw": pct(sum(r["rawCorrect"] for r in rows), len(rows)),
            "final": pct(sum(r["finalCorrect"] for r in rows), len(rows)),
        }

    cards_all_correct = sum(all(f["finalCorrect"] for f in r["fields"].values()) for r in ocr)

    # Ổn định: cùng ảnh, các lần chạy cho cùng kết quả cuối không
    by_id = {}
    for r in ocr:
        by_id.setdefault(r["id"], []).append(
            json.dumps({k: v["final"] for k, v in r["fields"].items()}, ensure_ascii=False)
        )
    stable = sum(len(set(v)) == 1 for v in by_id.values())

    portrait = report["portrait"]
    return {
        "portrait": {
            "front_ok": pct(sum(p["correct"] for p in portrait if p["side"] == "front"),
                            sum(p["side"] == "front" for p in portrait)),
            "back_rejected": pct(sum(p["correct"] for p in portrait if p["side"] == "back"),
                                 sum(p["side"] == "back" for p in portrait)),
        },
        "qr_decoded": pct(sum(q["decoded"] for q in report["qr"]), len(report["qr"])),
        "ocr_fields": per_field,
        "ocr_cards_all_fields_correct": pct(cards_all_correct, len(ocr)),
        "ocr_stable_across_runs": pct(stable, len(by_id)),
        "ocr_seconds_median": round(statistics.median(r["seconds"] for r in ocr), 2) if ocr else None,
        "mrz": {
            "returned": pct(sum(r["mrz"]["returned"] for r in ocr), len(ocr)),
            "check_digits_ok": pct(sum(r["mrz"]["valid"] for r in ocr), len(ocr)),
            "exact": pct(sum(r["mrz"]["exact"] for r in ocr), len(ocr)),
        },
        "warnings": {
            "truePositive": sum(len(r["warn"]["truePositive"]) for r in ocr),
            "falsePositive": sum(len(r["warn"]["falsePositive"]) for r in ocr),
            "missed": sum(len(r["warn"]["missed"]) for r in ocr),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--pause", type=float, default=3.0, help="nghỉ giữa các lần gọi Groq (giây)")
    parser.add_argument("--out", help="ghi báo cáo chi tiết JSON (chứa dữ liệu cá nhân, KHÔNG commit)")
    args = parser.parse_args()

    labels = json.loads(Path(args.labels).read_text(encoding="utf-8"))
    report = audit(labels, args.runs, args.pause)
    report["summary"] = summarize(report)

    if args.out:
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
