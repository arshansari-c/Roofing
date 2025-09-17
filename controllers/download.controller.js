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

// Cloudinary config (fixed typo: CLOUDNARY -> CLOUDINARY)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API,
  api_secret: process.env.CLOUDINARY_SECRET,
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

// Professional color scheme (enhanced with more shades for depth)
const COLORS = {
  primary: '#1a4f72',       // Dark blue for headers
  secondary: '#3b82f6',     // Blue for accents
  accent: '#ef4444',        // Red for important elements
  lightBg: '#f9fafb',       // Light gray for backgrounds
  darkText: '#1f2937',      // Dark gray for text
  border: '#d1d5db',        // Light gray for borders
  tableHeader: '#e5e7eb',   // Table header background
  tableRow: '#f9fafb',      // Table row background
  success: '#22c55e',       // Green for positive indicators
  warning: '#eab308',       // Yellow for warnings
  shadow: '#9ca3af',        // Gray for shadows/effects
};

// Font settings (added more variations for professional look)
const FONTS = {
  title: 'Helvetica-Bold',
  subtitle: 'Helvetica-Bold',
  body: 'Helvetica',
  tableHeader: 'Helvetica-Bold',
  tableBody: 'Helvetica',
  code: 'Courier-Bold',     // Added for codes
  note: 'Helvetica-Oblique' // Italic for notes
};

// Configuration constants (adjusted for better visuals)
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 12;      // Increased for better visibility
const CHEVRON_SIZE = 10;    // Adjusted
const HOOK_RADIUS = 8;
const ZIGZAG_SIZE = 10;     // Adjusted
const LABEL_PADDING = 8;    // New: padding inside labels
const BORDER_WIDTH = 1.5;   // New: for borders

// Helper function to validate points (improved with logging)
const validatePoints = (points) => {
  if (!Array.isArray(points) || points.length === 0) {
    console.warn('Points array is empty or not an array');
    return false;
  }
  const isValid = points.every(point =>
    point &&
    typeof point.x !== 'undefined' &&
    typeof point.y !== 'undefined' &&
    !isNaN(parseFloat(point.x)) &&
    !isNaN(parseFloat(point.y))
  );
  if (!isValid) {
    console.warn('Invalid points detected:', points);
  }
  return isValid;
};

// Helper function to calculate bounds (enhanced for precision and large diagrams)
const calculateBounds = (path, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Invalid points array in path:', path);
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }; // Fallback bounds
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Process points with floating-point precision
  path.points.forEach((point) => {
    const x = parseFloat(point.x);
    const y = parseFloat(point.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  // Detect large diagrams
  const width = maxX - minX;
  const height = maxY - minY;
  const isLargeDiagram = (width > 10000 || height > 10000);

  // Process segments (improved label bounding)
  path.segments.forEach((segment, i) => {
    if (!segment.labelPosition || typeof segment.labelPosition.x === 'undefined' || typeof segment.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 40 / scale); // Increased buffer
    maxX = Math.max(maxX, labelX + 40 / scale);
    minY = Math.min(minY, labelY - 25 / scale);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 25 / scale);

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
        const foldLabelX = foldEndX + rotNormalX * 30; // Increased for better spacing
        const foldLabelY = foldEndY + rotNormalY * 30;
        minX = Math.min(minX, foldLabelX - 40, foldEndX, foldBaseX);
        maxX = Math.max(maxX, foldLabelX + 40, foldEndX, foldBaseX);
        minY = Math.min(minY, foldLabelY - 25, foldEndY, foldBaseY);
        maxY = Math.max(maxY, foldLabelY + ARROW_SIZE + 25, foldEndY, foldBaseY);
      }
    }
  });

  // Process angles (skip 90/270, improved bounding)
  (path.angles || []).forEach((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return;
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    if (Math.round(angleValue) === 90 || Math.round(angleValue) === 270) {
      return;
    }
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, labelX - 40);
    maxX = Math.max(maxX, labelX + 40);
    minY = Math.min(minY, labelY - 25);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 25);
  });

  // Border offset segments (improved)
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
          const chevronSize = 10; // Adjusted
          const chevronBaseDistance = 12; // Adjusted
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

  // Proportional padding for large/small diagrams
  const basePadding = 50;
  const proportionalPadding = Math.max(width, height) * 0.05;
  const padding = isLargeDiagram ? Math.max(basePadding, proportionalPadding) : basePadding;

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
};

