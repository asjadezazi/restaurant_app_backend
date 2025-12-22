const Order = require("../models/Order");

// Get Revenue Details
exports.getRestaurantInsights = async (req, res) => {
  try {
    const user = req.user; // from JWT auth
    const { from, to, range } = req.query;

    const now = new Date();

    const parseDate = (input, isEndOfDay = false) => {
      if (!input) return null;
      const date = new Date(input);
      if (isNaN(date)) return null;
      if (isEndOfDay) date.setUTCHours(23, 59, 59, 999);
      else date.setUTCHours(0, 0, 0, 0);
      return date;
    };

    let fromDate, toDate;
    toDate = parseDate(to, true) || now;

    if (from) {
      fromDate = parseDate(from);
    } else {
      switch (range) {
        case "1d": fromDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); break;
        case "7d": fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case "15d": fromDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); break;
        case "30d": fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        case "6m": {
          const sixMonthsAgo = new Date(now);
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          fromDate = sixMonthsAgo;
          break;
        }
        case "1y": {
          const oneYearAgo = new Date(now);
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          fromDate = oneYearAgo;
          break;
        }
        default: fromDate = new Date(0); // all time
      }
    }

    //  AGGREGATION PIPELINE
    const insights = await Order.aggregate([
      {
        $match: {
          user: user._id,
          status: "completed",
          createdAt: { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $addFields: {
          revenue: {
            $cond: [
              { $ifNull: ["$totalAmount", false] },
              "$totalAmount",
              {
                $cond: [
                  { $ifNull: ["$totalPrice", false] },
                  "$totalPrice",
                  {
                    $sum: {
                      $map: {
                        input: "$items",
                        as: "i",
                        in: { $multiply: ["$$i.price", "$$i.quantity"] },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
      { $sort: { createdAt: 1 } },
      {
        $project: {
          _id: 0,
          revenue: 1,
          createdAt: 1,
          formattedDate: {
            $dateToString: {
              date: "$createdAt",
              format: "%Y-%m-%d %H:%M",
              timezone: "UTC",
            },
          },
        },
      },
    ]);

    const totalOrders = insights.length;
    const totalRevenue = insights.reduce((a, b) => a + b.revenue, 0);

    const chartData = insights.map((i) => ({
      date: i.formattedDate,
      revenue: i.revenue,
    }));

    res.status(200).json({
      totalOrders,
      totalRevenue,
      chartData,
      from: fromDate,
      to: toDate,
    });
  } catch (err) {
    console.error("Restaurant insights error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get Top Selling Products
exports.getTopSellingProducts = async (req, res) => {
  try {
    const user = req.user; // from JWT auth
    const { from, to, range } = req.query;

    const now = new Date();

    const parseDate = (input, isEndOfDay = false) => {
      if (!input) return null;
      const date = new Date(input);
      if (isNaN(date)) return null;
      if (isEndOfDay) date.setUTCHours(23, 59, 59, 999);
      else date.setUTCHours(0, 0, 0, 0);
      return date;
    };

    let fromDate, toDate;
    toDate = parseDate(to, true) || now;

    if (from) {
      fromDate = parseDate(from);
    } else {
      switch (range) {
        case "1d": fromDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); break;
        case "7d": fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case "15d": fromDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); break;
        case "30d": fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        case "6m": {
          const sixMonthsAgo = new Date(now);
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          fromDate = sixMonthsAgo;
          break;
        }
        case "1y": {
          const oneYearAgo = new Date(now);
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          fromDate = oneYearAgo;
          break;
        }
        default: fromDate = new Date(0); // all time
      }
    }

    const pipeline = [
      {
        $match: {
          user: user._id,
          status: "completed",
          createdAt: { $gte: fromDate, $lte: toDate },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            product: "$items.name",
          },
          totalQuantity: { $sum: "$items.quantity" },
          totalSales: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { "_id.date": 1, totalQuantity: -1 } },
      {
        $group: {
          _id: "$_id.date",
          topProduct: { $first: "$_id.product" },
          totalQuantity: { $first: "$totalQuantity" },
          totalSales: { $first: "$totalSales" },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const result = await Order.aggregate(pipeline);

    return res.status(200).json({
      from: fromDate,
      to: toDate,
      totalDays: result.length,
      chartData: result.map(r => ({
        date: r._id,
        topProduct: r.topProduct,
        totalQuantity: r.totalQuantity,
        totalSales: r.totalSales,
      })),
    });
  } catch (err) {
    console.error("Error fetching top products:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get Top Selling Categories
exports.getTopSellingCategories = async (req, res) => {
  try {
    const user = req.user;
    const { from, to, range } = req.query;

    const now = new Date();

    const parseDate = (input, isEndOfDay = false) => {
      if (!input) return null;
      const date = new Date(input);
      if (isNaN(date)) return null;
      if (isEndOfDay) date.setUTCHours(23, 59, 59, 999);
      else date.setUTCHours(0, 0, 0, 0);
      return date;
    };

    let fromDate, toDate;
    toDate = parseDate(to, true) || now;

    if (from) {
      fromDate = parseDate(from);
    } else {
      switch (range) {
        case "1d": fromDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); break;
        case "7d": fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case "15d": fromDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); break;
        case "30d": fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        case "6m": {
          const sixMonthsAgo = new Date(now);
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          fromDate = sixMonthsAgo;
          break;
        }
        case "1y": {
          const oneYearAgo = new Date(now);
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          fromDate = oneYearAgo;
          break;
        }
        default: fromDate = new Date(0);
      }
    }

    const pipeline = [
      {
        $match: {
          user: user._id,
          status: "completed",
          createdAt: { $gte: fromDate, $lte: toDate },
        },
      },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "menuitems",
          localField: "items.menuItemId",
          foreignField: "_id",
          as: "menuItem",
        },
      },
      { $unwind: "$menuItem" },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            category: "$menuItem.category",
          },
          totalQuantity: { $sum: "$items.quantity" },
          totalSales: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { "_id.date": 1, totalQuantity: -1 } },
      {
        $group: {
          _id: "$_id.date",
          topCategory: { $first: "$_id.category" },
          totalQuantity: { $first: "$totalQuantity" },
          totalSales: { $first: "$totalSales" },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const result = await Order.aggregate(pipeline);

    res.status(200).json({
      from: fromDate,
      to: toDate,
      totalDays: result.length,
      chartData: result.map(r => ({
        date: r._id,
        topCategory: r.topCategory,
        totalQuantity: r.totalQuantity,
        totalSales: r.totalSales,
      })),
    });
  } catch (err) {
    console.error("Error fetching top categories:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};