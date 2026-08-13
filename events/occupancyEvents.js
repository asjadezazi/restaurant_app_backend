// events/occupancyEvents.js

const EventEmitter = require("events");

class OccupancyEmitter extends EventEmitter {}

module.exports = new OccupancyEmitter();