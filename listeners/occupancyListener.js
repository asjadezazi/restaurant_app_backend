// listeners/occupancyListener.js

const occupancyEmitter = require("../events/occupancyEvents");
const { sendEvent } = require("../utils/sseManager");

occupancyEmitter.on("occupancyChanged", (payload) => {
  sendEvent("OCCUPANCY_CHANGED", payload);
});