const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const generateAndUploadQR = require("../utils/generateQR");

const MONGO_URI = process.env.MONGO_URL;

const migrateQR = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to DB");


    // -----------------------------
    // 1) Patch legacy admins once
    // -----------------------------

    const patch1 = await User.updateMany(
      {
        role: "admin",
        isDeleted: { $exists: false }
      },
      {
        $set: { isDeleted: false }
      }
    );

    const patch2 = await User.updateMany(
      {
        role: "admin",
        deletedBy: { $exists: false }
      },
      {
        $set: { deletedBy: null }
      }
    );

    console.log(
      "🛠 Patched admins:",
      patch1.modifiedCount,
      "isDeleted fields,",
      patch2.modifiedCount,
      "deletedBy fields"
    );


    // -----------------------------
    // 2) Fetch active admins
    // -----------------------------

    const users = await User.find({
      role: "admin",
      isDeleted: false
    });

    console.log(
      "🧠 Users Found:",
      users.map(u => u.email)
    );

    const logoPath = path.join(
      __dirname,
      "../assets/logo.jpeg"
    );


    // -----------------------------
    // 3) Migrate each admin QR
    // -----------------------------

    for (const user of users) {
      try {

        console.log(`🔄 Processing ${user.email}`);

        if (!user.restaurantId || !user.domain) {

          console.log("⏭ Missing data, removing user qr only");

          await User.updateOne(
            { _id: user._id },
            {
              $unset: { qrCode: 1 }
            }
          );

          continue;
        }

        const restaurant = await Restaurant.findById(
          user.restaurantId
        );

        if (!restaurant) {

          console.log("⏭ Restaurant missing, removing user qr only");

          await User.updateOne(
            { _id: user._id },
            {
              $unset: { qrCode: 1 }
            }
          );

          continue;
        }


        // Generate fresh QR
        const qrData = await generateAndUploadQR(
          user.domain,
          logoPath
        );


        // Save in Restaurant only
        restaurant.qrCode = {
          url: qrData.url,
          public_id: qrData.public_id
        };

        await restaurant.save();


        // Remove old user qr
        await User.updateOne(
          { _id: user._id },
          {
            $unset: { qrCode: 1 }
          }
        );

        console.log(
          `✅ Migrated & cleaned ${user.email}`
        );

      } catch (err) {

        console.error(
          `❌ Failed for ${user.email}:`,
          err.message
        );
      }
    }


    // -----------------------------
    // 4) Force cleanup leftovers
    // -----------------------------

    const cleanup = await User.updateMany(
      { qrCode: { $exists: true } },
      {
        $unset: { qrCode: 1 }
      }
    );

    console.log(
      "🧹 Leftover QR removed from",
      cleanup.modifiedCount,
      "users"
    );

    console.log("🎉 Migration completed");
    process.exit();

  } catch (err) {
    console.error("❌ Script error:", err);
    process.exit(1);
  }
};

migrateQR();