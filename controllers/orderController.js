// controllers/orderController.js
const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem")

// Create Order ( Client, via tenantMiddleware)
exports.createOrder = async (req, res) => {
  try {
    const { tenantAdminId } = req;

    if (!tenantAdminId) {
      return res.status(404).json({ message: "Restaurant/admin not found" });
    }

    const { fingerPrint, customerName, customerPhone, items, tableId, orderType, address } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Order must contain at least one item." });
    }

    // Fetch all menu items (no callbacks, async/await only)
    const menuItems = await MenuItem.find({
      _id: { $in: items.map((i) => i.menuItemId) },
    });

    // Calculate subtotal and build item list
    let subtotal = 0;
    const enrichedItems = [];

    for (const item of items) {
      const menuItem = menuItems.find(
        (m) => m._id.toString() === item.menuItemId
      );

      if (!menuItem) continue;

      let itemPrice = 0;

      if (menuItem.pricingType === "single") {
        // flat price
        itemPrice = menuItem.price;
      } else if (menuItem.pricingType === "variant") {
        const variantKey = item.variant?.toLowerCase();

        if (!variantKey || !menuItem.variantRates[variantKey]) {
          return res.status(400).json({
            message: `Variant '${item.variant}' not found for ${menuItem.name}`,
          });
        }

        itemPrice = menuItem.variantRates[variantKey];
      }

      subtotal += itemPrice * item.quantity;

      enrichedItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        variant:
          menuItem.pricingType === "variant" ? item.variant : null,
        quantity: item.quantity,
        price: itemPrice,
        customizations: item.customizations
      });
    }

    // Restaurant GST logic
    const restaurant = await Restaurant.findOne({
      user: tenantAdminId,
      deleted: false,
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found." });
    }

    const gstRate = restaurant.gstEnabled ? restaurant.gstRate : 0;
    const gstAmount = (subtotal * gstRate) / 100;
    const totalAmount = subtotal + gstAmount;

    // Create order (modern async style)
    const order = await Order.create({
      user: tenantAdminId,
      fingerPrint,
      customerName,
      customerPhone,
      items: enrichedItems,
      subtotal,
      gstRate,
      gstAmount,
      totalAmount,
      tableId,
      orderType,
      address,
    });

    res.status(201).json({
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
      return res.status(400).json({ message: "Status is required and must be pending, completed, or cancelled" });
    }

    // Date range
    const now = new Date();
    let fromDate, toDate = now;

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

    const order = await Order.findByIdAndUpdate(
      orderId,
      { $set: updates },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Order updated successfully from Admin", order });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Server error" });
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
