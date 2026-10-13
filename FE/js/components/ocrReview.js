// ocrReview.js
//
// Hiển thị kết quả kiểm chứng OCR do BE trả về (response.validation):
// - corrections: trường đã được sửa theo QR code trên thẻ
// - warnings: trường cần người dùng kiểm tra lại (lệch MRZ, sai cấu trúc số, sai logic ngày...)
//
// Trường cần kiểm tra được tô vàng; người dùng sửa trường đó thì bỏ tô.

const FIELD_LABELS = {
  soGiayTo: "Số giấy tờ",
  hoTen: "Họ và tên",
  ngaySinh: "Ngày sinh",
  gioiTinh: "Giới tính",
  ngayCap: "Ngày cấp",
  ngayHetHan: "Ngày hết hạn",
  "HKTT.diaChiGoc": "Địa chỉ HKTT",
};

const SOURCE_LABELS = {
  qr: {
    matched: "QR code: khớp",
    corrected: "QR code: đã dùng để sửa",
    absent: "QR code: không đọc được",
  },
  mrz: {
    valid: "MRZ: hợp lệ",
    invalid: "MRZ: chép sai, không dùng",
    absent: "MRZ: không có",
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}

function label(field) {
  return FIELD_LABELS[field] || field;
}

export function clearOCRReview() {
  const banner = document.getElementById("ocrReviewBanner");

  if (banner) {
    banner.classList.add("hidden");
    banner.classList.remove("is-ok");
    banner.innerHTML = "";
  }

  document
    .querySelectorAll(".ocr-warn")
    .forEach((el) => el.classList.remove("ocr-warn"));
}

function markField(field, message) {
  const input = document.getElementById(field);

  if (!input) {
    return;
  }

  input.classList.add("ocr-warn");
  input.title = message;

  input.addEventListener(
    "input",
    () => {
      input.classList.remove("ocr-warn");
      input.removeAttribute("title");
    },
    { once: true },
  );
}

export function renderOCRReview(validation) {
  clearOCRReview();

  const banner = document.getElementById("ocrReviewBanner");

  if (!banner || !validation) {
    return;
  }

  const warnings = Array.isArray(validation.warnings)
    ? validation.warnings
    : [];
  const corrections = Array.isArray(validation.corrections)
    ? validation.corrections
    : [];

  const sources = validation.sources || {};
  const sourceText = ["qr", "mrz"]
    .map((key) => SOURCE_LABELS[key]?.[sources[key]])
    .filter(Boolean)
    .join(" · ");

  let html = "";

  if (!warnings.length) {
    banner.classList.add("is-ok");
    html += `<b>Đã đọc và đối chiếu thông tin CCCD.</b> Vẫn nên xem lại trước khi lưu.`;
  } else {
    html += `<b>Cần kiểm tra lại ${warnings.length} điểm trước khi lưu:</b><ul>`;

    warnings.forEach((w) => {
      const suggestion = w.suggestion
        ? ` — gợi ý: <span class="ocr-suggest">${escapeHtml(w.suggestion)}</span>`
        : "";

      html += `<li><b>${escapeHtml(label(w.field))}</b>: ${escapeHtml(w.message)}${suggestion}</li>`;

      markField(w.field, w.message);
    });

    html += "</ul>";
  }

  if (corrections.length) {
    html += `<div style="margin-top:6px">Đã tự sửa theo QR code: ${corrections
      .map((c) => escapeHtml(label(c.field)))
      .join(", ")}</div>`;
  }

  if (sourceText) {
    html += `<div style="margin-top:4px;color:var(--text-sub)">${escapeHtml(sourceText)}</div>`;
  }

  banner.innerHTML = html;
  banner.classList.remove("hidden");
}
