const state = {
  monitors: [],
  images: [],
  activeImageId: null,
  fitMode: "cover",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  diagonal: 27,
  gaps: {},
  frames: {},
  verticalOffsets: {},
  ai: {
    subject: "",
    style: "cinematic",
    mood: "dramatic",
    focus: "automatic",
    avoid: ""
  },
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
  frameControls: document.querySelector("#frameControls"),
  frameMonitorCount: document.querySelector("#frameMonitorCount"),
  aiSubject: document.querySelector("#aiSubject"),
  aiStyle: document.querySelector("#aiStyle"),
  aiMood: document.querySelector("#aiMood"),
  aiFocus: document.querySelector("#aiFocus"),
  aiAvoid: document.querySelector("#aiAvoid"),
  aiPrompt: document.querySelector("#aiPrompt"),
  aiRecommendation: document.querySelector("#aiRecommendation"),
  qualityNotice: document.querySelector("#qualityNotice"),
  exportSize: document.querySelector("#exportSize"),
  toast: document.querySelector("#toast"),
  dropZone: document.querySelector("#dropZone")
};

let renderQueued = false;
let toastTimer;
let persistenceTimer;
let previewGeometry = null;
let dragState = null;

const SESSION_KEY = "monitorCanvas.session.v2";
const IMAGE_DATABASE = "monitorCanvas.images";

function openImageDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("images")) {
        database.createObjectStore("images", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeImageBlob(id, file) {
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("images", "readwrite");
    transaction.objectStore("images").put({
      id,
      name: file.name,
      type: file.type,
      blob: file
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function removeImageBlob(id) {
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("images", "readwrite");
    transaction.objectStore("images").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readImageBlobs() {
  const database = await openImageDatabase();
  const records = await new Promise((resolve, reject) => {
    const transaction = database.transaction("images", "readonly");
    const request = transaction.objectStore("images").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return new Map(records.map(record => [record.id, record]));
}

function serializableSession() {
  return {
    version: 2,
    activeImageId: state.activeImageId,
    fitMode: state.fitMode,
    diagonal: state.diagonal,
    gaps: state.gaps,
    frames: state.frames,
    verticalOffsets: state.verticalOffsets,
    ai: state.ai,
    view: state.view,
    images: state.images.map(image => ({
      id: image.id,
      name: image.name,
      width: image.width,
      height: image.height,
      placement: image.placement,
      basePlacement: image.basePlacement,
      zoom: image.zoom
    }))
  };
}

function persistSessionNow() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializableSession()));
  } catch (error) {
    console.warn("MonitorCanvas konnte die Sitzung nicht speichern.", error);
  }
}

function schedulePersistence() {
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(persistSessionNow, 120);
}

async function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    if (saved.version !== 2) return;
    state.fitMode = saved.fitMode ?? state.fitMode;
    state.diagonal = saved.diagonal ?? state.diagonal;
    state.gaps = saved.gaps ?? {};
    state.frames = saved.frames ?? {};
    state.verticalOffsets = saved.verticalOffsets ?? {};
    state.ai = { ...state.ai, ...(saved.ai ?? {}) };
    state.view = saved.view ?? "real";

    const blobs = await readImageBlobs();
    const restoredImages = [];
    for (const metadata of saved.images ?? []) {
      const record = blobs.get(metadata.id);
      if (!record?.blob) continue;
      const url = URL.createObjectURL(record.blob);
      const imageElement = new Image();
      imageElement.src = url;
      await imageElement.decode();
      restoredImages.push({
        ...metadata,
        name: record.name || metadata.name,
        width: imageElement.naturalWidth,
        height: imageElement.naturalHeight,
        url,
        image: imageElement
      });
    }
    state.images = restoredImages;
    state.activeImageId = restoredImages.some(image => image.id === saved.activeImageId)
      ? saved.activeImageId
      : restoredImages.at(-1)?.id ?? null;
    renderImageList();
    syncControls();
    syncViewControls();
  } catch (error) {
    console.warn("Die letzte MonitorCanvas-Sitzung konnte nicht geladen werden.", error);
  }
}

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

function frameMillimeters(monitor, side) {
  return Number(state.frames?.[monitor.id]?.[side] ?? 0);
}

function pixelsPerMillimeter(monitor) {
  const diagonalPx = Math.hypot(monitor.width, monitor.height);
  return diagonalPx / (state.diagonal * 25.4);
}

function physicalLayout() {
  const monitors = sortedMonitors();
  if (!monitors.length) return { monitors: [], width: 1, height: 1 };
  const bounds = monitorBounds();
  const horizontalTransitions = [];
  const verticalTransitions = [];

  for (const first of monitors) {
    for (const second of monitors) {
      if (first.id === second.id) continue;
      const verticalOverlap = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
      const horizontalOverlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
      const density = (pixelsPerMillimeter(first) + pixelsPerMillimeter(second)) / 2;

      if (Math.abs(first.x + first.width - second.x) <= 2 && verticalOverlap > 0) {
        horizontalTransitions.push({
          boundary: second.x,
          pixels: (frameMillimeters(first, "right") + frameMillimeters(second, "left")) * density
        });
      }
      if (Math.abs(first.y + first.height - second.y) <= 2 && horizontalOverlap > 0) {
        verticalTransitions.push({
          boundary: second.y,
          pixels: (frameMillimeters(first, "bottom") + frameMillimeters(second, "top")) * density
        });
      }
    }
  }

  const uniqueTransitions = transitions => {
    const grouped = new Map();
    transitions.forEach(transition => {
      grouped.set(transition.boundary, Math.max(grouped.get(transition.boundary) ?? 0, transition.pixels));
    });
    return [...grouped].map(([boundary, pixels]) => ({ boundary, pixels }));
  };
  const horizontal = uniqueTransitions(horizontalTransitions);
  const vertical = uniqueTransitions(verticalTransitions);

  const rawLayouts = monitors.map(monitor => {
    const addedX = horizontal
      .filter(transition => transition.boundary <= monitor.x)
      .reduce((sum, transition) => sum + transition.pixels, 0);
    const addedY = vertical
      .filter(transition => transition.boundary <= monitor.y)
      .reduce((sum, transition) => sum + transition.pixels, 0);
    const verticalOffset = Number(state.verticalOffsets[monitor.id] ?? 0);
    return {
      ...monitor,
      sourceX: monitor.x - bounds.minX + addedX,
      sourceY: monitor.y - bounds.minY + addedY + verticalOffset * pixelsPerMillimeter(monitor)
    };
  });

  const minSourceX = Math.min(...rawLayouts.map(monitor => monitor.sourceX));
  const minSourceY = Math.min(...rawLayouts.map(monitor => monitor.sourceY));
  const layouts = rawLayouts.map(monitor => ({
    ...monitor,
    sourceX: monitor.sourceX - minSourceX,
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
  ensureFrameDefaults();
  ensureVerticalOffsetDefaults();
  renderMonitorList();
  renderFrameControls();
  updateSummary();
  syncActiveImageControls();
  queueRender();
}

function ensureFrameDefaults() {
  if (!state.frames || typeof state.frames !== "object") {
    state.frames = {};
  }
  state.monitors.forEach(monitor => {
    if (!state.frames[monitor.id]) {
      const migratedHalfGap = Number(state.gaps?.uniform ?? 0) / 2;
      state.frames[monitor.id] = {
        top: migratedHalfGap,
        right: migratedHalfGap,
        bottom: migratedHalfGap,
        left: migratedHalfGap
      };
    }
    for (const side of ["top", "right", "bottom", "left"]) {
      if (state.frames[monitor.id][side] == null) {
        state.frames[monitor.id][side] = 0;
      }
    }
  });
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

function renderFrameControls() {
  elements.frameControls.innerHTML = "";
  elements.frameMonitorCount.textContent = state.monitors.length;
  const sideLabels = {
    top: "Oben",
    right: "Rechts",
    bottom: "Unten",
    left: "Links"
  };

  sortedMonitors().forEach((monitor, index) => {
    const card = document.createElement("article");
    card.className = "frame-monitor-card";
    card.innerHTML = `
      <header>
        <div>
          <strong>Monitor ${index + 1}</strong>
          <span>${monitor.width > monitor.height ? "Querformat" : "Hochformat"} · ${monitor.width} × ${monitor.height}</span>
        </div>
        <small>${escapeHtml(monitor.name)}</small>
      </header>
      <div class="frame-link-heading">
        <span>Seiten gemeinsam ändern</span>
        <small>Markieren zum Koppeln</small>
      </div>
      <div class="frame-links">
        ${Object.entries(sideLabels).map(([side, label]) => `
          <label>
            <input type="checkbox" data-link-side="${side}" ${side === "bottom" ? "" : "checked"}>
            <span>${label}</span>
          </label>
        `).join("")}
      </div>
      <div class="frame-side-list">
        ${Object.entries(sideLabels).map(([side, label]) => {
          const value = Number(state.frames[monitor.id][side] ?? 0);
          const inputId = `frame-${safeId(monitor.id)}-${side}`;
          return `
            <div class="frame-side-row" data-side="${side}">
              <label for="${inputId}">${label}</label>
              <input id="${inputId}" class="frame-range" type="range" min="0" max="80" step="0.5" value="${value}">
              <div class="frame-number">
                <input type="number" min="0" max="80" step="0.5" value="${value}">
                <span>mm</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    const applyValue = (sourceSide, rawValue) => {
      const value = Math.max(0, Math.min(80, Number(rawValue) || 0));
      const linkedSides = [...card.querySelectorAll("[data-link-side]:checked")]
        .map(input => input.dataset.linkSide);
      const targetSides = linkedSides.includes(sourceSide) ? linkedSides : [sourceSide];
      targetSides.forEach(side => {
        state.frames[monitor.id][side] = value;
        const row = card.querySelector(`[data-side="${side}"]`);
        row.querySelector(".frame-range").value = value;
        row.querySelector('input[type="number"]').value = value;
      });
      queueRender();
    };

    card.querySelectorAll(".frame-side-row").forEach(row => {
      const side = row.dataset.side;
      row.querySelector(".frame-range").addEventListener("input", event => {
        applyValue(side, event.target.value);
      });
      row.querySelector('input[type="number"]').addEventListener("input", event => {
        applyValue(side, event.target.value);
      });
    });
    elements.frameControls.append(card);
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
  const newImages = [];
  for (const file of accepted) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    await image.decode();
    const id = crypto.randomUUID();
    const item = {
      id,
      name: file.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
      url,
      image,
      placement: null,
      basePlacement: null,
      zoom: 1
    };
    state.images.push(item);
    newImages.push(item);
    state.activeImageId = item.id;
    await writeImageBlob(id, file);
  }

  if (accepted.length > 1 || (newImages.length && state.images.length > 1)) {
    arrangeImagesSideBySide();
  } else if (newImages.length === 1) {
    resetImageFit(newImages[0], state.fitMode);
  }
  renderImageList();
  syncActiveImageControls();
  schedulePersistence();
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
      syncActiveImageControls();
      schedulePersistence();
      queueRender();
    });
    item.querySelector("button").addEventListener("click", async event => {
      event.stopPropagation();
      URL.revokeObjectURL(image.url);
      state.images = state.images.filter(candidate => candidate.id !== image.id);
      if (state.activeImageId === image.id) state.activeImageId = state.images.at(-1)?.id ?? null;
      await removeImageBlob(image.id);
      renderImageList();
      syncActiveImageControls();
      schedulePersistence();
      queueRender();
    });
    elements.imageList.append(item);
  });
}

function resetImageFit(image, mode = state.fitMode) {
  const layout = physicalLayout();
  let width = layout.width;
  let height = layout.height;
  if (mode !== "stretch") {
    const scale = mode === "contain"
      ? Math.min(layout.width / image.width, layout.height / image.height)
      : Math.max(layout.width / image.width, layout.height / image.height);
    width = image.width * scale;
    height = image.height * scale;
  }
  image.basePlacement = {
    x: (layout.width - width) / 2,
    y: (layout.height - height) / 2,
    width,
    height
  };
  image.placement = { ...image.basePlacement };
  image.zoom = 1;
}

function arrangeImagesSideBySide() {
  if (!state.images.length) return;
  const layout = physicalLayout();
  const aspectSum = state.images.reduce((sum, image) => sum + image.width / image.height, 0);
  const commonHeight = Math.min(layout.height, layout.width / Math.max(aspectSum, 0.01));
  const totalWidth = commonHeight * aspectSum;
  let x = (layout.width - totalWidth) / 2;
  const y = (layout.height - commonHeight) / 2;

  state.images.forEach(image => {
    const width = commonHeight * image.width / image.height;
    image.basePlacement = { x, y, width, height: commonHeight };
    image.placement = { ...image.basePlacement };
    image.zoom = 1;
    x += width;
  });
  syncActiveImageControls();
  schedulePersistence();
  queueRender();
}

function buildSourceCanvas(layout, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#11151b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  state.images.forEach(sourceImage => {
    if (!sourceImage.placement) resetImageFit(sourceImage, state.fitMode);
    const rect = sourceImage.placement;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      sourceImage.image,
      rect.x * scale,
      rect.y * scale,
      rect.width * scale,
      rect.height * scale
    );
  });
  return canvas;
}

