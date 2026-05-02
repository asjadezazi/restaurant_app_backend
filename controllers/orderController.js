// controllers/orderController.js
const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const orderEmitter = require("../events/orderEvents");
const calculateDiscountedPrice = require("../utils/calculateDiscountedPrice");
const normalizeDiscount = require("../utils/normalizeDiscount");

// Create Order ( Client, via tenantMiddleware)
exports.createOrder = async (req, res) => {
  try {
    const { tenantAdminId } = req;
    if (!tenantAdminId) {
      return res.status(404).json({ message: "Restaurant/admin not found" });
    }

    const {
      fingerPrint,
      customerName,
      customerPhone,
      items,
      tableId,
      orderType,
      address,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "Order must contain at least one item." });
    }

    // 1 Fetch menu items
    const menuItems = await MenuItem.find({
      _id: { $in: items.map((i) => i.menuItemId) },
      deleted: false,
      available: true,
    });

    let subtotal = 0;
    const orderItems = [];

    // 2 Build order items safely
    for (const item of items) {
      const menuItem = await MenuItem.findOne({
        _id: item.menuItemId,
        deleted: false,
        available: true,
      });

      if (!menuItem) {
        return res.status(400).json({
          message: `Item not available: ${item.menuItemId}`
        });
      }

      const quantity = Number(item.quantity) || 1;
      let basePrice;
      let discountedPrice = 0;
      let discountSnapshot = null;
      let variant = null;

      // ---- SINGLE PRICING ----
      if (menuItem.pricingType === "single") {
        basePrice = Number(menuItem.price) || 0;
        const discountObj = normalizeDiscount(menuItem.discount);
        discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
        discountSnapshot = discountObj;
      }
      // ---- VARIANT PRICING ----
      else if (menuItem.pricingType === "variant") {
        const variantKey = item.variant?.toLowerCase();
        if (!variantKey || !menuItem.variantRates[variantKey]) {
          return res
            .status(400)
            .json({ message: `Invalid variant for ${menuItem.name}` });
        }

        const variantData = menuItem.variantRates[variantKey];
        basePrice = Number(variantData.price) || 0;
        const discountObj = normalizeDiscount(variantData.discount);
        discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
        discountSnapshot = discountObj;
        variant = variantKey;
      }
      // ---- COMBO PRICING ----
      else if (menuItem.pricingType === "combo") {
        basePrice = Number(menuItem.comboPrice) || 0;
        discountedPrice = basePrice;
        discountSnapshot = {
          type: null,
          value: 0,
        };
      }

      // Add to subtotal safely
      subtotal += discountedPrice * quantity;

      // Push item to order
      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        variant,
        quantity,
        price: basePrice,
        discountedPrice,
        discountApplied: discountSnapshot,
        customizations: item.customizations || "",
      });
    }

    // 3 GST and Delivery Charges calculation
    const restaurant = await Restaurant.findOne({
      user: tenantAdminId,
      deleted: false,
    });

    const gstRate = restaurant?.gstEnabled ? restaurant.gstRate : 0;
    const deliveryCharges =
      orderType === "Delivery" ? Number(restaurant?.deliveryCharges || 0) : 0;

    const gstAmount = (Number(subtotal) * (gstRate || 0)) / 100;
    const totalAmount = Number(subtotal) + Number(gstAmount) + deliveryCharges;

    // 4 OrderType cleanup
    const finalTableId = orderType === "Eat Here" ? tableId : null;
    const finalAddress = orderType === "Delivery" ? address : null;

    // 5 Create Order
    const order = await Order.create({
      user: tenantAdminId,
      fingerPrint,
      customerName,
      customerPhone,
      items: orderItems,
      subtotal,
      gstRate,
      gstAmount,
      deliveryCharges,
      totalAmount,
      tableId: finalTableId,
      orderType,
      address: finalAddress,
    });
    orderEmitter.emit("orderCreated", order);

    res.status(201).json({ message: "Order placed successfully", order });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get All Orders ( Admin, JWT Protected)
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

