import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs, { promises as fsPromises } from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { User } from '../models/auth.model.js';
import { UserPdf } from '../models/userpdf.model.js';
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

// Color scheme (professional grayscale with accents)
const COLORS = {
  primary: '#000000',   // Black for headers
  secondary: '#333333', // Dark gray for subheaders
  accent: '#666666',    // Medium gray for borders
  lightBg: '#FFFFFF',   // White background
  altBg: '#F5F5F5',     // Light gray for alternating rows
  text: '#000000',      // Black text
  red: '#FF0000',       // Red for warnings/codes
  border: '#CCCCCC',    // Light gray borders
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

// Helper function to calculate bounds for a path
const calculateBounds = (path, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Invalid points array in path:', path);
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }; // Fallback bounds
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  path.points.forEach((point) => {
    const x = parseFloat(point.x);
    const y = parseFloat(point.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  const isLargeDiagram = (maxX - minX > 10000 || maxY - minY > 10000);
  path.segments.forEach((segment, i) => {
    if (!segment.labelPosition) return;
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
        const foldLabelX = foldEndX + rotNormalX * 25;
        const foldLabelY = foldEndY + rotNormalY * 25;
        minX = Math.min(minX, foldLabelX - 35, foldEndX, foldBaseX);
        maxX = Math.max(maxX, foldLabelX + 35, foldEndX, foldBaseX);
        minY = Math.min(minY, foldLabelY - 20, foldEndY, foldBaseY);
        maxY = Math.max(maxY, foldLabelY + ARROW_SIZE + 20, foldEndY, foldBaseY);
      }
    }
  });

  (path.angles || []).forEach((angle) => {
    if (!angle.labelPosition) return;
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    if (Math.round(angleValue) === 90 || Math.round(angleValue) === 270) return;
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, labelX - 35);
    maxX = Math.max(maxX, labelX + 35);
    minY = Math.min(minY, labelY - 20);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 20);
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
  if (!validatePoints(path.points)) return [];
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

// Helper function to calculate total folds per piece
const calculateFoldsPerPiece = (path) => {
  let folds = (path.angles || []).length;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      let foldType = 'None';
      if (typeof segment.fold === 'object' && segment.fold) {
        foldType = segment.fold.type || 'None';
      } else {
        foldType = segment.fold || 'None';
      }
      if (foldType !== 'None') {
        folds += foldType === 'Crush' ? 2 : 1;
      }
    });
  }
  return folds;
};

// Helper function to calculate girth per piece (assuming units in mm)
const calculateGirth = (path) => {
  let totalLength = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      const lengthStr = segment.length || '0 mm';
      const lengthNum = parseFloat(lengthStr.replace(/[^0-9.]/g, '')) || 0;
      totalLength += lengthNum;
    });
  }
  return totalLength.toFixed(2);
};

// Helper function to calculate total quantity for a path
const calculateTotalQuantity = (quantitiesAndLengths) => {
  return quantitiesAndLengths.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
};

// Helper function to format Q x L
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  return quantitiesAndLengths.map(item => `${item.quantity}x${parseFloat(item.length).toFixed(0)}`).join(', ');
};