function queueRender() {
  schedulePersistence();
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
  previewGeometry = { layout, previewScale, originX, originY };
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
    context.strokeStyle = state.view === "technical" ? "#ff8c00" : "#51483e";
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

  const selected = activeImage();
  if (selected?.placement) {
    const rect = selected.placement;
    const x = originX + rect.x * previewScale;
    const y = originY + rect.y * previewScale;
    const w = rect.width * previewScale;
    const h = rect.height * previewScale;
    context.save();
    context.setLineDash([7, 5]);
    context.strokeStyle = "#ff8c00";
    context.lineWidth = 2;
    context.shadowColor = "rgba(0,0,0,.7)";
    context.shadowBlur = 4;
    context.strokeRect(x, y, w, h);
    context.setLineDash([]);
    context.fillStyle = "#ff8c00";
    context.font = "700 11px Segoe UI";
    const label = selected.name.length > 26 ? `${selected.name.slice(0, 23)}…` : selected.name;
    context.fillText(label, x + 7, Math.max(14, y - 7));
    context.restore();
  }

  elements.emptyPreview.hidden = Boolean(activeImage());
  updateQuality(layout);
  updateAIAssistant();
}

function updateQuality(layout) {
  const image = activeImage();
  if (!image) {
    elements.qualityNotice.textContent = "Noch kein Bild gewählt";
    elements.qualityNotice.className = "quality-notice";
    return;
  }
  const placement = image.placement ?? { width: layout.width, height: layout.height };
  const requiredScale = Math.max(placement.width / image.width, placement.height / image.height);
  const good = requiredScale <= 1.15;
  elements.qualityNotice.textContent = good
    ? "Bildauflösung ist ausreichend"
    : `Hinweis: Motiv wird auf etwa ${Math.round(requiredScale * 100)} % vergrößert`;
  elements.qualityNotice.className = `quality-notice ${good ? "good" : "warn"}`;
}

