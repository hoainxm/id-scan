const form = () => document.getElementById("profileForm");

// ============================================================
// ĐỒNG BỘ ĐỊA CHỈ ĐẦY ĐỦ
// ============================================================

// Địa chỉ cũ (trước 01/07/2025) còn cấp quận/huyện; địa chỉ mới thì ô này là "Không áp dụng".
function districtPart(value) {
  const district = String(value ?? "").trim();
  return district.toLowerCase() === "không áp dụng" ? "" : district;
}

function joinAddress(parts) {
  return parts
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function rebuildAddressField(suffix) {
  const soNha = document.querySelector(`[name="soNha${suffix}"]`);
  const phuongXa = document.querySelector(`[name="phuongXa${suffix}"]`);
  const quanHuyen = document.querySelector(`[name="quanHuyen${suffix}"]`);
  const tinh = document.querySelector(
    `[name="${suffix === "HKTT" ? "HKTT_Tinh" : "tinhHienNay"}"]`,
  );
  const diaChi = document.querySelector(`[name="diaChi${suffix}"]`);

  if (!diaChi) return;

  // Luôn tạo lại từ các trường thành phần, không nối vào giá trị cũ.
  diaChi.value = joinAddress([
    soNha?.value,
    phuongXa?.value,
    districtPart(quanHuyen?.value),
    tinh?.value,
  ]);
}

function syncAddress(suffix) {
  const soNha = document.querySelector(`[name="soNha${suffix}"]`);
  const phuongXa = document.querySelector(`[name="phuongXa${suffix}"]`);
  const quanHuyen = document.querySelector(`[name="quanHuyen${suffix}"]`);
  const tinh = document.querySelector(
    `[name="${suffix === "HKTT" ? "HKTT_Tinh" : "tinhHienNay"}"]`,
  );

  const rebuild = () => rebuildAddressField(suffix);

  [soNha, phuongXa, quanHuyen, tinh].forEach((field) => {
    if (!field || field.dataset.addressSyncBound === "true") return;

    field.addEventListener("input", rebuild);
    field.addEventListener("change", rebuild);
    field.dataset.addressSyncBound = "true";
  });

  rebuild();
}

// ============================================================
// KHỞI TẠO FORM
// ============================================================

export function initProfileForm() {
  const profileForm = form();
  if (!profileForm) {
    console.warn("Không tìm thấy #profileForm.");
    return;
  }

  // Thu gọn / mở rộng các phần thông tin.
  document.querySelectorAll(".form-section-title").forEach((title) => {
    if (title.dataset.sectionBound === "true") return;

    title.addEventListener("click", () => {
      const targetId = title.dataset.target;
      if (!targetId) return;

      const section = document.getElementById(targetId);
      if (!section) return;

      section.classList.toggle("hidden");
      title.classList.toggle("collapsed");
    });

    title.dataset.sectionBound = "true";
  });

  // Tự ghép họ và tên.
  const hoDem = profileForm.querySelector('[name="hoDem"]');
  const ten = profileForm.querySelector('[name="ten"]');
  const hoTen = profileForm.querySelector('[name="hoTen"]');

  const rebuildFullName = () => {
    if (!hoTen) return;

    hoTen.value = [hoDem?.value, ten?.value]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ");
  };

  [hoDem, ten].forEach((field) => {
    if (!field || field.dataset.fullNameBound === "true") return;

    field.addEventListener("input", rebuildFullName);
    field.dataset.fullNameBound = "true";
  });

  // Đồng bộ hai nhóm địa chỉ.
  syncAddress("HKTT");
  syncAddress("HienNay");
}

// ============================================================
// LẤY DỮ LIỆU FORM
// ============================================================

export function getFormData() {
  const profileForm = form();
  if (!profileForm) return {};

  const data = {};

  new FormData(profileForm).forEach((value, key) => {
    data[key] = value;
  });

  // Luôn lưu địa chỉ đầy đủ được ghép từ ba trường thành phần.
  data.diaChiHKTT = joinAddress([
    data.soNhaHKTT,
    data.phuongXaHKTT,
    districtPart(data.quanHuyenHKTT),
    data.HKTT_Tinh,
  ]);

  data.diaChiHienNay = [
    data.soNhaHienNay,
    data.phuongXaHienNay,
    data.tinhHienNay,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");

  return data;
}

// ============================================================
// ĐIỀN DỮ LIỆU VÀO FORM
// ============================================================

export function setFormData(data = {}) {
  const profileForm = form();
  if (!profileForm) return;

  Object.entries(data).forEach(([key, value]) => {
    const field = profileForm.querySelector(`[name="${key}"]`);
    if (!field) return;

    field.value = value ?? "";
  });

  // Nếu thiếu họ tên đầy đủ, tạo lại từ họ đệm và tên.
  const hoTen = profileForm.querySelector('[name="hoTen"]');

  if (hoTen && !String(hoTen.value ?? "").trim()) {
    const hoDem = profileForm.querySelector('[name="hoDem"]')?.value;
    const ten = profileForm.querySelector('[name="ten"]')?.value;

    hoTen.value = [hoDem, ten]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ");
  }

  // Không giữ lại giá trị địa chỉ đầy đủ cũ nếu nó không khớp
  // với các trường thành phần hiện tại.
  rebuildAddressField("HKTT");
  rebuildAddressField("HienNay");
}

// ============================================================
// RESET FORM
// ============================================================

export function resetFormData() {
  const profileForm = form();
  if (!profileForm) return;

  profileForm.reset();

  // Đóng danh sách chọn (class "show"); không dùng "hidden" vì sẽ ẩn hẳn danh sách.
  profileForm
    .querySelectorAll(".combobox-options")
    .forEach((options) => options.classList.remove("show", "hidden"));

  profileForm.querySelectorAll(".combobox").forEach((combobox) => {
    combobox.classList.remove("active");
  });

  rebuildAddressField("HKTT");
  rebuildAddressField("HienNay");
}
