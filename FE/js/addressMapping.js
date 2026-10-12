// ============================================================
// addressMapping.js
// Mapping địa chỉ cũ -> địa chỉ mới sau sắp xếp hành chính
// ============================================================

let mappingData = {
  version: "",
  effectiveDate: "",
  source: "",
  mappings: [],
};

// ============================================================
// CHUẨN HÓA CHUỖI
// ============================================================

export function normalizeAddressText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[.,;:()[\]/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAdministrativeName(value, kind = "") {
  let text = normalizeAddressText(value);

  if (!text) return "";

  const prefixes = {
    province: /^(tinh|thanh pho|tp|city|province)\s+/,
    district: /^(quan|huyen|thi xa|thanh pho|tp|thi tran|district)\s+/,
    ward: /^(phuong|p|xa|x|thi tran|ward|commune)\s+/,
  };

  if (prefixes[kind]) {
    text = text.replace(prefixes[kind], "");
  }

  return text.trim();
}

function sameName(a, b, kind = "") {
  const left = normalizeAdministrativeName(a, kind);
  const right = normalizeAdministrativeName(b, kind);

  return Boolean(left && right && left === right);
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[rows - 1][cols - 1];
}

function similarAdministrativeName(a, b, kind = "") {
  const left = normalizeAdministrativeName(a, kind);
  const right = normalizeAdministrativeName(b, kind);

  if (!left || !right) return false;
  if (left === right) return true;

  // Không fuzzy-match tên quá ngắn vì dễ nhầm địa danh.
  if (Math.min(left.length, right.length) < 6) return false;

  const distance = editDistance(left, right);

  // Chỉ cho phép một lỗi ký tự với tên ngắn,
  // tối đa hai lỗi với tên dài.
  const maxDistance = Math.max(left.length, right.length) >= 12 ? 2 : 1;

  return distance <= maxDistance;
}

// ============================================================
// TẢI MAPPING
// ============================================================

export async function loadAddressMapping() {
  const url = new URL("../data/addressMapping.json", import.meta.url);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Không thể tải addressMapping.json: HTTP ${response.status}`,
    );
  }

  const json = await response.json();

  mappingData = {
    version: json.version || "",
    effectiveDate: json.effectiveDate || "",
    source: json.source || "",
    mappings: Array.isArray(json.mappings) ? json.mappings : [],
  };

  console.log(
    `Đã tải addressMapping.json: ${mappingData.mappings.length} bản ghi`,
  );

  return mappingData;
}

export function getAddressMapping() {
  return mappingData;
}

// ============================================================
// KIỂM TRA ĐỊA CHỈ HIỆN HÀNH
// hierarchy.json phải có cấu trúc:
// [{ name: { local: "..." }, ward: [{ name: { local: "..." } }] }]
// ============================================================

export function isCurrentAddress(province, ward, vietnamData = []) {
  if (!province || !ward || !Array.isArray(vietnamData)) {
    return false;
  }

  const provinceMatches = vietnamData.filter((item) =>
    sameName(item?.name?.local, province, "province"),
  );

  if (provinceMatches.length !== 1) {
    return false;
  }

  const wards = provinceMatches[0].ward;

  if (!Array.isArray(wards)) {
    return false;
  }

  return (
    wards.filter((item) => sameName(item?.name?.local, ward, "ward")).length ===
    1
  );
}

// ============================================================
// TIỆN ÍCH MAPPING
// ============================================================

function getValidRecords() {
  return mappingData.mappings.filter(
    (item) =>
      item?.oldProvince && item?.oldWard && item?.newProvince && item?.newWard,
  );
}

function getTargetKey(item) {
  return [
    normalizeAdministrativeName(item.newProvince, "province"),
    normalizeAdministrativeName(item.newWard, "ward"),
  ].join("|");
}

function uniqueTargets(records) {
  const targets = new Map();

  for (const item of records) {
    const key = getTargetKey(item);

    if (!targets.has(key)) {
      targets.set(key, item);
    }
  }

  return [...targets.values()];
}

function formatMatched(item) {
  return {
    status: "matched",
    oldProvince: item.oldProvince || "",
    oldDistrict: item.oldDistrict || "",
    oldWard: item.oldWard || "",
    currentProvince: item.newProvince || "",
    currentWard: item.newWard || "",
    newProvince: item.newProvince || "",
    newWard: item.newWard || "",
    newWardCode: item.newWardCode || "",
    type: item.type || "unknown",
    confidence: item.confidence || "unknown",
    source: item.source || "",
    effectiveDate: item.effectiveDate || "",
    record: item,
  };
}

function formatMultiple(records) {
  return {
    status: "multiple",
    candidates: records.map((item) => ({
      oldProvince: item.oldProvince || "",
      oldDistrict: item.oldDistrict || "",
      oldWard: item.oldWard || "",
      currentProvince: item.newProvince || "",
      currentWard: item.newWard || "",
      newWardCode: item.newWardCode || "",
      source: item.source || "",
      effectiveDate: item.effectiveDate || "",
    })),
  };
}

// ============================================================
// TÌM MAPPING KHI CÓ ĐỦ TỈNH + HUYỆN + PHƯỜNG/XÃ
// ============================================================

export function findAddressMapping(oldProvince, oldDistrict, oldWard) {
  const province = String(oldProvince ?? "").trim();
  const district = String(oldDistrict ?? "").trim();
  const ward = String(oldWard ?? "").trim();

  if (!province || !ward) {
    return null;
  }

  const records = getValidRecords();

  if (!records.length) {
    console.warn("Mapping chưa được tải hoặc không có bản ghi hợp lệ.");
    return null;
  }

  const wardRecords = records.filter((item) =>
    sameName(item.oldWard, ward, "ward"),
  );

  let candidates = wardRecords.filter((item) =>
    sameName(item.oldProvince, province, "province"),
  );

  if (district) {
    candidates = candidates.filter((item) =>
      sameName(item.oldDistrict, district, "district"),
    );
  }

  const targets = uniqueTargets(candidates);

  if (targets.length === 1) {
    return formatMatched(targets[0]);
  }

  if (targets.length > 1) {
    return formatMultiple(targets);
  }

  console.warn("Không tìm thấy mapping chính xác:", {
    oldProvince: province,
    oldDistrict: district,
    oldWard: ward,
    wardCandidates: wardRecords.length,
  });

  return null;
}

// ============================================================
// TÌM MAPPING TỪ TOÀN BỘ CHUỖI ĐỊA CHỈ
//
// Dùng khi OCR đưa huyện/tỉnh vào trường soNha.
// Chỉ chấp nhận kết quả nếu bằng chứng địa chỉ đủ rõ
// và chỉ dẫn tới một địa chỉ mới.
// ============================================================

export function findAddressMappingFromText({
  province = "",
  district = "",
  ward = "",
  addressText = "",
} = {}) {
  const records = getValidRecords();

  if (!records.length || !String(ward).trim()) {
    return null;
  }

  const allText = normalizeAddressText(
    [province, district, ward, addressText].filter(Boolean).join(" "),
  );

  const provinceKey = normalizeAdministrativeName(province, "province");

  const districtKey = normalizeAdministrativeName(district, "district");

  const wardKey = normalizeAdministrativeName(ward, "ward");

  // Xác định tỉnh/huyện theo tên xuất hiện trong toàn bộ địa chỉ.
  // Dùng chuỗi đã bỏ dấu để chịu được lỗi dấu tiếng Việt.
  const hasNameInText = (name, kind) => {
    const key = normalizeAdministrativeName(name, kind);
    if (!key) return false;

    return ` ${allText} `.includes(` ${key} `);
  };

  const hasProvince = (item) =>
    (provinceKey &&
      normalizeAdministrativeName(item.oldProvince, "province") ===
        provinceKey) ||
    hasNameInText(item.oldProvince, "province");

  const hasDistrict = (item) =>
    (districtKey &&
      normalizeAdministrativeName(item.oldDistrict, "district") ===
        districtKey) ||
    hasNameInText(item.oldDistrict, "district");

  const exactWardRecords = records.filter(
    (item) => normalizeAdministrativeName(item.oldWard, "ward") === wardKey,
  );

  let wardRecords = exactWardRecords;

  // Chỉ dùng fuzzy matching nếu không có tên xã khớp chính xác.
  if (!wardRecords.length) {
    wardRecords = records.filter((item) =>
      similarAdministrativeName(item.oldWard, ward, "ward"),
    );
  }

  if (!wardRecords.length) {
    console.warn("Không tìm thấy xã/phường khớp OCR:", {
      province,
      district,
      ward,
      addressText,
    });

    return null;
  }

  // Thu hẹp theo bằng chứng tỉnh và huyện.
  let candidates = wardRecords;

  const provinceMatches = candidates.filter(hasProvince);
  if (provinceMatches.length) {
    candidates = provinceMatches;
  } else if (provinceKey) {
    // Tỉnh OCR không khớp tên chuẩn; giữ candidates để
    // thử nhận diện tỉnh từ phần địa chỉ đầy đủ.
    const textProvinceMatches = candidates.filter((item) =>
      hasNameInText(item.oldProvince, "province"),
    );

    if (textProvinceMatches.length) {
      candidates = textProvinceMatches;
    }
  }

  const districtMatches = candidates.filter(hasDistrict);
  if (districtMatches.length) {
    candidates = districtMatches;
  }

  const targets = uniqueTargets(candidates);

  if (targets.length === 1) {
    return formatMatched(targets[0]);
  }

  if (targets.length > 1) {
    return formatMultiple(targets);
  }

  return null;
}
