const orderEmitter = require('../events/orderEvents');
const { sendEvent } = require('../utils/sseManager');

// New Order
orderEmitter.on('orderCreated', (order) => {
  sendEvent("NEW_ORDER", order);
});

// Any update (status, items, etc.)
orderEmitter.on('orderUpdated', (order) => {
  sendEvent("ORDER_UPDATED", order);
});