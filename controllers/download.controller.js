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

// Professional color scheme (enhanced with more options for professionalism)
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
  warning: '#f59e0b',       // Yellow for warnings
  shadow: '#00000033',      // Semi-transparent black for shadows
};

// Font settings (added more font variations for professional look)
const FONTS = {
  title: 'Helvetica-Bold',
  subtitle: 'Helvetica-Bold',
  body: 'Helvetica',
  tableHeader: 'Helvetica-Bold',
  tableBody: 'Helvetica',
  italic: 'Helvetica-Oblique',
  monospace: 'Courier',
};

// Configuration constants (added more for enhanced UI)
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 12;      // Increased for better visibility
const CHEVRON_SIZE = 10;    // Adjusted
const HOOK_RADIUS = 8;
const ZIGZAG_SIZE = 9;
const LABEL_PADDING = 8;    // New: Padding for labels
const SHADOW_OFFSET = 2;    // New: For drop shadows in SVG
const SCALE_BAR_LENGTH = 100; // New: For adding scale bars in diagrams

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
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return;
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    if (Math.round(angleValue) === 90 || Math.round(angleValue) === 270) {
      return;
    }
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

          // FIXED: Swapped normal vector for inside/outside to correct the direction
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

    // FIXED: Swapped normal vector for inside/outside to correct the direction
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

