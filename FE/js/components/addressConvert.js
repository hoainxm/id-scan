// addressConvert.js
//
// Khung "Địa giới hành chính" trong mục Hộ khẩu thường trú:
// - Cho biết địa chỉ trên giấy tờ theo địa giới cũ (trước 01/07/2025) hay mới.
// - Nút chuyển HKTT sang địa chỉ mới / khôi phục địa chỉ như trên giấy tờ.
// - Nút điền địa chỉ mới vào "Chỗ ở hiện nay".
// - Xã/phường cũ bị chia cho nhiều đơn vị mới: người dùng tự chọn, không tự đoán.
// - Tuỳ chọn tự động điền "Chỗ ở hiện nay" sau khi quét (mặc định tắt, nhớ theo trình duyệt).
//
// Logic tra cứu nằm ở app.js và được truyền vào qua initAddressConvert().

const PREF_KEY = "idscan.autoFillCurrentAddress";

const HKTT_FIELD_IDS = ["HKTT_Tinh", "quanHuyenHKTT", "phuongXaHKTT", "soNhaHKTT"];

let deps = null;
let conversion = null;
let selectedIndex = -1;
let version = 0;

// ============================================================
// TIỆN ÍCH
// ============================================================

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

function readPref() {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writePref(enabled) {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // Không lưu được (chế độ ẩn danh...): chỉ áp dụng cho phiên hiện tại.
  }
}

function targetLabel(target) {
  return `${target.ward}, ${target.province}`;
}

function selectedTarget() {
  if (!conversion?.targets?.length) return null;
  if (conversion.targets.length === 1) return conversion.targets[0];
  return conversion.targets[selectedIndex] || null;
}

// Địa chỉ trên giấy tờ được lưu kèm hồ sơ để khôi phục sau khi đã chuyển đổi.
function readSavedOriginal() {
  try {
    return JSON.parse($("hkttTrenGiayTo")?.value || "null");
  } catch {
    return null;
  }
}

function isConverted() {
  return $("hkttDaChuyenDoi")?.value === "1" && Boolean(readSavedOriginal());
}

function snapshotHKTT() {
  return Object.fromEntries(HKTT_FIELD_IDS.map((id) => [id, $(id)?.value ?? ""]));
}

// ============================================================
// HIỂN THỊ
// ============================================================

const STATUS_VIEW = {
  current: {
    chip: "good",
    label: "Địa giới mới",
    text: "Địa chỉ đã theo đơn vị hành chính hiện hành.",
  },
  matched: {
    chip: "warn",
    label: "Địa giới cũ",
    text: "Địa chỉ trên giấy tờ theo đơn vị hành chính trước 01/07/2025.",
  },
  multiple: {
    chip: "warn",
    label: "Địa giới cũ",
    text:
      "Xã/phường cũ này được chia cho nhiều đơn vị mới. Chọn đơn vị đúng theo địa chỉ chi tiết:",
  },
  none: {
    chip: "bad",
    label: "Chưa xác định",
    text:
      "Không tìm thấy đơn vị hành chính mới tương ứng. Kiểm tra lại tỉnh, quận/huyện, xã/phường hoặc chọn tay ở mục Chỗ ở hiện nay.",
  },
};

