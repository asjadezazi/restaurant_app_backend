// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    domain: { type: String, required: false, unique: false },
    restaurantName: { type: String, required: false },
    role: {
      type: String,
      enum: ["user", "admin", "superadmin", "staff"],
      default: "user",
      required: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      default: undefined,
    },
    qrCode: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