// Improved: Generate SVG string with professional enhancements
// - Added drop shadows for labels
// - Used marker for arrows
// - Better text alignment and font-family
// - Added scale bar
// - Improved arrow designs (filled arrows with better proportions)
// - Added legend for folds if applicable
// - Enhanced grid with major/minor lines
// - Title in SVG
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Skipping SVG generation for path due to invalid points:', path);
    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';
  }
  // Check if this is a large diagram
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  const targetViewBoxSize = 1200; // Increased for higher resolution
  const scaleFactor = targetViewBoxSize * 0.85 / Math.max(width, height, 1); // Slightly adjusted padding
  const offsetX = (targetViewBoxSize - width * scaleFactor) / 2;
  const offsetY = (targetViewBoxSize - height * scaleFactor) / 2;

  const viewBox = `0 0 ${targetViewBoxSize} ${targetViewBoxSize}`;
  const transformCoord = (x, y) => {
    return {
      x: (parseFloat(x) - bounds.minX) * scaleFactor + offsetX,
      y: (parseFloat(y) - bounds.minY) * scaleFactor + offsetY
    };
  };
  // Adjusted sizes
  const adjScale = scale;

  // New: Add drop shadow filter
  let svgDefs = `
    <defs>
      <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="${SHADOW_OFFSET * scaleFactor}" />
        <feOffset dx="${SHADOW_OFFSET * scaleFactor}" dy="${SHADOW_OFFSET * scaleFactor}" result="offsetblur" />
        <feFlood flood-color="${COLORS.shadow}" />
        <feComposite in2="offsetblur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <marker id="arrowHead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#000000" />
      </marker>
    </defs>
  `;

  // Improved grid: Major and minor lines
  let gridLines = '';
  const minorGridSize = GRID_SIZE / 2;
  const gridStartX = Math.floor(bounds.minX / GRID_SIZE) * GRID_SIZE;
  const gridStartY = Math.floor(bounds.minY / GRID_SIZE) * GRID_SIZE;
  const gridEndX = Math.ceil(bounds.maxX / GRID_SIZE) * GRID_SIZE;
  const gridEndY = Math.ceil(bounds.maxY / GRID_SIZE) * GRID_SIZE;

  // Minor grid
  for (let x = gridStartX; x <= gridEndX; x += minorGridSize) {
    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);
    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#e0e0e0" stroke-width="${0.3 * scaleFactor}"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += minorGridSize) {
    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);
    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#e0e0e0" stroke-width="${0.3 * scaleFactor}"/>`;
  }

  // Major grid
  for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) {
    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);
    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#c4b7b7" stroke-width="${0.5 * scaleFactor}"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) {
    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);
    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);
    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#c4b7b7" stroke-width="${0.5 * scaleFactor}"/>`;
  }

  // Generate path points and lines (without arrow at end)
  let svgContent = path.points.map((point) => {
    const {x: cx, y: cy} = transformCoord(point.x, point.y);
    return `<circle cx="${cx}" cy="${cy}" r="${3 * scaleFactor}" fill="#000000" filter="url(#dropShadow)"/>`;
  }).join('');
  if (path.points.length > 1) {
    const d = path.points.map(p => {
      const {x, y} = transformCoord(p.x, p.y);
      return `${x},${y}`;
    }).join(' L');
    svgContent += `<path d="M${d}" stroke="#000000" stroke-width="${2.5 * scaleFactor}" fill="none"/>`;
  }

  // Generate offset segments for border
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    svgContent += offsetSegments.map((segment) => {
      const {x: x1, y: y1} = transformCoord(segment.p1.x, segment.p1.y);
      const {x: x2, y: y2} = transformCoord(segment.p2.x, segment.p2.y);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000000" stroke-width="${3 * scaleFactor}" stroke-dasharray="${6 * scaleFactor},${4 * scaleFactor}"/>`;
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

          // FIXED: Swapped normal vector for inside/outside to correct the direction
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
            Z`; // Closed for fill
          svgContent += `<path d="${chevronPath}" stroke="${COLORS.accent}" stroke-width="${2 * scaleFactor}" fill="${COLORS.accent}"/>`;
        }
      }
    }
  }

  // Label design parameters (improved with padding and shadows)
  const labelWidth = 70; // Slightly wider for professionalism
  const labelHeight = 32;
  const labelRadius = 12;
  const fontSize = 16;
  const tailSize = 8; // Increased
  const attachSize = 8;
  const labelBg = '#FFFFFF';
  const labelText = '#000000';
  const tailFill = '#000000';

  // Generate segments with labels, tails, and folds (improved folds symbols)
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
        // Tail left
        const baseX = posX - labelWidth / 2;
        const tipX = baseX - tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      } else {
        // Tail right
        const baseX = posX + labelWidth / 2;
        const tipX = baseX + tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      }
    } else {
      if (labelDy < 0) {
        // Tail up
        const baseY = posY - labelHeight / 2;
        const tipY = baseY - tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      } else {
        // Tail down
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
        const foldColor = '#000000';
        const foldDirX = unitX;
        const foldDirY = unitY;
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
            M${chevron1.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * foldDirX},${chevron1.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * foldDirY}
            L${chevron1.x},${chevron1.y}
            L${chevron1.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * foldDirX},${chevron1.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * foldDirY}
            M${chevron2.x + chevronSizeAdj * rotNormalX + chevronSizeAdj * foldDirX},${chevron2.y + chevronSizeAdj * rotNormalY + chevronSizeAdj * foldDirY}
            L${chevron2.x},${chevron2.y}
            L${chevron2.x + chevronSizeAdj * rotNormalX - chevronSizeAdj * foldDirX},${chevron2.y + chevronSizeAdj * rotNormalY - chevronSizeAdj * foldDirY}
          `;
          foldElement = `<path d="${foldPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none" filter="url(#dropShadow)"/>`;
        } else if (foldType === 'Crush Hook') {
          const arcPath = `M${foldBase.x},${foldBase.y} L${foldEnd.x},${foldEnd.y} A${hookRadiusAdj},${hookRadiusAdj} 0 0 1 ${foldEnd.x + hookRadiusAdj * foldDirX},${foldEnd.y + hookRadiusAdj * foldDirY}`;
          foldElement = `<path d="${arcPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none" filter="url(#dropShadow)"/>`;
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
          foldElement = `<path d="${zigzagPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none" filter="url(#dropShadow)"/>`;
        } else if (foldType === 'Open') {
          foldElement = `<line x1="${foldBase.x}" y1="${foldBase.y}" x2="${foldEnd.x}" y2="${foldEnd.y}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" filter="url(#dropShadow)"/>`;
        }
        // Improved fold arrow: Use marker
        const foldArrowX = foldLabelPos.x;
        const foldArrowY = foldLabelPos.y + 20 * scaleFactor;
        foldElement += `
          <line x1="${foldArrowX}" y1="${foldArrowY}" x2="${foldBase.x}" y2="${foldBase.y}" stroke="${foldColor}" stroke-width="${1 * scaleFactor}" marker-end="url(#arrowHead)" />
          <text x="${foldLabelPos.x}" y="${foldLabelPos.y}" font-size="${14 * scaleFactor}" font-family="Helvetica, sans-serif" fill="${foldColor}" text-anchor="middle" alignment-baseline="middle" filter="url(#dropShadow)">
            ${foldType}
          </text>
        `;
      }
    }
    return `
      <g filter="url(#dropShadow)">
        <rect x="${posX - labelWidth/2}" y="${posY - labelHeight/2}"
              width="${labelWidth}" height="${labelHeight}"
              fill="${labelBg}" rx="${labelRadius}"
              stroke="#000000" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="Helvetica, sans-serif"
              fill="${labelText}" text-anchor="middle" alignment-baseline="middle">
          ${segment.length}
        </text>
        ${foldElement}
      </g>
    `;
  }).join('');

  // Generate angles with labels and tails (improved text)
  svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return '';
    }

    // Parse angle value and skip rendering for 90° and 270°
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270) {
      return '';
    }

    const {x: posX, y: posY} = transformCoord(angle.labelPosition.x, angle.labelPosition.y);
    const vertexX = angle.vertexIndex && path.points[angle.vertexIndex] ? path.points[angle.vertexIndex].x : angle.labelPosition.x;
    const vertexY = angle.vertexIndex && path.points[angle.vertexIndex] ? path.points[angle.vertexIndex].y : angle.labelPosition.y;
    const {x: targetX, y: targetY} = transformCoord(vertexX, vertexY);
    // Tail calculation
    const labelDx = targetX - posX;
    const labelDy = targetY - posY;
    const absLabelDx = Math.abs(labelDx);
    const absLabelDy = Math.abs(labelDy);
    let tailPath = '';
    if (absLabelDx > absLabelDy) {
      if (labelDx < 0) {
        // Tail left
        const baseX = posX - labelWidth / 2;
        const tipX = baseX - tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      } else {
        // Tail right
        const baseX = posX + labelWidth / 2;
        const tipX = baseX + tailSize;
        const topBaseY = posY - attachSize / 2;
        const bottomBaseY = posY + attachSize / 2;
        tailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${posY} Z`;
      }
    } else {
      if (labelDy < 0) {
        // Tail up
        const baseY = posY - labelHeight / 2;
        const tipY = baseY - tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      } else {
        // Tail down
        const baseY = posY + labelHeight / 2;
        const tipY = baseY + tailSize;
        const leftBaseX = posX - attachSize / 2;
        const rightBaseX = posX + attachSize / 2;
        tailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${posX} ${tipY} Z`;
      }
    }
    const roundedAngle = roundedValue;
    return `
      <g filter="url(#dropShadow)">
        <rect x="${posX - labelWidth / 2}" y="${posY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" fill="${labelBg}" rx="${labelRadius}" stroke="#000000" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="Helvetica, sans-serif" fill="${labelText}" text-anchor="middle" alignment-baseline="middle">
          ${roundedAngle}°
        </text>
      </g>
    `;
  }).join('');

  // New: Add scale bar at bottom
  const scaleBarX = targetViewBoxSize - 200;
  const scaleBarY = targetViewBoxSize - 50;
  const scaleBarWidth = SCALE_BAR_LENGTH * scaleFactor;
  svgContent += `
    <g>
      <rect x="${scaleBarX}" y="${scaleBarY}" width="${scaleBarWidth}" height="${5 * scaleFactor}" fill="#000000" />
      <text x="${scaleBarX + scaleBarWidth / 2}" y="${scaleBarY + 20 * scaleFactor}" font-size="${12 * scaleFactor}" fill="#000000" text-anchor="middle">
        Scale: ${SCALE_BAR_LENGTH} units
      </text>
    </g>
  `;

  // New: Add title
  svgContent += `
    <text x="${targetViewBoxSize / 2}" y="${30 * scaleFactor}" font-size="${20 * scaleFactor}" fill="${COLORS.primary}" text-anchor="middle" font-family="Helvetica-Bold, sans-serif">
      ${path.name || 'Flashing Diagram'}
    </text>
  `;

  // New: Add legend if folds present
  if (path.segments.some(s => s.fold && s.fold !== 'None')) {
    const legendX = 20 * scaleFactor;
    const legendY = targetViewBoxSize - 150 * scaleFactor;
    svgContent += `
      <g filter="url(#dropShadow)">
        <rect x="${legendX}" y="${legendY}" width="${150 * scaleFactor}" height="${100 * scaleFactor}" fill="#FFFFFF" stroke="#000000" rx="10" />
        <text x="${legendX + 10 * scaleFactor}" y="${legendY + 20 * scaleFactor}" font-size="${14 * scaleFactor}">Legend</text>
        <text x="${legendX + 10 * scaleFactor}" y="${legendY + 40 * scaleFactor}" font-size="${12 * scaleFactor}">Crush: Double Chevron</text>
        <text x="${legendX + 10 * scaleFactor}" y="${legendY + 60 * scaleFactor}" font-size="${12 * scaleFactor}">Hook: Curved Line</text>
        <text x="${legendX + 10 * scaleFactor}" y="${legendY + 80 * scaleFactor}" font-size="${12 * scaleFactor}">Break: Zigzag</text>
      </g>
    `;
  }

  return `<svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
    ${svgDefs}
    <g>${gridLines}</g>
    <g>${svgContent}</g>
  </svg>`;
};

