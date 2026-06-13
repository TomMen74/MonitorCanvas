const state = {
  monitors: [],
  images: [],
  activeImageId: null,
  fitMode: "cover",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  diagonal: 27,
  uniformFrames: true,
  gaps: {},
  verticalOffsets: {},
  view: "real"
};

const elements = {
  previewCanvas: document.querySelector("#previewCanvas"),
  previewStage: document.querySelector("#previewStage"),
  emptyPreview: document.querySelector("#emptyPreview"),
  imageInput: document.querySelector("#imageInput"),
  imageList: document.querySelector("#imageList"),
  imageCount: document.querySelector("#imageCount"),
  monitorList: document.querySelector("#monitorList"),
  monitorCount: document.querySelector("#monitorCount"),
  systemStatus: document.querySelector("#systemStatus"),
  gapControls: document.querySelector("#gapControls"),
  qualityNotice: document.querySelector("#qualityNotice"),
  exportSize: document.querySelector("#exportSize"),
  toast: document.querySelector("#toast"),
  dropZone: document.querySelector("#dropZone")
};

let renderQueued = false;
let toastTimer;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function monitorBounds() {
  if (!state.monitors.length) return { minX: 0, minY: 0, maxX: 1920, maxY: 1080, width: 1920, height: 1080 };
  const minX = Math.min(...state.monitors.map(m => m.x));
  const minY = Math.min(...state.monitors.map(m => m.y));
  const maxX = Math.max(...state.monitors.map(m => m.x + m.width));
  const maxY = Math.max(...state.monitors.map(m => m.y + m.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function sortedMonitors() {
  return [...state.monitors].sort((a, b) => a.x - b.x || a.y - b.y);
}

function transitionKey(left, right) {
  return `${left.id}::${right.id}`;
}

function getGapMillimeters(left, right) {
  const key = state.uniformFrames ? "uniform" : transitionKey(left, right);
  return Number(state.gaps[key] ?? 20);
}

function pixelsPerMillimeter(monitor) {
  const diagonalPx = Math.hypot(monitor.width, monitor.height);
  return diagonalPx / (state.diagonal * 25.4);
}

function physicalLayout() {
  const monitors = sortedMonitors();
  if (!monitors.length) return { monitors: [], width: 1, height: 1 };
  const bounds = monitorBounds();
  let addedX = 0;
  const rawLayouts = [];

  monitors.forEach((monitor, index) => {
    if (index > 0) {
      const previous = monitors[index - 1];
      const gapMm = getGapMillimeters(previous, monitor);
      const averageDensity = (pixelsPerMillimeter(previous) + pixelsPerMillimeter(monitor)) / 2;
      addedX += gapMm * averageDensity;
    }
    const verticalOffset = Number(state.verticalOffsets[monitor.id] ?? 0);
    rawLayouts.push({
      ...monitor,
      sourceX: monitor.x - bounds.minX + addedX,
      sourceY: monitor.y - bounds.minY + verticalOffset * pixelsPerMillimeter(monitor)
    });
  });

  const minSourceY = Math.min(...rawLayouts.map(monitor => monitor.sourceY));
  const layouts = rawLayouts.map(monitor => ({
    ...monitor,
    sourceY: monitor.sourceY - minSourceY
  }));
  const width = Math.max(...layouts.map(m => m.sourceX + m.width));
  const height = Math.max(...layouts.map(m => m.sourceY + m.height));
  return { monitors: layouts, width, height };
}

async function loadMonitors() {
  elements.systemStatus.textContent = "Monitore werden geprüft";
  elements.systemStatus.classList.remove("online");
  try {
    const response = await fetch("/api/monitors", { cache: "no-store" });
    if (!response.ok) throw new Error("Monitorerkennung nicht erreichbar");
    const payload = await response.json();
    state.monitors = payload.monitors.slice(0, 4);
    elements.systemStatus.textContent = "Lokaler Dienst verbunden";
    elements.systemStatus.classList.add("online");
  } catch (error) {
    state.monitors = [{
      id: "preview-1",
      name: "Vorschau-Monitor",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      primary: true,
      scale: 1
    }];
    elements.systemStatus.textContent = "Vorschaumodus";
    showToast("Der lokale Dienst ist nicht erreichbar. Die Vorschau nutzt einen Beispielmonitor.");
  }
  ensureGapDefaults();
  ensureVerticalOffsetDefaults();
  renderMonitorList();
  renderGapControls();
  updateSummary();
  queueRender();
}

function ensureGapDefaults() {
  if (state.gaps.uniform == null) state.gaps.uniform = 20;
  const monitors = sortedMonitors();
  for (let index = 1; index < monitors.length; index++) {
    const key = transitionKey(monitors[index - 1], monitors[index]);
    if (state.gaps[key] == null) state.gaps[key] = 20;
  }
}

function ensureVerticalOffsetDefaults() {
  if (!state.verticalOffsets || typeof state.verticalOffsets !== "object") {
    state.verticalOffsets = {};
  }
  state.monitors.forEach(monitor => {
    if (state.verticalOffsets[monitor.id] == null) {
      state.verticalOffsets[monitor.id] = 0;
    }
  });
}

function renderMonitorList() {
  elements.monitorCount.textContent = state.monitors.length;
  elements.monitorList.innerHTML = "";
  sortedMonitors().forEach((monitor, index) => {
    const offset = Number(state.verticalOffsets[monitor.id] ?? 0);
    const card = document.createElement("article");
    card.className = "monitor-card";
    card.innerHTML = `
      <header>
        <strong>Monitor ${index + 1} · ${escapeHtml(monitor.name)}</strong>
        ${monitor.primary ? "<small>Hauptmonitor</small>" : ""}
      </header>
      <p>${monitor.width} × ${monitor.height} px · ${monitor.width > monitor.height ? "Querformat" : "Hochformat"} · ${Math.round(monitor.scale * 100)} % Skalierung</p>
      <p>Systemposition: ${monitor.x}, ${monitor.y}</p>
      ${index === 0 ? `
        <div class="monitor-reference">Referenz für die physische Höhe</div>
      ` : `
        <div class="monitor-offset">
          <label for="vertical-${safeId(monitor.id)}">
            <span>Zusätzlicher Höhenversatz</span>
            <strong>${formatVerticalOffset(offset)}</strong>
          </label>
          <input id="vertical-${safeId(monitor.id)}" type="range" min="-500" max="500" step="1" value="${offset}">
          <div class="range-labels"><span>höher</span><span>tiefer</span></div>
        </div>
      `}
    `;
    const offsetInput = card.querySelector('input[type="range"]');
    if (offsetInput) {
      offsetInput.addEventListener("input", () => {
        state.verticalOffsets[monitor.id] = Number(offsetInput.value);
        card.querySelector(".monitor-offset strong").textContent = formatVerticalOffset(Number(offsetInput.value));
        queueRender();
      });
    }
    elements.monitorList.append(card);
  });
}

function formatVerticalOffset(value) {
  if (value === 0) return "0 mm";
  return `${Math.abs(value).toFixed(0)} mm ${value < 0 ? "höher" : "tiefer"}`;
}

function renderGapControls() {
  elements.gapControls.innerHTML = "";
  const monitors = sortedMonitors();
  if (monitors.length < 2) {
    elements.gapControls.innerHTML = '<p class="helper">Für einen einzelnen Monitor ist keine Rahmenkorrektur nötig.</p>';
    return;
  }

  const transitions = state.uniformFrames
    ? [{ key: "uniform", label: "Alle Übergänge" }]
    : monitors.slice(1).map((monitor, index) => ({
        key: transitionKey(monitors[index], monitor),
        label: `Monitor ${index + 1} → Monitor ${index + 2}`
      }));

  transitions.forEach(transition => {
    const wrapper = document.createElement("div");
    wrapper.className = "gap-control";
    wrapper.innerHTML = `
      <label for="gap-${safeId(transition.key)}">
        <span>${transition.label}</span>
        <strong>${Number(state.gaps[transition.key] ?? 20).toFixed(1)} mm</strong>
      </label>
      <input id="gap-${safeId(transition.key)}" type="range" min="0" max="100" step="0.5" value="${state.gaps[transition.key] ?? 20}">
    `;
    const input = wrapper.querySelector("input");
    input.addEventListener("input", () => {
      state.gaps[transition.key] = Number(input.value);
      wrapper.querySelector("strong").textContent = `${Number(input.value).toFixed(1)} mm`;
      queueRender();
    });
    elements.gapControls.append(wrapper);
  });
}

function safeId(value) {
  return value.replace(/[^a-z0-9_-]/gi, "-");
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

async function addImages(files) {
  const accepted = [...files].filter(file => /^image\/(png|jpeg|webp)$/.test(file.type));
  for (const file of accepted) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    await image.decode();
    const item = {
      id: crypto.randomUUID(),
      name: file.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
      url,
      image
    };
    state.images.push(item);
    state.activeImageId = item.id;
  }
  renderImageList();
  queueRender();
}

function activeImage() {
  return state.images.find(image => image.id === state.activeImageId) ?? null;
}

function renderImageList() {
  elements.imageCount.textContent = state.images.length;
  elements.imageList.innerHTML = "";
  state.images.forEach(image => {
    const item = document.createElement("div");
    item.className = `image-item${image.id === state.activeImageId ? " active" : ""}`;
    item.innerHTML = `
      <img src="${image.url}" alt="">
      <div>
        <strong>${escapeHtml(image.name)}</strong>
        <span>${image.width} × ${image.height} px</span>
      </div>
      <button class="icon-button" type="button" aria-label="Bild entfernen">×</button>
    `;
    item.addEventListener("click", () => {
      state.activeImageId = image.id;
      renderImageList();
      queueRender();
    });
    item.querySelector("button").addEventListener("click", event => {
      event.stopPropagation();
      URL.revokeObjectURL(image.url);
      state.images = state.images.filter(candidate => candidate.id !== image.id);
      if (state.activeImageId === image.id) state.activeImageId = state.images.at(-1)?.id ?? null;
      renderImageList();
      queueRender();
    });
    elements.imageList.append(item);
  });
}

function imageDrawRect(image, targetWidth, targetHeight) {
  let scaleX = targetWidth / image.width;
  let scaleY = targetHeight / image.height;
  if (state.fitMode === "cover") scaleX = scaleY = Math.max(scaleX, scaleY);
  if (state.fitMode === "contain") scaleX = scaleY = Math.min(scaleX, scaleY);
  scaleX *= state.zoom;
  scaleY *= state.zoom;
  const width = image.width * scaleX;
  const height = image.height * scaleY;
  const freeX = targetWidth - width;
  const freeY = targetHeight - height;
  return {
    x: freeX / 2 + state.offsetX * targetWidth * 0.35,
    y: freeY / 2 + state.offsetY * targetHeight * 0.35,
    width,
    height
  };
}

function buildSourceCanvas(layout, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#11151b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const selected = activeImage();
  if (selected) {
    const rect = imageDrawRect(selected, layout.width, layout.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      selected.image,
      rect.x * scale,
      rect.y * scale,
      rect.width * scale,
      rect.height * scale
    );
  }
  return canvas;
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPreview();
  });
}

function renderPreview() {
  const canvas = elements.previewCanvas;
  const width = Math.max(1, elements.previewStage.clientWidth);
  const height = Math.max(1, elements.previewStage.clientHeight);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const layout = physicalLayout();
  const padding = 55;
  const previewScale = Math.min((width - padding * 2) / layout.width, (height - padding * 2) / layout.height);
  const originX = (width - layout.width * previewScale) / 2;
  const originY = (height - layout.height * previewScale) / 2;
  const source = buildSourceCanvas(layout, Math.max(0.1, previewScale));

  context.save();
  context.shadowColor = "rgba(0,0,0,.55)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 12;

  layout.monitors.forEach((monitor, index) => {
    const x = originX + monitor.sourceX * previewScale;
    const y = originY + monitor.sourceY * previewScale;
    const w = monitor.width * previewScale;
    const h = monitor.height * previewScale;
    const sourceScale = source.width / layout.width;

    context.fillStyle = "#050607";
    context.fillRect(x - 5, y - 5, w + 10, h + 10);
    context.drawImage(
      source,
      monitor.sourceX * sourceScale,
      monitor.sourceY * sourceScale,
      monitor.width * sourceScale,
      monitor.height * sourceScale,
      x,
      y,
      w,
      h
    );
    context.strokeStyle = state.view === "technical" ? "#c8ff3d" : "#3f4651";
    context.lineWidth = state.view === "technical" ? 1.5 : 1;
    context.strokeRect(x, y, w, h);

    if (state.view === "technical") {
      context.shadowColor = "transparent";
      context.fillStyle = "rgba(10,12,15,.76)";
      context.fillRect(x + 9, y + 9, 116, 36);
      context.fillStyle = "#f4f1e9";
      context.font = "600 11px Segoe UI";
      context.fillText(`Monitor ${index + 1}`, x + 17, y + 24);
      context.fillStyle = "#a0a7b3";
      context.font = "10px Segoe UI";
      context.fillText(`${monitor.width} × ${monitor.height}`, x + 17, y + 38);
    }
  });
  context.restore();

  if (state.view === "technical" && layout.monitors.length > 1) {
    context.fillStyle = "rgba(255,128,85,.28)";
    for (let index = 1; index < layout.monitors.length; index++) {
      const previous = layout.monitors[index - 1];
      const monitor = layout.monitors[index];
      const gapStart = previous.sourceX + previous.width;
      const gapWidth = Math.max(0, monitor.sourceX - gapStart);
      context.fillRect(
        originX + gapStart * previewScale,
        originY,
        gapWidth * previewScale,
        layout.height * previewScale
      );
    }
  }

  elements.emptyPreview.hidden = Boolean(activeImage());
  updateQuality(layout);
}

function updateQuality(layout) {
  const image = activeImage();
  if (!image) {
    elements.qualityNotice.textContent = "Noch kein Bild gewählt";
    elements.qualityNotice.className = "quality-notice";
    return;
  }
  const requiredScale = Math.max(layout.width / image.width, layout.height / image.height) * state.zoom;
  const good = requiredScale <= 1.15;
  elements.qualityNotice.textContent = good
    ? "Bildauflösung ist ausreichend"
    : `Hinweis: Motiv wird auf etwa ${Math.round(requiredScale * 100)} % vergrößert`;
  elements.qualityNotice.className = `quality-notice ${good ? "good" : "warn"}`;
}

function buildExportCanvas() {
  const layout = physicalLayout();
  const bounds = monitorBounds();
  const source = buildSourceCanvas(layout);
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#11151b";
  context.fillRect(0, 0, canvas.width, canvas.height);

  layout.monitors.forEach(monitor => {
    context.drawImage(
      source,
      monitor.sourceX,
      monitor.sourceY,
      monitor.width,
      monitor.height,
      monitor.x - bounds.minX,
      monitor.y - bounds.minY,
      monitor.width,
      monitor.height
    );
  });
  return canvas;
}

async function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Das Bild konnte nicht erzeugt werden.")), "image/png");
  });
}

