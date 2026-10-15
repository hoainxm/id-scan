// address-audit.js
//
// Kiểm tra hồi quy chức năng chuyển địa chỉ cũ -> mới, chạy NGAY TRÊN TRANG (không cần BE).
// Xem hướng dẫn: docs/huong-dan-nang-cap-quet-dia-chi.md
//
// Cách chạy:
//   1. cd FE && python3 -m http.server 5500, mở http://localhost:5500
//   2. Mở DevTools > Console, dán:
//        const { runAddressAudit } = await import("/tools/address-audit.js");
//        await runAddressAudit();
//   3. Đọc bảng kết quả. Yêu cầu trước khi push: mọi ca cố định ✅ (trừ ca ghi "chưa hỗ trợ"),
//      mẫu ngẫu nhiên "sai" = 0 ở cả 4 cách ghi.
//
// Script giả lập kết quả OCR bằng sự kiện "cccdOCRCompleted" rồi đọc khung "Địa giới hành chính".
// Nó ghi đè dữ liệu đang có trên form: chỉ chạy trên trang trống, không chạy khi đang nhập hồ sơ thật.
// Mọi số nhà / tên đường là dữ liệu giả; chỉ dùng tên đơn vị hành chính công khai.

const $ = (id) => document.getElementById(id);

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/^(tinh|thanh pho|phuong|xa|thi tran|dac khu)\s+/, "")
    .trim();
}

// Chờ bằng microtask (không dùng setTimeout) để không bị trình duyệt làm chậm khi tab ẩn.
const tick = () => new Promise((resolve) => queueMicrotask(resolve));

async function runCase(HKTT, cardType = "old") {
  const panel = $("addressConvertPanel");
  const before = panel.dataset.version || "0";

  for (const id of ["tinhHienNay", "phuongXaHienNay", "soNhaHienNay"]) $(id).value = "";

  window.dispatchEvent(
    new CustomEvent("cccdOCRCompleted", {
      detail: {
        soGiayTo: "", hoTen: "", hoDem: "", ten: "", ngaySinh: "", gioiTinh: "",
        quocTich: "", danToc: "", nguyenQuan: "", noiSinh: "", noiCapGiayTo: "",
        ngayCap: "", ngayHetHan: "", cardType,
        HKTT: { quocGia: "", soNha: "", diaChiGoc: "", ...HKTT },
      },
    }),
  );

  for (let i = 0; i < 500 && (panel.dataset.version || "0") === before; i++) await tick();

  const status = (panel.dataset.version || "0") === before ? "timeout" : panel.dataset.status;

  // Đích duy nhất: bấm nút như người dùng để đọc địa chỉ mới.
  if (status === "matched" || status === "current") {
    panel.querySelector('[data-action="current"]')?.click();
  }

  return { status, province: $("tinhHienNay").value, ward: $("phuongXaHienNay").value };
}

