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

  primary: '#000000', // Black for headers

  lightBg: '#FFFFFF', // White background

  darkText: '#000000', // Black text

  border: '#000000', // Black border

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

// Helper function to generate SVG string with better handling for large diagrams

const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {

  if (!validatePoints(path.points)) {

    console.warn('Skipping SVG generation for path due to invalid points:', path);

    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';

  }

  // Check if this is a large diagram

  const width = bounds.maxX - bounds.minX;

  const height = bounds.maxY - bounds.minY;

 

  const targetViewBoxSize = 1000;

  const scaleFactor = targetViewBoxSize * 0.8 / Math.max(width, height, 1);

  const offsetX = (targetViewBoxSize - width * scaleFactor) / 2;

  const offsetY = (targetViewBoxSize - height * scaleFactor) / 2;

 

  const viewBox = `0 0 ${targetViewBoxSize} ${targetViewBoxSize}`;

  const transformCoord = (x, y) => {

    return {

      x: (parseFloat(x) - bounds.minX) * scaleFactor + offsetX,

      y: (parseFloat(y) - bounds.minY) * scaleFactor + offsetY

    };

  };

  // Adjusted sizes (since we normalized, adjust sizes accordingly)

  const adjScale = scale;

  // Generate grid - skip for very large diagrams to improve performance

   let gridLines = '';

  const gridSize = GRID_SIZE;

  const gridStartX = Math.floor(bounds.minX / gridSize) * gridSize;

  const gridStartY = Math.floor(bounds.minY / gridSize) * gridSize;

  const gridEndX = Math.ceil(bounds.maxX / gridSize) * gridSize;

  const gridEndY = Math.ceil(bounds.maxY / gridSize) * gridSize;

  for (let x = gridStartX; x <= gridEndX; x += gridSize) {

    const {x: tx1, y: ty1} = transformCoord(x, gridStartY);

    const {x: tx2, y: ty2} = transformCoord(x, gridEndY);

    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#c4b7b7" stroke-width="${0.5 * scaleFactor}"/>`;

  }

  for (let y = gridStartY; y <= gridEndY; y += gridSize) {

    const {x: tx1, y: ty1} = transformCoord(gridStartX, y);

    const {x: tx2, y: ty2} = transformCoord(gridEndX, y);

    gridLines += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#c4b7b7" stroke-width="${0.5 * scaleFactor}"/>`;

  }

  // Generate path points and lines

  let svgContent = path.points.map((point) => {

    const {x: cx, y: cy} = transformCoord(point.x, point.y);

    return `<circle cx="${cx}" cy="${cy}" r="${3 * scaleFactor}" fill="#000000"/>`;

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

          svgContent += `<path d="${chevronPath}" stroke="#000000" stroke-width="${2 * scaleFactor}" fill="none"/>`;

        }

      }

    }

  }

  // Label design parameters (fixed in view units)

  const labelWidth = 65;

  const labelHeight = 30;

  const labelRadius = 10;

  const fontSize = 16;

  const tailSize = 6;

  const attachSize = 6;

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

          foldElement = `<path d="${foldPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none"/>`;

        } else if (foldType === 'Crush Hook') {

          const arcPath = `M${foldBase.x},${foldBase.y} L${foldEnd.x},${foldEnd.y} A${hookRadiusAdj},${hookRadiusAdj} 0 0 1 ${foldEnd.x + hookRadiusAdj * foldDirX},${foldEnd.y + hookRadiusAdj * foldDirY}`;

          foldElement = `<path d="${arcPath}" stroke="${foldColor}" stroke-width="${2 * scaleFactor}" fill="none"/>`;

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

              stroke="#000000" stroke-width="0.5"/>

        <path d="${tailPath}" fill="${tailFill}"/>

        <text x="${posX}" y="${posY}" font-size="${fontSize}"

              fill="${labelText}" text-anchor="middle" alignment-baseline="middle">

          ${segment.length}

        </text>

        ${foldElement}

      </g>

    `;

  }).join('');

  // Generate angles with labels and tails

svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
        return '';
    }

    // Parse angle value and skip rendering for 90° and 270°
    const angleValue = parseFloat(angle.angle.replace(/°/g, ''));
    if (angleValue === 90 || angleValue === 270) {
        return ''; // Skip rendering for 90° and 270° angles
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

    const roundedAngle = Math.round(parseFloat(angle.angle.replace(/°/g, '')));

    return `

      <g>

        <rect x="${posX - labelWidth / 2}" y="${posY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" fill="${labelBg}" rx="${labelRadius}" stroke="#000000" stroke-width="0.5"/>

        <path d="${tailPath}" fill="${tailFill}"/>

        <text x="${posX}" y="${posY}" font-size="${fontSize}" fill="${labelText}" text-anchor="middle" alignment-baseline="middle">

          ${roundedAngle}°

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

          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          // Convert SVG to PNG with higher resolution

          const imageBuffer = await sharp(Buffer.from(svgString))

            .resize({

              width: imgSize * 4,

              height: imgSize * 4,

              fit: 'contain',

              background: { r: 255, g: 255, b: 255, alpha: 1 },

            })

            .png({ quality: 100, compressionLevel: 0 })

            .toBuffer();

          // Card background for image

          doc.roundedRect(x - 10, yPos - 10, imgSize + 20, imgSize + 80, 5)

             .fill('white')

             .stroke(COLORS.border)

             .lineWidth(1)

             .stroke();

          // Embed image in PDF

          const img = doc.openImage(imageBuffer);

          const imgW = imgSize;

          const imgH = (img.height * imgW) / img.width;

          // Image

          doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

          // Info below image

          const infoY = yPos + imgH + 15;

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

          console.warn(`Image error (path ${i}):`, err.message);

          doc.font('Helvetica').fontSize(14)

            .text(`Image unavailable`, x, yPos);

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

            const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

            // Convert SVG to PNG with higher resolution

            const imageBuffer = await sharp(Buffer.from(svgString))

              .resize({

                width: imgSize * 4,

                height: imgSize * 4,

                fit: 'contain',

                background: { r: 255, g: 255, b: 255, alpha: 1 },

              })

              .png({ quality: 100, compressionLevel: 0 })

              .toBuffer();

            // Card background for image

            doc.roundedRect(x - 10, yPos - 10, imgSize + 20, imgSize + 80, 5)

               .fill('white')

               .stroke(COLORS.border)

               .lineWidth(1)

               .stroke();

            // Embed image in PDF

            const img = doc.openImage(imageBuffer);

            const imgW = imgSize;

            const imgH = (img.height * imgW) / img.width;

            // Image

            doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

            // Info below image

            const infoY = yPos + imgH + 15;

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

            console.warn(`Image error (path ${i}):`, err.message);

            doc.font('Helvetica').fontSize(14)

              .text(`Image unavailable`, x, yPos);

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
