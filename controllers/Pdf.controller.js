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
import dotenv from "dotenv"

dotenv.config()

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

// Derive __dirname for ES6 modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'Uploads');
await fsPromises.mkdir(uploadsDir, { recursive: true }).catch((err) => {
  console.error('Failed to create uploads directory:', err.message);
});

// Path to company logo
const logoPath = path.join(__dirname, 'assets', 'company.png');

// Configuration constants
const GRID_SIZE = 20;
const FOLD_LENGTH = 14;
const ARROW_SIZE = 10;

// Helper function to calculate bounds for a path
const calculateBounds = (path, scale) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  path.points.forEach((point) => {
    const x = parseFloat(point.x);
    const y = parseFloat(point.y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  path.segments.forEach((segment) => {
    const labelX = parseFloat(segment.labelPosition.x);
    const labelY = parseFloat(segment.labelPosition.y);
    minX = Math.min(minX, labelX - 35 / scale);
    maxX = Math.max(maxX, labelX + 35 / scale);
    minY = Math.min(minY, labelY - 20 / scale);
    maxY = Math.max(maxY, labelY + 20 / scale);
  });
  path.angles?.forEach((angle) => {
    const labelX = parseFloat(angle.labelPosition.x);
    const labelY = parseFloat(angle.labelPosition.y);
    minX = Math.min(minX, labelX - 35 / scale);
    maxX = Math.max(maxX, labelX + 35 / scale);
    minY = Math.min(minY, labelY - 20 / scale);
    maxY = Math.max(maxY, labelY + 20 / scale);
  });
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
      p1: {
        x: parseFloat(p1.x) + normalX * offsetDistance,
        y: parseFloat(p1.y) + normalY * offsetDistance,
      },
      p2: {
        x: parseFloat(p2.x) + normalX * offsetDistance,
        y: parseFloat(p2.y) + normalY * offsetDistance,
      },
    });
  }
  return offsetSegments;
};