// Helper function to generate SVG string
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';
  }
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  const targetViewBoxSize = 1000;
  const scaleFactor = targetViewBoxSize * 0.8 / Math.max(width, height, 1);
  const offsetX = (targetViewBoxSize - width * scaleFactor) / 2;
  const offsetY = (targetViewBoxSize - height * scaleFactor) / 2;

  const viewBox = `0 0 ${targetViewBoxSize} ${targetViewBoxSize}`;
  const transformCoord = (x, y) => ({
    x: (parseFloat(x) - bounds.minX) * scaleFactor + offsetX,
    y: (parseFloat(y) - bounds.minY) * scaleFactor + offsetY
  });

  let gridLines = '';
  const gridSize = GRID_SIZE;
  const gridStartX = Math.floor(bounds.minX / gridSize) * gridSize;
  const gridStartY = Math.floor(bounds.minY / gridSize) * gridSize;
  const gridEndX = Math.ceil(bounds.maxX / gridSize) * gridSize;
  const gridEndY = Math.ceil(bounds.maxY / gridSize) * gridSize;
  for (let x = gridStartX; x <= gridEndX; x += gridSize) {
    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);
    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${COLORS.border}" stroke-width="${0.5 * scaleFactor}"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += gridSize) {
    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);
    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${COLORS.border}" stroke-width="${0.5 * scaleFactor}"/>`;
  }

  let svgContent = path.points.map((point) => {
    const {x: cx, y: cy} = transformCoord(point.x, point.y);
    return `<circle cx="${cx}" cy="${cy}" r="${3 * scaleFactor}" fill="${COLORS.primary}"/>`;
  }).join('');

  if (path.points.length > 1) {
    const d = path.points.map(p => {
      const {x, y} = transformCoord(p.x, p.y);
      return `${x},${y}`;
    }).join(' L');
    svgContent += `<path d="M${d}" stroke="${COLORS.primary}" stroke-width="${2.5 * scaleFactor}" fill="none"/>`;
  }

  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    svgContent += offsetSegments.map((segment) => {
      const {x: x1, y: y1} = transformCoord(segment.p1.x, segment.p1.y);
      const {x: x2, y: y2} = transformCoord(segment.p2.x, segment.p2.y);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.primary}" stroke-width="${3 * scaleFactor}" stroke-dasharray="${6 * scaleFactor},${4 * scaleFactor}"/>`;
    }).join('');

    const segment = offsetSegments[0];
    if (segment) {
      const midX = (segment.p1.x + segment.p2.x) / 2;
      const midY = (segment.p1.y + segment.p2.y) / 2;
      const {x: midXView, y: midYView} = transformCoord(midX, midY);
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
          const chevronXView = midXView + normalX * chevronBaseDistance * scaleFactor;
          const chevronYView = midYView + normalY * chevronBaseDistance * scaleFactor;
          const chevronSize = 8 * scaleFactor;
          const direction = 1;
          const chevronPath = `
            M${chevronXView + chevronSize * normalX * direction + chevronSize * unitX},${chevronYView + chevronSize * normalY * direction + chevronSize * unitY}
            L${chevronXView},${chevronYView}
            L${chevronXView + chevronSize * normalX * direction - chevronSize * unitX},${chevronYView + chevronSize * normalY * direction - chevronSize * unitY}
          `;
          svgContent += `<path d="${chevronPath}" stroke="${COLORS.primary}" stroke-width="${2 * scaleFactor}" fill="none"/>`;
        }
      }
    }
  }

  const labelWidth = 65;
  const labelHeight = 30;
  const labelRadius = 10;
  const fontSize = 16;
  const tailSize = 6;
  const attachSize = 6;
  const labelBg = COLORS.lightBg;
  const labelText = COLORS.text;
  const tailFill = COLORS.primary;

  svgContent += (Array.isArray(path.segments) ? path.segments : []).map((segment, i) => {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    if (!p1 || !p2 || !segment.labelPosition) return '';
    const {x: posX, y: posY} = transformCoord(segment.labelPosition.x, segment.labelPosition.y);
    const {x: p1x, y: p1y} = transformCoord(p1.x, p1.y);
    const {x: p2x, y: p2y} = transformCoord(p2.x, p2.y);
    const midX = (p1x + p2x) / 2;
    const midY = (p1y + p2y) / 2;
    const labelDx = midX - posX;
    const labelDy = midY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    let tailPath = '';
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        const baseX = posX - labelWidth / 2;
        const tipX = baseX - tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      } else {
        const baseX = posX + labelWidth / 2;
        const tipX = baseX + tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      }
    } else {
      if (labelDy < 0) {
        const baseY = posY - labelHeight / 2;
        const tipY = baseY - tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      } else {
        const baseY = posY + labelHeight / 2;
        const tipY = baseY + tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      }
    }
    let foldElement = '';
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
        const foldBase = transformCoord(
          isFirstSegment ? p1.x : p2.x,
          isFirstSegment ? p1.y : p2.y
        );
        const foldEnd = {
          x: foldBase.x + rotNormalX * foldLength * scaleFactor,
          y: foldBase.y + rotNormalY * foldLength * scaleFactor
        };
        const foldLabelPos = {
          x: foldEnd.x + rotNormalX * 25 * scaleFactor,
          y: foldEnd.y + rotNormalY * 25 * scaleFactor
        };
        const foldColor = COLORS.primary;
        let foldPath = '';
        const chevronSizeAdj = CHEVRON_SIZE * scaleFactor;
        const hookRadiusAdj = HOOK_RADIUS * scaleFactor;
        const zigzagAdj = ZIGZAG_SIZE * scaleFactor;
        if (foldType === 'Crush') {
          const chevron1 = foldEnd;
          const chevron2 = {
            x: foldEnd.x - rotNormalX * 3 * scaleFactor,
            y: foldEnd.y - rotNormalY * 3 * scaleFactor
          };
          foldPath = `
            M${chevron1.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * unitX},${chevron1.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * unitY}
            L${chevron1.x},${chevron1.y}
            L${chevron1.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * unitX},${chevron1.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * unitY}
            M${chevron2.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * unitX},${chevron2.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * unitY}
            L${chevron2.x},${chevron2.y}
            L${chevron2.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * unitX},${chevron2.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * unitY}
          `;
          foldElement = `<path d="${foldPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none"/>`;
        } else if (foldType === 'Crush Hook') {
          const arcPath = `M${foldBase.x},${foldBase.y} L${foldEnd.x},${foldEnd.y} A${hookRadiusAdj},${hookRadiusAdj} 0 0 1 ${foldEnd.x + hookRadiusAdj * unitX},${foldEnd.y + hookRadiusAdj * unitY}`;
          foldElement = `<path d="${arcPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none"/>`;
        } else if (foldType === 'Break') {
          const mid = {
            x: foldBase.x + rotNormalX * (foldLength / 2) * scaleFactor,
            y: foldBase.y + rotNormalY * (foldLength / 2) * scaleFactor
          };
          const zigzagPath = `
            M${foldBase.x},${foldBase.y}
            L${mid.x + zigzagAdj * unitX},${mid.y + zigzagAdj * unitY}
            L${mid.x - zigzagAdj * unitX},${mid.y - zigzagAdj * unitY}
            L${foldEnd.x},${foldEnd.y}
          `;
          foldElement = `<path d="${zigzagPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none"/>`;
        } else if (foldType === 'Open') {
          foldElement = `<line x1="${foldBase.x}" y1="${foldBase.y}" x2="${foldEnd.x}" y2="${foldEnd.y}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}"/>`;
        }
        const foldArrowX = foldLabelPos.x;
        const foldArrowY = foldLabelPos.y + 20 * scaleFactor;
        const foldArrowDx = foldBase.x - foldArrowX;
        const foldArrowDy = foldBase.y - foldArrowY;
        const foldArrowDist = Math.sqrt(foldArrowDx * foldArrowDx + foldArrowDy * foldArrowDy) || 1;
        const foldArrowUnitX = foldArrowDx / foldArrowDist;
        const foldArrowUnitY = foldArrowDy / foldArrowDist;
        const foldArrowPath = `
          M${foldArrowX - foldArrowUnitX * ARROW_SIZE * scaleFactor},${foldArrowY - foldArrowUnitY * ARROW_SIZE * scaleFactor}
          L${foldArrowX},${foldArrowY}
          L${foldArrowX - foldArrowUnitX * ARROW_SIZE * scaleFactor + foldArrowUnitY * ARROW_SIZE * scaleFactor * 0.5},${foldArrowY - foldArrowUnitY * ARROW_SIZE * scaleFactor - foldArrowUnitX * ARROW_SIZE * scaleFactor * 0.5}
          Z
        `;
        foldElement += `
          <text x="${foldLabelPos.x}" y="${foldLabelPos.y}" font-size="${14 * scaleFactor}" fill="${foldColor}" text-anchor="middle" alignment-baseline="middle">
            ${foldType}
          </text>
          <path d="${foldArrowPath}" stroke="${foldColor}" stroke-width="${1 * scaleFactor}" fill="${foldColor}"/>
        `;
      }
    }
    return `
      <g>
        <rect x="${posX - labelWidth/2}" y="${posY - labelHeight/2}"
              width="${labelWidth}" height="${labelHeight}"
              fill="${labelBg}" rx="${labelRadius}"
              stroke="${COLORS.primary}" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}"
              fill="${labelText}" text-anchor="middle" alignment-baseline="middle">
          ${segment.length}
        </text>
        ${foldElement}
      </g>
    `;
  }).join('');

  svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition) return '';
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270) return '';
    const {x: posX, y: posY} = transformCoord(angle.labelPosition.x, angle.labelPosition.y);
    const vertexX = angle.vertexIndex && path.points[angle.vertexIndex] ? path.points[angle.vertexIndex].x : angle.labelPosition.x;
    const vertexY = angle.vertexIndex && path.points[angle.vertexIndex] ? path.points[angle.vertexIndex].y : angle.labelPosition.y;
    const {x: targetX, y: targetY} = transformCoord(vertexX, vertexY);
    const labelDx = targetX - posX;
    const labelDy = targetY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    let tailPath = '';
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        const baseX = posX - labelWidth / 2;
        const tipX = baseX - tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      } else {
        const baseX = posX + labelWidth / 2;
        const tipX = baseX + tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      }
    } else {
      if (labelDy < 0) {
        const baseY = posY - labelHeight / 2;
        const tipY = baseY - tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      } else {
        const baseY = posY + labelHeight / 2;
        const tipY = baseY + tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      }
    }
    return `
      <g>
        <rect x="${posX - labelWidth / 2}" y="${posY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" fill="${labelBg}" rx="${labelRadius}" stroke="${COLORS.primary}" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" fill="${labelText}" text-anchor="middle" alignment-baseline="middle">
          ${roundedValue}°
        </text>
      </g>
    `;
  }).join('');

  return `<svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
    <g>${gridLines}</g>
    <g>${svgContent}</g>
  </svg>`;
};

