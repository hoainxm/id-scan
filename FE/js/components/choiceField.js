// choiceField.js
//
// Ô nhập có danh sách chọn (combobox) dùng chung cho mọi trường có nhiều giá trị cố định:
// - Bấm / focus là mở toàn bộ danh sách; gõ để lọc, KHÔNG phân biệt dấu ("viet nam" ra "Việt Nam").
// - Tìm cả theo tên gọi khác (aliases), VD "H'Mông" ra "Mông".
// - Bàn phím: ↑ ↓ chọn, Enter điền, Esc đóng.
// - Vẫn giữ được giá trị không có trong danh sách (giá trị OCR, cách ghi riêng).
// - segment: "last": chỉ lọc / thay phần sau dấu phẩy cuối (VD "Trực Ninh, Nam Đ" -> "Nam Định").
//
// Dùng markup .combobox có sẵn trong index.html (input + .combobox-arrow + .combobox-options).

import { normalizeAddressText } from "../addressMapping.js";

const fields = new Map();
let uid = 0;

// Đang điền giá trị do người dùng chọn: sự kiện input phát ra lúc đó không mở lại danh sách.
let choosing = false;

function norm(value) {
  return normalizeAddressText(value);
}

function toOption(item) {
  if (typeof item === "string") return { value: item, aliases: [], hint: "" };
  return { value: item.value, aliases: item.aliases || [], hint: item.hint || "" };
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

function splitSegment(text) {
  const index = text.lastIndexOf(",");
  if (index < 0) return { head: "", query: text };
  return { head: text.slice(0, index + 1) + " ", query: text.slice(index + 1).trim() };
}

/**
 * Gắn danh sách chọn vào một ô nhập.
 * @param {string} inputId
 * @param {{ options: Array|Function, segment?: "last", maxItems?: number }} config
 */
export function initChoiceField(inputId, { options, segment = "", maxItems = 300 }) {
  const input = document.getElementById(inputId);
  const wrapper = input?.closest(".combobox");
  const list = wrapper?.querySelector(".combobox-options");

  if (!input || !wrapper || !list || fields.has(inputId)) return;

  const listId = list.id || `choice-list-${++uid}`;
  list.id = listId;
  list.setAttribute("role", "listbox");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);

  const state = { open: false, active: -1, shown: [], filterOn: false };

  const allOptions = () =>
    (typeof options === "function" ? options() : options).map(toOption);

  const query = () =>
    segment === "last" ? splitSegment(input.value).query : input.value;

  function matches(option, keyword) {
    if (!keyword) return true;
    return [option.value, ...option.aliases].some((text) => norm(text).includes(keyword));
  }

  function render() {
    const keyword = state.filterOn ? norm(query()) : "";
    const all = allOptions();
    const filtered = all.filter((option) => matches(option, keyword));

    // Đưa mục bắt đầu bằng từ khoá lên trước.
    if (keyword) {
      filtered.sort(
        (a, b) =>
          Number(!norm(a.value).startsWith(keyword)) - Number(!norm(b.value).startsWith(keyword)),
      );
    }

    state.shown = filtered.slice(0, maxItems);

    const current = norm(query());
    state.active = state.shown.findIndex((option) => norm(option.value) === current);
    if (state.active < 0 && keyword && state.shown.length) state.active = 0;

    list.innerHTML = state.shown.length
      ? state.shown
          .map(
            (option, index) => `
          <div class="combobox-option${index === state.active ? " active" : ""}"
               role="option" id="${listId}-${index}" data-index="${index}"
               aria-selected="${index === state.active}">
            <span class="choice-value">${escapeHtml(option.value)}</span>
            ${option.hint ? `<span class="choice-hint">${escapeHtml(option.hint)}</span>` : ""}
          </div>`,
          )
          .join("")
      : `<div class="combobox-no-result">Không có trong danh sách. Giá trị đã nhập vẫn được giữ.</div>`;

    input.setAttribute(
      "aria-activedescendant",
      state.active >= 0 ? `${listId}-${state.active}` : "",
    );
    scrollActiveIntoView();
  }

  function scrollActiveIntoView() {
    const el = list.querySelector(`[data-index="${state.active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function open({ filter = false } = {}) {
    state.filterOn = filter;
    render();
    list.classList.add("show");
    wrapper.classList.add("active");
    input.setAttribute("aria-expanded", "true");
    state.open = true;
  }

  function close() {
    list.classList.remove("show");
    wrapper.classList.remove("active");
    input.setAttribute("aria-expanded", "false");
    state.open = false;
  }

  function choose(index) {
    const option = state.shown[index];
    if (!option) return;

    input.value =
      segment === "last" ? splitSegment(input.value).head + option.value : option.value;

    choosing = true;
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      choosing = false;
    }
    close();
  }

  function move(step) {
    if (!state.open) open();
    if (!state.shown.length) return;
    state.active = (state.active + step + state.shown.length) % state.shown.length;
    list.querySelectorAll(".combobox-option").forEach((el, index) => {
      el.classList.toggle("active", index === state.active);
      el.setAttribute("aria-selected", String(index === state.active));
    });
    input.setAttribute("aria-activedescendant", `${listId}-${state.active}`);
    scrollActiveIntoView();
  }

  input.addEventListener("focus", () => open());
  input.addEventListener("click", () => {
    if (!state.open) open();
  });
  input.addEventListener("input", () => {
    if (choosing) return;
    open({ filter: true });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      if (state.open && state.active >= 0) {
        event.preventDefault();
        choose(state.active);
      }
    } else if (event.key === "Escape") {
      close();
    } else if (event.key === "Tab") {
      close();
    }
  });

  input.addEventListener("blur", () => canonicalize(inputId));

  wrapper.querySelector(".combobox-arrow")?.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (state.open) {
      close();
    } else {
      input.focus();
      open();
    }
  });

  // mousedown để chọn trước khi ô nhập mất focus.
  list.addEventListener("mousedown", (event) => {
    const item = event.target.closest("[data-index]");
    if (!item) return;
    event.preventDefault();
    choose(Number(item.dataset.index));
  });

  document.addEventListener("mousedown", (event) => {
    if (state.open && !wrapper.contains(event.target)) close();
  });

  fields.set(inputId, { input, allOptions, segment, close });
}

/**
 * Đổi giá trị trùng một lựa chọn (không phân biệt hoa thường, dấu, tên gọi khác)
 * về đúng cách ghi chuẩn. VD OCR "KINH" -> "Kinh", "Viet Nam" -> "Việt Nam".
 * Giá trị không khớp hoàn toàn thì giữ nguyên.
 */
export function canonicalize(inputId) {
  const field = fields.get(inputId);
  if (!field) return;

  const { input, allOptions, segment } = field;
  const { head, query } =
    segment === "last" ? splitSegment(input.value) : { head: "", query: input.value };

  const key = norm(query);
  if (!key) return;

  const hits = allOptions().filter((option) =>
    [option.value, ...option.aliases].some((text) => norm(text) === key),
  );

  if (hits.length === 1 && hits[0].value !== query.trim()) {
    input.value = head + hits[0].value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function canonicalizeAll() {
  for (const inputId of fields.keys()) canonicalize(inputId);
}

export function closeAllChoiceFields() {
  for (const field of fields.values()) field.close();
}
