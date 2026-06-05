/**
 * DTF Smart Nest - Main Application Script
 * Orchestrates UI, event handling, canvas rendering, and exports.
 */

// Application State
const state = {
  images: [],          // Uploaded images metadata
  placedItems: [],     // Items successfully placed on sheet
  selectedItem: null,  // Currently selected item for manual adjustments
  draggedItem: null,   // Item currently being dragged
  dragOffset: { x: 0, y: 0 },
  
  // Sheet configurations
  sheetWidthCm: 57,
  sheetLengthCm: 300, // 'auto' or fixed number
  autoFill: true,
  gapMm: 3,
  rotationStepDeg: 5,
  precisionMm: 1,
  dpi: 300,
  compressPng: false,
  
  // Viewport navigation
  zoom: 1.0,
  pan: { x: 40, y: 40 }, // Offset from top-left of viewport
  isPanning: false,
  panStart: { x: 0, y: 0 },
  isRotating: false,
  rotationOffset: 0,
  showGrid: true,
  
  // Layout scaling
  PX_PER_CM: 10, // 1cm = 10px on display screen
};

// History Manager for Undo/Redo
const history = {
  undoStack: [],
  redoStack: [],
  maxDepth: 50,
  
  save() {
    const snapshot = JSON.stringify({
      placedItems: state.placedItems,
      images: state.images.map(img => ({
        id: img.id,
        name: img.name,
        targetWidthCm: img.targetWidthCm,
        targetHeightCm: img.targetHeightCm,
        quantity: img.quantity
      }))
    });
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
      return;
    }
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new action
    this.updateButtons();
  },
  
  undo() {
    if (this.undoStack.length <= 1) {
      if (this.undoStack.length === 1 && (state.placedItems.length > 0 || state.images.length > 0)) {
        // Move current state to redo
        const currentState = this.undoStack.pop();
        this.redoStack.push(currentState);
        
        state.placedItems = [];
        state.images = [];
        state.selectedItem = null;
        elements.imageListContainer.innerHTML = `
          <div class="empty-list-state">
            <i class="fa-regular fa-image"></i>
            <p>Chưa có hình in nào được tải lên</p>
          </div>
        `;
        updateImageCount();
        if (state.sheetLengthCm === 'auto') {
          updateSheetDimensions();
        } else {
          drawCanvas();
        }
        updateStatistics();
        this.updateButtons();
      }
      return;
    }
    
    // Pop current state and push to redo
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);
    
    // Peek at previous state
    const prevStateString = this.undoStack[this.undoStack.length - 1];
    if (prevStateString) {
      this.restore(prevStateString);
    }
    this.updateButtons();
  },
  
  redo() {
    if (this.redoStack.length === 0) return;
    
    // Pop state from redo and push to undo
    const nextStateString = this.redoStack.pop();
    this.undoStack.push(nextStateString);
    
    this.restore(nextStateString);
    this.updateButtons();
  },
  
  restore(stateString) {
    const prevState = JSON.parse(stateString);
    state.placedItems = prevState.placedItems;
    state.images = prevState.images.map(imgData => ({
      id: imgData.id,
      name: imgData.name,
      img: imageCache[imgData.id],
      originalWidth: imageCache[imgData.id] ? imageCache[imgData.id].naturalWidth : 100,
      originalHeight: imageCache[imgData.id] ? imageCache[imgData.id].naturalHeight : 100,
      targetWidthCm: imgData.targetWidthCm,
      targetHeightCm: imgData.targetHeightCm,
      quantity: imgData.quantity
    }));
    state.selectedItem = null;
    
    // Re-render sidebar image list
    elements.imageListContainer.innerHTML = '';
    if (state.images.length === 0) {
      elements.imageListContainer.innerHTML = `
        <div class="empty-list-state">
          <i class="fa-regular fa-image"></i>
          <p>Chưa có hình in nào được tải lên</p>
        </div>
      `;
    } else {
      state.images.forEach(img => renderImageRow(img));
    }
    
    updateImageCount();
    if (state.sheetLengthCm === 'auto') {
      updateSheetDimensions();
    } else {
      drawCanvas();
    }
    updateStatistics();
  },
  
  updateButtons() {
    if (elements.undoBtn) {
      elements.undoBtn.disabled = this.undoStack.length <= 1 && !(this.undoStack.length === 1 && (state.placedItems.length > 0 || state.images.length > 0));
    }
    if (elements.redoBtn) {
      elements.redoBtn.disabled = this.redoStack.length === 0;
    }
  }
};