function roundToMultiple(value, multiple = 64) {
  return Math.ceil(value / multiple) * multiple;
}

function aiWallpaperPlan() {
  const layout = physicalLayout();
  const nativeWidth = roundToMultiple(layout.width);
  const nativeHeight = roundToMultiple(layout.height);
  const idealScale = Math.max(1, Math.min(1.5, 12288 / Math.max(nativeWidth, nativeHeight)));
  const idealWidth = roundToMultiple(nativeWidth * idealScale);
  const idealHeight = roundToMultiple(nativeHeight * idealScale);
  const ratio = layout.width / layout.height;
  const portraitMonitors = layout.monitors
    .map((monitor, index) => ({ monitor, index }))
    .filter(item => item.monitor.height > item.monitor.width);
  const largestMonitor = [...layout.monitors].sort((left, right) =>
    right.width * right.height - left.width * left.height
  )[0];
  const largestIndex = Math.max(0, layout.monitors.findIndex(monitor => monitor.id === largestMonitor?.id));
  const focusNames = {
    automatic: `innerhalb von Monitor ${largestIndex + 1}, mit Abstand zu allen Bildschirmkanten`,
    left: "im linken Drittel einer sichtbaren Monitorfläche",
    center: "mittig innerhalb einer einzelnen Monitorfläche, nicht auf einem Übergang",
    right: "im rechten Drittel einer sichtbaren Monitorfläche",
    distributed: "als mehrere visuelle Schwerpunkte, jeweils innerhalb einer eigenen Monitorfläche"
  };
  const styleNames = {
    cinematic: "filmisch, atmosphärisch, detailreich, hochwertige Lichtsetzung",
    photorealistic: "fotorealistisch, natürliche Materialien, glaubwürdige Beleuchtung",
    "digital-art": "hochwertige digitale Kunst, detailreich, klare Formen",
    illustration: "ausdrucksstarke Illustration, harmonische Formen und Farben",
    minimal: "minimalistisch, ruhige Flächen, wenige klar platzierte Elemente",
    abstract: "abstrakte Kunst, fließende Formen, räumliche Tiefe",
    anime: "hochwertiger Anime-Hintergrund, detailreiche Umgebung, filmische Komposition"
  };
  const moodNames = {
    dramatic: "dramatische Stimmung mit starkem Licht und Tiefe",
    calm: "ruhige, ausgeglichene Stimmung",
    bright: "helle, freundliche und offene Stimmung",
    dark: "dunkle, kontrastreiche Stimmung",
    colorful: "farbenreiche, lebendige Stimmung",
    elegant: "elegante, zurückhaltende und hochwertige Stimmung"
  };
  const transitions = Math.max(0, layout.monitors.length - 1);
  const orientationDescription = layout.monitors
    .map((monitor, index) => `Monitor ${index + 1}: ${monitor.width > monitor.height ? "Querformat" : "Hochformat"}`)
    .join(", ");
  const portraitHint = portraitMonitors.length
    ? `Der Bereich von ${portraitMonitors.map(item => `Monitor ${item.index + 1}`).join(" und ")} muss als eigenständige vertikale Komposition funktionieren.`
    : "Alle sichtbaren Bereiche sind im Querformat angeordnet.";
  const avoid = ["Text", "Logos", "Wasserzeichen", "abgeschnittene Hauptmotive an Bildschirmübergängen"];
  if (state.ai.avoid.trim()) avoid.push(state.ai.avoid.trim());
  const subject = state.ai.subject.trim() || "ein visuell eindrucksvolles, zusammenhängendes Panorama";

  const prompt = [
    `Erstelle ein ${styleNames[state.ai.style]} Wallpaper: ${subject}.`,
    `${moodNames[state.ai.mood]}.`,
    `Komposition für eine Monitorwand mit ${layout.monitors.length} Monitor${layout.monitors.length === 1 ? "" : "en"} und einem Gesamtseitenverhältnis von ${ratio.toFixed(2)}:1.`,
    `Zielauflösung mindestens ${nativeWidth} × ${nativeHeight} Pixel, ideal ${idealWidth} × ${idealHeight} Pixel.`,
    `Monitoranordnung: ${orientationDescription}. ${portraitHint}`,
    `Das wichtigste Motiv liegt ${focusNames[state.ai.focus]}.`,
    `Wichtige Gesichter, Schrift, Augen, Fahrzeuge und klare geometrische Objekte vollständig innerhalb einzelner Monitorflächen platzieren.`,
    `Zwischen den Monitoren liegen ${transitions} physische Übergang${transitions === 1 ? "" : "e"} mit Rahmenkorrektur. Dort nur unkritische Hintergründe, Himmel, Nebel, Wasser, Boden, Lichtspuren oder fortlaufende Texturen verwenden.`,
    `Das Bild muss an allen sichtbaren Außenkanten natürlich weiterwirken und darf keine dekorativen Bildrahmen enthalten.`,
    `Vermeiden: ${avoid.join(", ")}.`
  ].join("\n\n");

  return {
    layout,
    nativeWidth,
    nativeHeight,
    idealWidth,
    idealHeight,
    ratio,
    portraitCount: portraitMonitors.length,
    prompt
  };
}

