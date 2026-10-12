// addressForm.js
//
// Quản lý:
// 1. Quốc gia
// 2. Tỉnh / Thành phố
// 3. Xã / Phường / Đặc khu
// 4. Hỗ trợ dữ liệu OCR từ CCCD cũ và CCCD mới
//
// LƯU Ý:
// - hierarchy.json là dữ liệu địa giới hiện tại.
// - Địa chỉ cũ không có trong hierarchy.json vẫn được phép hiển thị.
// - Không tự ý xóa dữ liệu OCR nếu không tìm thấy trong hierarchy.json.
// - Việc chuyển đổi địa giới cũ -> mới sẽ xử lý ở bước tiếp theo.

// =====================================================
// IMPORT
// =====================================================

import { loadVietnamAddress } from "../vietnamAddress.js";

// =====================================================
// DATA
// =====================================================

let vietnamData = [];

// =====================================================
// TRẠNG THÁI OCR
// =====================================================
//
// Khi OCR đang đổ dữ liệu vào combobox,
// tránh để event input/change của người dùng
// làm mất dữ liệu đang được đổ.
//
// =====================================================

const ocrAddressState = new Set();

// =====================================================
// DANH SÁCH QUỐC GIA
// =====================================================

const countries = [
  "Việt Nam",
  "Lào",
  "Campuchia",
  "Thái Lan",
  "Myanmar",
  "Malaysia",
  "Singapore",
  "Indonesia",
  "Philippines",
  "Brunei",
  "Trung Quốc",
  "Nhật Bản",
  "Hàn Quốc",
  "Ấn Độ",
  "Úc",
  "New Zealand",
  "Hoa Kỳ",
  "Canada",
  "Mexico",
  "Anh",
  "Pháp",
  "Đức",
  "Ý",
  "Tây Ban Nha",
  "Hà Lan",
  "Bỉ",
  "Thụy Sĩ",
  "Nga",
  "UAE",
  "Saudi Arabia",
  "Khác",
];

// =====================================================
// NORMALIZE TEXT
// =====================================================
//
// Dùng để so sánh:
// "Vũng Tàu"
// "vũng tàu"
// "VUNG TAU"
// " Vũng Tàu "
//
// đều có thể match.
//
// =====================================================

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

// =====================================================
// NORMALIZE PROVINCE NAME
// =====================================================
//
// Xử lý một số dạng OCR phổ biến:
//
// "TP. Vũng Tàu, Bà Rịa - Vũng Tàu"
// "TP Vũng Tàu"
// "Thành phố Vũng Tàu"
// "Vũng Tàu"
//
// Mục tiêu là tìm được tỉnh/thành trong hierarchy.json
// nếu có.
//
// =====================================================

export function normalizeProvinceName(name) {
  if (!name) {
    return "";
  }

  let value = String(name).trim();

  // Chuẩn hóa khoảng trắng
  value = value.replace(/\s+/g, " ");

  // Loại bỏ phần sau dấu phẩy nếu phía trước
  // đã có tên thành phố rõ ràng.
  //
  // Ví dụ:
  // "TP. Vũng Tàu, Bà Rịa - Vũng Tàu"
  //       ↓
  // "TP. Vũng Tàu"

  if (value.includes(",")) {
    const firstPart = value.split(",")[0].trim();

    if (firstPart) {
      value = firstPart;
    }
  }

  // Loại bỏ một số tiền tố phổ biến
  value = value
    .replace(/^tp\.?\s*/i, "")
    .replace(/^thành phố\s*/i, "")
    .replace(/^tỉnh\s*/i, "")
    .trim();

  return value;
}

// =====================================================
// LOAD DATA
// =====================================================

export async function initAddressData() {
  try {
    vietnamData = await loadVietnamAddress();

    console.log("✅ Address data loaded:", vietnamData.length, "tỉnh/thành");

    return vietnamData;
  } catch (error) {
    console.error("❌ Không thể tải dữ liệu địa chỉ:", error);

    vietnamData = [];

    return [];
  }
}

// =====================================================
// GET DATA
// =====================================================

