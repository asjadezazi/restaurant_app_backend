require("dotenv").config();
const mongoose = require("mongoose");

const Restaurant = require("../models/Restaurant");
const generateAndUploadQR = require("../utils/generateQR");

const path = require("path");
const logoPath = path.join(__dirname, "../assets/logo.jpeg");

const MONGO_URL = process.env.MONGO_URL;

const log = (msg, data) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
};

const run = async () => {
  try {
    await mongoose.connect(MONGO_URL);

    log("DB Connected");

    const restaurants = await Restaurant.find({});

    log(`Total restaurants: ${restaurants.length}`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const r of restaurants) {
      try {
        log(`Processing: ${r._id}`);

        const sections = r.toObject().sections;

        // -------------------------------
        // SKIP IF ALREADY NEW FORMAT
        // -------------------------------
        const isFullyMigrated =
          Array.isArray(sections) &&
          sections.every(
            (sec) =>
              sec?.name &&
              Array.isArray(sec.units) &&
              sec.units.length > 0 &&
              sec.units[0]?.type
          );

        if (isFullyMigrated) {
          log(`SKIP (already migrated): ${r._id}`);
          skipped++;
          continue;
        }

        // -------------------------------
        // NORMALIZE OLD STRUCTURE
        // -------------------------------
        const finalSections = [];

        const source = Array.isArray(sections)
          ? sections[0] || {}
          : sections || {};

        // -------------------------------
        // BUILD SECTIONS
        // -------------------------------
        for (const [sectionName, value] of Object.entries(source)) {
          if (!value || typeof value !== "object") {
            continue;
          }

          log(`Migrating section: ${sectionName}`, value);

          const tables = value.tables || 0;
          const rooms = value.rooms || 0;

          const units = [];

          /* ---------------- TABLES ---------------- */
          if (tables > 0) {
            for (let i = 1; i <= tables; i++) {
              const unitId = new mongoose.Types.ObjectId();

              const tableName = `T${i}`;

              const qr = await generateAndUploadQR(
                `${r.domain}/?unitId=${unitId}`,
                logoPath,
                tableName,
                "TABLE"
              );

              units.push({
                _id: unitId,
                type: "TABLE",
                name: tableName,
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
          }

          /* ---------------- ROOMS ---------------- */
          if (rooms > 0) {
            for (let i = 1; i <= rooms; i++) {
              const unitId = new mongoose.Types.ObjectId();

              const roomName = `${100 + i}`;

              const qr = await generateAndUploadQR(
                `${r.domain}/?unitId=${unitId}`,
                logoPath,
                roomName,
                "ROOM"
              );

              units.push({
                _id: unitId,
                type: "ROOM",
                name: roomName,
                status: "AVAILABLE",
                currentOrderId: null,

                roomCategory: null,

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
          }

          // -------------------------------
          // SKIP EMPTY SECTION
          // -------------------------------
          if (tables === 0 && rooms === 0) {
            log(`SKIP EMPTY SECTION: ${sectionName}`);
            continue;
          }

          // -------------------------------
          // PUSH NEW SECTION FORMAT
          // -------------------------------
          finalSections.push({
            name: sectionName,
            units,
          });
        }

        // -------------------------------
        // SAVE
        // -------------------------------
        r.sections = finalSections;

        await r.save();

        log(`UPDATED: ${r._id}`);

        updated++;
      } catch (err) {
        log(`ERROR: ${r._id}`, err.message);
        errors++;
      }
    }

    log("\n========== FINAL SUMMARY ==========");
    log(`Updated: ${updated}`);
    log(`Skipped: ${skipped}`);
    log(`Errors: ${errors}`);
    log("===================================");

    await mongoose.disconnect();

    log("DB Disconnected");
  } catch (err) {
    console.error("FATAL ERROR:", err);
  }
};

run();