// Các ca cố định: mỗi ca là một tình huống đã từng sai hoặc dễ sai. expect:
//   "Tỉnh|Xã"  -> phải ra đúng đích này
//   "multiple" -> xã cũ bị chia, phải để người dùng chọn
// todo: ca chưa hỗ trợ (bài tập nâng cấp), ❌ ở ca này chưa chặn push.
const FIXED_CASES = [
  {
    name: "Tên đầy đủ, địa chỉ cũ",
    hktt: { tinh: "Bà Rịa - Vũng Tàu", quanHuyen: "TP. Vũng Tàu", phuongXa: "Phường 9", soNha: "Số 1 Đường Mẫu" },
    expect: "Hồ Chí Minh|Tam Thắng",
  },
  {
    name: "Tỉnh viết tắt BRVT",
    hktt: { tinh: "BRVT", quanHuyen: "Thành phố Vũng Tàu", phuongXa: "P. Thắng Nhất", soNha: "Số 2 Đường Mẫu" },
    expect: "Hồ Chí Minh|Rạch Dừa",
  },
  {
    name: "Tỉnh viết tắt BR - VT",
    hktt: { tinh: "BR - VT", quanHuyen: "TP. Vũng Tàu", phuongXa: "P. Rạch Dừa", soNha: "Số 3" },
    expect: "Hồ Chí Minh|Rạch Dừa",
  },
  {
    name: "Huyện trên thẻ đã đổi tên trong dữ liệu (Long Điền -> Long Đất)",
    hktt: { tinh: "Bà Rịa - Vũng Tàu", quanHuyen: "Long Điền", phuongXa: "Phước Tỉnh", soNha: "Ấp Mẫu" },
    expect: "Hồ Chí Minh|Long Hải",
  },
  {
    name: "Địa chỉ mới (thẻ 2024, không có huyện)",
    hktt: { tinh: "Nghệ An", quanHuyen: "", phuongXa: "Bình Minh", soNha: "Xóm Mẫu" },
    cardType: "new",
    expect: "Nghệ An|Bình Minh",
  },
  {
    name: "Thành phố trùng tên tỉnh",
    hktt: { tinh: "Tuyên Quang", quanHuyen: "TP. Tuyên Quang", phuongXa: "P. Minh Xuân", soNha: "Số 5" },
    expect: "Tuyên Quang|Minh Xuân",
  },
  {
    name: "Xã cũ trùng tên xã mới cùng tỉnh",
    hktt: { tinh: "Hồ Chí Minh", quanHuyen: "Huyện Hóc Môn", phuongXa: "Xã Tân Hiệp", soNha: "Số 6" },
    expect: "Hồ Chí Minh|Hóc Môn",
  },
  {
    name: "Hai xã chỉ khác dấu cùng huyện (Hoằng Đông / Hoằng Đồng)",
    hktt: { tinh: "Thanh Hóa", quanHuyen: "H. Hoằng Hóa", phuongXa: "X. Hoằng Đông", soNha: "Thôn Mẫu" },
    expect: "Thanh Hóa|Hoằng Thanh",
  },
  {
    name: "Tên xã bắt đầu bằng \"Phương\"",
    hktt: { tinh: "Hà Nội", quanHuyen: "Ứng Hòa", phuongXa: "Phương Tú", soNha: "Thôn Mẫu" },
    expect: "Hà Nội|Vân Đình",
  },
  {
    name: "Xã cũ bị chia cho 2 phường mới",
    hktt: { tinh: "Hà Nội", quanHuyen: "Quận Ba Đình", phuongXa: "Phường Cống Vị", soNha: "Số 9" },
    expect: "multiple",
  },
  {
    name: "Chỉ có chuỗi địa chỉ",
    hktt: { tinh: "", quanHuyen: "", phuongXa: "", diaChiGoc: "Số 10, P. Thắng Nhất, TP. Vũng Tàu, Bà Rịa - Vũng Tàu" },
    expect: "Hồ Chí Minh|Rạch Dừa",
  },
  {
    name: "Tiền tố \"Đặc khu\" (bài tập N1)",
    hktt: { tinh: "An Giang", quanHuyen: "", phuongXa: "Đặc khu Phú Quốc", soNha: "Khu phố Mẫu" },
    cardType: "new",
    expect: "An Giang|Phú Quốc",
    todo: true,
  },
];

function checkResult(result, expect) {
  if (expect === "multiple") return result.status === "multiple";
  const [province, ward] = expect.split("|");
  return (
    (result.status === "matched" || result.status === "current") &&
    norm(result.province) === norm(province) &&
    norm(result.ward) === norm(ward)
  );
}

const strip = (text, re) => text.replace(re, "").trim();
const P = /^(Tỉnh|Thành phố)\s+/u;
const D = /^(Quận|Huyện|Thị xã|Thành phố)\s+/u;
const W = /^(Phường|Xã|Thị trấn)\s+/u;
const abbrD = (s) =>
  s.replace(/^Quận\s+/u, "Q. ").replace(/^Huyện\s+/u, "H. ").replace(/^Thị xã\s+/u, "TX. ").replace(/^Thành phố\s+/u, "TP. ");
const abbrW = (s) =>
  s.replace(/^Phường\s+/u, "P. ").replace(/^Xã\s+/u, "X. ").replace(/^Thị trấn\s+/u, "TT. ");