// Helper function to draw header with improved design (added subtitle)
const drawHeader = (doc, pageWidth, y, pageNumber = null) => {
  const margin = 50;

  // Header with gradient background
  const gradient = doc.linearGradient(0, 0, pageWidth, 80)
    .stop(0, COLORS.primary)
    .stop(1, '#2d5a8c');

  doc.rect(0, 0, pageWidth, 80)
     .fill(gradient);

  // Left side: Business info
  doc.font(FONTS.title)
     .fontSize(18) // Increased size
     .fillColor('#FFFFFF')
     .text('COMMERCIAL ROOFERS PTY LTD', margin, 15);

  doc.font(FONTS.body)
     .fontSize(11)
     .fillColor('#FFFFFF')
     .text('info@commercialroofers.net.au | 0421259430', margin, 40);

  doc.font(FONTS.italic)
     .fontSize(10)
     .fillColor('#FFFFFF')
     .text('Professional Roofing Solutions', margin, 55); // New subtitle

  try {
    const logo = doc.openImage(logoPath);
    const logoHeight = 50; // Increased
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
       .fontSize(10)
       .fillColor('#FFFFFF')
       .text(`Page ${pageNumber}`, pageWidth - margin, 60, { align: 'right' });
  }

  // Divider line with dash
  doc.moveTo(margin, 75)
     .lineTo(pageWidth - margin, 75)
     .strokeColor('#FFFFFF')
     .dash(5, { space: 3 })
     .lineWidth(1)
     .stroke();

  return y + 85; // Adjusted for extra content
};

