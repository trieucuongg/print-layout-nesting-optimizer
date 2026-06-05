/**
 * DTF Smart Nest - Web Worker Optimizer
 * Runs the raster-based irregular shape nesting algorithm on a background thread.
 * Uses OffscreenCanvas and ImageBitmap for CPU-bound image rasterization.
 */

class RasterOptimizer {
  constructor(widthCm, gapMm, rotationStepDeg, precisionMm, fixedLengthCm = null, autoFill = false) {
    this.widthCm = widthCm;
    this.gapCm = (gapMm / 2) / 10;
    this.rotationStepDeg = rotationStepDeg; // e.g. 0, 90, 45, 15, 5
    this.cellSizeCm = precisionMm / 10; // e.g. 2mm = 0.2cm
    this.fixedLengthCm = fixedLengthCm;
    this.autoFill = autoFill;
    
    // Grid dimensions
    this.sheetWidthCells = Math.ceil(this.widthCm / this.cellSizeCm);
    this.gapCells = Math.ceil(this.gapCm / this.cellSizeCm);
    this.fixedLengthCells = fixedLengthCm ? Math.ceil(fixedLengthCm / this.cellSizeCm) : Infinity;
    
    // Dynamic sheet mask (1D array for speed)
    this.sheetHeightCells = fixedLengthCm ? this.fixedLengthCells : 2000; 
    this.sheetMask = new Uint8Array(this.sheetWidthCells * this.sheetHeightCells);
    
    // Cached canvas for image rasterization (using OffscreenCanvas in Web Worker)
    this.tempCanvas = new OffscreenCanvas(1, 1);
    this.firstNotFullY = 0;
  }

  expandSheet(newHeightCells) {
    if (this.fixedLengthCm && newHeightCells > this.fixedLengthCells) {
      newHeightCells = this.fixedLengthCells;
    }
    if (newHeightCells <= this.sheetHeightCells) return;

    const newMask = new Uint8Array(this.sheetWidthCells * newHeightCells);
    newMask.set(this.sheetMask);
    this.sheetMask = newMask;
    this.sheetHeightCells = newHeightCells;
  }

  /**
   * Generates a boolean mask for an image bitmap at a specific rotation angle.
   */
  async generateItemMask(imgBitmap, targetWidthCm, targetHeightCm, angleDeg) {
    return new Promise((resolve) => {
      const angleRad = angleDeg * Math.PI / 180;
      
      const wCells = targetWidthCm / this.cellSizeCm;
      const hCells = targetHeightCm / this.cellSizeCm;
      
      const corners = [
        { x: -wCells/2, y: -hCells/2 },
        { x: wCells/2, y: -hCells/2 },
        { x: wCells/2, y: hCells/2 },
        { x: -wCells/2, y: hCells/2 }
      ];
      
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      
      for (const c of corners) {
        const rx = c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad);
        const ry = c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad);
        minX = Math.min(minX, rx);
        maxX = Math.max(maxX, rx);
        minY = Math.min(minY, ry);
        maxY = Math.max(maxY, ry);
      }
      
      const canvasW = Math.ceil(maxX - minX);
      const canvasH = Math.ceil(maxY - minY);
      
      const cx = -minX;
      const cy = -minY;
      
      const canvas = this.tempCanvas;
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);
      ctx.drawImage(imgBitmap, -wCells/2, -hCells/2, wCells, hCells);
      
      let imgData;
      try {
        imgData = ctx.getImageData(0, 0, canvasW, canvasH);
      } catch (e) {
        console.error("Error getting image data from OffscreenCanvas", e);
        resolve({
          width: canvasW, height: canvasH,
          data: new Uint8Array(canvasW * canvasH).fill(1),
          activePixels: [{ x: 0, y: 0 }],
          relativeIndices: new Int32Array([0]),
          offsetX: cx, offsetY: cy
        });
        return;
      }
      
      const data = imgData.data;
      const rawMask = new Uint8Array(canvasW * canvasH);
      
