import PDFDocument from 'pdfkit';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
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

// Color scheme for modern design
const COLORS = {
  primary: '#2c3e50',       // Dark blue for headers
  secondary: '#e74c3c',     // Red for accents
  accent: '#3498db',        // Blue for highlights
  lightBg: '#f8f9fa',       // Light background
  darkText: '#2c3e50',      // Dark text
  lightText: '#7f8c8d',     // Light text
  border: '#dee2e6',        // Border color
  success: '#27ae60',       // Green for positive elements
  warning: '#f39c12',       // Yellow/orange for warnings
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
    return { minX: 0, maxX: 100, minY: 0, maxY: 100 }; // Fallback bounds
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  path.points.forEach((point) => {
    const x = parseFloat(point.x);
    const y = parseFloat(point.y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const arrowOffset = 20 / scale + ARROW_SIZE + 20; // Extra padding for arrows and labels
  path.segments.forEach((segment, i) => {
    if (!segment.labelPosition || typeof segment.labelPosition.x === 'undefined' || typeof segment.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 35 / scale);
    maxX = Math.max(maxX, labelX + 35 / scale);
    minY = Math.min(minY, labelY - 20 / scale);
    maxY = Math.max(maxY, labelY + arrowOffset);
    const foldType = segment.fold || 'None';
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
        const normalX = unitY;
        const normalY = -unitX;
        const isFirstSegment = i === 0;
        const foldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
        const foldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
        const foldEndX = foldBaseX + normalX * FOLD_LENGTH / scale;
        const foldEndY = foldBaseY + normalY * FOLD_LENGTH / scale;
        const foldLabelX = foldEndX + normalX * 25 / scale;
        const foldLabelY = foldEndY + normalY * 25 / scale;
        minX = Math.min(minX, foldLabelX - 35 / scale, foldEndX, foldBaseX);
        maxX = Math.max(maxX, foldLabelX + 35 / scale, foldEndX, foldBaseX);
        minY = Math.min(minY, foldLabelY - 20 / scale, foldEndY, foldBaseY);
        maxY = Math.max(maxY, foldLabelY + arrowOffset, foldEndY, foldBaseY);
      }
    }
  });
  (path.angles || []).forEach((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return;
    }
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, labelX - 35 / scale);
    maxX = Math.max(maxX, labelX + 35 / scale);
    minY = Math.min(minY, labelY - 20 / scale);
    maxY = Math.max(maxY, labelY + arrowOffset);
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
          const chevronSize = 8 / scale;
          const chevronBaseDistance = 10 / scale;
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
  const padding = 50;
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minY: minY - padding,
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
  let totalFolds = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      const foldType = segment.fold || 'None';
      if (foldType !== 'None') {
        totalFolds += foldType === 'Crush' ? 2 : 1;
      }
    });
  }
  return totalFolds;
};

// Helper function to calculate girth (sum of segment lengths)
const calculateGirth = (path) => {
  let totalLength = 0;
  if (Array.isArray(path.segments)) {
    path.segments.forEach(segment => {
      totalLength += parseFloat(segment.length) || 0;
    });
  }
  return totalLength.toFixed(2);
};

// Helper function to format Q x L
const formatQxL = (quantitiesAndLengths) => {
  if (!Array.isArray(quantitiesAndLengths)) return 'N/A';
  return quantitiesAndLengths.map(item => `${item.quantity}x${parseFloat(item.length).toFixed(0)}`).join(', ');
};

