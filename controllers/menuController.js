// controllers/menuController.js
const MenuItem = require("../models/MenuItem")
const { uploadToCloudinary, deleteFromCloudinary } = require("../utils/cloudinary")


// Get Menu details (Client, via tenant middleware)
exports.getMenuByTenant = async (req, res) => {
  try {
    const { tenantAdminId, tenantRestaurantName } = req;

    if (!tenantAdminId) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    const menuItems = await MenuItem.find({ user: tenantAdminId, deleted: false });

    res.status(200).json({
      message: `Menu Items from restaurant: ${tenantRestaurantName}`,
      menu: menuItems,
    });
  } catch (err) {
    console.error("Get menu items error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get Menu details (Admin, JWT protected)
exports.getMenuItems = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const menuItems = await MenuItem.find({ user: user._id, deleted: false });
    res.status(200).json({
      message: `Menu Items fetched successfully`,
      menu: menuItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add Menu details (Admin, JWT protected)
exports.addMenuItems = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      pricingType, // "single" or "variant"
      variantRates,
      type,
      category,
      available,
    } = req.body;

    let image = null;

    // Upload to Cloudinary if image exists
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      image = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // Validation logic for pricing
    if (pricingType === "single") {
      if (!price) {
        return res.status(400).json({ error: "Single price is required" });
      }
    } else if (pricingType === "variant") {
      if (
        !variantRates ||
        (!variantRates.quarter && !variantRates.half && !variantRates.full)
      ) {
        return res
          .status(400)
          .json({ error: "At least one variant rate (quarter/half/full) is required" });
      }
    } else {
      return res
        .status(400)
        .json({ error: "Invalid pricing type. Must be 'single' or 'variant'" });
    }

    // Create new item
    const newItem = new MenuItem({
      name,
      description,
      pricingType,
      price: pricingType === "single" ? price : null,
      variantRates: pricingType === "variant" ? variantRates : null,
      type,
      category,
      available,
      image,
      user: req.user._id,
    });

    await newItem.save();
    res.status(201).json({
      message: "Menu item created successfully",
      item: newItem,
    });
  } catch (err) {
    console.error("Add menu error:", err);
    res.status(400).json({ error: err.message });
  }
};

// Update Menu details (Admin, JWT protected)
exports.updateMenuItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      pricingType,
      price,
      variantRates,
      type,
      category,
      available,
    } = req.body;

    const existingItem = await MenuItem.findById(id);
    if (!existingItem) {
      return res.status(404).json({ error: "Menu item not found" });
    }

    // --- Handle image update (optional) ---
    let image = existingItem.image;
    if (req.file) {
      // Delete old image from Cloudinary if exists
      if (image && image.public_id) {
        await deleteFromCloudinary(image.public_id);
      }
      // Upload new one
      const result = await uploadToCloudinary(req.file.buffer);
      image = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // --- Handle pricing logic ---
    if (pricingType === "single") {
      if (!price) {
        return res.status(400).json({ error: "Single price is required" });
      }
      existingItem.price = price;
      existingItem.variantRates = { quarter: null, half: null, full: null };
    } else if (pricingType === "variant") {
      if (
        !variantRates ||
        (!variantRates.quarter && !variantRates.half && !variantRates.full)
      ) {
        return res
          .status(400)
          .json({ error: "At least one variant rate (quarter/half/full) is required" });
      }
      existingItem.price = null;
      existingItem.variantRates = variantRates;
    } else {
      return res
        .status(400)
        .json({ error: "Invalid pricing type. Must be 'single' or 'variant'" });
    }

    // --- Update other fields ---
    existingItem.pricingType = pricingType ?? existingItem.pricingType;
    existingItem.name = name ?? existingItem.name;
    existingItem.description = description ?? existingItem.description;
    existingItem.type = type ?? existingItem.type;
    existingItem.category = category ?? existingItem.category;
    existingItem.available = available ?? existingItem.available;
    existingItem.image = image;

    await existingItem.save();

    res.status(200).json({
      message: "Menu item updated successfully",
      item: existingItem,
    });
  } catch (err) {
    console.error("Update menu error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Delete (Soft) Menu details (Admin, JWT protected)
exports.deleteMenuItem = async (req, res) => {
  const { id } = req.params

  try {
    const item = await MenuItem.findById(id);

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    // Soft delete instead of removing from DB
    item.deleted = true;
    await item.save();

    res.status(200).json({ message: "Menu item soft deleted successfully" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: err.message });
  }
};


