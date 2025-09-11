import mongoose, { Schema } from "mongoose";

export const ProjectOrderSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
  pdf: [
  {
    public_id: {
      type: String,  // 🔧 corrected "Stirng" to "String"
      required: true,
    },
    url: {
      type: String,
      required: true,
    }
  }
],
    data : {
      type : Schema.Types.Mixed,
      required : true
  },
   emailList: [String],
    JobReference: {
      type: String,
      required: true
    },
    Number: { // Change to String if it's a phone number
      type: String,
      required: true
    },
    OrderContact: {
      type: String,
      required: true
    },
    OrderDate: {
      type: String, // Better for sorting/filtering
      required: true
    },
     DeliveryAddress: {
      type: String,
    
    },
    PickupNotes:{
      type : String,
     
    },
    Notes:{
      type : String,
     
    }
  },
  { timestamps: true }
);

export const ProjectOrder = mongoose.model("ProjectOrder", ProjectOrderSchema);

