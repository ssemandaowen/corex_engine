const EventEmitter = require("events");
const { EVENTS } = require("@config/constants");

class EventBus extends EventEmitter { }

const bus = new EventBus();
// CoreX is intentionally event-heavy; raise the default limit to avoid noisy warnings.
bus.setMaxListeners(Number(process.env.COREX_BUS_MAX_LISTENERS || 1000));

module.exports = {
    bus,
    EVENTS
};
