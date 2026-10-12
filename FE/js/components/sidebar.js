// sidebar.js
// Xử lý chuyển tab danh mục giấy tờ (CMND/CCCD, Hộ chiếu, Bằng cấp, Chứng chỉ, CV)

export function initSidebar(onChange) {
  const items = document.querySelectorAll("#docSidebar .doc-sidebar-item");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      items.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      const type = item.dataset.type;
      if (typeof onChange === "function") onChange(type);
    });
  });
}
