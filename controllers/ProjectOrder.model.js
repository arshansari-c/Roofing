import mongoose, { Schema } from "mongoose";

export const ProjectOrderSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    pdf: {
      type: String,
      required: true
    },
    JobReference: {
      type: String,
      required: true
    },
    Number: { // Change to String if it's a phone number
      type: Number,
      required: true
    },
    OrderContact: {
      type: String,
      required: true
    },
    OrderDate: {
      type: Date, // Better for sorting/filtering
      required: true
    },
    DeliveryAddress: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

export const ProjectOrder = mongoose.model("ProjectOrder", ProjectOrderSchema);