export function getProvinces() {
  return vietnamData;
}

// =====================================================
// FIND PROVINCE
// =====================================================
//
// Tìm theo:
// - tên chính xác
// - tên tiếng Anh
// - tên sau khi normalize
// - tên nằm trong chuỗi OCR
//
// Ví dụ:
//
// "Vũng Tàu"
// "TP. Vũng Tàu"
// "TP. Vũng Tàu, Bà Rịa - Vũng Tàu"
//
// có thể tìm được province tương ứng nếu
// hierarchy.json có "Vũng Tàu".
//
// =====================================================

export function findProvince(name) {
  if (!name) {
    return null;
  }

  const original = String(name).trim();

  const keyword = normalizeText(original);

  const normalizedProvince = normalizeText(normalizeProvinceName(original));

  // -----------------------------------------------
  // 1. Tìm chính xác
  // -----------------------------------------------

  let result = vietnamData.find((province) => {
    const local = normalizeText(province.name?.local);
    const english = normalizeText(province.name?.en);

    return (
      local === keyword ||
      english === keyword ||
      local === normalizedProvince ||
      english === normalizedProvince
    );
  });

  if (result) {
    return result;
  }

  // -----------------------------------------------
  // 2. Tìm chứa chuỗi
  // -----------------------------------------------

  result = vietnamData.find((province) => {
    const local = normalizeText(province.name?.local);
    const english = normalizeText(province.name?.en);

    if (!local && !english) {
      return false;
    }

    return (
      (local && keyword.includes(local)) ||
      (local && normalizedProvince.includes(local)) ||
      (english && keyword.includes(english)) ||
      (english && normalizedProvince.includes(english))
    );
  });

  if (result) {
    return result;
  }

  // -----------------------------------------------
  // 3. Không tìm thấy
  // -----------------------------------------------

  return null;
}

// =====================================================
// GET WARDS
// =====================================================

export function getWards(provinceName) {
  const province = findProvince(provinceName);

  if (!province) {
    return [];
  }

  return province.ward || [];
}

// =====================================================
// FIND WARD
// =====================================================
//
// Tìm xã/phường trong một tỉnh.
//
// Hỗ trợ:
// - "Phường 9"
// - "phường 9"
// - "PHƯỜNG 9"
// - tên tiếng Anh
//
// =====================================================

export function findWard(provinceName, wardName) {
  if (!provinceName || !wardName) {
    return null;
  }

  const province = findProvince(provinceName);

  if (!province) {
    return null;
  }

  const keyword = normalizeText(wardName);

  return (
    (province.ward || []).find((ward) => {
      const local = normalizeText(ward.name?.local);
      const english = normalizeText(ward.name?.en);

      return local === keyword || english === keyword;
    }) || null
  );
}

// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =====================================================
// CREATE OPTIONS
// =====================================================

export function createAddressOptions(items) {
  return items
    .map((item) => {
      const name = item.name?.local || "";

      return `
        <div
          class="combobox-option"
          data-value="${escapeHtml(name)}"
        >
          ${escapeHtml(name)}
        </div>
      `;
    })
    .join("");
}

// =====================================================
// SHOW OLD / OCR VALUE
// =====================================================
//
// Dùng khi OCR đọc được địa chỉ cũ nhưng
// địa chỉ đó không tồn tại trong hierarchy.json.
//
// Ví dụ:
//
// OCR:
// "Bà Rịa - Vũng Tàu"
//
// hierarchy:
// không có "Bà Rịa - Vũng Tàu"
//
// → vẫn hiển thị giá trị OCR.
//
// =====================================================

function showLegacyValue(input, options, value, type = "địa chỉ") {
  if (!input) {
    return;
  }

  input.value = value || "";

  if (!options) {
    return;
  }

  if (value) {
    options.innerHTML = `
      <div class="combobox-option active" data-value="${escapeHtml(value)}">
        ${escapeHtml(value)}
      </div>

      <div class="combobox-no-result">
        ${escapeHtml(
          `Đây là ${type} từ giấy tờ, chưa có trong danh sách hiện tại`,
        )}
      </div>
    `;

    options.classList.add("show");
  } else {
    options.innerHTML = "";

    options.classList.remove("show");
  }
}

