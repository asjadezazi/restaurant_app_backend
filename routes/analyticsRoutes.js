// routes/analytics.js
const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const  analyticsController = require("../controllers/analyticsController");

router.get("/insights", authenticate, analyticsController.getRestaurantInsights);
router.get("/top-products", authenticate, analyticsController.getTopSellingProducts);
router.get("/top-categories", authenticate, analyticsController.getTopSellingCategories);

module.exports = router;
