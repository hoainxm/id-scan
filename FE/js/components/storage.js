// storage.js
// Lớp trung gian lưu trữ hồ sơ. Hiện tại dùng localStorage để demo phần FE.
// Khi làm BE, chỉ cần thay nội dung các hàm bên dưới bằng fetch() gọi API,
// phần giao diện (profileList.js, uploadForm.js...) không cần sửa gì thêm.

const STORAGE_KEY = "ho_so_list";

function normalizeProfileAddress(profile) {
  const normalized = { ...profile };

  const soNha = String(normalized.soNhaHienNay ?? "").trim();
  const phuongXa = String(normalized.phuongXaHienNay ?? "").trim();
  const tinh = String(normalized.tinhHienNay ?? "").trim();

  normalized.diaChiHienNay = [soNha, phuongXa, tinh].filter(Boolean).join(", ");

  return normalized;
}

export function getAllProfiles() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) return [];

  try {
    const profiles = JSON.parse(raw);
    return Array.isArray(profiles) ? profiles : [];
  } catch (error) {
    console.error("Không đọc được danh sách hồ sơ:", error);
    return [];
  }
}

export function saveProfile(profile) {
  const list = getAllProfiles();
  const normalizedProfile = normalizeProfileAddress(profile);

  if (normalizedProfile.id) {
    const idx = list.findIndex((item) => item.id === normalizedProfile.id);

    if (idx !== -1) {
      list[idx] = normalizedProfile;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return normalizedProfile;
    }
  }

  normalizedProfile.id =
    "hs_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

  list.push(normalizedProfile);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));

  return normalizedProfile;
}

export function deleteProfiles(ids) {
  const idSet = new Set(ids.map(String));

  const list = getAllProfiles().filter(
    (profile) => !idSet.has(String(profile.id)),
  );

  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getProfileById(id) {
  return (
    getAllProfiles().find((profile) => String(profile.id) === String(id)) ||
    null
  );
}
