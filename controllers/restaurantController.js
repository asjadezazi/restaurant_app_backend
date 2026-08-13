const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const User = require("../models/User")
const Order = require("../models/Order")
const mongoose = require("mongoose");
const { uploadToCloudinary, deleteFromCloudinary } = require("../utils/cloudinary");
const generateAndUploadQR = require("../utils/generateQR")
const path = require("path");
const logoPath = path.join(__dirname, "../assets/logo.jpeg");
const occupancyEmitter = require("../events/occupancyEvents");

// QR Info
exports.getQrInfo = async (req, res) => {
  try {
    const { unitId } = req.query;

    if (!unitId) {
      return res.status(400).json({
        message: "unitId is required",
      });
    }

    const restaurant = await Restaurant.findOne({
      deleted: false,
      "sections.units._id": unitId,
    }).lean();

    if (!restaurant) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    let unit = null;

    for (const section of restaurant.sections) {
      const found = section.units.find(
        (u) => u._id.toString() === unitId,
      );

      if (found) {
        unit = found;
        break;
      }
    }

    if (!unit) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    // TABLE QR
    if (unit.type === "TABLE") {
      return res.status(200).json({
        unitId,
        unitType: "TABLE",
        requiresCustomerInfo: true,
      });
    }

    // ROOM QR
    const bookingOrder = await Order.findOne({
      unitId,
      orderType: "Room Stay",
      status: { $ne: "Completed" },
    }).lean();

    return res.status(200).json({
      unitId,
      unitType: "ROOM",
      booked: !!bookingOrder,
      requiresCustomerInfo: false,
      customerName: bookingOrder?.customerName || null,
    });
  } catch (err) {
    console.error("getQrInfo error:", err);

    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

// Retrieve restaurant details for clients based on domain
exports.getPublicRestaurant = async (req, res) => {
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
exports.getRestaurant = async (req, res) => {
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

// Update restaurant details
exports.updateRestaurant = async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    const allowedFields = [
      "name",
      "restaurantName",
      "address",
      "phoneNumber",
      "deliveryCharges",
      "orderModes",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        restaurant[field] = req.body[field];
      }
    });

    //sync user document
    const userUpdates = {};

    if (req.body.name !== undefined) {
      userUpdates.name = req.body.name;
    }

    if (req.body.restaurantName !== undefined) {
      userUpdates.restaurantName =
        req.body.restaurantName;
    }

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: userUpdates,
        }
      );
    }

    if (req.file) {
      if (restaurant.logo?.public_id) {
        await deleteFromCloudinary(
          restaurant.logo.public_id
        ).catch(console.warn);
      }

      const result = await uploadToCloudinary(
        req.file.buffer
      );

      restaurant.logo = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    await restaurant.save();

    return res.status(200).json({
      message: "Restaurant updated successfully",
      restaurant,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Update GST settings
exports.updateRestaurantGST = async (req, res) => {
  try {
    const {
      gstEnabled,
      gstRate,
      gstNumber,
    } = req.body || {};

    if (
      gstEnabled === undefined &&
      gstRate === undefined &&
      gstNumber === undefined
    ) {
      return res.status(400).json({
        message: "No GST settings provided",
      });
    }

    const userId = req.user._id;

    const restaurant = await Restaurant.findOne({
      user: userId,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    // Update gstEnabled
    if (gstEnabled !== undefined) {
      restaurant.gstEnabled =
        gstEnabled === true ||
        gstEnabled === "true";
    }

    // Update gstRate
    if (gstRate !== undefined) {
      const rate = Number(gstRate);

      if (
        isNaN(rate) ||
        rate < 0 ||
        rate > 100
      ) {
        return res.status(400).json({
          message:
            "Invalid GST rate. Must be 0-100.",
        });
      }

      restaurant.gstRate = rate;
    }

    // Update gstNumber
    if (gstNumber !== undefined) {
      restaurant.gstNumber =
        gstNumber?.trim() || "";
    }

    await restaurant.save();

    return res.status(200).json({
      message:
        "GST settings updated successfully",
      gstEnabled: restaurant.gstEnabled,
      gstRate: restaurant.gstRate,
      gstNumber: restaurant.gstNumber,
    });

  } catch (err) {
    console.error(
      "Error updating GST settings:",
      err
    );

    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

// Update restaurant open status
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

// Create Categories
exports.createCategories = async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    let categories = req.body.categories;

    // Backward compatibility
    if (!categories && req.body.name) {
      categories = [
        {
          name: req.body.name,
          displayOrder: req.body.displayOrder,
        },
      ];
    }

    if (!Array.isArray(categories) || !categories.length) {
      return res.status(400).json({
        message: "categories array is required",
      });
    }

    const existingNames = new Set(
      restaurant.categories.map((c) =>
        c.name.toLowerCase()
      )
    );

    const newCategories = [];

    for (const category of categories) {
      if (!category.name) continue;

      if (
        existingNames.has(
          category.name.toLowerCase()
        )
      ) {
        continue;
      }

      newCategories.push({
        name: category.name,
        displayOrder:
          category.displayOrder ??
          restaurant.categories.length +
          newCategories.length,
      });

      existingNames.add(
        category.name.toLowerCase()
      );
    }

    restaurant.categories.push(...newCategories);

    await restaurant.save();

    return res.status(201).json({
      message: `${newCategories.length} categories added successfully`,
      categories: restaurant.categories,
    });

  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Update Category
exports.updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { newName } = req.body;

    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    const category = restaurant.categories.id(categoryId);

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    const oldName = category.name;

    category.name = newName;

    await restaurant.save();

    await MenuItem.updateMany(
      {
        user: req.user._id,
        category: oldName,
        deleted: false,
      },
      {
        $set: {
          category: newName,
        },
      }
    );

    return res.status(200).json({
      category,
      message: "Category renamed successfully",
    });

  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Reorder Categories
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

// Delete Category
exports.deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    const category = restaurant.categories.id(categoryId);

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    const categoryName = category.name;

    category.deleteOne();

    await restaurant.save();

    await MenuItem.updateMany(
      {
        user: req.user._id,
        category: categoryName,
        deleted: false,
      },
      {
        $set: {
          deleted: true,
        },
      }
    );

    return res.status(200).json({
      message: "Category and related Menu Items deleted successfully",
    });

  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Create Sections and Units
exports.createSectionsAndUnits = async (req, res) => {
  try {
    const userId = req.user._id;
    const { sectionName, type, units } = req.body;

    if (!sectionName || !type) {
      return res.status(400).json({
        message: "sectionName and type are required",
      });
    }

    if (!["TABLE", "ROOM"].includes(type)) {
      return res.status(400).json({
        message: "Invalid type (TABLE or ROOM only)",
      });
    }

    if (!Array.isArray(units) || units.length === 0) {
      return res.status(400).json({
        message: "units array is required",
      });
    }

    const restaurant = await Restaurant.findOne({
      user: userId,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found for this user",
      });
    }

    if (!restaurant.domain) {
      return res.status(400).json({
        message: "Restaurant domain not configured",
      });
    }

    const domain = restaurant.domain;

    let section = restaurant.sections.find(
      (s) => s.name === sectionName
    );

    if (!section) {
      restaurant.sections.push({
        name: sectionName,
        units: [],
      });

      section =
        restaurant.sections[
        restaurant.sections.length - 1
        ];
    }

    const existingNames = new Set(
      section.units.map((u) => u.name)
    );

    const newUnits = [];

    for (const u of units) {
      if (!u.name) {
        return res.status(400).json({
          message: "Each unit must have a name",
        });
      }

      if (existingNames.has(u.name)) {
        return res.status(400).json({
          message: `Duplicate unit name: ${u.name}`,
        });
      }

      const unitId = new mongoose.Types.ObjectId();

      const qr = await generateAndUploadQR(
        `${domain}/?unitId=${unitId}`,
        logoPath,
        u.name,
        type
      );

      newUnits.push({
        _id: unitId,
        type,
        name: u.name,
        status: "AVAILABLE",
        currentOrderId: null,

        roomCategory:
          type === "ROOM"
            ? u.roomCategory || null
            : undefined,

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

      existingNames.add(u.name);
    }

    section.units.push(...newUnits);

    await restaurant.save();

    return res.status(201).json({
      message: `${newUnits.length} ${type}(s) added successfully`,
      units: newUnits,
    });

  } catch (error) {
    console.error("Add units error:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Update Section
exports.updateSections = async (req, res) => {
  try {
    const { sectionUpdates = [], roomUpdates = [], unitUpdates = [] } = req.body;

    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    // SECTION RENAME
    for (const sectionUpdate of sectionUpdates) {
      const { sectionId, name } = sectionUpdate;

      const section =
        restaurant.sections.id(sectionId);

      if (!section) {
        continue;
      }

      if (name?.trim()) {
        section.name = name.trim();
      }
    }

    // ROOM CATEGORY UPDATE
    for (const roomUpdate of roomUpdates) {
      const { unitId, roomCategory } = roomUpdate;

      let roomUnit = null;

      for (const section of restaurant.sections) {
        const unit = section.units.id(unitId);

        if (unit) {
          roomUnit = unit;
          break;
        }
      }

      if (!roomUnit) {
        continue;
      }

      if (roomUnit.type !== "ROOM") {
        continue;
      }

      if (roomCategory?.name !== undefined) {
        roomUnit.roomCategory.name =
          roomCategory.name;
      }

      if (
        roomCategory?.pricingModel !== undefined
      ) {
        roomUnit.roomCategory.pricingModel =
          roomCategory.pricingModel;
      }

      if (
        roomCategory?.priceConfig
          ?.pricePerNight !== undefined
      ) {
        roomUnit.roomCategory.priceConfig.pricePerNight =
          Number(
            roomCategory.priceConfig.pricePerNight
          );
      }
    }

    // UNIT ACTIVE/INACTIVE UPDATE (ROOM/TABLE)
    for (const unitUpdate of unitUpdates) {
      const { unitId, isActive } = unitUpdate;

      let targetUnit = null;

      for (const section of restaurant.sections) {
        const unit = section.units.id(unitId);

        if (unit) {
          targetUnit = unit;
          break;
        }
      }

      if (!targetUnit) {
        continue;
      }

      if (typeof isActive === "boolean") {
        targetUnit.isActive = isActive;
      }
    }

    await restaurant.save();

    return res.status(200).json({
      message:
        "Sections and room categories updated successfully",
      sections: restaurant.sections,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Section
exports.deleteSection = async (req, res) => {
  try {
    const { sectionId } = req.params;

    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    const section =
      restaurant.sections.id(sectionId);

    if (!section) {
      return res.status(404).json({
        message: "Section not found",
      });
    }

    const activeUnits = section.units.filter(
      (unit) =>
        unit.status === "OCCUPIED" ||
        unit.status === "BILLED"
    );

    if (activeUnits.length > 0) {
      return res.status(400).json({
        message:
          "Cannot delete section containing occupied or billed units",
        units: activeUnits.map((u) => ({
          unitId: u._id,
          name: u.name,
          status: u.status,
        })),
      });
    }

    // Delete QR codes
    for (const unit of section.units) {
      if (unit.qrCode?.code) {
        await deleteFromCloudinary(
          unit.qrCode.code
        ).catch(console.warn);
      }
    }

    section.deleteOne();

    await restaurant.save();

    return res.status(200).json({
      message:
        "Section and all units deleted successfully",
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Unit
exports.deleteUnit = async (req, res) => {
  try {
    const { unitId } = req.params;

    const restaurant = await Restaurant.findOne({
      user: req.user._id,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    let foundUnit = null;
    let parentSection = null;

    for (const section of restaurant.sections) {
      const unit = section.units.id(unitId);

      if (unit) {
        foundUnit = unit;
        parentSection = section;
        break;
      }
    }

    if (!foundUnit) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    if (
      foundUnit.status === "OCCUPIED" ||
      foundUnit.status === "BILLED"
    ) {
      return res.status(400).json({
        message:
          "Cannot delete occupied or billed unit",
      });
    }

    if (foundUnit.qrCode?.code) {
      await deleteFromCloudinary(
        foundUnit.qrCode.code
      ).catch(console.warn);
    }

    foundUnit.deleteOne();

    await restaurant.save();

    return res.status(200).json({
      message: "Unit deleted successfully",
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Create Room Booking
exports.createRoomBooking = async (req, res) => {
  try {
    const userId = req.user._id;

    const {
      unitId,
      customerName,
      customerPhone,
    } = req.body;

    if (!unitId) {
      return res.status(400).json({
        message: "unitId is required",
      });
    }

    const restaurant = await Restaurant.findOne({
      user: userId,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    let resolvedUnit = null;
    let resolvedSection = null;

    // FIND ROOM
    for (const section of restaurant.sections) {
      const unit = section.units.id(unitId);

      if (unit && unit.type === "ROOM") {
        resolvedUnit = unit;
        resolvedSection = section.name;
        break;
      }
    }

    if (!resolvedUnit) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    // Already booked
    if (resolvedUnit.status === "OCCUPIED") {
      return res.status(400).json({
        message: "Room already booked",
      });
    }

    // ROOM CONFIG REQUIRED
    if (!resolvedUnit.roomCategory) {
      return res.status(400).json({
        message: "Room category not configured",
      });
    }

    const pricingModel =
      resolvedUnit.roomCategory.pricingModel || "PER_NIGHT";

    const pricePerNight =
      resolvedUnit.roomCategory.priceConfig?.pricePerNight || 0;

    // CREATE ORDER (ROOM BOOKING)
    const order = await Order.create({
      user: userId,
      createdBy: userId,
      createdByRole: "admin",

      fingerPrint: null, // will be set on first food order

      customerName,
      customerPhone,

      items: [],

      subtotal: 0,
      gstRate: 0,
      gstAmount: 0,
      deliveryCharges: 0,
      totalAmount: 0,

      orderType: "Room Stay",

      source: {
        restaurantId: restaurant._id,
        unitId: resolvedUnit._id,
        sectionName: resolvedSection,
        unitName: resolvedUnit.name,
        type: "ROOM",
      },

      // PERFECT ALIGNMENT WITH RESTAURANT SCHEMA
      stay: {
        enabled: true,
        checkInTime: new Date(),
        checkOutTime: null,

        category: {
          name: resolvedUnit.roomCategory.name,
        },

        pricing: {
          model: pricingModel,
          rate: pricePerNight,
        },

        duration: {
          nights: 0,
        },

        roomCharge: 0,
      },
    });

    // MARK ROOM OCCUPIED
    resolvedUnit.status = "OCCUPIED";
    resolvedUnit.currentOrderId = order._id;

    // optional but useful
    resolvedUnit.occupancy = {
      checkInTime: new Date(),
      checkOutTime: null,
    };

    await restaurant.save();

    occupancyEmitter.emit(
      "occupancyChanged",
      {
        user: restaurant.user,
        action: "ROOM_BOOKED",
        unitId: resolvedUnit._id,
        unitName: resolvedUnit.name,
        type: "ROOM",
        status: "OCCUPIED",
        currentOrderId: order._id,
      }
    );

    return res.status(201).json({
      message: "Room booked successfully",
      order,
    });

  } catch (error) {
    console.error("Book room error:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Live Table/Room Occupancy
exports.getLiveOccupancy = async (req, res) => {
  try {
    const { role, _id, restaurantId } = req.user;

    let restaurant;

    // ADMIN
    if (role === "admin") {
      restaurant = await Restaurant.findOne({
        user: _id,
        deleted: false,
      }).lean();
    }

    // STAFF
    else if (role === "staff") {
      if (!restaurantId) {
        return res.status(400).json({
          message: "Staff not linked to restaurant",
        });
      }

      restaurant = await Restaurant.findOne({
        _id: restaurantId,
        deleted: false,
      }).lean();
    }

    // INVALID ROLE
    else {
      return res.status(403).json({
        message: "Unauthorized role",
      });
    }

    // RESTAURANT NOT FOUND
    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    // FORMAT RESPONSE
    const sections = (restaurant.sections || []).map((section) => ({
      sectionId: section._id || null,
      name: section.name,

      units: (section.units || []).map((unit) => ({
        unitId: unit._id,
        name: unit.name,
        type: unit.type,
        status: unit.status,

        currentOrderId:
          unit.currentOrderId || null,

        occupiedSince:
          unit.occupancy?.checkInTime || null,

        roomCategory:
          unit.type === "ROOM"
            ? {
              name:
                unit.roomCategory?.name || null,

              pricingModel:
                unit.roomCategory?.pricingModel ||
                null,

              pricePerNight:
                unit.roomCategory?.priceConfig
                  ?.pricePerNight || null,
            }
            : null,

        isActive: unit.isActive,
      })),
    }));

    return res.status(200).json({
      message: "Live unit status fetched successfully",
      sections,
    });

  } catch (error) {
    console.error(
      "Live unit status error:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Delete restaurant
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