// Helper function to draw header
const drawHeader = (doc, pageWidth, y, pageNumber) => {
  const margin = 40; // Reduced for more content space

  // Header background
  doc.rect(0, 0, pageWidth, 70)
     .fill(COLORS.lightBg);

  // Company name
  doc.font('Helvetica-Bold')
     .fontSize(18)
     .fillColor(COLORS.primary)
     .text('Commercial Roofers Pty Ltd', margin, 15);

  // Contact info
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.secondary)
     .text('info@commercialroofers.net.au | 0421 259 430', margin, 35);

  // Logo
  try {
    const logo = doc.openImage(logoPath);
    const logoHeight = 40;
    const logoWidth = (logo.width * logoHeight) / logo.height;
    doc.image(logo, pageWidth - margin - logoWidth, 15, { width: logoWidth, height: logoHeight });
  } catch (err) {
    console.warn('Failed to load logo:', err.message);
  }

  // Divider
  doc.moveTo(margin, 60)
     .lineTo(pageWidth - margin, 60)
     .strokeColor(COLORS.accent)
     .lineWidth(1.5)
     .stroke();

  // Page number
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.accent)
     .text(`Page ${pageNumber}`, pageWidth - margin - 50, pageHeight - 30, { align: 'right' });

  return 70;
};

