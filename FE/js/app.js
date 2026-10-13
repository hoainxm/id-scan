import { initSidebar } from "./components/sidebar.js";
import {
  initUploadForm,
  getUploadState,
  resetUploadState,
  setAvatarImage,
} from "./components/uploadForm.js";
import {
  initProfileForm,
  getFormData,
  setFormData,
  resetFormData,
} from "./components/profileForm.js";
import {
  initProfileList,
  renderProfileList,
} from "./components/profileList.js";
import { saveProfile, getProfileById } from "./components/storage.js";
import { renderOCRReview, clearOCRReview } from "./components/ocrReview.js";
import {
  initAddressData,
  initAddressCombobox,
  initCountryCombobox,
  getProvinces,
} from "./components/addressForm.js";
import {
  loadAddressMapping,
  isCurrentAddress,
  normalizeAddressText,
  normalizeAdministrativeName,
} from "./addressMapping.js";

// ============================================================
// STATE
// ============================================================

let editingId = null;
let addressReady = null;
let addressMappingRecords = [];

const extractModal = document.getElementById("extractModal");
const profileListModal = document.getElementById("profileListModal");

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeText(value) {
  return normalizeAddressText(value);
}

function sameAdminName(a, b, kind = "") {
  const left = normalizeAdministrativeName(a, kind);
  const right = normalizeAdministrativeName(b, kind);
  return Boolean(left && right && left === right);
}

// So sánh tỉnh theo dữ liệu mapping, không gắn cứng tên tỉnh nào.
function sameOldProvinceName(ocrProvince, mappingProvince, fullAddress = "") {
  const ocrKey = normalizeAdministrativeName(ocrProvince, "province");
  const mappingKey = normalizeAdministrativeName(mappingProvince, "province");

  if (ocrKey && mappingKey && ocrKey === mappingKey) return true;

  // Chỉ fallback theo địa chỉ gốc khi tên tỉnh trong chuỗi khớp
  // với tên tỉnh của bản ghi mapping.
  const fullKey = normalizeText(fullAddress);

  return Boolean(
    mappingKey && fullKey && ` ${fullKey} `.includes(` ${mappingKey} `),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      if (value.trim()) return value.trim();
      continue;
    }

    if (typeof value === "object") {
      if (Object.keys(value).length) return value;
      continue;
    }

    return value;
  }

  return "";
}

// ============================================================
// MODAL
// ============================================================

function closeExtractModal() {
  extractModal?.classList.add("hidden");
  editingId = null;
  resetFormData();
  resetUploadState();
}

document.getElementById("openModalBtn")?.addEventListener("click", () => {
  extractModal?.classList.remove("hidden");
});

document
  .getElementById("closeExtractBtn")
  ?.addEventListener("click", closeExtractModal);

document
  .getElementById("cancelBtn")
  ?.addEventListener("click", closeExtractModal);

document.getElementById("openProfileListBtn")?.addEventListener("click", () => {
  extractModal?.classList.add("hidden");
  profileListModal?.classList.remove("hidden");
  renderProfileList({ onEdit: openProfileForEdit });
});

document
  .getElementById("backToExtractBtn")
  ?.addEventListener("click", (event) => {
    event.preventDefault();
    profileListModal?.classList.add("hidden");
    extractModal?.classList.remove("hidden");
  });

document.getElementById("closeListBtn")?.addEventListener("click", () => {
  profileListModal?.classList.add("hidden");
});

document.getElementById("createNewBtn")?.addEventListener("click", () => {
  editingId = null;
  resetFormData();
  resetUploadState();
  profileListModal?.classList.add("hidden");
  extractModal?.classList.remove("hidden");
});

// ============================================================
// EDIT PROFILE
// ============================================================

function openProfileForEdit(id) {
  const profile = getProfileById(id);

  if (!profile) {
    console.warn("Không tìm thấy hồ sơ:", id);
    return;
  }

  editingId = id;
  clearOCRReview();
  setFormData(profile);
  setAvatarImage(profile.portraitDataUrl || null);

  profileListModal?.classList.add("hidden");
  extractModal?.classList.remove("hidden");
}

// ============================================================
// NORMALIZE OCR PAYLOAD
// ============================================================