      for (let y = 0; y < canvasH; y++) {
        const rowOffset = y * canvasW;
        for (let x = 0; x < canvasW; x++) {
          const alpha = data[(rowOffset + x) * 4 + 3];
          if (alpha > 10) {
            rawMask[rowOffset + x] = 1;
          }
        }
      }
      
      let dilatedMask = rawMask;
      if (this.gapCells > 0) {
        dilatedMask = new Uint8Array(canvasW * canvasH);
        const r = this.gapCells;
        const rSq = r * r;
        
        // Precompute circular horizontal spans
        const circleSpans = new Int32Array(2 * r + 1);
        for (let dy = -r; dy <= r; dy++) {
          circleSpans[dy + r] = Math.floor(Math.sqrt(rSq - dy * dy));
        }
        
        // Outline-only dilation
        for (let y = 0; y < canvasH; y++) {
          const rowOffset = y * canvasW;
          for (let x = 0; x < canvasW; x++) {
            if (rawMask[rowOffset + x] === 1) {
              const isBoundary = 
                x === 0 || x === canvasW - 1 || 
                y === 0 || y === canvasH - 1 ||
                rawMask[rowOffset + x - 1] === 0 ||
                rawMask[rowOffset + x + 1] === 0 ||
                rawMask[rowOffset - canvasW + x] === 0 ||
                rawMask[rowOffset + canvasW + x] === 0;
                
              if (isBoundary) {
                const startY = Math.max(0, y - r);
                const endY = Math.min(canvasH - 1, y + r);
                for (let ny = startY; ny <= endY; ny++) {
                  const dy = ny - y;
                  const maxXDist = circleSpans[dy + r];
                  const startX = Math.max(0, x - maxXDist);
                  const endX = Math.min(canvasW - 1, x + maxXDist);
                  
                  const targetRowOffset = ny * canvasW;
                  for (let nx = startX; nx <= endX; nx++) {
                    dilatedMask[targetRowOffset + nx] = 1;
                  }
                }
              } else {
                dilatedMask[rowOffset + x] = 1;
              }
            }
          }
        }
      }
      
      let tightMinX = canvasW, tightMaxX = -1;
      let tightMinY = canvasH, tightMaxY = -1;
      
      for (let y = 0; y < canvasH; y++) {
        const rowOffset = y * canvasW;
        for (let x = 0; x < canvasW; x++) {
          if (dilatedMask[rowOffset + x] === 1) {
            tightMinX = Math.min(tightMinX, x);
            tightMaxX = Math.max(tightMaxX, x);
            tightMinY = Math.min(tightMinY, y);
            tightMaxY = Math.max(tightMaxY, y);
          }
        }
      }
      
      if (tightMaxX === -1) {
        resolve({
          width: 1, height: 1,
          data: new Uint8Array([1]),
          activePixels: [{ x: 0, y: 0 }],
          relativeIndices: new Int32Array([0]),
          offsetX: 0, offsetY: 0
        });
        return;
      }
      
      const tightW = tightMaxX - tightMinX + 1;
      const tightH = tightMaxY - tightMinY + 1;
      const tightMask = new Uint8Array(tightW * tightH);
      
      const activePixels = [];
      const relativeIndices = [];
      
      for (let y = 0; y < tightH; y++) {
        const sourceRowOffset = (tightMinY + y) * canvasW;
        const targetRowOffset = y * tightW;
        for (let x = 0; x < tightW; x++) {
          const val = dilatedMask[sourceRowOffset + (tightMinX + x)];
          tightMask[targetRowOffset + x] = val;
          if (val === 1) {
            activePixels.push({ x, y });
            relativeIndices.push(y * this.sheetWidthCells + x);
          }
        }
      }
      