// Helper function to draw section header
const drawSectionHeader = (doc, text, y, pageWidth) => {
  const margin = 40;
  doc.font('Helvetica-Bold')
     .fontSize(14)
     .fillColor(COLORS.secondary)
     .text(text.toUpperCase(), margin, y);

  doc.moveTo(margin, y + 20)
     .lineTo(pageWidth - margin, y + 20)
     .strokeColor(COLORS.border)
     .lineWidth(0.5)
     .stroke();

  return y + 30;
};

// Helper function to draw order details table
const drawOrderDetailsTable = (doc, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, y, pageWidth) => {
  const margin = 40;
  const tableWidth = pageWidth - 2 * margin;
  const rowHeight = 25;
  const colWidths = [tableWidth * 0.3, tableWidth * 0.7];

  // Table border
  doc.rect(margin, y, tableWidth, rowHeight * 6)
     .lineWidth(1)
     .strokeColor(COLORS.accent)
     .stroke();

  // Header row
  doc.rect(margin, y, tableWidth, rowHeight)
     .fill(COLORS.altBg);
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(COLORS.primary)
     .text('ORDER DETAILS', margin + (tableWidth / 2), y + 6, { align: 'center' });

  y += rowHeight;

  // Rows
  const rows = [
    ['Job Reference', JobReference],
    ['PO Number', Number],
    ['Order Contact', OrderContact],
    ['Order Date', OrderDate],
    ['Delivery Address', DeliveryAddress || 'PICKUP']
  ];

  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) {
      doc.rect(margin, y, tableWidth, rowHeight)
         .fill(COLORS.lightBg);
    } else {
      doc.rect(margin, y, tableWidth, rowHeight)
         .fill(COLORS.altBg);
    }

    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(COLORS.secondary)
       .text(label, margin + 10, y + 6);

    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(COLORS.text)
       .text(value, margin + colWidths[0] + 10, y + 6);

    doc.moveTo(margin, y + rowHeight)
       .lineTo(pageWidth - margin, y + rowHeight)
       .strokeColor(COLORS.border)
       .lineWidth(0.5)
       .stroke();

    doc.moveTo(margin + colWidths[0], y)
       .lineTo(margin + colWidths[0], y + rowHeight)
       .strokeColor(COLORS.border)
       .lineWidth(0.5)
       .stroke();

    y += rowHeight;
  });

  return y + 20;
};