function hasOCRFields(obj) {
  if (!obj || typeof obj !== "object") return false;

  const keys = [
    "soGiayTo",
    "hoTen",
    "HKTT",
    "hktt",
    "noiThuongTru",
    "noiThườngTrú",
    "thuongTru",
    "noiCuTru",
    "noiCưTru",
    "residence",
    "permanentAddress",
    "address",
    "diaChiHKTT",
    "Nơi thường trú",
    "Nơi thường trú:",
    "Nơi cư trú",
    "Nơi cư trú:",
  ];

  return keys.some((key) => obj[key] !== undefined && obj[key] !== null);
}

function normalizeOCRData(eventDetail) {
  if (!eventDetail || typeof eventDetail !== "object") {
    return null;
  }

  if (hasOCRFields(eventDetail)) {
    return eventDetail;
  }

  if (eventDetail.data && typeof eventDetail.data === "object") {
    const data = eventDetail.data;

    if (hasOCRFields(data)) {
      return data;
    }

    if (data.data && typeof data.data === "object") {
      return data.data;
    }
  }

  return eventDetail;
}

// ============================================================
// OCR ADDRESS HELPERS
// ============================================================

// Ưu tiên nhãn trên CCCD mới/cũ trước các trường dữ liệu chung.

function getOCRAddressSource(data) {
  if (!data || typeof data !== "object") return {};

  const source = firstNonEmpty(
    data["Nơi cư trú"],
    data["Nơi cư trú:"],
    data.noiCuTru,
    data.noiCưTrú,
    data["Nơi thường trú"],
    data["Nơi thường trú:"],
    data.noiThuongTru,
    data.noiThườngTrú,
    data.thuongTru,
    data.residence,
    data.permanentAddress,
    data.diaChiHKTT,
    data.HKTT,
    data.hktt,
    data.address,
  );

  if (typeof source === "string") {
    return {
      diaChi: source.trim(),
      diaChiGoc: source.trim(),
      quocGia: "Việt Nam",
      tinh: "",
      quanHuyen: "",
      phuongXa: "",
      soNha: "",
    };
  }

  if (!source || typeof source !== "object") return {};

  const province = firstNonEmpty(
    source.tinh,
    source.tinhThanh,
    source.province,
    source.provinceName,
  );

  const district = firstNonEmpty(
    source.quanHuyen,
    source.quan,
    source.huyen,
    source.district,
    source.districtName,
  );

  const ward = firstNonEmpty(
    source.phuongXa,
    source.phuong,
    source.xa,
    source.ward,
    source.wardName,
  );

  // Chỉ lấy trường địa chỉ chi tiết, không lấy nguyên chuỗi địa chỉ.
  const house = firstNonEmpty(
    source.soNha,
    source.diaChiChiTiet,
    source.addressDetail,
    source.houseNumber,
    source.streetAddress,
  );

  const rawAddress = firstNonEmpty(
    source.diaChiGoc,
    source.fullAddress,
    source.diaChi,
    source.address,
    data.diaChiGoc,
    data.diaChiHKTT,
    data.fullAddress,
    data.address,
    [house, ward, district, province].filter(Boolean).join(", "),
  );

  return {
    ...source,
    quocGia: firstNonEmpty(source.quocGia, source.country, "Việt Nam"),
    tinh: province,
    quanHuyen: district,
    phuongXa: ward,
    soNha: house,
    diaChiGoc: rawAddress,
  };
}

function getOCRDistrict(hktt) {
  return String(
    hktt?.quanHuyen ?? hktt?.quan ?? hktt?.huyen ?? hktt?.district ?? "",
  ).trim();
}

function getOCRWard(hktt) {
  return String(
    hktt?.phuongXa ?? hktt?.phuong ?? hktt?.xa ?? hktt?.ward ?? "",
  ).trim();
}

function getOCRProvince(hktt) {
  return String(hktt?.tinh ?? hktt?.tinhThanh ?? hktt?.province ?? "").trim();
}

function getOCRHouse(hktt) {
  const house = String(
    hktt?.soNha ??
      hktt?.diaChiChiTiet ??
      hktt?.addressDetail ??
      hktt?.houseNumber ??
      hktt?.streetAddress ??
      "",
  ).trim();

  if (house) return house;

  // Chỉ dùng chuỗi gốc làm dự phòng khi không có địa chỉ chi tiết.
  return String(
    hktt?.diaChiGoc ?? hktt?.fullAddress ?? hktt?.diaChi ?? hktt?.address ?? "",
  ).trim();
}

function getOCRCountry(hktt) {
  return String(hktt?.quocGia ?? hktt?.country ?? "Việt Nam").trim();
}

