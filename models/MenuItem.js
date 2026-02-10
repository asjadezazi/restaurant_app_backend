// models/MenuItem.js
const mongoose = require("mongoose");

const discountSchema = {
  type: {
    type: String,
    enum: ["percentage", "flat"],
    default: null,
  },
  value: {
    type: Number,
    default: 0,
  },
  active: {
    type: Boolean,
    default: false,
  },
};

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    pricingType: {
      type: String,
      enum: ["single", "variant", "combo"],
      required: true,
    },
    price: { type: Number, default: null },
    discount: {
      type: { type: String, enum: ["percentage", "flat"], default: null },
      value: { type: Number, default: 0 },
      active: { type: Boolean, default: false },
    },
    variantRates: {
      quarter: {
        price: Number,
        discount: discountSchema
      },
      half: {
        price: Number,
        discount: discountSchema
      },
      full: {
        price: Number,
        discount: discountSchema
      },
    },
     comboItems: [
      {
        menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
        name: { type: String },
        variant: { type: String },
        quantity: { type: Number, default: 1 },
      },
    ],
    comboPrice: { type: Number, default: null },
    description: String,
    image: {
      url: { type: String },
      public_id: { type: String },
    },
    type: {
      type: String,
      enum: ["veg", "non-veg", "mixed"],
      required: false,
    },
    category: String, 
    available: {
      type: Boolean,
      default: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MenuItem", menuItemSchema);
