// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { authenticate } = require("../middleware/authMiddleware")
const getTenant = require("../middleware/tenantMiddleware")

// Create order client (public)
router.post("/", getTenant, orderController.createOrder);
// Get order client (public)
router.get("/fingerprint", orderController.getOrdersByFingerPrint);
// Get order admin
router.get("/", authenticate, orderController.getAllOrders);
// Update order
router.put("/:orderId", orderController.updateOrder);
// Cancel order
router.delete("/:orderId", orderController.cancelOrder);


// Update order status
// router.patch("/:orderId", orderController.updateOrderStatus);

module.exports = router;