
import json
import re
import unicodedata
from pathlib import Path

# Các đường dẫn trong dự án
ROOT = Path(r"D:\cmnd")
REPO = ROOT / "20250701-main" / "20250701-main"
OUTPUT_DIR = REPO / "output"
HIERARCHY_FILE = ROOT / "FE" / "data" / "hierarchy.json"
SAVE_FILE = ROOT / "FE" / "data" / "addressMapping.json"

EFFECTIVE_DATE = "2025-07-01"


def normalize(text):
    """Chuẩn hóa chữ để so sánh tên địa danh."""
    text = str(text or "").strip().lower()
    text = text.replace("đ", "d")
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def remove_prefix(name, prefixes):
    """Bỏ tiền tố hành chính khi cần đối chiếu dữ liệu hiện hành."""
    name = str(name or "").strip()
    for prefix in prefixes:
        if normalize(name).startswith(normalize(prefix) + " "):
            return name[len(prefix):].strip()
    return name


def load_json(path):
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[Bỏ qua] {path}: {exc}")
        return None


def main():
    if not OUTPUT_DIR.is_dir():
        raise FileNotFoundError(f"Không tìm thấy thư mục: {OUTPUT_DIR}")

    hierarchy = load_json(HIERARCHY_FILE)
    if not hierarchy or not isinstance(hierarchy.get("data"), list):
        raise ValueError("Không đọc được danh sách tỉnh/thành trong hierarchy.json")

    # Tạo danh sách tên chuẩn theo dữ liệu 34 tỉnh/thành hiện hành.
    provinces = {}
    wards_by_province = {}

    for province in hierarchy["data"]:
        province_name = province.get("name", {}).get("local", "")
        provinces[normalize(province_name)] = province_name

        wards = []
        for ward in province.get("ward", []):
            ward_name = ward.get("name", {}).get("local", "")
            if ward_name:
                wards.append(ward_name)

        wards_by_province[normalize(province_name)] = wards

    def canonical_province(name):
        candidate = remove_prefix(
            name, ["Thành phố", "Tỉnh"]
        )
        return provinces.get(normalize(candidate), candidate)

    def canonical_ward(province_name, name):
        candidate = remove_prefix(
            name, ["Phường", "Xã", "Đặc khu", "Thị trấn", "Thị xã"]
        )
        wards = wards_by_province.get(normalize(province_name), [])
        matches = [w for w in wards if normalize(w) == normalize(candidate)]
        return matches[0] if len(matches) == 1 else candidate

    mappings = []
    seen = set()
    files_read = 0
    valid_addresses = 0
    multi_target = 0
    unmatched_province = set()

    for path in OUTPUT_DIR.rglob("*.json"):
        files_read += 1
        data = load_json(path)

        if not isinstance(data, dict):
            continue

        address = data.get("address", "")
        results = data.get("result", [])

        if not isinstance(address, str) or not address.strip():
            continue
        if not isinstance(results, list) or not results:
            continue

        # Ví dụ: "Phường Phúc Xá, Quận Ba Đình, Thành phố Hà Nội"
        parts = [part.strip() for part in address.split(",")]
        if len(parts) < 3:
            continue

        old_ward = parts[0]
        old_district = parts[-2]
        old_province = parts[-1]

        valid_addresses += 1

        if len(results) > 1:
            multi_target += 1

        for result in results:
            if not isinstance(result, dict):
                continue

            new_province_raw = result.get("province_name", "")
            new_ward_raw = result.get("ward_name", "")

            if not new_province_raw or not new_ward_raw:
                continue

            new_province = canonical_province(new_province_raw)
            new_ward = canonical_ward(new_province, new_ward_raw)

            # Ghi nhận tỉnh mới chưa đối chiếu được chính xác.
            if normalize(new_province) not in {
                normalize(v) for v in provinces.values()
            }:
                unmatched_province.add(new_province_raw)

            key = (
                normalize(old_province),
                normalize(old_district),
                normalize(old_ward),
                normalize(new_province),
                normalize(new_ward),
            )
            if key in seen:
                continue
            seen.add(key)

            citation = result.get("citation", {})
            source = citation.get("header", "") if isinstance(citation, dict) else ""

            mappings.append({
                "oldProvince": old_province,
                "oldDistrict": old_district,
                "oldWard": old_ward,
                "newProvince": new_province,
                "newWard": new_ward,
                "newWardCode": result.get("ward_code", ""),
                "type": "split" if len(results) > 1 else "merged",
                "confidence": result.get("confidence", "unknown"),
                "source": source or "dvhcvn/20250701",
                "effectiveDate": EFFECTIVE_DATE
            })

    if not mappings:
        raise RuntimeError(
            "Không tạo được mapping nào. Hãy kiểm tra thư mục output và cấu trúc JSON."
        )

    output = {
        "version": "2025.1",
        "effectiveDate": EFFECTIVE_DATE,
        "source": "dvhcvn/20250701; cần kiểm tra các bản ghi theo nguồn nghị quyết",
        "mappings": mappings
    }

    SAVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SAVE_FILE.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n===== KẾT QUẢ =====")
    print(f"Số file JSON đã đọc: {files_read}")
    print(f"Số địa chỉ cũ hợp lệ: {valid_addresses}")
    print(f"Số địa chỉ có nhiều kết quả đích: {multi_target}")
    print(f"Số bản ghi mapping sau khi loại trùng: {len(mappings)}")
    print(f"Tỉnh mới chưa khớp chính xác: {len(unmatched_province)}")
    for name in sorted(unmatched_province):
        print("  -", name)
    print(f"\nĐã lưu tại: {SAVE_FILE}")


if __name__ == "__main__":
    main()