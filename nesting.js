/**
 * DTF Smart Nest - Raster-based True Irregular Shape Nesting
 * Uses a pixel/grid-based approach to find optimal placements for irregular shapes at any angle.
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
    // Start with a reasonable height or the fixed height
    this.sheetHeightCells = fixedLengthCm ? this.fixedLengthCells : 2000; 
    this.sheetMask = new Uint8Array(this.sheetWidthCells * this.sheetHeightCells);
    
    // Cached canvas for image rasterization
    this.tempCanvas = document.createElement('canvas');
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
   * Generates a boolean mask for an image at a specific rotation angle.
   */
  async generateItemMask(img, targetWidthCm, targetHeightCm, angleDeg) {
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
      ctx.drawImage(img, -wCells/2, -hCells/2, wCells, hCells);
      
      let imgData;
      try {
        imgData = ctx.getImageData(0, 0, canvasW, canvasH);
      } catch (e) {
        console.error("CORS error getting image data", e);
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
      console.error("CORS error in pregeneration", e);
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
   * Attempts to place a single shape. Returns the placement object or null if it doesn't fit.
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
    const scanStep = this.cellSizeCm <= 0.1 ? 2 : 1;

    for (const angle of angles) {
      let mask = shape.masks[angle];
      if (!mask) {
        mask = await this.generateItemMask(shape.img, shape.targetWidthCm, shape.targetHeightCm, angle);
        shape.masks[angle] = mask;
      }

      let foundForAngle = false;
      
      // If fixed length, we can scan up to the limit. 
      // Otherwise, scan up to the current max + some buffer to avoid scanning infinitely.
      let searchLimitY = this.fixedLengthCm ? this.fixedLengthCells - mask.height : currentMaxSheetY + mask.height + 1;
      
      // If we already found a placement, we don't need to scan past bestY
      if (bestY !== Infinity) {
        searchLimitY = Math.min(searchLimitY, bestY);
      }
      
      const startScanY = Math.max(0, this.firstNotFullY - mask.height + 1);
      
      for (let y = startScanY; y <= searchLimitY; y += scanStep) {
        if (foundForAngle) break;
        
        for (let x = 0; x <= this.sheetWidthCells - mask.width; x += scanStep) {
          if (!this.checkOverlap(mask, x, y)) {
            if (y < bestY || (y === bestY && x < bestX)) {
              bestY = y;
              bestX = x;
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

  async optimizeAsync(imageList, onStep, onComplete) {
    const uniqueShapes = [];
    const shapesToPack = [];
    
    for (const imgItem of imageList) {
      const baseShape = {
        parentImageId: imgItem.id,
        name: imgItem.name,
        img: imgItem.img,
        targetWidthCm: imgItem.targetWidthCm,
        targetHeightCm: imgItem.targetHeightCm,
        masks: {} 
      };
      uniqueShapes.push(baseShape);
      
      for (let q = 0; q < imgItem.quantity; q++) {
        shapesToPack.push({ ...baseShape, copyIndex: q, isAutoFilled: false });
      }
    }
    
    shapesToPack.sort((a, b) => {
      const maxA = Math.max(a.targetWidthCm, a.targetHeightCm);
      const maxB = Math.max(b.targetWidthCm, b.targetHeightCm);
      return maxB - maxA;
    });

    const placedItems = [];
    let currentShapeIndex = 0;
    let currentMaxSheetY = 0;
    
    // State machine: 0 = mandatory quota, 1 = auto-fill
    let phase = 0; 
    let autoFillCandidates = [];
    let autoFillIndex = 0;

    // Pregenerate masks for all unique shapes
    for (const shape of uniqueShapes) {
      await this.pregenerateMasksForShape(shape);
      await new Promise(resolve => setTimeout(resolve, 0)); // Yield to paint loading state
    }

    const step = async () => {
      const frameStart = performance.now();
      
      while (performance.now() - frameStart < 30) {
        if (phase === 0) {
          if (currentShapeIndex >= shapesToPack.length) {
            // Move to Auto-Fill phase if enabled
            if (this.fixedLengthCm && this.autoFill) {
              phase = 1;
              // Sort unique shapes by area descending for auto-fill priority
              autoFillCandidates = [...uniqueShapes].sort((a, b) => {
                return (b.targetWidthCm * b.targetHeightCm) - (a.targetWidthCm * a.targetHeightCm);
              });
              continue;
            } else {
              onStep(placedItems, 100);
              onComplete(placedItems);
              return;
            }
          }

          const shape = shapesToPack[currentShapeIndex];
          const placement = await this.tryPlaceShape(shape, currentMaxSheetY);
          
          if (placement) {
            placedItems.push(placement);
            currentMaxSheetY = Math.max(currentMaxSheetY, (placement.y + placement.h) / this.cellSizeCm);
          } else {
            console.warn(`Could not fit mandatory item ${shape.name} into fixed length!`);
          }

          currentShapeIndex++;
          const progressPercent = this.autoFill ? 
              Math.round((currentShapeIndex / shapesToPack.length) * 50) : // Phase 1 is 50%
              Math.round((currentShapeIndex / shapesToPack.length) * 100);
          onStep(placedItems, progressPercent);
          
        } else if (phase === 1) {
          if (autoFillCandidates.length === 0) {
            onStep(placedItems, 100);
            onComplete(placedItems);
            return;
          }

          const baseShape = autoFillCandidates[autoFillIndex];
          const shapeToFill = { ...baseShape, isAutoFilled: true };
          
          const placement = await this.tryPlaceShape(shapeToFill, currentMaxSheetY);
          
          if (placement) {
            placedItems.push(placement);
            currentMaxSheetY = Math.max(currentMaxSheetY, (placement.y + placement.h) / this.cellSizeCm);
            // Don't advance autoFillIndex, try to place same shape again
          } else {
            // This shape doesn't fit anymore, remove it from candidates
            autoFillCandidates.splice(autoFillIndex, 1);
            // Keep autoFillIndex the same (it now points to the next shape)
          }
          
          // Progress for auto-fill is indeterminate, just fake it
          const denom = shapesToPack.length || 1;
          onStep(placedItems, 50 + Math.min(49, Math.round(placedItems.length / denom * 10)));
        }
      }
      
      // If we exit the loop, it means 30ms passed. Yield to the main thread.
      setTimeout(step, 0);
    };

    step();
  }
}
