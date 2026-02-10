const stockLedgerSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    ingredient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ingredient",
      required: true,
    },
    type: {
      type: String,
      enum: ["IN", "OUT"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      enum: ["ORDER", "Purchase", "wastage"],
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId, // orderId or adjustmentId
    },
  },
  { timestamps: true }
);
