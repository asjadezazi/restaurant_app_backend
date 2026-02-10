// controllers/menuController.js
const MenuItem = require("../models/MenuItem");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinary");
const normalizeDiscount = require("../utils/normalizeDiscount");

// Get Menu details (Client, via tenant middleware)
exports.getMenuByTenant = async (req, res) => {
  try {
    const { tenantAdminId, tenantRestaurantName } = req;

    if (!tenantAdminId) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    const menuItems = await MenuItem.find({
      user: tenantAdminId,
      deleted: false,
    });

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
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { role, _id, createdBy } = req.user;
    let ownerAdminId;

    if (role === "admin") {
      ownerAdminId = _id; 
    }

    if (role === "staff") {
      ownerAdminId = createdBy; 
    }

    const filter = {
      user: ownerAdminId, // 🔥 admin id ALWAYS
      deleted: false
    };

    const menuItems = await MenuItem.find(filter);
    const totalMenuItems = await MenuItem.countDocuments(filter);
    res.status(200).json({
      message: `Menu Items fetched successfully`,
      totalMenuItems,
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
      pricingType, // "single", "variant", "combo"
      price,
      variantRates,
      type,
      category,
      available,
      discount, // for single items
      comboPrice, // for combo items
      comboItems, // array of items in combo [{menuItemId, variant?, quantity}]
    } = req.body;

    let image = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      image = { url: result.secure_url, public_id: result.public_id };
    }

    if (!["single", "variant", "combo"].includes(pricingType)) {
      return res.status(400).json({ error: "Invalid pricing type" });
    }

    const itemData = {
      name,
      description,
      pricingType,
      type,
      category,
      available,
      image,
      user: req.user._id,
    };

    // ---- SINGLE ITEM ----
    if (pricingType === "single") {
      if (!price)
        return res.status(400).json({ error: "Single price required" });
      itemData.price = price;
      itemData.discount = normalizeDiscount(discount);
    }

    // ---- VARIANT ITEM ----
    if (pricingType === "variant") {
      if (
        !variantRates ||
        (!variantRates.quarter && !variantRates.half && !variantRates.full)
      ) {
        return res
          .status(400)
          .json({ error: "At least one variant rate required" });
      }
      ["quarter", "half", "full"].forEach((key) => {
        if (variantRates[key])
          variantRates[key].discount = normalizeDiscount(
            variantRates[key].discount
          );
      });
      itemData.variantRates = variantRates;
    }

    // ---- COMBO ITEM ----
    // ---- COMBO ITEM ----
    if (pricingType === "combo") {
      if (
        !comboPrice ||
        !comboItems ||
        !Array.isArray(comboItems) ||
        comboItems.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "Combo price and comboItems required" });
      }

      // 1️⃣ Fetch menu items for name snapshot
      const menuItems = await MenuItem.find({
        _id: { $in: comboItems.map((i) => i.menuItemId) },
        deleted: false,
      });

      const comboItemsWithNames = comboItems.map((ci) => {
        const found = menuItems.find((m) => m._id.toString() === ci.menuItemId);

        if (!found) {
          throw new Error("Invalid menuItemId in combo");
        }

        // validate variant if required
        if (
          ci.variant &&
          found.pricingType === "variant" &&
          !found.variantRates[ci.variant]
        ) {
          throw new Error(`Invalid variant "${ci.variant}" for ${found.name}`);
        }

        return {
          menuItemId: found._id,
          name: found.name, // ✅ snapshot
          variant: ci.variant || null,
          quantity: ci.quantity || 1,
        };
      });

      itemData.pricingType = "combo";
      itemData.isCombo = true;
      itemData.comboPrice = comboPrice;
      itemData.comboItems = comboItemsWithNames;

      itemData.price = undefined;
      itemData.discount = undefined;
      itemData.variantRates = undefined;
    }

    const newItem = new MenuItem(itemData);
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
    const body = req.body;

    // const item = await MenuItem.findById(id);
    const item = await MenuItem.findOne({ _id: id }).lean();

    if (!item) return res.status(404).json({ error: "Menu item not found" });

    const update = {};
    const unset = {};

    // ---------- BASIC FIELDS ----------
    ["name", "description", "type", "category", "available"].forEach((f) => {
      if (body[f] !== undefined) update[f] = body[f];
    });

    // ---------- IMAGE ----------
    if (req.file) {
      if (item.image?.public_id) {
        await deleteFromCloudinary(item.image.public_id);
      }
      const result = await uploadToCloudinary(req.file.buffer);
      update.image = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // ---------- PRICING TYPE ----------
    let pricingType = body.pricingType;

    if (body.variantRates && pricingType !== "variant") {
      pricingType = "variant";
      update.pricingType = "variant";
    }

    if (pricingType) update.pricingType = pricingType;

    // ================= SINGLE =================
    if (pricingType === "single") {
      if (body.price !== undefined) update.price = body.price;
      if (body.discount !== undefined)
        update.discount = normalizeDiscount(body.discount);

      ["variantRates", "comboItems", "comboPrice"].forEach(
        (f) => (unset[f] = "")
      );
    }

    // ================= VARIANT =================
    if (pricingType === "variant") {
      const allowedVariants = ["quarter", "half", "full"];
      const variants = body.variantRates;

      if (!variants || Object.keys(variants).length === 0) {
        return res
          .status(400)
          .json({ error: "variantRates cannot be empty" });
      }

      Object.entries(variants).forEach(([key, value]) => {
        if (!allowedVariants.includes(key)) return;

        if (value.price !== undefined)
          update[`variantRates.${key}.price`] = value.price;
        if (value.discount !== undefined)
          update[`variantRates.${key}.discount`] =
            value.discount === null
              ? undefined
              : normalizeDiscount(value.discount);

        if (value.discount === null)
          unset[`variantRates.${key}.discount`] = "";
      });

      ["price", "discount", "comboItems", "comboPrice"].forEach(
        (f) => (unset[f] = "")
      );
    }

    // ================= COMBO =================
    if (pricingType === "combo") {
      if (body.comboPrice !== undefined)
        update.comboPrice = body.comboPrice;
      if (body.comboItems !== undefined)
        update.comboItems = body.comboItems;

      update.isCombo = true;

      ["price", "discount", "variantRates"].forEach(
        (f) => (unset[f] = "")
      );
    }

    const updatedItem = await MenuItem.findByIdAndUpdate(
      id,
      {
        ...(Object.keys(update).length && { $set: update }),
        ...(Object.keys(unset).length && { $unset: unset }),
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: "Menu item updated successfully",
      item: updatedItem,
    });
  } catch (err) {
    console.error("Update menu error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Delete (Soft) Menu details (Admin, JWT protected)
exports.deleteMenuItem = async (req, res) => {
  const { id } = req.params;

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