      resolve({
        width: tightW,
        height: tightH,
        data: tightMask,
        activePixels: activePixels,
        relativeIndices: new Int32Array(relativeIndices),
        offsetX: cx - tightMinX,
        offsetY: cy - tightMinY
      });
    });
  }

  async pregenerateMasksForShape(shape) {
    const angles = [0];
    if (this.rotationStepDeg > 0) {
      for (let a = this.rotationStepDeg; a < 360; a += this.rotationStepDeg) {
        angles.push(a);
      }
    }
    
    const angleInfos = [];
    let totalWidth = 0;
    let maxH = 0;
    
    const wCells = shape.targetWidthCm / this.cellSizeCm;
    const hCells = shape.targetHeightCm / this.cellSizeCm;
    
    for (const angle of angles) {
      const angleRad = angle * Math.PI / 180;
      const corners = [
        { x: -wCells/2, y: -hCells/2 },
        { x: wCells/2, y: -hCells/2 },
        { x: wCells/2, y: hCells/2 },
        { x: -wCells/2, y: hCells/2 }
      ];
      
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      
      for (const c of corners) {
        const rx = c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad);
        const ry = c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad);
        minX = Math.min(minX, rx);
        maxX = Math.max(maxX, rx);
        minY = Math.min(minY, ry);
        maxY = Math.max(maxY, ry);
      }
      
      const canvasW = Math.ceil(maxX - minX);
      const canvasH = Math.ceil(maxY - minY);
      
      const cx = -minX;
      const cy = -minY;
      
      angleInfos.push({
        angle,
        width: canvasW,
        height: canvasH,
        cx,
        cy,
        startX: totalWidth
      });
      
      totalWidth += canvasW;
      maxH = Math.max(maxH, canvasH);
    }
    
    const canvas = this.tempCanvas;
    canvas.width = totalWidth;
    canvas.height = maxH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, totalWidth, maxH);
    
    for (const info of angleInfos) {
      ctx.save();
      ctx.translate(info.startX + info.cx, info.cy);
      ctx.rotate(info.angle * Math.PI / 180);
      ctx.drawImage(shape.img, -wCells/2, -hCells/2, wCells, hCells);
      ctx.restore();
    }
    
    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, totalWidth, maxH);
    } catch (e) {
      console.error("Error in pregeneration", e);
      for (const info of angleInfos) {
        shape.masks[info.angle] = {
          width: info.width, height: info.height,
          data: new Uint8Array(info.width * info.height).fill(1),
          activePixels: [{ x: 0, y: 0 }],
          relativeIndices: new Int32Array([0]),
          offsetX: info.cx, offsetY: info.cy
        };
      }
      return;
    }
    
    const largeData = imgData.data;
    
    for (const info of angleInfos) {
      const canvasW = info.width;
      const canvasH = info.height;
      const startX = info.startX;
      
      const rawMask = new Uint8Array(canvasW * canvasH);
      for (let y = 0; y < canvasH; y++) {
        const largeRowOffset = y * totalWidth;
        const targetRowOffset = y * canvasW;
        for (let x = 0; x < canvasW; x++) {
          const alpha = largeData[(largeRowOffset + startX + x) * 4 + 3];
          if (alpha > 10) {
            rawMask[targetRowOffset + x] = 1;
          }
        }
      }
      
      let dilatedMask = rawMask;
      if (this.gapCells > 0) {
        dilatedMask = new Uint8Array(canvasW * canvasH);
        const r = this.gapCells;
        const rSq = r * r;
        
        const circleSpans = new Int32Array(2 * r + 1);
        for (let dy = -r; dy <= r; dy++) {
          circleSpans[dy + r] = Math.floor(Math.sqrt(rSq - dy * dy));
        }
        
        for (let y = 0; y < canvasH; y++) {
          const rowOffset = y * canvasW;
          for (let x = 0; x < canvasW; x++) {
            if (rawMask[rowOffset + x] === 1) {
              const isBoundary = 
                x === 0 || x === canvasW - 1 || 
                y === 0 || y === canvasH - 1 ||
                rawMask[rowOffset + x - 1] === 0 ||
                rawMask[rowOffset + x + 1] === 0 ||
                rawMask[rowOffset - canvasW + x] === 0 ||
                rawMask[rowOffset + canvasW + x] === 0;
                
              if (isBoundary) {
                const startY = Math.max(0, y - r);
                const endY = Math.min(canvasH - 1, y + r);
                for (let ny = startY; ny <= endY; ny++) {
                  const dy = ny - y;
                  const maxXDist = circleSpans[dy + r];
                  const startX = Math.max(0, x - maxXDist);
                  const endX = Math.min(canvasW - 1, x + maxXDist);
                  
                  const targetRowOffset = ny * canvasW;
                  for (let nx = startX; nx <= endX; nx++) {
                    dilatedMask[targetRowOffset + nx] = 1;
                  }
                }
              } else {
                dilatedMask[rowOffset + x] = 1;
              }
            }
          }
        }
      }
      
      let tightMinX = canvasW, tightMaxX = -1;
      let tightMinY = canvasH, tightMaxY = -1;
      
      for (let y = 0; y < canvasH; y++) {
        const rowOffset = y * canvasW;
        for (let x = 0; x < canvasW; x++) {
          if (dilatedMask[rowOffset + x] === 1) {
            tightMinX = Math.min(tightMinX, x);
            tightMaxX = Math.max(tightMaxX, x);
            tightMinY = Math.min(tightMinY, y);
            tightMaxY = Math.max(tightMaxY, y);
          }
        }
      }
      
      if (tightMaxX === -1) {
        shape.masks[info.angle] = {
          width: 1, height: 1,
          data: new Uint8Array([1]),
          activePixels: [{ x: 0, y: 0 }],
          relativeIndices: new Int32Array([0]),
          offsetX: 0, offsetY: 0
        };
        continue;
      }
      
      const tightW = tightMaxX - tightMinX + 1;
      const tightH = tightMaxY - tightMinY + 1;
      const tightMask = new Uint8Array(tightW * tightH);
      
      const activePixels = [];
      const relativeIndices = [];
      
      for (let y = 0; y < tightH; y++) {
        const sourceRowOffset = (tightMinY + y) * canvasW;
        const targetRowOffset = y * tightW;
        for (let x = 0; x < tightW; x++) {
          const val = dilatedMask[sourceRowOffset + (tightMinX + x)];
          tightMask[targetRowOffset + x] = val;
          if (val === 1) {
            activePixels.push({ x, y });
            relativeIndices.push(y * this.sheetWidthCells + x);
          }
        }
      }
      
      shape.masks[info.angle] = {
        width: tightW,
        height: tightH,
        data: tightMask,
        activePixels: activePixels,
        relativeIndices: new Int32Array(relativeIndices),
        offsetX: info.cx - tightMinX,
        offsetY: info.cy - tightMinY
      };
    }
  }

  checkOverlap(mask, startX, startY) {
    if (startX < 0 || startX + mask.width > this.sheetWidthCells) return true;
    
    // Hard boundary check
    if (startY + mask.height > this.fixedLengthCells) return true;
    
    if (startY + mask.height > this.sheetHeightCells) {
      this.expandSheet(Math.max(this.sheetHeightCells * 2, startY + mask.height + 100));
    }
    
    const sheetBaseIndex = startY * this.sheetWidthCells + startX;
    const relativeIndices = mask.relativeIndices;
    const len = relativeIndices.length;
    const sheetMask = this.sheetMask;
    
    for (let i = 0; i < len; i++) {
      if (sheetMask[sheetBaseIndex + relativeIndices[i]] === 1) {
        return true; // Collision
      }
    }
    return false; // No collision
  }

  stampMask(mask, startX, startY) {
    const sheetBaseIndex = startY * this.sheetWidthCells + startX;
    const relativeIndices = mask.relativeIndices;
    const len = relativeIndices.length;
    const sheetMask = this.sheetMask;
    
    for (let i = 0; i < len; i++) {
      sheetMask[sheetBaseIndex + relativeIndices[i]] = 1;
    }
  }

  updateFirstNotFullY() {
    const width = this.sheetWidthCells;
    const mask = this.sheetMask;
    let y = this.firstNotFullY || 0;
    
    while (y < this.sheetHeightCells) {
      const rowOffset = y * width;
      let rowFull = true;
      for (let x = 0; x < width; x++) {
        if (mask[rowOffset + x] === 0) {
          rowFull = false;
          break;
        }
      }
      if (!rowFull) {
        break;
      }
      y++;
    }
    this.firstNotFullY = y;
  }

  /**
   * Attempts to place a single shape using Coarse-to-Fine scanning.
   * Returns the placement object or null if it doesn't fit.
   */
  async tryPlaceShape(shape, currentMaxSheetY) {
    const angles = [0];
    if (this.rotationStepDeg > 0) {
      for (let a = this.rotationStepDeg; a < 360; a += this.rotationStepDeg) {
        angles.push(a);
      }
    }
    
    let bestX = -1;
    let bestY = Infinity;
    let bestAngle = 0;
    let bestMask = null;

    this.updateFirstNotFullY();
    
    // Dynamic coarse scan step calculation based on grid cell size
    // For 1mm grid (cellSize = 0.1cm), we use a coarse step of 4 cells (4mm).
    // For 2mm grid (cellSize = 0.2cm), we use 2 cells (4mm).
    // Otherwise 1 cell.
    let coarseStep = 1;
    if (this.cellSizeCm <= 0.1) {
      coarseStep = 4;
    } else if (this.cellSizeCm <= 0.2) {
      coarseStep = 2;
    }

    for (const angle of angles) {
      let mask = shape.masks[angle];
      if (!mask) {
        mask = await this.generateItemMask(shape.img, shape.targetWidthCm, shape.targetHeightCm, angle);
        shape.masks[angle] = mask;
      }

      let foundForAngle = false;
      
      // Scanning Y limits
      let searchLimitY = this.fixedLengthCm ? this.fixedLengthCells - mask.height : currentMaxSheetY + mask.height + 1;
      
      if (bestY !== Infinity) {
        searchLimitY = Math.min(searchLimitY, bestY);
      }
      
      const startScanY = Math.max(0, this.firstNotFullY - mask.height + 1);
      const limitX = this.sheetWidthCells - mask.width;

      // 1. Coarse Scan Phase
      for (let y = startScanY; y <= searchLimitY; y += coarseStep) {
        if (foundForAngle) break;
        
        for (let x = 0; x <= limitX; x += coarseStep) {
          if (!this.checkOverlap(mask, x, y)) {
            
            // 2. Fine Refinement Phase (Local search around candidate coordinate)
            let refinedX = x;
            let refinedY = y;
            let localBestY = y;
            let localBestX = x;
            let foundRefined = false;

            const ryStart = Math.max(startScanY, y - coarseStep + 1);
            const ryEnd = Math.min(searchLimitY, y + coarseStep - 1);
            const rxStart = Math.max(0, x - coarseStep + 1);
            const rxEnd = Math.min(limitX, x + coarseStep - 1);

            for (let ry = ryStart; ry <= ryEnd; ry++) {
              for (let rx = rxStart; rx <= rxEnd; rx++) {
                if (!this.checkOverlap(mask, rx, ry)) {
                  if (ry < localBestY || (ry === localBestY && rx < localBestX)) {
                    localBestY = ry;
                    localBestX = rx;
                    foundRefined = true;
                  }
                }
              }
            }

            const finalX = foundRefined ? localBestX : x;
            const finalY = foundRefined ? localBestY : y;

            if (finalY < bestY || (finalY === bestY && finalX < bestX)) {
              bestY = finalY;
              bestX = finalX;
              bestAngle = angle;
              bestMask = mask;
            }
            foundForAngle = true;
            break; 
          }
        }
      }
    }

    if (bestMask) {
      this.stampMask(bestMask, bestX, bestY);
      const centerXCm = (bestX + bestMask.offsetX) * this.cellSizeCm;
      const centerYCm = (bestY + bestMask.offsetY) * this.cellSizeCm;
      
      return {
        parentImageId: shape.parentImageId,
        targetWidthCm: shape.targetWidthCm,
        targetHeightCm: shape.targetHeightCm,
        centerX: centerXCm,
        centerY: centerYCm,
        angle: bestAngle,
        w: bestMask.width * this.cellSizeCm,
        h: bestMask.height * this.cellSizeCm,
        x: bestX * this.cellSizeCm,
        y: bestY * this.cellSizeCm,
        isAutoFilled: shape.isAutoFilled || false
      };
    }
    
    return null;
  }
}

