const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const calculateDiscountedPrice = require("../utils/calculateDiscountedPrice");
const normalizeDiscount = require("../utils/normalizeDiscount");

exports.createOrderService = async ({
  tenantAdminId,
  fingerPrint,
  customerName,
  customerPhone,
  items,
  source, // ✅ NEW
  orderType,
  address,
  createdBy,
  createdByRole = "user",
}) => {
  if (!tenantAdminId) {
    throw new Error("Restaurant/admin not found");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Order must contain at least one item.");
  }

  // 1 Fetch menu items
  const menuItems = await MenuItem.find({
    _id: { $in: items.map((i) => i.menuItemId) },
    deleted: false,
    available: true,
  });

  let subtotal = 0;
  const orderItems = [];

  // 2 SAME LOOP
  for (const item of items) {
    const menuItem = await MenuItem.findOne({
      _id: item.menuItemId,
      deleted: false,
      available: true,
    });

    if (!menuItem) {
      throw new Error(`Item not available: ${item.menuItemId}`);
    }

    const quantity = Number(item.quantity) || 1;
    let basePrice;
    let discountedPrice = 0;
    let discountSnapshot = null;
    let variant = null;

    if (menuItem.pricingType === "single") {
      basePrice = Number(menuItem.price) || 0;
      const discountObj = normalizeDiscount(menuItem.discount);
      discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
      discountSnapshot = discountObj;
    } else if (menuItem.pricingType === "variant") {
      const variantKey = item.variant?.toLowerCase();
      if (!variantKey || !menuItem.variantRates[variantKey]) {
        throw new Error(`Invalid variant for ${menuItem.name}`);
      }

      const variantData = menuItem.variantRates[variantKey];
      basePrice = Number(variantData.price) || 0;
      const discountObj = normalizeDiscount(variantData.discount);
      discountedPrice = calculateDiscountedPrice(basePrice, discountObj);
      discountSnapshot = discountObj;
      variant = variantKey;
    } else if (menuItem.pricingType === "combo") {
      basePrice = Number(menuItem.comboPrice) || 0;
      discountedPrice = basePrice;
      discountSnapshot = { type: null, value: 0 };
    }

    subtotal += discountedPrice * quantity;

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

  // 3 GST LOGIC
  const restaurant = await Restaurant.findOne({
    user: tenantAdminId,
    deleted: false,
  });

  const gstRate = restaurant?.gstEnabled ? restaurant.gstRate : 0;
  const deliveryCharges =
    orderType === "Delivery" ? Number(restaurant?.deliveryCharges || 0) : 0;

  const gstAmount = (Number(subtotal) * (gstRate || 0)) / 100;
  const totalAmount = Number(subtotal) + Number(gstAmount) + deliveryCharges;

  const finalAddress = orderType === "Delivery" ? address : null;

  // ✅ NEW SOURCE HANDLING
  const finalSource =
    orderType === "Eat Here"
      ? {
          section: source?.section || null,
          number: source?.number || null,
          type: source?.type || "NONE",
        }
      : {
          section: null,
          number: null,
          type: "NONE",
        };

  // ✅ CREATE ORDER
  const order = await Order.create({
    user: tenantAdminId,

    createdBy: createdBy || null,
    createdByRole,

    fingerPrint,
    customerName,
    customerPhone,
    items: orderItems,
    subtotal,
    gstRate,
    gstAmount,
    deliveryCharges,
    totalAmount,

    // ✅ REPLACED tableId
    source: finalSource,

    orderType,
    address: finalAddress,
  });

  return order;
};