const form = () => document.getElementById("profileForm");

// ============================================================
// ĐỒNG BỘ ĐỊA CHỈ ĐẦY ĐỦ
// ============================================================

function rebuildAddressField(suffix) {
  const soNha = document.querySelector(`[name="soNha${suffix}"]`);
  const phuongXa = document.querySelector(`[name="phuongXa${suffix}"]`);
  const tinh = document.querySelector(
    `[name="${suffix === "HKTT" ? "HKTT_Tinh" : "tinhHienNay"}"]`,
  );
  const diaChi = document.querySelector(`[name="diaChi${suffix}"]`);

  if (!diaChi) return;

  // Luôn tạo lại từ các trường thành phần, không nối vào giá trị cũ.
  diaChi.value = [soNha?.value, phuongXa?.value, tinh?.value]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function syncAddress(suffix) {
  const soNha = document.querySelector(`[name="soNha${suffix}"]`);
  const phuongXa = document.querySelector(`[name="phuongXa${suffix}"]`);
  const tinh = document.querySelector(
    `[name="${suffix === "HKTT" ? "HKTT_Tinh" : "tinhHienNay"}"]`,
  );

  const rebuild = () => rebuildAddressField(suffix);

  [soNha, phuongXa, tinh].forEach((field) => {
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

  // Khởi tạo các combobox.
  [
    "gioiTinh",
    "danToc",
    "quocTich",
    "loaiGiayTo",
    "noiCapGiayTo",
    "quocGiaHKTT",
    "quocGiaHienNay",
  ].forEach((name) => {
    const input = profileForm.querySelector(`[name="${name}"]`);
    if (input) initCombobox(input);
  });
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
  data.diaChiHKTT = [data.soNhaHKTT, data.phuongXaHKTT, data.HKTT_Tinh]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");

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

  profileForm
    .querySelectorAll(".combobox-options")
    .forEach((options) => options.classList.add("hidden"));

  profileForm.querySelectorAll(".combobox").forEach((combobox) => {
    combobox.classList.remove("active");
  });

  rebuildAddressField("HKTT");
  rebuildAddressField("HienNay");
}

// ============================================================
// COMBOBOX
// ============================================================

function initCombobox(input) {
  if (!input || input.dataset.comboboxBound === "true") return;

  const wrapper = input.closest(".combobox");
  if (!wrapper) return;

  const options = wrapper.querySelector(".combobox-options");
  if (!options) return;

  const items = () =>
    Array.from(
      options.querySelectorAll('[role="option"], .combobox-option, li, button'),
    ).filter((item) => {
      return !item.classList.contains("hidden");
    });

  const closeOptions = () => {
    options.classList.add("hidden");
    wrapper.classList.remove("active");
  };

  const openOptions = () => {
    options.classList.remove("hidden");
    wrapper.classList.add("active");
  };

  const filterOptions = () => {
    const keyword = input.value.trim().toLocaleLowerCase("vi");

    Array.from(options.children).forEach((item) => {
      const text = (item.textContent || "").trim().toLocaleLowerCase("vi");
      item.classList.toggle(
        "hidden",
        Boolean(keyword) && !text.includes(keyword),
      );
    });

    openOptions();
  };

  input.addEventListener("focus", openOptions);
  input.addEventListener("click", openOptions);
  input.addEventListener("input", filterOptions);

  input.addEventListener("keydown", (event) => {
    const visibleItems = items();

    if (event.key === "Escape") {
      closeOptions();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      openOptions();

      if (visibleItems.length) {
        visibleItems[0].focus();
      }
    }
  });

  options.addEventListener("click", (event) => {
    const item = event.target.closest(
      '[role="option"], .combobox-option, li, button',
    );

    if (!item || !options.contains(item)) return;

    const value =
      item.dataset.value ??
      item.getAttribute("data-value") ??
      item.textContent?.trim();

    if (value == null) return;

    input.value = String(value).trim();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    closeOptions();
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) {
      closeOptions();
    }
  });

  input.dataset.comboboxBound = "true";
}
