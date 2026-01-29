// controllers/orderController.js
const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const calculateDiscountedPrice = require("../utils/calculateDiscountedPrice");

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

    // 1️⃣ Fetch menu items
    const menuItems = await MenuItem.find({
      _id: { $in: items.map((i) => i.menuItemId) },
      deleted: false,
      available: true,
    });

    let subtotal = 0;
    const orderItems = [];

    // 2️⃣ Build order items
    for (const item of items) {
      const menuItem = menuItems.find(
        (m) => m._id.toString() === item.menuItemId
      );

      if (!menuItem) {
        return res
          .status(400)
          .json({ message: "Menu item not found" });
      }

      let basePrice;
      let discountedPrice;
      let discountSnapshot = null;
      let variant = null;

       // ---- SINGLE PRICING ----
      if (menuItem.pricingType === "single") {
        basePrice = menuItem.price;

        discountedPrice = calculateDiscountedPrice(
          basePrice,
          menuItem.discount
        );

        discountSnapshot = menuItem.discount;
      }
      // ---- VARIANT PRICING ----
      else if (menuItem.pricingType === "variant") {
        const variantKey = item.variant?.toLowerCase();

        if (!variantKey || !menuItem.variantRates[variantKey]) {
          return res.status(400).json({
            message: `Invalid variant for ${menuItem.name}`,
          });
        }

        const variantData = menuItem.variantRates[variantKey];

        basePrice = variantData.price;
        discountedPrice = calculateDiscountedPrice(
          basePrice,
          variantData.discount
        );

        discountSnapshot = variantData.discount;
        variant = variantKey;
      }
      // ---- COMBO PRICING ----
      else if (menuItem.isCombo) {
        // Combo price is fixed, no discounts
        basePrice = menuItem.comboPrice;
        discountedPrice = basePrice;
        discountSnapshot = null;
      }

      subtotal += discountedPrice * item.quantity;

      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        variant,
        quantity: item.quantity,

        price: basePrice,
        discountedPrice,
        discountApplied: discountSnapshot,

        customizations: item.customizations || "",
      });
    }

    // 3️⃣ GST
    const restaurant = await Restaurant.findOne({
      user: tenantAdminId,
      deleted: false,
    });

    const gstRate = restaurant?.gstEnabled ? restaurant.gstRate : 0;
    const gstAmount = (subtotal * gstRate) / 100;
    const totalAmount = subtotal + gstAmount;

    // 4️⃣ OrderType cleanup
    const finalTableId =
      orderType === "Eat Here" ? tableId : null;

    const finalAddress =
      orderType === "Delivery" ? address : null;

    // 5️⃣ Create Order
    const order = await Order.create({
      user: tenantAdminId,
      fingerPrint,
      customerName,
      customerPhone,
      items: orderItems,
      subtotal,
      gstRate,
      gstAmount,
      totalAmount,
      tableId: finalTableId,
      orderType,
      address: finalAddress,
    });

    res.status(201).json({
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};



// Get All Orders ( Admin, JWT Protected)
exports.getAllOrders = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { status, range, page = 1, limit = 10 } = req.query;

    // Validate status
    const allowedStatus = ["pending", "completed", "cancelled"];
    if (!status || !allowedStatus.includes(status)) {
      return res.status(400).json({
        message:
          "Status is required and must be pending, completed, or cancelled",
      });
    }

    // Date range
    const now = new Date();
    let fromDate,
      toDate = now;

    switch (range) {
      case "2d":
        fromDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        break;
      case "7d":
        fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "15d":
        fromDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "6m":
        fromDate = new Date(now);
        fromDate.setMonth(fromDate.getMonth() - 6);
        break;
      case "1y":
        fromDate = new Date(now);
        fromDate.setFullYear(fromDate.getFullYear() - 1);
        break;
      case "all":
        fromDate = new Date(0);
        break;
      default:
        // Default: last 1 day for completed/cancelled, all for pending
        if (status === "pending") fromDate = new Date(0);
        else fromDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    }

    const filter = {
      user: user._id,
      status,
      createdAt: { $gte: fromDate, $lte: toDate },
    };

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const totalOrders = await Order.countDocuments(filter);
    const totalPages = Math.ceil(totalOrders / limit);

    res.status(200).json({
      totalOrders,
      totalPages,
      currentPage: parseInt(page),
      from: fromDate,
      to: toDate,
      orders,
    });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: err.message });
  }
};