// =====================================================
// QUỐC GIA COMBOBOX
// =====================================================

export function initCountryCombobox({ inputId, optionsId }) {
  const input = document.getElementById(inputId);

  const options = document.getElementById(optionsId);

  if (!input || !options) {
    console.error("❌ Không tìm thấy country combobox:", inputId, optionsId);

    return;
  }

  function renderCountries(keyword = "") {
    const text = normalizeText(keyword);

    const filtered = countries.filter((country) =>
      normalizeText(country).includes(text),
    );

    options.innerHTML =
      filtered.length > 0
        ? filtered
            .map(
              (country) => `
                <div
                  class="combobox-option"
                  data-value="${escapeHtml(country)}"
                >
                  ${escapeHtml(country)}
                </div>
              `,
            )
            .join("")
        : `
          <div class="combobox-no-result">
            Không tìm thấy quốc gia
          </div>
        `;

    options.classList.add("show");
  }

  // ===================================================
  // GÕ TÌM KIẾM
  // ===================================================

  input.addEventListener("input", () => {
    renderCountries(input.value);
  });

  // ===================================================
  // FOCUS
  // ===================================================

  input.addEventListener("focus", () => {
    renderCountries(input.value);
  });

  // ===================================================
  // ARROW
  // ===================================================

  const wrapper = input.closest(".combobox");

  const arrow = wrapper?.querySelector(".combobox-arrow");

  if (arrow) {
    arrow.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (options.classList.contains("show")) {
        options.classList.remove("show");
      } else {
        input.focus();

        renderCountries(input.value);
      }
    });
  }

  // ===================================================
  // CHỌN QUỐC GIA
  // ===================================================

  options.addEventListener("click", (event) => {
    const option = event.target.closest(".combobox-option");

    if (!option) {
      return;
    }

    input.value = option.dataset.value || option.textContent.trim();

    options.classList.remove("show");

    input.dispatchEvent(
      new Event("change", {
        bubbles: true,
      }),
    );
  });

  // ===================================================
  // ENTER
  // ===================================================

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();

      const firstOption = options.querySelector(".combobox-option");

      if (firstOption) {
        input.value =
          firstOption.dataset.value || firstOption.textContent.trim();

        options.classList.remove("show");

        input.dispatchEvent(
          new Event("change", {
            bubbles: true,
          }),
        );
      } else if (input.value.trim() !== "") {
        options.classList.remove("show");
      }
    }

    if (event.key === "Escape") {
      options.classList.remove("show");
    }
  });

  // ===================================================
  // CLICK RA NGOÀI
  // ===================================================

  document.addEventListener("mousedown", (event) => {
    if (
      !event.target.closest(`#${inputId}`) &&
      !event.target.closest(`#${optionsId}`)
    ) {
      options.classList.remove("show");
    }
  });

  console.log(`✅ Country combobox initialized: ${inputId}`);
}

// =====================================================
// TỈNH → XÃ / PHƯỜNG
// =====================================================

