// controllers/orderController.js
const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const orderEmitter = require("../events/orderEvents");
const occupancyEmitter = require("../events/occupancyEvents");
const calculateDiscountedPrice = require("../utils/calculateDiscountedPrice");
const normalizeDiscount = require("../utils/normalizeDiscount");


// Create order (Public)
exports.createOrder = async (req, res) => {
  try {
    const { tenantAdminId } = req;

    let {
      fingerPrint,
      customerName,
      customerPhone,
      items,
      orderType,
      address,
      createdBy,
      createdByRole = "user",
    } = req.body;

    // unitId is only taken from query (used for QR-based orders)
    const unitId = req.query.unitId;

    // VALIDATION
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    const restaurant = await Restaurant.findOne({
      user: tenantAdminId,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    let resolvedUnit = null;
    let resolvedSection = null;
    let existingOrder = null;

    // Resolve unit only for "Eat Here" orders
    if (unitId) {
      if (!unitId) {
        return res.status(400).json({
          message: "QR unitId is required for Eat Here",
        });
      }

      for (const section of restaurant.sections) {
        const unit = section.units.id(unitId);
        if (unit) {
          resolvedUnit = unit;
          resolvedSection = section.name;
          break;
        }
      }

      if (!resolvedUnit) {
        return res.status(404).json({ message: "Unit not found" });
      }

      if (!resolvedUnit.isActive) {
        return res.status(403).json({
          message: "This table/room is currently inactive and cannot accept orders",
        });
      }

      // For rooms, booking must already exist
      if (resolvedUnit.type === "ROOM") {
        existingOrder = await Order.findOne({
          "source.unitId": resolvedUnit._id,
          orderType: "Room Stay",
          "stay.enabled": true,
          status: { $nin: ["completed", "cancelled"] },
        });

        if (!existingOrder) {
          return res.status(400).json({
            message: "Room is not booked",
          });
        }

        customerName = existingOrder.customerName;
        customerPhone = existingOrder.customerPhone;
        orderType = "Room Stay";
      }
    }

    // Find existing active order for the unit (Eat Here only)

    if (
      !existingOrder &&
      orderType === "Eat Here" &&
      resolvedUnit?.currentOrderId
    ) {
      existingOrder = await Order.findOne({
        _id: resolvedUnit.currentOrderId,
        status: { $ne: "completed" },
      });
    }

    // Fetch menu items
    const uniqueMenuItemIds = [
      ...new Set(
        items.map((i) => i.menuItemId.toString())
      ),
    ];

    const menuItems = await MenuItem.find({
      _id: { $in: uniqueMenuItemIds },
      visibility: "PUBLIC",
    });

    if (menuItems.length !== uniqueMenuItemIds.length) {
      return res.status(403).json({
        message:
          "One or more items are not available for customer ordering",
      });
    }

    const menuMap = {};
    menuItems.forEach((m) => {
      menuMap[m._id.toString()] = m;
    });

    // Room QR orders must attach to existing booking
    if (
      resolvedUnit?.type === "ROOM" &&
      !existingOrder
    ) {
      return res.status(400).json({
        message: "Room is not booked",
      });
    }

    // Create a new order if none exists
    let isNewOrder = false;
    if (!existingOrder) {
      isNewOrder = true;
      existingOrder = await Order.create({
        user: tenantAdminId,
        createdBy: createdBy || null,
        createdByRole,

        fingerPrint,
        customerName,
        customerPhone,

        items: [],
        subtotal: 0,
        gstRate: restaurant.gstEnabled ? restaurant.gstRate : 0,
        gstAmount: 0,
        deliveryCharges:
          orderType === "Delivery" ? restaurant.deliveryCharges || 0 : 0,
        totalAmount: 0,

        source: {
          restaurantId: restaurant._id,
          unitId: resolvedUnit?._id || null,
          sectionName: resolvedSection || null,
          unitName: resolvedUnit?.name || null,
          type: resolvedUnit?.type || null,
        },

        orderType,
        address: orderType === "Delivery" ? address : null,
      });
    }

    // Enforce fingerprint ownership for Eat Here orders
    if (orderType === "Eat Here" || "Room Stay") {
      if (
        existingOrder.fingerPrint &&
        existingOrder.fingerPrint !== fingerPrint
      ) {
        return res.status(403).json({
          message: "This table/room is already occupied by another customer",
        });
      }

      if (!existingOrder.fingerPrint) {
        existingOrder.fingerPrint = fingerPrint;
      }
    }

    let addSubtotal = 0;

    // Add or merge items into the order
    for (const item of items) {
      const menuItem = menuMap[item.menuItemId];
      if (!menuItem) continue;

      const qty = Number(item.quantity) || 1;

      let basePrice = 0;
      let discountedPrice = 0;
      let discountSnapshot = { type: null, value: 0 };

      if (menuItem.pricingType === "single") {
        basePrice = menuItem.price;
        const discountObj = normalizeDiscount(menuItem.discount);
        discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
        discountSnapshot = discountObj;

      } else if (menuItem.pricingType === "variant") {
        const key = item.variant?.toLowerCase();
        const variantData = menuItem.variantRates?.[key];
        if (!variantData) continue;

        basePrice = variantData.price;
        const discountObj = normalizeDiscount(variantData.discount);
        discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
        discountSnapshot = discountObj;

      } else {
        basePrice = menuItem.comboPrice;
        discountedPrice = basePrice;
      }

      // Merge identical items (same menuItem + variant)
      const existingItem = existingOrder.items.find(
        (i) =>
          i.menuItemId.toString() === item.menuItemId &&
          (i.variant || null) === (item.variant || null)
      );

      if (existingItem) {
        existingItem.quantity += qty;
      } else {
        existingOrder.items.push({
          menuItemId: menuItem._id,
          name: menuItem.name,
          quantity: qty,
          price: basePrice,
          discountedPrice,
          discountApplied: discountSnapshot,
          variant: item.variant || null,
          customizations: item.customizations || "",
        });
      }

      addSubtotal += discountedPrice * qty;
    }

    // Update billing fields
    existingOrder.subtotal += addSubtotal;

    existingOrder.gstAmount =
      (existingOrder.subtotal * existingOrder.gstRate) / 100;

    existingOrder.totalAmount =
      existingOrder.subtotal +
      existingOrder.gstAmount +
      existingOrder.deliveryCharges;

    // Sync order status with item readiness
    const totalItems = existingOrder.items.length;

    const readyItems = existingOrder.items.filter(
      (item) => item.isReady
    ).length;

    if (readyItems === 0) {
      existingOrder.status = "pending";
    } else if (readyItems < totalItems) {
      existingOrder.status = "preparing";
    } else {
      existingOrder.status = "ready";
    }

    await existingOrder.save();

    if (isNewOrder) {
      orderEmitter.emit(
        "orderCreated",
        existingOrder.toObject()
      );
    } else {
      orderEmitter.emit(
        "orderUpdated",
        existingOrder.toObject()
      );
    }

    // Update occupancy for Eat Here orders
    if (orderType === "Eat Here" && resolvedUnit) {
      if (resolvedUnit.type === "TABLE") {
        const wasAvailable = resolvedUnit.status === "AVAILABLE";
        resolvedUnit.status = "OCCUPIED";

        if (!resolvedUnit.occupancy?.checkInTime) {
          resolvedUnit.occupancy = {
            checkInTime: new Date(),
            checkOutTime: null,
          };
        }

        resolvedUnit.currentOrderId = existingOrder._id;
        await restaurant.save();

        if (wasAvailable) {
          occupancyEmitter.emit(
            "occupancyChanged",
            {
              user: restaurant.user,
              action: "TABLE_OCCUPIED",
              unitId: resolvedUnit._id,
              orderId: existingOrder._id,
              sectionName: resolvedSection,
              unitName: resolvedUnit.name,
            }
          );
        }
      }

      if (resolvedUnit.type === "ROOM") {
        // Only link order, do not modify check-in time
        resolvedUnit.currentOrderId = existingOrder._id;
        await restaurant.save();
      }
    }

    return res.status(200).json({
      message: "Order processed successfully",
      order: existingOrder,
    });

  } catch (error) {
    console.error("Create order error:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Get Orders by fingerprint (Public)
exports.getLatestOrdersByFingerPrint = async (req, res) => {
  try {
    const { fingerPrint } = req.query;
    const { tenantAdminId } = req;

    if (!fingerPrint) {
      return res.status(400).json({ message: "fingerPrint is required" });
    }

    if (!tenantAdminId) {
      return res.status(400).json({ message: "Tenant not found" });
    }

    // get last 2 orders
    const orders = await Order.find({
      fingerPrint,
      user: tenantAdminId,
      deleted: false,
    })
      .sort({ createdAt: -1 }) // newest first
      .limit(2)
      .lean();

    if (!orders || orders.length === 0) {
      return res.status(404).json({
        message: "No orders found for this fingerprint",
      });
    }

    res.status(200).json({ orders });
  } catch (error) {
    console.error("Get orders by fingerprint error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Single Order by ID (Admin/Staff)
exports.getOrderById = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { orderId } = req.params;
    const { role, _id, createdBy } = req.user;

    if (!orderId) {
      return res.status(400).json({
        message: "orderId is required",
      });
    }

    // resolve owner admin id
    let ownerAdminId;

    if (role === "admin") {
      ownerAdminId = _id;
    }

    if (role === "staff") {
      ownerAdminId = createdBy;
    }

    // fetch order with ownership check
    const order = await Order.findOne({
      _id: orderId,
      user: ownerAdminId, // 🔥 ensures no cross-restaurant access
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    return res.status(200).json({
      message: "Order fetched successfully",
      order,
    });

  } catch (error) {
    console.error("Get order error:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Create Order (Admin / Staff)
exports.createOrderByAdminOrStaff = async (req, res) => {
  try {
    // Authenticate user
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { _id: creatorId, role, createdBy } = req.user;

    // Resolve tenant (restaurant owner)
    const tenantAdminId =
      role === "admin" ? creatorId : createdBy;

    if (!tenantAdminId) {
      return res.status(400).json({
        message: "Restaurant/admin mapping not found",
      });
    }

    const {
      customerName,
      customerPhone,
      items,
      orderType,
      address,
      source,
    } = req.body;

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    // Fetch restaurant
    const restaurant = await Restaurant.findOne({
      user: tenantAdminId,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const isDineIn = orderType === "Eat Here";

    let resolvedUnit = null;
    let resolvedSection = null;
    let existingOrder = null;

    // Resolve unit only for dine-in orders
    if (isDineIn) {
      const unitId = source?.unitId;

      if (!unitId) {
        return res.status(400).json({
          message: "unitId is required for Eat Here orders",
        });
      }

      // Find unit inside sections
      for (const section of restaurant.sections) {
        const unit = section.units.id(unitId);
        if (unit) {
          resolvedUnit = unit;
          resolvedSection = section.name;
          break;
        }
      }

      if (!resolvedUnit) {
        return res.status(404).json({
          message: "Unit not found",
        });
      }

      if (!resolvedUnit.isActive) {
        return res.status(403).json({
          message: "This table/room is currently inactive and cannot accept orders",
        });
      }

      // For rooms, ensure an active Room Stay booking exists
      if (resolvedUnit.type === "ROOM") {
        const activeRoomStay = await Order.findOne({
          "source.unitId": resolvedUnit._id,
          orderType: "Room Stay",
          "stay.enabled": true,
          status: { $nin: ["completed", "cancelled"] },
        });

        if (!activeRoomStay) {
          return res.status(400).json({
            message: "Room is not booked by admin",
          });
        }
      }

      // Try to attach to existing active order
      if (resolvedUnit.type === "ROOM") {
        existingOrder = await Order.findOne({
          "source.unitId": resolvedUnit._id,
          orderType: "Room Stay",
          "stay.enabled": true,
          status: { $nin: ["completed", "cancelled"] },
        });
      } else if (resolvedUnit.currentOrderId) {
        existingOrder = await Order.findOne({
          _id: resolvedUnit.currentOrderId,
          status: { $ne: "completed" },
        });
      }
    }

    if (
      isDineIn &&
      resolvedUnit?.type === "ROOM" &&
      !existingOrder
    ) {
      return res.status(400).json({
        message: "Room Stay booking not found",
      });
    }

    // Create new order if no active order exists
    if (!existingOrder) {
      existingOrder = await Order.create({
        user: tenantAdminId,
        createdBy: creatorId,
        createdByRole: role,

        fingerPrint: null, // admin flow

        customerName,
        customerPhone,

        items: [],
        subtotal: 0,

        gstRate: restaurant.gstEnabled ? restaurant.gstRate : 0,
        gstAmount: 0,

        deliveryCharges:
          orderType === "Delivery"
            ? restaurant.deliveryCharges || 0
            : 0,

        totalAmount: 0,

        source: {
          restaurantId: restaurant._id,
          unitId: isDineIn ? source?.unitId : null,
          sectionName: resolvedSection || null,
          unitName: resolvedUnit?.name || null,
          type: isDineIn ? resolvedUnit?.type : "NONE",
        },

        orderType,
        address: orderType === "Delivery" ? address : null,
      });
    }

    // Fetch menu items
    const menuItems = await MenuItem.find({
      _id: { $in: items.map((i) => i.menuItemId) },
    });

    const menuMap = {};
    menuItems.forEach((m) => {
      menuMap[m._id.toString()] = m;
    });

    let addSubtotal = 0;

    // Merge items into order
    for (const item of items) {
      const menuItem = menuMap[item.menuItemId];
      if (!menuItem) continue;

      const qty = Number(item.quantity) || 1;

      let basePrice = 0;
      let discountedPrice = 0;
      let discountSnapshot = { type: null, value: 0 };

      if (menuItem.pricingType === "single") {
        basePrice = menuItem.price;
        const discountObj = normalizeDiscount(menuItem.discount);
        discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
        discountSnapshot = discountObj;

      } else if (menuItem.pricingType === "variant") {
        const key = item.variant?.toLowerCase();
        const variantData = menuItem.variantRates?.[key];
        if (!variantData) continue;

        basePrice = variantData.price;
        const discountObj = normalizeDiscount(variantData.discount);
        discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
        discountSnapshot = discountObj;

      } else {
        basePrice = menuItem.comboPrice;
        discountedPrice = basePrice;
      }

      // Merge identical items (same menuItem + variant)
      const existingItem = existingOrder.items.find(
        (i) =>
          i.menuItemId.toString() === item.menuItemId &&
          (i.variant || null) === (item.variant || null)
      );

      if (existingItem) {
        existingItem.quantity += qty;
      } else {
        existingOrder.items.push({
          menuItemId: menuItem._id,
          name: menuItem.name,
          quantity: qty,
          price: basePrice,
          discountedPrice,
          discountApplied: discountSnapshot,
          variant: item.variant || null,
          customizations: item.customizations || "",
        });
      }

      addSubtotal += discountedPrice * qty;
    }

    // Update bill
    existingOrder.subtotal += addSubtotal;

    existingOrder.gstAmount =
      (existingOrder.subtotal * existingOrder.gstRate) / 100;

    existingOrder.totalAmount =
      existingOrder.subtotal +
      existingOrder.gstAmount +
      existingOrder.deliveryCharges;

    await existingOrder.save();

    orderEmitter.emit(
      "orderCreated",
      existingOrder.toObject()
    );

    // Update unit occupancy (only for dine-in)
    if (isDineIn && resolvedUnit) {
      if (resolvedUnit.type === "TABLE") {
        const wasAvailable = resolvedUnit.status === "AVAILABLE";
        resolvedUnit.status = "OCCUPIED";

        if (!resolvedUnit.occupancy?.checkInTime) {
          resolvedUnit.occupancy = {
            checkInTime: new Date(),
            checkOutTime: null,
          };
        }

        resolvedUnit.currentOrderId = existingOrder._id;
        await restaurant.save();

        if (wasAvailable) {
          occupancyEmitter.emit(
            "occupancyChanged",
            {
              user: restaurant.user,
              action: "TABLE_OCCUPIED",
              unitId: resolvedUnit._id,
              orderId: existingOrder._id,
              sectionName: resolvedSection,
              unitName: resolvedUnit.name,
            }
          );
        }
      }

      if (resolvedUnit.type === "ROOM") {
        // Only link order, do not modify check-in
        resolvedUnit.currentOrderId = existingOrder._id;
        await restaurant.save();
      }
    }

    return res.status(200).json({
      message: "Order processed successfully",
      order: existingOrder,
    });

  } catch (error) {
    console.error("Admin order error:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Get All Orders (Filtered)
exports.getAllOrders = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { role, _id, createdBy } = req.user;
    const { status, range = "all", page = 1, limit = 10 } = req.query;

    let ownerAdminId;

    if (role === "admin") {
      ownerAdminId = _id;
    }

    if (role === "staff") {
      ownerAdminId = createdBy;
    }

    // Validate status
    const allowedStatus = ["pending", "preparing", "ready", "completed", "cancelled"];
    if (!status || !allowedStatus.includes(status.toLowerCase())) {
      return res.status(400).json({
        message: "Status must be pending, preparing, ready, completed, or cancelled",
      });
    }

    // Date range
    const now = new Date();
    let fromDate;

    switch (range) {
      case "24h":
        fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "2d":
        fromDate = new Date(now.getTime() - 2 * 86400000);
        break;
      case "7d":
        fromDate = new Date(now.getTime() - 7 * 86400000);
        break;
      case "15d":
        fromDate = new Date(now.getTime() - 15 * 86400000);
        break;
      case "30d":
        fromDate = new Date(now.getTime() - 30 * 86400000);
        break;
      default:
        fromDate = new Date(0);
    }

    // FINAL FILTER (single source of truth)
    const filter = {
      user: ownerAdminId, // admin id ALWAYS
      status: status.toLowerCase(),
      createdAt: { $gte: fromDate, $lte: now },
      deleted: false
    };

    const skip = (Number(page) - 1) * Number(limit);

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const totalOrders = await Order.countDocuments(filter);

    res.status(200).json({
      totalOrders,
      totalPages: Math.ceil(totalOrders / limit),
      currentPage: Number(page),
      ordersPerPage: Number(limit),
      ordersInPage: orders.length,
      from: fromDate,
      to: now,
      orders,
    });
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update order
exports.updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = { ...req.body };

    const ALLOWED_ORDER_TYPES = ["Eat Here", "Take Away", "Delivery", "Room Stay"];
    const SIMPLE_FIELDS = ["address", "orderType"];

    //Prevent restricted fields
    delete updates.settlementAmount;
    delete updates.paymentMethod;

    const makeItemKey = (item) => {
      return `${item.menuItemId}_${item.variant || "default"}_${item.customizations || ""}`;
    };

    //FETCH ORDER
    const existingOrder = await Order.findById(orderId);

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    //HARD LOCK
    if (["completed", "cancelled"].includes(existingOrder.status)) {
      return res.status(400).json({
        message: `Cannot modify ${existingOrder.status} order`,
      });
    }

    const updatePayload = {};
    let occupancyChanged = false;
    let occupancyAction = null;
    let occupancyData = null;

    // VALIDATE ORDER TYPE
    if (updates.orderType && !ALLOWED_ORDER_TYPES.includes(updates.orderType)) {
      return res.status(400).json({ message: "Invalid orderType" });
    }

    SIMPLE_FIELDS.forEach((field) => {
      if (updates[field] !== undefined) {
        updatePayload[field] = updates[field];
      }
    });

    const finalOrderType =
      updates.orderType || existingOrder.orderType;


    // RELEASE TABLE IF MOVING AWAY FROM EAT HERE

    if (
      existingOrder.orderType === "Eat Here" &&
      finalOrderType !== "Eat Here"
    ) {
      const restaurant = await Restaurant.findOne({
        user: existingOrder.user,
        deleted: false,
      });

      if (restaurant && existingOrder.source?.unitId) {
        let releasedUnit = null;
        let releasedSection = null;
        for (const section of restaurant.sections) {
          const unit = section.units.id(
            existingOrder.source.unitId
          );

          if (unit) {
            unit.status = "AVAILABLE";
            unit.currentOrderId = null;

            unit.occupancy = {
              checkInTime: null,
              checkOutTime: null,
            };

            releasedUnit = unit;
            releasedSection = section;

            break;
          }
        }

        await restaurant.save();
        occupancyChanged = true;
        occupancyAction = "UNIT_RELEASED";

        occupancyData = {
          user: existingOrder.user,
          orderId: existingOrder._id,
          unitId: releasedUnit._id,
          unitName: releasedUnit.name,
          sectionName: releasedSection.name,
          unitType: releasedUnit.type,
        };
      }
    }

    // SOURCE HANDLING
    if (finalOrderType === "Eat Here" || finalOrderType === "Room Stay") {
      const unitId = updates.source?.unitId || existingOrder.source?.unitId;

      if (!unitId) {
        return res.status(400).json({
          message:
            "unitId is required for Eat Here and Room Stay orders",
        });
      }

      // fetch restaurant to resolve unit info
      const restaurant = await Restaurant.findOne({
        user: existingOrder.user,
        deleted: false,
      });

      let resolvedUnit = null;
      let resolvedSection = null;

      for (const section of restaurant.sections) {
        const unit = section.units.id(unitId);
        if (unit) {
          resolvedUnit = unit;
          resolvedSection = section.name;
          break;
        }
      }

      if (!resolvedUnit) {
        return res.status(404).json({ message: "Unit not found" });
      }

      updatePayload.source = {
        restaurantId: restaurant._id,
        unitId,
        sectionName: resolvedSection,
        unitName: resolvedUnit.name,
        type: resolvedUnit.type,
      };

      if (
        existingOrder.orderType !== "Eat Here" &&
        finalOrderType === "Eat Here"
      ) {
        resolvedUnit.status = "OCCUPIED";
        resolvedUnit.currentOrderId = existingOrder._id;

        if (!resolvedUnit.occupancy?.checkInTime) {
          resolvedUnit.occupancy = {
            checkInTime: new Date(),
            checkOutTime: null,
          };
        }

        await restaurant.save();
        occupancyChanged = true;
        occupancyAction = "UNIT_OCCUPIED";

        occupancyData = {
          user: existingOrder.user,
          orderId: existingOrder._id,
          unitId: resolvedUnit._id,
          unitName: resolvedUnit.name,
          sectionName: resolvedSection,
          unitType: resolvedUnit.type,
        };
      }

    } else {
      // Take Away / Delivery
      updatePayload.source = {
        restaurantId: existingOrder.source.restaurantId,
        unitId: null,
        sectionName: null,
        unitName: null,
        type: "NONE",
      };

      if (finalOrderType === "Take Away") {
        updatePayload.address = null;
      }

      if (finalOrderType === "Delivery") {
        if (!updates.address && !existingOrder.address) {
          return res.status(400).json({
            message: "Address required for Delivery",
          });
        }
      }
    }

    // BASE ITEMS
    let baseItems = existingOrder.items.map((i) => i.toObject());

    // REMOVE ITEMS
    if (Array.isArray(updates.removeItemIds)) {
      baseItems = baseItems.filter(
        (i) => !updates.removeItemIds.includes(i._id.toString())
      );
    }

    // UPDATE QUANTITY
    if (Array.isArray(updates.updateQuantities)) {
      for (const q of updates.updateQuantities) {
        const idx = baseItems.findIndex(
          (i) => i._id.toString() === q.itemId
        );

        if (idx === -1) {
          return res.status(400).json({ message: "Item not found" });
        }

        const qty = Number(q.quantity);

        if (!Number.isInteger(qty)) {
          return res.status(400).json({
            message: "Quantity must be integer",
          });
        }

        if (qty <= 0) {
          baseItems.splice(idx, 1);
        } else {
          baseItems[idx].quantity = qty;
        }
      }
    }

    // ADD ITEMS
    if (Array.isArray(updates.items)) {
      const menuItems = await MenuItem.find({
        _id: { $in: updates.items.map(i => i.menuItemId) },
      });

      const menuMap = {};
      menuItems.forEach(m => {
        menuMap[m._id.toString()] = m;
      });

      for (const item of updates.items) {
        const menuItem = menuMap[item.menuItemId];
        if (!menuItem) continue;

        const qty = Number(item.quantity) || 1;

        let price = 0;
        let discountedPrice = 0;
        let discountApplied = { type: null, value: 0 };

        if (menuItem.pricingType === "single") {
          price = menuItem.price;
          discountApplied = normalizeDiscount(menuItem.discount);
          discountedPrice = calculateDiscountedPrice(price, discountApplied);
        }

        if (menuItem.pricingType === "variant") {
          const key = item.variant?.toLowerCase();
          const v = menuItem.variantRates?.[key];
          if (!v) continue;

          price = v.price;
          discountApplied = normalizeDiscount(v.discount);
          discountedPrice = calculateDiscountedPrice(price, discountApplied);
        }

        if (menuItem.pricingType === "combo") {
          price = menuItem.comboPrice;
          discountedPrice = price;
        }

        const newItem = {
          menuItemId: menuItem._id,
          name: menuItem.name,
          quantity: qty,
          price,
          discountedPrice,
          discountApplied,
          variant: item.variant || null,
          customizations: item.customizations || "",
          isReady: false,
        };

        const key = makeItemKey(newItem);

        const existingIdx = baseItems.findIndex(i =>
          makeItemKey(i) === key
        );

        if (existingIdx > -1) {
          baseItems[existingIdx].quantity += qty;
        } else {
          baseItems.push(newItem);
        }
      }
    }

    if (
      !baseItems.length &&
      !existingOrder.stay?.enabled
    ) {
      return res.status(400).json({
        message: "Order must contain at least 1 item",
      });
    }

    // TOTAL
    let subtotal = baseItems.reduce(
      (sum, i) => sum + (i.discountedPrice || i.price) * i.quantity,
      0
    );

    // room booking + cancel food order
    if (
      updates.status === "cancelled" &&
      existingOrder.stay?.enabled
    ) {
      subtotal = 0;
    }

    const restaurant = await Restaurant.findOne({
      user: existingOrder.user,
      deleted: false,
    });

    const gstRate = restaurant?.gstEnabled ? restaurant.gstRate : 0;
    const gstAmount = (subtotal * gstRate) / 100;

    const deliveryCharges =
      finalOrderType === "Delivery"
        ? restaurant.deliveryCharges || 0
        : 0;

    const totalAmount = subtotal + gstAmount + deliveryCharges;

    // update status 
    const ALLOWED_STATUS = [
      "pending",
      "preparing",
      "ready",
      "completed",
      "cancelled",
    ];

    if (updates.status !== undefined) {
      if (!ALLOWED_STATUS.includes(updates.status)) {
        return res.status(400).json({
          message: "Invalid status",
        });
      }

      // ROOM BOOKING ORDER
      if (
        updates.status === "cancelled" &&
        existingOrder.stay?.enabled
      ) {

        // only room booking exists
        if (existingOrder.items.length === 0) {
          return res.status(400).json({
            message:
              "This is a room booking. Use cancelRoomBooking endpoint.",
          });
        }

        // room + food
        baseItems = [];

        subtotal = 0;

        updatePayload.status = existingOrder.status;
      } else {

        if (updates.status === "ready") {
          baseItems = baseItems.map(item => ({
            ...item,
            isReady: true,
          }));
        }

        if (updates.status === "pending") {
          baseItems = baseItems.map(item => ({
            ...item,
            isReady: false,
          }));
        }

        // preparing -> keep individual item readiness unchanged

        updatePayload.status = updates.status;
      }
    }

    // Auto recalculate status from items
    if (
      !(
        updates.status === "cancelled" &&
        existingOrder.stay?.enabled
      )
    ) {

      if (
        updates.status === undefined &&
        existingOrder.status !== "completed" &&
        existingOrder.status !== "cancelled"
      ) {
        const totalItems = baseItems.length;

        const readyItems = baseItems.filter(
          item => item.isReady
        ).length;

        if (readyItems === 0) {
          updatePayload.status = "pending";
        } else if (readyItems < totalItems) {
          updatePayload.status = "preparing";
        } else {
          updatePayload.status = "ready";
        }
      }
    }

    Object.assign(updatePayload, {
      items: baseItems,
      subtotal,
      gstRate,
      gstAmount,
      deliveryCharges,
      totalAmount,
    });

    if (
      updates.status === "cancelled" &&
      existingOrder.source?.type === "TABLE"
    ) {
      const restaurant = await Restaurant.findOne({
        user: existingOrder.user,
        deleted: false,
      });

      if (restaurant) {
        for (const section of restaurant.sections) {
          const unit = section.units.id(
            existingOrder.source.unitId
          );

          if (unit) {
            unit.status = "AVAILABLE";
            unit.currentOrderId = null;

            unit.occupancy = {
              checkInTime: null,
              checkOutTime: null,
            };

            await restaurant.save();

            occupancyChanged = true;
            occupancyAction = "UNIT_RELEASED";

            occupancyData = {
              user: existingOrder.user,
              orderId: existingOrder._id,
              unitId: unit._id,
              unitName: unit.name,
              sectionName: section.name,
              unitType: unit.type,
            };

            break;
          }
        }
      }
    }

    // UPDATE
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: updatePayload },
      { new: true }
    );

    orderEmitter.emit("orderUpdated", updatedOrder.toObject());

    if (
      occupancyChanged &&
      occupancyData
    ) {
      occupancyEmitter.emit(
        "occupancyChanged",
        {
          ...occupancyData,
          action: occupancyAction,
        }
      );
    }

    return res.status(200).json({
      message: "Order updated successfully",
      order: updatedOrder,
    });

  } catch (error) {
    console.error("Update order error:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Toggle Item ready status
exports.toggleItemReady = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;

    // Get current order
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (["completed", "cancelled"].includes(order.status)) {
      return res.status(400).json({
        message: "Cannot modify items of a completed/cancelled order",
      });
    }

    const item = order.items.find(
      (i) => i._id.toString() === itemId
    );

    if (!item) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    const newReadyState = !item.isReady;

    // Atomic item update
    let updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        "items._id": itemId,
      },
      {
        $set: {
          "items.$.isReady": newReadyState,
        },
      },
      {
        new: true,
      }
    );

    // Recalculate status
    const totalItems = updatedOrder.items.length;
    const readyItems = updatedOrder.items.filter(
      (i) => i.isReady
    ).length;

    let newStatus = "pending";

    if (readyItems === 0) {
      newStatus = "pending";
    } else if (readyItems < totalItems) {
      newStatus = "preparing";
    } else {
      newStatus = "ready";
    }

    // Update status only if changed
    if (updatedOrder.status !== newStatus) {
      updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          status: newStatus,
        },
        {
          new: true,
        }
      );
    }

    // orderEmitter.emit("orderUpdated", {
    //   user: updatedOrder.user,
    //   action: "ITEM_READY_TOGGLED",
    //   order: updatedOrder.toObject(),
    // });
    orderEmitter.emit(
      "orderUpdated",
      updatedOrder.toObject()
    );

    return res.status(200).json(updatedOrder);
  } catch (error) {
    console.error("Toggle item ready error:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Delete order
exports.deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    // Soft delete
    order.deleted = true;
    await order.save();

    // If order is attached to a unit, free that unit
    if (order.source?.unitId) {
      const restaurant = await Restaurant.findOne({
        "sections.units._id": order.source.unitId,
        deleted: false,
      });

      if (restaurant) {
        let targetUnit = null;
        let sectionName = null;

        for (const section of restaurant.sections) {
          const unit = section.units.id(
            order.source.unitId
          );

          if (unit) {
            targetUnit = unit;
            sectionName = section.name;
            break;
          }
        }

        if (
          targetUnit &&
          targetUnit.currentOrderId?.toString() ===
          order._id.toString()
        ) {
          targetUnit.status = "AVAILABLE";

          targetUnit.currentOrderId = null;

          targetUnit.occupancy = {
            checkInTime: null,
            checkOutTime: new Date(),
          };

          await restaurant.save();

          occupancyEmitter.emit(
            "occupancyChanged",
            {
              user: restaurant.user,
              action:
                targetUnit.type === "ROOM"
                  ? "ROOM_VACATED"
                  : "TABLE_VACATED",
              unitId: targetUnit._id,
              orderId: order._id,
              sectionName,
              unitName: targetUnit.name,
            }
          );
        }
      }
    }

    return res.json({
      message:
        "Order deleted successfully",
    });

  } catch (error) {
    console.error(
      "Error deleting order:",
      error
    );

    return res.status(500).json({
      message: "Server error",
    });
  }
};

// Bill order
exports.billOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status === "completed") {
      return res.status(400).json({ message: "Order already completed" });
    }

    // RESTAURANT
    const restaurant = await Restaurant.findOne({
      user: order.user,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    // BILL CALC
    let roomCharge = 0;
    let foodSubtotal = order.subtotal;
    let gst = order.gstAmount;
    let delivery = order.deliveryCharges || 0;

    // ROOM LOGIC
    if (order.source.type === "ROOM") {
      if (!order.stay?.enabled) {
        return res.status(400).json({
          message: "Stay not enabled for this room order",
        });
      }

      const checkIn = order.stay.checkInTime
        ? new Date(order.stay.checkInTime)
        : new Date();

      const checkOut = new Date();
      const diffMs = checkOut - checkIn;

      const nights = Math.max(
        1,
        Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      );

      const rate = order.stay?.pricing?.rate || 0;

      roomCharge = nights * rate;

      order.stay.checkOutTime = checkOut;
      order.stay.duration.nights = nights;
      order.stay.roomCharge = roomCharge;
    }

    // FINAL BILL
    const totalAmount = foodSubtotal + gst + delivery + roomCharge;

    order.totalAmount = totalAmount;
    order.status = "completed";
    order.completedAt = new Date();

    await order.save();

    orderEmitter.emit("orderUpdated", {
      action: "ORDER_BILLED",
      order: order.toObject(),
    });

    //  HANDLE UNIT ONLY FOR TABLE / ROOM
    if (order.source.type === "TABLE" || order.source.type === "ROOM") {
      let resolvedUnit = null;
      let resolvedSection = null;

      for (const section of restaurant.sections) {
        const unit = section.units.id(order.source.unitId);
        if (unit) {
          resolvedUnit = unit;
          resolvedSection = section;
          break;
        }
      }

      if (resolvedUnit) {
        resolvedUnit.status = "BILLED";

        await restaurant.save();

        occupancyEmitter.emit("occupancyChanged", {
          action: "UNIT_BILLED",
          user: order.user,
          orderId: order._id,
          unitId: resolvedUnit._id,
          unitName: resolvedUnit.name,
          sectionId: resolvedSection._id,
          sectionName: resolvedSection.name,
          unitType: resolvedUnit.type,
          status: resolvedUnit.status,
          completedAt: order.completedAt,
        });
      }
    }

    return res.status(200).json({
      message: "Checkout successful (Bill generated)",
      order: {
        orderId: order._id,
        status: order.status,
        source: order.source,
        foodSubtotal,
        gst,
        deliveryCharges: delivery,
        roomCharge,
        totalAmount,
        completedAt: order.completedAt,
      },
    });

  } catch (error) {
    console.error("Checkout error:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Shift Table/Room
exports.moveOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { unitId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (["completed", "cancelled"].includes(order.status)) {
      return res.status(400).json({
        message: "Cannot move this order",
      });
    }

    const restaurant = await Restaurant.findOne({
      user: order.user,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    let oldUnit = null;
    let targetUnit = null;
    let targetSection = null;

    for (const section of restaurant.sections) {
      for (const unit of section.units) {
        if (
          unit._id.toString() ===
          order.source.unitId?.toString()
        ) {
          oldUnit = unit;
        }

        if (unit._id.toString() === unitId) {
          targetUnit = unit;
          targetSection = section.name;
        }
      }
    }

    if (!targetUnit) {
      return res.status(404).json({
        message: "Target unit not found",
      });
    }

    // SAME UNIT
    if (
      oldUnit &&
      oldUnit._id.toString() === unitId
    ) {
      return res.status(400).json({
        message: "Already in this unit",
      });
    }

    // CROSS TYPE BLOCK
    if (
      oldUnit &&
      oldUnit.type !== targetUnit.type
    ) {
      return res.status(400).json({
        message:
          "Only TABLE→TABLE and ROOM→ROOM shifting allowed",
      });
    }

    // BLOCK IF TARGET OCCUPIED
    if (targetUnit.currentOrderId) {
      return res.status(400).json({
        message: "Target unit already occupied",
      });
    }

    // ✅ Preserve old occupancy before clearing it
    const oldOccupancy = oldUnit?.occupancy
      ? {
        checkInTime:
          oldUnit.occupancy.checkInTime,
        checkOutTime:
          oldUnit.occupancy.checkOutTime,
      }
      : {
        checkInTime: null,
        checkOutTime: null,
      };

    // OLD CLEANUP
    if (oldUnit) {
      oldUnit.status = "AVAILABLE";
      oldUnit.currentOrderId = null;
      oldUnit.occupancy = {
        checkInTime: null,
        checkOutTime: null,
      };
    }

    // NEW SETUP
    targetUnit.status = "OCCUPIED";
    targetUnit.currentOrderId = order._id;

    if (targetUnit.type === "TABLE") {
      targetUnit.occupancy = {
        checkInTime:
          oldOccupancy.checkInTime ||
          new Date(),
        checkOutTime: null,
      };
    }

    if (targetUnit.type === "ROOM") {
      // Update pricing only
      if (order.stay?.enabled) {
        order.stay.pricing.rate =
          targetUnit.roomCategory?.priceConfig
            ?.pricePerNight || 0;

        order.stay.category.name =
          targetUnit.roomCategory?.name ||
          null;
      }

      targetUnit.occupancy = {
        checkInTime:
          oldOccupancy.checkInTime ||
          order.stay?.checkInTime ||
          new Date(),
        checkOutTime: null,
      };
    }

    // UPDATE ORDER
    order.source.unitId = targetUnit._id;
    order.source.unitName = targetUnit.name;
    order.source.sectionName = targetSection;

    await order.save();
    await restaurant.save();

    occupancyEmitter.emit(
      "occupancyChanged",
      {
        user: restaurant.user,
        action: "UNIT_MOVED",
        fromUnitId: oldUnit?._id,
        toUnitId: targetUnit._id,
        orderId: order._id,
      }
    );

    orderEmitter.emit("orderUpdated", {
      user: order.user,
      order: order.toObject(),
    });

    return res.json({
      message: "Order shifted successfully",
      order,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: err.message,
    });
  }
};

// Pay order
exports.payOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentMethods, settlementAmount } = req.body;

    const ALLOWED_METHODS = ["CASH", "UPI", "CARD"];

    // VALIDATE PAYMENT METHODS
    if (
      !Array.isArray(paymentMethods) ||
      paymentMethods.length === 0
    ) {
      return res.status(400).json({
        message: "At least one payment method is required",
      });
    }

    let paidAmount = 0;

    for (const payment of paymentMethods) {
      if (!ALLOWED_METHODS.includes(payment.method)) {
        return res.status(400).json({
          message: `Invalid payment method: ${payment.method}`,
        });
      }

      const amount = Number(payment.amount);

      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({
          message: `Invalid amount for ${payment.method}`,
        });
      }

      paidAmount += amount;
    }

    // FETCH ORDER
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    // PREVENT DOUBLE PAYMENT
    if (order.paymentMethods?.length > 0) {
      return res.status(400).json({
        message: "Payment already completed",
      });
    }

    // MUST BE BILLED FIRST
    if (order.status !== "completed") {
      return res.status(400).json({
        message: "Order must be billed before payment",
      });
    }

    // VALIDATE SETTLEMENT
    if (settlementAmount !== undefined) {
      const amt = Number(settlementAmount);

      if (isNaN(amt) || amt < 0) {
        return res.status(400).json({
          message: "Invalid settlement amount",
        });
      }

      if (amt > order.totalAmount) {
        return res.status(400).json({
          message: "Settlement cannot exceed total amount",
        });
      }

      order.settlementAmount = amt;
    }

    // TOTAL PAID MUST MATCH PAYABLE AMOUNT
    const expectedAmount =
      order.settlementAmount != null
        ? order.settlementAmount
        : order.totalAmount;

    if (paidAmount !== expectedAmount) {
      return res.status(400).json({
        message: `Total payment amount must equal ₹${expectedAmount}`,
      });
    }

    // SAVE PAYMENT
    order.paymentMethods = paymentMethods;

    // HANDLE UNIT (ONLY TABLE / ROOM)
    if (order.source.type === "TABLE" || order.source.type === "ROOM") {
      const restaurant = await Restaurant.findOne({
        user: order.user,
        deleted: false,
      });

      if (!restaurant) {
        return res.status(404).json({
          message: "Restaurant not found",
        });
      }

      let resolvedUnit = null;
      let resolvedSection = null;

      for (const section of restaurant.sections) {
        const unit = section.units.id(order.source.unitId);
        if (unit) {
          resolvedUnit = unit;
          resolvedSection = section;
          break;
        }
      }

      // Ensure billed state before freeing
      if (!resolvedUnit || resolvedUnit.status !== "BILLED") {
        return res.status(400).json({
          message: "Unit is not in billed state",
        });
      }

      // FREE UNIT
      resolvedUnit.status = "AVAILABLE";
      resolvedUnit.currentOrderId = null;
      resolvedUnit.occupancy = {
        checkInTime: null,
        checkOutTime: null,
      };

      await restaurant.save();

      occupancyEmitter.emit("occupancyChanged", {
        user: restaurant.user,
        action:
          order.source.type === "ROOM"
            ? "ROOM_RELEASED"
            : "TABLE_RELEASED",
        unitId: resolvedUnit._id,
        orderId: order._id,
        sectionName: resolvedSection.name,
        unitName: resolvedUnit.name,
      });
    }

    await order.save();

    orderEmitter.emit("orderUpdated", order.toObject());

    return res.status(200).json({
      message: "Payment successful",
      order,
    });

  } catch (error) {
    console.error("Payment error:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// Cancel Room Booking
exports.cancelRoomBooking = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (!order.stay?.enabled) {
      return res.status(400).json({
        message: "Not a room booking",
      });
    }

    const restaurant = await Restaurant.findById(
      order.source.restaurantId
    );

    if (!restaurant) {
      return res.status(404).json({
        message: "Restaurant not found",
      });
    }

    let roomUnit = null;

    for (const section of restaurant.sections) {
      const unit = section.units.id(
        order.source.unitId
      );

      if (unit) {
        roomUnit = unit;
        break;
      }
    }

    if (!roomUnit) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    // Save checkout history in order
    order.stay.checkOutTime = new Date();

    // Mark booking cancelled
    order.items = [];
    order.subtotal = 0;
    order.gstAmount = 0;
    order.totalAmount = 0;
    order.status = "cancelled";

    await order.save();

    // Free room
    roomUnit.status = "AVAILABLE";
    roomUnit.currentOrderId = null;

    // Clear live occupancy
    roomUnit.occupancy = {
      checkInTime: null,
      checkOutTime: null,
    };

    await restaurant.save();

    occupancyEmitter.emit("occupancyChanged", {
      action: "ROOM_CANCELLED",
      unitId: roomUnit._id,
      unitName: roomUnit.name,
      type: "ROOM",
      status: roomUnit.status,
      currentOrderId: null,
    });

    return res.status(200).json({
      message: "Room booking cancelled successfully",
    });

  } catch (error) {
    console.error("Cancel room booking error:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};
