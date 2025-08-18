import { User } from "../models/auth.model.js";
import {ContractList} from "../models/contractor.model.js"; // make sure this import exists
import { Chat } from "../models/conversetionChat.model.js";
import {io} from '../index.js'
import jwt from 'jsonwebtoken'
import { read } from "fs";
import { v2 as cloudinary } from 'cloudinary';
import { FreelancerList } from "../models/freelancer.model.js";
import { SupplierList } from "../models/supplier.model.js";
import bcrypt from "bcryptjs";
// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});



export const SaveUserPdf = async (req, res) => {
  try {
    const { token } = req.params;

    // Verify JWT
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Find user
    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Validate PDF
    const pdf = req.files?.pdf;
    if (!pdf || !pdf.tempFilePath) {
      return res.status(400).json({ message: "PDF file is required" });
    }

    // Upload to Cloudinary
    const uploadPdf = await cloudinary.uploader.upload(pdf.tempFilePath, {
        folder: "freelancers",
  resource_type: "raw",
  type: "upload",
  access_mode: "public"
    });

    // Push PDF to user's list
    findUser.pdfLists.push({
      public_id: uploadPdf.public_id,
      url: uploadPdf.secure_url
    });

    await findUser.save();

    return res.status(200).json({
      message: "PDF saved successfully",
      pdf: {
        public_id: uploadPdf.public_id,
        url: uploadPdf.secure_url
      }
    });

  } catch (error) {
    console.error("SaveUserPdf error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchUserPdf = async (req, res) => {
  try {
    const { userId } = req.params;

    const findUser = await User.findById(userId).select("pdfLists");
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const pdfLinks = findUser.pdfLists || [];
    return res.status(200).json({
      message: "PDFs fetched successfully",
      pdfLinks
    });

  } catch (error) {
    console.error("fetchUserPdf error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const SendOrderToContractor = async (req, res) => {
  try {
    const { token, contractorId } = req.params;

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Find client user
    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find contractor
    const findContractor = await User.findById(contractorId);
    if (!findContractor) {
      return res.status(404).json({ message: "Contractor not found" });
    }
    if(findContractor.role=="user"){
      return res.status(400).json({message:"User not allowed"})
    }

    // Extract data from body
    const {
      roofSize,
      material,
      color,
      totalLength,
      totalGirth,
      designNotes,
      estimatedCost,
      installDate
    } = req.body;

    // Check for required fields
    const requiredFields = [roofSize, material, color, totalLength, totalGirth, designNotes, installDate];
    if (requiredFields.some(field => !field)) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check and upload PDF
    const { pdf } = req.files || {};
    if (!pdf || !pdf.tempFilePath) {
      return res.status(400).json({ message: "PDF file is required" });
    }

    const uploadPdf = await cloudinary.uploader.upload(pdf.tempFilePath, {
  folder: "freelancers",
  resource_type: "raw",
  type: "upload",
  access_mode: "public"
});

    // Create new contract
    const saveContract = new ContractList({
      ClientId: findUser._id,
      ContractorId: contractorId,
      roofSize,
      material,
      color,
      totalLength,
      totalGirth,
      designNotes,
      estimatedCost,
      installDate,
      pdf: [
        {
          public_id: uploadPdf.public_id,
          url: uploadPdf.secure_url
        }
      ]
    });

    // Save contract
    await saveContract.save();

    // Push contract ID to contractor
    findContractor.ContractOrderList.push(saveContract._id);
    await findContractor.save();

    // Success response
    return res.status(200).json({
      message: "Contract order sent successfully",
      contractId: saveContract._id
    });

  } catch (error) {
    console.error("SendOrderToContractor error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const { token, orderId } = req.params;

    // Decode the JWT token
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Fetch user
    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch and validate the order
    const findOrder = await ContractList.findOne({
      _id: orderId,
      ClientId: findUser._id,
    });

    if (!findOrder) {
      return res.status(404).json({ message: "Order not found for this client" });
    }

    // Update the status
    findOrder.status = "cancelled";
    await findOrder.save();

    return res.status(200).json({ message: "Order cancelled successfully" });

  } catch (error) {
    console.error("cancelOrder error:", error.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const rejectOrder = async (req, res) => {
  try {
    const { token, orderId } = req.params;

    // Decode the JWT token
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Find the user
    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the order where this user is the contractor
    const findOrder = await ContractList.findOne({
      _id: orderId,
      ContractorId: findUser._id
    });

    if (!findOrder) {
      return res.status(404).json({ message: "Order not found for this contractor" });
    }

    // Update status to "rejected"
    findOrder.status = "reject"; // ✅ use "rejected" instead of "reject"
    await findOrder.save();

    return res.status(200).json({ message: "Order rejected successfully" });

  } catch (error) {
    console.error("rejectOrder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const approveOrder = async (req, res) => {
  try {
    const { token, orderId } = req.params;

    // Verify JWT
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Find the user
    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the order where user is the contractor
    const findOrder = await ContractList.findOne({
      _id: orderId,
      ContractorId: findUser.id
    });

    if (!findOrder) {
      return res.status(404).json({ message: "Order not found for this contractor" });
    }

    // Update status to "approved"
    findOrder.status = "approved";
    await findOrder.save();

    return res.status(200).json({ message: "Order approved successfully" });

  } catch (error) {
    console.error("approveOrder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchOrders = async (req, res) => {
  try {
    const token = req.params.token;

    // Validate token
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Fetch user info
    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Block normal users from accessing order list
    if (findUser.role === "user") {
      return res.status(403).json({ message: "Access denied: You are not a supplier or freelancer" });
    }

    // Fetch orders where user is contractor (supplier/freelancer)
    const findOrder = await ContractList.find({ ContractorId: findUser.id })
      .populate("ClientId", "username email ");

    return res.status(200).json({
      message: "Order list fetched successfully",
      orders: findOrder,
    });

  } catch (error) {
    console.error("fetchOrders error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchSelectedOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params; // ✅ Correct destructuring

    const findOrder = await ContractList.findById(orderId).populate([
      { path: "ClientId", select: "username email image" },
    ]);

    if (!findOrder) {
      return res.status(400).json({ message: "Order not found" });
    }

    return res.status(200).json({
      message: "Order fetched successfully",
      order: findOrder
    });

  } catch (error) {
    console.error("fetchSelectedOrderDetails error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const ConversetionChat = async (req, res) => {
  try {
    const senderId = req.params.id; // Should be JWT verified ideally
    const clientId = req.params.clientId;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ message: "Message is required" });
    }

    let chat = await Chat.findOne({
      $or: [
        { userId: senderId, clientId },
        { userId: clientId, clientId: senderId },
      ],
    });

    if (!chat) {
      chat = new Chat({ userId: senderId, clientId, conversation: [] });
    }

    const newMessage = {
      sender: senderId,
      message,
      sentAt: new Date(),
    };

    chat.conversation.push(newMessage);
    await chat.save();

    // Emit socket event to receiver (clientId)
    io.emit('newMessage', { chatId: chat._id, message: newMessage });

    return res.status(200).json({
      message: "Message sent successfully",
      chat,
    });

  } catch (error) {
    console.error("ConversetionChat error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export const fetchConversationChat = async (req, res) => {
  try {
    const { id: userId, clientId } = req.params;

    if (!userId || !clientId) {
      return res.status(400).json({ message: "Both userId and clientId are required" });
    }

    // Find existing conversation
    const chat = await Chat.findOne({
      $or: [
        { userId, clientId },
        { userId: clientId, clientId: userId }
      ]
    }).populate([
      { path: "userId", select: "username email" },
      { path: "clientId", select: "username email" },
      { path: "conversation.sender", select: "username email" }
    ]);

    if (!chat) {
      return res.status(404).json({ message: "No conversation found" });
    }

    // Emit fetched conversation over socket
    io.emit('chatFetched', { chatId: chat._id, chat });

    return res.status(200).json({
      message: "Conversation fetched successfully",
      chat
    });

  } catch (error) {
    console.error("fetchConversationChat error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const fetchclientDetails = async (req, res) => {
  try {
    const clientId = req.params.clientId;

    const baseUser = await User.findById(clientId).select("-password");
    if (!baseUser) {
      return res.status(400).json({ message: "User not found" });
    }

    let userDetails = baseUser; // default

    if (baseUser.role === "freelancer") {
      const freelancer = await FreelancerList.findOne({ userId: baseUser._id });
      if (freelancer) {
        userDetails = { ...baseUser._doc, freelancerDetails: freelancer };
      }
    }

    if (baseUser.role === "supplier") {
      const supplier = await SupplierList.findOne({ userId: baseUser._id });
      if (supplier) {
        userDetails = { ...baseUser._doc, supplierDetails: supplier };
      }
    }

    return res.status(200).json({
      message: "Fetch successful",
      user: userDetails,
    });

  } catch (error) {
    console.log("FetchClientDetails error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const fetchUserSendOrderList = async (req, res) => {
  try {
    const {token} = req.params
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select("-password");
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const findOrders = await ContractList.find({ ClientId: findUser._id }).populate("ContractorId","username email image");
    if (!findOrders || findOrders.length === 0) {
      return res.status(404).json({ message: "No orders found" });
    }

    return res.status(200).json({ message: "Fetched successfully", orders: findOrders });
  } catch (error) {
    console.error("fetchUserSendOrderList error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const fetchChatUser = async (req, res) => {
  try {
    const { token } = req.params;

    // Validate token
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    // Find user
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch chats based on user role
    let chatList;
    if (user.role === "user") {
      chatList = await Chat.find({ userId: user._id }).populate(
        "clientId",
        "username email image"
      );
    } else {
      chatList = await Chat.find({ clientId: user._id }).populate(
        "userId",
        "username email image"
      );
    }

    if (!chatList || chatList.length === 0) {
      return res.status(404).json({ message: "No chats found" });
    }

    // Respond with chat list
    return res.status(200).json({
      message: "Fetched successfully",
      chats: chatList,
    });
  } catch (error) {
    console.error("fetchChatUser error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const ChangePassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "UserId is required" });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    findUser.password = hashedPassword;
    await findUser.save();

    return res.status(200).json({ message: "Password changed successfully" });

  } catch (error) {
    console.error("ChangePassword error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
