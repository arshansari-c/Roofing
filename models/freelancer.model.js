import mongoose, { Schema } from "mongoose";

const FreelancerSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    FreelancerName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      minlength: 10,
    },
  FreelancerImage: [
  {
    public_id: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
  }
],

    tags: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],

    achievements: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],

    totalProjectsCompleted: {
      type: Number,
      default: 0,
      min: 0,
    },

    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },

    reviews: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

export const FreelancerList = mongoose.model("FreelancerList", FreelancerSchema);
