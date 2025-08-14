
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
import { ProjectOrder } from '../models/ProjectOrder.model.js';
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});
export const UploadProjectPdf = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pdf } = req.files || {};
    const { Name, Code, Color, Quantity, TotalLength,data } = req.body;

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
      data,
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


export const UpdateJobOrder = async (req, res) => {
  try {
    const { userId, orderId } = req.params;
    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress } = req.body;

    // 1️⃣ Validate IDs
    if (!userId || !orderId) {
      return res.status(400).json({ message: "userId and orderId are required" });
    }

    // 2️⃣ Check if user exists
    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3️⃣ Prepare update data (only include provided fields)
    const updateData = {};
    if (JobReference) updateData.JobReference = JobReference;
    if (Number) updateData.Number = Number;
    if (OrderContact) updateData.OrderContact = OrderContact;
    if (OrderDate) updateData.OrderDate = OrderDate;
    if (DeliveryAddress) updateData.DeliveryAddress = DeliveryAddress;

    // 4️⃣ Update order
    const updatedOrder = await ProjectOrder.findByIdAndUpdate(
      orderId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json({
      message: "Job order updated successfully",
      order: updatedOrder
    });

  } catch (error) {
    console.error("UpdateJobOrder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

import fs from "fs";

export const sendPdfToTeamFromEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress, emails } = req.body;

    // 1️⃣ Validate inputs
    if (!JobReference || !Number || !OrderContact || !OrderDate || !DeliveryAddress) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    // 2️⃣ Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 3️⃣ Validate email list
    let emailList = emails;
    if (!emailList) return res.status(400).json({ message: "Emails are required" });
    if (typeof emailList === "string") {
      emailList = emailList.split(",").map(e => e.trim()).filter(Boolean);
    }
    if (!Array.isArray(emailList) || emailList.length === 0) {
      return res.status(400).json({ message: "Emails must be a non-empty array" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emailList.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({ message: "Invalid emails", invalidEmails });
    }

    // 4️⃣ Validate PDF file
    if (!req.files || !req.files.pdf) {
      return res.status(400).json({ message: "PDF file is required" });
    }
    const pdf = req.files.pdf;

    // 5️⃣ Upload PDF to Cloudinary
    const uploadedPdf = await cloudinary.uploader.upload(pdf.tempFilePath, {
      resource_type: "raw",
      access_mode: "public"
    });

    // 6️⃣ Read the file from disk again to ensure buffer is not empty
    const fileBuffer = fs.readFileSync(pdf.tempFilePath);

    // 7️⃣ Send email with actual file buffer
    const info = await transporter.sendMail({
      from: `"${user.name}" <${user.email}>`,
      to: emailList,
      subject: "New Flashing Order",
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
      attachments: [
        {
          filename: `${JobReference || "order"}.pdf`,
          content: fileBuffer,
          contentType: "application/pdf"
        }
      ]
    });

    // 8️⃣ Save order in DB with Cloudinary URL
    await new ProjectOrder({
      userId: user._id,
      pdf: uploadedPdf.secure_url,
      JobReference,
      Number,
      OrderContact,
      OrderDate,
      DeliveryAddress,
    }).save();

    // 9️⃣ Remove temp file
    fs.unlink(pdf.tempFilePath, err => {
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

export const fetchUploadOrder = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1️⃣ Validate
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // 2️⃣ Check user
    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3️⃣ Fetch orders
    const orders = await ProjectOrder.find({ userId });
    if (!orders.length) {
      return res.status(404).json({ message: "No orders found" });
    }

    // 4️⃣ Success
    return res.status(200).json({
      message: "Orders fetched successfully",
      orders
    });

  } catch (error) {
    console.error("fetchUploadOrder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