// Helper function to calculate offset segments for border (enhanced with thickness)
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

// Helper function to calculate total folds (no change, solid)
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

// Helper function to calculate girth (assume lengths in mm, fixed label to mm)
const calculateGirth = (path) => {
  let totalLength = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      const lengthStr = segment.length || '0';
      const lengthNum = parseFloat(lengthStr.replace(/[^0-9.]/g, '')) || 0;
      totalLength += lengthNum;
    });
  }
  return totalLength.toFixed(2);
};

// Helper function to format Q x L (improved with sorting)
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  // Sort by length descending for professional presentation
  const sorted = [...quantitiesAndLengths].sort((a, b) => parseFloat(b.length) - parseFloat(a.length));
  return sorted.map(item => `${item.quantity}x${parseFloat(item.length).toFixed(0)}`).join(', ');
};

// Helper function to generate SVG string (major improvements: better arrows, text, UI)
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Skipping SVG generation for path due to invalid points:', path);
    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';
  }
  // Bounds and scaling (improved for high-res)
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const targetViewBoxSize = 1200; // Increased for better resolution
  const scaleFactor = targetViewBoxSize * 0.85 / Math.max(width, height, 1); // Tighter fit
  const offsetX = (targetViewBoxSize - width * scaleFactor) / 2;
  const offsetY = (targetViewBoxSize - height * scaleFactor) / 2;

  const viewBox = `0 0 ${targetViewBoxSize} ${targetViewBoxSize}`;
  const transformCoord = (x, y) => {
    return {
      x: (parseFloat(x) - bounds.minX) * scaleFactor + offsetX,
      y: (parseFloat(y) - bounds.minY) * scaleFactor + offsetY
    };
  };

  // Grid lines (thinner, more subtle)
  let gridLines = '';
  const gridSize = GRID_SIZE;
  const gridStartX = Math.floor(bounds.minX / gridSize) * gridSize;
  const gridStartY = Math.floor(bounds.minY / gridSize) * gridSize;
  const gridEndX = Math.ceil(bounds.maxX / gridSize) * gridSize;
  const gridEndY = Math.ceil(bounds.maxY / gridSize) * gridSize;
  for (let x = gridStartX; x <= gridEndX; x += gridSize) {
    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);
    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${COLORS.border}" stroke-width="${0.3 * scaleFactor}" stroke-opacity="0.5"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += gridSize) {
    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);
    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${COLORS.border}" stroke-width="${0.3 * scaleFactor}" stroke-opacity="0.5"/>`;
  }

  // Path points and lines (thicker lines for main path)
  let svgContent = path.points.map((point) => {
    const {x: cx, y: cy} = transformCoord(point.x, point.y);
    return `<circle cx="${cx}" cy="${cy}" r="${4 * scaleFactor}" fill="${COLORS.primary}" stroke="${COLORS.darkText}" stroke-width="${1 * scaleFactor}"/>`; // Improved circles
  }).join('');
  if (path.points.length > 1) {
    const d = path.points.map(p => {
      const {x, y} = transformCoord(p.x, p.y);
      return `${x},${y}`;
    }).join(' L');
    svgContent += `<path d="M${d}" stroke="${COLORS.primary}" stroke-width="${3 * scaleFactor}" fill="none" stroke-linecap="round"/>`; // Rounded caps
  }

  // Offset segments for border (dashed with better style)
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    svgContent += offsetSegments.map((segment) => {
      const {x: x1, y: y1} = transformCoord(segment.p1.x, segment.p1.y);
      const {x: x2, y: y2} = transformCoord(segment.p2.x, segment.p2.y);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.shadow}" stroke-width="${4 * scaleFactor}" stroke-dasharray="${8 * scaleFactor},${5 * scaleFactor}" stroke-opacity="0.8"/>`;
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
          const chevronBaseDistance = 12;
          const chevronXView = midXView + normalX * chevronBaseDistance * scaleFactor;
          const chevronYView = midYView + normalY * chevronBaseDistance * scaleFactor;
          const chevronSize = 10 * scaleFactor;
          const direction = 1;
          // Improved chevron: filled arrow for professional look
          const chevronPath = `
            M${chevronXView + chevronSize * normalX * direction + chevronSize * unitX},${chevronYView + chevronSize * normalY * direction + chevronSize * unitY}
            L${chevronXView},${chevronYView}
            L${chevronXView + chevronSize * normalX * direction - chevronSize * unitX},${chevronYView + chevronSize * normalY * direction - chevronSize * unitY}
            Z
          `;
          svgContent += `<path d="${chevronPath}" stroke="${COLORS.accent}" stroke-width="${2 * scaleFactor}" fill="${COLORS.accent}" opacity="0.9"/>`;
        }
      }
    }
  }

  // Label design parameters (improved: larger, rounded, shadow)
  const labelWidth = 70;
  const labelHeight = 35;
  const labelRadius = 12;
  const fontSize = 18;
  const tailSize = 8;
  const attachSize = 8;
  const labelBg = '#FFFFFF';
  const labelText = COLORS.primary;
  const tailFill = COLORS.shadow;

  // Segments with labels, tails, folds (improved text alignment, bold text)
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
          x: foldEnd.x + rotNormalX * 30 * scaleFactor,
          y: foldEnd.y + rotNormalY * 30 * scaleFactor
        };
        const foldColor = COLORS.secondary;
        const foldDirX = unitX;
        const foldDirY = unitY;
        let foldPath = '';
        const chevronSizeAdj = CHEVRON_SIZE * scaleFactor;
        const hookRadiusAdj = HOOK_RADIUS * scaleFactor;
        const zigzagAdj = ZIGZAG_SIZE * scaleFactor;
        if (foldType === 'Crush') {
          const chevron1 = foldEnd;
          const chevron2 = {
            x: foldEnd.x - rotNormalX * 4 * scaleFactor,
            y: foldEnd.y - rotNormalY * 4 * scaleFactor
          };
          foldPath = `
            M${chevron1.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * foldDirX},${chevron1.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * foldDirY}
            L${chevron1.x},${chevron1.y}
            L${chevron1.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * foldDirX},${chevron1.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * foldDirY}
            M${chevron2.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * foldDirX},${chevron2.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * foldDirY}
            L${chevron2.x},${chevron2.y}
            L${chevron2.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * foldDirX},${chevron2.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * foldDirY}
          `;
          foldElement = `<path d="${foldPath}" stroke="${foldColor}" stroke-width="${2.5 * scaleFactor}" fill="none" stroke-linecap="round"/>`;
        } else if (foldType === 'Crush Hook') {
          const arcPath = `M${foldBase.x},${foldBase.y} L${foldEnd.x},${foldEnd.y} A${hookRadiusAdj},${hookRadiusAdj} 0 0 1 ${foldEnd.x + hookRadiusAdj * foldDirX},${foldEnd.y + hookRadiusAdj * foldDirY}`;
          foldElement = `<path d="${arcPath}" stroke="${foldColor}" stroke-width="${2.5 * scaleFactor}" fill="none" stroke-linecap="round"/>`;
        } else if (foldType === 'Break') {
          const mid = {
            x: foldBase.x + rotNormalX * (foldLength / 2) * scaleFactor,
            y: foldBase.y + rotNormalY * (foldLength / 2) * scaleFactor
          };
          const zigzagPath = `
            M${foldBase.x},${foldBase.y}
            L${mid.x + zigzagAdj * foldDirX},${mid.y + zigzagAdj * foldDirY}
            L${mid.x - zigzagAdj * foldDirX},${mid.y - zigzagAdj * foldDirY}
            L${foldEnd.x},${foldEnd.y}
          `;
          foldElement = `<path d="${zigzagPath}" stroke="${foldColor}" stroke-width="${2.5 * scaleFactor}" fill="none" stroke-linecap="round"/>`;
        } else if (foldType === 'Open') {
          foldElement = `<line x1="${foldBase.x}" y1="${foldBase.y}" x2="${foldEnd.x}" y2="${foldEnd.y}" stroke="${foldColor}" stroke-width="${2.5 * scaleFactor}" stroke-linecap="round"/>`;
        }
        const foldArrowX = foldLabelPos.x;
        const foldArrowY = foldLabelPos.y + 25 * scaleFactor;
        const foldArrowDx = foldBase.x - foldArrowX;
        const foldArrowDy = foldBase.y - foldArrowY;
        const foldArrowDist = Math.sqrt(foldArrowDx * foldArrowDx + foldArrowDy * foldArrowDy) || 1;
        const foldArrowUnitX = foldArrowDx / foldArrowDist;
        const foldArrowUnitY = foldArrowDy / foldArrowDist;
        // Improved arrow: filled triangle
        const arrowSizeAdj = ARROW_SIZE * scaleFactor;
        const foldArrowPath = `
          M${foldArrowX},${foldArrowY}
          L${foldArrowX - arrowSizeAdj * foldArrowUnitX + (arrowSizeAdj / 2) * foldArrowUnitY},${foldArrowY - arrowSizeAdj * foldArrowUnitY - (arrowSizeAdj / 2) * foldArrowUnitX}
          L${foldArrowX - arrowSizeAdj * foldArrowUnitX - (arrowSizeAdj / 2) * foldArrowUnitY},${foldArrowY - arrowSizeAdj * foldArrowUnitY + (arrowSizeAdj / 2) * foldArrowUnitX}
          Z
        `;
        foldElement += `
          <text x="${foldLabelPos.x}" y="${foldLabelPos.y}" font-size="${16 * scaleFactor}" font-weight="bold" fill="${foldColor}" text-anchor="middle" alignment-baseline="middle">
            ${foldType}
          </text>
          <path d="${foldArrowPath}" fill="${foldColor}" stroke="${foldColor}" stroke-width="${1.5 * scaleFactor}"/>
        `;
      }
    }
    // Improved label: added shadow for depth
    return `
      <g filter="url(#labelShadow)">
        <rect x="${posX - labelWidth/2}" y="${posY - labelHeight/2}"
              width="${labelWidth}" height="${labelHeight}"
              fill="${labelBg}" rx="${labelRadius}"
              stroke="${COLORS.border}" stroke-width="1"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}"
              fill="${labelText}" text-anchor="middle" alignment-baseline="middle" font-weight="bold">
          ${segment.length}
        </text>
        ${foldElement}
      </g>
    `;
  }).join('');

  // Angles with labels and tails (improved text, skipped 90/270)
  svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return '';
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270) {
      return '';
    }
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
    // Improved angle label: bold degree symbol
    return `
      <g filter="url(#labelShadow)">
        <rect x="${posX - labelWidth / 2}" y="${posY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" fill="${labelBg}" rx="${labelRadius}" stroke="${COLORS.border}" stroke-width="1"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" fill="${labelText}" text-anchor="middle" alignment-baseline="middle" font-weight="bold">
          ${roundedValue}°
        </text>
      </g>
    `;
  }).join('');

  // Add defs for filters (shadow for labels)
  const defs = `
    <defs>
      <filter id="labelShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
        <feOffset dx="2" dy="2" result="offsetblur"/>
        <feFlood flood-color="${COLORS.shadow}" flood-opacity="0.5"/>
        <feComposite in2="offsetblur" operator="in"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
  `;

  return `<svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
    ${defs}
    <g>${gridLines}</g>
    <g>${svgContent}</g>
  </svg>`;
};