export function initAddressCombobox({
  provinceInputId,
  provinceOptionsId,
  wardInputId,
  wardOptionsId,
}) {
  const provinceInput = document.getElementById(provinceInputId);

  const provinceOptions = document.getElementById(provinceOptionsId);

  const wardInput = document.getElementById(wardInputId);

  const wardOptions = document.getElementById(wardOptionsId);

  if (!provinceInput || !provinceOptions || !wardInput || !wardOptions) {
    console.error("❌ Không tìm thấy address combobox:", {
      provinceInputId,
      provinceOptionsId,
      wardInputId,
      wardOptionsId,
    });

    return;
  }

  // ===================================================
  // RENDER TỈNH
  // ===================================================

  function renderProvinces(keyword = "") {
    const text = normalizeText(keyword);

    const filtered = vietnamData.filter((province) => {
      const local = normalizeText(province.name?.local);

      const english = normalizeText(province.name?.en);

      return local.includes(text) || english.includes(text);
    });

    provinceOptions.innerHTML =
      filtered.length > 0
        ? createAddressOptions(filtered)
        : `
          <div class="combobox-no-result">
            Không tìm thấy tỉnh/thành
          </div>
        `;

    provinceOptions.classList.add("show");
  }

  // ===================================================
  // RENDER XÃ / PHƯỜNG
  // ===================================================

  function renderWards(provinceName, keyword = "") {
    const province = findProvince(provinceName);

    // -----------------------------------------------
    // Không có tỉnh trong dữ liệu hiện tại
    // -----------------------------------------------

    if (!province) {
      wardOptions.innerHTML = `
        <div class="combobox-no-result">
          ${
            provinceName
              ? "Địa chỉ xã/phường của giấy tờ chưa có trong danh sách hiện tại"
              : "Hãy chọn tỉnh/thành phố trước"
          }
        </div>
      `;

      wardOptions.classList.add("show");

      return;
    }

    // -----------------------------------------------
    // Có tỉnh
    // -----------------------------------------------

    const wards = province.ward || [];

    const text = normalizeText(keyword);

    const filtered = wards.filter((ward) => {
      const local = normalizeText(ward.name?.local);

      const english = normalizeText(ward.name?.en);

      return local.includes(text) || english.includes(text);
    });

    wardOptions.innerHTML =
      filtered.length > 0
        ? createAddressOptions(filtered)
        : `
          <div class="combobox-no-result">
            Không tìm thấy xã/phường/đặc khu
          </div>
        `;

    wardOptions.classList.add("show");
  }

  // ===================================================
  // ARROW TỈNH
  // ===================================================

  const provinceArrow = provinceInput
    .closest(".combobox")
    ?.querySelector(".combobox-arrow");

  if (provinceArrow) {
    provinceArrow.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (provinceOptions.classList.contains("show")) {
        provinceOptions.classList.remove("show");
      } else {
        provinceInput.focus();

        renderProvinces(provinceInput.value);
      }
    });
  }

  // ===================================================
  // ARROW XÃ / PHƯỜNG
  // ===================================================

  const wardArrow = wardInput
    .closest(".combobox")
    ?.querySelector(".combobox-arrow");

  if (wardArrow) {
    wardArrow.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (wardOptions.classList.contains("show")) {
        wardOptions.classList.remove("show");
      } else {
        wardInput.focus();

        renderWards(provinceInput.value, wardInput.value);
      }
    });
  }

  // ===================================================
  // CHỌN TỈNH BẰNG CHUỘT
  // ===================================================

  provinceOptions.addEventListener("click", (event) => {
    const option = event.target.closest(".combobox-option");

    if (!option) {
      return;
    }

    const value = option.dataset.value || option.textContent.trim();

    provinceInput.value = value;

    provinceOptions.classList.remove("show");

    // ---------------------------------------------
    // Người dùng thực sự đổi tỉnh
    // → reset xã
    // ---------------------------------------------

    if (!ocrAddressState.has(provinceInputId)) {
      wardInput.value = "";

      wardOptions.innerHTML = "";
    }

    // ---------------------------------------------
    // Hiển thị danh sách xã/phường
    // ---------------------------------------------

    renderWards(value);

    provinceInput.dispatchEvent(
      new Event("change", {
        bubbles: true,
      }),
    );
  });

  // ===================================================
  // CHỌN XÃ / PHƯỜNG
  // ===================================================

  wardOptions.addEventListener("click", (event) => {
    const option = event.target.closest(".combobox-option");

    if (!option) {
      return;
    }

    const value = option.dataset.value || option.textContent.trim();

    wardInput.value = value;

    wardOptions.classList.remove("show");

    wardInput.dispatchEvent(
      new Event("change", {
        bubbles: true,
      }),
    );
  });

  // ===================================================
  // GÕ TỈNH
  // ===================================================

  provinceInput.addEventListener("input", () => {
    // Nếu đây là lúc OCR đang set dữ liệu,
    // không reset ward.
    if (ocrAddressState.has(provinceInputId)) {
      renderProvinces(provinceInput.value);

      return;
    }

    renderProvinces(provinceInput.value);

    wardInput.value = "";

    wardOptions.innerHTML = "";
  });

  // ===================================================
  // FOCUS TỈNH
  // ===================================================

  provinceInput.addEventListener("focus", () => {
    renderProvinces(provinceInput.value);
  });

  // ===================================================
  // ENTER TỈNH
  // ===================================================

  provinceInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      provinceOptions.classList.remove("show");
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const firstOption = provinceOptions.querySelector(".combobox-option");

      if (firstOption) {
        firstOption.click();
      } else if (provinceInput.value.trim() !== "") {
        provinceOptions.classList.remove("show");

        provinceInput.dispatchEvent(
          new Event("change", {
            bubbles: true,
          }),
        );
      }
    }
  });

  // ===================================================
  // GÕ XÃ
  // ===================================================

  wardInput.addEventListener("input", () => {
    renderWards(provinceInput.value, wardInput.value);
  });

  // ===================================================
  // FOCUS XÃ
  // ===================================================

  wardInput.addEventListener("focus", () => {
    renderWards(provinceInput.value, wardInput.value);
  });

  // ===================================================
  // ENTER XÃ
  // ===================================================

  wardInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      wardOptions.classList.remove("show");
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const firstOption = wardOptions.querySelector(".combobox-option");

      if (firstOption) {
        firstOption.click();
      } else if (wardInput.value.trim() !== "") {
        wardOptions.classList.remove("show");

        wardInput.dispatchEvent(
          new Event("change", {
            bubbles: true,
          }),
        );
      }
    }
  });

  // ===================================================
  // CLICK RA NGOÀI
  // ===================================================

  document.addEventListener("mousedown", (event) => {
    if (
      !event.target.closest(`#${provinceInputId}`) &&
      !event.target.closest(`#${provinceOptionsId}`)
    ) {
      provinceOptions.classList.remove("show");
    }

    if (
      !event.target.closest(`#${wardInputId}`) &&
      !event.target.closest(`#${wardOptionsId}`)
    ) {
      wardOptions.classList.remove("show");
    }
  });

  console.log(`✅ Address combobox initialized: ${provinceInputId}`);
}