// Helper function to draw instructions
const drawInstructions = (doc, y, pageWidth) => {
  const margin = 40;
  y = drawSectionHeader(doc, 'Important Notes', y, pageWidth);

  const instructions = [
    '• Arrow points to the (solid) coloured side',
    '• 90° degrees are not labelled',
    '• F = Folds per piece, T = Total folds (F x Quantity)'
  ];

  doc.rect(margin, y, pageWidth - 2 * margin, 70)
     .lineWidth(0.5)
     .strokeColor(COLORS.border)
     .stroke();

  instructions.forEach((instruction, i) => {
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(COLORS.text)
       .text(instruction, margin + 10, y + 10 + i * 20);
  });

  y += 80;

  doc.font('Helvetica-Bold')
     .fontSize(11)
     .fillColor(COLORS.red)
     .text('*** PLEASE WRITE ALL CODES ON FLASHINGS ***', margin, y, {
       width: pageWidth - 2 * margin,
       align: 'center'
     });

  return y + 40;
};

// Helper function to draw notes section
const drawNotesSection = (doc, notes, y, pageWidth) => {
  const margin = 40;
  y = drawSectionHeader(doc, 'Additional Notes', y, pageWidth);

  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.text)
     .text(notes || 'No additional notes provided.', margin, y, {
       width: pageWidth - 2 * margin,
       lineGap: 5
     });

  return y + doc.heightOfString(notes || 'No additional notes provided.', { width: pageWidth - 2 * margin }) + 20;
};

// Helper function to draw additional items
const drawAdditionalItems = (doc, additionalItems, y, pageWidth) => {
  const margin = 40;
  y = drawSectionHeader(doc, 'Additional Items', y, pageWidth);

  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.text)
     .text(additionalItems || 'No additional items.', margin, y, {
       width: pageWidth - 2 * margin,
       lineGap: 5
     });

  return y + doc.heightOfString(additionalItems || 'No additional items.', { width: pageWidth - 2 * margin }) + 20;
};

