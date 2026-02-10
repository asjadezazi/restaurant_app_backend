const express = require("express");
const router = express.Router();
const restaurantController = require("../controllers/restaurantController");
const getTenant = require("../middleware/tenantMiddleware"); 
const { authenticate } = require("../middleware/authMiddleware")
const upload = require("../middleware/multer")
const { authorizeRoles } = require("../middleware/roleMiddleware")



// Client Routes (public, tenant-based)
// Get restaurant details for client (tenant middleware)
router.get("/public", getTenant, restaurantController.getRestaurantDetails);



// Admin Routes (JWT protected)
// Get logged-in admin's restaurant details
router.get("/admin", authenticate, authorizeRoles("admin","staff"), restaurantController.getMyRestaurantDetails);
// Create/Add restaurant details
// router.post("/details", authenticate, upload.single("file"), restaurantController.addRestaurantDetails);
// Update restaurant details
router.put("/", authenticate, upload.single("file"), authorizeRoles("admin"), restaurantController.updateRestaurantDetails);
// Update GST settings
router.patch("/gst", authenticate, authorizeRoles("admin"), restaurantController.updateGstSettings)
// Update restaurant open status
router.patch("/status", authenticate, authorizeRoles("admin"), restaurantController.updateRestaurantStatus)
// Delete restaurant (soft delete)
router.delete("/", authenticate, restaurantController.deleteRestaurant)

module.exports = router;