function normalizeOCRWard(value) {
  let ward = String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");

  if (!ward) return "";

  ward = ward.replace(/^p\.(?=\S)/i, "Phường ");
  ward = ward.replace(/^p\s+(?=\S)/i, "Phường ");
  ward = ward.replace(/^x\.(?=\S)/i, "Xã ");
  ward = ward.replace(/^x\s+(?=\S)/i, "Xã ");
  ward = ward.replace(/^tt\.(?=\S)/i, "Thị trấn ");
  ward = ward.replace(/^tt\s+(?=\S)/i, "Thị trấn ");

  return ward.replace(/\s+/g, " ").trim();
}

// ============================================================
// ADDRESS MATCHING HELPERS
// ============================================================

function getProvincesSafely() {
  const provinces = getProvinces();
  return Array.isArray(provinces) ? provinces : [];
}

function findCurrentProvinceFromName(name) {
  if (!name) return null;

  const matches = getProvincesSafely().filter((item) =>
    sameAdminName(item?.name?.local, name, "province"),
  );

  return matches.length === 1 ? matches[0].name.local : null;
}

function findCurrentWard(provinceName, wardName) {
  if (!provinceName || !wardName) return null;

  const provinceMatches = getProvincesSafely().filter((item) =>
    sameAdminName(item?.name?.local, provinceName, "province"),
  );

  if (provinceMatches.length !== 1) return null;

  const wards = provinceMatches[0].ward;
  if (!Array.isArray(wards)) return null;

  const matches = wards.filter((item) =>
    sameAdminName(item?.name?.local, wardName, "ward"),
  );

  return matches.length === 1 ? matches[0].name.local : null;
}

function findCurrentProvinceInText(text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return null;

  const matches = getProvincesSafely().filter((province) => {
    const name = province?.name?.local;
    const normalizedName = normalizeText(name);

    return (
      normalizedName && ` ${normalizedText} `.includes(` ${normalizedName} `)
    );
  });

  return matches.length === 1 ? matches[0].name.local : null;
}

function findCurrentWardInText(provinceName, text) {
  if (!provinceName || !text) return null;

  const province = getProvincesSafely().find((item) =>
    sameAdminName(item?.name?.local, provinceName, "province"),
  );

  if (!Array.isArray(province?.ward)) return null;

  const normalizedText = normalizeText(text);

  const matches = province.ward.filter((ward) => {
    const name = ward?.name?.local;
    const normalizedName = normalizeText(name);

    return (
      normalizedName && ` ${normalizedText} `.includes(` ${normalizedName} `)
    );
  });

  return matches.length === 1 ? matches[0].name.local : null;
}

function findOldNamesInsideAddress(addressText, kind) {
  const text = normalizeText(addressText);
  if (!text) return [];

  const fieldName = kind === "province" ? "oldProvince" : "oldDistrict";
  const unique = new Map();

  for (const record of addressMappingRecords) {
    const originalName = String(record?.[fieldName] || "").trim();
    if (!originalName) continue;

    const key = normalizeAdministrativeName(originalName, kind);
    if (!key || unique.has(key)) continue;

    if (` ${text} `.includes(` ${key} `)) {
      unique.set(key, originalName);
    }
  }

  return [...unique.values()];
}

// ============================================================
// PARSE ADDRESS TEXT
// ============================================================

