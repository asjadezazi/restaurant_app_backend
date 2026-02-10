// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { authenticate } = require("../middleware/authMiddleware")
const getTenant = require("../middleware/tenantMiddleware")
const { authorizeRoles } = require("../middleware/roleMiddleware")

// Create order client (public)
router.post("/", getTenant, orderController.createOrder);
// Get order client (public)
router.get("/fingerprint", orderController.getLatestOrderByFingerPrint);
// Get order admin
router.get("/", authenticate, authenticate, orderController.getAllOrders);
// Update order
router.put("/:orderId", authenticate, authorizeRoles("admin","staff"), orderController.updateOrder);
// Cancel order
router.delete("/:orderId", authenticate, authorizeRoles("admin","staff"), orderController.cancelOrder);


// Update order status
// router.patch("/:orderId", orderController.updateOrderStatus);

module.exports = router;