// DOM Elements
const elements = {
  sheetWidthSelect: document.getElementById('sheet-width-select'),
  lengthSelect: document.getElementById('length-select'),
  autoFillGroup: document.getElementById('auto-fill-group'),
  autoFillCheck: document.getElementById('auto-fill-check'),
  spacingSlider: document.getElementById('spacing-slider'),
  spacingVal: document.getElementById('spacing-val'),
  dpiSelect: document.getElementById('dpi-select'),
  compressPngCheck: document.getElementById('compress-png-check'),
  rotationSelect: document.getElementById('rotation-select'),
  precisionSelect: document.getElementById('precision-select'),
  fileInput: document.getElementById('file-input'),
  dropzone: document.getElementById('dropzone'),
  imageListContainer: document.getElementById('image-list-container'),
  imgCount: document.getElementById('img-count'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  optimizeBtn: document.getElementById('optimize-btn'),
  
  // Top bar statistics
  statLength: document.getElementById('stat-length'),
  statEfficiency: document.getElementById('stat-efficiency'),
  statPlaced: document.getElementById('stat-placed'),
  exportPngBtn: document.getElementById('export-png-btn'),
  exportSvgBtn: document.getElementById('export-svg-btn'),
  
  // Workspace elements
  viewport: document.getElementById('canvas-viewport'),
  canvasContainer: document.getElementById('canvas-container'),
  canvas: document.getElementById('nest-canvas'),
  rulerTop: document.getElementById('ruler-top'),
  rulerLeft: document.getElementById('ruler-left'),
  
  // Floating HUD controls
  zoomInBtn: document.getElementById('zoom-in-btn'),
  zoomOutBtn: document.getElementById('zoom-out-btn'),
  zoomResetBtn: document.getElementById('zoom-reset-btn'),
  toggleGridBtn: document.getElementById('toggle-grid-btn'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  undoBtn: document.getElementById('undo-btn'),
  redoBtn: document.getElementById('redo-btn'),
  
  // Overlays
  loadingOverlay: document.getElementById('loading-overlay'),
  optimizeProgress: document.getElementById('optimize-progress'),
  optimizePercentage: document.getElementById('optimize-percentage'),
  exportOverlay: document.getElementById('export-overlay'),
};

const ctx = elements.canvas.getContext('2d');
let nextImageId = 1;
const imageCache = {};

// --- Initialize Event Listeners ---
function init() {
  // Config Panel Binding
  elements.sheetWidthSelect.addEventListener('change', (e) => {
    state.sheetWidthCm = parseInt(e.target.value);
    updateSheetDimensions();
  });
  
  elements.lengthSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    state.sheetLengthCm = val === 'auto' ? 'auto' : parseInt(val);
    
    if (state.sheetLengthCm === 'auto') {
      elements.autoFillGroup.style.display = 'none';
      updateSheetDimensions();
    } else {
      elements.autoFillGroup.style.display = 'block';
      updateSheetDimensions();
    }
  });
  
  elements.autoFillCheck.addEventListener('change', (e) => {
    state.autoFill = e.target.checked;
  });
  
  elements.spacingSlider.addEventListener('input', (e) => {
    state.gapMm = parseInt(e.target.value);
    elements.spacingVal.textContent = `${state.gapMm} mm`;
  });
  
  elements.dpiSelect.addEventListener('change', (e) => {
    state.dpi = parseInt(e.target.value);
  });
  
  elements.compressPngCheck.addEventListener('change', (e) => {
    state.compressPng = e.target.checked;
  });
  
  elements.rotationSelect.addEventListener('change', (e) => {
    state.rotationStepDeg = parseInt(e.target.value);
  });

  elements.precisionSelect.addEventListener('change', (e) => {
    state.precisionMm = parseInt(e.target.value);
  });

  // Dropzone Events
  elements.dropzone.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', handleFileSelect);
  
  elements.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropzone.classList.add('dragover');
  });
  
  elements.dropzone.addEventListener('dragleave', () => {
    elements.dropzone.classList.remove('dragover');
  });
  
  elements.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  });
  
  elements.clearAllBtn.addEventListener('click', clearAllImages);
  elements.optimizeBtn.addEventListener('click', optimizeLayout);

  // Viewport Zoom & Pan
  elements.viewport.addEventListener('wheel', handleZoom, { passive: false });
  elements.viewport.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  
  // Context Menu prevention on Canvas
  elements.viewport.addEventListener('contextmenu', e => e.preventDefault());

  // HUD zoom controls
  elements.zoomInBtn.addEventListener('click', () => adjustZoom(1.2));
  elements.zoomOutBtn.addEventListener('click', () => adjustZoom(0.8));
  elements.zoomResetBtn.addEventListener('click', resetViewport);
  
  elements.toggleGridBtn.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    elements.toggleGridBtn.classList.toggle('active', state.showGrid);
    drawCanvas();
  });

  // Undo/Redo HUD controls click
  elements.undoBtn.addEventListener('click', () => history.undo());
  elements.redoBtn.addEventListener('click', () => history.redo());

  // Keyboard Shortcuts (R key to rotate selected item, Ctrl+Z to undo, Ctrl+Y or Ctrl+Shift+Z to redo)
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && state.selectedItem) {
      rotateSelectedItem();
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        history.redo();
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        history.undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        history.redo();
      }
    }
  });

  elements.exportPngBtn.addEventListener('click', exportPNG);
  elements.exportSvgBtn.addEventListener('click', exportSVG);

  // Initialize Theme from localStorage
  const currentTheme = localStorage.getItem('theme') || 'dark';
  if (currentTheme === 'light') {
    document.body.classList.add('light-theme');
    const icon = elements.themeToggleBtn.querySelector('i');
    if (icon) {
      icon.className = 'fa-solid fa-sun';
    }
  }

  // Theme Toggle Button Event
  elements.themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    const icon = elements.themeToggleBtn.querySelector('i');
    if (icon) {
      icon.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    
    // Redraw the canvas elements using the new theme styles
    drawRulers();
    drawCanvas();
  });

  // Initial layout sizing
  updateSheetDimensions();
  resetViewport();
  history.save(); // Save initial empty state
}

// --- Image Upload Processing ---
function handleFileSelect(e) {
  if (e.target.files.length > 0) {
    processFiles(e.target.files);
    elements.fileInput.value = ''; // Reset input
  }
}