// =====================================================
// SET ĐỊA CHỈ TỪ OCR
// =====================================================
//
// Đây là hàm QUAN TRỌNG.
//
// Dùng khi Groq trả:
//
// {
//   tinh: "...",
//   phuongXa: "..."
// }
//
// Hàm này:
// 1. Thử tìm tỉnh trong hierarchy hiện tại.
// 2. Nếu tìm thấy → dùng tên chuẩn của hierarchy.
// 3. Nếu không tìm thấy → giữ nguyên tên OCR.
// 4. Nếu có xã/phường → cố gắng match.
// 5. Nếu không match → vẫn giữ nguyên xã/phường OCR.
//
// =====================================================

export function setAddressFromOCR({
  provinceInputId,
  wardInputId,
  province,
  ward,
}) {
  const provinceInput = document.getElementById(provinceInputId);

  const wardInput = document.getElementById(wardInputId);

  const provinceOptions = document.getElementById(`${provinceInputId}Options`);

  const wardOptions = document.getElementById(`${wardInputId}Options`);

  if (!provinceInput || !wardInput) {
    console.error("❌ Không tìm thấy input địa chỉ OCR:", {
      provinceInputId,
      wardInputId,
    });

    return {
      province: province || "",
      ward: ward || "",
      provinceMatched: false,
      wardMatched: false,
    };
  }

  // ===================================================
  // Đánh dấu đang xử lý OCR
  // ===================================================

  ocrAddressState.add(provinceInputId);

  try {
    const rawProvince = String(province || "").trim();

    const rawWard = String(ward || "").trim();

    // =================================================
    // TÌM TỈNH
    // =================================================

    const provinceData = findProvince(rawProvince);

    let finalProvince = rawProvince;

    let provinceMatched = false;

    if (provinceData) {
      finalProvince = provinceData.name?.local || rawProvince;

      provinceMatched = true;
    }

    // =================================================
    // GÁN TỈNH
    // =================================================

    provinceInput.value = finalProvince;

    // =================================================
    // TÌM XÃ / PHƯỜNG
    // =================================================

    let finalWard = rawWard;

    let wardMatched = false;

    if (provinceData && rawWard) {
      const wardData = findWard(
        provinceData.name?.local || finalProvince,
        rawWard,
      );

      if (wardData) {
        finalWard = wardData.name?.local || rawWard;

        wardMatched = true;
      }
    }

    // =================================================
    // GÁN XÃ / PHƯỜNG
    // =================================================

    wardInput.value = finalWard;

    // =================================================
    // OPTIONS
    // =================================================

    if (provinceOptions) {
      provinceOptions.classList.remove("show");
    }

    if (wardOptions) {
      wardOptions.classList.remove("show");
    }

    // =================================================
    // Nếu tỉnh không tồn tại trong hierarchy
    // → vẫn giữ nguyên OCR
    // =================================================

    if (rawProvince && !provinceMatched && provinceOptions) {
      provinceOptions.innerHTML = `
        <div class="combobox-option active"
             data-value="${escapeHtml(rawProvince)}">
          ${escapeHtml(rawProvince)}
        </div>

        <div class="combobox-no-result">
          Địa chỉ này có thể thuộc dữ liệu hành chính cũ
        </div>
      `;
    }

    // =================================================
    // Nếu xã/phường không tồn tại
    // → vẫn giữ nguyên OCR
    // =================================================

    if (rawWard && !wardMatched && wardOptions) {
      wardOptions.innerHTML = `
        <div class="combobox-option active"
             data-value="${escapeHtml(rawWard)}">
          ${escapeHtml(rawWard)}
        </div>

        <div class="combobox-no-result">
          Xã/phường này chưa có trong danh sách hiện tại
        </div>
      `;
    }

    // =================================================
    // CHANGE EVENT
    // =================================================

    provinceInput.dispatchEvent(
      new Event("change", {
        bubbles: true,
      }),
    );

    wardInput.dispatchEvent(
      new Event("change", {
        bubbles: true,
      }),
    );

    // =================================================
    // DEBUG
    // =================================================

    console.log("📍 Địa chỉ OCR:", {
      province: rawProvince,
      ward: rawWard,
    });

    console.log("📍 Địa chỉ sau xử lý:", {
      province: finalProvince,
      ward: finalWard,
      provinceMatched,
      wardMatched,
    });

    return {
      province: finalProvince,
      ward: finalWard,
      provinceMatched,
      wardMatched,
    };
  } finally {
    // Cho phép thao tác người dùng bình thường
    // sau khi OCR hoàn tất.

    ocrAddressState.delete(provinceInputId);
  }
}