async function downloadWallpaper() {
  if (!activeImage()) return showToast("Bitte wähle zuerst ein Bild aus.");
  const blob = await canvasBlob(buildExportCanvas());
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "monitor-canvas-wallpaper.png";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Das Hintergrundbild wurde als PNG erstellt.");
}

async function applyWallpaper() {
  if (!activeImage()) return showToast("Bitte wähle zuerst ein Bild aus.");
  const button = document.querySelector("#applyButton");
  button.disabled = true;
  button.textContent = "Wird übernommen …";
  try {
    const blob = await canvasBlob(buildExportCanvas());
    const response = await fetch("/api/wallpaper", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: blob
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Übernahme fehlgeschlagen");
    showToast("Der neue Hintergrund ist jetzt aktiv.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Als Hintergrund übernehmen";
  }
}

function projectData() {
  return {
    version: 1,
    settings: {
      fitMode: state.fitMode,
      zoom: state.zoom,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      diagonal: state.diagonal,
      uniformFrames: state.uniformFrames,
      gaps: state.gaps,
      verticalOffsets: state.verticalOffsets
    },
    monitorSignature: state.monitors.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    note: "Quellbilder werden aus Datenschutzgründen nicht in der Projektdatei gespeichert."
  };
}

function saveProject() {
  const blob = new Blob([JSON.stringify(projectData(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mein-panorama.monitorcanvas.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openProject(file) {
  try {
    const project = JSON.parse(await file.text());
    if (project.version !== 1 || !project.settings) throw new Error("Unbekanntes Projektformat.");
    Object.assign(state, project.settings);
    ensureVerticalOffsetDefaults();
    syncControls();
    renderMonitorList();
    renderGapControls();
    queueRender();
    showToast("Projekteinstellungen geladen. Bitte wähle das zugehörige Quellbild.");
  } catch (error) {
    showToast(`Projekt konnte nicht geöffnet werden: ${error.message}`);
  }
}

function syncControls() {
  document.querySelector("#fitMode").value = state.fitMode;
  document.querySelector("#zoom").value = Math.round(state.zoom * 100);
  document.querySelector("#offsetX").value = Math.round(state.offsetX * 100);
  document.querySelector("#offsetY").value = Math.round(state.offsetY * 100);
  document.querySelector("#screenDiagonal").value = state.diagonal;
  document.querySelector("#uniformFrames").checked = state.uniformFrames;
  updateSliderOutputs();
}

function updateSliderOutputs() {
  document.querySelector("#zoomOutput").textContent = `${Math.round(state.zoom * 100)} %`;
  document.querySelector("#offsetXOutput").textContent = `${Math.round(state.offsetX * 100)} %`;
  document.querySelector("#offsetYOutput").textContent = `${Math.round(state.offsetY * 100)} %`;
}

function updateSummary() {
  const bounds = monitorBounds();
  elements.exportSize.textContent = `${bounds.width} × ${bounds.height} Pixel`;
}

function setStep(name) {
  document.querySelectorAll(".step").forEach(button => button.classList.toggle("active", button.dataset.step === name));
  document.querySelectorAll(".step-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === name));
}

function bindEvents() {
  document.querySelectorAll(".step").forEach(button => button.addEventListener("click", () => setStep(button.dataset.step)));
  document.querySelectorAll(".view-switch button").forEach(button => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll(".view-switch button").forEach(candidate => candidate.classList.toggle("active", candidate === button));
      queueRender();
    });
  });

  elements.imageInput.addEventListener("change", event => addImages(event.target.files));
  ["dragenter", "dragover"].forEach(type => elements.dropZone.addEventListener(type, event => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(type => elements.dropZone.addEventListener(type, event => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  }));
  elements.dropZone.addEventListener("drop", event => addImages(event.dataTransfer.files));

  document.querySelector("#fitMode").addEventListener("change", event => {
    state.fitMode = event.target.value;
    queueRender();
  });
  document.querySelector("#zoom").addEventListener("input", event => {
    state.zoom = Number(event.target.value) / 100;
    updateSliderOutputs();
    queueRender();
  });
  document.querySelector("#offsetX").addEventListener("input", event => {
    state.offsetX = Number(event.target.value) / 100;
    updateSliderOutputs();
    queueRender();
  });
  document.querySelector("#offsetY").addEventListener("input", event => {
    state.offsetY = Number(event.target.value) / 100;
    updateSliderOutputs();
    queueRender();
  });
  document.querySelector("#screenDiagonal").addEventListener("input", event => {
    state.diagonal = Math.max(10, Number(event.target.value) || 27);
    queueRender();
  });
  document.querySelector("#uniformFrames").addEventListener("change", event => {
    state.uniformFrames = event.target.checked;
    renderGapControls();
    queueRender();
  });

  document.querySelector("#refreshMonitorsButton").addEventListener("click", loadMonitors);
  document.querySelector("#downloadButton").addEventListener("click", downloadWallpaper);
  document.querySelector("#applyButton").addEventListener("click", applyWallpaper);
  document.querySelector("#saveProjectButton").addEventListener("click", saveProject);
  document.querySelector("#projectInput").addEventListener("change", event => event.target.files[0] && openProject(event.target.files[0]));
  window.addEventListener("resize", queueRender);
}

bindEvents();
syncControls();
loadMonitors();
