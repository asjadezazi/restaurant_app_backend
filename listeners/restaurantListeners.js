const restaurantEmitter = require("../events/restaurantEvents");
const { sendEvent } = require("../utils/sseManager");

// Restaurant updated
restaurantEmitter.on("restaurantUpdated", (restaurant) => {
  sendEvent("RESTAURANT_UPDATED", restaurant);
});

// Restaurant deleted
restaurantEmitter.on("restaurantDeleted", (restaurant) => {
  sendEvent("RESTAURANT_DELETED", restaurant);
});