// =====================================================
// SET QUỐC GIA TỪ OCR
// =====================================================

export function setCountryFromOCR({ inputId, optionsId, value }) {
  const input = document.getElementById(inputId);

  const options = document.getElementById(optionsId);

  if (!input) {
    console.error("❌ Không tìm thấy country input:", inputId);

    return;
  }

  const rawValue = String(value || "").trim();

  if (!rawValue) {
    input.value = "";

    return;
  }

  const normalized = normalizeText(rawValue);

  const matched = countries.find(
    (country) => normalizeText(country) === normalized,
  );

  input.value = matched || rawValue;

  if (options) {
    options.classList.remove("show");
  }

  input.dispatchEvent(
    new Event("change", {
      bubbles: true,
    }),
  );

  console.log(`🌍 Quốc gia OCR: ${input.value}`);
}

// =====================================================
// LẤY GIÁ TRỊ ĐỊA CHỈ
// =====================================================
//
// Dùng sau này khi lưu hồ sơ.
//
// =====================================================

export function getAddressValue({ provinceInputId, wardInputId }) {
  const provinceInput = document.getElementById(provinceInputId);

  const wardInput = document.getElementById(wardInputId);

  return {
    province: provinceInput?.value?.trim() || "",

    ward: wardInput?.value?.trim() || "",
  };
}
