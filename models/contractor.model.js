import mongoose, { Schema } from "mongoose";

const ContractSchema = new Schema({
  ClientId: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
    required: true
  },
  ContractorId: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
    required: true
  },
  roofSize: {
    type: String, // e.g., "10x15 ft" or custom string
    required: true
  },
  material: {
    type: String, // e.g., "Aluminum", "Steel"
    required: true
  },
  color: {
    type: String,
    default: "Standard Grey"
  },
  totalLength: {
    type: Number, // in meters or feet
    required: true
  },
  totalGirth: {
    type: Number, // in mm or inches
    required: true
  },
  designNotes: {
    type: String, // custom notes or instructions
    maxlength: 1000
  },
  attachmentUrls: [{
    type: String // array of image/PDF URLs
  }],
  estimatedCost: {
    type: Number,
    default: 0
  },
  installDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'in-progress', 'completed', 'cancelled'],
    default: 'pending'
  }
}, { timestamps: true });

export const ContractList = mongoose.model("ContractList",ContractSchema)
