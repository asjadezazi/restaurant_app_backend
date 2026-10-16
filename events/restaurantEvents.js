// emitters/restaurantEvents.js

const EventEmitter = require("events");

class RestaurantEmitter extends EventEmitter {}

module.exports = new RestaurantEmitter();