// 4 cách ghi cùng một địa chỉ cũ lấy từ bảng chuyển đổi.
const FORMATS = {
  "Tên đầy đủ": (r) => ({ tinh: r.oldProvince, quanHuyen: r.oldDistrict, phuongXa: r.oldWard, soNha: "Số 1" }),
  "Bỏ tiền tố": (r) => ({ tinh: strip(r.oldProvince, P), quanHuyen: strip(r.oldDistrict, D), phuongXa: strip(r.oldWard, W), soNha: "Số 1" }),
  "Viết tắt kiểu thẻ": (r) => ({ tinh: strip(r.oldProvince, P), quanHuyen: abbrD(r.oldDistrict), phuongXa: abbrW(r.oldWard), soNha: "Số 1" }),
  "Chỉ chuỗi địa chỉ": (r) => ({ tinh: "", quanHuyen: "", phuongXa: "", diaChiGoc: `Số 1, ${r.oldWard}, ${r.oldDistrict}, ${r.oldProvince}` }),
};

export async function runAddressAudit({ sample = 300, seed = 42 } = {}) {
  if (!$("addressConvertPanel")) throw new Error("Không thấy khung Địa giới hành chính: mở đúng trang FE.");

  // 1. Ca cố định
  const fixed = [];
  for (const c of FIXED_CASES) {
    const result = await runCase(c.hktt, c.cardType || "old");
    fixed.push({
      "Ca": c.name,
      "Kết quả": checkResult(result, c.expect) ? "✅" : c.todo ? "❌ (chưa hỗ trợ)" : "❌",
      "Trạng thái": result.status,
      "Ra": result.province ? `${result.ward}, ${result.province}` : "",
      "Mong đợi": c.expect,
    });
  }

  // 2. Mẫu ngẫu nhiên từ bảng chuyển đổi (cố định seed để lần nào cũng cùng mẫu)
  const { mappings } = await (await fetch("/data/addressMapping.json")).json();
  const groups = new Map();
  for (const r of mappings) {
    const key = [r.oldProvince, r.oldDistrict, r.oldWard].join("|");
    if (!groups.has(key)) groups.set(key, { r, targets: new Set() });
    groups.get(key).targets.add(`${norm(r.newProvince)}|${norm(r.newWard)}`);
  }

  let state = seed;
  const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const keys = [...groups.keys()];
  const picked = new Set();
  while (picked.size < Math.min(sample, keys.length)) picked.add(keys[Math.floor(rand() * keys.length)]);

  const formats = [];
  const wrongExamples = [];

  for (const [formatName, build] of Object.entries(FORMATS)) {
    const count = { "Cách ghi": formatName, "Đúng": 0, "Xã bị chia (đúng)": 0, "Sai": 0, "Không tìm thấy": 0 };

    for (const key of picked) {
      const { r, targets } = groups.get(key);
      const result = await runCase(build(r), "old");
      const got = `${norm(result.province)}|${norm(result.ward)}`;

      if (targets.size > 1 && result.status === "multiple") count["Xã bị chia (đúng)"]++;
      else if (result.status === "matched" && targets.has(got)) count["Đúng"]++;
      else if (["none", "insufficient", "timeout"].includes(result.status)) count["Không tìm thấy"]++;
      else {
        count["Sai"]++;
        if (wrongExamples.length < 10) wrongExamples.push({ "Cách ghi": formatName, "Địa chỉ cũ": key, "Ra": `[${result.status}] ${result.ward}, ${result.province}` });
      }
    }

    formats.push(count);
  }

  console.log("=== Ca cố định ===");
  console.table(fixed);
  console.log(`=== ${picked.size} xã cũ lấy mẫu x 4 cách ghi ===`);
  console.table(formats);
  if (wrongExamples.length) {
    console.log("=== Ví dụ sai ===");
    console.table(wrongExamples);
  }

  const blocking = fixed.filter((f) => f["Kết quả"] === "❌").length + formats.reduce((n, f) => n + f["Sai"], 0);
  console.log(blocking ? `❌ Có ${blocking} lỗi chặn push.` : "✅ Đạt, có thể push.");

  return { fixed, formats, wrongExamples, passed: blocking === 0 };
}
