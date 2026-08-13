const mongoose = require("mongoose");

const { Schema } = mongoose;

/* -------------------- UNIT (TABLE / ROOM) -------------------- */
const unitSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["TABLE", "ROOM"],
      required: true,
    },

    name: {
      type: String, // "T1", "101"
      required: true,
    },

    status: {
      type: String,
      enum: ["AVAILABLE", "OCCUPIED", "BILLED"],
      default: "AVAILABLE",
    },

    currentOrderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },

    /* ---------- ROOM SPECIFIC ---------- */
    roomCategory: {
      name: String, // "Deluxe", "Suite"

      pricingModel: {
        type: String,
        enum: ["PER_NIGHT"],
      },

      priceConfig: {
        pricePerNight: Number,
      },
    },

    occupancy: {
      checkInTime: Date,
      checkOutTime: Date,
    },

    /* ---------- QR SUPPORT ---------- */
    qrCode: {
      url: String,
      code: String, // optional short code
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true, timestamps: true } // IMPORTANT: keep _id for each unit
);

/* -------------------- SECTION -------------------- */
const sectionSchema = new Schema(
  {
    name: {
      type: String, // "indoor", "outdoor", "rooms"
      required: true,
    },

    units: [unitSchema],
  }
);

/* -------------------- RESTAURANT -------------------- */
const restaurantSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    name: String,
    restaurantName: String,

    address: String,

    domain: String,

    logo: {
      url: String,
      public_id: String,
    },

    /* ---------- ORDER SETTINGS ---------- */
    orderModes: {
      eathere: { type: Boolean, default: true },
      takeaway: { type: Boolean, default: true },
      delivery: { type: Boolean, default: true },
    },

    deliveryCharges: { type: Number, default: 0 },

    gstNumber: String,
    gstRate: { type: Number, default: 0 },
    gstEnabled: { type: Boolean, default: false },

    /* ---------- MENU CATEGORIES ---------- */
    categories: [
      {
        name: String,
        displayOrder: { type: Number, default: 100 },
      },
    ],

    /* ---------- NEW: SECTIONS WITH UNITS ---------- */
    sections: [sectionSchema],

    phoneNumber: Number,

    isOpen: { type: Boolean, default: true },

    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);