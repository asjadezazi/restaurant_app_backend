const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const Restaurant = require("../models/Restaurant");
const generateAndUploadQR = require("../utils/generateQR");

const MONGO_URI = process.env.MONGO_URL;

const migrateOldSections = async () => {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("✅ Connected to DB");

    const logoPath = path.join(
      __dirname,
      "../assets/logo.jpeg"
    );

    const restaurants = await Restaurant.find({});

    console.log(
      `🍽 Found ${restaurants.length} restaurants`
    );

    for (const restaurant of restaurants) {
      try {
        console.log(
          `\n🔄 Processing ${restaurant.restaurantName}`
        );

        // already migrated
        if (Array.isArray(restaurant.sections)) {
          console.log(
            "⏭ Already using new sections schema"
          );
          continue;
        }

        const oldSections = restaurant.sections || {};

        const newSections = [];

        // =====================================
        // Indoor Tables
        // =====================================

        if (oldSections.indoor?.tables > 0) {
          const units = [];

          for (
            let i = 1;
            i <= oldSections.indoor.tables;
            i++
          ) {
            const unitId =
              new mongoose.Types.ObjectId();

            const qr =
              await generateAndUploadQR(
                `${restaurant.domain}/order?unitId=${unitId}`,
                logoPath,
                `T${i}`,
                "TABLE"
              );

            units.push({
              _id: unitId,
              type: "TABLE",
              name: `T${i}`,
              status: "AVAILABLE",
              currentOrderId: null,

              occupancy: {
                checkInTime: null,
                checkOutTime: null,
              },

              qrCode: {
                url: qr.url,
                code: qr.public_id,
              },

              isActive: true,
            });
          }

          newSections.push({
            name: "Indoor",
            units,
          });
        }

        // =====================================
        // Outdoor Tables
        // =====================================

        if (oldSections.outdoor?.tables > 0) {
          const units = [];

          for (
            let i = 1;
            i <= oldSections.outdoor.tables;
            i++
          ) {
            const unitId =
              new mongoose.Types.ObjectId();

            const qr =
              await generateAndUploadQR(
                `${restaurant.domain}/order?unitId=${unitId}`,
                logoPath,
                `T${i}`,
                "TABLE"
              );

            units.push({
              _id: unitId,
              type: "TABLE",
              name: `T${i}`,
              status: "AVAILABLE",
              currentOrderId: null,

              occupancy: {
                checkInTime: null,
                checkOutTime: null,
              },

              qrCode: {
                url: qr.url,
                code: qr.public_id,
              },

              isActive: true,
            });
          }

          newSections.push({
            name: "Outdoor",
            units,
          });
        }

        // =====================================
        // Rooftop Tables
        // =====================================

        if (oldSections.rooftop?.tables > 0) {
          const units = [];

          for (
            let i = 1;
            i <= oldSections.rooftop.tables;
            i++
          ) {
            const unitId =
              new mongoose.Types.ObjectId();

            const qr =
              await generateAndUploadQR(
                `${restaurant.domain}/order?unitId=${unitId}`,
                logoPath,
                `T${i}`,
                "TABLE"
              );

            units.push({
              _id: unitId,
              type: "TABLE",
              name: `T${i}`,
              status: "AVAILABLE",
              currentOrderId: null,

              occupancy: {
                checkInTime: null,
                checkOutTime: null,
              },

              qrCode: {
                url: qr.url,
                code: qr.public_id,
              },

              isActive: true,
            });
          }

          newSections.push({
            name: "Rooftop",
            units,
          });
        }

        // =====================================
        // Rooms
        // =====================================

        if (oldSections.rooms?.rooms > 0) {
          const units = [];

          for (
            let i = 1;
            i <= oldSections.rooms.rooms;
            i++
          ) {
            const unitId =
              new mongoose.Types.ObjectId();

            const roomNumber = `${100 + i}`;

            const qr =
              await generateAndUploadQR(
                `${restaurant.domain}/order?unitId=${unitId}`,
                logoPath,
                roomNumber,
                "ROOM"
              );

            units.push({
              _id: unitId,
              type: "ROOM",
              name: roomNumber,
              status: "AVAILABLE",
              currentOrderId: null,

              occupancy: {
                checkInTime: null,
                checkOutTime: null,
              },

              roomCategory: null,

              qrCode: {
                url: qr.url,
                code: qr.public_id,
              },

              isActive: true,
            });
          }

          newSections.push({
            name: "Rooms",
            units,
          });
        }

        restaurant.sections = newSections;

        await restaurant.save();

        console.log(
          `✅ Migrated ${restaurant.restaurantName}`
        );
      } catch (err) {
        console.error(
          `❌ Failed restaurant ${restaurant.restaurantName}`,
          err.message
        );
      }
    }

    console.log(
      "\n🎉 Old sections migration completed"
    );

    process.exit(0);
  } catch (err) {
    console.error(
      "❌ Migration error:",
      err
    );

    process.exit(1);
  }
};

migrateOldSections();