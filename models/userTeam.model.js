import mongoose, { Schema } from "mongoose";

const userTeamSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    teammateId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

export const UserTeammate = mongoose.model("UserTeammate", userTeamSchema);
