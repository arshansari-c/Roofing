import mongoose, { Schema } from "mongoose";

// Schema (add these fields)
const ProjectSchema = new Schema(
  {
    userId: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    data : {
     type: Schema.Types.Mixed,
      required : true
    },
    Name: { type: String, required: true },
    Code: { type: String, required: true },
    Color: { type: String, required: true },
    Quantity: { type: Number, required: true },
    TotalLength: { type: String, required: true }
  },
  { timestamps: true }
);


export const ProjectData = mongoose.model("ProjectData", ProjectSchema);