// Helper function to draw section header with improved design (added icon-like rect)
const drawSectionHeader = (doc, text, y) => {
  const margin = 50;

  doc.rect(margin, y, doc.page.width - 2 * margin, 25) // Increased height
     .fill(COLORS.lightBg);

  // New: Small accent rect
  doc.rect(margin, y, 5, 25)
     .fill(COLORS.secondary);

  doc.font(FONTS.subtitle)
     .fontSize(15)
     .fillColor(COLORS.primary)
     .text(text, margin + 15, y + 5); // Adjusted position

  return y + 35;
};

// Helper function to draw order details table with improved design (added icons simulation with bullets)
const drawOrderDetailsTable = (doc, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const tableWidth = pageWidth - 2 * margin;
  const rowHeight = 28; // Increased
  const colWidth = tableWidth / 2;

  // Table header
  doc.rect(margin, y, tableWidth, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader)
     .fontSize(13)
     .fillColor(COLORS.primary)
     .text('ORDER DETAILS', margin + 10, y + 7);

  y += rowHeight;

  // Table rows
  const rows = [
    ['JOB REFERENCE', JobReference],
    ['PO NUMBER', Number],
    ['ORDER CONTACT', OrderContact],
    ['ORDER DATE', OrderDate],
    ['DELIVERY ADDRESS', DeliveryAddress || 'PICKUP']
  ];

  rows.forEach(([label, value], i) => {
    // Alternate row background
    if (i % 2 === 0) {
      doc.rect(margin, y, tableWidth, rowHeight)
         .fill(COLORS.tableRow);
    }

    // New: Bullet for label
    doc.circle(margin + 15, y + 14, 2)
       .fill(COLORS.secondary);

    // Label
    doc.font(FONTS.tableHeader)
       .fontSize(11)
       .fillColor(COLORS.darkText)
     .text(label, margin + 25, y + 8); // Adjusted

    // Value
    doc.font(FONTS.tableBody)
       .fontSize(11)
       .fillColor(COLORS.darkText)
       .text(value, margin + colWidth, y + 8);

    // Row border
    doc.moveTo(margin, y + rowHeight)
       .lineTo(pageWidth - margin, y + rowHeight)
       .strokeColor(COLORS.border)
       .lineWidth(0.5)
       .stroke();

    y += rowHeight;
  });

  return y + 25; // Increased spacing
};

