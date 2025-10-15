import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { User } from '../models/auth.model.js';
import PDFDocument from 'pdfkit';
import { ProjectOrder } from '../models/ProjectOrder.model.js';
import { transporter } from '../util/EmailTransporter.js';
import dotenv from 'dotenv';

dotenv.config();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
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

// Professional color scheme
const COLORS = {
  primary: '#0f172a',
  secondary: '#2563eb',
  accent: '#dc2626',
  lightBg: '#f9fafb',
  darkText: '#111827',
  border: '#d1d5db',
  tableHeader: '#e5e7eb',
  tableRow: '#f9fafb',
  success: '#16a34a',
  warning: '#d97706',
  shadow: '#0000001a',
};

// Font settings
const FONTS = {
  title: 'Helvetica-Bold',
  subtitle: 'Helvetica-Bold',
  body: 'Helvetica',
  tableHeader: 'Helvetica-Bold',
  tableBody: 'Helvetica',
  italic: 'Helvetica-Oblique',
  monospace: 'Courier',
};

// Configuration constants
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 12;
const CHEVRON_SIZE = 10;
const HOOK_RADIUS = 8;
const ZIGZAG_SIZE = 9;
const LABEL_PADDING = 12;
const SHADOW_OFFSET = 2;
const SCALE_BAR_LENGTH = 100;
const FOLD_LABEL_DISTANCE = 60; // Fixed 20mm distance for fold labels

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
const calculateBounds = (path, scale, showBorder, borderOffsetDirection, labelPositions = {}) => {
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
  
  // Process segment labels
  path.segments.forEach((segment, i) => {
    if (!segment.labelPosition || typeof segment.labelPosition.x === 'undefined' || typeof segment.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 50);
    maxX = Math.max(maxX, labelX + 50);
    minY = Math.min(minY, labelY - 30);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 30);

    // Process fold labels with fixed distance
    const foldLabelKey = `fold-${path.pathIndex}-${i}`;
    const foldLabelPos = labelPositions[foldLabelKey];
    if (foldLabelPos) {
      const foldLabelX = parseFloat(foldLabelPos.x);
      const foldLabelY = parseFloat(foldLabelPos.y);
      minX = Math.min(minX, foldLabelX - 50);
      maxX = Math.max(maxX, foldLabelX + 50);
      minY = Math.min(minY, foldLabelY - 30);
      maxY = Math.max(maxY, foldLabelY + ARROW_SIZE + 30);
    }
  });

  // Process angle labels
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
    minX = Math.min(minX, labelX - 50);
    maxX = Math.max(maxX, labelX + 50);
    minY = Math.min(minY, labelY - 30);
    maxY = Math.max(maxY, labelY + ARROW_SIZE + 30);
  });

  // Process border
  if (showBorder && path.points.length > 1) {
    const offsetSegments = calculateOffsetSegments(path, borderOffsetDirection);
    offsetSegments.forEach((seg) => {
      minX = Math.min(minX, seg.p1.x, seg.p2.x);
      maxX = Math.max(maxX, seg.p1.x, seg.p2.x);
      minY = Math.min(minY, seg.p1.y, seg.p2.y);
      maxY = Math.max(maxY, seg.p1.y, seg.p2.y);
    });
    
    // Process border arrow
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

  const padding = isLargeDiagram ? Math.max(50, (maxX - minX) * 0.05) : 40;
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

// Helper function to calculate fold label position with fixed distance
const calculateFoldLabelPosition = (segment, isFirstSegment, p1, p2, foldType, foldAngle = 0, flipped = false) => {
  const dx = parseFloat(p2.x) - parseFloat(p1.x);
  const dy = parseFloat(p2.y) - parseFloat(p1.y);
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return null;

  const unitX = dx / length;
  const unitY = dy / length;
  
  // Base point is the start of first segment or end of last segment
  const basePoint = isFirstSegment ? p1 : p2;
  
  // Calculate base direction (away from the path)
  let baseDirX, baseDirY;
  if (isFirstSegment) {
    baseDirX = unitX;
    baseDirY = unitY;
  } else {
    baseDirX = -unitX;
    baseDirY = -unitY;
  }

  // Calculate normal direction (perpendicular to the segment)
  let normalX = -baseDirY;
  let normalY = baseDirX;
  
  // Adjust for flip if needed
  if (flipped) {
    normalX = -normalX;
    normalY = -normalY;
  }

  // For different fold types, adjust the label position direction
  let labelDirX, labelDirY;
  
  if (foldType === 'Crush') {
    // For crush folds, position label in the normal direction
    labelDirX = normalX;
    labelDirY = normalY;
  } else {
    // For other folds, use the fold direction with some adjustment
    const foldAngleRad = (foldAngle * Math.PI) / 180;
    labelDirX = baseDirX * Math.cos(foldAngleRad) - baseDirY * Math.sin(foldAngleRad);
    labelDirY = baseDirX * Math.sin(foldAngleRad) + baseDirY * Math.cos(foldAngleRad);
    
    // Make sure label is positioned away from the diagram
    const dotProduct = labelDirX * normalX + labelDirY * normalY;
    if (dotProduct < 0) {
      labelDirX = -labelDirX;
      labelDirY = -labelDirY;
    }
  }

  // Normalize the direction vector
  const dirLength = Math.sqrt(labelDirX * labelDirX + labelDirY * labelDirY);
  if (dirLength > 0) {
    labelDirX /= dirLength;
    labelDirY /= dirLength;
  }

  // Position label at fixed 20mm distance
  const labelX = parseFloat(basePoint.x) + labelDirX * FOLD_LABEL_DISTANCE;
  const labelY = parseFloat(basePoint.y) + labelDirY * FOLD_LABEL_DISTANCE;

  return { x: labelX, y: labelY };
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
      const lengthNum = parseFloat(lengthStr.replace(/[^0-9.]/g, '')) || 0;
      totalLength += lengthNum;
    });
  }
  return totalLength.toFixed(2);
};