// Helper function to draw diagram property table
const drawDiagramPropertyTable = (doc, x, y, pathData, qxL, foldsPerPiece, totalFolds, girth, totalQuantity) => {
  const tableWidth = 240; // Wider for better readability
  const rowHeight = 22;
  const colWidths = [120, 120];
  const rows = [
    ['Name', pathData.name || 'Unnamed'],
    ['Colour', pathData.color || 'N/A'],
    ['Code', pathData.code || 'N/A'],
    ['Q x L', qxL || 'N/A'],
    ['Quantity', totalQuantity.toString()],
    ['Folds (F)', foldsPerPiece.toString()],
    ['Girth', `${girth} mm`],
    ['Total Folds (T)', totalFolds.toString()]
  ];

  // Outer border
  doc.rect(x, y, tableWidth, rowHeight * rows.length)
     .lineWidth(1)
     .strokeColor(COLORS.accent)
     .stroke();

  // Rows
  rows.forEach((row, index) => {
    if (index % 2 === 0) {
      doc.rect(x, y, tableWidth, rowHeight)
         .fill(COLORS.altBg);
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.secondary);
    doc.text(row[0], x + 10, y + 6, { width: colWidths[0] - 20, align: 'left' });

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);
    if (row[0] === 'Code') doc.fillColor(COLORS.red);
    doc.text(row[1], x + colWidths[0] + 10, y + 6, { width: colWidths[1] - 20, align: 'right' });

    doc.moveTo(x, y + rowHeight)
       .lineTo(x + tableWidth, y + rowHeight)
       .lineWidth(0.5)
       .strokeColor(COLORS.border)
       .stroke();

    y += rowHeight;
  });

  // Vertical divider
  doc.moveTo(x + colWidths[0], y - rowHeight * rows.length)
     .lineTo(x + colWidths[0], y)
     .lineWidth(0.5)
     .strokeColor(COLORS.border)
     .stroke();

  return y;
};

// Helper function to draw footer
const drawFooter = (doc, pageWidth, pageHeight) => {
  doc.moveTo(40, pageHeight - 40)
     .lineTo(pageWidth - 40, pageHeight - 40)
     .strokeColor(COLORS.border)
     .lineWidth(0.5)
     .stroke();

  doc.font('Helvetica-Oblique')
     .fontSize(9)
     .fillColor(COLORS.accent)
     .text('Generated by Flash.it Roofing App', pageWidth / 2, pageHeight - 30, { align: 'center' });
};