// Get Orders by fingerprint
exports.getLatestOrderByFingerPrint = async (req, res) => {
  try {
    const { fingerPrint } = req.query;
    const { tenantAdminId } = req; // coming from tenant middleware

    if (!fingerPrint) {
      return res.status(400).json({ message: "fingerPrint is required" });
    }

    if (!tenantAdminId) {
      return res.status(400).json({ message: "Tenant not found" });
    }

    // Fetch only the latest order for this fingerprint AND this restaurant
    const latestOrder = await Order.findOne({
      fingerPrint,
      user: tenantAdminId,
    })
      .sort({ createdAt: -1 }) // newest first
      .lean();

    if (!latestOrder) {
      return res
        .status(404)
        .json({ message: "No orders found for this fingerprint" });
    }

    res.status(200).json({ order: latestOrder });
  } catch (error) {
    console.error("Get latest order by fingerprint error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update an Order using id from params, Admin
exports.updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;

    const ALLOWED_ORDER_TYPES = ["Eat Here", "Take Away", "Delivery"];
    const SIMPLE_FIELDS = ["tableId", "address", "orderType"];

    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // HARD LOCK
    if (["completed", "cancelled"].includes(existingOrder.status)) {
      return res.status(400).json({
        message: `Cannot modify ${existingOrder.status} order`,
      });
    }

    const updatePayload = {};

    // =====================================
    // VALIDATE ORDER TYPE
    // =====================================
    if (updates.orderType && !ALLOWED_ORDER_TYPES.includes(updates.orderType)) {
      return res.status(400).json({ message: "Invalid orderType" });
    }

    SIMPLE_FIELDS.forEach((field) => {
      if (updates[field] !== undefined) {
        updatePayload[field] = updates[field];
      }
    });

    // =====================================
    // ORDER TYPE RULES
    // =====================================
    if (updates.orderType === "Delivery" && !updates.address) {
      return res.status(400).json({ message: "Address required for Delivery" });
    }

    if (updates.orderType === "Eat Here" && !updates.tableId) {
      return res.status(400).json({ message: "Table ID required for Eat Here" });
    }

    if (updates.orderType === "Take Away") {
      updatePayload.tableId = null;
      updatePayload.address = null;
    }

    // =====================================
    // BASE ITEMS (PLAIN)
    // =====================================
    let baseItems = existingOrder.items.map(i => i.toObject());

    const existingItemMap = new Map(
      existingOrder.items.map(i => [i.menuItemId.toString(), i])
    );

    // =====================================
    // REMOVE ITEMS
    // =====================================
    if (Array.isArray(updates.removeItemIds) && updates.removeItemIds.length) {
      baseItems = baseItems.filter(
        item => !updates.removeItemIds.includes(item._id.toString())
      );
    }

    // =====================================
    // ADD / REPLACE ITEMS
    // =====================================
    if (Array.isArray(updates.items)) {
      const replaceMode = updates.replaceItems === true;

      if (replaceMode) {
        baseItems = []; // prevent duplicates
      }

      const menuItems = await MenuItem.find({
        _id: { $in: updates.items.map(i => i.menuItemId) },
        deleted: false,
        available: true,
      });

      const menuMap = new Map(menuItems.map(m => [m._id.toString(), m]));

      for (const item of updates.items) {
        const menuItem = menuMap.get(item.menuItemId);

        if (!menuItem) {
          return res.status(400).json({
            message: `Item not available: ${item.menuItemId}`,
          });
        }

        let price = 0;
        let discountedPrice = 0;
        let discountApplied = null;
        let variant = null;

        if (menuItem.pricingType === "single") {
          price = Number(menuItem.price);
          discountedPrice = price;
          discountApplied = menuItem.discount || { type: null, value: 0 };
        }

        if (menuItem.pricingType === "variant") {
          const key = item.variant?.toLowerCase();
          const variantData = menuItem.variantRates?.[key];

          if (!variantData) {
            return res.status(400).json({
              message: `Invalid variant for ${menuItem.name}`,
            });
          }

          price = Number(variantData.price);
          discountedPrice = price;
          discountApplied = variantData.discount || { type: null, value: 0 };
          variant = key;
        }

        if (menuItem.pricingType === "combo") {
          price = Number(menuItem.comboPrice);
          discountedPrice = price;
          discountApplied = { type: null, value: 0 };
        }

        const existing = existingItemMap.get(item.menuItemId);

        baseItems.push({
          menuItemId: menuItem._id,
          name: menuItem.name,
          variant,
          quantity: Number(item.quantity || 1),
          price,
          discountedPrice,
          discountApplied,
          customizations: item.customizations || "",
          isReady: existing?.isReady || false, // preserve state
        });
      }
    }

    // =====================================
    // STATUS CONTROL
    // =====================================
    const manualStatus = updates.status;

    if (manualStatus) {
      updatePayload.status = manualStatus;
    } else {
      const total = baseItems.length;
      const ready = baseItems.filter(i => i.isReady).length;

      if (ready === 0) updatePayload.status = "pending";
      else if (ready < total) updatePayload.status = "preparing";
      else updatePayload.status = "ready";
    }

    // =====================================
    // CRITICAL: SYNC ITEMS WITH STATUS
    // =====================================
    if (["ready", "completed"].includes(updatePayload.status)) {
      baseItems = baseItems.map(item => ({
        ...item,
        isReady: true,
      }));
    }

    if (updatePayload.status === "pending") {
      baseItems = baseItems.map(item => ({
        ...item,
        isReady: false,
      }));
    }

    // =====================================
    // TOTAL CALCULATION
    // =====================================
    let subtotal = baseItems.reduce((sum, item) => {
      const price = Number(item.discountedPrice ?? item.price);
      return sum + price * Number(item.quantity || 1);
    }, 0);

    const restaurant = await Restaurant.findOne({
      user: existingOrder.user,
      deleted: false,
    });

    const gstRate = restaurant?.gstEnabled ? restaurant.gstRate : 0;
    const gstAmount = (subtotal * gstRate) / 100;

    let deliveryCharges = 0;
    const finalOrderType = updates.orderType || existingOrder.orderType;

    if (finalOrderType === "Delivery") {
      deliveryCharges = restaurant?.deliveryCharges || 0;
    }

    Object.assign(updatePayload, {
      items: baseItems,
      subtotal,
      gstRate,
      gstAmount,
      deliveryCharges,
      totalAmount: subtotal + gstAmount + deliveryCharges,
    });

    // =====================================
    // FINAL SAFETY FOR COMPLETED
    // =====================================
    if (updatePayload.status === "completed") {
      const allReady = baseItems.every(i => i.isReady);
      if (!allReady) {
        return res.status(400).json({
          message: "Cannot complete order until all items are ready",
        });
      }
    }

    // =====================================
    // UPDATE DB
    // =====================================
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: updatePayload },
      { new: true }
    );

    // =====================================
    // EVENT
    // =====================================
    orderEmitter.emit("orderUpdated", updatedOrder);

    res.status(200).json({
      message: "Order updated successfully",
      order: updatedOrder,
    });

  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

exports.toggleItemReady = async (req, res) => {
  const { orderId, itemId } = req.params;

  const order = await Order.findById(orderId);
  if (!order) return res.status(404).send("Order not found");

  const item = order.items.find(
    i => i._id.toString() === itemId
  );

  if (!item) {
    return res.status(404).send("Item not found");
  }

  item.isReady = !item.isReady;

  // ensure mongoose detects change
  order.markModified("items");

  // recalc order status
  const allReady = order.items.every(i => i.isReady);
  order.status = allReady ? "ready" : "preparing";

  const updatedOrder = await order.save();

  orderEmitter.emit("orderUpdated", updatedOrder);

  res.json(updatedOrder);
};

// Soft Delete an order using id from params, Admin
exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findByIdAndDelete(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Admin cancelled order successfully" });
  } catch (error) {
    console.error("Error cancelling order:", error);
    res.status(500).json({ message: "Server error" });
  }
};
