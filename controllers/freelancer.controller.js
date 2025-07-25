import { User } from "../models/auth.model.js";
import { FreelancerList } from "../models/freelancer.model.js";
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv'
import fs from 'fs'
import jwt from 'jsonwebtoken'
import { SupplierList } from "../models/supplier.model.js";
dotenv.config()

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

export const FreelancerDetails = async (req, res) => {
  try {
    const token = req.params.token;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select("-password");
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (findUser.role === "freelancer") {
      return res.status(400).json({ message: "You already filled the freelancer details" });
    }

    if (findUser.role === "supplier") {
      return res.status(400).json({ message: "Sorry, you are already registered as a Supplier" });
    }

    const { FreelancerName, description, tags, achievements } = req.body;
    const FreelancerImage = req.files?.FreelancerImage;

    if (!FreelancerName || !description || !tags || !achievements || !FreelancerImage) {
      return res.status(400).json({ message: "All fields including image are required" });
    }

    // Upload image to Cloudinary
    const result = await cloudinary.uploader.upload(FreelancerImage.tempFilePath, {
      folder: "freelancers",
    });

    // Delete temporary file from server
    fs.unlinkSync(FreelancerImage.tempFilePath);

    // Save freelancer details to DB
    const freelancerDetails = new FreelancerList({
      userId: findUser._id,
      FreelancerName,
      description,
      tags,
      achievements,
      FreelancerImage: {
        public_id: result.public_id,
        url: result.secure_url,
      },
    });

    await freelancerDetails.save();

    // Update user with new role and image
    findUser.username = FreelancerName;
    findUser.image = result.secure_url;
    findUser.role = "freelancer";
    await findUser.save();

    return res.status(200).json({
      message: "Freelancer details saved successfully",
      data: freelancerDetails,
    });

  } catch (err) {
    console.error("FreelancerDetails error:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
};



export const EditFreelancerDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { FreelancerName, description, tags, achievements } = req.body;

    const updatedFreelancer = await FreelancerList.findOneAndUpdate(
      { userId: userId },
      { FreelancerName, description, tags, achievements },
      { new: true }
    );

    if (!updatedFreelancer) {
      return res.status(404).json({ message: "Freelancer not found" });
    }

    return res.status(200).json({
      message: "Freelancer details updated successfully",
      data: updatedFreelancer
    });

  } catch (error) {
    console.error("EditFreelancerDetails error", error); // Fixed log message
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const fetchFreelancerList = async (req, res) => {
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

    const freelancerLists = await FreelancerList.find();

    return res.status(200).json({
      message: "Freelancer list fetched successfully",
      data: freelancerLists
    });

  } catch (error) {
    console.error("fetchFreelancerList error", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message
    });
  }
};

export const fetchOtherUserDetails = async (req, res) => {
  try {
    const seconduser  = req.params.seconduser;

    // Find user by ID and exclude password
    const findSecondUser = await SupplierList.findById(seconduser).select('-password');
    if (!findSecondUser) {
      return res.status(404).json({ message: "Second user not found" });
    }

    return res.status(200).json({
      message: "Fetched successfully",
      findSecondUser,
    });

  } catch (error) {
    console.error("fetchOtherUserDetails error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchOtherFreelancerDetails = async (req, res) => {
  try {
    const { seconduser } = req.params;

    // Fetch freelancer details using userId
    const freelancerDetails = await FreelancerList.findById(seconduser);

    if (!freelancerDetails) {
      return res.status(404).json({ message: "Freelancer details not found" });
    }

    return res.status(200).json({
      message: "Fetched successfully",
      details: freelancerDetails,
    });

  } catch (error) {
    console.error("fetchOtherFreelancerDetails error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