// Helper function to generate SVG string
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {
  if (!validatePoints(path.points)) {
    console.warn('Skipping SVG generation for path due to invalid points:', path);
    return '<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="14" text-anchor="middle" fill="#000000">Invalid path data</text></svg>';
  }

  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
  const offsetSegments = showBorder && path.points.length > 1 ? calculateOffsetSegments(path, borderOffsetDirection) : [];

  // Generate grid
  const gridStartX = Math.floor(bounds.minX / GRID_SIZE) * GRID_SIZE;
  const gridStartY = Math.floor(bounds.minY / GRID_SIZE) * GRID_SIZE;
  const gridEndX = Math.ceil(bounds.maxX / GRID_SIZE) * GRID_SIZE;
  const gridEndY = Math.ceil(bounds.maxY / GRID_SIZE) * GRID_SIZE;
  let gridLines = '';
  for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) {
    gridLines += `<line x1="${x}" y1="${gridStartY}" x2="${x}" y2="${gridEndY}" stroke="#AAAAAA" stroke-width="${0.5 / scale}"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) {
    gridLines += `<line x1="${gridStartX}" y1="${y}" x2="${gridEndX}" y2="${y}" stroke="#AAAAAA" stroke-width="${0.5 / scale}"/>`;
  }

  // Generate path points and lines
  let svgContent = path.points.map((point) => `
    <circle cx="${parseFloat(point.x)}" cy="${parseFloat(point.y)}" r="${3 / scale}" fill="#29313b"/>
  `).join('');

  if (path.points.length > 1) {
    svgContent += `
      <path d="M${path.points.map(p => `${parseFloat(p.x)},${parseFloat(p.y)}`).join(' L')}"
            stroke="#000000" stroke-width="${2.5 / scale}" fill="none"/>
    `;
  }

  // Generate offset segments for border
  if (showBorder && offsetSegments.length > 0) {
    svgContent += offsetSegments.map((segment) => `
      <line x1="${segment.p1.x}" y1="${segment.p1.y}" x2="${segment.p2.x}" y2="${segment.p2.y}"
            stroke="#cccccc" stroke-width="${3 / scale}" stroke-dasharray="${6 / scale},${4 / scale}"/>
    `).join('');

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
          const chevronSize = 8 / scale;
          const chevronBaseDistance = 10 / scale;
          const chevronX = midX + normalX * chevronBaseDistance;
          const chevronY = midY + normalY * chevronBaseDistance;
          const direction = 1;
          const chevronPath = `
            M${chevronX + chevronSize * normalX * direction + chevronSize * unitX},${chevronY + chevronSize * normalY * direction + chevronSize * unitY}
            L${chevronX},${chevronY}
            L${chevronX + chevronSize * normalX * direction - chevronSize * unitX},${chevronY + chevronSize * normalY * direction - chevronSize * unitY}
          `;
          svgContent += `<path d="${chevronPath}" stroke="#000000" stroke-width="${2 / scale}" fill="none"/>`;
        }
      }
    }
  }

  // Generate segments with labels, arrows, and folds
  svgContent += (Array.isArray(path.segments) ? path.segments : []).map((segment, i) => {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    if (!p1 || !p2 || !segment.labelPosition) return '';

    const posX = parseFloat(segment.labelPosition.x);
    const posY = parseFloat(segment.labelPosition.y);
    const midX = (parseFloat(p1.x) + parseFloat(p2.x)) / 2;
    const midY = (parseFloat(p1.y) + parseFloat(p2.y)) / 2;
    const arrowX = posX;
    const arrowY = posY + 20 / scale;
    const arrowDx = midX - arrowX;
    const arrowDy = midY - arrowY;
    const arrowDist = Math.sqrt(arrowDx * arrowDx + arrowDy * arrowDy) || 1;
    const arrowUnitX = arrowDx / arrowDist;
    const arrowUnitY = arrowDy / arrowDist;
    const arrowPath = `
      M${arrowX - arrowUnitX * ARROW_SIZE},${arrowY - arrowUnitY * ARROW_SIZE}
      L${arrowX},${arrowY}
      L${arrowX - arrowUnitX * ARROW_SIZE + arrowUnitY * ARROW_SIZE * 0.5},${arrowY - arrowUnitY * ARROW_SIZE - arrowUnitX * ARROW_SIZE * 0.5}
      Z
    `;

    let foldElement = '';
    const foldType = segment.fold || 'None';
    if (foldType !== 'None') {
      const dx = parseFloat(p2.x) - parseFloat(p1.x);
      const dy = parseFloat(p2.y) - parseFloat(p1.y);
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length) {
        const unitX = dx / length;
        const unitY = dy / length;
        const normalX = unitY;
        const normalY = -unitX;
        const isFirstSegment = i === 0;
        const foldBaseX = isFirstSegment ? parseFloat(p1.x) : parseFloat(p2.x);
        const foldBaseY = isFirstSegment ? parseFloat(p1.y) : parseFloat(p2.y);
        const foldEndX = foldBaseX + normalX * FOLD_LENGTH / scale;
        const foldEndY = foldBaseY + normalY * FOLD_LENGTH / scale;
        const foldDir = isFirstSegment ? 1 : -1;

        if (foldType === 'Crush') {
          const chevron1X = foldEndX;
          const chevron1Y = foldEndY;
          const chevron2X = foldEndX - normalX * 3 / scale;
          const chevron2Y = foldEndY - normalY * 3 / scale;
          const chevronSize = 9 / scale;
          const chevronPath = `
            M${chevron1X + chevronSize * normalX + chevronSize * unitX * foldDir},${chevron1Y + chevronSize * normalY + chevronSize * unitY * foldDir}
            L${chevron1X},${chevron1Y}
            L${chevron1X + chevronSize * normalX - chevronSize * unitX * foldDir},${chevron1Y + chevronSize * normalY - chevronSize * unitY * foldDir}
            M${chevron2X + chevronSize * normalX + chevronSize * unitX * foldDir},${chevron2Y + chevronSize * normalY + chevronSize * unitY * foldDir}
            L${chevron2X},${chevron2Y}
            L${chevron2X + chevronSize * normalX - chevronSize * unitX * foldDir},${chevron2Y + chevronSize * normalY - chevronSize * unitY * foldDir}
          `;
          foldElement = `<path d="${chevronPath}" stroke="#000000" stroke-width="${2 / scale}" fill="none"/>`;
        } else if (foldType === 'Open') {
          foldElement = `<line x1="${foldBaseX}" y1="${foldBaseY}" x2="${foldEndX}" y2="${foldEndY}" stroke="#000000" stroke-width="${2 / scale}"/>`;
        } else if (foldType === 'Crush Hook') {
          let unitDirX = unitX;
          let unitDirY = unitY;
          if (!isFirstSegment) {
            unitDirX = -unitX;
            unitDirY = -unitY;
          }
          const hookRadius = 8 / scale;
          const arcPath = `M${foldBaseX},${foldBaseY} L${foldEndX},${foldEndY} A${hookRadius},${hookRadius} 0 0 1 ${foldEndX + hookRadius * unitDirX},${foldEndY + hookRadius * unitDirY}`;
          foldElement = `<path d="${arcPath}" stroke="#000000" stroke-width="${2 / scale}" fill="none"/>`;
        } else if (foldType === 'Break') {
          let zigzagDirX = unitX;
          let zigzagDirY = unitY;
          if (!isFirstSegment) {
            zigzagDirX = -unitX;
            zigzagDirY = -unitY;
          }
          const midX = foldBaseX + normalX * (FOLD_LENGTH / 2) / scale;
          const midY = foldBaseY + normalY * (FOLD_LENGTH / 2) / scale;
          const zigzagPath = `
            M${foldBaseX},${foldBaseY}
            L${midX + (9 / scale) * zigzagDirX},${midY + (9 / scale) * zigzagDirY}
            L${midX - (9 / scale) * zigzagDirX},${midY - (9 / scale) * zigzagDirY}
            L${foldEndX},${foldEndY}
          `;
          foldElement = `<path d="${zigzagPath}" stroke="#000000" stroke-width="${2 / scale}" fill="none"/>`;
        }

        const foldLabelPosX = foldEndX + normalX * 25 / scale;
        const foldLabelPosY = foldEndY + normalY * 25 / scale;
        const foldArrowX = foldLabelPosX;
        const foldArrowY = foldLabelPosY + 20 / scale;
        const foldArrowDx = foldBaseX - foldArrowX;
        const foldArrowDy = foldBaseY - foldArrowY;
        const foldArrowDist = Math.sqrt(foldArrowDx * foldArrowDx + foldArrowDy * foldArrowDy) || 1;
        const foldArrowUnitX = foldArrowDx / foldArrowDist;
        const foldArrowUnitY = foldArrowDy / foldArrowDist;
        const foldArrowPath = `
          M${foldArrowX - foldArrowUnitX * ARROW_SIZE},${foldArrowY - foldArrowUnitY * ARROW_SIZE}
          L${foldArrowX},${foldArrowY}
          L${foldArrowX - foldArrowUnitX * ARROW_SIZE + foldArrowUnitY * ARROW_SIZE * 0.5},${foldArrowY - foldArrowUnitY * ARROW_SIZE - foldArrowUnitX * ARROW_SIZE * 0.5}
          Z
        `;
        const foldLabel = `
          <text x="${foldLabelPosX}" y="${foldLabelPosY}" font-size="${14 / scale}" fill="#000000" text-anchor="middle" alignment-baseline="middle">
            ${foldType}
          </text>
          <path d="${foldArrowPath}" stroke="#000000" stroke-width="${1 / scale}" fill="#000000"/>
        `;
        foldElement += foldLabel;
      }
    }

    return `
      <g>
        <rect x="${posX - 35 / scale}" y="${posY - 20 / scale}" width="${70 / scale}" height="${25 / scale}" fill="#ffffff" fill-opacity="0.9" rx="${5 / scale}" stroke="#1a3c34" stroke-width="${0.5 / scale}"/>
        <text x="${posX}" y="${posY}" font-size="${14 / scale}" fill="#361a3c" text-anchor="middle" alignment-baseline="middle">
          ${segment.length}
        </text>
        <path d="${arrowPath}" stroke="#666666" stroke-width="${1 / scale}" fill="#666666"/>
        ${foldElement}
      </g>
    `;
  }).join('');

  svgContent += (Array.isArray(path.angles) ? path.angles : []).map((angle) => {
    if (!angle.labelPosition || typeof angle.labelPosition.x === 'undefined' || typeof angle.labelPosition.y === 'undefined') {
      return '';
    }
    const anglePosX = parseFloat(angle.labelPosition.x);
    const anglePosY = parseFloat(angle.labelPosition.y);
    const vertexX = angle.vertexIndex && path.points[angle.vertexIndex] ? parseFloat(path.points[angle.vertexIndex].x) : anglePosX;
    const vertexY = angle.vertexIndex && path.points[angle.vertexIndex] ? parseFloat(path.points[angle.vertexIndex].y) : anglePosY;
    const angleArrowX = anglePosX;
    const angleArrowY = anglePosY + 20 / scale;
    const angleArrowDx = vertexX - angleArrowX;
    const angleArrowDy = vertexY - angleArrowY;
    const angleArrowDist = Math.sqrt(angleArrowDx * angleArrowDx + angleArrowDy * angleArrowDy) || 1;
    const angleArrowUnitX = angleArrowDx / angleArrowDist;
    const angleArrowUnitY = angleArrowDy / angleArrowDist;
    const angleArrowPath = `
      M${angleArrowX - angleArrowUnitX * ARROW_SIZE},${angleArrowY - angleArrowUnitY * ARROW_SIZE}
      L${angleArrowX},${angleArrowY}
      L${angleArrowX - angleArrowUnitX * ARROW_SIZE + angleArrowUnitY * ARROW_SIZE * 0.5},${angleArrowY - angleArrowUnitY * ARROW_SIZE - angleArrowUnitX * ARROW_SIZE * 0.5}
      Z
    `;
    return `
      <g>
        <rect x="${anglePosX - 35 / scale}" y="${anglePosY - 20 / scale}" width="${70 / scale}" height="${25 / scale}" fill="#ffffff" fill-opacity="0.9" rx="${5 / scale}" stroke="#e76f51" stroke-width="${0.5 / scale}"/>
        <text x="${anglePosX}" y="${anglePosY}" font-size="${14 / scale}" fill="#e76f51" text-anchor="middle" alignment-baseline="middle">
          ${angle.angle}
        </text>
        <path d="${angleArrowPath}" stroke="#e76f51" stroke-width="${1 / scale}" fill="#e76f51"/>
      </g>
    `;
  }).join('');

  return `
    <svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
      <g>${gridLines}</g>
      <g>${svgContent}</g>
    </svg>
  `;
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
     .fillColor('white')
     .text('Commercial Roofers Pty Ltd', margin, 30);
  
  // Contact info
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor('white')
     .text('contact@commercialroofers.net.au | 0421259430', margin, 55);
  
  // Page number if provided
  if (pageNumber !== null) {
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('white')
       .text(`Page ${pageNumber}`, pageWidth - margin, 55, { align: 'right' });
  }
  
  return y + 90;
};

// Helper function to draw footer
const drawFooter = (doc, pageWidth, pageHeight) => {
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.lightText)
     .text('Generated by Commercial Roofers Pty Ltd - Professional Roofing Solutions', 
           50, pageHeight - 30, 
           { width: pageWidth - 100, align: 'center' });
};

// Helper function to draw section header
const drawSectionHeader = (doc, text, y) => {
  doc.font('Helvetica-Bold')
     .fontSize(16)
     .fillColor(COLORS.primary)
     .text(text, 50, y);
  
  // Underline
  doc.moveTo(50, y + 5)
     .lineTo(50 + doc.widthOfString(text), y + 5)
     .strokeColor(COLORS.accent)
     .lineWidth(2)
     .stroke();
  
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
     .fillColor(COLORS.lightText)
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
      console.error('uploads directory is not defined');
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

    // Validate AdditionalItems (optional, can be empty string or null)
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
    const pathsPerPage = 4;

    // Filter valid paths
    const validPaths = projectData.paths.filter(path => validatePoints(path.points));
    if (validPaths.length === 0) {
      console.warn('No valid paths found in projectData');
      return res.status(400).json({ message: 'No valid paths found in project data' });
    }
    const imagePagesNeeded = Math.ceil(validPaths.length / pathsPerPage);

    // Track page numbers
    let pageNumber = 1;

    // Page 1: Header, Order Details, Notes, Additional Items, and Table
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
         .fillColor(COLORS.warning)
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
    
    y += 20;

    // Table Section
    y = drawSectionHeader(doc, 'ORDER SUMMARY', y);

    // Table Header
    const headers = ['#', 'Name', 'Code', 'Color', 'Q x L', 'Folds', 'Girth'];
    const colWidths = [40, 150, 100, 100, 120, 80, 80];
    const rowHeight = 30;

    // Draw table header with background
    let xPos = margin;
    doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
       .fill(COLORS.primary);
    
    doc.font('Helvetica-Bold').fontSize(12).fillColor('white');
    headers.forEach((h, i) => {
      doc.text(h, xPos + 10, y + 9, { width: colWidths[i] - 20, align: i > 0 ? 'left' : 'center' });
      xPos += colWidths[i];
    });
    y += rowHeight;

    // Group QuantitiesAndLengths by path
    const itemsPerPath = Math.ceil(QuantitiesAndLengths.length / validPaths.length);
    const groupedQuantitiesAndLengths = [];
    for (let i = 0; i < validPaths.length; i++) {
      const startIndex = i * itemsPerPath;
      const endIndex = Math.min(startIndex + itemsPerPath, QuantitiesAndLengths.length);
      groupedQuantitiesAndLengths.push(QuantitiesAndLengths.slice(startIndex, endIndex));
    }

    // Table Rows with alternating background
    doc.font('Helvetica').fontSize(11);
    validPaths.forEach((path, index) => {
      const pathQuantitiesAndLengths = groupedQuantitiesAndLengths[index] || [];
      const qxL = formatQxL(pathQuantitiesAndLengths);
      const totalFolds = calculateTotalFolds(path);
      const girth = calculateGirth(path);

      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
           .fill(COLORS.lightBg);
      }

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
        drawFooter(doc, pageWidth, pageHeight);
        doc.addPage();
        pageNumber++;
        y = drawHeader(doc, pageWidth, 0, pageNumber);
        y = drawSectionHeader(doc, 'ORDER SUMMARY (CONTINUED)', y);
        
        // Redraw table header
        xPos = margin;
        doc.rect(margin, y, pageWidth - 2 * margin, rowHeight)
           .fill(COLORS.primary);
        
        doc.font('Helvetica-Bold').fontSize(12).fillColor('white');
        headers.forEach((h, i) => {
          doc.text(h, xPos + 10, y + 9, { width: colWidths[i] - 20, align: i > 0 ? 'left' : 'center' });
          xPos += colWidths[i];
        });
        y += rowHeight;
      }
    });

    // Draw footer for first page
    drawFooter(doc, pageWidth, pageHeight);

    // Image pages
    for (let pageIndex = 0; pageIndex < imagePagesNeeded; pageIndex++) {
      doc.addPage();
      pageNumber++;
      y = drawHeader(doc, pageWidth, 0, pageNumber);
      
      y = drawSectionHeader(doc, `DETAILED VIEWS - PART ${pageIndex + 1} OF ${imagePagesNeeded}`, y);

      // Images & Info
      const startPath = pageIndex * pathsPerPage;
      const endPath = Math.min(startPath + pathsPerPage, validPaths.length);
      const startX = margin;
      const startY = y;

      for (let i = startPath; i < endPath; i++) {
        const svgIndex = i - startPath;
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
              width: imgSize * 3,
              height: imgSize * 3,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255 },
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
      
      // Draw footer for image page
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

    // Send email with PDF attachment
    try {
      const info = await transporter.sendMail({
        from: `"${user.name}" <${user.email}>`,
        to: emailList,
        subject: `New Flashing Order - ${JobReference}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2c3e50; color: white; padding: 20px; text-align: center;">
              <h1>Commercial Roofers Pty Ltd</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
              <h2 style="color: #2c3e50;">New Flashing Order</h2>
              <p>Please find the attached flashing order PDF.</p>
              
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Job Reference:</strong> ${JobReference}</p>
                <p><strong>PO Number:</strong> ${Number}</p>
                <p><strong>Order Contact:</strong> ${OrderContact}</p>
                <p><strong>Order Date:</strong> ${OrderDate}</p>
                <p><strong>${DeliveryAddress ? 'Delivery Address' : 'Pickup Notes'}:</strong> ${DeliveryAddress || PickupNotes || 'N/A'}</p>
                ${Notes ? `<p><strong>Notes:</strong> ${Notes}</p>` : ''}
              </div>
              
              ${additionalItemsText ? `
              <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <h3 style="color: #856404; margin-top: 0;">Additional Items</h3>
                <p>${additionalItemsText.split('\n').map(line => line.trim()).filter(Boolean).join('<br>')}</p>
              </div>
              ` : ''}
              
              <p>For any questions, please contact us at <a href="mailto:info@commercialroofers.net.au">info@commercialroofers.net.au</a> or call 0421259430.</p>
            </div>
            <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
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