// Helper function to generate SVG string
const generateSvgString = (path, bounds, scale, showBorder, borderOffsetDirection) => {
  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
  const offsetSegments = showBorder && path.points.length > 1 ? calculateOffsetSegments(path, borderOffsetDirection) : [];

  // Generate grid
  const scaledWidth = (bounds.maxX - bounds.minX) / scale;
  const scaledHeight = (bounds.maxY - bounds.minY) / scale;
  const gridStartX = Math.floor(bounds.minX / GRID_SIZE) * GRID_SIZE;
  const gridStartY = Math.floor(bounds.minY / GRID_SIZE) * GRID_SIZE;
  const gridEndX = gridStartX + scaledWidth + GRID_SIZE;
  const gridEndY = gridStartY + scaledHeight + GRID_SIZE;
  let gridLines = '';
  for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) {
    gridLines += `<line x1="${x}" y1="${gridStartY}" x2="${x}" y2="${gridEndY}" stroke="#AAAAAA" stroke-width="${0.5 / scale}"/>`;
  }
  for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) {
    gridLines += `<line x1="${gridStartX}" y1="${y}" x2="${gridEndX}" y2="${y}" stroke="#AAAAAA" stroke-width="${0.5 / scale}"/>`;
  }

  // Generate path points and lines
  let svgContent = path.points.map((point, i) => `
    <circle cx="${parseFloat(point.x)}" cy="${parseFloat(point.y)}" r="${3 / scale}" fill="#29313b"/>
  `).join('');

  if (path.points.length > 1) {
    svgContent += `
      <path d="M${path.points.map(p => `${parseFloat(p.x)},${parseFloat(p.y)}`).join(' L')}"
            stroke="#2c1a3c" stroke-width="${2.5 / scale}" fill="none"/>
    `;
  }

  // Generate offset segments for border
  if (showBorder && offsetSegments.length > 0) {
    svgContent += offsetSegments.map((segment, i) => `
      <line x1="${segment.p1.x}" y1="${segment.p1.y}" x2="${segment.p2.x}" y2="${segment.p2.y}"
            stroke="#cccccc" stroke-width="${3 / scale}" stroke-dasharray="${6 / scale},${4 / scale}"/>
    `).join('');

    const segment = offsetSegments[0];
    const midX = (segment.p1.x + segment.p2.x) / 2;
    const midY = (segment.p1.y + segment.p2.y) / 2;
    const origP1 = path.points[0];
    const origP2 = path.points[1];
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
      const direction = borderOffsetDirection === 'outside' ? 1 : -1;
      const chevronPath = `
        M${chevronX + chevronSize * normalX * direction + chevronSize * unitX},${chevronY + chevronSize * normalY * direction + chevronSize * unitY}
        L${chevronX},${chevronY}
        L${chevronX + chevronSize * normalX * direction - chevronSize * unitX},${chevronY + chevronSize * normalY * direction - chevronSize * unitY}
      `;
      svgContent += `<path d="${chevronPath}" stroke="#ff0000" stroke-width="${2 / scale}" fill="none"/>`;
    }
  }

  // Generate segments with labels, arrows, and folds
  svgContent += path.segments.map((segment, i) => {
    const p1 = path.points[i];
    const p2 = path.points[i + 1];
    if (!p1 || !p2) return '';

    let foldElement = '';
    const foldType = segment.fold || 'None';
    if (foldType !== 'None' && (i === 0 || i === path.points.length - 2)) {
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

        if (foldType === 'Crush') {
          const chevronPath = `
            M${foldEndX + (9 / scale) * normalX + (9 / scale) * unitX},${foldEndY + (9 / scale) * normalY + (9 / scale) * unitY}
            L${foldEndX},${foldEndY}
            L${foldEndX + (9 / scale) * normalX - (9 / scale) * unitX},${foldEndY + (9 / scale) * normalY - (9 / scale) * unitY}
          `;
          foldElement = `<path d="${chevronPath}" stroke="#000000" stroke-width="${2 / scale}" fill="none"/>`;
        } else if (foldType === 'Break') {
          const midX = foldBaseX + normalX * (FOLD_LENGTH / 2) / scale;
          const midY = foldBaseY + normalY * (FOLD_LENGTH / 2) / scale;
          const zigzagPath = `
            M${foldBaseX},${foldBaseY}
            L${midX + (9 / scale) * unitX},${midY + (9 / scale) * unitY}
            L${midX - (9 / scale) * unitX},${midY - (9 / scale) * unitY}
            L${foldEndX},${foldEndY}
          `;
          foldElement = `<path d="${zigzagPath}" stroke="#000000" stroke-width="${2 / scale}" fill="none"/>`;
        }
      }
    }

    const arrowX = parseFloat(segment.labelPosition.x);
    const arrowY = parseFloat(segment.labelPosition.y) + 20 / scale;
    const midX = (parseFloat(p1.x) + parseFloat(p2.x)) / 2;
    const midY = (parseFloat(p1.y) + parseFloat(p2.y)) / 2;
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

    return `
      <g>
        <rect x="${parseFloat(segment.labelPosition.x) - 35 / scale}" y="${parseFloat(segment.labelPosition.y) - 20 / scale}"
              width="${70 / scale}" height="${25 / scale}" fill="#ffffff" fill-opacity="0.9" rx="${5 / scale}"
              stroke="#1a3c34" stroke-width="${0.5 / scale}"/>
        <text x="${parseFloat(segment.labelPosition.x)}" y="${parseFloat(segment.labelPosition.y)}"
              font-size="${14 / scale}" fill="#361a3c" text-anchor="middle" alignment-baseline="middle">
          ${segment.length}
        </text>
        <path d="${arrowPath}" stroke="#666666" stroke-width="${1 / scale}" fill="#666666"/>
        ${foldElement}
        ${foldType !== 'None' ? `
          <text x="${parseFloat(segment.labelPosition.x)}" y="${parseFloat(segment.labelPosition.y) + 30 / scale}"
                font-size="${14 / scale}" fill="#000000" text-anchor="middle" alignment-baseline="middle">
            ${foldType}
          </text>
        ` : ''}
      </g>
    `;
  }).join('');

  // Generate angles
  svgContent += (path.angles || []).map((angle) => `
    <g>
      <rect x="${parseFloat(angle.labelPosition.x) - 35 / scale}" y="${parseFloat(angle.labelPosition.y) - 20 / scale}"
            width="${70 / scale}" height="${25 / scale}" fill="#ffffff" fill-opacity="0.9" rx="${5 / scale}"
            stroke="#e76f51" stroke-width="${0.5 / scale}"/>
      <text x="${parseFloat(angle.labelPosition.x)}" y="${parseFloat(angle.labelPosition.y)}"
            font-size="${14 / scale}" fill="#e76f51" text-anchor="middle" alignment-baseline="middle">
        ${angle.angle}
      </text>
      <path d="
        M${parseFloat(angle.labelPosition.x) - ARROW_SIZE},${parseFloat(angle.labelPosition.y) + 20 / scale - ARROW_SIZE}
        L${parseFloat(angle.labelPosition.x)},${parseFloat(angle.labelPosition.y) + 20 / scale}
        L${parseFloat(angle.labelPosition.x) - ARROW_SIZE + ARROW_SIZE * 0.5},${parseFloat(angle.labelPosition.y) + 20 / scale - ARROW_SIZE - ARROW_SIZE * 0.5}
        Z
      " stroke="#e76f51" stroke-width="${1 / scale}" fill="#e76f51"/>
    </g>
  `).join('');

  return `
    <svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
      <g>${gridLines}</g>
      <g>${svgContent}</g>
    </svg>
  `;
};