function parseAddressText(rawAddress) {
  const text = String(rawAddress || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let province = findCurrentProvinceInText(text);

  if (!province && parts.length) {
    province = findCurrentProvinceFromName(parts[parts.length - 1]);
  }

  if (province) {
    const ward = findCurrentWardInText(province, text);

    if (ward) {
      let remainder = text;

      for (const name of [province, ward]) {
        const escaped = escapeRegExp(name);
        remainder = remainder.replace(
          new RegExp(`(^|,\\s*)${escaped}(?=\\s*(,|$))`, "i"),
          " ",
        );
      }

      remainder = remainder
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ")
        .replace(/^[,\s]+|[,\s]+$/g, "")
        .trim();

      return {
        quocGia: "Việt Nam",
        tinh: province,
        quanHuyen: "",
        phuongXa: ward,
        soNha: remainder,
        diaChiGoc: text,
      };
    }
  }

  return null;
}

// ============================================================
// PARSE OLD ADDRESS
// ============================================================

function parseOldAddress(hktt) {
  const rawProvince = getOCRProvince(hktt);
  let rawDistrict = getOCRDistrict(hktt);
  const rawWard = normalizeOCRWard(getOCRWard(hktt));
  const rawHouse = getOCRHouse(hktt);
  const rawFullAddress = String(hktt?.diaChiGoc || "").trim();

  // So sánh tên tỉnh/huyện sau khi chuẩn hóa văn bản.
  // Nếu huyện trùng tỉnh thì coi như OCR đã điền nhầm.
  if (
    rawDistrict &&
    rawProvince &&
    normalizeText(rawDistrict) === normalizeText(rawProvince)
  ) {
    rawDistrict = "";
  }

  const fullText = [rawHouse, rawWard, rawDistrict, rawProvince, rawFullAddress]
    .filter(Boolean)
    .join(", ");

  const provinceNamesInAddress = findOldNamesInsideAddress(
    fullText,
    "province",
  );

  const districtNamesInAddress = findOldNamesInsideAddress(
    fullText,
    "district",
  );

  const oldProvince =
    rawProvince ||
    (provinceNamesInAddress.length === 1 ? provinceNamesInAddress[0] : "");

  const oldDistrict =
    rawDistrict ||
    (districtNamesInAddress.length === 1 ? districtNamesInAddress[0] : "");

  return {
    rawProvince,
    rawDistrict,
    rawWard,
    rawHouse,
    fullText,
    provinceNamesInAddress,
    districtNamesInAddress,
    oldProvince,
    oldDistrict,
    oldWard: rawWard,
  };
}

// ============================================================
// CLEAN CURRENT HOUSE ADDRESS
// ============================================================

function cleanCurrentHouseAddress(
  address,
  oldWard,
  oldDistrict,
  oldProvince,
  mapping = null,
) {
  let result = String(address || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();

  if (!result) return "";

  const administrativeParts = [
    oldWard,
    mapping?.oldWard,
    oldDistrict,
    mapping?.oldDistrict,
    oldProvince,
    mapping?.oldProvince,
    ...findOldNamesInsideAddress(result, "district"),
    ...findOldNamesInsideAddress(result, "province"),
  ].filter(Boolean);

  const administrativeKeys = new Set(
    administrativeParts.map((part) => normalizeText(part)),
  );

  result = result
    .split(",")
    .map((part) => part.trim())
    .filter((part) => !administrativeKeys.has(normalizeText(part)))
    .join(", ");

  const districtNames = [
    oldDistrict,
    mapping?.oldDistrict,
    ...findOldNamesInsideAddress(result, "district"),
  ].filter(Boolean);

  const provinceNames = [
    oldProvince,
    mapping?.oldProvince,
    ...findOldNamesInsideAddress(result, "province"),
  ].filter(Boolean);

  const oldParts = [
    oldWard,
    mapping?.oldWard,
    ...districtNames,
    ...provinceNames,
  ]
    .filter(Boolean)
    .map((part) => String(part).normalize("NFC").trim())
    .filter(
      (part, index, array) =>
        array.findIndex(
          (other) => normalizeText(other) === normalizeText(part),
        ) === index,
    )
    .sort((a, b) => b.length - a.length);

  let changed = true;

  while (changed) {
    changed = false;

    for (const part of oldParts) {
      const escaped = escapeRegExp(part);
      const pattern = new RegExp(`(?:,\\s*|\\s+)${escaped}\\s*$`, "i");

      if (pattern.test(result)) {
        result = result.replace(pattern, "").trim();
        result = result.replace(/[,;\s]+$/g, "").trim();
        changed = true;
      }
    }
  }

  return result
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[,;\s]+|[,;\s]+$/g, "")
    .trim();
}

// ============================================================
// CHECK WHETHER ADDRESS IS ALREADY CURRENT
// ============================================================

function checkCurrentAddress(hktt) {
  const rawProvince = getOCRProvince(hktt);
  const rawWard = normalizeOCRWard(getOCRWard(hktt));

  if (!rawProvince || !rawWard) return null;

  const provinces = getProvincesSafely();

  if (!provinces.length) {
    console.warn("Chưa tải được hierarchy.json.");
    return null;
  }

  const currentProvince = findCurrentProvinceFromName(rawProvince);
  if (!currentProvince) return null;

  const currentWard = findCurrentWard(currentProvince, rawWard);
  if (!currentWard) return null;

  if (!isCurrentAddress(currentProvince, currentWard, provinces)) {
    return null;
  }

  return {
    province: currentProvince,
    ward: currentWard,
  };
}

// ============================================================
// NORMALIZE MAPPING RESULT
// ============================================================

function uniqueMappingTargets(records) {
  const unique = new Map();

  for (const item of records || []) {
    if (!item?.newProvince || !item?.newWard) continue;

    const key = `${normalizeAdministrativeName(
      item.newProvince,
      "province",
    )}|${normalizeAdministrativeName(item.newWard, "ward")}`;

    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return [...unique.values()];
}

function formatMappingResult(item) {
  return {
    status: "matched",
    oldProvince: item.oldProvince || "",
    oldDistrict: item.oldDistrict || "",
    oldWard: item.oldWard || "",
    currentProvince: item.newProvince || "",
    currentWard: item.newWard || "",
    newProvince: item.newProvince || "",
    newWard: item.newWard || "",
    source: item.source || "addressMapping.json",
    confidence: item.confidence || "exact",
    record: item,
  };
}

// ============================================================
// FIND MAPPING FOR HKTT
// ============================================================

function findMappingForHKTT(hktt) {
  const parsed = parseOldAddress(hktt);

  const normalize = (value, kind = "") =>
    normalizeAdministrativeName(value, kind);

  const wardKey = normalize(parsed.oldWard, "ward");
  const provinceKey = normalize(parsed.oldProvince, "province");
  const districtKey = normalize(parsed.oldDistrict, "district");

  console.log("Địa chỉ OCR sau chuẩn hóa:", parsed);

  if (!wardKey || !provinceKey) {
    console.warn("Thiếu tỉnh hoặc xã/phường để tìm mapping.");
    return null;
  }

  // Lọc theo xã/phường cũ trước.
  const wardRecords = addressMappingRecords.filter(
    (item) => item?.oldWard && normalize(item.oldWard, "ward") === wardKey,
  );

  console.log("Số bản ghi khớp xã/phường:", wardRecords.length);

  // Sau đó lọc theo tỉnh cũ.
  const provinceRecords = wardRecords.filter(
    (item) =>
      item?.oldProvince &&
      (normalize(item.oldProvince, "province") === provinceKey ||
        sameOldProvinceName(
          parsed.oldProvince,
          item.oldProvince,
          parsed.fullText,
        )),
  );

  console.log("Số bản ghi khớp xã/phường + tỉnh:", provinceRecords.length);

  if (!provinceRecords.length) {
    console.warn(
      "Không có bản ghi mapping phù hợp. Kiểm tra tên xã cũ trong addressMapping.json.",
      {
        oldProvince: parsed.oldProvince,
        oldDistrict: parsed.oldDistrict,
        oldWard: parsed.oldWard,
      },
    );
    return null;
  }

  // Nếu OCR có huyện thì ưu tiên khớp huyện.
  let candidates = provinceRecords;

  if (districtKey) {
    const districtRecords = provinceRecords.filter(
      (item) =>
        item?.oldDistrict &&
        normalize(item.oldDistrict, "district") === districtKey,
    );

    if (districtRecords.length) {
      candidates = districtRecords;
    } else {
      console.warn("Không khớp huyện OCR; thử dùng tỉnh + xã/phường.", {
        ocrDistrict: parsed.oldDistrict,
        mappingDistricts: [
          ...new Set(
            provinceRecords.map((item) => item.oldDistrict).filter(Boolean),
          ),
        ],
      });
    }
  }

  const targets = uniqueMappingTargets(candidates);

  if (targets.length !== 1) {
    console.warn("Mapping không có một đích duy nhất; không tự chọn.", targets);

    return {
      status: "multiple",
      candidates: targets.map((item) => ({
        oldProvince: item.oldProvince || "",
        oldDistrict: item.oldDistrict || "",
        oldWard: item.oldWard || "",
        currentProvince: item.newProvince || "",
        currentWard: item.newWard || "",
      })),
    };
  }

  const result = formatMappingResult(targets[0]);
  console.log("Mapping đã xác minh:", result);

  return result;
}

// ============================================================
// BUILD FULL ADDRESS
// ============================================================

function buildFullAddress({ soNha = "", phuongXa = "", tinh = "" }) {
  return [soNha, phuongXa, tinh]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeCurrentAddressBeforeSave(formData) {
  const soNha = String(formData.soNhaHienNay || "").trim();
  const phuongXa = String(formData.phuongXaHienNay || "").trim();
  const tinh = String(formData.tinhHienNay || "").trim();

  formData.diaChiHienNay = [soNha, phuongXa, tinh].filter(Boolean).join(", ");

  return formData;
}

function syncFullAddressFields() {
  const hkttFull = document.getElementById("diaChiHKTT");

  if (hkttFull) {
    hkttFull.value = buildFullAddress({
      soNha: document.getElementById("soNhaHKTT")?.value,
      phuongXa: document.getElementById("phuongXaHKTT")?.value,
      tinh: document.getElementById("HKTT_Tinh")?.value,
    });
  }

  const currentFull = document.getElementById("diaChiHienNay");

  if (currentFull) {
    currentFull.value = buildFullAddress({
      soNha: document.getElementById("soNhaHienNay")?.value,
      phuongXa: document.getElementById("phuongXaHienNay")?.value,
      tinh: document.getElementById("tinhHienNay")?.value,
    });
  }
}

// ============================================================
// CURRENT ADDRESS DATA
// ============================================================

function buildCurrentAddressData({
  quocGia = "Việt Nam",
  tinh = "",
  phuongXa = "",
  soNha = "",
} = {}) {
  return {
    quocGiaHienNay: quocGia || "Việt Nam",
    tinhHienNay: tinh,
    phuongXaHienNay: phuongXa,
    soNhaHienNay: soNha,
    quanHuyenHienNay: "Không áp dụng",
  };
}

function detectCCCDType(data) {
  if (!data || typeof data !== "object") {
    return "unknown";
  }

  // 1. Ưu tiên trường loại giấy tờ do OCR trả về.
  const explicitType = String(
    data.loaiCCCD ??
      data.cccdType ??
      data.cardType ??
      data.loaiGiayTo ??
      data.documentType ??
      "",
  )
    .normalize("NFC")
    .toLowerCase()
    .trim();

  if (
    explicitType.includes("cmnd") ||
    explicitType.includes("chứng minh nhân dân") ||
    explicitType.includes("9 số") ||
    explicitType.includes("9 digit") ||
    explicitType.includes("old")
  ) {
    return "old";
  }

  if (explicitType.includes("mới") || explicitType.includes("new")) {
    return "new";
  }

  // 2. CCCD/thẻ căn cước mới thường dùng nhãn "Nơi cư trú".
  const newAddressLabels = [
    "Nơi cư trú",
    "Nơi cư trú:",
    "noiCuTru",
    "noiCưTrú",
  ];

  if (
    newAddressLabels.some(
      (key) =>
        data[key] !== undefined &&
        data[key] !== null &&
        String(data[key]).trim() !== "",
    )
  ) {
    return "new";
  }

  // 3. CCCD cũ thường dùng nhãn "Nơi thường trú".
  const oldAddressLabels = [
    "Nơi thường trú",
    "Nơi thường trú:",
    "noiThuongTru",
    "noiThườngTrú",
    "thuongTru",
  ];

  if (
    oldAddressLabels.some(
      (key) =>
        data[key] !== undefined &&
        data[key] !== null &&
        String(data[key]).trim() !== "",
    )
  ) {
    return "old";
  }

  // 4. Kiểm tra các trường thông tin OCR trả về.
  // Không tự suy luận loại thẻ chỉ dựa vào địa chỉ HKTT.
  return "unknown";
}

// ============================================================
// FILL FORM FROM OCR
// ============================================================

async function fillFormFromOCR(data) {
  if (!data || typeof data !== "object") {
    console.warn("Dữ liệu OCR không hợp lệ.");
    return;
  }

  if (addressReady) {
    await addressReady;
  }

  const hktt = getOCRAddressSource(data);
  const addressString = String(hktt?.diaChiGoc || hktt?.diaChi || "").trim();

  if (addressString && (!getOCRProvince(hktt) || !getOCRWard(hktt))) {
    const parsedCurrentAddress = parseAddressText(addressString);

    if (parsedCurrentAddress) {
      Object.assign(hktt, parsedCurrentAddress);
      console.log(
        "Địa chỉ chuỗi OCR được tách theo dữ liệu hiện hành:",
        parsedCurrentAddress,
      );
    }
  }

  const oldProvince = getOCRProvince(hktt);
  const rawOldDistrict = getOCRDistrict(hktt);

  const oldDistrict =
    rawOldDistrict &&
    oldProvince &&
    sameAdminName(rawOldDistrict, oldProvince, "district")
      ? ""
      : rawOldDistrict;

  const oldWard = normalizeOCRWard(getOCRWard(hktt));
  const oldHouse = getOCRHouse(hktt);
  const country = getOCRCountry(hktt);

  const cccdType = detectCCCDType(data);

  console.log("Loại CCCD nhận diện:", cccdType);

  const currentAddress = checkCurrentAddress(hktt);

  // Chạy mapping địa giới cũ -> mới khi địa chỉ chưa thuộc hệ thống hiện hành và:
  // - thẻ cũ (BE trả cardType = "old"), hoặc
  // - địa chỉ còn cấp quận/huyện (đã bỏ từ 01/07/2025). Thẻ căn cước 2024
  //   cấp trước thời điểm đó vẫn in địa chỉ 3 cấp.
  const hasDistrictLevel = Boolean(oldDistrict);

  const mapping =
    !currentAddress && (cccdType === "old" || hasDistrictLevel)
      ? findMappingForHKTT(hktt)
      : null;

  const mappedOldDistrict =
    mapping?.status === "matched" && mapping.oldDistrict
      ? mapping.oldDistrict
      : oldDistrict;

  const currentHouse = cleanCurrentHouseAddress(
    oldHouse,
    oldWard,
    mappedOldDistrict,
    oldProvince,
    mapping?.status === "matched" ? mapping : null,
  );

  console.log("===== DEBUG ĐỊA CHỈ =====");
  console.log({
    oldHouse,
    oldWard,
    oldDistrict,
    oldProvince,
    mappedOldDistrict,
    mappingStatus: mapping?.status,
    mappingOldDistrict: mapping?.oldDistrict,
    mappingOldWard: mapping?.oldWard,
    currentWard: mapping?.currentWard,
    currentProvince: mapping?.currentProvince,
    currentHouse,
  });

  console.log("===== KIỂM TRA OCR ĐỊA CHỈ =====");
  console.log("HKTT gốc:", hktt);
  console.log("Tỉnh OCR:", oldProvince);
  console.log("Huyện OCR:", oldDistrict);
  console.log("Phường/xã OCR:", oldWard);
  console.log("Địa chỉ OCR:", oldHouse);
  console.log("Địa chỉ đầy đủ OCR:", hktt?.diaChiGoc || "");
  console.log("Huyện cũ theo mapping:", mappedOldDistrict);
  console.log("Địa chỉ cụ thể sau làm sạch:", currentHouse);
  console.log("Kết quả mapping:", mapping);

  const formData = {
    soGiayTo: data.soGiayTo || "",
    hoDem: data.hoDem || "",
    ten: data.ten || "",
    hoTen: data.hoTen || "",
    ngaySinh: data.ngaySinh || "",
    gioiTinh: data.gioiTinh || "",
    quocTich: data.quocTich || "",
    danToc: data.danToc || "",
    nguyenQuan: data.nguyenQuan || "",
    noiSinh: data.noiSinh || "",
    noiCapGiayTo: data.noiCapGiayTo || "",
    ngayCap: data.ngayCap || "",
    ngayHetHan: data.ngayHetHan || "",

    // Giữ địa chỉ trên giấy tờ ở phần HKTT.
    quocGiaHKTT: country,
    HKTT_Tinh: oldProvince,
    phuongXaHKTT: oldWard,
    soNhaHKTT: oldHouse,
    quanHuyenHKTT: oldDistrict || "Không áp dụng",
  };

  let currentAddressData = buildCurrentAddressData({
    quocGia: country,
    soNha: currentHouse,
  });

  if (currentAddress) {
    currentAddressData = buildCurrentAddressData({
      quocGia: country,
      tinh: currentAddress.province,
      phuongXa: currentAddress.ward,
      soNha: currentHouse,
    });

    console.log("Địa chỉ đã thuộc hệ thống hiện hành:", currentAddress);
  } else if (mapping?.status === "matched") {
    const province = findCurrentProvinceFromName(
      mapping.currentProvince || mapping.newProvince,
    );

    const ward = province
      ? findCurrentWard(province, mapping.currentWard || mapping.newWard)
      : null;

    if (province && ward) {
      currentAddressData = buildCurrentAddressData({
        quocGia: country,
        tinh: province,
        phuongXa: ward,
        soNha: currentHouse,
      });

      console.log("Mapping đã xác minh:", {
        province,
        ward,
        source: mapping.source,
        confidence: mapping.confidence,
      });
    } else {
      console.warn(
        "Đích mapping không khớp hierarchy.json. Không tự đoán địa chỉ mới.",
        mapping,
      );
    }
  } else if (mapping?.status === "multiple") {
    console.warn(
      "Có nhiều địa chỉ đích; không tự chọn để tránh sai.",
      mapping.candidates,
    );
  } else {
    console.warn(
      "Không tìm được mapping duy nhất. Giữ nguyên thông tin đã xác định, không tự đoán.",
    );
  }

  Object.assign(formData, currentAddressData);

  setFormData(formData);
  syncFullAddressFields();

  console.log("HKTT trên giấy tờ:", {
    province: formData.HKTT_Tinh,
    ward: formData.phuongXaHKTT,
    house: formData.soNhaHKTT,
  });

  console.log("Chỗ ở hiện nay:", {
    province: formData.tinhHienNay,
    ward: formData.phuongXaHienNay,
    house: formData.soNhaHienNay,
    fullAddress: formData.diaChiHienNay,
  });
}

// ============================================================
// OCR EVENT
// ============================================================

window.addEventListener("cccdOCRCompleted", async (event) => {
  console.log("Nhận kết quả OCR CCCD.");

  try {
    const data = normalizeOCRData(event.detail);
    await fillFormFromOCR(data);
    renderOCRReview(event.detail?._validation);
  } catch (error) {
    console.error("Lỗi xử lý kết quả OCR:", error);
  }
});

// ============================================================
// SAVE PROFILE
// ============================================================

document.getElementById("saveProfileBtn")?.addEventListener("click", () => {
  const formData = normalizeCurrentAddressBeforeSave(getFormData());
  const uploadState = getUploadState();

  if (!formData.hoTen || !formData.hoTen.trim()) {
    alert("Vui lòng nhập Họ và tên trước khi lưu.");
    return;
  }

  const oldProfile = editingId ? getProfileById(editingId) : null;

  const profile = {
    id: editingId,
    ...formData,
    frontDataUrl: uploadState.frontDataUrl || oldProfile?.frontDataUrl || null,
    backDataUrl: uploadState.backDataUrl || oldProfile?.backDataUrl || null,
    portraitDataUrl:
      uploadState.portraitDataUrl || oldProfile?.portraitDataUrl || null,
  };

  const savedProfile = saveProfile(profile);

  console.log("Đã lưu hồ sơ:", savedProfile);
  alert("Đã lưu hồ sơ thành công!");

  closeExtractModal();

  profileListModal?.classList.remove("hidden");
  renderProfileList({ onEdit: openProfileForEdit });
});

// ============================================================
// INITIALIZE COMPONENTS
// ============================================================

initSidebar(() => {
  const title = document.getElementById("extractTitle");

  if (title) {
    title.textContent = "Trích xuất tự động từ giấy tờ";
  }
});

initProfileForm();

initProfileList({
  onEdit: openProfileForEdit,
});

initUploadForm();

// ============================================================
// INITIALIZE ADDRESS DATA
// ============================================================

async function initAddress() {
  console.log("Bắt đầu khởi tạo dữ liệu địa chỉ...");

  const provinces = await initAddressData();

  console.log(
    "Đã tải hierarchy.json:",
    Array.isArray(provinces) ? provinces.length : 0,
    "tỉnh/thành",
  );

  const mapping = await loadAddressMapping();

  addressMappingRecords = Array.isArray(mapping?.mappings)
    ? mapping.mappings
    : [];

  console.log(
    "Đã tải addressMapping.json:",
    addressMappingRecords.length,
    "bản ghi",
  );

  initCountryCombobox({
    inputId: "quocGiaHKTT",
    optionsId: "quocGiaHKTTOptions",
  });

  initAddressCombobox({
    provinceInputId: "HKTT_Tinh",
    provinceOptionsId: "HKTT_TinhOptions",
    wardInputId: "phuongXaHKTT",
    wardOptionsId: "phuongXaHKTTOptions",
  });

  initCountryCombobox({
    inputId: "quocGiaHienNay",
    optionsId: "quocGiaHienNayOptions",
  });

  initAddressCombobox({
    provinceInputId: "tinhHienNay",
    provinceOptionsId: "tinhHienNayOptions",
    wardInputId: "phuongXaHienNay",
    wardOptionsId: "phuongXaHienNayOptions",
  });

  console.log("Khởi tạo dữ liệu địa chỉ hoàn tất.");
}

addressReady = initAddress().catch((error) => {
  console.error("Lỗi khởi tạo dữ liệu địa chỉ:", error);
  throw error;
});

console.log("app.js đã khởi động.");
