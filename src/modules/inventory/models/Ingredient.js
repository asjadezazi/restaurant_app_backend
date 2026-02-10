const ingredientSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    name: { type: String, required: true },
    unit: {
      type: String,
      enum: ["kg", "gm", "ltr", "ml", "pcs"],
      required: true,
    },
    unitCost: {
      type: Number,
      default: 0,
    },
    currentStock: {
      type: Number,
      required: true,
      default: 0,
    },
    minStockAlert: {
      type: Number,
      default: 0,
    },
    // active: {
    //   type: Boolean,
    //   default: true,
    // },
    category: {
      type: String
    }
  },
  { timestamps: true }
);
