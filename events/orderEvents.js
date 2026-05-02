const EventEmitter = require('events');

class OrderEmitter extends EventEmitter {}

module.exports = new OrderEmitter();