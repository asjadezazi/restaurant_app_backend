const express = require("express");
const app = express();
// const cors = require("cors");

// Middleware
app.use(express.json());
// app.use(cors());    

// Route imports
const menuRoutes = require("./routes/menuRoutes");
const orderRoutes = require("./routes/orderRoutes");
const authRoutes = require("./routes/authRoutes");
const restaurantRoutes = require("./routes/restaurantRoutes")
const analyticsRoutes = require("./routes/analyticsRoutes")
const notificationRoute = require("./routes/notificationRoute")

// Mount routes
app.use("/api/menu", menuRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/restaurant", restaurantRoutes)
app.use("/api/analytics", analyticsRoutes)
app.use('/api', notificationRoute);

module.exports = app;