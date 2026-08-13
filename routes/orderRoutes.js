// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { authenticate } = require("../middleware/authMiddleware");
const getTenant = require("../middleware/tenantMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const adminOrStaff = authorizeRoles("admin", "staff");

// Public routes (no auth required) 

// Create a new order (initiated by a client/guest)
router.post("/", getTenant, orderController.createOrder);

// Fetch the latest orders tied to the caller's browser fingerprint
router.get("/fingerprint", getTenant, orderController.getLatestOrdersByFingerPrint);

// Protected routes (authentication required)

// Create an order on behalf of a client (admin / staff only)
router.post("/protected", authenticate, adminOrStaff, orderController.createOrderByAdminOrStaff);

// Retrieve all orders across the system
router.get("/", authenticate, adminOrStaff, orderController.getAllOrders);

// Get single order by ID (admin/staff)
router.get("/:orderId", authenticate, adminOrStaff, orderController.getOrderById);

// Bill a specific order (table or room)
router.post("/:orderId/bill", authenticate, adminOrStaff, orderController.billOrder);

// Payment for a specific order (table or room)
router.post("/:orderId/pay", authenticate, adminOrStaff, orderController.payOrder);

// Move an order to a different table / room (admin / staff only)
router.post("/:orderId/move", authenticate, adminOrStaff, orderController.moveOrder);

// Update order details (admin / staff only)
router.put("/:orderId", authenticate, adminOrStaff, orderController.updateOrder);

// Cancel room bookinh (admin / staff only)
router.post("/:orderId/cancel-booking", authenticate, adminOrStaff, orderController.cancelRoomBooking)

// Toggle the ready-state of a single item within an order
router.patch("/:orderId/items/:itemId/toggle-ready", authenticate, adminOrStaff, orderController.toggleItemReady);

// Cancel an order (admin / staff only)
router.delete("/:orderId", authenticate, adminOrStaff, orderController.deleteOrder);

module.exports = router;