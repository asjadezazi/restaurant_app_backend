const Restaurant = require("../models/Restaurant");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinary");

// Get restaurant details (Client, via tenant middleware)
exports.getRestaurantDetails = async (req, res) => {
  try {
    const host = req.frontendHost; // from middleware

    // Lookup restaurant by domain
    const restaurant = await Restaurant.findOne({
      domain: host,
      deleted: false,
    })
      .select("-qrCode -__v -createdAt -updatedAt")
      .lean();

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    res.status(200).json({
      restaurant,
    });
  } catch (err) {
    console.error("Get restaurant details error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get restaurant details (Admin, JWT protected)
exports.getAdminRestaurantDetails = async (req, res) => {
  try {
    const user = req.user; // JWT middleware sets req.user
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    // Find restaurant linked to this admin
    const restaurant = await Restaurant.findOne({
      user: user._id,
      deleted: false,
    });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found." });

    res.status(200).json({
      restaurant,
    });
  } catch (err) {
    console.error("Admin restaurant details error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.getMyRestaurantDetails = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { role, _id, restaurantId } = req.user;

    let restaurant;

    if (role === "admin") {
      restaurant = await Restaurant.findOne({
        user: _id,
        deleted: false,
      });
    } else if (role === "staff") {
      if (!restaurantId) {
        return res
          .status(400)
          .json({ message: "Staff not linked to restaurant" });
      }

      restaurant = await Restaurant.findOne({
        _id: restaurantId,
        deleted: false,
      });
    }

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    res.json({ success: true, data: restaurant });
  } catch (error) {
    console.error("Get restaurant error 👉", error);
    res.status(500).json({ message: "Server error" });
  }
};


// Update restaurant details (Admin, JWT protected)
exports.updateRestaurantDetails = async (req, res) => {
  try {
    const user = req.user; // logged-in user from JWT
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    // Find restaurant linked to this user
    const restaurant = await Restaurant.findOne({ user: user._id });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found." });

    // Prepare fields to update
    const updateData = { ...req.body, updatedAt: new Date() };

    // Handle logo update
    if (req.file) {
      if (restaurant.logo?.public_id) {
        await deleteFromCloudinary(restaurant.logo.public_id).catch(
          console.warn,
        );
      }
      const result = await uploadToCloudinary(req.file.buffer);
      updateData.logo = { url: result.secure_url, public_id: result.public_id };
    }

    // Update restaurant
    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
      restaurant._id,
      updateData,
      { new: true },
    );

    res.status(200).json({
      message: "Restaurant details updated successfully.",
      restaurant: updatedRestaurant,
    });
  } catch (err) {
    console.error("Update restaurant error:", err);
    res
      .status(500)
      .json({ message: "Internal server error.", error: err.message });
  }
};

// Delete restaurant (Admin, JWT protected)
exports.deleteRestaurant = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const restaurant = await Restaurant.findOne({ user: user._id });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found" });

    // Soft delete
    restaurant.deleted = true;
    await restaurant.save();

    res.status(200).json({ message: "Restaurant soft-deleted successfully" });
  } catch (err) {
    console.error("Soft delete restaurant error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Update GST Setting (Admin, JWT protected)
exports.updateGstSettings = async (req, res) => {
  try {
    const { gstEnabled, gstRate } = req.body || {};

    if (gstEnabled === undefined && gstRate === undefined) {
      return res.status(400).json({ message: "No GST settings provided" });
    }

    const userId = req.user._id;
    const restaurant = await Restaurant.findOne({
      user: userId,
      deleted: false,
    });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found" });

    // Update gstEnabled if provided
    if (gstEnabled !== undefined) {
      restaurant.gstEnabled = gstEnabled === true || gstEnabled === "true";
    }

    // Update gstRate only if provided
    if (gstRate !== undefined) {
      const rate = Number(gstRate);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        return res
          .status(400)
          .json({ message: "Invalid GST rate. Must be 0-100." });
      }
      restaurant.gstRate = rate;
    }

    await restaurant.save();

    res.status(200).json({
      message: "GST settings updated successfully",
      gstEnabled: restaurant.gstEnabled,
      gstRate: restaurant.gstRate,
    });
  } catch (err) {
    console.error("Error updating GST settings:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Update isOpen Setting (Admin, JWT protected)
exports.updateRestaurantStatus = async (req, res) => {
  try {
    const user = req.user; // Logged-in user (from JWT middleware)
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    // Find the restaurant linked to this user
    const restaurant = await Restaurant.findOne({ user: user._id });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found." });

    const { isOpen } = req.body;

    // Validate input
    if (typeof isOpen !== "boolean") {
      return res.status(400).json({
        message: "Invalid value for isOpen. It must be true or false.",
      });
    }

    // Update only the isOpen field (partial update)
    restaurant.isOpen = isOpen;
    restaurant.updatedAt = new Date();
    await restaurant.save();

    res.status(200).json({
      message: `Restaurant is now ${isOpen ? "open" : "closed"}.`,
      restaurant,
    });
  } catch (err) {
    console.error("Update restaurant status error:", err);
    res
      .status(500)
      .json({ message: "Internal server error.", error: err.message });
  }
};
