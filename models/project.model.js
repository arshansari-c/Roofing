import mongoose, { Schema } from "mongoose";

// Schema (add these fields)
const ProjectSchema = new Schema(
  {
    userId: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    data : {
      type  : String,
      required : true
    },
    pdf : [{
      public_id : {
        type : String,
        required : true
      },
      url:{
        type : String,
        required : true
      },
    }],
    Name: { type: String, required: true },
    Code: { type: String, required: true },
    Color: { type: String, required: true },
    Quantity: { type: Number, required: true },
    TotalLength: { type: String, required: true }
  },
  { timestamps: true }
);


export const ProjectData = mongoose.model("ProjectData", ProjectSchema);
