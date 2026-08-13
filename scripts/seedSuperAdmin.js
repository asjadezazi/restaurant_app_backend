require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Import your User model
const User = require("../models/User");

const seedSuperAdmin = async () => {
  try {
    // Connect DB
    await mongoose.connect(process.env.MONGO_URL);
    console.log("✅ DB connected");

    const email = process.env.SUPERADMIN_EMAIL || "superadmin@tapnbite.com";
    const password = process.env.SUPERADMIN_PASSWORD || "786@Asjad";

    // Check if already exists
    const existing = await User.findOne({ email });

    if (existing) {
      console.log("⚠️ Superadmin already exists");
      process.exit(0);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create superadmin
    const superadmin = await User.create({
      name: "Super Admin",
      email,
      password: hashedPassword,
      role: "superadmin",
      isDeleted: false,
      createdBy: null,
    });

    console.log("🔥 Superadmin created successfully:");
    console.log({
      id: superadmin._id,
      email: superadmin.email,
    });

    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding superadmin:", err);
    process.exit(1);
  }
};

seedSuperAdmin();