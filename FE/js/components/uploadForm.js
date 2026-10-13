// uploadForm.js
//
// Luồng:
//
// 1. Chọn CCCD mặt trước
// 2. Hiển thị preview CCCD mặt trước
// 3. Xóa avatar cũ
// 4. Gửi mặt trước lên Backend để crop chân dung
// 5. Backend trả ảnh chân dung Base64
// 6. FE hiển thị ảnh chân dung
//
// 7. Chọn CCCD mặt sau
// 8. Hiển thị preview mặt sau
//
// 9. Khi đã có CẢ 2 MẶT:
//    → Gọi /api/ocr-cccd
//    → Groq đọc thông tin
//    → Lưu kết quả OCR vào state
//    → Phát sự kiện "cccdOCRCompleted"
//    → app.js nhận dữ liệu và điền vào form
//
// KHÔNG lưu ảnh CCCD xuống máy.
// KHÔNG tạo portrait_xxx.jpg.
//
// Có chống race-condition cho crop chân dung.
// Có chống gọi OCR trùng nhiều lần.
// Crop chân dung và OCR chạy song song, có hiển thị trạng thái.
// Có thể chụp ảnh trực tiếp bằng camera (getUserMedia).

import { clearOCRReview } from "./ocrReview.js";

// ============================================================
// STATE
// ============================================================

let state = {
  frontFile: null,
  backFile: null,

  frontDataUrl: null,
  backDataUrl: null,

  portraitDataUrl: null,

  // Kết quả OCR từ Groq
  ocrData: null,
};

// ============================================================
// BACKEND
// ============================================================

// Lấy từ config.js (window.APP_CONFIG.apiBase). Mở ở localhost thì mặc định BE local.
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(location.hostname);

const API_BASE = (
  window.APP_CONFIG?.apiBase || (IS_LOCALHOST ? "http://localhost:8000" : "")
).replace(/\/$/, "");

function requireApiBase() {
  if (!API_BASE) {
    throw new Error(
      "Chưa cấu hình địa chỉ BE (biến API_BASE trên Vercel hoặc FE/config.js). Bạn vẫn có thể điền tay.",
    );
  }
}

// ============================================================
// REQUEST VERSION
// ============================================================

let portraitRequestId = 0;

// ============================================================
// OCR REQUEST VERSION
// ============================================================

let ocrRequestId = 0;

// ============================================================
// TRẠNG THÁI XỬ LÝ
// ============================================================

let pendingTasks = 0;

function setScanStatus(message, kind = "busy") {
  const el = document.getElementById("scanStatus");

  if (!el) {
    return;
  }

  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }

  el.textContent = message;
  el.classList.remove("hidden", "is-busy", "is-error", "is-done");
  el.classList.add(`is-${kind}`);
}

async function runTask(message, task) {
  pendingTasks++;

  setScanStatus(message, "busy");

  document
    .querySelectorAll(".upload-box")
    .forEach((box) => box.classList.add("is-busy"));

  try {
    return await task();
  } finally {
    pendingTasks--;

    if (pendingTasks === 0) {
      document
        .querySelectorAll(".upload-box")
        .forEach((box) => box.classList.remove("is-busy"));
    }
  }
}

function friendlyError(result, fallback) {
  if (result?.code === "OCR_NOT_CONFIGURED") {
    return "BE chưa cấu hình GROQ_API_KEY (file BE/.env). Bạn vẫn có thể điền tay.";
  }

  return result?.message || fallback;
}

// ============================================================
// GET STATE
// ============================================================

export function getUploadState() {
  return state;
}

// ============================================================
// RESET
// ============================================================

export function resetUploadState() {
  state = {
    frontFile: null,
    backFile: null,

    frontDataUrl: null,
    backDataUrl: null,

    portraitDataUrl: null,

    ocrData: null,
  };

  portraitRequestId++;

  ocrRequestId++;

  setScanStatus(null);

  clearOCRReview();

  renderPreview("front", null);

  renderPreview("back", null);

  setAvatarImage(null);
}

// ============================================================
// RENDER PREVIEW
// ============================================================

