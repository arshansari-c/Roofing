import PDFDocument from 'pdfkit';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { User } from '../models/auth.model.js';
import { ProjectOrder } from '../models/ProjectOrder.model.js';
import { transporter } from '../util/EmailTransporter.js';
import dotenv from 'dotenv';

dotenv.config();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

// Derive __dirname for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'Uploads');
try {
  await fsPromises.mkdir(uploadsDir, { recursive: true });
  console.log('Uploads directory created or already exists:', uploadsDir);
} catch (err) {
  console.error('Failed to create uploads directory:', err.message);
  throw new Error(`Failed to create uploads directory: ${err.message}`);
}

// Path to company logo
const logoPath = path.join(__dirname, 'assets', 'company.png');

// Configuration constants
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 10;
const CHEVRON_SIZE = 9;
const HOOK_RADIUS = 8;
const ZIGZAG_SIZE = 9;

// Color scheme (black and white only)
const COLORS = {
  primary: '#000000',    // Black for headers
  lightBg: '#FFFFFF',    // White background
  darkText: '#000000',   // Black text
  border: '#000000',     // Black border
};

// Helper function to validate points
const validatePoints = (points) => {
  if (!Array.isArray(points) || points.length === 0) {
    return false;
  }
  return points.every(point => 
    point && 
    typeof point.x !== 'undefined' && 
    typeof point.y !== 'undefined' && 
    !isNaN(parseFloat(point.x)) && 
    !isNaN(parseFloat(point.y))
  );
};

// Helper function to calculate bounds for a path with better precision handling
const calculateBounds = (path, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Invalid points array in path:', path);
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }; // Fallback bounds
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  // Process points with better precision handling
  path.points.forEach((point) => {
    const x = parseFloat(point.x);
    const y = parseFloat(point.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  // For very large diagrams, adjust calculations to prevent overflow
  const isLargeDiagram = (maxX - minX > 10000 || maxY - minY > 10000);

  path.segments.forEach((segment, i) => {
    if (!segment.labelPosition || typeof segment.labelPosition.x === 'undefined' || typeof segment.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 35 / scale);
    maxX = Math.max(maxX, labelX + 35 / scale);
    minY = Math.min(minY, labelY - 20 / scale);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 20 / scale);

    let foldType = 'None';
    let foldLength = FOLD_LENGTH;
    let foldAngle = 0;
    if (typeof segment.fold === 'object' && segment.fold) {
      foldType = segment.fold.type || 'None';
      foldLength = parseFloat(segment.fold.length) || FOLD_LENGTH;
      foldAngle = parseFloat(segment.fold.angle) || 0;
    } else {
      foldType = segment.fold || 'None';
    }

    if (foldType !== 'None') {
      const p1 = path.points[i];
      const p2 = path.points[i + 1];
      if (!p1 || !p2) return;
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length) {
        const unitX = dx / length;
        const unitY = dy / length;
        let normalX = unitY;
        let normalY = -unitX;
        const angleRad = foldAngle * Math.PI / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const rotNormalX = normalX * cosA - normalY * sinA;
        const rotNormalY = normalX * sinA + normalY * cosA;
        const isFirstSegment = i === 0;
        const foldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
        const foldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
        const foldEndX = foldBaseX + rotNormalX * foldLength;
        const foldEndY = foldBaseY + rotNormalY * foldLength;
        // Adjusted for 2 grid space (GRID_SIZE * 2 = 40, added to base offset 25 -> 65)
        const foldLabelX = foldEndX + rotNormalX * (65 / scale);
        const foldLabelY = foldEndY + rotNormalY * (65 / scale);
        minX = Math.min(minX, foldLabelX - 35 / scale, foldEndX, foldBaseX);
        maxX = Math.max(maxX, foldLabelX + 35 / scale, foldEndX, foldBaseX);
        minY = Math.min(minY, foldLabelY - 20 / scale, foldEndY, foldBaseY);
        maxY = Math.max(maxY, foldLabelY + ARROW_SIZE + 20 / scale, foldEndY, foldBaseY);
      }
    }
  });

  (path.angles || []).forEach((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    // Adjusted padding for angles to ensure 2 grid space
    minX = Math.min(minX, labelX - (35 + GRID_SIZE * 2) / scale);
    maxX = Math.max(maxX, labelX + (35 + GRID_SIZE * 2) / scale);
    minY = Math.min(minY, labelY - (20 + GRID_SIZE * 2) / scale);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + (20 + GRID_SIZE * 2) / scale);
  });

  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    offsetSegments.forEach((seg) => {
      minX = Math.min(minX, seg.p1.x, seg.p2.x);
      maxX = Math.max(maxX, seg.p1.x, seg.p2.x);
      minY = Math.min(minY, seg.p1.y, seg.p2.y);
      maxY = Math.max(maxY, seg.p1.y, seg.p2.y);
    });
    const segment = offsetSegments[0];
    if (segment) {
      const midX = (segment.p1.x + segment.p2.x) / 2;
      const midY = (segment.p1.y + segment.p2.y) / 2;
      const origP1 = path.points[0];
      const origP2 = path.points[1];
      if (origP1 && origP2) {
        const dx = parseFloat(origP2.x) - parseFloat(origP1.x);
        const dy = parseFloat(origP2.y) - parseFloat(origP1.y);
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length !== 0) {
          const unitX = dx / length;
          const unitY = dy / length;
          const normalX = borderOffsetDirection === 'inside' ? unitY : -unitY;
          const normalY = borderOffsetDirection === 'inside' ? -unitX : unitX;
          const chevronSize = 8;
          const chevronBaseDistance = 10;
          const chevronX = midX + normalX * chevronBaseDistance;
          const chevronY = midY + normalY * chevronBaseDistance;
          minX = Math.min(minX, chevronX - chevronSize);
          maxX = Math.max(maxX, chevronX + chevronSize);
          minY = Math.min(minY, chevronY - chevronSize);
          maxY = Math.max(maxY, chevronY + chevronSize);
        }
      }
    }
  }

  // For very large diagrams, adjust padding to be proportional
  const padding = isLargeDiagram ? Math.max(100, (maxX - minX) * 0.05) : 50;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
};

// Helper function to calculate offset segments for border
const calculateOffsetSegments = (path, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    return [];
  }
  const offsetDistance = 15;
  const offsetSegments = [];
  for (let i = 0; i < path.points.length - 1; i++) {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    const dx = parseFloat(p2.x) - parseFloat(p1.x);
    const dy = parseFloat(p2.y) - parseFloat(p1.y);
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;

    const unitX = dx / length;
    const unitY = dy / length;
    const normalX = borderOffsetDirection === 'inside' ? unitY : -unitY;
    const normalY = borderOffsetDirection === 'inside' ? -unitX : unitX;

    offsetSegments.push({
      p1: { x: parseFloat(p1.x) + normalX * offsetDistance, y: parseFloat(p1.y) + normalY * offsetDistance },
      p2: { x: parseFloat(p2.x) + normalX * offsetDistance, y: parseFloat(p2.y) + normalY * offsetDistance },
    });
  }
  return offsetSegments;
};

