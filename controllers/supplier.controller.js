import { User } from '../models/auth.model.js';
import { SupplierList } from '../models/supplier.model.js';
import { UserSupplier } from '../models/userSupplier.model.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { UserTeammate } from '../models/userTeam.model.js';

import { ProjectOrder } from '../models/ProjectOrder.model.js';

cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

export const fetchTeammatesOrders = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "UserId is required" });
    }

    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (findUser.role === "teammate") {
      return res.status(403).json({ message: "Teammate is not allowed to fetch teammates' orders" });
    }

    // Find all teammates assigned to this user
    const teammates = await UserTeammate.find({ userId: userId });
    if (teammates.length === 0) {
      return res.status(404).json({ message: "No teammates found for this user" });
    }

    // Get all teammateIds
    const teammateIds = teammates.map(tm => tm.teammateId);

    // Fetch all teammate details (email, etc.)
    const teammateUsers = await User.find(
      { _id: { $in: teammateIds } },
      { _id: 1, email: 1 }
    );

    // Fetch orders made by all teammates
    const orders = await ProjectOrder.find({ userId: { $in: teammateIds } });

    if (orders.length === 0) {
      return res.status(404).json({ message: "No orders found for teammates" });
    }

    return res.status(200).json({
      message: "Orders fetched successfully",
      teammates: teammateUsers, // array of { _id, email }
      orders
    });

  } catch (error) {
    console.error("fetchTeammatesOrders error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchUserTeammate = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "teammate") {
      return res.status(403).json({ message: "Teammates are not allowed to fetch teammates" });
    }

    const teammates = await UserTeammate.find({ userId })
      .populate({
        path: "teammateId",
        select: "username email role lastLogin" // pick fields you want
      });

    if (!teammates || teammates.length === 0) {
      return res.status(404).json({ message: "No teammates found" });
    }

    return res.status(200).json({
      message: "Teammates fetched successfully",
      data: teammates
    });
  } catch (error) {
    console.error("fetchUserTeammate error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchUserSupplier = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "teammate") {
      return res.status(403).json({ message: "Teammates are not allowed to fetch suppliers" });
    }

    const suppliers = await UserSupplier.find({ userId });

    if (!suppliers || suppliers.length === 0) {
      return res.status(404).json({ message: "No suppliers found" });
    }

    return res.status(200).json({
      message: "Suppliers fetched successfully",
      suppliers
    });
  } catch (error) {
    console.error("fetchUserSupplier error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const AddTeammate = async (req, res) => {
  try {
    const { userId } = req.params;
    if(!userId){
      return res.status(400).json({message:"userId is required"})
    }
    const { username, email, password } = req.body;

    if ( !username || !email || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (findUser.role === "teammate") {
      return res.status(403).json({ message: "Teammates cannot add new teammates" });
    }

    // Optional: Check for existing user with same email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get client IP
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Create new teammate user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      role: 'teammate', // you can customize this as per your role logic
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

    // Create teammate relationship
    const newTeammate = new UserTeammate({
      userId: userId,
      teammateId: newUser._id
    });

    await newTeammate.save();

    return res.status(200).json({
      message: "Teammate added successfully",
      teammate: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error("AddTeammate error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const AddSupplier = async (req, res) => {
  try {
    const {userId } = req.params
    if(!userId){
      return res.status(400).json({message:"User is required"})
    }
    const {SupplierName, SupplierEmail, SupplierDescription } = req.body;
    const SupplierImage = req.files?.SupplierImage;

    if ( !SupplierName || !SupplierEmail || !SupplierDescription) {
      return res.status(400).json({
        message: "userId, SupplierName, SupplierEmail, and SupplierDescription are required"
      });
    }

    if (!SupplierImage || !SupplierImage.tempFilePath) {
      return res.status(400).json({ message: "SupplierImage is required" });
    }

    const result = await cloudinary.uploader.upload(SupplierImage.tempFilePath, {
      folder: "suppliers"
    });

    // Optional: remove temp file
    fs.unlinkSync(SupplierImage.tempFilePath);

    const newSupplier = new UserSupplier({
      userId,
      SupplierName,
      SupplierEmail,
      SupplierDescription,
      SupplierImage: [
        {
          public_id: result.public_id,
          url: result.secure_url
        }
      ]
    });

    await newSupplier.save();

    return res.status(200).json({
      message: "Supplier added successfully",
      supplier: newSupplier
    });
  } catch (error) {
    console.error("AddSupplier error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const SupplierDetails = async (req, res) => {
  try {
    const token = req.params.token;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user already registered as supplier or freelancer
    if (findUser.role === "supplier") {
      return res.status(400).json({ message: "You already filled the details" });
    }

    if (findUser.role === "freelancer") {
      return res.status(400).json({ message: "Sorry, you are already registered as a Freelancer" });
    }

    const { companyName, description, tags, achievements } = req.body;
    const companyImage = req.files?.companyImage;

    if (!companyName || !description || !tags || !achievements || !companyImage) {
      return res.status(400).json({ message: "All fields including image are required" });
    }

    // Upload image to Cloudinary
    const result = await cloudinary.uploader.upload(companyImage.tempFilePath, {
      folder: 'suppliers',
    });

    // Delete temporary file from server
    fs.unlinkSync(companyImage.tempFilePath);

    // Save supplier details in DB
    const saveDetails = new SupplierList({
      userId: findUser._id,
      companyName,
      description,
      tags,
      achievements,
      companyImage: {
        public_id: result.public_id,
        url: result.secure_url,
      },
    });

    await saveDetails.save();

    // Update user document with image and role
    findUser.username = companyName;
    findUser.image = result.secure_url;
    findUser.role = "supplier";
    await findUser.save();

    return res.status(200).json({
      message: "Supplier details saved successfully",
      data: saveDetails,
    });

  } catch (error) {
    console.error("SupplierDetails error", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};


export const EditSupplierDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { companyName, description, tags, achievements } = req.body;
    const companyImage = req.files?.companyImage;

    const supplier = await SupplierList.findOne({ userId: userId });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    // ✅ If new image is provided, replace old image
    let updatedImage = supplier.companyImage;

    if (companyImage) {
      // Delete old image from Cloudinary
      if (supplier.companyImage?.public_id) {
        await cloudinary.uploader.destroy(supplier.companyImage.public_id);
      }

      // Upload new image to Cloudinary
      const result = await cloudinary.uploader.upload(companyImage.tempFilePath, {
        folder: 'suppliers',
      });

      fs.unlinkSync(companyImage.tempFilePath); // Delete temp file

      updatedImage = {
        public_id: result.public_id,
        url: result.secure_url,
      };
    }

    // ✅ Update supplier details
    supplier.companyName = companyName || supplier.companyName;
    supplier.description = description || supplier.description;
    supplier.tags = tags || supplier.tags;
    supplier.achievements = achievements || supplier.achievements;
    supplier.companyImage = updatedImage;

    await supplier.save();

    res.status(200).json({ message: "Supplier details updated successfully", data: supplier });

  } catch (error) {
    console.error("EditSupplierDetails error", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};




export const fetchSupplierList = async (req, res) => {
  try {
    const token = req.params.token;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

   
    const supplierList = await SupplierList.find().populate("userId","email");

    return res.status(200).json({
      message: "Supplier list fetched successfully",
      data: supplierList
    });

  } catch (error) {
    console.error("fetchSupplierList error", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