function updateAIAssistant() {
  if (!elements.aiPrompt || !state.monitors.length) return;
  const plan = aiWallpaperPlan();
  elements.aiPrompt.value = plan.prompt;
  elements.aiRecommendation.innerHTML = `
    <div><span>Mindestgröße</span><strong>${plan.nativeWidth} × ${plan.nativeHeight} px</strong></div>
    <div><span>Ideal</span><strong>${plan.idealWidth} × ${plan.idealHeight} px</strong></div>
    <div><span>Seitenverhältnis</span><strong>${plan.ratio.toFixed(2)} : 1</strong></div>
    <div><span>Ausrichtung</span><strong>${plan.portraitCount ? `${plan.portraitCount} × Hochformat` : "Nur Querformat"}</strong></div>
  `;
}

async function copyAIPrompt() {
  updateAIAssistant();
  try {
    await navigator.clipboard.writeText(elements.aiPrompt.value);
    showToast("Der KI-Prompt wurde kopiert.");
  } catch {
    elements.aiPrompt.select();
    document.execCommand("copy");
    showToast("Der KI-Prompt wurde kopiert.");
  }
}

function downloadCompositionMask() {
  const plan = aiWallpaperPlan();
  const maxDimension = 3200;
  const scale = Math.min(1, maxDimension / Math.max(plan.layout.width, plan.layout.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(plan.layout.width * scale));
  canvas.height = Math.max(1, Math.round(plan.layout.height * scale));
  const context = canvas.getContext("2d");

  context.fillStyle = "#1a1a1a";
  context.fillRect(0, 0, canvas.width, canvas.height);

  plan.layout.monitors.forEach((monitor, index) => {
    const x = monitor.sourceX * scale;
    const y = monitor.sourceY * scale;
    const width = monitor.width * scale;
    const height = monitor.height * scale;
    const inset = Math.max(8, Math.min(width, height) * 0.06);

    context.fillStyle = index % 2 ? "#29231e" : "#242424";
    context.fillRect(x, y, width, height);
    context.strokeStyle = "#ff8c00";
    context.lineWidth = Math.max(2, 4 * scale);
    context.strokeRect(x, y, width, height);
    context.setLineDash([12, 8]);
    context.strokeStyle = "rgba(255,255,255,.48)";
    context.strokeRect(x + inset, y + inset, width - inset * 2, height - inset * 2);
    context.setLineDash([]);

    context.fillStyle = "#fff8ef";
    context.font = `700 ${Math.max(14, Math.round(24 * scale))}px Segoe UI`;
    context.fillText(`Monitor ${index + 1}`, x + inset, y + inset + Math.max(18, 28 * scale));
    context.fillStyle = "#ffb15a";
    context.font = `${Math.max(11, Math.round(16 * scale))}px Segoe UI`;
    context.fillText(
      `${monitor.width > monitor.height ? "Querformat" : "Hochformat"} · sichere Motivfläche gestrichelt`,
      x + inset,
      y + inset + Math.max(38, 52 * scale)
    );
  });

  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `monitorcanvas-kompositionsmaske-${plan.nativeWidth}x${plan.nativeHeight}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Die Kompositionsmaske wurde erstellt.");
  }, "image/png");
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
      gaps: state.gaps,
      frames: state.frames,
      verticalOffsets: state.verticalOffsets,
      ai: state.ai,
      imageLayout: state.images.map(image => ({
        name: image.name,
        placement: image.placement,
        basePlacement: image.basePlacement,
        zoom: image.zoom
      }))
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
    ensureFrameDefaults();
    ensureVerticalOffsetDefaults();
    for (const savedImage of project.settings.imageLayout ?? []) {
      const image = state.images.find(candidate => candidate.name === savedImage.name);
      if (!image) continue;
      image.placement = savedImage.placement;
      image.basePlacement = savedImage.basePlacement;
      image.zoom = savedImage.zoom ?? 1;
    }
    syncControls();
    syncActiveImageControls();
    renderMonitorList();
    renderFrameControls();
    queueRender();
    showToast("Projekteinstellungen geladen. Bitte wähle das zugehörige Quellbild.");
  } catch (error) {
    showToast(`Projekt konnte nicht geöffnet werden: ${error.message}`);
  }
}

function syncControls() {
  document.querySelector("#fitMode").value = state.fitMode;
  document.querySelector("#screenDiagonal").value = state.diagonal;
  elements.aiSubject.value = state.ai.subject;
  elements.aiStyle.value = state.ai.style;
  elements.aiMood.value = state.ai.mood;
  elements.aiFocus.value = state.ai.focus;
  elements.aiAvoid.value = state.ai.avoid;
  syncActiveImageControls();
  updateAIAssistant();
}

function updateSliderOutputs() {
  document.querySelector("#zoomOutput").textContent = `${Math.round(state.zoom * 100)} %`;
  document.querySelector("#offsetXOutput").textContent = `${Math.round(state.offsetX * 100)} %`;
  document.querySelector("#offsetYOutput").textContent = `${Math.round(state.offsetY * 100)} %`;
}

function syncActiveImageControls() {
  const image = activeImage();
  const controls = [
    document.querySelector("#fitMode"),
    document.querySelector("#zoom"),
    document.querySelector("#offsetX"),
    document.querySelector("#offsetY")
  ];
  controls.forEach(control => {
    control.disabled = !image;
  });

  if (!image?.placement) {
    state.zoom = 1;
    state.offsetX = 0;
    state.offsetY = 0;
  } else {
    const layout = physicalLayout();
    state.zoom = image.zoom ?? 1;
    const centeredX = (layout.width - image.placement.width) / 2;
    const centeredY = (layout.height - image.placement.height) / 2;
    state.offsetX = Math.max(-1, Math.min(1, (image.placement.x - centeredX) / (layout.width * 0.35)));
    state.offsetY = Math.max(-1, Math.min(1, (image.placement.y - centeredY) / (layout.height * 0.35)));
  }

  document.querySelector("#zoom").value = Math.round(state.zoom * 100);
  document.querySelector("#offsetX").value = Math.round(state.offsetX * 100);
  document.querySelector("#offsetY").value = Math.round(state.offsetY * 100);
  updateSliderOutputs();
}

function syncViewControls() {
  document.querySelectorAll(".view-switch button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

function updateSummary() {
  const bounds = monitorBounds();
  elements.exportSize.textContent = `${bounds.width} × ${bounds.height} Pixel`;
}

function setStep(name) {
  document.querySelectorAll(".step").forEach(button => button.classList.toggle("active", button.dataset.step === name));
  document.querySelectorAll(".step-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === name));
}

function previewPoint(event) {
  if (!previewGeometry) return null;
  const bounds = elements.previewCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left - previewGeometry.originX) / previewGeometry.previewScale,
    y: (event.clientY - bounds.top - previewGeometry.originY) / previewGeometry.previewScale
  };
}

function imageAtPoint(point) {
  const selected = activeImage();
  const candidates = selected
    ? [selected, ...[...state.images].reverse().filter(image => image.id !== selected.id)]
    : [...state.images].reverse();
  return candidates.find(image => {
    const rect = image.placement;
    return rect &&
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height;
  }) ?? null;
}

function snapPlacement(image, x, y, disabled) {
  if (disabled || !previewGeometry) return { x, y };
  const threshold = 12 / previewGeometry.previewScale;
  const movingX = [x, x + image.placement.width];
  const movingY = [y, y + image.placement.height];
  const targetX = [0, previewGeometry.layout.width];
  const targetY = [0, previewGeometry.layout.height];

  state.images.forEach(candidate => {
    if (candidate.id === image.id || !candidate.placement) return;
    targetX.push(candidate.placement.x, candidate.placement.x + candidate.placement.width);
    targetY.push(candidate.placement.y, candidate.placement.y + candidate.placement.height);
  });

  let bestX = { distance: Infinity, correction: 0 };
  let bestY = { distance: Infinity, correction: 0 };
  for (const movingEdge of movingX) {
    for (const targetEdge of targetX) {
      const correction = targetEdge - movingEdge;
      if (Math.abs(correction) < bestX.distance) {
        bestX = { distance: Math.abs(correction), correction };
      }
    }
  }
  for (const movingEdge of movingY) {
    for (const targetEdge of targetY) {
      const correction = targetEdge - movingEdge;
      if (Math.abs(correction) < bestY.distance) {
        bestY = { distance: Math.abs(correction), correction };
      }
    }
  }

  return {
    x: bestX.distance <= threshold ? x + bestX.correction : x,
    y: bestY.distance <= threshold ? y + bestY.correction : y
  };
}

function beginImageDrag(event) {
  if (event.button !== 0) return;
  const point = previewPoint(event);
  if (!point) return;
  const image = imageAtPoint(point);
  if (!image) return;

  state.activeImageId = image.id;
  dragState = {
    image,
    startPointer: point,
    startX: image.placement.x,
    startY: image.placement.y
  };
  elements.previewCanvas.setPointerCapture(event.pointerId);
  elements.previewCanvas.classList.add("dragging");
  renderImageList();
  syncActiveImageControls();
  queueRender();
}

function moveImageDrag(event) {
  if (!dragState) return;
  const point = previewPoint(event);
  if (!point) return;
  const proposedX = dragState.startX + point.x - dragState.startPointer.x;
  const proposedY = dragState.startY + point.y - dragState.startPointer.y;
  const snapped = snapPlacement(dragState.image, proposedX, proposedY, event.shiftKey);
  dragState.image.placement.x = snapped.x;
  dragState.image.placement.y = snapped.y;
  syncActiveImageControls();
  queueRender();
}

function endImageDrag(event) {
  if (!dragState) return;
  if (elements.previewCanvas.hasPointerCapture(event.pointerId)) {
    elements.previewCanvas.releasePointerCapture(event.pointerId);
  }
  elements.previewCanvas.classList.remove("dragging");
  dragState = null;
  schedulePersistence();
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
    const image = activeImage();
    if (image) {
      resetImageFit(image, state.fitMode);
      syncActiveImageControls();
    }
    queueRender();
  });
  document.querySelector("#zoom").addEventListener("input", event => {
    const image = activeImage();
    if (!image?.placement || !image.basePlacement) return;
    const previousCenterX = image.placement.x + image.placement.width / 2;
    const previousCenterY = image.placement.y + image.placement.height / 2;
    state.zoom = Number(event.target.value) / 100;
    image.zoom = state.zoom;
    image.placement.width = image.basePlacement.width * state.zoom;
    image.placement.height = image.basePlacement.height * state.zoom;
    image.placement.x = previousCenterX - image.placement.width / 2;
    image.placement.y = previousCenterY - image.placement.height / 2;
    updateSliderOutputs();
    queueRender();
  });
  document.querySelector("#offsetX").addEventListener("input", event => {
    const image = activeImage();
    if (!image?.placement) return;
    const layout = physicalLayout();
    state.offsetX = Number(event.target.value) / 100;
    image.placement.x = (layout.width - image.placement.width) / 2 + state.offsetX * layout.width * 0.35;
    updateSliderOutputs();
    queueRender();
  });
  document.querySelector("#offsetY").addEventListener("input", event => {
    const image = activeImage();
    if (!image?.placement) return;
    const layout = physicalLayout();
    state.offsetY = Number(event.target.value) / 100;
    image.placement.y = (layout.height - image.placement.height) / 2 + state.offsetY * layout.height * 0.35;
    updateSliderOutputs();
    queueRender();
  });
  document.querySelector("#screenDiagonal").addEventListener("input", event => {
    state.diagonal = Math.max(10, Number(event.target.value) || 27);
    queueRender();
  });
  [
    [elements.aiSubject, "subject"],
    [elements.aiStyle, "style"],
    [elements.aiMood, "mood"],
    [elements.aiFocus, "focus"],
    [elements.aiAvoid, "avoid"]
  ].forEach(([element, key]) => {
    element.addEventListener("input", event => {
      state.ai[key] = event.target.value;
      updateAIAssistant();
      schedulePersistence();
    });
  });

  document.querySelector("#refreshMonitorsButton").addEventListener("click", loadMonitors);
  document.querySelector("#arrangeImagesButton").addEventListener("click", arrangeImagesSideBySide);
  document.querySelector("#copyPromptButton").addEventListener("click", copyAIPrompt);
  document.querySelector("#downloadMaskButton").addEventListener("click", downloadCompositionMask);
  document.querySelector("#downloadButton").addEventListener("click", downloadWallpaper);
  document.querySelector("#applyButton").addEventListener("click", applyWallpaper);
  document.querySelector("#saveProjectButton").addEventListener("click", saveProject);
  document.querySelector("#projectInput").addEventListener("change", event => event.target.files[0] && openProject(event.target.files[0]));
  elements.previewCanvas.addEventListener("pointerdown", beginImageDrag);
  elements.previewCanvas.addEventListener("pointermove", moveImageDrag);
  elements.previewCanvas.addEventListener("pointerup", endImageDrag);
  elements.previewCanvas.addEventListener("pointercancel", endImageDrag);
  window.addEventListener("resize", queueRender);
  window.addEventListener("beforeunload", persistSessionNow);
}

bindEvents();
syncControls();
restoreSession().finally(loadMonitors);