// Helper function to calculate total folds
const calculateTotalFolds = (path) => {
  let totalFolds = (path.angles || []).length;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      let foldType = 'None';
      if (typeof segment.fold === 'object' && segment.fold) {
        foldType = segment.fold.type || 'None';
      } else {
        foldType = segment.fold || 'None';
      }
      if (foldType !== 'None') {
        totalFolds += foldType === 'Crush' ? 2 : 1;
      }
    });
  }
  return totalFolds;
};

// Helper function to calculate girth
const calculateGirth = (path) => {
  let totalLength = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      const lengthStr = segment.length || '0 m';
      // Handle large numbers safely
      const lengthNum = parseFloat(lengthStr.replace(/[^0-9.]/g, '')) || 0;
      totalLength += lengthNum;
    });
  }
  return totalLength.toFixed(2);
};

// Helper function to format Q x L
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  return quantitiesAndLengths.map(item => `${item.quantity}x${parseFloat(item.length).toFixed(0)}`).join(', ');
};

// Helper function to draw header
const drawHeader = (doc, pageWidth, y, pageNumber = null) => {
  const margin = 50;
  
  // Header background
  doc.rect(0, 0, pageWidth, 80)
     .fill(COLORS.primary);
  
  try {
    const logo = doc.openImage(logoPath);
    const logoHeight = 40;
    const logoWidth = (logo.width * logoHeight) / logo.height;
    doc.image(logo, pageWidth - margin - logoWidth, 20, { 
      width: logoWidth, 
      height: logoHeight 
    });
  } catch (err) {
    console.warn('Failed to load logo:', err.message);
  }
  
  // Company name
  doc.font('Helvetica-Bold')
     .fontSize(20)
     .fillColor('#FFFFFF')
     .text('Commercial Roofers Pty Ltd', margin, 30);
  
  // Contact info
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor('#FFFFFF')
     .text('contact@commercialroofers.net.au | 0421259430', margin, 55);
  
  // Page number if provided
  if (pageNumber !== null) {
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#FFFFFF')
       .text(`Page ${pageNumber}`, pageWidth - margin, 55, { align: 'right' });
  }
  
  return y + 90;
};

// Helper function to draw section header
const drawSectionHeader = (doc, text, y) => {
  doc.font('Helvetica-Bold')
     .fontSize(16)
     .fillColor(COLORS.primary)
     .text(text, 50, y);
  
  return y + 30;
};

// Helper function to draw info card
const drawInfoCard = (doc, title, value, x, y, width) => {
  // Card background
  doc.roundedRect(x, y, width, 40, 5)
     .fill(COLORS.lightBg);
  
  // Card border
  doc.roundedRect(x, y, width, 40, 5)
     .strokeColor(COLORS.border)
     .lineWidth(1)
     .stroke();
  
  // Title
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.darkText)
     .text(title, x + 10, y + 8);
  
  // Value
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(COLORS.darkText)
     .text(value, x + 10, y + 22);
  
  return y + 50;
};

