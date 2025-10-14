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

// Professional color scheme (refined for better professionalism: softer tones, higher contrast)
const COLORS = {
  primary: '#0f172a', // Slate blue for headers (darker for professionalism)
  secondary: '#2563eb', // Professional blue for accents
  accent: '#dc2626', // Red for important elements
  lightBg: '#f9fafb', // Light gray for backgrounds
  darkText: '#111827', // Dark gray for text (improved contrast)
  border: '#d1d5db', // Light gray for borders
  tableHeader: '#e5e7eb', // Table header background
  tableRow: '#f9fafb', // Table row background
  success: '#16a34a', // Green for positive indicators
  warning: '#d97706', // Yellow for warnings
  shadow: '#0000001a', // Softer shadow for subtlety
};

// Font settings (added professional sans-serif fallback)
const FONTS = {
  title: 'Helvetica-Bold',
  subtitle: 'Helvetica-Bold',
  body: 'Helvetica',
  tableHeader: 'Helvetica-Bold',
  tableBody: 'Helvetica',
  italic: 'Helvetica-Oblique',
  monospace: 'Courier',
};

// Configuration constants (unchanged)
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 12;
const CHEVRON_SIZE = 10;
const HOOK_RADIUS = 8;
const ZIGZAG_SIZE = 9;
const LABEL_PADDING = 12; // Increased for better spacing
const SHADOW_OFFSET = 2;
const SCALE_BAR_LENGTH = 100;

// Helper function to validate points (unchanged)
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

// Helper function to calculate bounds for a path (restored border bounds adjustment)
const calculateBounds = (path, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Invalid points array in path:', path);
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
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
    if (!segment.labelPosition || typeof segment.labelPosition.x === 'undefined' || typeof segment.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 50); // Reduced padding for labels
    maxX = Math.max(maxX, labelX + 50);
    minY = Math.min(minY, labelY - 30);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 30);

    let foldType = 'None';
    let foldLength = FOLD_LENGTH;
    let foldAngle = 0;
    let tailLengthVal = 20;
    let flipped = false;
    if (typeof segment.fold === 'object' && segment.fold) {
      foldType = segment.fold.type || 'None';
      foldLength = parseFloat(segment.fold.length) || FOLD_LENGTH;
      foldAngle = parseFloat(segment.fold.angle) || 0;
      tailLengthVal = parseFloat(segment.fold.tailLength) || 20;
      flipped = !!segment.fold.flipped;
    } else {
      foldType = segment.fold || 'None';
    }

    if (foldType !== 'None') {
      const p1 = path.points[i];
      const p2 = path.points[i + 1];
      if (!p1 || !p2) return;
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const segLength = Math.sqrt(dx * dx + dy * dy);
      if (segLength === 0) return;
      const unitX = dx / segLength;
      const unitY = dy / segLength;
      const isFirstSegment = i === 0;
      const foldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
      const foldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
      let foldEndX, foldEndY, labelX, labelY;
      if (foldType === 'Crush') {
        let normalX = isFirstSegment ? -unitY : unitY;
        let normalY = isFirstSegment ? unitX : -unitX;
        if (flipped) {
          normalX = -normalX;
          normalY = -normalY;
        }
        const angleRad = foldAngle * Math.PI / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const rotNormalX = normalX * cosA - normalY * sinA;
        const rotNormalY = normalX * sinA + normalY * cosA;
        const curveHeight = foldLength * 0.6;
        const curveWidth = foldLength * 0.8;
        const curveEndX = foldBaseX + rotNormalX * curveWidth;
        const curveEndY = foldBaseY + rotNormalY * curveWidth;
        const tailDirX = isFirstSegment ? unitX : -unitX;
        const tailDirY = isFirstSegment ? unitY : -unitY;
        foldEndX = curveEndX + tailDirX * tailLengthVal;
        foldEndY = curveEndY + tailDirY * tailLengthVal;
        const labelOffset = 50;
        labelX = foldEndX + tailDirX * labelOffset;
        labelY = foldEndY + tailDirY * labelOffset;
      } else {
        let foldAngleVal = foldAngle;
        if (flipped) foldAngleVal = 360 - foldAngleVal;
        const foldAngleRad = foldAngleVal * Math.PI / 180;
        let baseDirX = isFirstSegment ? unitX : -unitX;
        let baseDirY = isFirstSegment ? unitY : -unitY;
        const foldDirX = baseDirX * Math.cos(foldAngleRad) - baseDirY * Math.sin(foldAngleRad);
        const foldDirY = baseDirX * Math.sin(foldAngleRad) + baseDirY * Math.cos(foldAngleRad);
        foldEndX = foldBaseX + foldDirX * foldLength;
        foldEndY = foldBaseY + foldDirY * foldLength;
        const labelOffset = 50;
        labelX = foldEndX + foldDirX * labelOffset;
        labelY = foldEndY + foldDirY * labelOffset;
      }
      minX = Math.min(minX, labelX - 50, foldEndX, foldBaseX);
      maxX = Math.max(maxX, labelX + 50, foldEndX, foldBaseX);
      minY = Math.min(minY, labelY - 30, foldEndY, foldBaseY);
      maxY = Math.max(maxY, labelY + ARROW_SIZE + 30, foldEndY, foldBaseY);
    }
  });

  (path.angles || []).forEach((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return;
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270 || roundedValue === 45 || roundedValue === 315) {
      return;
    }
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, labelX - 50); // Reduced padding
    maxX = Math.max(maxX, labelX + 50);
    minY = Math.min(minY, labelY - 30);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 30);
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
          const midX_main = (parseFloat(origP1.x) + parseFloat(origP2.x)) / 2;
          const midY_main = (parseFloat(origP1.y) + parseFloat(origP2.y)) / 2;
          const arrowNormalX = borderOffsetDirection === 'inside' ? -unitY : unitY;
          const arrowNormalY = borderOffsetDirection === 'inside' ? unitX : -unitX;
          const chevronBaseDistance = 10;
          const chevronSize = 8;
          const chevronX = midX_main + arrowNormalX * chevronBaseDistance;
          const chevronY = midY_main + arrowNormalY * chevronBaseDistance;
          minX = Math.min(minX, chevronX - chevronSize);
          maxX = Math.max(maxX, chevronX + chevronSize);
          minY = Math.min(minY, chevronY - chevronSize);
          maxY = Math.max(maxY, chevronY + chevronSize);
        }
      }
    }
  }

  const padding = isLargeDiagram ? Math.max(50, (maxX - minX) * 0.05) : 40; // Reduced base padding
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
};

