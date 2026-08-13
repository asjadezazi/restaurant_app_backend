// migrate-orders-to-new-schema.js
require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");

// CHANGE THIS
const MONGO_URI = process.env.MONGO_URL || "YOUR_MONGODB_URI";

async function migrateOrders() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Only migrate old orders
    const orders = await Order.find({
      "source.restaurantId": { $exists: false },
    });

    console.log(`Found ${orders.length} orders to migrate.`);

    let migrated = 0;
    let skipped = 0;

    for (const order of orders) {
      const restaurant = await Restaurant.findOne({
        user: order.user,
        deleted: false,
      });

      if (!restaurant) {
        console.log(
          `⚠️ Skipping order ${order._id} (Restaurant not found)`
        );
        skipped++;
        continue;
      }

      // New source object
      order.source = {
        restaurantId: restaurant._id,
        sectionName: null,
        unitId: null,
        unitName: null,
        type: "NONE",
      };

      // New fields
      if (order.settlementAmount === undefined) {
        order.settlementAmount = null;
      }

      if (order.paymentMethod === undefined) {
        order.paymentMethod = null;
      }

      if (order.deleted === undefined) {
        order.deleted = false;
      }

      // Preserve old completed orders
      if (
        order.status === "completed" &&
        !order.completedAt
      ) {
        order.completedAt = order.createdAt;
      }

      if (
        order.subtotal == null ||
        order.gstRate == null ||
        order.gstAmount == null ||
        order.orderType == null ||
        order.items.some(i => i.discountedPrice == null)
      ) {
        console.log("Problem order:", order._id);
        console.log(JSON.stringify(order.toObject(), null, 2));
        continue;
      }

      await order.save();

      migrated++;
      console.log(`✔ Migrated ${order._id}`);
    }

    console.log("\n==========");
    console.log(`Migrated : ${migrated}`);
    console.log(`Skipped  : ${skipped}`);
    console.log("Done.");
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

migrateOrders();