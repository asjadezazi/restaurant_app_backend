const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    email: {
      type: String,
      required: true,
    },

    password: { type: String, required: true },

    domain: { type: String },

    restaurantName: { type: String },

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

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

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
  { timestamps: true }
);

// Only active users must have unique emails
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
  }
);

module.exports = mongoose.model("User", userSchema);