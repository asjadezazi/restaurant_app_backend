const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        name: { type: String },
        restaurantName: {
            type: String,
        },
        address: {
            type: String,
        },
        domain: { type: String },
        logo: {
            url: { type: String },
            public_id: { type: String },
        },
        qrCode: { type: String },
        orderModes: {
            eathere: { type: Boolean, default: true },
            takeaway: { type: Boolean, default: true },
            delivery: { type: Boolean, default: true },
        },
        deliveryCharges: { type: Number, default: 0 },
        gstNumber: { type: String },
        gstRate: { type: Number, default: 0 },
        gstEnabled: { type: Boolean, default: false },
        categories: [String],
        tableNumbers: { type: Number },
        phoneNumber: { type: Number },
        isOpen: { type: Boolean, default: true },
        deleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);