// Helper function to format Q x L
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  return quantitiesAndLengths.map(item => `${item.quantity} x ${parseFloat(item.length).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`).join('   ');
};

// Generate SVG string with proper fold label positions
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection, labelPositions = {}) => {
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

  // Generate path points and lines
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
    
    // Border arrow
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

  // Label design parameters
  let labelWidth = 90;
  const labelHeight = 36;
  const labelRadius = 12;
  const fontSize = 18;
  const tailSize = 10;
  const attachSize = 10;
  const labelBg = '#FFFFFF';
  const labelTextColor = '#000000';
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

    // Dynamic label width
    const textContent = segment.length || '';
    const approxTextWidth = textContent.length * (fontSize * 0.6);
    labelWidth = Math.max(90, approxTextWidth + 20);

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

    // Generate fold element if exists
    if (foldType !== 'None') {
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const segLength = Math.sqrt(dx * dx + dy * dy);
      
      if (segLength !== 0) {
        const unitX = dx / segLength;
        const unitY = dy / segLength;
        const isFirstSegment = i === 0;
        const isLastSegment = i === path.points.length - 2;
        
        // Only process end folds (first or last segment)
        if (isFirstSegment || isLastSegment) {
          let modelFoldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
          let modelFoldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
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
            
            const svgStart = transformCoord(modelStartX, modelStartY);
            const svgCp1 = transformCoord(modelCp1X, modelCp1Y);
            const svgCp2 = transformCoord(modelCp2X, modelCp2Y);
            const svgCurveEnd = transformCoord(modelCurveEndX, modelCurveEndY);
            const svgTail = transformCoord(modelTailX, modelTailY);
            foldPath = `M${svgStart.x},${svgStart.y} C${svgCp1.x},${svgCp1.y} ${svgCp2.x},${svgCp2.y} ${svgCurveEnd.x},${svgCurveEnd.y} L${svgTail.x},${svgTail.y}`;
          } else {
            let foldAngleVal = foldAngle;
            if (flipped) foldAngleVal = 360 - foldAngleVal;
            const foldAngleRad = foldAngleVal * Math.PI / 180;
            let baseDirX = isFirstSegment ? unitX : -unitX;
            let baseDirY = isFirstSegment ? unitY : -unitY;
            const foldDirX = baseDirX * Math.cos(foldAngleRad) - baseDirY * Math.sin(foldAngleRad);
            const foldDirY = baseDirX * Math.sin(foldAngleRad) + baseDirY * Math.cos(foldAngleRad);
            const modelFoldEndX = modelFoldBaseX + foldDirX * foldLength;
            const modelFoldEndY = modelFoldBaseY + foldDirY * foldLength;
            
            const svgBase = transformCoord(modelFoldBaseX, modelFoldBaseY);
            const svgEnd = transformCoord(modelFoldEndX, modelFoldEndY);
            foldPath = `M${svgBase.x},${svgBase.y} L${svgEnd.x},${svgEnd.y}`;
          }
          
          foldElement = `<path d="${foldPath}" stroke="#000000" stroke-width="${2 * scaleFactor}" fill="none" filter="url(#dropShadow)"/>`;

          // Calculate fold label position with fixed distance
          const calculatedFoldLabelPos = calculateFoldLabelPosition(
            segment, isFirstSegment, p1, p2, foldType, foldAngle, flipped
          );

          let foldLabelPos;
          const foldLabelKey = `fold-${path.pathIndex}-${i}`;
          
          // Use calculated position if available, otherwise fall back to provided position
          if (calculatedFoldLabelPos) {
            foldLabelPos = calculatedFoldLabelPos;
          } else {
            foldLabelPos = labelPositions[foldLabelKey];
          }

          if (foldLabelPos) {
            const {x: foldLabelX, y: foldLabelY} = transformCoord(foldLabelPos.x, foldLabelPos.y);
            const foldLabelText = foldType === 'Crush' ? `${foldType.toUpperCase()} ${tailLengthVal}` : foldType.toUpperCase();
            const foldLabelWidth = Math.max(90, foldLabelText.length * (fontSize * 0.6) + 20);
            
            // Calculate tail for fold label - always point to the base point
            let foldTailPath = '';
            const foldTargetX = modelFoldBaseX;
            const foldTargetY = modelFoldBaseY;
            const {x: targetX, y: targetY} = transformCoord(foldTargetX, foldTargetY);
            const foldLabelDx = targetX - foldLabelX;
            const foldLabelDy = targetY - foldLabelY;
            const absFoldLabelDx = Math.abs(foldLabelDx);
            const absFoldLabelDy = Math.abs(foldLabelDy);

            if (absFoldLabelDx > absFoldLabelDy) {
              if (foldLabelDx < 0) {
                const baseX = foldLabelX - foldLabelWidth / 2;
                const tipX = baseX - tailSize;
                const topBaseY = foldLabelY - attachSize / 2;
                const bottomBaseY = foldLabelY + attachSize / 2;
                foldTailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${foldLabelY} Z`;
              } else {
                const baseX = foldLabelX + foldLabelWidth / 2;
                const tipX = baseX + tailSize;
                const topBaseY = foldLabelY - attachSize / 2;
                const bottomBaseY = foldLabelY + attachSize / 2;
                foldTailPath = `M${baseX} ${topBaseY} L${baseX} ${bottomBaseY} L${tipX} ${foldLabelY} Z`;
              }
            } else {
              if (foldLabelDy < 0) {
                const baseY = foldLabelY - labelHeight / 2;
                const tipY = baseY - tailSize;
                const leftBaseX = foldLabelX - attachSize / 2;
                const rightBaseX = foldLabelX + attachSize / 2;
                foldTailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${foldLabelX} ${tipY} Z`;
              } else {
                const baseY = foldLabelY + labelHeight / 2;
                const tipY = baseY + tailSize;
                const leftBaseX = foldLabelX - attachSize / 2;
                const rightBaseX = foldLabelX + attachSize / 2;
                foldTailPath = `M${leftBaseX} ${baseY} L${rightBaseX} ${baseY} L${foldLabelX} ${tipY} Z`;
              }
            }

            foldElement += `
              <g filter="url(#dropShadow)">
                <rect x="${foldLabelX - foldLabelWidth/2}" y="${foldLabelY - labelHeight/2}"
                      width="${foldLabelWidth}" height="${labelHeight}"
                      fill="${labelBg}" rx="${labelRadius}"
                      stroke="#000000" stroke-width="0.5"/>
                <path d="${foldTailPath}" fill="${tailFill}"/>
                <text x="${foldLabelX}" y="${foldLabelY}" font-size="${fontSize}" font-family="${FONTS.body}" font-weight="bold"
                      fill="${labelTextColor}" text-anchor="middle" alignment-baseline="middle">
                  ${foldLabelText}
                </text>
              </g>
            `;
          }
        }
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
              fill="${labelTextColor}" text-anchor="middle" alignment-baseline="middle">
          ${segment.length}
        </text>
      </g>
      ${foldElement}
    `;
  }).join('');

  // Generate angles with labels and tails
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

    const textContent = `${roundedValue}°`;
    const approxTextWidth = textContent.length * (fontSize * 0.6);
    labelWidth = Math.max(90, approxTextWidth + 20);

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
      <g filter="url(#dropShadow)">
        <rect x="${posX - labelWidth / 2}" y="${posY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" fill="${labelBg}" rx="${labelRadius}" stroke="#000000" stroke-width="0.5"/>
        <path d="${tailPath}" fill="${tailFill}"/>
        <text x="${posX}" y="${posY}" font-size="${fontSize}" font-family="${FONTS.body}" font-weight="bold" fill="${labelTextColor}" text-anchor="middle" alignment-baseline="middle">
          ${roundedValue}°
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

// Helper function to draw header
const drawHeader = (doc, pageWidth, y) => {
  const margin = 50;
  doc.rect(0, 0, pageWidth, 80)
     .fill('#FFFFFF');

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

  doc.moveTo(margin, 75)
     .lineTo(pageWidth - margin, 75)
     .strokeColor(COLORS.border)
     .dash(5, { space: 3 })
     .lineWidth(1)
     .stroke();

  return y + 85;
};

// Helper function to draw section header
const drawSectionHeader = (doc, text, y) => {
  const margin = 50;
  doc.rect(margin, y, doc.page.width - 2 * margin, 25)
     .fill(COLORS.lightBg);
  doc.rect(margin, y, 5, 25)
     .fill(COLORS.secondary);
  doc.font(FONTS.subtitle)
     .fontSize(15)
     .fillColor(COLORS.primary)
     .text(text, margin + 15, y + 5);
  return y + 35;
};

// Helper function to draw order details table
const drawOrderDetailsTable = (doc, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const tableWidth = pageWidth - 2 * margin;
  const rowHeight = 28;
  const colWidth = tableWidth / 2;

  doc.rect(margin, y, tableWidth, rowHeight)
     .fill(COLORS.tableHeader);
  doc.font(FONTS.tableHeader)
     .fontSize(13)
     .fillColor(COLORS.primary)
     .text('ORDER DETAILS', margin + 10, y + 7);
  y += rowHeight;

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
    doc.circle(margin + 15, y + 14, 2)
       .fill(COLORS.secondary);
    doc.font(FONTS.tableHeader)
       .fontSize(11)
       .fillColor(COLORS.darkText)
     .text(label, margin + 25, y + 8);
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

// Helper function to draw instructions
const drawInstructions = (doc, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  y = drawSectionHeader(doc, 'IMPORTANT NOTES', y);

  const instructions = [
    'Arrow points to the (solid) coloured side',
    '90° and 45° degrees are not labelled',
    'F = Total number of folds, each crush counts as 2 folds',
    'End fold labels are positioned 20mm away from the diagram for better visibility'
  ];

  instructions.forEach((instruction, index) => {
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

// Helper function to draw footer
const drawFooter = (doc, pageWidth, pageHeight, pageNumber) => {
  const margin = 50;
  doc.moveTo(margin, pageHeight - 50)
     .lineTo(pageWidth - margin, pageHeight - 50)
     .strokeColor(COLORS.border)
     .lineWidth(0.5)
     .stroke();

  doc.font(FONTS.body)
     .fontSize(10)
     .fillColor(COLORS.darkText)
     .text(`Page ${pageNumber}`, 0, pageHeight - 30, { width: pageWidth, align: 'center' });
};

// Draw property table below each diagram
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
  const code = (pathData.code || '').replace(/\D/g, '');
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
  const dataRowHeight = Math.max(minRowHeight, dataMaxH + 4);

  // Draw data row
  currentX = x;
  row.forEach((val, i) => {
    const align = aligns[i];
    if (i === 2) {
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
  doc.fillColor(COLORS.darkText);
  currentY += dataRowHeight;

  // Draw borders
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  doc.moveTo(x, y).lineTo(x + tableWidth, y).stroke();
  doc.moveTo(x, y + headerRowHeight).lineTo(x + tableWidth, y + headerRowHeight).stroke();
  doc.moveTo(x, currentY).lineTo(x + tableWidth, currentY).stroke();
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

// Helper function to draw summary table
const drawSummaryTable = (doc, validPaths, groupedQuantitiesAndLengths, y) => {
  const margin = 50;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

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

  // Table Rows
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

    let maxHeight = 0;
    row.forEach((val, i) => {
      const h = doc.heightOfString(val, { width: colWidths[i] - 10, align: 'center' });
      if (h > maxHeight) maxHeight = h;
    });
    const rowHeight = Math.max(minRowHeight, maxHeight + padding);

    if (index % 2 === 0) {
      doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
         .fill(COLORS.tableRow);
    }

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

    doc.moveTo(margin, y + rowHeight)
       .lineTo(pageWidth - margin, y + rowHeight)
       .strokeColor(COLORS.border)
       .lineWidth(0.5)
       .stroke();
    y += rowHeight;

    if (y + minRowHeight > pageHeight - 80) {
      doc.addPage();
      const newPageY = drawHeader(doc, pageWidth, 0);
      y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', newPageY);
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

  if (y + minRowHeight > pageHeight - 80) {
    doc.addPage();
    const newPageY = drawHeader(doc, pageWidth, 0);
    y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', newPageY);
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

  // Totals row
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

export const generatePdf = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, AdditionalItems, emails } = req.body;
    const { userId } = req.params;

    // Validate inputs
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
      if (!item.quantity || !item.length || isNaN(parseFloat(item.quantity)) || isNaN(parseFloat(item.length))) {
        return res.status(400).json({ message: 'Each QuantitiesAndLengths item must have valid numeric quantity and length' });
      }
    }

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
    const labelPositions = projectData.labelPositions || {};

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

    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // Page 1: Header and Order Details
    const margin = 50;
    const imgSize = 240;
    const gap = 15;

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
    const remainingPathsPerPage = 4;

    // Calculate total image pages
    const firstPagePaths = Math.min(firstPageMaxPaths, validPaths.length);
    const remainingPathsCount = validPaths.length - firstPagePaths;
    const remainingPagesNeeded = Math.ceil(remainingPathsCount / remainingPathsPerPage);
    const imagePageCount = (firstPagePaths > 0 ? 1 : 0) + remainingPagesNeeded;
    let imagePart = 1;

    const pathsPerRow = 2;
    const tableHeightApprox = 68;

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
          const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection, labelPositions);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection, labelPositions);

          // Convert SVG to PNG
          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize({
              width: imgSize * 4,
              height: imgSize * 4,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png({ 
              quality: 100, 
              compressionLevel: 9,
              effort: 10,
              palette: true
            })
            .toBuffer();

          // Embed image in PDF
          const img = doc.openImage(imageBuffer);
          const imgW = imgSize;
          const imgH = (img.height * imgW) / img.width;

          // Property table first
          const tableY = yPos;
          const tableX = x + (imgSize - 230) / 2;
          const tableEndY = drawDiagramPropertyTable(doc, tableX, tableY, pathData, groupedQuantitiesAndLengths[i], i);

          // Diagram below table
          const imageY = tableEndY;
          doc.image(imageBuffer, x, imageY, { width: imgW, height: imgH });

          // Draw frame
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
            const bounds = calculateBounds(pathData, scale, showBorder, borderOffsetDirection, labelPositions);
            const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection, labelPositions);

            // Convert SVG to PNG
            const imageBuffer = await sharp(Buffer.from(svgString))
              .resize({
                width: imgSize * 4,
                height: imgSize * 4,
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              })
              .png({ 
                quality: 100, 
                compressionLevel: 9,
                effort: 10,
                palette: true
              })
              .toBuffer();

            // Embed image in PDF
            const img = doc.openImage(imageBuffer);
            const imgW = imgSize;
            const imgH = (img.height * imgW) / img.width;

            // Property table first
            const tableY = yPos;
            const tableX = x + (imgSize - 230) / 2;
            const tableEndY = drawDiagramPropertyTable(doc, tableX, tableY, pathData, groupedQuantitiesAndLengths[i], i);

            // Diagram below table
            const imageY = tableEndY;
            doc.image(imageBuffer, x, imageY, { width: imgW, height: imgH });

            // Draw frame
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

    // Add summary table
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

    // Send email with PDF attachment
    if (emails && Array.isArray(emails) && emails.length > 0) {
      try {
        const htmlTemplate = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flashing Order - ${JobReference}</title>
    <style>
      body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1); }
      .header { background-color: #2563eb; color: #ffffff; padding: 20px; text-align: center; }
      .header h1 { margin: 0; font-size: 24px; }
      .content { padding: 20px; }
      .content p { font-size: 16px; color: #333333; line-height: 1.6; }
      .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
      .details-table th, .details-table td { padding: 12px; border: 1px solid #dddddd; text-align: left; }
      .details-table th { background-color: #f9fafb; font-weight: bold; color: #0f172a; }
      .footer { background-color: #f9fafb; padding: 15px; text-align: center; font-size: 14px; color: #777777; }
      .footer a { color: #2563eb; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Flashing Order Confirmation</h1>
      </div>
      <div class="content">
        <p>Dear Recipient,</p>
        <p>Thank you for your order with Commercial Roofers Pty Ltd. Please find the details of your flashing order below, along with the attached PDF for your records.</p>
        <table class="details-table">
          <tr><th>Job Reference</th><td>${JobReference}</td></tr>
          <tr><th>PO Number</th><td>${Number}</td></tr>
          <tr><th>Order Contact</th><td>${OrderContact}</td></tr>
          <tr><th>Order Date</th><td>${OrderDate}</td></tr>
          ${DeliveryAddress ? `<tr><th>Delivery Address</th><td>${DeliveryAddress}</td></tr>` : ''}
          ${!DeliveryAddress && PickupNotes ? `<tr><th>Pickup Notes</th><td>${PickupNotes}</td></tr>` : ''}
          <tr><th>Additional Notes</th><td>${Notes || 'N/A'}</td></tr>
          <tr><th>Additional Items</th><td>${AdditionalItems || 'N/A'}</td></tr>
        </table>
        <p>If you have any questions or need further assistance, feel free to contact us at info@commercialroofers.net.au or 0421259430.</p>
        <p>Best regards,<br>Commercial Roofers Pty Ltd Team</p>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} Commercial Roofers Pty Ltd. All rights reserved.<br>
        <a href="https://commercialroofers.net.au">Visit our website</a>
      </div>
    </div>
  </body>
  </html>
`;

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: emails.join(','),
          subject: `Flashing Order PDF - ${JobReference}`,
          html: htmlTemplate,
          attachments: [
            {
              filename: `project-${timestamp}.pdf`,
              path: pdfPath,
            },
          ],
        };

        await transporter.sendMail(mailOptions);
        console.log('Email sent successfully to:', emails);
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
      }
    } else {
      console.warn('No emails provided, skipping email sending.');
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
      await new ProjectOrder({
        userId: userId,
        pdf: [{
          public_id: uploadResult.public_id,
          url: uploadResult.secure_url,
        }],
        JobReference,
        data: projectData,
        Number,
        emailList: emails,
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
      message: 'PDF generated successfully',
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
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `Flashing Order - ${updatedOrderDetails.JobReference}`,
        Author: 'Commercial Roofers Pty Ltd',
        Creator: 'Flash.it Roofing App',
        CreationDate: new Date(),
      },
      autoFirstPage: false
    });

    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    console.log('Saving updated PDF to:', pdfPath);

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
    y = drawOrderDetailsTable(doc, updatedOrderDetails.JobReference, updatedOrderDetails.Number, updatedOrderDetails.OrderContact, updatedOrderDetails.OrderDate,
                             updatedOrderDetails.DeliveryAddress || findOrder.PickupNotes, y);

    // Instructions Section
    y = drawInstructions(doc, y);

    // Initialize groupedQuantitiesAndLengths for merged data
    const validPaths = mergedData.paths.filter(path => validatePoints(path.points));
    if (validPaths.length === 0) {
      console.warn('No valid paths found in merged data');
      return res.status(400).json({ message: 'No valid paths found in merged data' });
    }

    const itemsPerPath = Math.ceil(findOrder.QuantitiesAndLengths.length / validPaths.length);
    const groupedQuantitiesAndLengths = [];
    for (let i = 0; i < validPaths.length; i++) {
      const startIndex = i * itemsPerPath;
      const endIndex = Math.min(startIndex + itemsPerPath, findOrder.QuantitiesAndLengths.length);
      groupedQuantitiesAndLengths.push(findOrder.QuantitiesAndLengths.slice(startIndex, endIndex));
    }

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
          const bounds = calculateBounds(pathData, mergedData.scale, mergedData.showBorder, mergedData.borderOffsetDirection);
          const svgString = generateSvgString(pathData, bounds, mergedData.scale, mergedData.showBorder, mergedData.borderOffsetDirection);

          // Convert SVG to PNG with optimized settings
          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize({
              width: imgSize * 4,
              height: imgSize * 4,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png({ 
              quality: 100, 
              compressionLevel: 9,
              effort: 10,
              palette: true
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
            const bounds = calculateBounds(pathData, mergedData.scale, mergedData.showBorder, mergedData.borderOffsetDirection);
            const svgString = generateSvgString(pathData, bounds, mergedData.scale, mergedData.showBorder, mergedData.borderOffsetDirection);

            // Convert SVG to PNG with optimized settings
            const imageBuffer = await sharp(Buffer.from(svgString))
              .resize({
                width: imgSize * 4,
                height: imgSize * 4,
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              })
              .png({ 
                quality: 100, 
                compressionLevel: 9,
                effort: 10,
                palette: true
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

    // Add summary table on a new page if last flashing page has <=2 diagrams (to avoid UI collapse)
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
        console.log('Updated PDF written successfully to:', pdfPath);
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
      console.error('Updated PDF file not found at:', pdfPath);
      return res.status(500).json({ message: 'Updated PDF file not generated' });
    }

    // Upload to Cloudinary
    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(pdfPath, {
        folder: 'freelancers',
        resource_type: 'raw',
        access_mode: 'public',
      });
      console.log('Cloudinary upload result for updated PDF:', JSON.stringify(uploadResult, null, 2));
    } catch (uploadError) {
      console.error('Cloudinary upload error for updated PDF:', uploadError.message);
      return res.status(500).json({ message: 'Failed to upload updated PDF to Cloudinary', error: uploadError.message });
    }

    if (!uploadResult || !uploadResult.public_id || !uploadResult.secure_url) {
      console.error('Cloudinary upload result for updated PDF is invalid:', uploadResult);
      return res.status(500).json({ message: 'Invalid Cloudinary upload result for updated PDF' });
    }

    // Send email with PDF attachment if emails provided
    if (emails) {
      let emailList = typeof emails === 'string' ? emails.split(',').map(e => e.trim()).filter(Boolean) : emails;
      if (Array.isArray(emailList) && emailList.length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const invalidEmails = emailList.filter(email => !emailRegex.test(email));
        if (invalidEmails.length > 0) {
          return res.status(400).json({ message: 'Invalid emails', invalidEmails });
        }
        try {
          const info = await transporter.sendMail({
            from: `"${findUser.name}" <${findUser.email}>`,
            to: emailList,
            subject: `Updated Flashing Order - ${updatedOrderDetails.JobReference}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #000000; color: white; padding: 20px; text-align: center;">
                  <h1>Commercial Roofers Pty Ltd</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #000000;">
                  <h2 style="color: #000000;">Updated Flashing Order</h2>
                  <p>Please find the attached updated flashing order PDF.</p>
                 
                  <div style="background-color: #FFFFFF; padding: 15px; border-radius: 5px; margin: 15px 0;">
                    <p><strong>Job Reference:</strong> ${updatedOrderDetails.JobReference}</p>
                    <p><strong>PO Number:</strong> ${updatedOrderDetails.Number}</p>
                    <p><strong>Order Contact:</strong> ${updatedOrderDetails.OrderContact}</p>
                    <p><strong>Order Date:</strong> ${updatedOrderDetails.OrderDate}</p>
                    <p><strong>${updatedOrderDetails.DeliveryAddress ? 'Delivery Address' : 'Pickup Notes'}:</strong> ${updatedOrderDetails.DeliveryAddress || findOrder.PickupNotes || 'N/A'}</p>
                    ${findOrder.Notes ? `<p><strong>Notes:</strong> ${findOrder.Notes}</p>` : ''}
                  </div>
                 
                  ${findOrder.AdditionalItems ? `
                  <div style="background-color: #FFFFFF; padding: 15px; border-radius: 5px; margin: 15px 0;">
                    <h3 style="color: #000000; margin-top: 0;">Additional Items</h3>
                    <p>${findOrder.AdditionalItems.split('\n').map(line => line.trim()).filter(Boolean).join('<br>')}</p>
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
                filename: `${updatedOrderDetails.JobReference || 'FlashingOrder'}.pdf`,
                path: pdfPath,
                contentType: 'application/pdf',
              },
            ],
          });
          console.log('Email sent successfully for updated order:', info.messageId);
        } catch (emailError) {
          console.error('Email sending error for updated order:', emailError.message);
          return res.status(500).json({ message: 'Failed to send email for updated order', error: emailError.message });
        }
      }
    }

    // Update order in DB
    try {
      await ProjectOrder.findByIdAndUpdate(orderId, {
        pdf: [{
          public_id: uploadResult.public_id,
          url: uploadResult.secure_url,
        }],
        ...updatedOrderDetails
      });
      console.log('Project order updated successfully');
    } catch (dbError) {
      console.error('Database update error:', dbError.message);
      return res.status(500).json({ message: 'Failed to update order in database', error: dbError.message });
    }

    // Delete local PDF file
    try {
      await fsPromises.unlink(pdfPath);
      console.log('Local updated PDF deleted successfully:', pdfPath);
    } catch (deleteError) {
      console.warn('Failed to delete local updated PDF:', deleteError.message);
    }

    return res.status(200).json({
      message: 'PDF updated, email sent (if emails provided), and order updated successfully',
      cloudinaryUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('UpdateGerantePdfOrder error:', error.message);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
