const EventEmitter = require('events');
const { EVENTS } = require('@config/constants');

class EventBus extends EventEmitter { }

const bus = new EventBus();

module.exports = {
  bus,
  EVENTS
};