// Backend route handler
export const generatePdf = async (req, res) => {
  try {
    const { selectedProjectData, JobReference, Number, OrderContact, OrderDate, DeliveryAddress, PickupNotes, Notes, emails } = req.body;
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
    const doc = new PDFDocument({ size: 'A3', bufferPages: true });
    const timestamp = Date.now();
    const pdfPath = path.join(uploadsDir, `project-${timestamp}.pdf`);
    console.log('Saving PDF to:', pdfPath);

    // Create a write stream and pipe the document to it
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageWidth = 842; // A3 width in points
    const pageHeight = 1191; // A3 height in points
    const margin = 60;
    const imgSize = 300;
    const gap = 40;
    const pathsPerPage = 4;
    const imagePagesNeeded = Math.ceil(projectData.paths.length / pathsPerPage);

    // Page 1: Company Details, Order Details, Notes, and Table
    let y = margin;

    // Company Header with Logo on Right
    try {
      const logo = doc.openImage(logoPath);
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
    y += 50; // Adjust for logo height
    doc.font('Helvetica').fontSize(14)
      .text('contact@commercialroofers.net.au | 0421259430', margin, y);
    y += 40;

    // Order Details (Dynamic)
    const orderDetails = [
      `Job Reference: ${JobReference}`,
      `PO Number: ${Number}`,
      `Order Contact: ${OrderContact}`,
      `Order Date: ${OrderDate}`,
      DeliveryAddress ? `Delivery Address: ${DeliveryAddress}` : `Pickup Notes: ${PickupNotes || 'N/A'}`,
    ];

    doc.font('Helvetica').fontSize(14);
    orderDetails.forEach((text) => {
      doc.text(text, margin, y);
      y += 20;
    });
    y += 24;

    // Notes Section
    const notes = [
      '• Arrow points to the (solid) coloured side',
      '• 90° degrees are not labelled',
      '• F = Total number of folds, each crush counts as 2 folds',
    ];

    if (Notes) {
      notes.push(`• ${Notes}`);
    }

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
    projectData.paths.forEach((path) => {
      const row = [
        `${path.pathIndex}`,
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

    // Image pages (starting from a new page if paths exist)
    for (let pageIndex = 0; pageIndex < imagePagesNeeded; pageIndex++) {
      doc.addPage();
      y = margin;

      // Page Header with Logo on Right
      try {
        const logo = doc.openImage(logoPath);
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
      y += 50; // Adjust for logo height
      doc.font('Helvetica').fontSize(14)
        .text('contact@commercialroofers.net.au | 0421259430', margin, y);
      y += 40;

      // Images & Info
      const startPath = pageIndex * pathsPerPage;
      const endPath = Math.min(startPath + pathsPerPage, projectData.paths.length);
      const startX = margin;
      const startY = y;

      for (let i = startPath; i < endPath; i++) {
        const svgIndex = i - startPath;
        const row = Math.floor(svgIndex / 2);
        const col = svgIndex % 2;
        const x = startX + col * (imgSize + gap);
        const yPos = startY + row * (imgSize + gap + 70);

        try {
          const pathData = projectData.paths[i];
          const bounds = calculateBounds(pathData, scale);
          const svgString = generateSvgString(pathData, bounds, scale, showBorder, borderOffsetDirection);

          // Convert SVG to high-quality PNG using sharp
          const imageBuffer = await sharp(Buffer.from(svgString))
            .resize({
              width: imgSize * 2,
              height: imgSize * 2,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255 },
            })
            .png({ quality: 100, compressionLevel: 0 })
            .toBuffer();

          // Embed image in PDF
          const img = doc.openImage(imageBuffer);
          const imgW = imgSize;
          const imgH = (img.height * imgW) / img.width;

          // Border
          doc.rect(x - 8, yPos - 8, imgW + 16, imgH + 16)
            .lineWidth(1.5).strokeColor('black').stroke();

          // Image
          doc.image(imageBuffer, x, yPos, { width: imgW, height: imgH });

          // Info below image
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

          // Dashed line below image
          const lineY = yPos + imgH + 60;
          const length = parseFloat(pathData.totalLength) || 410;

          doc.lineWidth(1.5).dash(7, { space: 7 })
            .moveTo(x, lineY).lineTo(x + imgW, lineY).strokeColor('black').stroke();
          doc.undash();

          doc.font('Helvetica').fontSize(12)
            .text(`${length.toFixed(0)}`, x + imgW / 2, lineY - 15, { align: 'center' });

          doc.moveTo(x, lineY - 7).lineTo(x, lineY + 7).strokeColor('red').stroke();
          doc.moveTo(x + imgW, lineY - 7).lineTo(x + imgW, lineY + 7).stroke();
        } catch (err) {
          console.warn(`Image error (path ${i}):`, err.message);
          doc.font('Helvetica').fontSize(14)
            .text(`Image unavailable`, x, yPos);
        }
      }
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

    // Verify file exists before upload
    const exists = await fsPromises.access(pdfPath).then(() => true).catch(() => false);
    if (!exists) {
      console.error('PDF file not found at:', pdfPath);
      return res.status(500).json({ message: 'PDF file not generated' });
    }


    // Upload to Cloudinary
    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(pdfPath, {
 resource_type: "raw", // PDFs need 'raw' type
      access_mode: "public"
      });
      console.log('Cloudinary upload result:', JSON.stringify(uploadResult, null, 2));
    } catch (uploadError) {
      console.error('Cloudinary upload error:', uploadError.message);
      return res.status(500).json({ message: 'Failed to upload PDF to Cloudinary', error: uploadError.message });
    }

    // Send email with PDF attachment
    try {
      const info = await transporter.sendMail({
        from: `"${user.name}" <${user.email}>`,
        to: emailList,
        subject: 'New Flashing Order',
        html: `
          <p>Please find the attached flashing order PDF.</p>
          <p>info@commercialroofers.net.au | 0421259430</p>
          <p>
            Job Reference: ${JobReference}<br>
            Number: ${Number}<br>
            Order Contact: ${OrderContact}<br>
            Order Date: ${OrderDate}<br>
            ${DeliveryAddress ? `Delivery Address: ${DeliveryAddress}` : `Pickup Notes: ${PickupNotes || 'N/A'}`}${Notes ? `<br>Notes: ${Notes}` : ''}
          </p>
        `,
        attachments: [
          {
            filename: `${JobReference || 'FlashingOrder'}.pdf`,
            path: pdfPath, // Use the local PDF file
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
  url: uploadResult.secure_url,  // ✅ not secure.url
}],

        JobReference,
        data: selectedProjectData,
        Number,
        OrderContact,
        OrderDate,
        DeliveryAddress: DeliveryAddress || null,
        PickupNotes: PickupNotes || null,
        Notes: Notes || null,
      }).save();
      console.log('Project order saved successfully');
    } catch (dbError) {
      console.error('Database save error:', dbError.message);
      return res.status(500).json({ message: 'Failed to save order in database', error: dbError.message });
    }

    // Delete the local PDF file after upload and email
    try {
      await fsPromises.unlink(pdfPath);
      console.log('Local PDF deleted successfully:', pdfPath);
    } catch (deleteError) {
      console.warn('Failed to delete local PDF:', deleteError.message);
      // Continue execution even if deletion fails
    }

    // Return both local path (for reference) and Cloudinary URL
    return res.status(200).json({
      message: 'PDF generated, email sent, and local file deleted successfully',
      localPath: pdfPath, // Included for reference, though file is deleted
      cloudinaryUrl: `${uploadResult.secure_url}/fl_attachment`,
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
