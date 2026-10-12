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

const API_BASE = "http://localhost:8000";

// ============================================================
// REQUEST VERSION
// ============================================================

let portraitRequestId = 0;

// ============================================================
// OCR REQUEST VERSION
// ============================================================

let ocrRequestId = 0;

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

    const formData = new FormData();

    formData.append("front", file);

    const response = await fetch(`${API_BASE}/api/portrait`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    console.log("Kết quả API chân dung:", result);

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Không crop được ảnh chân dung");
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

    alert("Không thể lấy ảnh chân dung.\n\n" + error.message);
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

    console.log("Kết quả OCR CCCD:", result);

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
      throw new Error(result.message || "Không thể đọc thông tin CCCD.");
    }

    // ========================================================
    // LƯU KẾT QUẢ
    // ========================================================

    state.ocrData = result.data;

    console.log("========================================");

    console.log("OCR CCCD THÀNH CÔNG");

    console.log(state.ocrData);

    console.log("========================================");

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
        },
      }),
    );
  } catch (error) {
    if (requestId !== ocrRequestId) {
      return;
    }

    console.error("Lỗi OCR CCCD:", error);

    alert("Không thể đọc thông tin CCCD.\n\n" + error.message);
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

    // --------------------------------------------------------
    // CROP PORTRAIT
    // --------------------------------------------------------

    await uploadPortraitTest(file, currentRequestId);

    // --------------------------------------------------------
    // SAU KHI CÓ FRONT,
    // NẾU BACK ĐÃ CÓ THÌ OCR
    // --------------------------------------------------------

    if (state.backFile) {
      ocrRequestId++;

      const currentOCRRequest = ocrRequestId;

      await scanCCCD(currentOCRRequest);
    }

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

  // ----------------------------------------------------------
  // NẾU ĐÃ CÓ MẶT TRƯỚC
  // → TỰ ĐỘNG OCR
  // ----------------------------------------------------------

  if (state.frontFile) {
    const currentOCRRequest = ocrRequestId;

    await scanCCCD(currentOCRRequest);
  }
}

// ============================================================
// INIT UPLOAD FORM
// ============================================================

export function initUploadForm() {
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