function render() {
  const panel = $("addressConvertPanel");
  if (!panel) return;

  version += 1;
  panel.dataset.version = String(version);

  const converted = isConverted();
  const status = converted ? "converted" : conversion?.status || "insufficient";
  panel.dataset.status = status;

  if (status === "insufficient") {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const autoChecked = readPref() ? "checked" : "";
  let head = "";
  let body = "";
  let actions = "";

  if (converted) {
    const original = readSavedOriginal();
    const originalText = $("diaChiHKTTTrenGiayTo")?.value || "";
    head = `<span class="chip info">Đã chuyển sang địa giới mới</span>`;
    body = `<p class="addr-convert-text">Địa chỉ trên giấy tờ: <b>${escapeHtml(originalText)}</b></p>`;
    actions = `
      <button type="button" class="btn btn-outline" data-action="restore" ${original ? "" : "disabled"}>
        ↺ Khôi phục địa chỉ trên giấy tờ
      </button>
      <button type="button" class="btn btn-outline" data-action="current">
        Điền vào Chỗ ở hiện nay
      </button>`;
  } else {
    const view = STATUS_VIEW[status];
    head = `<span class="chip ${view.chip}">${view.label}</span>`;
    body = `<p class="addr-convert-text">${escapeHtml(view.text)}</p>`;

    if (status === "matched") {
      const target = conversion.targets[0];
      const source = target.source ? ` <span class="addr-convert-source">(theo ${escapeHtml(target.source)})</span>` : "";
      body += `<p class="addr-convert-text">Địa chỉ mới tương ứng: <b>${escapeHtml(targetLabel(target))}</b>${source}</p>`;
    }

    if (status === "multiple") {
      body += `<div class="addr-convert-options" role="radiogroup" aria-label="Đơn vị hành chính mới">${conversion.targets
        .map(
          (target, index) => `
          <label class="addr-convert-option">
            <input type="radio" name="addrConvertTarget" value="${index}" ${index === selectedIndex ? "checked" : ""} />
            <span>${escapeHtml(targetLabel(target))}${target.source ? ` <span class="addr-convert-source">(${escapeHtml(target.source)})</span>` : ""}</span>
          </label>`,
        )
        .join("")}</div>`;
    }

    const canApply = Boolean(selectedTarget());

    if (status === "matched" || status === "multiple") {
      actions = `
        <button type="button" class="btn btn-primary" data-action="convert" ${canApply ? "" : "disabled"}>
          ⇄ Chuyển HKTT sang địa chỉ mới
        </button>
        <button type="button" class="btn btn-outline" data-action="current" ${canApply ? "" : "disabled"}>
          Điền địa chỉ mới vào Chỗ ở hiện nay
        </button>`;
    } else if (status === "current") {
      actions = `
        <button type="button" class="btn btn-outline" data-action="current">
          Điền vào Chỗ ở hiện nay
        </button>`;
    }
  }

  panel.innerHTML = `
    <div class="addr-convert-head">
      <span class="addr-convert-title">Địa giới hành chính</span>
      ${head}
    </div>
    ${body}
    ${actions ? `<div class="addr-convert-actions">${actions}</div>` : ""}
    <label class="addr-convert-pref">
      <input type="checkbox" id="autoFillCurrentAddress" ${autoChecked} />
      Tự động điền "Chỗ ở hiện nay" bằng địa chỉ mới sau khi quét
    </label>`;

  panel.classList.remove("hidden");
}

// ============================================================
// HÀNH ĐỘNG
// ============================================================

function fillCurrent() {
  if (isConverted()) {
    // HKTT đã là địa chỉ mới: chép sang Chỗ ở hiện nay.
    const target = { province: $("HKTT_Tinh").value, ward: $("phuongXaHKTT").value };
    deps.applyToCurrent(target, $("soNhaHKTT").value, $("quocGiaHKTT")?.value);
    return;
  }

  const target = selectedTarget();
  if (!target) return;

  deps.applyToCurrent(target, conversion.house, conversion.country);
}

function convertHKTT() {
  const target = selectedTarget();
  if (!target) return;

  // Lưu đúng địa chỉ đang chuyển (người dùng có thể đã sửa tay sau khi quét).
  $("hkttTrenGiayTo").value = JSON.stringify(snapshotHKTT());
  $("diaChiHKTTTrenGiayTo").value = $("diaChiHKTT")?.value || "";
  $("hkttDaChuyenDoi").value = "1";

  deps.applyToHKTT(target, conversion.house);
  render();
}

function restoreHKTT() {
  const original = readSavedOriginal();
  if (!original) return;

  for (const [id, value] of Object.entries(original)) {
    if ($(id)) $(id).value = value;
  }

  $("hkttTrenGiayTo").value = "";
  $("hkttDaChuyenDoi").value = "";

  deps.sync();
  refresh();
}

// ============================================================
// API
// ============================================================

/** Kiểm tra lại từ các trường HKTT đang có trên form. */
export function refresh() {
  if (!deps) return;

  if (isConverted()) {
    render();
    return;
  }

  conversion = deps.resolve();
  if (selectedIndex >= (conversion?.targets?.length || 0)) selectedIndex = -1;
  render();
}

/**
 * Hiển thị kết quả đối chiếu. fromScan: vừa quét xong, áp dụng tuỳ chọn tự động điền.
 */
export function showAddressConversion(result, { fromScan = false } = {}) {
  conversion = result;
  selectedIndex = -1;

  if (fromScan && readPref() && (result?.status === "matched" || result?.status === "current")) {
    deps?.applyToCurrent(result.targets[0], result.house, result.country);
  }

  render();
}

export function resetAddressConvert() {
  conversion = null;
  selectedIndex = -1;
  render();
}

export function initAddressConvert(dependencies) {
  deps = dependencies;

  const panel = $("addressConvertPanel");
  if (!panel) return;

  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "convert") convertHKTT();
    if (action === "restore") restoreHKTT();
    if (action === "current") fillCurrent();
  });

  panel.addEventListener("change", (event) => {
    if (event.target.name === "addrConvertTarget") {
      selectedIndex = Number(event.target.value);
      render();
    }

    if (event.target.id === "autoFillCurrentAddress") {
      writePref(event.target.checked);
    }
  });

  // Người dùng sửa địa chỉ HKTT bằng tay: kiểm tra lại sau khi ngừng gõ.
  let timer = null;

  for (const id of HKTT_FIELD_IDS) {
    for (const type of ["input", "change"]) {
      $(id)?.addEventListener(type, () => {
        if (isConverted()) return;
        clearTimeout(timer);
        timer = setTimeout(refresh, 400);
      });
    }
  }
}
