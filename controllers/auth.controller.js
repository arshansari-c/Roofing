
import { User } from '../models/auth.model.js'; // adjust the path if needed
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import nodemailer from 'nodemailer'
import jwt from 'jsonwebtoken';
import { transporter } from '../util/EmailTransporter.js';
import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';
import { ProjectData } from '../models/project.model.js';
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});
export const UploadProjectPdf = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pdf } = req.files || {};
    const { Name, Code, Color, Quantity, TotalLength } = req.body;

    // Validate PDF file
    if (!pdf) {
      return res.status(400).json({ message: "PDF file is required" });
    }

    // Validate userId
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Validate body fields
    const requiredFields = { Name, Code, Color, Quantity, TotalLength };
    const missingField = Object.entries(requiredFields).find(([key, value]) => !value);
    if (missingField) {
      return res.status(400).json({ message: `${missingField[0]} is required` });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ message: "User not found" });
    }

    // Upload to Cloudinary
    const uploadPdf = await cloudinary.uploader.upload(pdf.tempFilePath, {
      folder: "freelancers",
      resource_type: "raw", // PDFs need 'raw' type
      access_mode: "public"
    });

    // Save project to DB
    const savedProject = await ProjectData.create({
      userId,
      pdf: [{
        public_id: uploadPdf.public_id,
        url: uploadPdf.secure_url,
      }],
      Name,
      Code,
      Color,
      Quantity,
      TotalLength
    });

    return res.status(201).json({
      message: "Project uploaded successfully",
      project: savedProject
    });

  } catch (error) {
    console.error("UploadProjectPdf error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const UpdateProfile = async (req, res) => {
  try {
    // Extract token from header
    const {token} = req.params // e.g., Bearer <token>

    if (!token) {
      return res.status(401).json({ message: "Token missing" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select("-password");
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const { username, password } = req.body;

    // Update username if provided
    if (username) {
      findUser.username = username;
    }

    // Update password securely
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      findUser.password = hashedPassword;
    }

    // Update profile photo if provided
    if (req.files?.photo) {
      const photo = req.files.photo;
      const uploadPhoto = await cloudinary.uploader.upload(photo.tempFilePath);
      findUser.image = uploadPhoto.secure_url;
    }

    await findUser.save();
    return res.status(200).json({ message: "Profile updated successfully" });

  } catch (error) {
    console.log("❌ UpdateProfile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Basic validation
    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ message: "User with that email or username already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      ipAddress: [
        {
          latestIP: clientIP,
          oldIP: '',
          loginDate: new Date()
        }
      ],
      oldPassword: [
        {
          password: hashedPassword,
          passwordDate: new Date()
        }
      ],
      lastLogin: new Date()
    });

    await newUser.save();

    // ✅ Generate token instead of cookie
    const token = jwt.sign({ userId: newUser._id }, process.env.SECRET_TOKEN_KEY, {
      expiresIn: '7d',
    });

    // ✅ Return token in response (mobile-friendly)
    return res.status(201).json({
      message: "User registered successfully",
      userId: newUser._id,
      role : newUser.role,
      token, // <--- Mobile app will save this in AsyncStorage
    });

  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



const loginAttempts = {}; // In-memory store

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Rate Limiting by IP
    const now = Date.now();
    const attempts = loginAttempts[clientIP] || [];
    const recentAttempts = attempts.filter((time) => now - time < 60 * 1000); // last 60s

    if (recentAttempts.length >= 4) {
      return res.status(429).json({ message: "Too many attempts. Please try again after 60 seconds." });
    }

    loginAttempts[clientIP] = [...recentAttempts, now];

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Add IP to history
    user.ipAddress.unshift({
      latestIP: clientIP,
      oldIP: user.ipAddress[0]?.latestIP || '',
      loginDate: new Date(),
    });

    // Update lastLogin
    user.lastLogin = new Date();

    await user.save();

    // ✅ Generate token instead of using cookie
    const token = jwt.sign({ userId: user._id }, process.env.SECRET_TOKEN_KEY, {
      expiresIn: '7d',
    });

    return res.status(200).json({
      message: "Login successful",
      userId: user._id,
      role: user.role,
      token, // ← frontend will store this
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



export const Profile = async (req, res) => {
  try {
    const token = req.params.token; // ✅ correctly access token

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile fetched successfully",
      findUser,
    });

  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// export const sendEmail = async (req, res) => {
//   try {
//     const info = await transporter.sendMail({
//       from: '"Test Sender" <nsouajg6pjadchtq@ethereal.email>',
//       to: 'ansariarsh325@gmail.com',
//       subject: 'Hello from Ethereal!',
//       text: 'This is a plain text message.',
//       html: '<h1>This is an HTML message</h1>',
//     });

//     console.log('Message sent: %s', info.messageId);
//     console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));

//     return res.status(200).json({
//       message: 'Email sent successfully',
//       preview: nodemailer.getTestMessageUrl(info),
//     });
//   } catch (error) {
//     console.error('Error sending email:', error);
//     return res.status(500).json({ message: 'Internal Server Error' });
//   }
// };

export const addTeamMemberEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check for valid userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let { emails } = req.body; // Accepts `emails` as a field

    if (!emails) {
      return res.status(400).json({ message: "Emails are required" });
    }

    // If it's a comma-separated string, convert to array
    if (typeof emails === 'string') {
      emails = emails.split(',').map(email => email.trim());
    }

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ message: "Emails must be a non-empty array" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const addedEmails = [];

    emails.forEach(email => {
      if (
        emailRegex.test(email) &&
        !user.teamMemberEmails.includes(email)
      ) {
        user.teamMemberEmails.push(email);
        addedEmails.push(email);
      }
    });

    if (addedEmails.length === 0) {
      return res.status(409).json({ message: "No valid or new emails to add" });
    }

    await user.save();

    return res.status(200).json({
      message: "Emails added successfully",
      addedEmails,
      allTeamMemberEmails: user.teamMemberEmails
    });

  } catch (error) {
    console.error("addTeamMemberEmail error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



export const sendPdfToTeamFromEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress } = req.body;

    // Validate order details
    if (!JobReference || !Number || !OrderContact || !OrderDate || !DeliveryAddress) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Validate emails
    let { emails } = req.body;
    if (!emails) return res.status(400).json({ message: "Emails are required" });
    if (typeof emails === 'string') {
      emails = emails.split(',').map(email => email.trim()).filter(Boolean);
    }
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ message: "Emails must be a non-empty array" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({ message: "Invalid emails", invalidEmails });
    }

    // Validate PDF
    if (!req.files || !req.files.pdf) {
      return res.status(400).json({ message: "PDF file is required" });
    }
    const pdf = req.files.pdf;
    const tempPath = path.resolve(pdf.tempFilePath);

    // Prepare attachment
    const attachment = {
      filename: pdf.name,
      content: fs.createReadStream(tempPath),
      contentType: pdf.mimetype,
    };

    // Send email
    const info = await transporter.sendMail({
      from: user.email,
      to: emails,
      subject: 'New Flashing Order',
      html: `
        <p>Please find the attached flashing order PDF.</p>
        <p>info@commercialroofers.net.au | 0421259430</p>
        <p>
          Job Reference: ${JobReference}<br>
          Number: ${Number}<br>
          Order Contact: ${OrderContact}<br>
          Order Date: ${OrderDate}<br>
          Delivery Address: ${DeliveryAddress}
        </p>
      `,
      attachments: [attachment],
    });

    // Delete temp file
    fs.unlink(tempPath, (err) => {
      if (err) console.error("Failed to delete temp file:", err);
    });

    res.status(200).json({ message: "PDF sent successfully", info });

  } catch (error) {
    console.error("sendPdfToTeamFromEmail error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchTeamEmails = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const findUser = await User.findById(userId).select('teamMemberEmails');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Team email fetched successfully",
      teamMemberEmails: findUser.teamMemberEmails,
    });
  } catch (error) {
    console.log("fetchTeamEmails error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const UploadProjectData = async (req, res) => {
  try {
    const { userId } = req.params;
    const { projectData, Name, Code, Color, Quantity, TotalLength } = req.body;
    
    // Validate inputs
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }
    if (!Name || !Code || !Color || !Quantity || !TotalLength) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!projectData || typeof projectData !== "object") {
      return res.status(400).json({ message: "projectData must be a valid object" });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ message: "User not found" });
    }

    // Save project
    const savedProject = await ProjectData.create({
      userId,
      data: projectData,
      Name,
      Code,
      Color,
      Quantity,
      TotalLength
    });

    return res.status(201).json({
      message: "Project uploaded successfully",
      project: savedProject
    });
  } catch (error) {
    console.error("UploadProjectData error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchUploadProjectData = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const projects = await ProjectData.find({ userId });

    if (projects.length === 0) {
      return res.status(404).json({ message: "Project data not found" });
    }

    return res.status(200).json({
      message: "Data fetched successfully",
      projects
    });

  } catch (error) {
    console.error("fetchUploadProjectData error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchSelectedProjectData = async (req, res) => {
  try {
    const { userId, projectId } = req.params;

    if (!userId || !projectId) {
      return res.status(400).json({ message: "userId and projectId are required" });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find project and ensure it belongs to this user
    const project = await ProjectData.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ message: "Project not found for this user" });
    }

    return res.status(200).json({
      message: "Project fetched successfully",
      project
    });

  } catch (error) {
    console.error("fetchSelectedProjectData error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
