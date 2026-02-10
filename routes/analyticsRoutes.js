// routes/analytics.js
const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const  analyticsController = require("../controllers/analyticsController");
const { authorizeRoles } = require("../middleware/roleMiddleware")

router.get("/insights", authenticate, authorizeRoles("admin"), analyticsController.getRestaurantInsights);
router.get("/top-products", authenticate, authorizeRoles("admin"), analyticsController.getTopSellingProducts);
router.get("/top-categories", authenticate, authorizeRoles("admin"), analyticsController.getTopSellingCategories);

module.exports = router;
