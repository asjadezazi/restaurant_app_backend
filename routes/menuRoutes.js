// routes/menuRoutes.js
const express = require("express");
const router = express.Router();
const menuController = require("../controllers/menuController");
const upload = require("../middleware/multer")
const { authenticate } = require("../middleware/authMiddleware")
const getTenant = require("../middleware/tenantMiddleware")
const { authorizeRoles } =  require("../middleware/roleMiddleware")

router.get("/public", getTenant, menuController.getMenuByTenant)
router.get("/", authenticate, authorizeRoles("admin","staff"), menuController.getMenuItems);
router.post("/", authenticate, upload.single('file'), authorizeRoles("admin"), menuController.addMenuItems);
router.put("/:id", authenticate, upload.single('file'), authorizeRoles("admin"), menuController.updateMenuItem);
router.delete("/:id", authenticate, authorizeRoles("admin"), menuController.deleteMenuItem);


module.exports = router;
