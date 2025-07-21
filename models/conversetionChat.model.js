import mongoose, { Schema } from "mongoose";

const ChatSchema = new Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  conversation: [
    {
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      },
      message: {
        type: String,
        required: true
      },
      sentAt: {
        type: Date,
        default: Date.now
      }
    }
  ]
}, { timestamps: true });

export const Chat = mongoose.model("Chat", ChatSchema);