function renderPreview(side, dataUrl) {
  const wrap = document.getElementById(
    side === "front" ? "frontPreviewWrap" : "backPreviewWrap",
  );

  if (!wrap) {
    return;
  }

  const placeholderText =
    side === "front"
      ? `
        <div class="upload-circle">
          ⬆
        </div>

        <div>
          <span class="link-text">
            Chọn ảnh
          </span>

          hoặc kéo ảnh
          <b>mặt trước</b>
          vào đây
        </div>

        <div class="upload-hint">
          Lưu ý: Kích thước ảnh lớn hơn 640 x 480
          <br/>
          định dạng .PNG, .JPG, .JPEG
        </div>
      `
      : `
        <div class="upload-circle">
          ⬆
        </div>

        <div>
          <span class="link-text">
            Chọn ảnh
          </span>

          hoặc kéo ảnh
          <b>mặt sau</b>
          vào đây
        </div>

        <div class="upload-hint">
          Lưu ý: Kích thước ảnh lớn hơn 640 x 480
          <br/>
          định dạng .PNG, .JPG, .JPEG
        </div>
      `;

  if (dataUrl) {
    wrap.innerHTML = `
      <img
        src="${dataUrl}"
        alt="preview"
      />
    `;
  } else {
    wrap.innerHTML = `
      <div class="upload-placeholder">
        ${placeholderText}
      </div>
    `;
  }
}

// ============================================================
// AVATAR
// ============================================================

export function setAvatarImage(dataUrl) {
  const img = document.getElementById("avatarImg");

  const icon = document.getElementById("avatarPlaceholderIcon");

  if (!img || !icon) {
    console.warn("Không tìm thấy avatarImg hoặc avatarPlaceholderIcon");

    return;
  }

  if (dataUrl) {
    img.src = dataUrl;

    img.classList.remove("hidden");

    icon.classList.add("hidden");
  } else {
    img.classList.add("hidden");

    img.removeAttribute("src");

    icon.classList.remove("hidden");
  }
}

// ============================================================
// FILE → DATA URL
// ============================================================

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);

    reader.onerror = reject;

    reader.readAsDataURL(file);
  });
}

// ============================================================
// UPLOAD PORTRAIT
// ============================================================