function processFiles(fileList) {
  Array.from(fileList).forEach(file => {
    if (file.type !== 'image/png') {
      alert(`Chỉ hỗ trợ tệp PNG có nền trong suốt! Tệp ${file.name} đã bị bỏ qua.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = async function() {
        // Default physical width (cm) calculation: at 150 DPI (1 inch = 2.54 cm)
        // If the image is extremely large, default to 20 cm width to fit screen comfortably.
        const defaultWidthCm = Math.min(
          Math.round((img.naturalWidth / (150 / 2.54)) * 10) / 10,
          20
        );
        const aspect = img.naturalHeight / img.naturalWidth;
        const defaultHeightCm = Math.round((defaultWidthCm * aspect) * 10) / 10;
        
        const imgItem = {
          id: `img_${nextImageId++}`,
          file: file,
          img: img,
          name: file.name,
          originalWidth: img.naturalWidth,
          originalHeight: img.naturalHeight,
          targetWidthCm: defaultWidthCm,
          targetHeightCm: defaultHeightCm,
          quantity: 1
        };
        
        imageCache[imgItem.id] = img; // Lưu cache
        state.images.push(imgItem);
        
        renderImageRow(imgItem);
        updateImageCount();
        updateStatistics();
        history.save(); // Lưu lịch sử tải ảnh
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Helper removed since we draw original image transformed directly.
 */

// --- Image List UI Manager ---
function renderImageRow(imgItem) {
  const container = elements.imageListContainer;
  const emptyState = container.querySelector('.empty-list-state');
  if (emptyState) emptyState.remove();
  
  const row = document.createElement('div');
  row.className = 'image-item-row';
  row.dataset.id = imgItem.id;
  
  row.innerHTML = `
    <div class="row-top">
      <div class="item-thumb">
        <img src="${imgItem.img.src}" alt="${imgItem.name}">
      </div>
      <div class="item-details">
        <div class="item-name" title="${imgItem.name}">${imgItem.name}</div>
        <div class="item-placement-status" style="font-size: 11px; margin-top: 4px; color: var(--text-muted); font-weight: 500;">
          Đã xếp: <span class="placed-qty-val">0</span> / <span class="req-qty-val">${imgItem.quantity}</span>
        </div>
      </div>
    </div>
    <div class="row-bottom">
      <div class="item-qty-controls">
        <button class="qty-btn qty-minus"><i class="fa-solid fa-minus"></i></button>
        <input type="number" class="qty-val" value="${imgItem.quantity}" min="1">
        <button class="qty-btn qty-plus"><i class="fa-solid fa-plus"></i></button>
      </div>
      <div class="item-actions">
        <button class="row-delete-btn" title="Xóa"><i class="fa-solid fa-trash-can"></i> Xóa</button>
      </div>
    </div>
  `;
  
  // Binding row elements listeners
  const qtyInput = row.querySelector('.qty-val');
  
  // Quantity handlers
  row.querySelector('.qty-minus').addEventListener('click', () => {
    let qty = parseInt(qtyInput.value) - 1;
    if (qty < 1) qty = 1;
    qtyInput.value = qty;
    
    history.save();
    imgItem.quantity = qty;
    updateImageCount();
    updateStatistics();
    history.save();
  });
  
  row.querySelector('.qty-plus').addEventListener('click', () => {
    let qty = parseInt(qtyInput.value) + 1;
    qtyInput.value = qty;
    
    history.save();
    imgItem.quantity = qty;
    updateImageCount();
    updateStatistics();
    history.save();
  });
  
  qtyInput.addEventListener('change', (e) => {
    let qty = parseInt(e.target.value);
    if (isNaN(qty) || qty < 1) qty = 1;
    e.target.value = qty;
    
    history.save();
    imgItem.quantity = qty;
    updateImageCount();
    updateStatistics();
    history.save();
  });
  
  // Delete handler
  row.querySelector('.row-delete-btn').addEventListener('click', () => {
    history.save(); // Lưu trước khi xóa
    
    state.images = state.images.filter(x => x.id !== imgItem.id);
    state.placedItems = state.placedItems.filter(x => x.parentImageId !== imgItem.id); // Xóa cả các bản xếp trên canvas
    
    row.remove();
    updateImageCount();
    
    if (state.images.length === 0) {
      container.innerHTML = `
        <div class="empty-list-state">
          <i class="fa-regular fa-image"></i>
          <p>Chưa có hình in nào được tải lên</p>
        </div>
      `;
    }
    
    if (state.sheetLengthCm === 'auto') {
      updateSheetDimensions();
    } else {
      drawCanvas();
    }
    
    updateStatistics();
    history.save(); // Lưu sau khi xóa
  });
  
  container.appendChild(row);
}

function updateImageCount() {
  const count = state.images.reduce((sum, item) => sum + item.quantity, 0);
  elements.imgCount.textContent = count;
}

function clearAllImages() {
  if (state.images.length === 0) return;
  
  if (confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách hình ảnh tải lên?")) {
    history.save(); // Lưu trước khi xóa sạch
    state.images = [];
    state.placedItems = [];
    state.selectedItem = null;
    elements.imageListContainer.innerHTML = `
      <div class="empty-list-state">
        <i class="fa-regular fa-image"></i>
        <p>Chưa có hình in nào được tải lên</p>
      </div>
    `;
    updateImageCount();
    updateStatistics();
    drawCanvas();
    history.save(); // Lưu sau khi xóa sạch
  }
}

// --- Sheet Workspace Size Handling ---
function updateSheetDimensions() {
  // Width in layout pixels
  const canvasWidth = state.sheetWidthCm * state.PX_PER_CM;
  
  // Height in layout pixels
  let canvasHeight = 0;
  if (state.sheetLengthCm === 'auto') {
    // If auto, fit sheet height to maximum packed item height
    const maxYCm = state.placedItems.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    canvasHeight = Math.max(maxYCm * state.PX_PER_CM + 20, 100 * state.PX_PER_CM); // Include 2cm breathing padding
  } else {
    canvasHeight = state.sheetLengthCm * state.PX_PER_CM;
  }
  
  // Resize DOM element
  elements.canvas.width = canvasWidth;
  elements.canvas.height = canvasHeight;
  
  elements.canvasContainer.style.width = `${canvasWidth}px`;
  elements.canvasContainer.style.height = `${canvasHeight}px`;
  
  updateViewportTransform();
}

// --- Viewport Zoom & Pan Handlers ---
function handleZoom(e) {
  e.preventDefault();
  
  const zoomFactor = 1.1;
  const oldZoom = state.zoom;
  
  // Direction of scroll
  if (e.deltaY < 0) {
    state.zoom = Math.min(state.zoom * zoomFactor, 5.0);
  } else {
    state.zoom = Math.max(state.zoom / zoomFactor, 0.15);
  }
  
  // Zoom centering: offset pan based on mouse coordinates to zoom into mouse cursor
  const rect = elements.viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const canvasX = (mouseX - state.pan.x) / oldZoom;
  const canvasY = (mouseY - state.pan.y) / oldZoom;
  
  state.pan.x = mouseX - canvasX * state.zoom;
  state.pan.y = mouseY - canvasY * state.zoom;
  
  updateViewportTransform();
}

function adjustZoom(factor) {
  const oldZoom = state.zoom;
  state.zoom = Math.min(Math.max(state.zoom * factor, 0.15), 5.0);
  
  // Zoom into center of viewport
  const viewW = elements.viewport.clientWidth;
  const viewH = elements.viewport.clientHeight;
  const centerX = viewW / 2;
  const centerY = viewH / 2;
  
  const canvasX = (centerX - state.pan.x) / oldZoom;
  const canvasY = (centerY - state.pan.y) / oldZoom;
  
  state.pan.x = centerX - canvasX * state.zoom;
  state.pan.y = centerY - canvasY * state.zoom;
  
  updateViewportTransform();
}

function resetViewport() {
  const viewW = elements.viewport.clientWidth;
  const viewH = elements.viewport.clientHeight;
  
  const sheetW = state.sheetWidthCm * state.PX_PER_CM;
  const sheetH = elements.canvas.height;
  
  // Fit to screen width with padding
  const scaleX = (viewW - 100) / sheetW;
  const scaleY = (viewH - 100) / sheetH;
  
  state.zoom = Math.min(scaleX, scaleY, 1.0); // max default zoom is 100%
  
  // Center sheet in viewport
  state.pan.x = (viewW - sheetW * state.zoom) / 2;
  state.pan.y = 40; // 40px top offset
  
  updateViewportTransform();
}

function updateViewportTransform() {
  elements.canvasContainer.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  drawRulers();
  drawCanvas();
}

// --- Interactive Ruler Drawing ---
function drawRulers() {
  const rulerTop = elements.rulerTop;
  const rulerLeft = elements.rulerLeft;
  
  if (!rulerTop || !rulerLeft) return;
  
  const ctxTop = rulerTop.getContext('2d');
  const ctxLeft = rulerLeft.getContext('2d');
  
  const dpr = window.devicePixelRatio || 1;
  const wTop = rulerTop.clientWidth;
  const hLeft = rulerLeft.clientHeight;
  
  // Resize if needed
  const targetWTop = Math.floor(wTop * dpr);
  const targetHTop = Math.floor(20 * dpr);
  const targetWLeft = Math.floor(20 * dpr);
  const targetHLeft = Math.floor(hLeft * dpr);
  
  if (rulerTop.width !== targetWTop || rulerTop.height !== targetHTop) {
    rulerTop.width = targetWTop;
    rulerTop.height = targetHTop;
  }
  if (rulerLeft.width !== targetWLeft || rulerLeft.height !== targetHLeft) {
    rulerLeft.width = targetWLeft;
    rulerLeft.height = targetHLeft;
  }
  
  ctxTop.resetTransform();
  ctxTop.scale(dpr, dpr);
  ctxLeft.resetTransform();
  ctxLeft.scale(dpr, dpr);
  
  // Clear
  ctxTop.clearRect(0, 0, wTop, 20);
  ctxLeft.clearRect(0, 0, 20, hLeft);
  
  // Styling (Dynamic from CSS Variables)
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#8a96ab';
  const tickColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim() || 'rgba(255, 255, 255, 0.06)';
  
  ctxTop.fillStyle = textColor;
  ctxTop.strokeStyle = tickColor;
  ctxTop.font = '9px monospace';
  ctxTop.lineWidth = 1;
  
  ctxLeft.fillStyle = textColor;
  ctxLeft.strokeStyle = tickColor;
  ctxLeft.font = '9px monospace';
  ctxLeft.lineWidth = 1;
  
  const cmSpacing = state.PX_PER_CM * state.zoom;
  
  // Top ruler ticks
  const startXOffset = state.pan.x - 20;
  const startI_Top = Math.max(0, Math.floor(-startXOffset / cmSpacing));
  const endI_Top = Math.min(state.sheetWidthCm, Math.ceil((wTop - startXOffset) / cmSpacing));
  
  for (let i = startI_Top; i <= endI_Top; i++) {
    const x = startXOffset + i * cmSpacing;
    
    ctxTop.beginPath();
    ctxTop.moveTo(x, 20);
    
    if (i % 5 === 0) {
      ctxTop.lineTo(x, 8); // major tick
      ctxTop.stroke();
      ctxTop.fillText(i.toString(), x + 3, 10);
    } else {
      ctxTop.lineTo(x, 14); // minor tick
      ctxTop.stroke();
    }
  }
  
  // Left ruler ticks
  const startYOffset = state.pan.y - 20;
  const totalLengthCm = elements.canvas.height / state.PX_PER_CM;
  const startI_Left = Math.max(0, Math.floor(-startYOffset / cmSpacing));
  const endI_Left = Math.min(totalLengthCm, Math.ceil((hLeft - startYOffset) / cmSpacing));
  
  for (let i = startI_Left; i <= endI_Left; i++) {
    const y = startYOffset + i * cmSpacing;
    
    ctxLeft.beginPath();
    ctxLeft.moveTo(20, y);
    
    if (i % 5 === 0) {
      ctxLeft.lineTo(8, y); // major tick
      ctxLeft.stroke();
      ctxLeft.fillText(i.toString(), 2, y - 2);
    } else {
      ctxLeft.lineTo(14, y); // minor tick
      ctxLeft.stroke();
    }
  }
}

// --- Interactive Canvas Rendering ---
function drawCanvas() {
  const w = elements.canvas.width;
  const h = elements.canvas.height;
  
  // Clear canvas
  ctx.clearRect(0, 0, w, h);
  
  // Draw Grid lines
  if (state.showGrid) {
    const isLightTheme = document.body.classList.contains('light-theme');
    ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;
    const gridSpacing = state.PX_PER_CM; // 1cm grid
    
    // Vertical grid
    for (let x = 0; x < w; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    
    // Horizontal grid
    for (let y = 0; y < h; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
  
  // Draw placed items
  state.placedItems.forEach(item => {
    const imgItem = state.images.find(x => x.id === item.parentImageId);
    if (!imgItem) return;
    
    ctx.save();
    
    const isSelected = state.selectedItem === item;
    const isColliding = checkSingleCollision(item);
    
    const pxX = item.x * state.PX_PER_CM;
    const pxY = item.y * state.PX_PER_CM;
    const pxW = item.w * state.PX_PER_CM;
    const pxH = item.h * state.PX_PER_CM;

    if (isColliding) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.fillRect(pxX, pxY, pxW, pxH);
    }
    
    // Translate to center of image
    ctx.translate(item.centerX * state.PX_PER_CM, item.centerY * state.PX_PER_CM);
    ctx.rotate(item.angle * Math.PI / 180);
    
    const drawWPx = item.targetWidthCm * state.PX_PER_CM;
    const drawHPx = item.targetHeightCm * state.PX_PER_CM;
    
    ctx.drawImage(imgItem.img, -drawWPx/2, -drawHPx/2, drawWPx, drawHPx);
    
    ctx.restore();
    
    // Draw boundary border and handles
    if (isSelected) {
      ctx.save();
      ctx.translate(item.centerX * state.PX_PER_CM, item.centerY * state.PX_PER_CM);
      ctx.rotate(item.angle * Math.PI / 180);
      
      const drawWPx = item.targetWidthCm * state.PX_PER_CM;
      const drawHPx = item.targetHeightCm * state.PX_PER_CM;
      
      const scale = 1 / state.zoom;
      
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = 'var(--border-focus)';
      // Rotated dashed border
      ctx.setLineDash([4 * scale, 2 * scale]);
      ctx.strokeRect(-drawWPx/2, -drawHPx/2, drawWPx, drawHPx);
      ctx.setLineDash([]);
      
      // Corner handles
      ctx.fillStyle = 'var(--border-focus)';
      const hs = 6 * scale; // handle size
      ctx.fillRect(-drawWPx/2 - hs/2, -drawHPx/2 - hs/2, hs, hs);
      ctx.fillRect(drawWPx/2 - hs/2, -drawHPx/2 - hs/2, hs, hs);
      ctx.fillRect(-drawWPx/2 - hs/2, drawHPx/2 - hs/2, hs, hs);
      ctx.fillRect(drawWPx/2 - hs/2, drawHPx/2 - hs/2, hs, hs);
      
      // Rotation handle (sticking out from top center)
      const stickLength = 25 * scale;
      ctx.beginPath();
      ctx.moveTo(0, -drawHPx/2);
      ctx.lineTo(0, -drawHPx/2 - stickLength);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(0, -drawHPx/2 - stickLength, 5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      
      // Dimension text below the item
      ctx.fillStyle = 'var(--border-focus)';
      ctx.font = `600 ${Math.round(11 * scale)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const dimText = `${item.targetWidthCm.toFixed(1)} x ${item.targetHeightCm.toFixed(1)} cm`;
      ctx.fillText(dimText, 0, drawHPx/2 + 8 * scale);
      
      ctx.restore();
    } else if (isColliding) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'var(--color-danger)';
      ctx.strokeRect(pxX, pxY, pxW, pxH);
    } else {
      ctx.lineWidth = 1;
      const isLightTheme = document.body.classList.contains('light-theme');
      ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(pxX, pxY, pxW, pxH);
    }
  });
}

// --- Drag & Drop Manual Fine-Tuning & Resizing ---
function handleMouseDown(e) {
  const rect = elements.viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Transform screen mouse coordinates to layout canvas coordinates
  const canvasX = (mouseX - state.pan.x) / state.zoom;
  const canvasY = (mouseY - state.pan.y) / state.zoom;
  
  const cmX = canvasX / state.PX_PER_CM;
  const cmY = canvasY / state.PX_PER_CM;
  
  // 1. Check if clicked on resize handle of selected item
  if (state.selectedItem) {
    const item = state.selectedItem;
    // Calculate vector from center to mouse
    const dx = cmX - item.centerX;
    const dy = cmY - item.centerY;
    
    // Rotate vector backwards by item angle to get local coordinates
    const angleRad = -item.angle * Math.PI / 180;
    const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    
    const handleHalfW = item.targetWidthCm / 2;
    const handleHalfH = item.targetHeightCm / 2;
    
    // Check if close to any of the 4 corners
    const distTL = Math.sqrt((localX + handleHalfW)**2 + (localY + handleHalfH)**2);
    const distTR = Math.sqrt((localX - handleHalfW)**2 + (localY + handleHalfH)**2);
    const distBL = Math.sqrt((localX + handleHalfW)**2 + (localY - handleHalfH)**2);
    const distBR = Math.sqrt((localX - handleHalfW)**2 + (localY - handleHalfH)**2);
    
    // Click radius is 15 screen pixels: (15 / state.zoom) / PX_PER_CM cm
    const clickRadiusCm = 15 / (state.zoom * state.PX_PER_CM);
    
    let clickedHandle = null;
    if (distTL < clickRadiusCm) clickedHandle = 'TL';
    else if (distTR < clickRadiusCm) clickedHandle = 'TR';
    else if (distBL < clickRadiusCm) clickedHandle = 'BL';
    else if (distBR < clickRadiusCm) clickedHandle = 'BR';
    
    if (clickedHandle) {
      state.isResizing = true;
      state.resizingItem = item;
      state.resizeHandle = clickedHandle;
      state.originalAspectRatio = item.targetHeightCm / item.targetWidthCm;
      
      // Calculate and store the fixed opposite anchor point in sheet coordinates
      let uAnchor = 0;
      let vAnchor = 0;
      if (clickedHandle === 'TL') { uAnchor = handleHalfW; vAnchor = handleHalfH; }
      else if (clickedHandle === 'TR') { uAnchor = -handleHalfW; vAnchor = handleHalfH; }
      else if (clickedHandle === 'BL') { uAnchor = handleHalfW; vAnchor = -handleHalfH; }
      else if (clickedHandle === 'BR') { uAnchor = -handleHalfW; vAnchor = -handleHalfH; }
      
      const rad = item.angle * Math.PI / 180;
      state.resizeAnchor = {
        x: item.centerX + uAnchor * Math.cos(rad) - vAnchor * Math.sin(rad),
        y: item.centerY + uAnchor * Math.sin(rad) + vAnchor * Math.cos(rad),
        uAnchorMultiplier: uAnchor > 0 ? 1 : -1,
        vAnchorMultiplier: vAnchor > 0 ? 1 : -1
      };
      
      history.save(); // Save history snapshot before starting resize
      return; // Handled as resize, exit
    }
  }

  // 2. Check if clicked on rotation handle of selected item
  if (state.selectedItem) {
    const item = state.selectedItem;
    // Calculate vector from center to mouse
    const dx = cmX - item.centerX;
    const dy = cmY - item.centerY;
    
    // Rotate vector backwards by item angle
    const angleRad = -item.angle * Math.PI / 180;
    const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    
    // Rotation handle is at (0, -height/2 - stickLength) in local space
    const stickLengthCm = 25 / (state.zoom * state.PX_PER_CM);
    const handleYCm = -item.targetHeightCm/2 - stickLengthCm;
    
    // Distance to handle in local space
    const distToHandle = Math.sqrt(localX*localX + (localY - handleYCm)*(localY - handleYCm));
    
    // Click radius is 15 screen pixels
    const clickRadiusCm = 15 / (state.zoom * state.PX_PER_CM);
    
    if (distToHandle < clickRadiusCm) {
      state.isRotating = true;
      const mouseAngleDeg = Math.atan2(cmY - item.centerY, cmX - item.centerX) * 180 / Math.PI;
      state.rotationOffset = item.angle - mouseAngleDeg;
      history.save(); // Save history snapshot before starting rotation
      return; // Exit, handled as rotation
    }
  }

  // 3. Precise Rotated Hit Detection for items (reverse scan)
  let clickedItem = null;
  for (let i = state.placedItems.length - 1; i >= 0; i--) {
    const item = state.placedItems[i];
    
    const dx = cmX - item.centerX;
    const dy = cmY - item.centerY;
    
    const angleRad = -item.angle * Math.PI / 180;
    const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    
    if (
      localX >= -item.targetWidthCm/2 &&
      localX <= item.targetWidthCm/2 &&
      localY >= -item.targetHeightCm/2 &&
      localY <= item.targetHeightCm/2
    ) {
      clickedItem = item;
      break;
    }
  }
  
  if (clickedItem && e.button === 0) { // Left click: select and drag item
    state.selectedItem = clickedItem;
    state.draggedItem = clickedItem;
    state.dragOffset.x = cmX - clickedItem.x;
    state.dragOffset.y = cmY - clickedItem.y;
    
    // Put dragged item on top of placed stack
    state.placedItems = state.placedItems.filter(x => x !== clickedItem);
    state.placedItems.push(clickedItem);
    
    history.save(); // Save history snapshot before dragging modifies positions
    
    drawCanvas();
  } else {
    // If clicked empty space, or right click: start viewport panning
    state.isPanning = true;
    state.panStart.x = e.clientX - state.pan.x;
    state.panStart.y = e.clientY - state.pan.y;
    
    // Clear selection if left clicked empty area
    if (e.button === 0) {
      state.selectedItem = null;
      drawCanvas();
    }
  }
}

function handleMouseMove(e) {
  const rect = elements.viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const canvasX = (mouseX - state.pan.x) / state.zoom;
  const canvasY = (mouseY - state.pan.y) / state.zoom;
  
  const cmX = canvasX / state.PX_PER_CM;
  const cmY = canvasY / state.PX_PER_CM;
  
  if (state.isPanning) {
    state.pan.x = e.clientX - state.panStart.x;
    state.pan.y = e.clientY - state.panStart.y;
    updateViewportTransform();
    return;
  }
  
  // Handle Proportional Resize
  if (state.isResizing && state.resizingItem) {
    const item = state.resizingItem;
    const anchor = state.resizeAnchor;
    
    // Calculate vector from anchor to mouse in sheet coordinates
    const dx = cmX - anchor.x;
    const dy = cmY - anchor.y;
    
    // Rotate vector backwards by item angle to get local coordinates relative to anchor
    const rad = item.angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dxLocal = dx * cos + dy * sin;
    const dyLocal = -dx * sin + dy * cos;
    
    // Determine target dimensions
    const sx = -anchor.uAnchorMultiplier;
    const sy = -anchor.vAnchorMultiplier;
    
    const wCand = dxLocal * sx;
    const hCand = dyLocal * sy;
    
    const r = state.originalAspectRatio;
    let wNew = (wCand + hCand / r) / 2;
    
    // Clamp new width to be between 1.0cm and sheet width
    wNew = Math.max(1.0, Math.min(wNew, state.sheetWidthCm));
    const hNew = wNew * r;
    
    // Compute new center based on new local anchor position
    const uAnchorNew = anchor.uAnchorMultiplier * (wNew / 2);
    const vAnchorNew = anchor.vAnchorMultiplier * (hNew / 2);
    
    let newCenterX = anchor.x - uAnchorNew * cos + vAnchorNew * sin;
    let newCenterY = anchor.y - uAnchorNew * sin - vAnchorNew * cos;
    
    // Set properties
    item.targetWidthCm = wNew;
    item.targetHeightCm = hNew;
    item.centerX = newCenterX;
    item.centerY = newCenterY;
    
    // Update AABB
    updateItemAABB(item);
    
    // Keep within bounds
    if (item.x < 0) {
      const shift = -item.x;
      item.x = 0;
      item.centerX += shift;
    }
    if (item.x + item.w > state.sheetWidthCm) {
      const shift = (item.x + item.w) - state.sheetWidthCm;
      item.x = state.sheetWidthCm - item.w;
      item.centerX -= shift;
    }
    if (item.y < 0) {
      const shift = -item.y;
      item.y = 0;
      item.centerY += shift;
    }
    if (state.sheetLengthCm !== 'auto' && item.y + item.h > state.sheetLengthCm) {
      const shift = (item.y + item.h) - state.sheetLengthCm;
      item.y = state.sheetLengthCm - item.h;
      item.centerY -= shift;
    }
    
    if (state.sheetLengthCm === 'auto') {
      updateSheetDimensions();
    }
    
    drawCanvas();
    updateStatistics();
    return;
  }
  
  if (state.isRotating && state.selectedItem) {
    const item = state.selectedItem;
    let mouseAngleDeg = Math.atan2(cmY - item.centerY, cmX - item.centerX) * 180 / Math.PI;
    let newAngle = mouseAngleDeg + state.rotationOffset;
    
    // Shift snap
    if (e.shiftKey) {
      newAngle = Math.round(newAngle / 15) * 15;
    }
    
    item.angle = newAngle;
    
    // Update AABB to reflect rotation in collision
    updateItemAABB(item);
    
    drawCanvas();
    updateStatistics();
    return;
  }
  
  if (state.draggedItem) {
    let newX = cmX - state.dragOffset.x;
    let newY = cmY - state.dragOffset.y;
    
    // Constrain
    newX = Math.max(0, Math.min(newX, state.sheetWidthCm - state.draggedItem.w));
    newY = Math.max(0, newY);
    
    // Update center based on boundary shift
    const shiftX = newX - state.draggedItem.x;
    const shiftY = newY - state.draggedItem.y;
    
    state.draggedItem.centerX += shiftX;
    state.draggedItem.centerY += shiftY;
    state.draggedItem.x = newX;
    state.draggedItem.y = newY;
    
    // Auto-update sheet height if auto mode and dragging beyond current bounds
    if (state.sheetLengthCm === 'auto') {
      const currentCanvasHeightCm = elements.canvas.height / state.PX_PER_CM;
      if (newY + state.draggedItem.h > currentCanvasHeightCm) {
        updateSheetDimensions();
      }
    }
    
    drawCanvas();
    updateStatistics();
  } else {
    // Cursor updates when hovering
    elements.viewport.style.cursor = 'default';
    if (state.selectedItem && !state.isPanning) {
      const item = state.selectedItem;
      const dx = cmX - item.centerX;
      const dy = cmY - item.centerY;
      const angleRad = -item.angle * Math.PI / 180;
      const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
      const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
      
      const stickLengthCm = 25 / (state.zoom * state.PX_PER_CM);
      const handleYCm = -item.targetHeightCm/2 - stickLengthCm;
      const distToHandle = Math.sqrt(localX*localX + (localY - handleYCm)*(localY - handleYCm));
      
      const handleHalfW = item.targetWidthCm / 2;
      const handleHalfH = item.targetHeightCm / 2;
      const distTL = Math.sqrt((localX + handleHalfW)**2 + (localY + handleHalfH)**2);
      const distTR = Math.sqrt((localX - handleHalfW)**2 + (localY + handleHalfH)**2);
      const distBL = Math.sqrt((localX + handleHalfW)**2 + (localY - handleHalfH)**2);
      const distBR = Math.sqrt((localX - handleHalfW)**2 + (localY - handleHalfH)**2);
      
      const hoverRadiusCm = 15 / (state.zoom * state.PX_PER_CM);
      
      if (distTL < hoverRadiusCm || distBR < hoverRadiusCm) {
        elements.viewport.style.cursor = 'nwse-resize';
      } else if (distTR < hoverRadiusCm || distBL < hoverRadiusCm) {
        elements.viewport.style.cursor = 'nesw-resize';
      } else if (distToHandle < hoverRadiusCm) {
        elements.viewport.style.cursor = 'crosshair'; // Hovering rotation handle
      } else if (
        localX >= -item.targetWidthCm/2 &&
        localX <= item.targetWidthCm/2 &&
        localY >= -item.targetHeightCm/2 &&
        localY <= item.targetHeightCm/2
      ) {
        elements.viewport.style.cursor = 'move'; // Hovering item
      }
    }
  }
}

function handleMouseUp() {
  if (state.draggedItem || state.isRotating || state.isResizing) {
    if (state.sheetLengthCm === 'auto') {
      updateSheetDimensions();
    }
    history.save(); // Save snapshot after dragging, rotating or resizing completes
  }
  state.draggedItem = null;
  state.isPanning = false;
  state.isRotating = false;
  state.isResizing = false;
  state.resizingItem = null;
  elements.viewport.style.cursor = 'default';
}

function updateItemAABB(item) {
  const rad = item.angle * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  item.w = item.targetWidthCm * cos + item.targetHeightCm * sin;
  item.h = item.targetWidthCm * sin + item.targetHeightCm * cos;
  item.x = item.centerX - item.w / 2;
  item.y = item.centerY - item.h / 2;
}

function rotateSelectedItem() {
  if (!state.selectedItem) return;
  
  const item = state.selectedItem;
  
  // Advance angle by 90 deg for manual quick rotation
  item.angle = (item.angle + 90) % 360;
  
  // Update bounding box dimensions accurately
  updateItemAABB(item);
  
  // Re-constrain
  if (item.x + item.w > state.sheetWidthCm) {
    const shift = (item.x + item.w) - state.sheetWidthCm;
    item.x -= shift;
    item.centerX -= shift;
  }
  
  if (state.sheetLengthCm === 'auto') {
    updateSheetDimensions();
  }
  
  drawCanvas();
  updateStatistics();
  history.save(); // Save snapshot after rotation
}

// Double click logic removed, replaced by rotation handle.

// --- Keyboard Shortcuts ---
window.addEventListener('keydown', (e) => {
  if (!state.selectedItem) return;
  
  // Prevent default actions for keys we handle to avoid scrolling the page
  const handledKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'];
  if (handledKeys.includes(e.key) && e.target.tagName !== 'INPUT') {
    e.preventDefault();
  } else {
    return;
  }
  
  const item = state.selectedItem;
  
  if (e.key === 'Delete' || e.key === 'Backspace') {
    state.placedItems = state.placedItems.filter(x => x !== item);
    state.selectedItem = null;
    
    if (state.sheetLengthCm === 'auto') {
      updateSheetDimensions();
    } else {
      drawCanvas();
    }
    updateStatistics();
    history.save(); // Save snapshot after deleting
    return;
  }
  
  // Nudge amount: 1mm normally, 1cm if Shift is held
  const nudgeCm = e.shiftKey ? 1.0 : 0.1;
  
  if (e.key === 'ArrowUp') {
    item.centerY -= nudgeCm;
    item.y -= nudgeCm;
  } else if (e.key === 'ArrowDown') {
    item.centerY += nudgeCm;
    item.y += nudgeCm;
  } else if (e.key === 'ArrowLeft') {
    item.centerX -= nudgeCm;
    item.x -= nudgeCm;
  } else if (e.key === 'ArrowRight') {
    item.centerX += nudgeCm;
    item.x += nudgeCm;
  }
  
  drawCanvas();
  updateStatistics();
  history.save(); // Save snapshot after nudging
});

// --- Collision detection query ---
function checkSingleCollision(targetItem) {
  const gapCm = state.gapMm / 10;
  
  for (const item of state.placedItems) {
    if (item === targetItem) continue;
    
    const overlap = (
      targetItem.x < item.x + item.w + gapCm &&
      targetItem.x + targetItem.w + gapCm > item.x &&
      targetItem.y < item.y + item.h + gapCm &&
      targetItem.y + targetItem.h + gapCm > item.y
    );
    
    if (overlap) return true;
  }
  
  return false;
}

// --- Layout Statistics Calculations ---
function updateStatistics() {
  const totalShapes = state.images.reduce((sum, x) => sum + x.quantity, 0);
  const placedCount = state.placedItems.length;
  
  // Height/length of roll used
  let maxExtentYCm = state.placedItems.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  
  // Total area in cm2
  const totalAreaCm2 = state.sheetWidthCm * maxExtentYCm;
  
  // Area actually used by designs
  let activeAreaCm2 = 0;
  state.placedItems.forEach(item => {
    // We use rough bounding box area or actual target area
    activeAreaCm2 += item.targetWidthCm * item.targetHeightCm;
  });
  
  // Efficiency
  const efficiency = totalAreaCm2 > 0 ? Math.round((activeAreaCm2 / totalAreaCm2) * 100) : 0;
  
  elements.statLength.textContent = `${Math.ceil(maxExtentYCm)} cm`;
  elements.statEfficiency.textContent = `${efficiency}%`;
  
  if (placedCount > totalShapes) {
    const extraCount = placedCount - totalShapes;
    elements.statPlaced.textContent = `${totalShapes} (+${extraCount}) / ${totalShapes}`;
  } else {
    elements.statPlaced.textContent = `${placedCount} / ${totalShapes}`;
  }
  
  // Update each image row placement status in the sidebar
  state.images.forEach(imgItem => {
    const row = document.querySelector(`.image-item-row[data-id="${imgItem.id}"]`);
    if (row) {
      const placedCount = state.placedItems.filter(item => item.parentImageId === imgItem.id).length;
      const placedVal = row.querySelector('.placed-qty-val');
      const reqVal = row.querySelector('.req-qty-val');
      
      if (placedVal) placedVal.textContent = placedCount;
      if (reqVal) reqVal.textContent = imgItem.quantity;
      
      const statusDiv = row.querySelector('.item-placement-status');
      if (statusDiv) {
        if (placedCount === 0) {
          statusDiv.style.color = 'var(--text-muted)';
        } else if (placedCount >= imgItem.quantity) {
          statusDiv.style.color = 'var(--color-success)';
        } else {
          statusDiv.style.color = 'var(--color-warning)';
        }
      }
    }
  });
  
  // Enable/Disable export actions
  const hasPlacements = placedCount > 0;
  elements.exportPngBtn.disabled = !hasPlacements;
  elements.exportSvgBtn.disabled = !hasPlacements;
}

// --- Packing Execution (Nesting Trigger) ---
function optimizeLayout() {
  const totalShapes = state.images.reduce((sum, x) => sum + x.quantity, 0);
  if (totalShapes === 0) {
    alert("Vui lòng tải lên ít nhất một hình in PNG trước khi tối ưu!");
    return;
  }
  
  // Show Loading Animation
  elements.loadingOverlay.classList.remove('hidden');
  elements.optimizeProgress.style.width = '0%';
  elements.optimizePercentage.textContent = '0%';
  
  // Clear existing placements
  state.placedItems = [];
  state.selectedItem = null;
  drawCanvas();
  
  // Convert images to ImageBitmaps for Worker transfer
  const promises = state.images.map(async (imgItem) => {
    const bitmap = await createImageBitmap(imgItem.img);
    return {
      id: imgItem.id,
      name: imgItem.name,
      bitmap: bitmap,
      targetWidthCm: imgItem.targetWidthCm,
      targetHeightCm: imgItem.targetHeightCm,
      quantity: imgItem.quantity
    };
  });
  
  Promise.all(promises).then((shapes) => {
    const transferables = shapes.map(s => s.bitmap);
    
    // Spawn Web Worker
    const worker = new Worker('nesting-worker.js');
    const fixedLengthCm = state.sheetLengthCm === 'auto' ? null : state.sheetLengthCm;
    
    worker.postMessage({
      action: 'start',
      shapes: shapes,
      config: {
        sheetWidthCm: state.sheetWidthCm,
        gapMm: state.gapMm,
        rotationStepDeg: state.rotationStepDeg,
        precisionMm: state.precisionMm,
        fixedLengthCm: fixedLengthCm,
        autoFill: state.autoFill
      }
    }, transferables);
    
    worker.onmessage = function(e) {
      const { action, placedItems, percentage } = e.data;
      
      if (action === 'progress') {
        state.placedItems = placedItems;
        elements.optimizeProgress.style.width = `${percentage}%`;
        elements.optimizePercentage.textContent = `${percentage}%`;
        
        if (state.sheetLengthCm === 'auto') {
          updateSheetDimensions();
        } else {
          drawCanvas();
        }
      } else if (action === 'complete') {
        state.placedItems = placedItems;
        elements.loadingOverlay.classList.add('hidden');
        
        updateSheetDimensions();
        updateStatistics();
        resetViewport();
        history.save(); // Save history snapshot of optimized layout
        
        // Terminate worker to free memory
        worker.terminate();
      }
    };
  }).catch(err => {
    console.error("Error preparing images for worker:", err);
    elements.loadingOverlay.classList.add('hidden');
    alert("Có lỗi xảy ra khi xử lý dữ liệu ảnh.");
  });
}

async function exportPNG() {
  if (state.placedItems.length === 0) return;
  
  const scaleFactor = state.dpi / (2.54 * state.PX_PER_CM);
  const widthPx = Math.ceil(elements.canvas.width * scaleFactor);
  const heightPx = Math.ceil(elements.canvas.height * scaleFactor);
  const MAX_DIMENSION = 16384; 
  const MAX_AREA = 16384 * 16384;
  
  const currentArea = widthPx * heightPx;
  const exceedsLimits = widthPx > MAX_DIMENSION || heightPx > MAX_DIMENSION || currentArea > MAX_AREA;
  
  if (exceedsLimits) {
    const ratioDim = Math.min(MAX_DIMENSION / widthPx, MAX_DIMENSION / heightPx);
    const ratioArea = Math.sqrt(MAX_AREA / currentArea);
    const ratio = Math.min(ratioDim, ratioArea);
    const safeDpi = Math.round(state.dpi * ratio);
    
    alert(`Do giới hạn bộ nhớ của trình duyệt đối với file ảnh PNG đơn lẻ khổ lớn, độ phân giải đã được tự động điều chỉnh về mức tối đa có thể (${safeDpi} DPI) để tránh bị lỗi hình ảnh.\n\nĐể xuất file giữ nguyên độ phân giải chất lượng cao nhất (${state.dpi} DPI) không giới hạn chiều dài, vui lòng sử dụng chức năng "Xuất file SVG"!`);
    
    exportSinglePNG(safeDpi);
  } else {
    exportSinglePNG(state.dpi);
  }
}

async function exportSinglePNG(dpi) {
  elements.exportOverlay.querySelector('p').textContent = 'Đang chuẩn bị kết xuất...';
  elements.exportOverlay.classList.remove('hidden');
  
  // Yield to let loading overlay paint
  await new Promise(resolve => setTimeout(resolve, 50));
  
  try {
    if (state.compressPng) {
      elements.exportOverlay.querySelector('p').textContent = 'Đang tải bộ mã hóa tối ưu...';
      
      if (!window.pako) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.body.appendChild(script);
        });
      }
      
      if (!window.UPNG) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js';
          script.onload = resolve;
          script.onerror = reject;
          document.body.appendChild(script);
        });
      }
    }
    
    elements.exportOverlay.querySelector('p').textContent = 'Đang vẽ sơ đồ in...';
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const scaleFactor = dpi / (2.54 * state.PX_PER_CM);
    const widthPx = Math.ceil(elements.canvas.width * scaleFactor);
    const heightPx = Math.ceil(elements.canvas.height * scaleFactor);
    
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = widthPx;
    exportCanvas.height = heightPx;
    const exportCtx = exportCanvas.getContext('2d');
    
    state.placedItems.forEach(item => {
      const imgItem = state.images.find(x => x.id === item.parentImageId);
      if (!imgItem) return;
      
      exportCtx.save();
      const cxPx = item.centerX * (dpi / 2.54);
      const cyPx = item.centerY * (dpi / 2.54);
      const targetWPx = item.targetWidthCm * (dpi / 2.54);
      const targetHPx = item.targetHeightCm * (dpi / 2.54);
      
      exportCtx.translate(cxPx, cyPx);
      exportCtx.rotate(item.angle * Math.PI / 180);
      exportCtx.drawImage(imgItem.img, -targetWPx/2, -targetHPx/2, targetWPx, targetHPx);
      exportCtx.restore();
    });
    
    const link = document.createElement('a');
    link.download = `dtf_nest_sheet_${state.sheetWidthCm}cm_${dpi}dpi${state.compressPng ? '_optimized' : ''}.png`;
    
    if (state.compressPng) {
      elements.exportOverlay.querySelector('p').textContent = 'Đang nén tối ưu lượng hóa màu (PNG-8)...';
      await new Promise(resolve => setTimeout(resolve, 100)); // Give UI time to update
      
      const imgData = exportCtx.getImageData(0, 0, widthPx, heightPx);
      
      // UPNG.encode expects an array of ArrayBuffers containing raw RGBA pixels.
      const compressed = window.UPNG.encode([imgData.data.buffer], widthPx, heightPx, 256);
      
      // Inject physical DPI metadata chunk
      const patchedBuffer = insertDpiToPng(compressed, dpi);
      const blob = new Blob([patchedBuffer], { type: 'image/png' });
      
      link.href = URL.createObjectURL(blob);
      link.click();
      elements.exportOverlay.classList.add('hidden');
    } else {
      elements.exportOverlay.querySelector('p').textContent = 'Đang tạo file ảnh PNG...';
      await new Promise(resolve => setTimeout(resolve, 50));
      
      exportCanvas.toBlob((blob) => {
        blob.arrayBuffer().then(buf => {
          // Inject physical DPI metadata chunk
          const patchedBuffer = insertDpiToPng(buf, dpi);
          const patchedBlob = new Blob([patchedBuffer], { type: 'image/png' });
          link.href = URL.createObjectURL(patchedBlob);
          link.click();
          elements.exportOverlay.classList.add('hidden');
        }).catch(err => {
          console.error("Lỗi chèn DPI metadata:", err);
          link.href = URL.createObjectURL(blob);
          link.click();
          elements.exportOverlay.classList.add('hidden');
        });
      }, 'image/png');
    }
  } catch (error) {
    console.error("Lỗi xuất PNG:", error);
    alert("Có lỗi xảy ra khi tạo ảnh PNG.");
    elements.exportOverlay.classList.add('hidden');
  }
}

