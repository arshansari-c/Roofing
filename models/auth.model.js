import mongoose, { Schema } from "mongoose";
import validator from "validator";

const AuthSchema = new Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username must be less than 30 characters"],
    },

    image:{
      type : String
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: "Please enter a valid email address",
      },
    },
    pdfLists:[{
      public_id : {
        type : String,
      },
      url:{
        type : String
      },
    }],

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },

    ipAddress: [
      {
        latestIP: {
          type: String,
          required: true,
        },
        oldIP: {
          type: String,
        },
        loginDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    oldPassword: [
      {
        password: {
          type: String,
        },
        passwordDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    role: {
      type: String,
      enum: ["user", "admin", "supplier", "freelancer"],
      default: "user",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    lastLogin: {
      type: Date,
    },

    ContractOrderList: [
      {
        type: String, // or ObjectId if referencing a Contract model
        // ref: "Contract" // Uncomment this if you're referencing contracts
      },
    ],
  },
  { timestamps: true }
);

export const User = mongoose.model("User", AuthSchema);
