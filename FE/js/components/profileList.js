// profileList.js
import { getAllProfiles, deleteProfiles } from "./storage.js";

let selectedIds = new Set();
let currentKeyword = "";

export function initProfileList({ onEdit }) {
  document.getElementById("searchInput").addEventListener("input", (e) => {
    currentKeyword = e.target.value.trim().toLowerCase();
    renderProfileList({ onEdit });
  });

  document.getElementById("selectAllBtn").addEventListener("click", () => {
    const list = getFilteredList();

    const allSelected =
      list.length > 0 && list.every((p) => selectedIds.has(String(p.id)));

    if (allSelected) {
      list.forEach((p) => selectedIds.delete(String(p.id)));
    } else {
      list.forEach((p) => selectedIds.add(String(p.id)));
    }

    renderProfileList({ onEdit });
  });

  document.getElementById("deleteSelectedBtn").addEventListener("click", () => {
    if (selectedIds.size === 0) return;

    if (!confirm(`Xóa ${selectedIds.size} hồ sơ đã chọn?`)) {
      return;
    }

    deleteProfiles(Array.from(selectedIds));
    selectedIds.clear();

    renderProfileList({ onEdit });
  });

  document
    .getElementById("exportExcelBtn")
    .addEventListener("click", exportToExcel);
}

function getFilteredList() {
  const list = getAllProfiles();

  if (!currentKeyword) {
    return list;
  }

  return list.filter((p) => {
    const hoTen = (p.hoTen || "").toLowerCase();
    const soGiayTo = (p.soGiayTo || "").toLowerCase();

    return hoTen.includes(currentKeyword) || soGiayTo.includes(currentKeyword);
  });
}

export function renderProfileList({ onEdit }) {
  const list = getFilteredList();

  const table = document.getElementById("profileTable");
  const tbody = document.getElementById("profileTableBody");
  const emptyState = document.getElementById("emptyState");

  document.getElementById("profileCount").textContent =
    `${getAllProfiles().length} hồ sơ đã lưu`;

  if (list.length === 0) {
    table.classList.add("hidden");
    emptyState.classList.remove("hidden");

    updateSelectedCount();

    return;
  }

  table.classList.remove("hidden");
  emptyState.classList.add("hidden");

  tbody.innerHTML = list
    .map((p) => {
      const id = String(p.id);

      const checked = selectedIds.has(id) ? "checked" : "";

      /*
       * QUAN TRỌNG:
       * Dùng portraitDataUrl thay vì frontDataUrl.
       *
       * portraitDataUrl chính là ảnh chân dung
       * đã được Backend crop và hiển thị
       * trong khung tròn.
       */

      const avatar = p.portraitDataUrl
        ? `
          <img
            class="profile-thumb"
            src="${p.portraitDataUrl}"
            alt="Ảnh chân dung"
          />
        `
        : `
          <div class="profile-thumb profile-thumb-empty">
            👤
          </div>
        `;

      return `
        <tr data-id="${id}">

          <td>
            <input
              type="checkbox"
              class="row-check"
              ${checked}
            />
          </td>

          <td>
            ${avatar}
          </td>

          <td>
            ${escapeHtml(p.hoTen || "")}
          </td>

          <td>
            ${escapeHtml(p.soGiayTo || "")}
          </td>

          <td>
            ${escapeHtml(p.ngaySinh || "")}
          </td>

          <td>
            ${escapeHtml(p.gioiTinh || "")}
          </td>

          <td>
            ${escapeHtml(p.dienThoai || "")}
          </td>

          <td>
            <button class="row-edit-btn">
              Sửa
            </button>

            <button class="row-del-btn">
              Xóa
            </button>
          </td>

        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr").forEach((row) => {
    const id = row.dataset.id;

    row.querySelector(".row-check").addEventListener("change", (e) => {
      if (e.target.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }

      updateSelectedCount();
    });

    row.querySelector(".row-edit-btn").addEventListener("click", () => {
      if (typeof onEdit === "function") {
        onEdit(id);
      }
    });

    row.querySelector(".row-del-btn").addEventListener("click", () => {
      if (!confirm("Xóa hồ sơ này?")) {
        return;
      }

      deleteProfiles([id]);
      selectedIds.delete(id);

      renderProfileList({ onEdit });
    });
  });

  updateSelectedCount();
}

function updateSelectedCount() {
  document.getElementById("selectedCountWrap").textContent =
    `${selectedIds.size} hồ sơ được chọn`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function exportToExcel() {
  const list = getAllProfiles();

  if (list.length === 0) {
    alert("Chưa có hồ sơ nào để xuất.");
    return;
  }

  const rows = list.map((p) => ({
    "Họ và đệm": p.hoDem || "",
    Tên: p.ten || "",
    "Họ và tên": p.hoTen || "",
    "Ngày sinh": p.ngaySinh || "",
    "Giới tính": p.gioiTinh || "",
    "Nơi sinh": p.noiSinh || "",
    "Nguyên quán": p.nguyenQuan || "",
    "Dân tộc": p.danToc || "",
    "Quốc tịch": p.quocTich || "",
    "Loại giấy tờ": p.loaiGiayTo || "",
    "Số giấy tờ": p.soGiayTo || "",
    "Ngày cấp giấy tờ": p.ngayCap || "",
    "Ngày hết hạn giấy tờ": p.ngayHetHan || "",
    "Nơi cấp giấy tờ": p.noiCapGiayTo || "",
    "ĐT di động": p.dienThoai || "",
    "Email cá nhân": p.email || "",
    Skype: p.skype || "",
    Facebook: p.facebook || "",
    "Địa chỉ HKTT": p.diaChiHKTT || "",
    "Địa chỉ hiện nay": p.diaChiHienNay || "",
  }));

  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.json_to_sheet(rows);

  XLSX.utils.book_append_sheet(wb, ws, "Danh sách hồ sơ");

  XLSX.writeFile(wb, `danh_sach_ho_so_${Date.now()}.xlsx`);
}