// Main export function
export const generatePdfDownload = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems } = req.body;
    const { userId } = req.params;

    if (!JobReference || !Number || !OrderContact || !OrderDate) {
      return res.status(400).json({ message: 'Required fields: JobReference, Number, OrderContact, OrderDate' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let projectData;
    try {
      projectData = typeof selectedProjectData === 'string' ? JSON.parse(selectedProjectData) : selectedProjectData;
      if (!Array.isArray(projectData.paths) || projectData.paths.length === 0) {
        throw new Error('Invalid paths in project data');
      }
    } catch (error) {
      return res.status(400).json({ message: 'Invalid project data', error: error.message });
    }

    const scale = parseFloat(projectData.scale) || 1;
    const showBorder = projectData.showBorder || false;
    const borderOffsetDirection = projectData.borderOffsetDirection || 'inside';

    const QuantitiesAndLengths = projectData.QuantitiesAndLengths || [];
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0) {
      return res.status(400).json({ message: 'QuantitiesAndLengths required as non-empty array' });
    }

    const validPaths = projectData.paths.filter(path => validatePoints(path.points));
    if (validPaths.length === 0) {
      return res.status(400).json({ message: 'No valid paths in project data' });
    }

    const itemsPerPath = Math.ceil(QuantitiesAndLengths.length / validPaths.length);
    const groupedQuantitiesAndLengths = [];
    for (let i = 0; i < validPaths.length; i++) {
      const start = i * itemsPerPath;
      groupedQuantitiesAndLengths.push(QuantitiesAndLengths.slice(start, start + itemsPerPath));
    }

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      info: {
        Title: `Flashing Order - ${JobReference}`,
        Author: 'Commercial Roofers Pty Ltd',
        Creator: 'Flash.it Roofing App',
        CreationDate: new Date(),
      }
    });

    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `order-${JobReference}-${timestamp}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const imgSize = 220; // Larger for better visibility
    const gap = 20;

    let pageNumber = 1;
    let y = drawHeader(doc, pageWidth, 0, pageNumber);

    y = drawOrderDetailsTable(doc, JobReference, Number, OrderContact, OrderDate, DeliveryAddress || PickupNotes, y, pageWidth);

    y = drawInstructions(doc, y, pageWidth);

    const pathsPerRow = 2;
    const firstPageMaxPaths = 2;
    const subsequentMaxPaths = 4;

    const firstPagePaths = Math.min(firstPageMaxPaths, validPaths.length);
    const remainingPaths = validPaths.length - firstPagePaths;
    const totalDiagramParts = 1 + Math.ceil(remainingPaths / subsequentMaxPaths);

    if (firstPagePaths > 0) {
      y = drawSectionHeader(doc, `Flashing Details - Part 1 of ${totalDiagramParts}`, y, pageWidth);
      const startY = y;

      for (let i = 0; i < firstPagePaths; i++) {
        const col = i % pathsPerRow;
        const row = Math.floor(i / pathsPerRow);
        const x = margin + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + 140); // Adjusted for table height

        try {
          const pathData = validPaths[i];
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize(imgSize * 4, imgSize * 4, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .png({ quality: 100 })
            .toBuffer();

          doc.rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
             .lineWidth(0.5)
             .strokeColor(COLORS.border)
             .stroke();

          doc.image(imageBuffer, x, yPos, { width: imgSize });

          const pathQL = groupedQuantitiesAndLengths[i] || [];
          const qxL = formatQxL(pathQL);
          const foldsPerPiece = calculateFoldsPerPiece(pathData);
          const girth = calculateGirth(pathData);
          const totalQuantity = calculateTotalQuantity(pathQL);
          const totalFolds = foldsPerPiece * totalQuantity;

          drawDiagramPropertyTable(doc, x, yPos + imgSize + 10, pathData, qxL, foldsPerPiece, totalFolds, girth, totalQuantity);
        } catch (err) {
          console.warn(`Diagram error (index ${i}):`, err.message);
          doc.text('Diagram unavailable', x, yPos + imgSize / 2);
        }
      }

      y = startY + Math.ceil(firstPagePaths / pathsPerRow) * (imgSize + 140);
    }

    for (let part = 1; part < totalDiagramParts; part++) {
      doc.addPage();
      pageNumber++;
      y = drawHeader(doc, pageWidth, 0, pageNumber);
      y = drawSectionHeader(doc, `Flashing Details - Part ${part + 1} of ${totalDiagramParts}`, y, pageWidth);
      const startPath = firstPagePaths + (part - 1) * subsequentMaxPaths;
      const endPath = Math.min(startPath + subsequentMaxPaths, validPaths.length);
      const startY = y;

      for (let j = 0; j < endPath - startPath; j++) {
        const i = startPath + j;
        const col = j % pathsPerRow;
        const row = Math.floor(j / pathsPerRow);
        const x = margin + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + 140);

        try {
          const pathData = validPaths[i];
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize(imgSize * 4, imgSize * 4, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .png({ quality: 100 })
            .toBuffer();

          doc.rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
             .lineWidth(0.5)
             .strokeColor(COLORS.border)
             .stroke();

          doc.image(imageBuffer, x, yPos, { width: imgSize });

          const pathQL = groupedQuantitiesAndLengths[i] || [];
          const qxL = formatQxL(pathQL);
          const foldsPerPiece = calculateFoldsPerPiece(pathData);
          const girth = calculateGirth(pathData);
          const totalQuantity = calculateTotalQuantity(pathQL);
          const totalFolds = foldsPerPiece * totalQuantity;

          drawDiagramPropertyTable(doc, x, yPos + imgSize + 10, pathData, qxL, foldsPerPiece, totalFolds, girth, totalQuantity);
        } catch (err) {
          console.warn(`Diagram error (index ${i}):`, err.message);
          doc.text('Diagram unavailable', x, yPos + imgSize / 2);
        }
      }

      y = startY + Math.ceil((endPath - startPath) / pathsPerRow) * (imgSize + 140);
    }

    if (y > pageHeight - 200) {
      doc.addPage();
      pageNumber++;
      y = drawHeader(doc, pageWidth, 0, pageNumber);
    }

    y = drawNotesSection(doc, Notes, y, pageWidth);

    y = drawAdditionalItems(doc, AdditionalItems, y, pageWidth);

    if (y > pageHeight - 200) {
      doc.addPage();
      pageNumber++;
      y = drawHeader(doc, pageWidth, 0, pageNumber);
    }

    y = drawSectionHeader(doc, 'Order Summary', y, pageWidth);

    const headers = ['#', 'Name', 'Colour', 'Code', 'Qty', 'F', 'Girth', 'Q x L', 'T'];
    const colWidths = [30, 80, 70, 60, 40, 40, 60, 100, 40];
    const rowHeight = 22;

    let grandTotalQuantity = 0;
    let grandTotalFolds = 0;

    doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
       .fill(COLORS.altBg);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.primary);
    let xPos = margin;
    headers.forEach((h, i) => {
      doc.text(h, xPos + 5, y + 6, { width: colWidths[i] - 10, align: 'center' });
      xPos += colWidths[i];
    });

    y += rowHeight;

    validPaths.forEach((path, index) => {
      const pathQL = groupedQuantitiesAndLengths[index] || [];
      const qxL = formatQxL(pathQL);
      const foldsPerPiece = calculateFoldsPerPiece(path);
      const girth = calculateGirth(path);
      const totalQuantity = calculateTotalQuantity(pathQL);
      const totalFolds = foldsPerPiece * totalQuantity;

      grandTotalQuantity += totalQuantity;
      grandTotalFolds += totalFolds;

      if (index % 2 === 0) {
        doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
           .fill(COLORS.lightBg);
      } else {
        doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
           .fill(COLORS.altBg);
      }

      const row = [
        `${index + 1}`,
        path.name || 'Unnamed',
        path.color || 'N/A',
        path.code || 'N/A',
        totalQuantity.toString(),
        foldsPerPiece.toString(),
        `${girth} mm`,
        qxL || 'N/A',
        totalFolds.toString()
      ];

      xPos = margin;
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);
      row.forEach((val, i) => {
        if (i === 3) doc.fillColor(COLORS.red);
        doc.text(val, xPos + 5, y + 6, { width: colWidths[i] - 10, align: 'center' });
        doc.fillColor(COLORS.text);
        xPos += colWidths[i];
      });

      doc.moveTo(margin, y + rowHeight)
         .lineTo(pageWidth - margin, y + rowHeight)
         .lineWidth(0.5)
         .strokeColor(COLORS.border)
         .stroke();

      y += rowHeight;

      if (y > pageHeight - 80) {
        doc.addPage();
        pageNumber++;
        y = drawHeader(doc, pageWidth, 0, pageNumber);
        y = drawSectionHeader(doc, 'Order Summary (Continued)', y, pageWidth);

        doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
           .fill(COLORS.altBg);

        xPos = margin;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.primary);
        headers.forEach((h, i) => {
          doc.text(h, xPos + 5, y + 6, { width: colWidths[i] - 10, align: 'center' });
          xPos += colWidths[i];
        });

        y += rowHeight;
      }
    });

    // Totals row
    doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
       .fill(COLORS.altBg);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.primary);
    xPos = margin;
    doc.text('Totals', xPos + 5, y + 6, { width: colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 40, align: 'left' });

    xPos += colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    doc.text(grandTotalQuantity.toString(), xPos + 5, y + 6, { width: colWidths[4] - 10, align: 'center' });

    xPos += colWidths[4] + colWidths[5] + colWidths[6];
    doc.text(grandTotalFolds.toString(), xPos + 5, y + 6, { width: colWidths[8] - 10, align: 'center' });

    // Draw vertical lines for the entire table
    xPos = margin;
    for (let i = 0; i <= headers.length; i++) {
      doc.moveTo(xPos, y - rowHeight * (validPaths.length + 1))
         .lineTo(xPos, y + rowHeight)
         .lineWidth(0.5)
         .strokeColor(COLORS.border)
         .stroke();
      if (i < headers.length) xPos += colWidths[i];
    }

    // Outer table border
    doc.rect(margin, y - rowHeight * (validPaths.length + 1), pageWidth - 2 * margin, rowHeight * (validPaths.length + 2))
       .lineWidth(1)
       .strokeColor(COLORS.accent)
       .stroke();

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, pageHeight);
    }

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const uploadResult = await cloudinary.uploader.upload(pdfPath, {
      folder: 'freelancers/orders',
      resource_type: 'raw',
      access_mode: 'public',
    });

    await new UserPdf({
      userId,
      pdfUrl: uploadResult.secure_url,
    }).save();

    await fsPromises.unlink(pdfPath);

    return res.status(200).json({
      message: 'PDF generated and uploaded successfully',
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};