async function uploadPortraitTest(file, requestId) {
  try {
    if (!file) {
      return;
    }

    console.log("Đang gửi ảnh CCCD để crop chân dung...");

    requireApiBase();

    const formData = new FormData();

    formData.append("front", file);

    const response = await fetch(`${API_BASE}/api/portrait`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    console.log("Kết quả API chân dung:", {
      success: result.success,
      detector: result.detector,
      code: result.code,
    });

    if (!response.ok || !result.success) {
      throw new Error(friendlyError(result, "Không crop được ảnh chân dung"));
    }

    // ========================================================
    // KIỂM TRA REQUEST
    // ========================================================

    if (requestId !== portraitRequestId) {
      console.log("Bỏ qua kết quả ảnh cũ.");

      return;
    }

    // ========================================================
    // BACKEND TRẢ IMAGE BASE64
    // ========================================================

    const portraitDataUrl = result.image_base64;

    if (!portraitDataUrl) {
      throw new Error("Backend không trả ảnh chân dung");
    }

    console.log("Đã nhận ảnh chân dung từ Backend.");

    // ========================================================
    // LƯU STATE
    // ========================================================

    state.portraitDataUrl = portraitDataUrl;

    // ========================================================
    // HIỂN THỊ AVATAR
    // ========================================================

    setAvatarImage(portraitDataUrl);

    console.log("Đã lưu ảnh chân dung vào state.");

    console.log("Đã đưa ảnh chân dung vào khung avatar.");
  } catch (error) {
    // Request cũ thì bỏ qua lỗi
    if (requestId !== portraitRequestId) {
      return;
    }

    console.error("Lỗi crop chân dung:", error);

    setScanStatus("Không lấy được ảnh chân dung: " + error.message, "error");

    // Báo lại cho nơi gọi biết là lỗi, để không ghi đè trạng thái lỗi.
    throw error;
  }
}

// ============================================================
// OCR CCCD
// ============================================================
//
// Gửi cả mặt trước + mặt sau lên Backend.
// Backend gọi Groq Vision.
// ============================================================

async function scanCCCD(requestId) {
  try {
    // ========================================================
    // KIỂM TRA
    // ========================================================

    if (!state.frontFile) {
      return;
    }

    if (!state.backFile) {
      return;
    }

    console.log("========================================");

    console.log("ĐÃ CÓ ĐỦ 2 MẶT CCCD");

    console.log("Bắt đầu OCR bằng Groq...");

    console.log("========================================");

    // ========================================================
    // FORM DATA
    // ========================================================

    requireApiBase();

    const formData = new FormData();

    formData.append("front", state.frontFile);

    formData.append("back", state.backFile);

    // ========================================================
    // GỌI API
    // ========================================================

    const response = await fetch(`${API_BASE}/api/ocr-cccd`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    // Không log toàn bộ dữ liệu cá nhân ra console.
    console.log("Kết quả OCR CCCD:", {
      success: result.success,
      code: result.code,
      needsReview: result.validation?.needsReview,
      sources: result.validation?.sources,
    });

    // ========================================================
    // KIỂM TRA REQUEST MỚI NHẤT
    // ========================================================

    if (requestId !== ocrRequestId) {
      console.log("Bỏ qua kết quả OCR cũ.");

      return;
    }

    // ========================================================
    // KIỂM TRA API
    // ========================================================

    if (!response.ok || !result.success) {
      throw new Error(friendlyError(result, "Không thể đọc thông tin CCCD."));
    }

    // ========================================================
    // LƯU KẾT QUẢ
    // ========================================================

    state.ocrData = result.data;

    console.log("OCR CCCD THÀNH CÔNG");

    // ========================================================
    // PHÁT EVENT CHO APP.JS
    // ========================================================
    //
    // app.js sẽ nhận:
    //
    // event.detail = {
    //   ...OCR data...
    // }
    //
    // ========================================================

    window.dispatchEvent(
      new CustomEvent("cccdOCRCompleted", {
        detail: {
          ...state.ocrData,

          // Gửi kèm thông tin đã upload đủ hai mặt.
          // app.js sẽ dùng thông tin OCR để phân loại,
          // không tự khẳng định loại CCCD chỉ từ tên file.
          _cccdUpload: {
            hasFront: Boolean(state.frontFile),
            hasBack: Boolean(state.backFile),
          },

          // Kết quả kiểm chứng QR / MRZ / logic từ BE.
          _validation: result.validation || null,
        },
      }),
    );
  } catch (error) {
    if (requestId !== ocrRequestId) {
      return;
    }

    console.error("Lỗi OCR CCCD:", error);

    setScanStatus("Không đọc được thông tin CCCD: " + error.message, "error");

    throw error;
  }
}

// ============================================================
// IMAGE SELECTED
// ============================================================

async function handleImageSelected(side, file) {
  if (!file) {
    return;
  }

  console.log(`Đã chọn ảnh ${side}:`, file.name);

  // ==========================================================
  // MẶT TRƯỚC
  // ==========================================================

  if (side === "front") {
    // --------------------------------------------------------
    // REQUEST MỚI
    // --------------------------------------------------------

    portraitRequestId++;

    const currentRequestId = portraitRequestId;

    // --------------------------------------------------------
    // OCR REQUEST CŨ KHÔNG CÒN HỢP LỆ
    // --------------------------------------------------------

    ocrRequestId++;

    // --------------------------------------------------------
    // XÓA AVATAR
    // --------------------------------------------------------

    setAvatarImage(null);

    // --------------------------------------------------------
    // XÓA OCR CŨ
    // --------------------------------------------------------

    state.ocrData = null;

    // --------------------------------------------------------
    // ĐỌC ẢNH
    // --------------------------------------------------------

    const dataUrl = await readFileAsDataUrl(file);

    // --------------------------------------------------------
    // KIỂM TRA REQUEST
    // --------------------------------------------------------

    if (currentRequestId !== portraitRequestId) {
      return;
    }

    // --------------------------------------------------------
    // LƯU STATE
    // --------------------------------------------------------

    state.frontFile = file;

    state.frontDataUrl = dataUrl;

    // --------------------------------------------------------
    // PREVIEW
    // --------------------------------------------------------

    renderPreview("front", dataUrl);

    clearOCRReview();

    // --------------------------------------------------------
    // CROP PORTRAIT + (NẾU ĐÃ CÓ MẶT SAU) OCR: CHẠY SONG SONG
    // --------------------------------------------------------

    const tasks = [uploadPortraitTest(file, currentRequestId)];

    if (state.backFile) {
      ocrRequestId++;

      tasks.push(scanCCCD(ocrRequestId));
    }

    await runScanTasks(
      tasks,
      state.backFile
        ? "Đang cắt ảnh chân dung và đọc thông tin CCCD..."
        : "Đang cắt ảnh chân dung...",
      state.backFile
        ? "Đã đọc xong. Hãy kiểm tra lại thông tin trước khi lưu."
        : "Đã lấy ảnh chân dung. Tải thêm ảnh mặt sau để tự điền thông tin.",
    );

    return;
  }

  // ==========================================================
  // MẶT SAU
  // ==========================================================

  // OCR request cũ không còn hợp lệ
  ocrRequestId++;

  const dataUrl = await readFileAsDataUrl(file);

  state.backFile = file;

  state.backDataUrl = dataUrl;

  // Preview
  renderPreview("back", dataUrl);

  clearOCRReview();

  // ----------------------------------------------------------
  // NẾU ĐÃ CÓ MẶT TRƯỚC
  // → TỰ ĐỘNG OCR
  // ----------------------------------------------------------

  if (state.frontFile) {
    const currentOCRRequest = ocrRequestId;

    await runScanTasks(
      [scanCCCD(currentOCRRequest)],
      "Đang đọc thông tin CCCD...",
      "Đã đọc xong. Hãy kiểm tra lại thông tin trước khi lưu.",
    );
  } else {
    setScanStatus("Tải thêm ảnh mặt trước để tự điền thông tin.", "done");
  }
}

// ============================================================
// CHẠY TÁC VỤ + CẬP NHẬT TRẠNG THÁI
// ============================================================

async function runScanTasks(tasks, busyMessage, doneMessage) {
  const results = await runTask(busyMessage, () =>
    Promise.allSettled(tasks),
  );

  // Có tác vụ lỗi thì giữ nguyên thông báo lỗi đã hiển thị.
  if (pendingTasks === 0 && results.every((r) => r.status === "fulfilled")) {
    setScanStatus(doneMessage, "done");
  }
}

// ============================================================
// CHỤP ẢNH BẰNG CAMERA
// ============================================================

let cameraStream = null;
let cameraSide = "front";

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());

  cameraStream = null;

  document.getElementById("cameraModal")?.classList.add("hidden");
}

