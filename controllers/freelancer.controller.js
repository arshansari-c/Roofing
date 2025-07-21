import { User } from "../models/auth.model.js";
import { FreelancerList } from "../models/freelancer.model.js";
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv'
import fs from 'fs'
import { SupplierList } from "../models/supplier.model.js";
import jwt from 'jsonwebtoken'
dotenv.config()

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

export const fetchOtherUserDetails = async (req, res) => {
  try {
    const { token, seconduser: otherUserId } = req.params;

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const findSecondUser = await User.findById(otherUserId).select('-password');
    if (!findSecondUser) {
      return res.status(404).json({ message: "Second user not found" });
    }

    let details = null;

    if (findSecondUser.role === "supplier") {
      details = await SupplierList.findOne({ userId: findSecondUser._id });
    } else if (findSecondUser.role === "freelancer") {
      details = await FreelancerList.findOne({ userId: findSecondUser._id });
    } else {
      return res.status(400).json({ message: "Invalid role for user" });
    }

    if (!details) {
      return res.status(404).json({ message: "Details not found for the user" });
    }

    return res.status(200).json({
      message: "Fetched successfully",
      details,
    });

  } catch (error) {
    console.error("fetchOtherUserDetails error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const FreelancerDetails = async (req, res) => {
  try {
    const token = req.params.token; // ✅ fix here

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (findUser.role === "freelancer" || findUser.role === "supplier") {
      return res.status(400).json({ message: "You already filled details" });
    }

    const { FreelancerName, description, tags, achievements } = req.body;
    const FreelancerImage = req.files?.FreelancerImage;

    if (!FreelancerImage || !FreelancerName || !description || !tags || !achievements) {
      return res.status(400).json({ message: "All fields and image are required" });
    }

    // ✅ Upload image to Cloudinary
    const result = await cloudinary.uploader.upload(FreelancerImage.tempFilePath, {
      folder: "freelancers"
    });

    // ✅ Remove temp file
    fs.unlinkSync(FreelancerImage.tempFilePath);

    // ✅ Save freelancer data
    const freelancerDetails = new FreelancerList({
      userId: findUser._id,
      FreelancerName,
      description,
      tags,
      achievements,
      FreelancerImage: {
        public_id: result.public_id,
        url: result.secure_url,
      }
    });

    await freelancerDetails.save();

    findUser.role = "freelancer";
    await findUser.save();

    return res.status(200).json({ message: "Freelancer saved", data: freelancerDetails });

  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ message: "Something went wrong", error: err.message });
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