// Helper function to calculate offset segments for border (unchanged)
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

// Helper function to calculate total folds (unchanged)
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

// Helper function to calculate girth (unchanged)
const calculateGirth = (path) => {
  let totalLength = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      const lengthStr = segment.length || '0 m';
      const lengthNum = parseFloat(lengthStr.replace(/[^0-9.]/g, '')) || 0;
      totalLength += lengthNum;
    });
  }
  return totalLength.toFixed(2);
};

// Helper function to format Q x L (modified to match photo format with comma thousands separator and space)
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  return quantitiesAndLengths.map(item => `${item.quantity} x ${parseFloat(item.length).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`).join('   ');
};

// Generate SVG string without arrows at line ends (restored border drawing)
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Skipping SVG generation for path due to invalid points:', path);
    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';
  }
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const targetViewBoxSize = 1200;
  const scaleFactor = targetViewBoxSize * 0.95 / Math.max(width, height, 1);
  const offsetX = (targetViewBoxSize - width * scaleFactor) / 2;
  const offsetY = (targetViewBoxSize - height * scaleFactor) / 2;
  const viewBox = `0 0 ${targetViewBoxSize} ${targetViewBoxSize}`;

  const transformCoord = (x, y) => {
    return {
      x: (parseFloat(x) - bounds.minX) * scaleFactor + offsetX,
      y: (parseFloat(y) - bounds.minY) * scaleFactor + offsetY
    };
  };

  const adjScale = scale;
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
    </defs>
  `;

  // Generate grid lines
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

  // Generate path points and lines (removed arrow marker)
  let svgContent = path.points.map((point) => {
    const {x: cx, y: cy} = transformCoord(point.x, point.y);
    return `<circle cx="${cx}" cy="${cy}" r="${3 * scaleFactor}" fill="#000000" filter="url(#dropShadow)"/>`;
  }).join('');

  if (path.points.length > 1) {
    const d = path.points.map(p => {
      const {x, y} = transformCoord(p.x, p.y);
      return `${x},${y}`;
    }).join(' L');
    // Removed marker-end attribute to eliminate arrows at line ends
    svgContent += `<path d="M${d}" stroke="#000000" stroke-width="${2.5 * scaleFactor}" fill="none"/>`;
  }

  // Generate offset segments for border (restored)
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    svgContent += offsetSegments.map((segment) => {
      const {x: x1, y: y1} = transformCoord(segment.p1.x, segment.p1.y);
      const {x: x2, y: y2} = transformCoord(segment.p2.x, segment.p2.y);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000000" stroke-width="${3 * scaleFactor}" stroke-dasharray="${6 * scaleFactor},${4 * scaleFactor}"/>`;
    }).join('');
    const segment = offsetSegments[0];
    if (segment) {
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
          const midX_main = (parseFloat(origP1.x) + parseFloat(origP2.x)) / 2;
          const midY_main = (parseFloat(origP1.y) + parseFloat(origP2.y)) / 2;
          const arrowNormalX = borderOffsetDirection === 'inside' ? -unitY : unitY;
          const arrowNormalY = borderOffsetDirection === 'inside' ? unitX : -unitX;
          const chevronBaseDistance = 10;
          const chevronX = midX_main + arrowNormalX * chevronBaseDistance;
          const chevronY = midY_main + arrowNormalY * chevronBaseDistance;
          const {x: chevronXView, y: chevronYView} = transformCoord(chevronX, chevronY);
          const chevronSize = 8 * scaleFactor;
          const direction = 1;
          const chevronPath = `
            M${chevronXView + chevronSize * arrowNormalX * direction + chevronSize * unitX},${chevronYView + chevronSize * arrowNormalY * direction + chevronSize * unitY}
            L${chevronXView},${chevronYView}
            L${chevronXView + chevronSize * arrowNormalX * direction - chevronSize * unitX},${chevronYView + chevronSize * arrowNormalY * direction - chevronSize * unitY}
            Z`;
          svgContent += `<path d="${chevronPath}" stroke="${COLORS.accent}" stroke-width="${2 * scaleFactor}" fill="${COLORS.accent}"/>`;
        }
      }
    }
  }

  // Label design parameters (improved: dynamic width, larger height, bold text)
  let labelWidth = 90; // Base width, will adjust dynamically
  const labelHeight = 36; // Slightly increased
  const labelRadius = 12;
  const fontSize = 18; // Increased for professionalism
  const tailSize = 10; // Increased
  const attachSize = 10;
  const labelBg = '#FFFFFF';
  const labelText = '#000000';
  const tailFill = '#000000';

  // Generate segments with labels, tails, and folds
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

    // Dynamic label width based on text length
    const textContent = segment.length || '';
    const approxTextWidth = textContent.length * (fontSize * 0.6); // Approximate char width
    labelWidth = Math.max(90, approxTextWidth + 20); // Min 90, plus padding

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
    let tailLengthVal = 20;
    let flipped = false;
    if (typeof segment.fold === 'object' && segment.fold) {
      foldType = segment.fold.type || 'None';
      foldLength = parseFloat(segment.fold.length) || FOLD_LENGTH;
      foldAngle = parseFloat(segment.fold.angle) || 0;
      tailLengthVal = parseFloat(segment.fold.tailLength) || 20;
      flipped = !!segment.fold.flipped;
    } else {
      foldType = segment.fold || 'None';
    }

    const foldColor = '#000000';
    if (foldType !== 'None') {
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const segLength = Math.sqrt(dx * dx + dy * dy);
      if (segLength === 0) {
        foldElement = '';
      } else {
        const unitX = dx / segLength;
        const unitY = dy / segLength;
        const isFirstSegment = i === 0;
        let modelFoldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
        let modelFoldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
        let modelFoldEndX, modelFoldEndY, modelLabelX, modelLabelY, labelText, dirX, dirY;
        let foldPath = '';
        if (foldType === 'Crush') {
          let normalX = isFirstSegment ? -unitY : unitY;
          let normalY = isFirstSegment ? unitX : -unitX;
          if (flipped) {
            normalX = -normalX;
            normalY = -normalY;
          }
          const angleRad = foldAngle * Math.PI / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          const rotNormalX = normalX * cosA - normalY * sinA;
          const rotNormalY = normalX * sinA + normalY * cosA;
          const curveHeight = foldLength * 0.6;
          const curveWidth = foldLength * 0.8;
          const modelStartX = modelFoldBaseX;
          const modelStartY = modelFoldBaseY;
          const modelCurveEndX = modelStartX + rotNormalX * curveWidth;
          const modelCurveEndY = modelStartY + rotNormalY * curveWidth;
          const bulgeSign = flipped ? -1 : 1;
          const modelCp1X = modelStartX + rotNormalX * (curveWidth / 3) + bulgeSign * (-rotNormalY * curveHeight);
          const modelCp1Y = modelStartY + rotNormalY * (curveWidth / 3) + bulgeSign * (rotNormalX * curveHeight);
          const modelCp2X = modelStartX + rotNormalX * (2 * curveWidth / 3) + bulgeSign * (-rotNormalY * curveHeight);
          const modelCp2Y = modelStartY + rotNormalY * (2 * curveWidth / 3) + bulgeSign * (rotNormalX * curveHeight);
          const tailDirX = isFirstSegment ? unitX : -unitX;
          const tailDirY = isFirstSegment ? unitY : -unitY;
          const modelTailX = modelCurveEndX + tailDirX * tailLengthVal;
          const modelTailY = modelCurveEndY + tailDirY * tailLengthVal;
          modelFoldEndX = modelTailX;
          modelFoldEndY = modelTailY;
          dirX = tailDirX;
          dirY = tailDirY;
          labelText = `${foldType.toUpperCase()} ${tailLengthVal}`;
          const svgStart = transformCoord(modelStartX, modelStartY);
          const svgCp1 = transformCoord(modelCp1X, modelCp1Y);
          const svgCp2 = transformCoord(modelCp2X, modelCp2Y);
          const svgCurveEnd = transformCoord(modelCurveEndX, modelCurveEndY);
          const svgTail = transformCoord(modelTailX, modelTailY);
          foldPath = `M${svgStart.x},${svgStart.y} C${svgCp1.x},${svgCp1.y} ${svgCp2.x},${svgCp2.y} ${svgCurveEnd.x},${svgCurveEnd.y} L${svgTail.x},${svgTail.y}`;
        } else {
          // Open, Break, Crush Hook: straight line
          let foldAngleVal = foldAngle;
          if (flipped) foldAngleVal = 360 - foldAngleVal;
          const foldAngleRad = foldAngleVal * Math.PI / 180;
          let baseDirX = isFirstSegment ? unitX : -unitX;
          let baseDirY = isFirstSegment ? unitY : -unitY;
          const foldDirX = baseDirX * Math.cos(foldAngleRad) - baseDirY * Math.sin(foldAngleRad);
          const foldDirY = baseDirX * Math.sin(foldAngleRad) + baseDirY * Math.cos(foldAngleRad);
          modelFoldEndX = modelFoldBaseX + foldDirX * foldLength;
          modelFoldEndY = modelFoldBaseY + foldDirY * foldLength;
          dirX = foldDirX;
          dirY = foldDirY;
          labelText = foldType.toUpperCase();
          const svgBase = transformCoord(modelFoldBaseX, modelFoldBaseY);
          const svgEnd = transformCoord(modelFoldEndX, modelFoldEndY);
          foldPath = `M${svgBase.x},${svgBase.y} L${svgEnd.x},${svgEnd.y}`;
        }
        const modelLabelOffset = 50;
        modelLabelX = modelFoldEndX + dirX * modelLabelOffset;
        modelLabelY = modelFoldEndY + dirY * modelLabelOffset;
        const svgLabel = transformCoord(modelLabelX, modelLabelY);
        foldElement = `<path d="${foldPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none" filter="url(#dropShadow)"/>`;
        foldElement += `
          <text x="${svgLabel.x}" y="${svgLabel.y}" font-size="${14 * scaleFactor}" font-family="${FONTS.body}" fill="${foldColor}" text-anchor="middle" alignment-baseline="middle" filter="url(#dropShadow)">
            ${labelText}
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
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="${FONTS.body}" font-weight="bold"
              fill="${labelText}" text-anchor="middle" alignment-baseline="middle">
          ${segment.length}
        </text>
      </g>
      ${foldElement}
    `;
  }).join('');

  // Generate angles with labels and tails (improved text: bold, dynamic width)
  svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return '';
    }
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    const roundedValue = Math.round(angleValue);
    if (roundedValue === 90 || roundedValue === 270 || roundedValue === 45 || roundedValue === 315) {
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

    // Dynamic label width for angles
    const textContent = `${roundedValue}°`;
    const approxTextWidth = textContent.length * (fontSize * 0.6);
    labelWidth = Math.max(90, approxTextWidth + 20);

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
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="${FONTS.body}" font-weight="bold" fill="${labelText}" text-anchor="middle" alignment-baseline="middle">
          ${roundedAngle}°
        </text>
      </g>
    `;
  }).join('');

  return `<svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
    ${svgDefs}
    <g>${gridLines}</g>
    <g>${svgContent}</g>
  </svg>`;
};

// Helper function to draw header (improved: white background, dark text for professionalism)
const drawHeader = (doc, pageWidth, y) => {
  const margin = 50;
  // Header with white background (removed gradient)
  doc.rect(0, 0, pageWidth, 80)
     .fill('#FFFFFF');

  // Left side: Business info (dark text)
  doc.font(FONTS.title)
     .fontSize(18)
     .fillColor(COLORS.darkText)
     .text('COMMERCIAL ROOFERS PTY LTD', margin, 15);
  doc.font(FONTS.body)
     .fontSize(11)
     .fillColor(COLORS.darkText)
     .text('info@commercialroofers.net.au | 0421259430', margin, 40);
  doc.font(FONTS.italic)
     .fontSize(10)
     .fillColor(COLORS.darkText)
     .text('Professional Roofing Solutions', margin, 55);

  try {
    const logo = doc.openImage(logoPath);
    const logoHeight = 50;
    const logoWidth = (logo.width * logoHeight) / logo.height;
    doc.image(logo, pageWidth - margin - logoWidth, 15, {
      width: logoWidth,
      height: logoHeight
    });
  } catch (err) {
    console.warn('Failed to load logo:', err.message);
  }

  // Divider line with dash (border color)
  doc.moveTo(margin, 75)
     .lineTo(pageWidth - margin, 75)
     .strokeColor(COLORS.border)
     .dash(5, { space: 3 })
     .lineWidth(1)
     .stroke();

  return y + 85;
};

// Helper function to draw section header (improved: softer colors)
const drawSectionHeader = (doc, text, y) => {
  const margin = 50;
  doc.rect(margin, y, doc.page.width - 2 * margin, 25)
     .fill(COLORS.lightBg);
  // Small accent rect
  doc.rect(margin, y, 5, 25)
     .fill(COLORS.secondary);
  doc.font(FONTS.subtitle)
     .fontSize(15)
     .fillColor(COLORS.primary)
     .text(text, margin + 15, y + 5);
  return y + 35;
};

// Helper function to draw order details table (improved: better alignment, softer borders)
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
    // Bullet for label
    doc.circle(margin + 15, y + 14, 2)
       .fill(COLORS.secondary);
    // Label
    doc.font(FONTS.tableHeader)
       .fontSize(11)
       .fillColor(COLORS.darkText)
     .text(label, margin + 25, y + 8);
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

  return y + 25;
};

// Helper function to draw instructions (improved: better spacing)
const drawInstructions = (doc, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  y = drawSectionHeader(doc, 'IMPORTANT NOTES', y);

  const instructions = [
    'Arrow points to the (solid) coloured side',
    '90° and 45° degrees are not labelled',
    'F = Total number of folds, each crush counts as 2 folds'
  ];

  instructions.forEach((instruction, index) => {
    // Numbering
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

  // Warning text
  doc.rect(margin, y + 10, pageWidth - 2 * margin, 30)
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

// Helper function to draw footer (improved: thinner line)
const drawFooter = (doc, pageWidth, pageHeight, pageNumber) => {
  const margin = 50;
  // Footer divider
  doc.moveTo(margin, pageHeight - 50)
     .lineTo(pageWidth - margin, pageHeight - 50)
     .strokeColor(COLORS.border)
     .lineWidth(0.5)
     .stroke();

  // Page number in bottom center
  doc.font(FONTS.body)
     .fontSize(10)
     .fillColor(COLORS.darkText)
     .text(`Page ${pageNumber}`, 0, pageHeight - 30, { width: pageWidth, align: 'center' });
};

// Draw property table below each diagram to match the photo (with #, Colour/Material, CODE, F, GIRTH in table, Q x L and T below)
const drawDiagramPropertyTable = (doc, x, y, pathData, qxlGroup, pathIndex) => {
  const tableWidth = 230;
  const minRowHeight = 24;
  const colWidths = [20, 90, 40, 30, 50];
  const headerFontSize = 10;
  const fontSize = 12;
  const headers = ['', 'Colour/Material', 'CODE', 'F', 'GIRTH'];

  const totalFolds = calculateTotalFolds(pathData).toString();
  const girth = calculateGirth(pathData);
  const color = pathData.color || 'Shale Grey';
  // Extract only numeric value from code
  const code = (pathData.code || '').replace(/\D/g, ''); // Remove non-digit characters
  const num = (pathIndex + 1).toString();

  const row = [num, color, code, totalFolds, girth];
  const aligns = ['center', 'left', 'center', 'center', 'center'];

  let currentY = y;

  // Draw header row
  doc.font(FONTS.tableHeader).fontSize(headerFontSize).fillColor(COLORS.darkText);
  let currentX = x;
  headers.forEach((h, i) => {
    const opt = {width: colWidths[i] - 4, align: 'center'};
    doc.text(h, currentX + 2, currentY + (minRowHeight / 4), opt);
    currentX += colWidths[i];
  });
  const headerRowHeight = minRowHeight;
  currentY += headerRowHeight;

  // Compute data row height
  let dataMaxH = 0;
  doc.font(FONTS.tableBody).fontSize(fontSize);
  row.forEach((val, i) => {
    const opt = {width: colWidths[i]-4, align: aligns[i], paragraphGap: 0, lineGap: 0};
    const h = doc.heightOfString(val, opt);
    dataMaxH = Math.max(dataMaxH, h);
  });
  const dataRowHeight = Math.max(minRowHeight, dataMaxH + 4); // small padding

  // Draw data row
  currentX = x;
  row.forEach((val, i) => {
    const align = aligns[i];
    if (i === 2) { // Code accent
      doc.fillColor(COLORS.accent);
    } else {
      doc.fillColor(COLORS.darkText);
    }
    const opt = {width: colWidths[i]-4, align, paragraphGap: 0, lineGap: 0};
    const textHeight = doc.heightOfString(val, opt);
    const textY = currentY + (dataRowHeight - textHeight) / 2;
    doc.text(val, currentX + 2, textY, opt);
    currentX += colWidths[i];
  });
  doc.fillColor(COLORS.darkText); // reset
  currentY += dataRowHeight;

  // Draw borders (horizontal and vertical lines)
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  // Horizontal
  doc.moveTo(x, y).lineTo(x + tableWidth, y).stroke();
  doc.moveTo(x, y + headerRowHeight).lineTo(x + tableWidth, y + headerRowHeight).stroke();
  doc.moveTo(x, currentY).lineTo(x + tableWidth, currentY).stroke();
  // Vertical
  currentX = x;
  for (let i = 0; i <= colWidths.length; i++) {
    doc.moveTo(currentX, y).lineTo(currentX, currentY).stroke();
    if (i < colWidths.length) currentX += colWidths[i];
  }

  // Below table: Q x L and T -
  const qxlStr = formatQxL(qxlGroup);
  let totalM = 0;
  qxlGroup.forEach(item => {
    totalM += item.quantity * parseFloat(item.length) / 1000;
  });
  const totalStr = totalM.toFixed(1);

  doc.font(FONTS.body).fontSize(11).fillColor(COLORS.darkText);
  const qxlX = x;
  const qxlWidth = tableWidth - 60;
  const qxlOpt = {width: qxlWidth, paragraphGap: 0, lineGap: 0};
  const qxlText = `Q x L ${qxlStr}`;
  const qxlH = doc.heightOfString(qxlText, qxlOpt);
  const belowY = currentY + 5;
  doc.text(qxlText, qxlX, belowY, qxlOpt);
  doc.text(`T - ${totalStr}`, x + tableWidth - 60, belowY, { align: 'right', width: 60 });

  const belowHeight = Math.max(20, qxlH + 5);
  currentY += belowHeight;

  return currentY;
};

// Helper function to draw summary table (with dynamic row heights and adjusted totals position) (improved: better alignment)
const drawSummaryTable = (doc, validPaths, groupedQuantitiesAndLengths, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

  // Table Header
  const headers = ['#', 'Colour', 'Code', 'F', 'GIRTH', 'Q x L'];
  const colWidths = [25, 90, 60, 30, 60, 140];
  const minRowHeight = 22;
  const padding = 12;

  // Draw table header
  doc.font(FONTS.tableHeader).fontSize(11);
  let headerMaxHeight = 0;
  headers.forEach((h, i) => {
    const hHeight = doc.heightOfString(h, { width: colWidths[i] - 10, align: 'center' });
    if (hHeight > headerMaxHeight) headerMaxHeight = hHeight;
  });
  const headerHeight = headerMaxHeight + padding;
  doc.rect(margin, y, pageWidth - 2 * margin, headerHeight)
     .fill(COLORS.tableHeader);
  doc.fillColor(COLORS.primary);
  let xPos = margin;
  headers.forEach((h, i) => {
    const cellWidth = colWidths[i] - 10;
    const textHeight = doc.heightOfString(h, { width: cellWidth, align: 'center' });
    const textY = y + (headerHeight - textHeight) / 2;
    doc.text(h, xPos + 5, textY, { width: cellWidth, align: 'center' });
    xPos += colWidths[i];
  });
  y += headerHeight;

  // Table Rows with dynamic heights
  doc.font(FONTS.tableBody).fontSize(10);
  let totalF = 0;
  let totalG = 0;
  validPaths.forEach((path, index) => {
    const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[index] || [];
    const qxL = formatQxL(pathQuantitiesAndLengths);
    const totalFolds = calculateTotalFolds(path);
    const girth = parseFloat(calculateGirth(path));
    totalF += totalFolds;
    totalG += girth;

    const code = (path.code || '').replace(/\D/g, '') || '';

    const row = [
      `${index + 1}`,
      path.color || 'N/A',
      code,
      totalFolds.toString(),
      `${girth}mm`,
      qxL || 'N/A'
    ];

    // Calculate row height
    let maxHeight = 0;
    row.forEach((val, i) => {
      const h = doc.heightOfString(val, { width: colWidths[i] - 10, align: 'center' });
      if (h > maxHeight) maxHeight = h;
    });
    const rowHeight = Math.max(minRowHeight, maxHeight + padding);

    // Alternate row background
    if (index % 2 === 0) {
      doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
         .fill(COLORS.tableRow);
    }

    // Draw texts
    xPos = margin;
    row.forEach((val, i) => {
      const cellWidth = colWidths[i] - 10;
      const textHeight = doc.heightOfString(val, { width: cellWidth, align: 'center' });
      const textY = y + (rowHeight - textHeight) / 2;
      const align = (i === 0 || i === 3 || i === 4) ? 'center' : 'left';
      if (i === 2) {
        doc.fillColor(COLORS.accent);
      } else {
        doc.fillColor(COLORS.darkText);
      }
      doc.text(val, xPos + 5, textY, { width: cellWidth, align: align });
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
    if (y + minRowHeight > pageHeight - 80) {
      doc.addPage();
      const newPageY = drawHeader(doc, pageWidth, 0);
      y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', newPageY);
      // Redraw table header
      doc.rect(margin, y, pageWidth - 2 * margin, headerHeight)
         .fill(COLORS.tableHeader);
      doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
      xPos = margin;
      headers.forEach((h, i) => {
        const cellWidth = colWidths[i] - 10;
        const textHeight = doc.heightOfString(h, { width: cellWidth, align: 'center' });
        const textY = y + (headerHeight - textHeight) / 2;
        doc.text(h, xPos + 5, textY, { width: cellWidth, align: 'center' });
        xPos += colWidths[i];
      });
      y += headerHeight;
    }
  });

  // Check for new page before totals
  if (y + minRowHeight > pageHeight - 80) {
    doc.addPage();
    const newPageY = drawHeader(doc, pageWidth, 0);
    y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', newPageY);
    // Redraw table header
    doc.rect(margin, y, pageWidth - 2 * margin, headerHeight)
       .fill(COLORS.tableHeader);
    doc.font(FONTS.tableHeader).fontSize(11).fillColor(COLORS.primary);
    xPos = margin;
    headers.forEach((h, i) => {
      const cellWidth = colWidths[i] - 10;
      const textHeight = doc.heightOfString(h, { width: cellWidth, align: 'center' });
      const textY = y + (headerHeight - textHeight) / 2;
      doc.text(h, xPos + 5, textY, { width: cellWidth, align: 'center' });
      xPos += colWidths[i];
    });
    y += headerHeight;
  }

  // Totals row (place 'Totals' in the 'Colour' column for better fit)
  doc.font(FONTS.tableHeader).fontSize(11);
  const totalsRow = ['', 'Totals', '', totalF.toString(), `${totalG.toFixed(2)}mm`, ''];
  let totalsMaxHeight = 0;
  totalsRow.forEach((val, i) => {
    const h = doc.heightOfString(val, { width: colWidths[i] - 10, align: 'center' });
    if (h > totalsMaxHeight) totalsMaxHeight = h;
  });
  const totalsRowHeight = Math.max(minRowHeight, totalsMaxHeight + padding);
  doc.rect(margin, y, pageWidth - 2 * margin, totalsRowHeight)
     .fill(COLORS.tableHeader);
  doc.fillColor(COLORS.primary);
  xPos = margin;
  totalsRow.forEach((val, i) => {
    const cellWidth = colWidths[i] - 10;
    const textHeight = doc.heightOfString(val, { width: cellWidth, align: 'center' });
    const textY = y + (totalsRowHeight - textHeight) / 2;
    const align = (i === 0 || i === 3 || i === 4) ? 'center' : 'left';
    doc.text(val, xPos + 5, textY, { width: cellWidth, align: align });
    xPos += colWidths[i];
  });

  return y + totalsRowHeight + 25;
};

export const generatePdfDownload = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems } = req.body;
    const { userId } = req.params;

    // Validate inputs
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

    // Initialize PDF document
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

    // Page 1: Header and Order Details
    const margin = 50;
    const imgSize = 240; // Adjusted size to fit 2 per row
    const gap = 15; // Adjusted gap

    // Add first page
    doc.addPage();
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    let y = drawHeader(doc, pageWidth, 0);

    // Order Details Table
    y = drawOrderDetailsTable(doc, JobReference, Number, OrderContact, OrderDate,
                             DeliveryAddress || PickupNotes, y);

    // Instructions Section
    y = drawInstructions(doc, y);

    // Image handling - 2 diagrams on first page
    const firstPageMaxPaths = 2;
    const remainingPathsPerPage = 4; // 4 diagrams per subsequent page

    // Calculate total image pages
    const firstPagePaths = Math.min(firstPageMaxPaths, validPaths.length);
    const remainingPathsCount = validPaths.length - firstPagePaths;
    const remainingPagesNeeded = Math.ceil(remainingPathsCount / remainingPathsPerPage);
    const imagePageCount = (firstPagePaths > 0 ? 1 : 0) + remainingPagesNeeded;
    let imagePart = 1;

    const pathsPerRow = 2;
    const tableHeightApprox = 68; // Approximate, but actual will be used for frame

    if (firstPagePaths > 0) {
      y = drawSectionHeader(doc, `FLASHING DETAILS - PART ${imagePart++} OF ${imagePageCount}`, y);
      const startX = margin;
      const startY = y;

      for (let i = 0; i < firstPagePaths; i++) {
        const row = Math.floor(i / pathsPerRow);
        const col = i % pathsPerRow;
        const x = startX + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + tableHeightApprox);

        try {
          const pathData = validPaths[i];
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          // Convert SVG to PNG with optimized settings
          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize({
              width: imgSize * 4, // Reduced multiplier for optimization (960px at 300DPI equivalent)
              height: imgSize * 4,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png({ 
              quality: 100, 
              compressionLevel: 9, // Max compression
              effort: 10, // Max effort for compression
              palette: true // Use palette for color reduction (good for diagrams)
            })
            .toBuffer();

          // Embed image in PDF
          const img = doc.openImage(imageBuffer);
          const imgW = imgSize;
          const imgH = (img.height * imgW) / img.width;

          // Property table first (on top)
          const tableY = yPos;
          const tableX = x + (imgSize - 230) / 2; // Center table under diagram position
          const tableEndY = drawDiagramPropertyTable(doc, tableX, tableY, pathData, groupedQuantitiesAndLengths[i], i);

          // Diagram below table (no gap)
          const imageY = tableEndY;
          doc.image(imageBuffer, x, imageY, { width: imgW, height: imgH });

          // Draw professional frame around properties and diagram
          const framePadding = 5;
          const frameX = Math.min(x, tableX) - framePadding;
          const frameY = yPos - framePadding;
          const frameWidth = Math.max(imgW, 230) + 2 * framePadding;
          const frameHeight = (tableEndY - tableY) + imgH + 2 * framePadding;
          doc.rect(frameX, frameY, frameWidth, frameHeight)
             .lineWidth(0.5)
             .strokeColor(COLORS.border)
             .stroke();

        } catch (err) {
          console.warn(`Image error (path ${i}):`, err.message);
          doc.font('Helvetica').fontSize(14)
            .text(`Image unavailable`, x, yPos);
        }
      }
      const rowsCount = Math.ceil(firstPagePaths / pathsPerRow);
      y = startY + rowsCount * (imgSize + tableHeightApprox);
    }

    // Remaining images: 4 per page on new pages, in 2x2 grid
    if (remainingPathsCount > 0) {
      for (let pageIndex = 0; pageIndex < remainingPagesNeeded; pageIndex++) {
        doc.addPage();
        y = drawHeader(doc, pageWidth, 0);
        y = drawSectionHeader(doc, `FLASHING DETAILS - PART ${imagePart++} OF ${imagePageCount}`, y);

        const startPath = firstPagePaths + pageIndex * remainingPathsPerPage;
        const endPath = Math.min(startPath + remainingPathsPerPage, validPaths.length);
        const pathsThisPage = endPath - startPath;

        const startX = margin;
        const startY = y;

        for (let j = 0; j < pathsThisPage; j++) {
          const i = startPath + j;
          const row = Math.floor(j / pathsPerRow);
          const col = j % pathsPerRow;
          const x = startX + col * (imgSize + gap);
          const yPos = startY + row * (imgSize + tableHeightApprox);

          try {
            const pathData = validPaths[i];
            const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection);
            const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

            // Convert SVG to PNG with optimized settings
            const imageBuffer = await sharp(Buffer.from(svgString))
              .resize({
                width: imgSize * 4, // Reduced multiplier for optimization (960px at 300DPI equivalent)
                height: imgSize * 4,
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              })
              .png({ 
                quality: 100, 
                compressionLevel: 9, // Max compression
                effort: 10, // Max effort for compression
                palette: true // Use palette for color reduction (good for diagrams)
              })
              .toBuffer();

            // Embed image in PDF
            const img = doc.openImage(imageBuffer);
            const imgW = imgSize;
            const imgH = (img.height * imgW) / img.width;

            // Property table first (on top)
            const tableY = yPos;
            const tableX = x + (imgSize - 230) / 2; // Center table under diagram position
            const tableEndY = drawDiagramPropertyTable(doc, tableX, tableY, pathData, groupedQuantitiesAndLengths[i], i);

            // Diagram below table (no gap)
            const imageY = tableEndY;
            doc.image(imageBuffer, x, imageY, { width: imgW, height: imgH });

            // Draw professional frame around properties and diagram
            const framePadding = 5;
            const frameX = Math.min(x, tableX) - framePadding;
            const frameY = yPos - framePadding;
            const frameWidth = Math.max(imgW, 230) + 2 * framePadding;
            const frameHeight = (tableEndY - tableY) + imgH + 2 * framePadding;
            doc.rect(frameX, frameY, frameWidth, frameHeight)
               .lineWidth(0.5)
               .strokeColor(COLORS.border)
               .stroke();

          } catch (err) {
            console.warn(`Image error (path ${i}):`, err.message);
            doc.font('Helvetica').fontSize(14)
              .text(`Image unavailable`, x, yPos);
          }
        }
        const rowsCount = Math.ceil(pathsThisPage / pathsPerRow);
        y = startY + rowsCount * (imgSize + tableHeightApprox);
      }
    }

    // Determine if the last flashing details page has 1 or 2 diagrams
    let lastDiagramsCount = firstPagePaths;
    if (remainingPathsCount > 0) {
      lastDiagramsCount = remainingPathsCount % remainingPathsPerPage;
      if (lastDiagramsCount === 0) lastDiagramsCount = remainingPathsPerPage;
    }

    // Add summary table, potentially on the same page if last flashing page has >2 diagrams
    // Modified: Add new page if lastDiagramsCount <= 2 to avoid overlap/collapse when few diagrams
    let addedNewPageForSummary = false;
    if (lastDiagramsCount <= 2) {
      doc.addPage();
      addedNewPageForSummary = true;
    }
    y = addedNewPageForSummary ? drawHeader(doc, pageWidth, 0) : y;
    y = drawSummaryTable(doc, validPaths, groupedQuantitiesAndLengths, y);

    // Draw footer on all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, pageWidth, pageHeight, i + 1);
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