async function openCamera(side) {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("cameraVideo");
  const title = document.getElementById("cameraTitle");

  if (!modal || !video) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setScanStatus(
      "Trình duyệt không hỗ trợ camera (cần mở qua http://localhost hoặc https).",
      "error",
    );
    return;
  }

  cameraSide = side;

  if (title) {
    title.textContent =
      side === "front" ? "Chụp ảnh CCCD mặt trước" : "Chụp ảnh CCCD mặt sau";
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (error) {
    console.error("Không mở được camera:", error);

    setScanStatus(
      "Không mở được camera: " +
        (error.name === "NotAllowedError"
          ? "bạn chưa cho phép truy cập camera."
          : error.message),
      "error",
    );
    return;
  }

  video.srcObject = cameraStream;

  modal.classList.remove("hidden");
}

function captureFrame() {
  const video = document.getElementById("cameraVideo");

  if (!video || !video.videoWidth) {
    return;
  }

  const canvas = document.createElement("canvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  canvas.getContext("2d").drawImage(video, 0, 0);

  const side = cameraSide;

  canvas.toBlob(
    (blob) => {
      stopCamera();

      if (!blob) {
        setScanStatus("Không chụp được ảnh, hãy thử lại.", "error");
        return;
      }

      const file = new File([blob], `camera_${side}.jpg`, {
        type: "image/jpeg",
      });

      handleImageSelected(side, file);
    },
    "image/jpeg",
    0.92,
  );
}

function initCamera() {
  document.querySelectorAll("[data-camera-side]").forEach((button) => {
    button.addEventListener("click", () =>
      openCamera(button.dataset.cameraSide),
    );
  });

  document
    .getElementById("cameraShotBtn")
    ?.addEventListener("click", captureFrame);

  document
    .getElementById("cameraCancelBtn")
    ?.addEventListener("click", stopCamera);
}

// ============================================================
// INIT UPLOAD FORM
// ============================================================

export function initUploadForm() {
  initCamera();

  const frontInput = document.getElementById("frontImageInput");

  const backInput = document.getElementById("backImageInput");

  // ==========================================================
  // FRONT
  // ==========================================================

  if (frontInput) {
    frontInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];

      if (!file) {
        return;
      }

      // Cho phép chọn lại đúng file cũ (sự kiện change mới bắn lại).
      e.target.value = "";

      await handleImageSelected("front", file);
    });
  }

  // ==========================================================
  // BACK
  // ==========================================================

  if (backInput) {
    backInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];

      if (!file) {
        return;
      }

      e.target.value = "";

      await handleImageSelected("back", file);
    });
  }

  // ==========================================================
  // DRAG & DROP
  // ==========================================================

  ["frontPreviewWrap", "backPreviewWrap"].forEach((id) => {
    const el = document.getElementById(id);

    if (!el) {
      return;
    }

    const side = id === "frontPreviewWrap" ? "front" : "back";

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    el.addEventListener("drop", async (e) => {
      e.preventDefault();

      const file = e.dataTransfer.files?.[0];

      if (!file) {
        return;
      }

      await handleImageSelected(side, file);
    });
  });
}
