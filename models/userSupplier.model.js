import mongoose, { Schema } from "mongoose";

const userSupplierSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    SupplierName: {
      type: String,
      required: true
    },
    SupplierImage: [
      {
        public_id: {
          type: String,
          required: true
        },
        url: {
          type: String,
          required: true
        }
      }
    ],
    SupplierEmail: {
      type: String,
      required: true
    },
    SupplierDescription: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

export const UserSupplier = mongoose.model("UserSupplier", userSupplierSchema);