// Helper to insert pHYs chunk into PNG ArrayBuffer to set physical DPI metadata
function insertDpiToPng(arrayBuffer, dpi) {
  const view = new DataView(arrayBuffer);
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  
  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== pngSignature[i]) {
      return arrayBuffer;
    }
  }
  
  const ppm = Math.round(dpi / 0.0254);
  const chunkLength = 9;
  const chunkType = [112, 72, 89, 115]; // "pHYs"
  
  const chunkData = new Uint8Array(9);
  const dataView = new DataView(chunkData.buffer);
  dataView.setUint32(0, ppm);
  dataView.setUint32(4, ppm);
  chunkData[8] = 1; // unit: meter
  
  const crcInput = new Uint8Array(4 + chunkLength);
  crcInput.set(chunkType, 0);
  crcInput.set(chunkData, 4);
  const crc = crc32(crcInput);
  
  const physChunk = new Uint8Array(12 + chunkLength);
  const physView = new DataView(physChunk.buffer);
  physView.setUint32(0, chunkLength);
  physChunk.set(chunkType, 4);
  physChunk.set(chunkData, 8);
  physView.setUint32(17, crc);
  
  const originalBytes = new Uint8Array(arrayBuffer);
  const result = new Uint8Array(originalBytes.length + physChunk.length);
  
  // Signature + IHDR is exactly 33 bytes. Insert pHYs chunk right after.
  result.set(originalBytes.subarray(0, 33), 0);
  result.set(physChunk, 33);
  result.set(originalBytes.subarray(33), 33 + physChunk.length);
  
  return result.buffer;
}