// Helper function to draw header (improved with shadow effect)
const drawHeader = (doc, pageWidth, y, pageNumber = null) => {
  const margin = 50;

  // Header background with gradient
  const gradient = doc.linearGradient(0, 0, pageWidth, 80)
    .stop(0, COLORS.primary)
    .stop(1, COLORS.secondary);

  doc.rect(0, 0, pageWidth, 80)
     .fill(gradient);

  // Business info (bold title)
  doc.font(FONTS.title)
     .fontSize(18) // Larger
     .fillColor('#FFFFFF')
     .text('COMMERCIAL ROOFERS PTY LTD', margin, 15);

  doc.font(FONTS.body)
     .fontSize(11)
     .fillColor('#FFFFFF')
     .text('info@commercialroofers.net.au | 0421259430', margin, 40);

  // Logo
  try {
    const logo = doc.openImage(logoPath);
    const logoHeight = 45;
    const logoWidth = (logo.width * logoHeight) / logo.height;
    doc.image(logo, pageWidth - margin - logoWidth, 15, {
      width: logoWidth,
      height: logoHeight
    });
  } catch (err) {
    console.warn('Failed to load logo:', err.message);
  }

  // Page number
  if (pageNumber) {
    doc.font(FONTS.body)
       .fontSize(11)
       .fillColor('#FFFFFF')
       .text(`Page ${pageNumber}`, pageWidth - margin, 50, { align: 'right' });
  }

  // Divider with shadow
  doc.moveTo(margin, 75)
     .lineTo(pageWidth - margin, 75)
     .strokeColor('#FFFFFF')
     .lineWidth(1.5)
     .stroke();

  return y + 85;
};

