import { User } from "../models/auth.model.js";
import {ContractList} from "../models/contractor.model.js"; // make sure this import exists
import { Chat } from "../models/conversetionChat.model.js";
import jwt from 'jsonwebtoken'
export const SendOrderToContractor = async (req, res) => {
  try {
    const { token, contractorId } = req.params;
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);

    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const findContractor = await User.findById(contractorId);
    if (!findContractor) {
      return res.status(404).json({ message: "Contractor not found" });
    }

    const {
      roofSize,
      material,
      color,
      totalLength,
      totalGirth,
      designNotes,
      estimatedCost,
      installDate,
    } = req.body;

    const requiredFields = [roofSize, material, color, totalLength, totalGirth, designNotes, installDate];
    if (requiredFields.some(field => !field)) {
      return res.status(400).json({ message: "All fields are required" });
    }

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
      installDate
    });

    await saveContract.save();

    findContractor.ContractOrderList.push(saveContract._id);
    await findContractor.save();

    return res.status(200).json({
      message: "Contract order sent successfully",
      contractId: saveContract._id
    });

  } catch (error) {
    console.error("SendOrderToContractor error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const cancelOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const orderId = req.params.orderId;

    // Find the order belonging to this client
    const findOrder = await ContractList.findOne({
      _id: orderId,
      ClientId: userId,
    });

    if (!findOrder) {
      return res.status(400).json({ message: "Order not found" });
    }

    // Update the order status
    findOrder.status = "cancelled";
    await findOrder.save();

    return res.status(200).json({ message: "Order cancelled successfully" });

  } catch (error) {
    console.error("cancelOrder error:", error);
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
      .populate("ClientId", "username email");

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
      { path: "ClientId", select: "username email" },
      { path: "ContractorId", select: "username email" }
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
    const senderId = req.user._id;
    const { clientId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ message: "Message is required" });
    }

    // Check for existing chat between these two users (in any order)
    let chat = await Chat.findOne({
      $or: [
        { userId: senderId, clientId },
        { userId: clientId, clientId: senderId },
      ],
    });

    // If no chat exists, create a new one
    if (!chat) {
      chat = new Chat({
        userId: senderId,
        clientId,
        conversation: [],
      });
    }

    // Add new message to the conversation array
    chat.conversation.push({
      sender: senderId,
      message,
      sentAt: new Date(),
    });

    await chat.save();

    return res.status(200).json({
      message: "Message sent successfully",
      chat,
    });

  } catch (error) {
    console.error("ConversetionChat error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchConversationChat = async (req, res) => {
  try {
    const userId = req.user._id;
    const { clientId } = req.params;

    // Find chat between the two users (in any order)
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

    return res.status(200).json({
      message: "Conversation fetched successfully",
      chat
    });

  } catch (error) {
    console.error("fetchConversationChat error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
