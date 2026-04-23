// ================================================
//  AgriScan TN — Main Application
// ================================================

(function () {
  "use strict";

  // ---- Instances ----
  const api = new AgriScanAPI();
  const ui  = new AgriScanUI();

  // ---- State ----
  let pendingImages = []; // [{ base64, mediaType, name, dataUrl, metrics }]  max 3
  let isProcessing  = false;

  // ---- DOM references ----
  const $input        = document.getElementById("msgInput");
  const $sendBtn      = document.getElementById("sendBtn");
  const $upload       = document.getElementById("imageUpload");
  const $cameraUpload = document.getElementById("cameraUpload");
  const $photoBtn     = document.getElementById("photoBtn");
  const $photoPopup   = document.getElementById("photoPopup");
  const $previewBar   = document.getElementById("imgPreviewBar");
  const $procBar      = document.getElementById("processingBar");
  const $menuBtn      = document.getElementById("menuBtn");
  const $sidebar      = document.getElementById("sidebar");
  const $overlay      = document.getElementById("sidebarOverlay");

  // ---- Bootstrap ----
  function init() {
    ui.showWelcome();
    bindEvents();
  }

  // ---- Event wiring ----
  function bindEvents() {
    $sendBtn.addEventListener("click", handleSend);

    $input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-resize textarea
    $input.addEventListener("input", () => {
      $input.style.height = "auto";
      $input.style.height = Math.min($input.scrollHeight, 120) + "px";
    });

    // Photo popup toggle
    $photoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePhotoPopup();
    });

    // Close popup when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#photoPopupWrap")) closePhotoPopup();
    });

    // File inputs (gallery + camera)
    $upload.addEventListener("change", handleUpload);
    $cameraUpload.addEventListener("change", handleUpload);

    // Clipboard paste
    document.addEventListener("paste", handlePaste);

    // Mobile sidebar
    $menuBtn.addEventListener("click", toggleSidebar);
    $overlay.addEventListener("click", closeSidebar);

    // Quick question buttons
    document.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const q = btn.dataset.question;
        if (q) { setInputValue(q); handleSend(); closeSidebar(); }
      });
    });

    // Terrain card clicks
    document.getElementById("cardBeja").addEventListener("click", () => {
      setInputValue(
        "Analyse la terre malade de Béja. Donne-moi un diagnostic complet, les maladies détectées, et des recommandations concrètes de traitement."
      );
      handleSend();
      closeSidebar();
    });

    document.getElementById("cardNabeul").addEventListener("click", () => {
      setInputValue(
        "Analyse la terre saine de Nabeul. Explique ses qualités, son potentiel agricole et les meilleures cultures à y développer."
      );
      handleSend();
      closeSidebar();
    });

    // Keyboard support for cards
    ["cardBeja", "cardNabeul"].forEach((id) => {
      document.getElementById(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
      });
    });

    // Tunisia SVG map region clicks → delegate to matching card
    const mapBeja   = document.getElementById("mapBeja");
    const mapNabeul = document.getElementById("mapNabeul");
    if (mapBeja) {
      mapBeja.addEventListener("click", () => document.getElementById("cardBeja").click());
      mapBeja.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") document.getElementById("cardBeja").click();
      });
    }
    if (mapNabeul) {
      mapNabeul.addEventListener("click", () => document.getElementById("cardNabeul").click());
      mapNabeul.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") document.getElementById("cardNabeul").click();
      });
    }
  }

  // ---- Photo popup ----
  function togglePhotoPopup() {
    const open = $photoPopup.classList.toggle("open");
    $photoBtn.setAttribute("aria-expanded", String(open));
  }

  function closePhotoPopup() {
    $photoPopup.classList.remove("open");
    $photoBtn.setAttribute("aria-expanded", "false");
  }

  // ---- Image handling ----
  function handleUpload(e) {
    const files = Array.from(e.target.files).slice(0, 3 - pendingImages.length);
    files.forEach(loadImageFile);
    e.target.value = "";
    closePhotoPopup();
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        e.preventDefault();
        loadImageFile(item.getAsFile());
        return;
      }
    }
  }

  function loadImageFile(file) {
    if (pendingImages.length >= 3) return;
    if (file.size > 50 * 1024 * 1024) {
      alert("Image trop volumineuse (max 50 Mo avant compression).");
      return;
    }
    compressImage(file).then(async (img) => {
      img.metrics = await computeMetrics(img.dataUrl);
      pendingImages.push(img);
      renderPreviews();
      $input.focus();
    });
  }

  function compressImage(file) {
    // Target: decoded binary ≤ 4 MB  →  base64 length ≤ 4MB × 4/3 ≈ 5 592 405 chars
    const MAX_B64 = Math.ceil(4 * 1024 * 1024 * 4 / 3);

    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);

        // Step 1 — cap dimensions at 1920 px on the longest side
        const MAX_PX = 1920;
        let { width, height } = image;
        if (width > MAX_PX || height > MAX_PX) {
          if (width >= height) { height = Math.round(height * MAX_PX / width); width = MAX_PX; }
          else { width = Math.round(width * MAX_PX / height); height = MAX_PX; }
        }

        function drawCanvas(w, h) {
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(image, 0, 0, w, h);
          return c;
        }

        // Step 2 — encode JPEG at decreasing quality until ≤ 4 MB
        let canvas  = drawCanvas(width, height);
        let quality = 0.80;
        let dataUrl, base64;

        do {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
          base64  = dataUrl.split(",")[1];
          if (base64.length <= MAX_B64) break;
          quality -= 0.10;
        } while (quality >= 0.20);

        // Step 3 — if still too large, halve dimensions and retry
        if (base64.length > MAX_B64) {
          canvas  = drawCanvas(Math.round(width / 2), Math.round(height / 2));
          dataUrl = canvas.toDataURL("image/jpeg", 0.80);
          base64  = dataUrl.split(",")[1];
        }

        const name = (file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
        resolve({ base64, mediaType: "image/jpeg", name, dataUrl });
      };
      image.src = url;
    });
  }

  // ---- Client-side HSV analysis (mirrors Python PIL/OpenCV logic) ----
  function computeMetrics(dataUrl) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        // Downsample to 320 px max for speed
        const MAX = 320;
        let w = image.width, h = image.height;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }

        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, w, h);

        const data  = ctx.getImageData(0, 0, w, h).data;
        const total = w * h;
        let greenCount = 0, brownCount = 0, brightnessSum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const [hcv, scv, vcv] = rgbToOcvHsv(data[i], data[i + 1], data[i + 2]);

          brightnessSum += vcv;

          // Green: H[35-85] S[40-255] V[40-255]
          if (hcv >= 35 && hcv <= 85 && scv >= 40 && vcv >= 40) greenCount++;

          // Brown: H[8-25] S[30-200] V[50-210]
          if (hcv >= 8 && hcv <= 25 && scv >= 30 && scv <= 200 && vcv >= 50 && vcv <= 210) brownCount++;
        }

        const greenPct    = parseFloat((greenCount / total * 100).toFixed(1));
        const brownPct    = parseFloat((brownCount / total * 100).toFixed(1));
        const brightness  = parseFloat((brightnessSum / total / 255 * 100).toFixed(1));
        const vegTotal    = greenPct + brownPct;
        const colorRatio  = vegTotal > 0 ? brownPct / vegTotal : 0.5;
        const brightStress = 1.0 - brightness / 100.0;
        const stress      = parseFloat(Math.min(10, colorRatio * 7.0 + brightStress * 3.0).toFixed(1));

        resolve({ greenPct, brownPct, brightness, stress });
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  function rgbToOcvHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max;
    const s = max === 0 ? 0 : (max - min) / max;
    let h = 0;
    if (max !== min) {
      const d = max - min;
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    // Return in OpenCV convention: H[0-180], S[0-255], V[0-255]
    return [h * 180, s * 255, v * 255];
  }

  // ---- Preview bar ----
  function renderPreviews() {
    if (!pendingImages.length) {
      $previewBar.style.display = "none";
      $previewBar.innerHTML = "";
      return;
    }
    const label = pendingImages.length === 1
      ? "📸 Image prête pour analyse"
      : `📸 ${pendingImages.length} images prêtes pour analyse`;

    $previewBar.innerHTML =
      pendingImages.map((img, i) => `
        <div class="img-preview-wrap">
          <img class="preview-thumb" src="${img.dataUrl}" alt="${img.name}">
          <button class="img-remove-btn" data-idx="${i}" aria-label="Retirer l'image">✕</button>
        </div>
      `).join("") +
      `<div class="img-preview-info">
        <span class="img-preview-label">${label}</span>
        ${pendingImages.length < 3 ? `<span class="img-preview-name">Collez ou uploadez jusqu'à ${3 - pendingImages.length} de plus</span>` : ""}
      </div>`;

    $previewBar.querySelectorAll(".img-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingImages.splice(Number(btn.dataset.idx), 1);
        renderPreviews();
      });
    });
    $previewBar.style.display = "flex";
  }

  // ---- Send logic ----
  async function handleSend() {
    if (isProcessing) return;

    const text = $input.value.trim();
    if (!text && !pendingImages.length) return;

    const userText     = text || "Analyse ces images de sol ou de plante.";
    const imagesToSend = pendingImages.slice();

    $input.value = "";
    $input.style.height = "auto";
    pendingImages = [];
    renderPreviews();

    ui.addMessage("user", userText, imagesToSend);

    setProcessing(true);

    try {
      ui.showTyping();
      const reply = await api.send(userText, imagesToSend);
      ui.hideTyping();
      ui.addMessage("bot", reply);
      if (imagesToSend.length) ui.addMetricsWidget(imagesToSend);
      ui.setStatus(true);
    } catch (err) {
      ui.hideTyping();
      const code = err.message.startsWith("API_ERROR") ? err.message : "NETWORK_ERROR";
      ui.showError(code);
    } finally {
      setProcessing(false);
    }
  }

  // ---- UI state helpers ----
  function setProcessing(on) {
    isProcessing           = on;
    $sendBtn.disabled      = on;
    $input.disabled        = on;
    $procBar.style.display = on ? "flex" : "none";
  }

  function setInputValue(val) {
    $input.value = val;
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 120) + "px";
    $input.focus();
  }

  // ---- Sidebar ----
  function toggleSidebar() {
    const isOpen = $sidebar.classList.toggle("open");
    $overlay.classList.toggle("active", isOpen);
    document.body.style.overflow = isOpen ? "hidden" : "";
  }

  function closeSidebar() {
    $sidebar.classList.remove("open");
    $overlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  // ---- Start ----
  init();
})();