// Helper function to draw the diagram directly in PDF
const drawDiagram = (doc, path, bounds, posX, posY, w, h, originalScale, showBorder, borderOffsetDirection) => {
  const diagramW = bounds.maxX - bounds.minX;
  const diagramH = bounds.maxY - bounds.minY;
  const fitScale = Math.min(w / diagramW, h / diagramH);
  const transX = -bounds.minX;
  const transY = -bounds.minY;

  const toPdfCoord = (mx, my) => {
    return {
      x: posX + (mx + transX) * fitScale,
      y: posY + (my + transY) * fitScale
    };
  };

  // Adjusted fixed visual sizes to match frontend (divided by originalScale for consistency)
  const strokeWidth = 2.5 / originalScale;
  const pointR = 3 / originalScale;
  const fontSizeLength = 12 / originalScale;
  const fontSizeAngle = 10 / originalScale;
  const fontSizeFold = 14 / originalScale;
  const rectWidth = 50 / originalScale;
  const rectHeight = 20 / originalScale;
  const rectRx = 10 / originalScale;
  const tailSize = 6 / originalScale;
  const attachSize = 6 / originalScale;
  const gridStroke = 0.2;
  const arrowSize = 10 / originalScale;
  const chevronSizeAdj = 9 / originalScale;
  const hookRadiusAdj = 8 / originalScale;
  const zigzagAdj = 9 / originalScale;

  // Draw grid with dynamic grid size for large diagrams
  let effectiveGridSize = GRID_SIZE;
  const minGridSpacingPdf = 10; // Minimum spacing in PDF points to avoid dense grids
  const minGridSizeDiagram = minGridSpacingPdf / fitScale;
  if (minGridSizeDiagram > GRID_SIZE) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(minGridSizeDiagram)));
    effectiveGridSize = Math.ceil(minGridSizeDiagram / magnitude) * magnitude;
  }

  const gridStartX = Math.floor(bounds.minX / effectiveGridSize) * effectiveGridSize;
  const gridStartY = Math.floor(bounds.minY / effectiveGridSize) * effectiveGridSize;
  const gridEndX = Math.ceil(bounds.maxX / effectiveGridSize) * effectiveGridSize;
  const gridEndY = Math.ceil(bounds.maxY / effectiveGridSize) * effectiveGridSize;

  for (let gx = gridStartX; gx <= gridEndX; gx += effectiveGridSize) {
    const {x: x1, y: y1} = toPdfCoord(gx, bounds.minY);
    const {x: x2, y: y2} = toPdfCoord(gx, bounds.maxY);
    doc.moveTo(x1, y1)
       .lineTo(x2, y2)
       .lineWidth(gridStroke)
       .stroke('#DDDDDD');
  }

  for (let gy = gridStartY; gy <= gridEndY; gy += effectiveGridSize) {
    const {x: x1, y: y1} = toPdfCoord(bounds.minX, gy);
    const {x: x2, y: y2} = toPdfCoord(bounds.maxX, gy);
    doc.moveTo(x1, y1)
       .lineTo(x2, y2)
       .lineWidth(gridStroke)
       .stroke('#DDDDDD');
  }

  // Draw points
  path.points.forEach(point => {
    const {x: px, y: py} = toPdfCoord(point.x, point.y);
    doc.circle(px, py, pointR)
       .fill(COLORS.darkText);
  });

  // Draw main path lines
  if (path.points.length > 1) {
    let pathStr = '';
    path.points.forEach((p, idx) => {
      const {x: px, y: py} = toPdfCoord(p.x, p.y);
      pathStr += `${idx === 0 ? 'M' : 'L'} ${px} ${py} `;
    });
    doc.path(pathStr)
       .lineWidth(strokeWidth)
       .stroke(COLORS.darkText);
  }

  // Draw border offset lines
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    offsetSegments.forEach(seg => {
      const {x: x1, y: y1} = toPdfCoord(seg.p1.x, seg.p1.y);
      const {x: x2, y: y2} = toPdfCoord(seg.p2.x, seg.p2.y);
      doc.moveTo(x1, y1)
         .lineTo(x2, y2)
         .lineWidth(strokeWidth * 1.2)
         .dash(6 / originalScale, {space: 4 / originalScale})
         .stroke(COLORS.darkText);
    });

    // Border chevron
    const segment = offsetSegments[0];
    if (segment) {
      const midX = (segment.p1.x + segment.p2.x) / 2;
      const midY = (segment.p1.y + segment.p2.y) / 2;
      const origP1 = path.points[0];
      const origP2 = path.points[1];
      if (origP1 && origP2) {
        const dx = parseFloat(origP2.x) - parseFloat(origP1.x);
        const dy = parseFloat(origP2.y) - parseFloat(origP1.y);
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length !== 0) {
          const unitX = dx / length;
          const unitY = dy / length;
          const normalX = borderOffsetDirection === 'inside' ? unitY : -unitY;
          const normalY = borderOffsetDirection === 'inside' ? -unitX : unitX;
          const chevronBaseDistance = 10;
          const {x: chevronX, y: chevronY} = toPdfCoord(midX + normalX * chevronBaseDistance, midY + normalY * chevronBaseDistance);
          const direction = 1;
          doc.moveTo(chevronX + chevronSizeAdj * normalX * direction + chevronSizeAdj * unitX, chevronY + chevronSizeAdj * normalY * direction + chevronSizeAdj * unitY)
             .lineTo(chevronX, chevronY)
             .lineTo(chevronX + chevronSizeAdj * normalX * direction - chevronSizeAdj * unitX, chevronY + chevronSizeAdj * normalY * direction - chevronSizeAdj * unitY)
             .lineWidth(strokeWidth)
             .stroke(COLORS.darkText);
        }
      }
    }
  }

  // Draw segment labels and folds
  path.segments.forEach((segment, i) => {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    if (!p1 || !p2 || !segment.labelPosition) return;

    const {x: posX, y: posY} = toPdfCoord(segment.labelPosition.x, segment.labelPosition.y);
    const {x: p1x, y: p1y} = toPdfCoord(p1.x, p1.y);
    const {x: p2x, y: p2y} = toPdfCoord(p2.x, p2.y);
    const midX = (p1x + p2x) / 2;
    const midY = (p1y + p2y) / 2;

    // Length label box
    doc.roundedRect(posX - rectWidth / 2, posY - rectHeight / 2, rectWidth, rectHeight, rectRx)
       .fillOpacity(0.9)
       .fill(COLORS.lightBg)
       .lineWidth(0.5 / originalScale)
       .stroke(COLORS.border);

    // Length text
    doc.fontSize(fontSizeLength)
       .fillColor(COLORS.darkText)
       .text(segment.length, posX - rectWidth / 2, posY - fontSizeLength / 2 + rectHeight / 2, {
         width: rectWidth,
         align: 'center'
       });

    // Length tail
    const labelDx = midX - posX;
    const labelDy = midY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        const baseX = posX - rectWidth / 2;
        const tipX = baseX - tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        doc.moveTo(baseX, topBaseY)
           .lineTo(baseX, bottomBaseY)
           .lineTo(tipX, posY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      } else {
        const baseX = posX + rectWidth / 2;
        const tipX = baseX + tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        doc.moveTo(baseX, topBaseY)
           .lineTo(baseX, bottomBaseY)
           .lineTo(tipX, posY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      }
    } else {
      if (labelDy < 0) {
        const baseY = posY - rectHeight / 2;
        const tipY = baseY - tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        doc.moveTo(leftBaseX, baseY)
           .lineTo(rightBaseX, baseY)
           .lineTo(posX, tipY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      } else {
        const baseY = posY + rectHeight / 2;
        const tipY = baseY + tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        doc.moveTo(leftBaseX, baseY)
           .lineTo(rightBaseX, baseY)
           .lineTo(posX, tipY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      }
    }

    // Fold drawing
    let foldType = 'None';
    let foldLength = FOLD_LENGTH;
    let foldAngle = 0;
    if (typeof segment.fold === 'object' && segment.fold) {
      foldType = segment.fold.type || 'None';
      foldLength = parseFloat(segment.fold.length) || FOLD_LENGTH;
      foldAngle = parseFloat(segment.fold.angle) || 0;
    } else {
      foldType = segment.fold || 'None';
    }

    if (foldType !== 'None') {
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length) {
        const unitX = dx / length;
        const unitY = dy / length;
        let normalX = unitY;
        let normalY = -unitX;
        const angleRad = foldAngle * Math.PI / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const rotNormalX = normalX * cosA - normalY * sinA;
        const rotNormalY = normalX * sinA + normalY * cosA;
        const isFirstSegment = i === 0;
        const foldBase = toPdfCoord(
          isFirstSegment ? p1.x : p2.x,
          isFirstSegment ? p1.y : p2.y
        );
        const foldEnd = toPdfCoord(
          (isFirstSegment ? p1.x : p2.x) + rotNormalX * foldLength,
          (isFirstSegment ? p1.y : p2.y) + rotNormalY * foldLength
        );
        // Adjusted for 2 grid space (65 / originalScale)
        const foldLabelPos = toPdfCoord(
          (isFirstSegment ? p1.x : p2.x) + rotNormalX * (foldLength + 65 / originalScale),
          (isFirstSegment ? p1.y : p2.y) + rotNormalY * (foldLength + 65 / originalScale)
        );
        const foldColor = COLORS.darkText;

        // Draw fold based on type
        if (foldType === 'Crush') {
          const chevron1 = foldEnd;
          const chevron2 = toPdfCoord(
            (isFirstSegment ? p1.x : p2.x) + rotNormalX * (foldLength - 3),
            (isFirstSegment ? p1.y : p2.y) + rotNormalY * (foldLength - 3)
          );
          doc.moveTo(chevron1.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * unitX, chevron1.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * unitY)
             .lineTo(chevron1.x, chevron1.y)
             .lineTo(chevron1.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * unitX, chevron1.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * unitY)
             .moveTo(chevron2.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * unitX, chevron2.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * unitY)
             .lineTo(chevron2.x, chevron2.y)
             .lineTo(chevron2.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * unitX, chevron2.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * unitY)
             .lineWidth(strokeWidth)
             .stroke(foldColor);
        } else if (foldType === 'Crush Hook') {
          doc.moveTo(foldBase.x, foldBase.y)
             .lineTo(foldEnd.x, foldEnd.y);
          // Approximate arc with bezier
          const controlX = foldEnd.x + hookRadiusAdj * rotNormalX;
          const controlY = foldEnd.y + hookRadiusAdj * rotNormalY;
          doc.bezierCurveTo(
            controlX, controlY,
            foldEnd.x + hookRadiusAdj * unitX, foldEnd.y + hookRadiusAdj * unitY,
            foldEnd.x + hookRadiusAdj * unitX, foldEnd.y + hookRadiusAdj * unitY
          )
             .lineWidth(strokeWidth)
             .stroke(foldColor);
        } else if (foldType === 'Break') {
          const mid = toPdfCoord(
            (isFirstSegment ? p1.x : p2.x) + rotNormalX * (foldLength / 2),
            (isFirstSegment ? p1.y : p2.y) + rotNormalY * (foldLength / 2)
          );
          doc.moveTo(foldBase.x, foldBase.y)
             .lineTo(mid.x + zigzagAdj * unitX, mid.y + zigzagAdj * unitY)
             .lineTo(mid.x - zigzagAdj * unitX, mid.y - zigzagAdj * unitY)
             .lineTo(foldEnd.x, foldEnd.y)
             .lineWidth(strokeWidth)
             .stroke(foldColor);
        } else if (foldType === 'Open') {
          doc.moveTo(foldBase.x, foldBase.y)
             .lineTo(foldEnd.x, foldEnd.y)
             .lineWidth(strokeWidth)
             .stroke(foldColor);
        }

        // Fold label text (no box, centered like in frontend SVGText)
        doc.fontSize(fontSizeFold)
           .fillColor(foldColor);
        const textWidth = doc.widthOfString(foldType);
        doc.text(foldType, foldLabelPos.x - textWidth / 2, foldLabelPos.y - fontSizeFold / 2);

        // Fold arrow (adjusted position for space)
        const arrowX = foldLabelPos.x;
        const arrowY = foldLabelPos.y + 20 / originalScale;
        const arrowDx = foldBase.x - arrowX;
        const arrowDy = foldBase.y - arrowY;
        const arrowDist = Math.sqrt(arrowDx * arrowDx + arrowDy * arrowDy) || 1;
        const arrowUnitX = arrowDx / arrowDist;
        const arrowUnitY = arrowDy / arrowDist;
        doc.moveTo(arrowX - arrowUnitX * arrowSize, arrowY - arrowUnitY * arrowSize)
           .lineTo(arrowX, arrowY)
           .lineTo(arrowX - arrowUnitX * arrowSize + arrowUnitY * arrowSize * 0.5, arrowY - arrowUnitY * arrowSize - arrowUnitX * arrowSize * 0.5)
           .lineWidth(0.5 / originalScale)
           .fill(foldColor)
           .stroke(foldColor);
      }
    }
  });

  // Draw angle labels
  path.angles.forEach(angle => {
    if (!angle.labelPosition) return;

    const {x: posX, y: posY} = toPdfCoord(angle.labelPosition.x, angle.labelPosition.y);
    const vertexIndex = angle.vertexIndex;
    const p2 = path.points[vertexIndex];
    if (!p2) return;
    const {x: targetX, y: targetY} = toPdfCoord(p2.x, p2.y);

    // Angle label box
    doc.roundedRect(posX - rectWidth / 2, posY - rectHeight / 2, rectWidth, rectHeight, rectRx)
       .fillOpacity(0.9)
       .fill(COLORS.lightBg)
       .lineWidth(0.5 / originalScale)
       .stroke(COLORS.border);

    // Angle text
    doc.fontSize(fontSizeAngle)
       .fillColor(COLORS.darkText)
       .text(angle.angle, posX - rectWidth / 2, posY - fontSizeAngle / 2 + rectHeight / 2, {
         width: rectWidth,
         align: 'center'
       });

    // Angle tail
    const labelDx = targetX - posX;
    const labelDy = targetY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        const baseX = posX - rectWidth / 2;
        const tipX = baseX - tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        doc.moveTo(baseX, topBaseY)
           .lineTo(baseX, bottomBaseY)
           .lineTo(tipX, posY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      } else {
        const baseX = posX + rectWidth / 2;
        const tipX = baseX + tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        doc.moveTo(baseX, topBaseY)
           .lineTo(baseX, bottomBaseY)
           .lineTo(tipX, posY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      }
    } else {
      if (labelDy < 0) {
        const baseY = posY - rectHeight / 2;
        const tipY = baseY - tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        doc.moveTo(leftBaseX, baseY)
           .lineTo(rightBaseX, baseY)
           .lineTo(posX, tipY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      } else {
        const baseY = posY + rectHeight / 2;
        const tipY = baseY + tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        doc.moveTo(leftBaseX, baseY)
           .lineTo(rightBaseX, baseY)
           .lineTo(posX, tipY)
           .closePath()
           .fillOpacity(0.9)
           .fill(COLORS.lightBg);
      }
    }
  });
};

export const generatePdf = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems, emails } = req.body;
    const { userId } = req.params;

    // Validate inputs
    if (!JobReference || !Number || !OrderContact || !OrderDate) {
      return res.status(400).json({ message: 'JobReference, Number, OrderContact, and OrderDate are required' });
    }
    if (!DeliveryAddress && !PickupNotes) {
      return res.status(400).json({ message: 'Either DeliveryAddress or PickupNotes is required' });
    }
    if (DeliveryAddress && PickupNotes) {
      return res.status(400).json({ message: 'Provide either DeliveryAddress or PickupNotes, not both' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Valid userId is required' });
    }

    // Validate uploadsDir
    if (!uploadsDir) {
      console.error('Uploads directory is not defined');
      return res.status(500).json({ message: 'Uploads directory is not defined' });
    }

    // Validate QuantitiesAndLengths
    const QuantitiesAndLengths = selectedProjectData?.QuantitiesAndLengths || [];
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0) {
      return res.status(400).json({ message: 'QuantitiesAndLengths must be a non-empty array' });
    }
    for (const item of QuantitiesAndLengths) {
      if (!item.quantity || !item.length) {
        return res.status(400).json({ message: 'Each QuantitiesAndLengths item must have quantity and length' });
      }
    }

    // Validate AdditionalItems
    const additionalItemsText = AdditionalItems || '';

    // Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Validate email list
    let emailList = emails;
    if (!emailList) return res.status(400).json({ message: 'Emails are required' });
    if (typeof emailList === 'string') {
      emailList = emailList.split(',').map(e => e.trim()).filter(Boolean);
    }
    if (!Array.isArray(emailList) || emailList.length === 0) {
      return res.status(400).json({ message: 'Emails must be a non-empty array' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emailList.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({ message: 'Invalid emails', invalidEmails });
    }

    // Validate project data
    let projectData;
    try {
      projectData = typeof selectedProjectData === 'string' ? JSON.parse(selectedProjectData) : selectedProjectData;
      if (!projectData?.paths?.length) {
        throw new Error('No valid paths');
      }
    } catch (error) {
      console.error('Error parsing projectData:', error.message);
      return res.status(400).json({ message: 'Invalid project data' });
    }

    const scale = parseFloat(projectData.scale) || 1;
    const showBorder = projectData.showBorder || false;
    const borderOffsetDirection = projectData.borderOffsetDirection || 'inside';

    // Initialize groupedQuantitiesAndLengths early
    const validPaths = projectData.paths.filter(path => validatePoints(path.points));
    if (validPaths.length === 0) {
      console.warn('No valid paths found in projectData');
      return res.status(400).json({ message: 'No valid paths found in project data' });
    }
    const itemsPerPath = Math.ceil(QuantitiesAndLengths.length / validPaths.length);
    const groupedQuantitiesAndLengths = [];
    for (let i = 0; i < validPaths.length; i++) {
      const startIndex = i * itemsPerPath;
      const endIndex = Math.min(startIndex + itemsPerPath, QuantitiesAndLengths.length);
      groupedQuantitiesAndLengths.push(QuantitiesAndLengths.slice(startIndex, endIndex));
    }

    // Initialize PDF document with A3 size
    const doc = new PDFDocument({ 
      size: 'A3', 
      bufferPages: true,
      info: {
        Title: `Flashing Order - ${JobReference}`,
        Author: 'Commercial Roofers Pty Ltd',
        Creator: 'Commercial Roofers Order System',
        CreationDate: new Date(),
      }
    });
    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    console.log('Saving PDF to:', pdfPath);

    // Create a write stream and pipe the document to it
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 50;
    const imgSize = 300;
    const gap = 40;

    // Track page numbers
    let pageNumber = 1;

    // Page 1: Header and Order Details
    let y = drawHeader(doc, pageWidth, 0, pageNumber);

    // Order Details Section
    y = drawSectionHeader(doc, 'ORDER DETAILS', y);

    // Order details in cards
    const cardWidth = (pageWidth - 2 * margin - 30) / 2;
    let cardY = y;
    
    // First row of cards
    cardY = drawInfoCard(doc, 'JOB REFERENCE', JobReference, margin, cardY, cardWidth);
    cardY = drawInfoCard(doc, 'PO NUMBER', Number, margin + cardWidth + 30, y, cardWidth);
    
    // Second row of cards
    cardY = drawInfoCard(doc, 'ORDER CONTACT', OrderContact, margin, cardY, cardWidth);
    cardY = drawInfoCard(doc, 'ORDER DATE', OrderDate, margin + cardWidth + 30, cardY - 50, cardWidth);
    
    // Third row - delivery or pickup
    const deliveryText = DeliveryAddress ? DeliveryAddress : (PickupNotes || 'N/A');
    cardY = drawInfoCard(doc, DeliveryAddress ? 'DELIVERY ADDRESS' : 'PICKUP NOTES', 
                         deliveryText, margin, cardY, pageWidth - 2 * margin);
    
    y = cardY + 20;

    // Notes Section
    if (Notes) {
      y = drawSectionHeader(doc, 'NOTES', y);
      
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(COLORS.darkText)
         .text(Notes, margin, y, {
           width: pageWidth - 2 * margin,
           align: 'left'
         });
      
      y += doc.heightOfString(Notes, { width: pageWidth - 2 * margin }) + 30;
    }

    // Additional Items Section
    if (additionalItemsText) {
      y = drawSectionHeader(doc, 'ADDITIONAL ITEMS', y);
      
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(COLORS.darkText)
         .text(additionalItemsText, margin, y, {
           width: pageWidth - 2 * margin,
           align: 'left'
         });
      
      y += doc.heightOfString(additionalItemsText, { width: pageWidth - 2 * margin }) + 30;
    }

    // General Notes
    y = drawSectionHeader(doc, 'IMPORTANT NOTES', y);
    
    const generalNotes = [
      '• Arrow points to the (solid) coloured side',
      '• 90° degrees are not labelled',
      '• F = Total number of folds, each crush counts as 2 folds',
    ];
    
    generalNotes.forEach((note) => {
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(COLORS.darkText)
         .text(note, margin, y, {
           width: pageWidth - 2 * margin,
           align: 'left'
         });
      
      y += 20;
    });
    
    y += 10;

    // Image handling
    const pathsPerFirstPage = 2;
    const pathsPerSubsequentPage = 4;
    let totalImagePages = 0;
    if (validPaths.length > 0) {
      totalImagePages = 1 + Math.ceil(Math.max(0, validPaths.length - pathsPerFirstPage) / pathsPerSubsequentPage);
    }

    // First part: Up to 2 images on the current page
    let firstPagePaths = 0;
    if (validPaths.length > 0) {
      firstPagePaths = Math.min(pathsPerFirstPage, validPaths.length);
      y = drawSectionHeader(doc, `DETAILED VIEWS - PART 1 OF ${totalImagePages}`, y);

      const startX = margin;
      const startY = y;

      for (let i = 0; i < firstPagePaths; i++) {
        const svgIndex = i;
        const row = Math.floor(svgIndex / 2);
        const col = svgIndex % 2;
        const x = startX + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + gap + 100);

        try {
          const pathData = validPaths[i];
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);

          // Card background for image
          doc.roundedRect(x - 10, yPos - 10, imgSize + 20, imgSize + 80, 5)
             .fill('white')
             .stroke(COLORS.border)
             .lineWidth(1)
             .stroke();

          // Draw diagram directly
          drawDiagram(doc, pathData, bounds, x, yPos, imgSize, imgSize, scale, showBorder, borderOffsetDirection);

          // Info below image
          const infoY = yPos + imgSize + 15;
          const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[i] || [];
          const qxL = formatQxL(pathQuantitiesAndLengths);
          const totalFolds = calculateTotalFolds(pathData);
          const girth = calculateGirth(pathData);

          // Path name/number
          doc.font('Helvetica-Bold')
             .fontSize(12)
             .fillColor(COLORS.primary)
             .text(`Path ${i + 1}: ${pathData.name || 'Unnamed'}`, x, infoY);
          
          // Details in two columns
          const detailsLeft = [
            [`Color: ${pathData.color || 'N/A'}`, `Code: ${pathData.code || 'N/A'}`],
            [`Q x L: ${qxL || 'N/A'}`, `Folds: ${totalFolds}`],
            [`Girth: ${girth}`, '']
          ];
          
          let detailY = infoY + 20;
          detailsLeft.forEach(([left, right]) => {
            doc.font('Helvetica')
               .fontSize(10)
               .fillColor(COLORS.darkText)
               .text(left, x, detailY);
            
            if (right) {
              doc.text(right, x + 120, detailY);
            }
            
            detailY += 15;
          });
        } catch (err) {
          console.warn(`Diagram drawing error (path ${i}):`, err.message);
          doc.font('Helvetica').fontSize(14)
            .text(`Diagram unavailable`, x, yPos);
        }
      }
      y = startY + Math.ceil(firstPagePaths / 2) * (imgSize + gap + 100);
    }

    // Remaining images: 4 per page on new pages
    const remainingPathsCount = validPaths.length - firstPagePaths;
    if (remainingPathsCount > 0) {
      const remainingPagesNeeded = Math.ceil(remainingPathsCount / pathsPerSubsequentPage);

      for (let pageIndex = 0; pageIndex < remainingPagesNeeded; pageIndex++) {
        doc.addPage();
        pageNumber++;
        y = drawHeader(doc, pageWidth, 0, pageNumber);
        y = drawSectionHeader(doc, `DETAILED VIEWS - PART ${pageIndex + 2} OF ${totalImagePages}`, y);

        const startPath = firstPagePaths + pageIndex * pathsPerSubsequentPage;
        const endPath = Math.min(startPath + pathsPerSubsequentPage, validPaths.length);

        const startX = margin;
        const startY = y;

        for (let j = 0; j < (endPath - startPath); j++) {
          const i = startPath + j;
          const svgIndex = j;
          const row = Math.floor(svgIndex / 2);
          const col = svgIndex % 2;
          const x = startX + col * (imgSize + gap);
          const yPos = startY + row * (imgSize + gap + 100);

          try {
            const pathData = validPaths[i];
            const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);

            // Card background for image
            doc.roundedRect(x - 10, yPos - 10, imgSize + 20, imgSize + 80, 5)
               .fill('white')
               .stroke(COLORS.border)
               .lineWidth(1)
               .stroke();

            // Draw diagram directly
            drawDiagram(doc, pathData, bounds, x, yPos, imgSize, imgSize, scale, showBorder, borderOffsetDirection);

            // Info below image
            const infoY = yPos + imgSize + 15;
            const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[i] || [];
            const qxL = formatQxL(pathQuantitiesAndLengths);
            const totalFolds = calculateTotalFolds(pathData);
            const girth = calculateGirth(pathData);

            // Path name/number
            doc.font('Helvetica-Bold')
               .fontSize(12)
               .fillColor(COLORS.primary)
               .text(`Path ${i + 1}: ${pathData.name || 'Unnamed'}`, x, infoY);
            
            // Details in two columns
            const detailsLeft = [
              [`Color: ${pathData.color || 'N/A'}`, `Code: ${pathData.code || 'N/A'}`],
              [`Q x L: ${qxL || 'N/A'}`, `Folds: ${totalFolds}`],
              [`Girth: ${girth}`, '']
            ];
            
            let detailY = infoY + 20;
            detailsLeft.forEach(([left, right]) => {
              doc.font('Helvetica')
                 .fontSize(10)
                 .fillColor(COLORS.darkText)
                 .text(left, x, detailY);
              
              if (right) {
                doc.text(right, x + 120, detailY);
              }
              
              detailY += 15;
            });
          } catch (err) {
            console.warn(`Diagram drawing error (path ${i}):`, err.message);
            doc.font('Helvetica').fontSize(14)
              .text(`Diagram unavailable`, x, yPos);
          }
        }
        y = startY + Math.ceil((endPath - startPath) / 2) * (imgSize + gap + 100);
      }
    }

    // Table Section (after images)
    if (y > pageHeight - 100) {
      doc.addPage();
      pageNumber++;
      y = drawHeader(doc, pageWidth, 0, pageNumber);
    }
    
    y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

    // Table Header
    const headers = ['#', 'Name', 'Code', 'Color', 'Q x L', 'Folds', 'Girth'];
    const colWidths = [40, 150, 100, 100, 120, 80, 80];
    const rowHeight = 30;

    // Draw table header with background
    let xPos = margin;
    doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
       .fill(COLORS.primary);
    
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF');
    headers.forEach((h, i) => {
      doc.text(h, xPos + 10, y + 9, { width: colWidths[i] - 20, align: i > 0 ? 'left' : 'center' });
      xPos += colWidths[i];
    });
    y += rowHeight;

    // Table Rows
    doc.font('Helvetica').fontSize(11);
    validPaths.forEach((path, index) => {
      const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[index] || [];
      const qxL = formatQxL(pathQuantitiesAndLengths);
      const totalFolds = calculateTotalFolds(path);
      const girth = calculateGirth(path);

      // Row background
      doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
         .fill(COLORS.lightBg);

      const row = [
        `${index + 1}`,
        path.name || 'N/A',
        path.code || 'N/A',
        path.color || 'N/A',
        qxL || 'N/A',
        totalFolds.toString(),
        girth
      ];

      xPos = margin;
      row.forEach((val, i) => {
        doc.fillColor(COLORS.darkText).text(val, xPos + 10, y + 9, { 
          width: colWidths[i] - 20, 
          align: i > 0 ? 'left' : 'center' 
        });
        xPos += colWidths[i];
      });
      
      // Row border
      doc.moveTo(margin, y + rowHeight)
         .lineTo(pageWidth - margin, y + rowHeight)
         .strokeColor(COLORS.border)
         .lineWidth(0.5)
         .stroke();
      
      y += rowHeight;
      
      // Check if we need a new page
      if (y > pageHeight - 100) {
        doc.addPage();
        pageNumber++;
        y = drawHeader(doc, pageWidth, 0, pageNumber);
        y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', y);
        
        // Redraw table header
        xPos = margin;
        doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
           .fill(COLORS.primary);
        
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF');
        headers.forEach((h, i) => {
          doc.text(h, xPos + 10, y + 9, { width: colWidths[i] - 20, align: i > 0 ? 'left' : 'center' });
          xPos += colWidths[i];
        });
        y += rowHeight;
      }
    });

    // Finalize the PDF
    doc.flushPages();
    doc.end();

    // Wait for the PDF to be written
    await new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        console.log('PDF written successfully to:', pdfPath);
        resolve();
      });
      writeStream.on('error', (error) => {
        console.error('Write stream error:', error.message);
        reject(error);
      });
    });

    // Verify file exists
    const exists = await fsPromises.access(pdfPath).then(() => true).catch(() => false);
    if (!exists) {
      console.error('PDF file not found at:', pdfPath);
      return res.status(500).json({ message: 'PDF file not generated' });
    }

    // Upload to Cloudinary
    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(pdfPath, {
        folder: 'freelancers',
        resource_type: 'raw',
        access_mode: 'public',
      });
      console.log('Cloudinary upload result:', JSON.stringify(uploadResult, null, 2));
    } catch (uploadError) {
      console.error('Cloudinary upload error:', uploadError.message);
      return res.status(500).json({ message: 'Failed to upload PDF to Cloudinary', error: uploadError.message });
    }

    if (!uploadResult || !uploadResult.public_id || !uploadResult.secure_url) {
      console.error('Cloudinary upload result is invalid:', uploadResult);
      return res.status(500).json({ message: 'Invalid Cloudinary upload result' });
    }

    // Send email with PDF attachment
    try {
      const info = await transporter.sendMail({
        from: `"${user.name}" <${user.email}>`,
        to: emailList,
        subject: `New Flashing Order - ${JobReference}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #000000; color: white; padding: 20px; text-align: center;">
              <h1>Commercial Roofers Pty Ltd</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #000000;">
              <h2 style="color: #000000;">New Flashing Order</h2>
              <p>Please find the attached flashing order PDF.</p>
              
              <div style="background-color: #FFFFFF; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Job Reference:</strong> ${JobReference}</p>
                <p><strong>PO Number:</strong> ${Number}</p>
                <p><strong>Order Contact:</strong> ${OrderContact}</p>
                <p><strong>Order Date:</strong> ${OrderDate}</p>
                <p><strong>${DeliveryAddress ? 'Delivery Address' : 'Pickup Notes'}:</strong> ${DeliveryAddress || PickupNotes || 'N/A'}</p>
                ${Notes ? `<p><strong>Notes:</strong> ${Notes}</p>` : ''}
              </div>
              
              ${additionalItemsText ? `
              <div style="background-color: #FFFFFF; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <h3 style="color: #000000; margin-top: 0;">Additional Items</h3>
                <p>${additionalItemsText.split('\n').map(line => line.trim()).filter(Boolean).join('<br>')}</p>
              </div>
              ` : ''}
              
              <p>For any questions, please contact us at <a href="mailto:info@commercialroofers.net.au">info@commercialroofers.net.au</a> or call 0421259430.</p>
            </div>
            <div style="background-color: #FFFFFF; padding: 10px; text-align: center; font-size: 12px; color: #000000;">
              <p>This email was automatically generated by Commercial Roofers Order System</p>
            </div>
          </div>
        `,
        attachments: [
          {
            filename: `${JobReference || 'FlashingOrder'}.pdf`,
            path: pdfPath,
            contentType: 'application/pdf',
          },
        ],
      });
      console.log('Email sent successfully:', info.messageId);
    } catch (emailError) {
      console.error('Email sending error:', emailError.message);
      return res.status(500).json({ message: 'Failed to send email', error: emailError.message });
    }

    // Save order in DB
    try {
      await new ProjectOrder({
        userId: userId,
        pdf: [{
          public_id: uploadResult.public_id,
          url: uploadResult.secure_url,
        }],
        JobReference,
        data: selectedProjectData,
        Number,
        OrderContact,
        OrderDate,
        DeliveryAddress: DeliveryAddress || null,
        PickupNotes: PickupNotes || null,
        Notes: Notes || null,
        AdditionalItems: additionalItemsText || null,
        QuantitiesAndLengths,
      }).save();
      console.log('Project order saved successfully');
    } catch (dbError) {
      console.error('Database save error:', dbError.message);
      return res.status(500).json({ message: 'Failed to save order in database', error: dbError.message });
    }

    // Delete local PDF file
    try {
      await fsPromises.unlink(pdfPath);
      console.log('Local PDF deleted successfully:', pdfPath);
    } catch (deleteError) {
      console.warn('Failed to delete local PDF:', deleteError.message);
    }

    return res.status(200).json({
      message: 'PDF generated, email sent, and local file deleted successfully',
      localPath: pdfPath,
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('GeneratePdf error:', error.message);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
export const UpdateGerantePdfOrder = async (req, res) => {
  try {
    const { userId, orderId } = req.params;
    if (!userId || !orderId) {
      return res.status(400).json({ message: "UserId and OrderId are required" });
    }

    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(400).json({ message: "User not found" });
    }

    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress, data: newData, emails } = req.body;

    const findOrder = await ProjectOrder.findOne({ userId, _id: orderId });
    if (!findOrder) {
      return res.status(400).json({ message: "Order not found" });
    }

    // Merge existing data with new data
    const mergedData = {
      ...findOrder.data,
      paths: [
        ...(findOrder.data?.paths || []),
        ...(newData?.paths || [])
      ],
      scale: newData?.scale || findOrder.data?.scale || 1,
      showBorder: newData?.showBorder ?? findOrder.data?.showBorder ?? false,
      borderOffsetDirection: newData?.borderOffsetDirection || findOrder.data?.borderOffsetDirection || 'inside'
    };

    // Prepare updated order details, retaining existing values if not provided
    const updatedOrderDetails = {
      JobReference: JobReference || findOrder.JobReference,
      Number: Number || findOrder.Number,
      OrderContact: OrderContact || findOrder.OrderContact,
      OrderDate: OrderDate || findOrder.OrderDate,
      DeliveryAddress: DeliveryAddress || findOrder.DeliveryAddress,
      data: mergedData
    };

    // Generate new PDF with merged data
    const doc = new PDFDocument({ size: 'A3', bufferPages: true });
    const timestamp = Date.now();
    const pdfPath = path.join(__dirname, 'Uploads', `project-${timestamp}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = 842;
    const pageHeight = 1191;
    const margin = 60;
    const imgSize = 300;
    const gap = 40;
    const pathsPerPage = 4;
    const imagePagesNeeded = Math.ceil(mergedData.paths.length / pathsPerPage);

    // Extract scale from mergedData
    const scale = mergedData.scale || 1;
    const showBorder = mergedData.showBorder;
    const borderOffsetDirection = mergedData.borderOffsetDirection;

    let y = margin;

    // Company Header with Logo on Right
    try {
      const logo = doc.openImage(path.join(__dirname, 'assets', 'company.png'));
      const logoHeight = 50;
      const logoWidth = (logo.width * logoHeight) / logo.height;
      doc.image(logo, pageWidth - margin - logoWidth, y, { width: logoWidth, height: logoHeight });
      doc.font('Helvetica-Bold').fontSize(24).fillColor('black')
        .text('Commercial Roofers Pty Ltd', margin, y + (logoHeight - 24) / 2);
    } catch (err) {
      console.warn('Failed to load logo:', err.message);
      doc.font('Helvetica-Bold').fontSize(24).fillColor('black')
        .text('Commercial Roofers Pty Ltd', margin, y);
    }
    y += 50;
    doc.font('Helvetica').fontSize(14)
      .text('contact@commercialroofers.net.au | 0421259430', margin, y);
    y += 40;

    // Order Details
    const orderDetails = [
      `Job Reference: ${updatedOrderDetails.JobReference}`,
      `PO Number: ${updatedOrderDetails.Number}`,
      `Order Contact: ${updatedOrderDetails.OrderContact}`,
      `Order Date: ${updatedOrderDetails.OrderDate}`,
      `Delivery Address: ${updatedOrderDetails.DeliveryAddress}`,
    ];

    doc.font('Helvetica').fontSize(14);
    orderDetails.forEach((text) => {
      doc.text(text, margin, y);
      y += 20;
    });
    y += 24;

    // Notes
    const notes = [
      '• Arrow points to the (solid) coloured side',
      '• 90° degrees are not labelled',
      '• F = Total number of folds, each crush counts as 2 folds',
    ];

    doc.font('Helvetica-Bold').fontSize(16);
    notes.forEach((line, index) => {
      doc.text(line, margin, y + index * 20);
    });
    y += notes.length * 20 + 24;

    // Table Header
    const headers = ['#', 'Name', 'Code', 'Color', 'Quantity', 'Length'];
    const colWidths = [40, 150, 80, 100, 80, 100];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const rowHeight = 24;

    doc.rect(margin, y, totalWidth, rowHeight).fill('#E6E6E6');
    let xPos = margin;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('black');
    headers.forEach((h, i) => {
      doc.text(h, xPos + 6, y + 6);
      xPos += colWidths[i];
    });
    y += rowHeight;

    // Table Rows
    doc.font('Helvetica').fontSize(14);
    mergedData.paths.forEach((path, index) => {
      const row = [
        `${index + 1}`,
        path.name || 'N/A',
        path.code || 'N/A',
        path.color || 'N/A',
        path.quantity?.toString() || 'N/A',
        path.totalLength || 'N/A',
      ];

      xPos = margin;
      row.forEach((val, i) => {
        doc.text(val, xPos + 6, y + 6);
        xPos += colWidths[i];
      });
      y += rowHeight;
    });

    // Image pages
    for (let pageIndex = 0; pageIndex < imagePagesNeeded; pageIndex++) {
      doc.addPage();
      y = margin;

      // Company Header with Logo on Right
      try {
        const logo = doc.openImage(path.join(__dirname, 'assets', 'company.png'));
        const logoHeight = 50;
        const logoWidth = (logo.width * logoHeight) / logo.height;
        doc.image(logo, pageWidth - margin - logoWidth, y, { width: logoWidth, height: logoHeight });
        doc.font('Helvetica-Bold').fontSize(24).fillColor('black')
          .text('Commercial Roofers Pty Ltd', margin, y + (logoHeight - 24) / 2);
      } catch (err) {
        console.warn('Failed to load logo:', err.message);
        doc.font('Helvetica-Bold').fontSize(24).fillColor('black')
          .text('Commercial Roofers Pty Ltd', margin, y);
      }
      y += 50;
      doc.font('Helvetica').fontSize(14)
        .text('contact@commercialroofers.net.au | 0421259430', margin, y);
      y += 40;

      const startPath = pageIndex * pathsPerPage;
      const endPath = Math.min(startPath + pathsPerPage, mergedData.paths.length);
      const startX = margin;
      const startY = y;

      for (let i = startPath; i < endPath; i++) {
        const svgIndex = i - startPath;
        const row = Math.floor(svgIndex / 2);
        const col = svgIndex % 2;
        const x = startX + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + gap + 70);

        const pathData = mergedData.paths[i];
        const bounds = calculateBounds(pathData, scale);
        const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

        const imageBuffer = await sharp(Buffer.from(svgString))
          .resize({ width: imgSize * 2, height: imgSize * 2, fit: 'contain', background: { r: 255, g: 255, b: 255 } })
          .png({ quality: 100, compressionLevel: 0 })
          .toBuffer();

        const img = doc.openImage(imageBuffer);
        const imgW = imgSize;
        const imgH = (img.height * imgW) / img.width;

        doc.rect(x - 8, yPos - 8, imgW + 16, imgH + 16).lineWidth(1.5).strokeColor('black').stroke();
        doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

        const infoY = yPos + imgH + 15;
        const qxL = ((parseFloat(pathData.quantity) || 0) * (parseFloat(pathData.totalLength) || 0)).toFixed(2);
        const infoItems = [
          [pathData.color || 'N/A', 'Colour / Material'],
          [pathData.code || 'N/A', 'CODE'],
          [qxL, 'Q x L'],
        ];

        doc.font('Helvetica-Bold').fontSize(12);
        infoItems.forEach(([label, value], idx) => {
          doc.text(label, x, infoY + idx * 15);
          doc.font('Helvetica').text(value, x + 120, infoY + idx * 15);
        });

        const lineY = yPos + imgH + 60;
        const length = parseFloat(pathData.totalLength) || 410;

        doc.lineWidth(1.5).dash(7, { space: 7 })
          .moveTo(x, lineY).lineTo(x + imgW, lineY).strokeColor('black').stroke();
        doc.undash();

        doc.font('Helvetica').fontSize(12)
          .text(`${length.toFixed(0)}`, x + imgW / 2, lineY - 15, { align: 'center' });

        doc.moveTo(x, lineY - 7).lineTo(x, lineY + 7).strokeColor('red').stroke();
        doc.moveTo(x + imgW, lineY - 7).lineTo(x + imgW, lineY + 7).stroke();
      }
    }

    doc.flushPages();
    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const exists = await fsPromises.access(pdfPath).then(() => true).catch(() => false);
    if (!exists) {
      return res.status(500).json({ message: 'PDF file not generated' });
    }

    let uploadResult;
    uploadResult = await cloudinary.uploader.upload(pdfPath, {
      folder: 'freelancers',
      resource_type: 'raw',
      type: 'upload',
      access_mode: 'public',
      public_id: `project-${timestamp}`,
    });

    // Send email with updated PDF
    if (emails) {
      let emailList = typeof emails === 'string' ? emails.split(',').map(e => e.trim()).filter(Boolean) : emails;
      if (Array.isArray(emailList) && emailList.length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const invalidEmails = emailList.filter(email => !emailRegex.test(email));
        if (invalidEmails.length === 0) {
          await transporter.sendMail({
            from: `"${findUser.name}" <${findUser.email}>`,
            to: emailList,
            subject: 'Updated Flashing Order',
            html: `
              <p>Please find the attached updated flashing order PDF.</p>
              <p>info@commercialroofers.net.au | 0421259430</p>
              <p>
                Job Reference: ${updatedOrderDetails.JobReference}<br>
                Number: ${updatedOrderDetails.Number}<br>
                Order Contact: ${updatedOrderDetails.OrderContact}<br>
                Order Date: ${updatedOrderDetails.OrderDate}<br>
                Delivery Address: ${updatedOrderDetails.DeliveryAddress}
              </p>
            `,
            attachments: [
              {
                filename: `${updatedOrderDetails.JobReference || 'FlashingOrder'}.pdf`,
                path: pdfPath,
                contentType: 'application/pdf',
              },
            ],
          });
        }
      }
    }

    // Update order in DB with new PDF URL
    await ProjectOrder.findByIdAndUpdate(orderId, {
      pdf: uploadResult.secure_url,
      ...updatedOrderDetails
    });

    await fsPromises.unlink(pdfPath);

    return res.status(200).json({
      message: 'PDF updated, email sent, and order updated successfully',
      cloudinaryUrl: `${uploadResult.secure_url}/fl_attachment`,
    });
  } catch (error) {
    console.log("UpdateGerantePdfOrder error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
