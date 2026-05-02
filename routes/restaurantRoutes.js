const express = require("express");
const router = express.Router();
const restaurantController = require("../controllers/restaurantController");
const getTenant = require("../middleware/tenantMiddleware");
const { authenticate } = require("../middleware/authMiddleware");
const upload = require("../middleware/multer");
const { authorizeRoles } = require("../middleware/roleMiddleware");

/**
 * ===========================
 * Client (Public) Routes
 * ===========================
 */

// Get restaurant details for client (tenant middleware)
router.get(
  "/public",
  getTenant,
  restaurantController.getRestaurantDetails
);

/**
 * ===========================
 * Admin/Staff (JWT Protected) Routes
 * ===========================
 */

// Get logged-in admin or staff's restaurant details
router.get(
  "/admin",
  authenticate,
  authorizeRoles("admin", "staff"),
  restaurantController.getMyRestaurantDetails
);

// Update restaurant details (admin only, with file upload)
router.put(
  "/",
  authenticate,
  upload.single("file"),
  authorizeRoles("admin"),
  restaurantController.updateRestaurantDetails
);

// Update GST settings (admin only)
router.patch(
  "/gst",
  authenticate,
  authorizeRoles("admin"),
  restaurantController.updateGstSettings
);

// Update restaurant open/close status (admin only)
router.patch(
  "/status",
  authenticate,
  authorizeRoles("admin"),
  restaurantController.updateRestaurantStatus
);

// Soft delete restaurant (admin only)
router.delete(
  "/",
  authenticate,
  authorizeRoles("admin"),
  restaurantController.deleteRestaurant
);

// Reorder categories (admin only)
router.post(
  "/reorder-categories",
  authenticate,
  authorizeRoles("admin"),
  restaurantController.reorderCategories
);

module.exports = router;