// Helper function to draw section header (improved with icon-like underline)
const drawSectionHeader = (doc, text, y) => {
  const margin = 50;

  doc.font(FONTS.subtitle)
     .fontSize(16)
     .fillColor(COLORS.primary)
     .text(text, margin, y);

  // Underline
  doc.moveTo(margin, y + 20)
     .lineTo(margin + 200, y + 20)
     .strokeColor(COLORS.accent)
     .lineWidth(2)
     .stroke();

  return y + 30;
};

// Helper function to draw order details table (improved spacing, icons)
const drawOrderDetailsTable = (doc, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const tableWidth = pageWidth - 2 * margin;
  const rowHeight = 28;
  const colWidth = tableWidth / 2;

  // Table header
  doc.rect(margin, y, tableWidth, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader)
     .fontSize(13)
     .fillColor(COLORS.primary)
     .text('ORDER DETAILS', margin + 10, y + 8);

  y += rowHeight;

  // Rows with bullet-like prefix
  const rows = [
    ['JOB REFERENCE', JobReference],
    ['PO NUMBER', Number],
    ['ORDER CONTACT', OrderContact],
    ['ORDER DATE', OrderDate],
    ['DELIVERY ADDRESS', DeliveryAddress || 'PICKUP']
  ];

  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) {
      doc.rect(margin, y, tableWidth, rowHeight)
         .fill(COLORS.tableRow);
    }

    doc.font(FONTS.tableHeader)
       .fontSize(11)
       .fillColor(COLORS.darkText)
       .text(`• ${label}`, margin + 10, y + 8);

    doc.font(FONTS.tableBody)
       .fontSize(11)
       .fillColor(COLORS.darkText)
       .text(value, margin + colWidth, y + 8);

    doc.moveTo(margin, y + rowHeight)
       .lineTo(pageWidth - margin, y + rowHeight)
       .strokeColor(COLORS.border)
       .lineWidth(0.5)
       .stroke();

    y += rowHeight;
  });

  return y + 25;
};