// Worker message routing
self.onmessage = async function(e) {
  const { action, shapes, config } = e.data;
  
  if (action === 'start') {
    const optimizer = new RasterOptimizer(
      config.sheetWidthCm,
      config.gapMm,
      config.rotationStepDeg,
      config.precisionMm,
      config.fixedLengthCm,
      config.autoFill
    );
    
    const uniqueShapes = [];
    const shapesToPack = [];
    
    for (const imgItem of shapes) {
      const baseShape = {
        parentImageId: imgItem.id,
        name: imgItem.name,
        img: imgItem.bitmap, // ImageBitmap transferred from main thread
        targetWidthCm: imgItem.targetWidthCm,
        targetHeightCm: imgItem.targetHeightCm,
        masks: {} 
      };
      uniqueShapes.push(baseShape);
      
      for (let q = 0; q < imgItem.quantity; q++) {
        shapesToPack.push({ ...baseShape, copyIndex: q, isAutoFilled: false });
      }
    }
    
    // Sort descending by maximum dimension
    shapesToPack.sort((a, b) => {
      const maxA = Math.max(a.targetWidthCm, a.targetHeightCm);
      const maxB = Math.max(b.targetWidthCm, b.targetHeightCm);
      return maxB - maxA;
    });

    const placedItems = [];
    let currentMaxSheetY = 0;
    
    // Pregenerate masks for all unique shapes
    for (let i = 0; i < uniqueShapes.length; i++) {
      await optimizer.pregenerateMasksForShape(uniqueShapes[i]);
      // Update progress during pregeneration
      const pregenPercent = Math.round((i / uniqueShapes.length) * 10); // First 10%
      self.postMessage({ action: 'progress', placedItems: [], percentage: pregenPercent });
    }

    // Packing mandatory items
    for (let i = 0; i < shapesToPack.length; i++) {
      const shape = shapesToPack[i];
      const placement = await optimizer.tryPlaceShape(shape, currentMaxSheetY);
      
      if (placement) {
        placedItems.push(placement);
        currentMaxSheetY = Math.max(currentMaxSheetY, (placement.y + placement.h) / optimizer.cellSizeCm);
      }
      
      const progressPercent = config.autoFill && config.fixedLengthCm ? 
          10 + Math.round((i / shapesToPack.length) * 45) : // Mandatory phase is 10% to 55%
          10 + Math.round((i / shapesToPack.length) * 90);  // Mandatory phase is 10% to 100%
          
      self.postMessage({ action: 'progress', placedItems, percentage: progressPercent });
    }

    // Auto-fill phase (if enabled and sheet length is fixed)
    if (config.fixedLengthCm && config.autoFill) {
      // Sort unique shapes by area descending for auto-fill priority
      const autoFillCandidates = [...uniqueShapes].sort((a, b) => {
        return (b.targetWidthCm * b.targetHeightCm) - (a.targetWidthCm * a.targetHeightCm);
      });
      
      let autoFillIndex = 0;
      let autoFillCount = 0;
      const initialPlacedLength = placedItems.length;
      
      while (autoFillCandidates.length > 0) {
        const baseShape = autoFillCandidates[autoFillIndex];
        const shapeToFill = { ...baseShape, isAutoFilled: true };
        
        const placement = await optimizer.tryPlaceShape(shapeToFill, currentMaxSheetY);
        
        if (placement) {
          placedItems.push(placement);
          currentMaxSheetY = Math.max(currentMaxSheetY, (placement.y + placement.h) / optimizer.cellSizeCm);
          autoFillCount++;
        } else {
          // If shape doesn't fit anymore, remove it from candidate pool
          autoFillCandidates.splice(autoFillIndex, 1);
        }
        
        // Progress for auto-fill increases asymptotically towards 99%
        const autoFillPercent = 55 + Math.min(44, Math.round(autoFillCount / (shapesToPack.length || 1) * 20));
        self.postMessage({ action: 'progress', placedItems, percentage: autoFillPercent });
      }
    }

    // Final completion message
    self.postMessage({ action: 'complete', placedItems });
  }
};
