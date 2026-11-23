"use strict";

// Reference: Super Smoother Filter
// Source family: John Ehlers, Super Smoother Filter.
// Convention (selected): Ehlers' published recursion.
//   a = exp(-sqrt(alpha));  b = 2a
//   c = (1-a)^2 / (1 + b*cos(PI*2/4) + a^2)     [cos(PI/2) = 0]
//   d = b*a;  e = -a^2
//   y = c*(price + x2) + d*x1 - e*y1 + e*y2
//   state shifts: y2=y1, y1=y, x2=x1, x1=price
//   alpha clamped to [0.01, 1]; first price seeds all state and yields value=price, ready=true.
// Independent implementation: plain loops over an input array.
function superSmoother(prices, alpha) {
    if (!Array.isArray(prices)) throw new Error("superSmoother: prices must be an array");
    if (alpha === undefined) alpha = 0.2;
    if (alpha < 0.01 || alpha > 1) throw new Error("superSmoother: alpha must be between 0.01 and 1");
    const a = Math.exp(-Math.sqrt(alpha));
    const b = 2 * a;
    const cosTerm = Math.cos(Math.PI * 2 / 4);
    const c = ((1 - a) * (1 - a)) / (1 + b * cosTerm + a * a);
    const d = b * a;
    const e = -a * a;
    const series = [];
    let value = 0;
    let ready = false;
    let initialized = false;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < prices.length; i++) {
        const price = prices[i];
        if (!initialized) {
            x1 = price; x2 = price; y1 = price; y2 = price;
            initialized = true;
            value = price;
            ready = true;
            series.push(value);
            continue;
        }
        const y = c * (price + x2) + d * x1 - e * y1 + e * y2;
        y2 = y1;
        y1 = y;
        x2 = x1;
        x1 = price;
        value = y;
        series.push(value);
    }
    return { value, ready, series, alpha };
}
module.exports = superSmoother;
module.exports.SuperSmoother = superSmoother;