// Helper function to draw instructions with improved design (added numbering)
const drawInstructions = (doc, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;

  y = drawSectionHeader(doc, 'IMPORTANT NOTES', y);

  const instructions = [
    'Arrow points to the (solid) coloured side',
    '90° degrees are not labelled',
    'F = Total number of folds, each crush counts as 2 folds'
  ];

  instructions.forEach((instruction, index) => {
    // New: Numbering
    doc.font(FONTS.body)
       .fontSize(11)
       .fillColor(COLORS.secondary)
       .text(`${index + 1}. `, margin, y);

    doc.font(FONTS.body)
       .fontSize(11)
       .fillColor(COLORS.darkText)
       .text(instruction, margin + 20, y, {
         width: pageWidth - 2 * margin - 20,
         align: 'left'
       });

    y += 18;
  });

  // Warning text with improved styling
  doc.rect(margin, y + 10, pageWidth - 2 * margin, 30) // Increased height
     .fill('#fee2e2');

  doc.font(FONTS.subtitle)
     .fontSize(12)
     .fillColor(COLORS.accent)
     .text('*** PLEASE WRITE ALL CODES ON FLASHINGS ***', margin, y + 18, {
       width: pageWidth - 2 * margin,
       align: 'center'
     });

  return y + 50;
};

