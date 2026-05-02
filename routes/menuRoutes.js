// routes/menuRoutes.js
const express = require("express");
const router = express.Router();
const menuController = require("../controllers/menuController");
const upload = require("../middleware/multer");
const { authenticate } = require("../middleware/authMiddleware");
const getTenant = require("../middleware/tenantMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

/**
 * ===========================
 * Client (Public) Routes
 * ===========================
 */

// Get menu items for client (tenant middleware)
router.get(
  "/public",
  getTenant,
  menuController.getMenuByTenant
);

/**
 * ===========================
 * Admin/Staff (JWT Protected) Routes
 * ===========================
 */

// Get all menu items for admin or staff
router.get(
  "/",
  authenticate,
  authorizeRoles("admin", "staff"),
  menuController.getMenuItems
);

// Add a new menu item (admin only, with file upload)
router.post(
  "/",
  authenticate,
  upload.single("file"),
  authorizeRoles("admin"),
  menuController.addMenuItems
);

// Reorder menu items (admin only)
router.post(
  "/reorder-menuitems",
  authenticate,
  authorizeRoles("admin"),
  menuController.reorderMenuItems
);

// Update a menu item by ID (admin only, with file upload)
router.put(
  "/:id",
  authenticate,
  upload.single("file"),
  authorizeRoles("admin"),
  menuController.updateMenuItem
);

// Delete a menu item by ID (admin only)
router.delete(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  menuController.deleteMenuItem
);

module.exports = router;