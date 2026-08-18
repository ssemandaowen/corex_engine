const { bus, EVENTS } = require("@events/bus");
const PaperBroker = require("@broker/modes/PaperBroker");

bus.on(EVENTS.BROKER.STATE_CHANGED, (payload) => {
    console.log("EVENT_EMIT:", payload);
});

const b = new PaperBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", mode: "paper" });
console.log("broker.mode=", b.mode);
console.log("call setCash ->", b.setCash(500));
console.log("call setInitialCash ->", b.setInitialCash(1000));
console.log("call updateConfig ->", b.updateConfig({ foo: "bar" }));
console.log("call resetAccount ->");
b.resetAccount(200);
setTimeout(() => process.exit(0), 100);
