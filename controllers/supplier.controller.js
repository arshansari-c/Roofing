import { User } from '../models/auth.model.js';
import {SupplierList} from '../models/supplier.model.js';

import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import jwt from 'jsonwebtoken'
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});
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

    if (findUser.role === "supplier") {
      return res.status(400).json({ message: "You already filled the details" });
    }

    if (findUser.role === "freelancer") {
      return res.status(400).json({ message: "Sorry but you are already registered as a Freelancer" });
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

    // Delete temp file
    fs.unlinkSync(companyImage.tempFilePath);

    // Save details to DB
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

    // Update user's role
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
    const supplierList = await SupplierList.find();

    return res.status(200).json({
      message: "Supplier list fetched successfully",
      data: supplierList
    });

  } catch (error) {
    console.error("fetchSupplierList error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