function crc32(uint8Array) {
  let table = window.crc32Table;
  if (!table) {
    table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[i] = c;
    }
    window.crc32Table = table;
  }
  
  let crc = 0 ^ (-1);
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ uint8Array[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

async function exportSVG() {
  if (state.placedItems.length === 0) return;
  
  elements.exportOverlay.querySelector('p').textContent = 'Đang tạo file SVG...';
  elements.exportOverlay.classList.remove('hidden');
  
  setTimeout(() => {
    try {
      const wCm = state.sheetWidthCm;
      const hCm = elements.canvas.height / state.PX_PER_CM;
      
      let svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
      svgContent += `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${wCm}cm" height="${hCm}cm" viewBox="0 0 ${wCm} ${hCm}">\n`;
      svgContent += `  <rect width="100%" height="100%" fill="none" />\n`;
      
      state.placedItems.forEach(item => {
        const imgItem = state.images.find(x => x.id === item.parentImageId);
        if (!imgItem) return;
        
        const base64Src = imgItem.img.src;
        const xTranslate = item.centerX;
        const yTranslate = item.centerY;
        const wVal = item.targetWidthCm;
        const hVal = item.targetHeightCm;
        const angle = item.angle;
        
        svgContent += `  <image href="${base64Src}" x="${-wVal/2}" y="${-hVal/2}" width="${wVal}" height="${hVal}" transform="translate(${xTranslate}, ${yTranslate}) rotate(${angle})" />\n`;
      });
      
      svgContent += `</svg>\n`;
      
      const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const link = document.createElement('a');
      link.download = `dtf_nest_sheet_${state.sheetWidthCm}cm.svg`;
      link.href = URL.createObjectURL(blob);
      link.click();
    } catch (error) {
      console.error("Lỗi xuất SVG:", error);
      alert("Có lỗi xảy ra khi tạo file SVG.");
    } finally {
      elements.exportOverlay.classList.add('hidden');
    }
  }, 100);
}

// Start application
window.onload = init;
