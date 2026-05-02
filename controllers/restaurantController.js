const Restaurant = require("../models/Restaurant");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinary");
const MenuItem = require("../models/MenuItem");

// Retrieve restaurant details for clients based on domain (tenant middleware)
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

    // Sort categories by displayOrder if present
    if (Array.isArray(restaurant.categories)) {
      restaurant.categories = [...restaurant.categories].sort(
        (a, b) => (a.displayOrder || 0) - (b.displayOrder || 0),
      );
    }

    res.status(200).json({
      restaurant,
    });
  } catch (err) {
    console.error("Get restaurant details error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Retrieve restaurant details for logged-in admin or staff (JWT protected)
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

    // Sort categories by displayOrder if present
    if (Array.isArray(restaurant.categories)) {
      restaurant.categories = [...restaurant.categories].sort(
        (a, b) => (a.displayOrder || 0) - (b.displayOrder || 0),
      );
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
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const restaurant = await Restaurant.findOne({ user: user._id });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found." });

    const updateData = { ...req.body, updatedAt: new Date() };
if (req.body.categories !== undefined) {
  let categories = req.body.categories;

  // Ensure array
  if (!Array.isArray(categories)) {
    categories = [categories];
  }

  // Convert to correct structure
  updateData.categories = categories
    .filter((cat) => cat && cat !== "")
    .map((cat, index) => {
      if (typeof cat === "string") {
        return { name: cat, displayOrder: index };
      }
      return {
        name: cat.name || "",
        displayOrder: cat.displayOrder ?? index,
      };
    });
}
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

    // Find removed categories BEFORE updating
    const oldCategories = restaurant.categories.map((cat) => cat.name);
    const newCategories = Array.isArray(updateData.categories)
      ? updateData.categories.map((cat) => cat.name)
      : oldCategories;

    const removedCategories = oldCategories.filter(
      (cat) => !newCategories.includes(cat),
    );

    console.log("Old categories:", oldCategories);
    console.log("New categories:", newCategories);
    console.log("Removed categories:", removedCategories);

    // Update restaurant
    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
      restaurant._id,
      updateData,
      { new: true },
    );

    // Soft delete menu items for removed categories (case insensitive)
    let extraMessage = "";
    if (removedCategories.length > 0) {
      const regexCategories = removedCategories.map(
        (cat) => new RegExp(`^${cat}$`, "i"),
      );

      // Debug — check what items will be deleted
      const itemsToDelete = await MenuItem.find({
        user: user._id,
        category: { $in: regexCategories },
        deleted: false,
      });
      console.log("Menu items to be deleted:", itemsToDelete);

      await MenuItem.updateMany(
        { user: user._id, category: { $in: regexCategories }, deleted: false },
        { $set: { deleted: true } },
      );

      extraMessage = ` Categories [${removedCategories.join(", ")}] and their related menu items have also been deleted.`;
    }

    res.status(200).json({
      message: "Restaurant details updated successfully." + extraMessage,
      restaurant: updatedRestaurant,
    });
  } catch (err) {
    console.error("Update restaurant error:", err);
    res
      .status(500)
      .json({ message: "Internal server error.", error: err.message });
  }
};

// Delete restaurant (soft delete, Admin, JWT protected)
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

// Update GST settings (Admin, JWT protected)
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

// Update restaurant open status (Admin, JWT protected)
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

// Reorder categories (Admin, JWT protected)
exports.reorderCategories = async (req, res) => {
  try {
    const { orderedCategoryNames } = req.body;
    const userId = req.user._id;

    if (
      !Array.isArray(orderedCategoryNames) ||
      orderedCategoryNames.length === 0 ||
      new Set(orderedCategoryNames).size !== orderedCategoryNames.length
    ) {
      return res
        .status(400)
        .json({ error: "Invalid or duplicate category names." });
    }

    const restaurant = await Restaurant.findOne({
      user: userId,
      deleted: false,
    });
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found" });

    const categoryNames = restaurant.categories.map((cat) => cat.name);
    if (
      orderedCategoryNames.length !== categoryNames.length ||
      !orderedCategoryNames.every((name) => categoryNames.includes(name))
    ) {
      return res
        .status(400)
        .json({ error: "Some category names are invalid." });
    }

    restaurant.categories.sort(
      (a, b) =>
        orderedCategoryNames.indexOf(a.name) -
        orderedCategoryNames.indexOf(b.name),
    );
    restaurant.categories.forEach((cat, idx) => {
      cat.displayOrder = idx + 1;
    });

    await restaurant.save();
    res.json({
      message: "Categories reordered successfully",
      categories: restaurant.categories,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