// Get Orders by fingerprint
exports.getOrdersByFingerPrint = async (req, res) => {
  try {
    const { fingerPrint, page = 1, limit = 5 } = req.query;

    if (!fingerPrint) {
      return res.status(400).json({
        message: "fingerPrint is required",
      });
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find({ fingerPrint })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),

      Order.countDocuments({ fingerPrint }),
    ]);

    res.status(200).json({
      page: Number(page),
      limit: Number(limit),
      totalOrders: total,
      totalPages: Math.ceil(total / limit),
      orders,
    });
  } catch (error) {
    console.error("Get orders by fingerprint error:", error);
    res.status(500).json({
      message: "Server error",
    });
  }
};

// Update an Order using id from params, Admin
exports.updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;

    const ALLOWED_ORDER_TYPES = ["Eat Here", "Take Away", "Delivery"];
    const SIMPLE_FIELDS = ["status", "tableId", "address", "orderType"];

    // Fetch existing order (needed for items + GST calc)
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    const updatePayload = {};

    // Validate orderType (if provided)
    if (updates.orderType && !ALLOWED_ORDER_TYPES.includes(updates.orderType)) {
      return res.status(400).json({ message: "Invalid orderType" });
    }

    // Apply simple field updates
    SIMPLE_FIELDS.forEach((field) => {
      if (updates[field] !== undefined) {
        updatePayload[field] = updates[field];
      }
    });

    // Enforce orderType-specific rules
    if (updates.orderType === "Delivery") {
      if (!updates.address) {
        return res
          .status(400)
          .json({ message: "Address is required for delivery orders" });
      }
      updatePayload.tableId = null;
    }

    if (updates.orderType === "Eat Here") {
      if (!updates.tableId) {
        return res
          .status(400)
          .json({ message: "Table ID is required for Eat Here orders" });
      }
      updatePayload.address = null;
    }

    if (updates.orderType === "Take Away") {
      updatePayload.tableId = null;
      updatePayload.address = null;
    }

    // Recalculate items only if items are updated
    if (Array.isArray(updates.items)) {
      if (!updates.items.length) {
        return res
          .status(400)
          .json({ message: "Order must have at least one item" });
      }

      const menuItemIds = updates.items.map((i) => i.menuItemId);

      const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });
      const menuMap = new Map(menuItems.map((m) => [m._id.toString(), m]));

      let subtotal = 0;
      const enrichedItems = [];

      for (const item of updates.items) {
        const menuItem = menuMap.get(item.menuItemId);
        if (!menuItem) {
          return res.status(400).json({
            message: `Menu item not found: ${item.menuItemId}`,
          });
        }

        let price;

        if (menuItem.pricingType === "single") {
          price = menuItem.price;
        } else {
          const variantKey = item.variant?.toLowerCase();
          if (!variantKey || !menuItem.variantRates[variantKey]) {
            return res.status(400).json({
              message: `Invalid variant '${item.variant}' for ${menuItem.name}`,
            });
          }
          price = menuItem.variantRates[variantKey];
        }

        subtotal += price * item.quantity;

        enrichedItems.push({
          menuItemId: menuItem._id,
          name: menuItem.name,
          variant: menuItem.pricingType === "variant" ? item.variant : null,
          quantity: item.quantity,
          price,
          customizations: item.customizations || "",
        });
      }

      // GST calculation
      const restaurant = await Restaurant.findOne({
        user: existingOrder.user,
        deleted: false,
      });

      const gstRate = restaurant?.gstEnabled ? restaurant.gstRate : 0;
      const gstAmount = (subtotal * gstRate) / 100;

      Object.assign(updatePayload, {
        items: enrichedItems,
        subtotal,
        gstRate,
        gstAmount,
        totalAmount: subtotal + gstAmount,
      });
    }

    // Update order
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: updatePayload },
      { new: true }
    );

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