// Helper function to draw instructions (improved with bullets, bold warning)
const drawInstructions = (doc, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;

  y = drawSectionHeader(doc, 'IMPORTANT NOTES', y);

  const instructions = [
    '• Arrow points to the (solid) coloured side',
    '• 90° degrees are not labelled',
    '• F = Total number of folds, each crush counts as 2 folds'
  ];

  instructions.forEach(instruction => {
    doc.font(FONTS.body)
       .fontSize(11)
       .fillColor(COLORS.darkText)
       .text(instruction, margin, y, {
         width: pageWidth - 2 * margin,
         align: 'left'
       });

    y += 18;
  });

  // Warning with gradient background
  const warningGradient = doc.linearGradient(margin, y + 10, pageWidth - margin, y + 35)
    .stop(0, '#fee2e2')
    .stop(1, '#fecaca');

  doc.rect(margin, y + 10, pageWidth - 2 * margin, 25)
     .fill(warningGradient);

  doc.font(FONTS.subtitle)
     .fontSize(12)
     .fillColor(COLORS.accent)
     .text('*** PLEASE WRITE ALL CODES ON FLASHINGS ***', margin, y + 18, {
       width: pageWidth - 2 * margin,
       align: 'center'
     });

  return y + 50;
};

// Helper function to draw footer (improved with date/time format)
const drawFooter = (doc, pageWidth, pageHeight) => {
  const margin = 50;

  doc.moveTo(margin, pageHeight - 45)
     .lineTo(pageWidth - margin, pageHeight - 45)
     .strokeColor(COLORS.border)
     .lineWidth(0.5)
     .stroke();

  doc.font(FONTS.note)
     .fontSize(10)
     .fillColor(COLORS.darkText)
     .text('This order made possible thanks to the Flash.it Roofing App', 
           pageWidth / 2, pageHeight - 35, 
           { align: 'center' });
           
  doc.font(FONTS.body)
     .fontSize(9)
     .fillColor(COLORS.darkText)
     .text(`Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, 
           pageWidth / 2, pageHeight - 20, 
           { align: 'center' });
};

// Improved diagram property table (added colors, better alignment)
const drawDiagramPropertyTable = (doc, x, y, pathData, qxL, totalFolds, girth) => {
  const tableWidth = 230; // Wider
  const rowHeight = 22;
  const colWidths = [100, 130];

  const rows = [
    ['Name', pathData.name || 'Unnamed'],
    ['Colour', pathData.color || 'N/A'],
    ['Code', pathData.code || 'N/A'],
    ['Q x L', qxL || 'N/A'],
    ['Folds (F)', totalFolds.toString()],
    ['Girth', `${girth}mm`],
    ['Total (T)', totalFolds.toString()]
  ];

  // Header
  doc.rect(x, y, tableWidth, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
  doc.text('PROPERTY', x + 5, y + 6, { width: colWidths[0] - 10, align: 'left' });
  doc.text('VALUE', x + colWidths[0] + 5, y + 6, { width: colWidths[1] - 10, align: 'left' });

  y += rowHeight;

  // Rows
  rows.forEach((row, index) => {
    if (index % 2 === 0) {
      doc.rect(x, y, tableWidth, rowHeight)
         .fill(COLORS.tableRow);
    }

    doc.font(FONTS.tableBody).fontSize(10).fillColor(COLORS.darkText);
    doc.text(row[0], x + 5, y + 6, { width: colWidths[0] - 10, align: 'left' });

    if (row[0] === 'Code') {
      doc.fillColor(COLORS.accent).font(FONTS.code);
    } else if (row[0] === 'Girth') {
      doc.fillColor(COLORS.success);
    }
    doc.text(row[1], x + colWidths[0] + 5, y + 6, { width: colWidths[1] - 10, align: 'left' });
    doc.fillColor(COLORS.darkText); // Reset

    y += rowHeight;
  });

  // Borders
  doc.rect(x, y - rowHeight * rows.length - rowHeight, tableWidth, rowHeight * (rows.length + 1))
     .lineWidth(1.2)
     .strokeColor(COLORS.border)
     .stroke();

  doc.moveTo(x + colWidths[0], y - rowHeight * rows.length - rowHeight)
     .lineTo(x + colWidths[0], y)
     .lineWidth(0.6)
     .strokeColor(COLORS.border)
     .stroke();

  return y;
};

// Helper function to draw summary table (added totals row)
const drawSummaryTable = (doc, validPaths, groupedQuantitiesAndLengths, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

  const headers = ['#', 'Name', 'Colour', 'Code', 'F', 'GIRTH', 'Q x L', 'T'];
  const colWidths = [25, 80, 80, 70, 35, 65, 110, 35];
  const rowHeight = 22;

  // Header
  let xPos = margin;
  doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
  headers.forEach((h, i) => {
    doc.text(h, xPos + 5, y + 6, { width: colWidths[i] - 10, align: 'center' });
    xPos += colWidths[i];
  });

  y += rowHeight;

  // Rows
  let grandTotalFolds = 0;
  doc.font(FONTS.tableBody).fontSize(10);
  validPaths.forEach((path, index) => {
    const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[index] || [];
    const qxL = formatQxL(pathQuantitiesAndLengths);
    const totalFolds = calculateTotalFolds(path);
    grandTotalFolds += totalFolds;
    const girth = calculateGirth(path);

    if (index % 2 === 0) {
      doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
         .fill(COLORS.tableRow);
    }

    const row = [
      `${index + 1}`,
      path.name || 'Unnamed',
      path.color || 'N/A',
      path.code || 'N/A',
      totalFolds.toString(),
      `${girth}mm`,
      qxL || 'N/A',
      totalFolds.toString()
    ];

    xPos = margin;
    row.forEach((val, i) => {
      if (i === 3) { // Code
        doc.fillColor(COLORS.accent).font(FONTS.code);
      } else if (i === 5) { // Girth
        doc.fillColor(COLORS.success);
      } else {
        doc.fillColor(COLORS.darkText);
      }
      doc.text(val, xPos + 5, y + 6, {
        width: colWidths[i] - 10,
        align: 'center'
      });
      doc.font(FONTS.tableBody); // Reset font
      xPos += colWidths[i];
    });

    doc.moveTo(margin, y + rowHeight)
       .lineTo(pageWidth - margin, y + rowHeight)
       .strokeColor(COLORS.border)
       .lineWidth(0.5)
       .stroke();

    y += rowHeight;

    if (y > pageHeight - 60) {
      doc.addPage();
      const newPageY = drawHeader(doc, pageWidth, 0, doc.bufferedPageRange().count + 1);
      y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', newPageY) + rowHeight;

      xPos = margin;
      doc.rect(margin, y - rowHeight, pageWidth - 2 * margin, rowHeight)
         .fill(COLORS.tableHeader);

      doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
      headers.forEach((h, i) => {
        doc.text(h, xPos + 5, y - rowHeight + 6, { width: colWidths[i] - 10, align: 'center' });
        xPos += colWidths[i];
      });
    }
  });

  // Add totals row
  doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
  doc.text('TOTALS', margin + 5, y + 6, { width: tableWidth - 200, align: 'right' });
  doc.text(grandTotalFolds.toString(), pageWidth - margin - 70, y + 6, { width: 60, align: 'center' });

  y += rowHeight + 25;

  return y;
};

export const generatePdfDownload = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems } = req.body;
    const { userId } = req.params;

    // Input validation (enhanced)
    if (!JobReference || !Number || !OrderContact || !OrderDate) {
      return res.status(400).json({ message: 'JobReference, Number, OrderContact, and OrderDate are required' });
    }

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Valid userId is required' });
    }

    if (!uploadsDir) {
      console.error('Uploads directory is not defined');
      return res.status(500).json({ message: 'Uploads directory is not defined' });
    }

    const QuantitiesAndLengths = selectedProjectData?.QuantitiesAndLengths || [];
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0) {
      return res.status(400).json({ message: 'QuantitiesAndLengths must be a non-empty array' });
    }

    for (const item of QuantitiesAndLengths) {
      if (!item.quantity || !item.length) {
        return res.status(400).json({ message: 'Each QuantitiesAndLengths item must have quantity and length' });
      }
    }

    const additionalItemsText = AdditionalItems || '';

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

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

    // PDF setup (A4, improved metadata)
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `Flashing Order - ${JobReference}`,
        Author: 'Commercial Roofers Pty Ltd',
        Subject: 'Roofing Flashing Order Document',
        Keywords: 'roofing, flashing, order, pdf',
        Creator: 'Flash.it Roofing App',
        CreationDate: new Date(),
      }
    });

    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    console.log('Saving PDF to:', pdfPath);

    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 50;
    const imgSize = 220; // Larger images
    const gap = 35;

    // Page 1
    let y = drawHeader(doc, pageWidth, 0, 1);

    y = drawOrderDetailsTable(doc, JobReference, Number, OrderContact, OrderDate, 
                             DeliveryAddress || PickupNotes, y);

    y = drawInstructions(doc, y);

    // Diagrams (improved layout: 2 per row, more space)
    const pathsPerRow = 2;
    const firstPageMaxPaths = 2;
    const remainingPathsPerPage = 4;

    const firstPagePaths = Math.min(firstPageMaxPaths, validPaths.length);
    const totalImagePages = firstPagePaths > 0 ? 1 + Math.ceil((validPaths.length - firstPagePaths) / remainingPathsPerPage) : 0;

    if (firstPagePaths > 0) {
      y = drawSectionHeader(doc, `FLASHING DETAILS - PART 1 OF ${totalImagePages}`, y);

      const startX = margin;
      const startY = y;

      for (let i = 0; i < firstPagePaths; i++) {
        const row = Math.floor(i / pathsPerRow);
        const col = i % pathsPerRow;
        const x = startX + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + gap + 200); // More space for table

        try {
          const pathData = validPaths[i];
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize({
              width: imgSize * 5, // Higher res
              height: imgSize * 5,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png({ quality: 100, compressionLevel: 0 })
            .toBuffer();

          // Shadow border
          doc.rect(x - 8, yPos - 8, imgSize + 16, imgSize + 16)
             .fill(COLORS.shadow)
             .rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
             .fill('#FFFFFF')
             .rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
             .lineWidth(1.2)
             .strokeColor(COLORS.border)
             .stroke();

          const img = doc.openImage(imageBuffer);
          const imgW = imgSize;
          const imgH = (img.height * imgW) / img.width;

          doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

          const infoY = yPos + imgH + 20;
          const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[i] || [];
          const qxL = formatQxL(pathQuantitiesAndLengths);
          const totalFolds = calculateTotalFolds(pathData);
          const girth = calculateGirth(pathData);

          drawDiagramPropertyTable(doc, x - 10, infoY, pathData, qxL, totalFolds, girth);
        } catch (err) {
          console.warn(`Image error (path ${i}):`, err.message);
          doc.font('Helvetica').fontSize(16)
            .text(`Diagram unavailable`, x, yPos);
        }
      }

      y = startY + Math.ceil(firstPagePaths / pathsPerRow) * (imgSize + gap + 200);
    }

    // Remaining diagrams
    const remainingPathsCount = validPaths.length - firstPagePaths;
    if (remainingPathsCount > 0) {
      const remainingPagesNeeded = Math.ceil(remainingPathsCount / remainingPathsPerPage);

      for (let pageIndex = 0; pageIndex < remainingPagesNeeded; pageIndex++) {
        doc.addPage();
        const pageNumber = doc.bufferedPageRange().count;

        y = drawHeader(doc, pageWidth, 0, pageNumber);
        y = drawSectionHeader(doc, `FLASHING DETAILS - PART ${pageIndex + 2} OF ${totalImagePages}`, y);

        const startPath = firstPagePaths + pageIndex * remainingPathsPerPage;
        const endPath = Math.min(startPath + remainingPathsPerPage, validPaths.length);
        const startX = margin;
        const startY = y;

        for (let j = 0; j < (endPath - startPath); j++) {
          const i = startPath + j;
          const row = Math.floor(j / pathsPerRow);
          const col = j % pathsPerRow;
          const x = startX + col * (imgSize + gap);
          const yPos = startY + row * (imgSize + gap + 200);

          try {
            const pathData = validPaths[i];
            const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
            const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

            const imageBuffer = await sharp(Buffer.from(svgString))
              .resize({
                width: imgSize * 5,
                height: imgSize * 5,
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              })
              .png({ quality: 100, compressionLevel: 0 })
              .toBuffer();

            doc.rect(x - 8, yPos - 8, imgSize + 16, imgSize + 16)
               .fill(COLORS.shadow)
               .rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
               .fill('#FFFFFF')
               .rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
               .lineWidth(1.2)
               .strokeColor(COLORS.border)
               .stroke();

            const img = doc.openImage(imageBuffer);
            const imgW = imgSize;
            const imgH = (img.height * imgW) / img.width;

            doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

            const infoY = yPos + imgH + 20;
            const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[i] || [];
            const qxL = formatQxL(pathQuantitiesAndLengths);
            const totalFolds = calculateTotalFolds(pathData);
            const girth = calculateGirth(pathData);

            drawDiagramPropertyTable(doc, x - 10, infoY, pathData, qxL, totalFolds, girth);
          } catch (err) {
            console.warn(`Image error (path ${i}):`, err.message);
            doc.font('Helvetica').fontSize(16)
              .text(`Diagram unavailable`, x, yPos);
          }
        }

        y = startY + Math.ceil((endPath - startPath) / pathsPerRow) * (imgSize + gap + 200);
      }
    }

    // Summary on new page
    doc.addPage();
    const lastPageNumber = doc.bufferedPageRange().count;
    y = drawHeader(doc, pageWidth, 0, lastPageNumber);
    y = drawSummaryTable(doc, validPaths, groupedQuantitiesAndLengths, y);

    // Footers on all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, pageHeight);
    }

    doc.flushPages();
    doc.end();

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

    const exists = await fsPromises.access(pdfPath).then(() => true).catch(() => false);
    if (!exists) {
      console.error('PDF file not found at:', pdfPath);
      return res.status(500).json({ message: 'PDF file not generated' });
    }

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

    try {
      await new UserPdf({
        userId: userId,
        pdfUrl: uploadResult.secure_url,
      }).save();
      console.log('Project order saved successfully');
    } catch (dbError) {
      console.error('Database save error:', dbError.message);
      return res.status(500).json({ message: 'Failed to save order in database', error: dbError.message });
    }

    try {
      await fsPromises.unlink(pdfPath);
      console.log('Local PDF deleted successfully:', pdfPath);
    } catch (deleteError) {
      console.warn('Failed to delete local PDF:', deleteError.message);
    }

    return res.status(200).json({
      message: 'PDF generated successfully',
      localPath: pdfPath,
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('GeneratePdf error:', error.message);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
