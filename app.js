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
  sheetLengthCm: 'auto', // 'auto' or fixed number
  autoFill: true,
  gapMm: 5,
  rotationStepDeg: 5,
  precisionMm: 1,
  dpi: 300,
  
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

// History Manager for Undo (Ctrl+Z)
const history = {
  undoStack: [],
  maxDepth: 50,
  
  save() {
    const snapshot = JSON.stringify(state.placedItems);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
      return;
    }
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
  },
  
  undo() {
    if (this.undoStack.length <= 1) {
      if (this.undoStack.length === 1 && state.placedItems.length > 0) {
        state.placedItems = [];
        state.selectedItem = null;
        if (state.sheetLengthCm === 'auto') {
          updateSheetDimensions();
        } else {
          drawCanvas();
        }
        updateStatistics();
      }
      return;
    }
    this.undoStack.pop();
    const prevStateString = this.undoStack[this.undoStack.length - 1];
    if (prevStateString) {
      state.placedItems = JSON.parse(prevStateString);
      state.selectedItem = null;
      if (state.sheetLengthCm === 'auto') {
        updateSheetDimensions();
      } else {
        drawCanvas();
      }
      updateStatistics();
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
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  
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
  
  // Overlays
  loadingOverlay: document.getElementById('loading-overlay'),
  optimizeProgress: document.getElementById('optimize-progress'),
  optimizePercentage: document.getElementById('optimize-percentage'),
  exportOverlay: document.getElementById('export-overlay'),
};

const ctx = elements.canvas.getContext('2d');
let nextImageId = 1;

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

  // Keyboard Shortcuts (R key to rotate selected item, Ctrl+Z to undo)
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && state.selectedItem) {
      rotateSelectedItem();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      history.undo();
    }
  });

  // Exports
  elements.exportPngBtn.addEventListener('click', exportPNG);
  elements.exportPdfBtn.addEventListener('click', exportPDF);

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
        
        state.images.push(imgItem);
        
        renderImageRow(imgItem);
        updateImageCount();
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
    <div class="item-thumb">
      <img src="${imgItem.img.src}" alt="${imgItem.name}">
    </div>
    <div class="item-details">
      <div class="item-name" title="${imgItem.name}">${imgItem.name}</div>
      <div class="item-dimensions">
        <input type="number" class="w-cm-input" value="${imgItem.targetWidthCm}" min="1" max="${state.sheetWidthCm}" step="0.5" style="width: 50px; padding: 2px 4px; display: inline-block;"> cm W
        <span>&times;</span>
        <span class="h-cm-val">${imgItem.targetHeightCm} cm H</span>
      </div>
    </div>
    <div class="item-qty-controls">
      <button class="qty-btn qty-minus"><i class="fa-solid fa-minus"></i></button>
      <input type="number" class="qty-val" value="${imgItem.quantity}" min="1">
      <button class="qty-btn qty-plus"><i class="fa-solid fa-plus"></i></button>
    </div>
    <div class="item-actions">
      <button class="row-delete-btn" title="Xóa"><i class="fa-solid fa-trash-can"></i></button>
    </div>
  `;
  
  // Binding row elements listeners
  const wInput = row.querySelector('.w-cm-input');
  const hVal = row.querySelector('.h-cm-val');
  const qtyInput = row.querySelector('.qty-val');
  
  wInput.addEventListener('change', (e) => {
    let w = parseFloat(e.target.value);
    if (isNaN(w) || w <= 0) w = 10;
    if (w > state.sheetWidthCm) w = state.sheetWidthCm;
    
    e.target.value = w;
    imgItem.targetWidthCm = w;
    
    // Scale height proportionally
    const aspect = imgItem.originalHeight / imgItem.originalWidth;
    imgItem.targetHeightCm = Math.round((w * aspect) * 10) / 10;
    hVal.textContent = `${imgItem.targetHeightCm} cm H`;
  });
  
  // Quantity handlers
  row.querySelector('.qty-minus').addEventListener('click', () => {
    let qty = parseInt(qtyInput.value) - 1;
    if (qty < 1) qty = 1;
    qtyInput.value = qty;
    imgItem.quantity = qty;
    updateImageCount();
  });
  
  row.querySelector('.qty-plus').addEventListener('click', () => {
    let qty = parseInt(qtyInput.value) + 1;
    qtyInput.value = qty;
    imgItem.quantity = qty;
    updateImageCount();
  });
  
  qtyInput.addEventListener('change', (e) => {
    let qty = parseInt(e.target.value);
    if (isNaN(qty) || qty < 1) qty = 1;
    e.target.value = qty;
    imgItem.quantity = qty;
    updateImageCount();
  });
  
  // Delete handler
  row.querySelector('.row-delete-btn').addEventListener('click', () => {
    state.images = state.images.filter(x => x.id !== imgItem.id);
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
  
  // Styling
  const textColor = '#8a96ab'; // var(--text-muted)
  const tickColor = '#2b3348'; // var(--border-color)
  
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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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
      
      ctx.restore();
    } else if (isColliding) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'var(--color-danger)';
      ctx.strokeRect(pxX, pxY, pxW, pxH);
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(pxX, pxY, pxW, pxH);
    }
  });
}

// --- Drag & Drop Manual Fine-Tuning ---
function handleMouseDown(e) {
  const rect = elements.viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Transform screen mouse coordinates to layout canvas coordinates
  const canvasX = (mouseX - state.pan.x) / state.zoom;
  const canvasY = (mouseY - state.pan.y) / state.zoom;
  
  const cmX = canvasX / state.PX_PER_CM;
  const cmY = canvasY / state.PX_PER_CM;
  
  // 1. Check if clicked on rotation handle of selected item
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
    // stickLength on screen is 25px, which in cm is (25 / state.zoom) / PX_PER_CM
    const stickLengthCm = 25 / (state.zoom * state.PX_PER_CM);
    const handleYCm = -item.targetHeightCm/2 - stickLengthCm;
    
    // Distance to handle in local space
    const distToHandle = Math.sqrt(localX*localX + (localY - handleYCm)*(localY - handleYCm));
    
    // Click radius is 15 screen pixels: (15 / state.zoom) / PX_PER_CM cm
    const clickRadiusCm = 15 / (state.zoom * state.PX_PER_CM);
    
    if (distToHandle < clickRadiusCm) {
      state.isRotating = true;
      const mouseAngleDeg = Math.atan2(cmY - item.centerY, cmX - item.centerX) * 180 / Math.PI;
      state.rotationOffset = item.angle - mouseAngleDeg;
      history.save(); // Save history snapshot before starting rotation
      return; // Exit, handled as rotation
    }
  }

  // 2. Precise Rotated Hit Detection for items (reverse scan)
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
  
  if (state.isRotating && state.selectedItem) {
    const item = state.selectedItem;
    let mouseAngleDeg = Math.atan2(cmY - item.centerY, cmX - item.centerX) * 180 / Math.PI;
    let newAngle = mouseAngleDeg + state.rotationOffset;
    
    // Shift snap
    if (e.shiftKey) {
      newAngle = Math.round(newAngle / 15) * 15;
    }
    
    item.angle = newAngle;
    
    // We should ideally update AABB for collision, but for performance
    // and simplicity we just recalculate the approximate bounding box if needed,
    // or let it be. Let's just update drawing.
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
      
      const hoverRadiusCm = 15 / (state.zoom * state.PX_PER_CM);
      
      if (distToHandle < hoverRadiusCm) {
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
  if (state.draggedItem || state.isRotating) {
    if (state.sheetLengthCm === 'auto') {
      updateSheetDimensions();
    }
    history.save(); // Save snapshot after dragging or rotating completes
  }
  state.draggedItem = null;
  state.isPanning = false;
  state.isRotating = false;
  elements.viewport.style.cursor = 'default';
}

function rotateSelectedItem() {
  if (!state.selectedItem) return;
  
  const item = state.selectedItem;
  
  // Advance angle by 90 deg for manual quick rotation
  item.angle = (item.angle + 90) % 360;
  
  // Swap bounding box dimensions roughly
  const oldW = item.w;
  const oldH = item.h;
  item.w = oldH;
  item.h = oldW;
  
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
  
  // Enable/Disable export actions
  const hasPlacements = placedCount > 0;
  elements.exportPngBtn.disabled = !hasPlacements;
  elements.exportPdfBtn.disabled = !hasPlacements;
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
  
  // Initialize Raster Optimizer
  const fixedLengthCm = state.sheetLengthCm === 'auto' ? null : state.sheetLengthCm;
  const optimizer = new RasterOptimizer(
    state.sheetWidthCm,
    state.gapMm,
    state.rotationStepDeg,
    state.precisionMm,
    fixedLengthCm,
    state.autoFill
  );
  
  // Run async optimizer
  optimizer.optimizeAsync(
    state.images,
    // Step update callback
    (placedList, percentage) => {
      state.placedItems = placedList;
      elements.optimizeProgress.style.width = `${percentage}%`;
      elements.optimizePercentage.textContent = `${percentage}%`;
      
      if (state.sheetLengthCm === 'auto') {
        updateSheetDimensions();
      } else {
        drawCanvas();
      }
    },
    // Final complete callback
    (finalPlacedList) => {
      state.placedItems = finalPlacedList;
      elements.loadingOverlay.classList.add('hidden');
      
      updateSheetDimensions();
      updateStatistics();
      resetViewport();
      history.save(); // Save history snapshot of optimized layout
    }
  );
}

// --- High-Resolution Output Generation ---
function renderHighResCanvas() {
  return new Promise((resolve) => {
    elements.exportOverlay.classList.remove('hidden');
    
    // Yield to UI to paint spinner
    setTimeout(() => {
      const scaleFactor = state.dpi / (2.54 * state.PX_PER_CM); // scale from layout to high-res target DPI
      
      let widthPx = Math.ceil(elements.canvas.width * scaleFactor);
      let heightPx = Math.ceil(elements.canvas.height * scaleFactor);
      
      // Browser safety limits
      const MAX_DIMENSION = 16384; 
      const MAX_AREA = 16384 * 16384; // 268 Megapixels
      
      let currentArea = widthPx * heightPx;
      let ratio = 1.0;
      let needsScaleDown = false;
      
      if (widthPx > MAX_DIMENSION || heightPx > MAX_DIMENSION || currentArea > MAX_AREA) {
        needsScaleDown = true;
        const ratioDim = Math.min(MAX_DIMENSION / widthPx, MAX_DIMENSION / heightPx);
        const ratioArea = Math.sqrt(MAX_AREA / currentArea);
        ratio = Math.min(ratioDim, ratioArea);
        
        widthPx = Math.floor(widthPx * ratio);
        heightPx = Math.floor(heightPx * ratio);
      }
      
      if (needsScaleDown) {
        const targetDpi = Math.round(state.dpi * ratio);
        alert(`Cảnh báo: Kích thước sơ đồ in quá lớn vượt quá giới hạn bộ nhớ của trình duyệt ở độ phân giải ${state.dpi} DPI. Hệ thống sẽ tự động giảm độ phân giải xuống còn ${targetDpi} DPI để đảm bảo tệp tin có thể được xuất thành công.`);
      }
      
      const drawDpi = state.dpi * ratio;
      
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = widthPx;
      exportCanvas.height = heightPx;
      const exportCtx = exportCanvas.getContext('2d');
      
      // Draw all items scaled
      state.placedItems.forEach(item => {
        const imgItem = state.images.find(x => x.id === item.parentImageId);
        if (!imgItem) return;
        
        // Draw onto the sheet export canvas
        exportCtx.save();
        
        const cxPx = item.centerX * (drawDpi / 2.54);
        const cyPx = item.centerY * (drawDpi / 2.54);
        const targetWPx = item.targetWidthCm * (drawDpi / 2.54);
        const targetHPx = item.targetHeightCm * (drawDpi / 2.54);
        
        exportCtx.translate(cxPx, cyPx);
        exportCtx.rotate(item.angle * Math.PI / 180);
        
        exportCtx.drawImage(imgItem.img, -targetWPx/2, -targetHPx/2, targetWPx, targetHPx);
        exportCtx.restore();
      });
      
      elements.exportOverlay.classList.add('hidden');
      resolve(exportCanvas);
    }, 100);
  });
}

async function exportPNG() {
  if (state.placedItems.length === 0) return;
  
  const highResCanvas = await renderHighResCanvas();
  
  // Trigger download
  const link = document.createElement('a');
  link.download = `dtf_nest_sheet_${state.sheetWidthCm}cm_${state.dpi}dpi.png`;
  
  highResCanvas.toBlob((blob) => {
    link.href = URL.createObjectURL(blob);
    link.click();
  }, 'image/png');
}

async function exportPDF() {
  if (state.placedItems.length === 0) return;
  
  // Dynamic load jsPDF library
  if (!window.jspdf) {
    elements.exportOverlay.querySelector('p').textContent = 'Đang tải thư viện PDF từ máy chủ CDN...';
    elements.exportOverlay.classList.remove('hidden');
    
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
    
    elements.exportOverlay.querySelector('p').textContent = 'Vui lòng chờ trong giây lát. Quá trình này có thể mất vài giây tùy vào DPI và chiều dài cuộn.';
    elements.exportOverlay.classList.add('hidden');
  }
  
  const highResCanvas = await renderHighResCanvas();
  
  elements.exportOverlay.querySelector('p').textContent = 'Đang xuất tệp PDF...';
  elements.exportOverlay.classList.remove('hidden');
  
  setTimeout(() => {
    // Generate PDF in standard millimeters (mm)
    const { jsPDF } = window.jspdf;
    
    const wMm = state.sheetWidthCm * 10;
    const hMm = (elements.canvas.height / state.PX_PER_CM) * 10;
    
    // Create custom page dimension PDF matching roll size
    const doc = new jsPDF({
      orientation: wMm > hMm ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [wMm, hMm]
    });
    
    // Add canvas as PNG image (compression level medium to retain quality)
    const imgData = highResCanvas.toDataURL('image/png');
    doc.addImage(imgData, 'PNG', 0, 0, wMm, hMm, undefined, 'FAST');
    
    doc.save(`dtf_nest_sheet_${state.sheetWidthCm}cm.pdf`);
    elements.exportOverlay.classList.add('hidden');
  }, 100);
}

// Start application
window.onload = init;