// Helper function to draw footer with improved design (added copyright)
const drawFooter = (doc, pageWidth, pageHeight) => {
  const margin = 50;

  // Footer divider
  doc.moveTo(margin, pageHeight - 50)
     .lineTo(pageWidth - margin, pageHeight - 50)
     .strokeColor(COLORS.border)
     .lineWidth(0.5)
     .stroke();

  doc.font(FONTS.italic)
     .fontSize(10)
     .fillColor(COLORS.darkText)
     .text('This order made possible thanks to the Flash.it Roofing App', 
           pageWidth / 2, pageHeight - 40, 
           { align: 'center' });

  doc.font(FONTS.body)
     .fontSize(9)
     .fillColor(COLORS.darkText)
     .text(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()} | © Commercial Roofers Pty Ltd`, 
           pageWidth / 2, pageHeight - 25, 
           { align: 'center' });
};

// Improved helper: Draw bordered property table below each diagram (added more rows if needed, better alignment)
const drawDiagramPropertyTable = (doc, x, y, pathData, qxL, totalFolds, girth) => {
  const tableWidth = 230; // Increased
  const rowHeight = 22;
  const colWidths = [100, 130];

  const rows = [
    ['Name', pathData.name || 'Unnamed'],
    ['Colour', pathData.color || 'N/A'],
    ['Code', pathData.code || 'N/A'],
    ['Q x L', qxL || 'N/A'],
    ['Folds (F)', totalFolds.toString()],
    ['Girth', `${girth}mm`],
    ['Total (T)', totalFolds.toString()],
    ['Scale', pathData.scale || '1:1'] // New row
  ];

  // Table header
  doc.rect(x, y, tableWidth, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
  doc.text('PROPERTY', x + 5, y + 5, { width: colWidths[0] - 10, align: 'left' });
  doc.text('VALUE', x + colWidths[0] + 5, y + 5, { width: colWidths[1] - 10, align: 'left' });

  y += rowHeight;

  // Data rows
  rows.forEach((row, index) => {
    if (index % 2 === 0) {
      doc.rect(x, y, tableWidth, rowHeight)
         .fill(COLORS.tableRow);
    }

    doc.font(FONTS.tableBody).fontSize(10).fillColor(COLORS.darkText);
    doc.text(row[0], x + 5, y + 6, { width: colWidths[0] - 10, align: 'left' });

    if (row[0] === 'Code') {
      doc.fillColor(COLORS.accent);
    }
    doc.text(row[1], x + colWidths[0] + 5, y + 6, { width: colWidths[1] - 10, align: 'left' });
    doc.fillColor(COLORS.darkText); // Reset color

    y += rowHeight;
  });

  // Outer border
  doc.rect(x, y - rowHeight * rows.length, tableWidth, rowHeight * (rows.length + 1))
     .lineWidth(1)
     .strokeColor(COLORS.border)
     .stroke();

  // Vertical divider
  doc.moveTo(x + colWidths[0], y - rowHeight * rows.length)
     .lineTo(x + colWidths[0], y)
     .lineWidth(0.5)
     .strokeColor(COLORS.border)
     .stroke();

  return y;
};

// Helper function to draw summary table with improved design (added totals row)
const drawSummaryTable = (doc, validPaths, groupedQuantitiesAndLengths, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

  // Table Header
  const headers = ['#', 'Name', 'Colour', 'Code', 'F', 'GIRTH', 'Q x L', 'T'];
  const colWidths = [25, 80, 80, 60, 30, 60, 110, 30]; // Adjusted
  const rowHeight = 22;

  // Draw table header with background
  let xPos = margin;
  doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
  headers.forEach((h, i) => {
    doc.text(h, xPos + 5, y + 6, { width: colWidths[i] - 10, align: 'center' });
    xPos += colWidths[i];
  });

  y += rowHeight;

  // Table Rows
  doc.font(FONTS.tableBody).fontSize(10);
  let totalF = 0;
  let totalG = 0;
  let totalT = 0;
  validPaths.forEach((path, index) => {
    const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[index] || [];
    const qxL = formatQxL(pathQuantitiesAndLengths);
    const totalFolds = calculateTotalFolds(path);
    const girth = parseFloat(calculateGirth(path));
    totalF += totalFolds;
    totalG += girth;
    totalT += totalFolds;

    // Alternate row background
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
      // Make code values red
      if (i === 3) {
        doc.fillColor(COLORS.accent).text(val, xPos + 5, y + 6, {
          width: colWidths[i] - 10,
          align: 'center'
        });
      } else {
        doc.fillColor(COLORS.darkText).text(val, xPos + 5, y + 6, {
          width: colWidths[i] - 10,
          align: 'center'
        });
      }
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
    if (y > pageHeight - 60) {
      doc.addPage();
      const newPageY = drawHeader(doc, pageWidth, 0, doc.bufferedPageRange().count + 1);
      y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', newPageY) + rowHeight;

      // Redraw table header
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

  // New: Totals row
  doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
     .fill(COLORS.tableHeader);

  doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
  xPos = margin;
  ['Totals', '', '', '', totalF.toString(), `${totalG.toFixed(2)}mm`, '', totalT.toString()].forEach((val, i) => {
    doc.text(val, xPos + 5, y + 6, { width: colWidths[i] - 10, align: 'center' });
    xPos += colWidths[i];
  });

  return y + rowHeight + 25;
};

export const generatePdfDownload = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems } = req.body;
    const { userId } = req.params;

    // Validate inputs (improved with more checks)
    if (!JobReference || !Number || !OrderContact || !OrderDate) {
      return res.status(400).json({ message: 'JobReference, Number, OrderContact, and OrderDate are required' });
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
      if (!item.quantity || !item.length || isNaN(parseFloat(item.quantity)) || isNaN(parseFloat(item.length))) {
        return res.status(400).json({ message: 'Each QuantitiesAndLengths item must have valid numeric quantity and length' });
      }
    }

    // Validate AdditionalItems
    const additionalItemsText = AdditionalItems || '';

    // Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

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

    // Initialize PDF document with A4 size (added autoFirstPage false for control)
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `Flashing Order - ${JobReference}`,
        Author: 'Commercial Roofers Pty Ltd',
        Creator: 'Flash.it Roofing App',
        CreationDate: new Date(),
      },
      autoFirstPage: false
    });

    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    console.log('Saving PDF to:', pdfPath);

    // Create a write stream and pipe the document to it
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const margin = 50;
    const imgSize = 220; // Increased for better detail
    const gap = 35;

    // Add first page
    doc.addPage();
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // Page 1: Header and Order Details
    let y = drawHeader(doc, pageWidth, 0, 1);

    // Order Details Table
    y = drawOrderDetailsTable(doc, JobReference, Number, OrderContact, OrderDate, 
                             DeliveryAddress || PickupNotes, y);

    // Instructions Section
    y = drawInstructions(doc, y);

    // Image handling (improved with more space for tables)
    const pathsPerRow = 2;
    const firstPageMaxPaths = 2;
    const remainingPathsPerPage = 4;

    // First part: Up to 2 images on the current page
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
        const yPos = startY + row * (imgSize + gap + 200); // Increased for larger table

        try {
          const pathData = validPaths[i];
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          // Convert SVG to PNG with higher resolution (increased density)
          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize({
              width: imgSize * 5, // Higher res
              height: imgSize * 5,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png({ quality: 100, compressionLevel: 0, density: 300 }) // Added density
            .toBuffer();

          // Border around diagram with shadow simulation
          doc.rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
             .lineWidth(1)
             .strokeColor(COLORS.border)
             .stroke();

          // Embed image in PDF
          const img = doc.openImage(imageBuffer);
          const imgW = imgSize;
          const imgH = (img.height * imgW) / img.width;

          // Image
          doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

          // Property table below image
          const infoY = yPos + imgH + 20;
          const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[i] || [];
          const qxL = formatQxL(pathQuantitiesAndLengths);
          const totalFolds = calculateTotalFolds(pathData);
          const girth = calculateGirth(pathData);

          drawDiagramPropertyTable(doc, x - 10, infoY, pathData, qxL, totalFolds, girth);
        } catch (err) {
          console.warn(`Image error (path ${i}):`, err.message);
          doc.font('Helvetica').fontSize(14)
            .text(`Image unavailable`, x, yPos);
        }
      }

      y = startY + Math.ceil(firstPagePaths / pathsPerRow) * (imgSize + gap + 200);
    }

    // Remaining images: 4 per page on new pages
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

            // Convert SVG to PNG with higher resolution
            const imageBuffer = await sharp(Buffer.from(svgString))
              .resize({
                width: imgSize * 5,
                height: imgSize * 5,
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              })
              .png({ quality: 100, compressionLevel: 0, density: 300 })
              .toBuffer();

            // Border around diagram
            doc.rect(x - 5, yPos - 5, imgSize + 10, imgSize + 10)
               .lineWidth(1)
               .strokeColor(COLORS.border)
               .stroke();

            // Embed image in PDF
            const img = doc.openImage(imageBuffer);
            const imgW = imgSize;
            const imgH = (img.height * imgW) / img.width;

            // Image
            doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

            // Property table below image
            const infoY = yPos + imgH + 20;
            const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[i] || [];
            const qxL = formatQxL(pathQuantitiesAndLengths);
            const totalFolds = calculateTotalFolds(pathData);
            const girth = calculateGirth(pathData);

            drawDiagramPropertyTable(doc, x - 10, infoY, pathData, qxL, totalFolds, girth);
          } catch (err) {
            console.warn(`Image error (path ${i}):`, err.message);
            doc.font('Helvetica').fontSize(14)
              .text(`Image unavailable`, x, yPos);
          }
        }

        y = startY + Math.ceil((endPath - startPath) / pathsPerRow) * (imgSize + gap + 200);
      }
    }

    // Add summary table on a new page
    doc.addPage();
    const lastPageNumber = doc.bufferedPageRange().count;
    y = drawHeader(doc, pageWidth, 0, lastPageNumber);
    y = drawSummaryTable(doc, validPaths, groupedQuantitiesAndLengths, y);

    // Draw footer on all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, pageHeight);
    }

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

    // Save order in DB
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

    // Delete local PDF file
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
