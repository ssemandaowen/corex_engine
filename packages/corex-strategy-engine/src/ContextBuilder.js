"use strict";

const ta = require("./ta");
const util = require("./util");

class ContextBuilder {
    constructor(strategy, indicatorManager) {
        this.strategy = strategy;
        this.indicatorManager = indicatorManager;
        this._initialized = false;
        this._ctx = null;
        this._symbol = "";
        this._close = 0;
        this._price = 0;
    }

    ensureInitialized() {
        if (this._initialized) return;
        this._initialized = true;
        this._buildPersistentCtx();
    }

    _buildPersistentCtx() {
        const s = this.strategy;
        const ctx = {};

        ctx.position = {
            side: "FLAT",
            entryPrice: 0,
            size: 0,
            unrealizedPnL: 0
        };

        ctx.engine = {
            mode: (s.env && s.env.mode) || "UNKNOWN",
            barsReceived: 0,
            connected: true
        };

        ctx.params = s.params;
        ctx.state = s.state;

        ctx.indicators = this._buildIndicatorsObj();

        ctx.ta = ta;
        ctx.util = util;

        ctx.symbol = s.symbols && s.symbols[0] ? s.symbols[0] : "";

        ctx.price = 0;
        ctx.close = 0;
        ctx.time = 0;
        ctx.isBar = false;
        ctx.barTime = 0;

        ctx.go = {};
        this._wireGoCommands(ctx);

        ctx.hasBars = (count = 1, symbol = ctx.symbol) => {
            const sym = symbol || ctx.symbol;
            if (s.dataManager && typeof s.dataManager.isWarmedUp === "function") {
                return s.dataManager.isWarmedUp(sym, count);
            }
            const series = typeof s.series === "function" ? s.series(sym, "close", count) : [];
            return series.length >= count;
        };

        ctx.requireBars = (count = 1, indicatorName = null, symbol = ctx.symbol) => {
            const sym = symbol || ctx.symbol;
            if (!ctx.hasBars(count, sym)) return false;
            if (indicatorName) {
                const ind = ctx.indicators && ctx.indicators[indicatorName];
                if (!ind || ind.ready !== true) return false;
            } else if (ctx.indicators) {
                for (const ind of Object.values(ctx.indicators)) {
                    if (ind && typeof ind.ready === "boolean" && !ind.ready) {
                        return false;
                    }
                }
            }
            return true;
        };

        ctx.plot = (name, value) => {
            if (s.plotBuffer && typeof s.plotBuffer.plot === "function") {
                s.plotBuffer.plot(name, value, ctx.time || Date.now());
            }
        };

        ctx.mark = (name, message) => {
            if (s.plotBuffer && typeof s.plotBuffer.mark === "function") {
                s.plotBuffer.mark(name, message, ctx.time || Date.now());
            }
        };

        this._ctx = ctx;
    }

    _buildIndicatorsObj() {
        const obj = {};
        if (!this.indicatorManager) return obj;
        for (const name of this.indicatorManager.indicatorNames) {
            obj[name] = this.indicatorManager.getIndicatorValue(name);
        }
        return obj;
    }

    _wireGoCommands(ctx) {
        const s = this.strategy;

        ctx.go.long = function goLong(qty, price) {
            const q = qty == null ? 1 : qty;
            const p = price != null ? price : ctx.close;
            return s.buy({ quantity: q, price: p, symbol: ctx.symbol });
        };

        ctx.go.short = function goShort(qty, price) {
            const q = qty == null ? 1 : qty;
            const p = price != null ? price : ctx.close;
            return s.sell({ quantity: q, price: p, symbol: ctx.symbol });
        };

        ctx.go.scale = function goScale(qty, price) {
            const q = qty == null ? 1 : qty;
            const p = price != null ? price : ctx.close;
            return s.buy({ quantity: q, price: p, symbol: ctx.symbol, allowScaling: true });
        };

        ctx.go.protect = function goProtect(opts) {
            const o = opts || {};
            return { intent: "PROTECT", sl: o.sl, tp: o.tp, trailPct: o.trailPct, symbol: ctx.symbol };
        };
    }

    _createFlatHandler(ctx) {
        const s = this.strategy;
        return function flat(qty, price) {
            const params = { symbol: ctx.symbol };
            if (qty != null) params.quantity = qty;
            if (price != null) params.price = price;
            return s.close(params);
        };
    }

    _updatePosition(symbol) {
        const pos = this.strategy.positions && this.strategy.positions.get ? this.strategy.positions.get(symbol) : null;
        const p = this._ctx.position;
        p.side = (pos && pos.side) || "FLAT";
        p.entryPrice = (pos && (pos.entryPrice || pos.avgEntryPrice)) || 0;
        p.size = (pos && (pos.quantity || pos.size)) || 0;
        p.unrealizedPnL = (pos && pos.unrealizedPnL) || 0;
    }

    _updateEngine() {
        const e = this._ctx.engine;
        e.mode = (this.strategy.env && this.strategy.env.mode) || e.mode;
        e.barsReceived = this.strategy.currentBar ? 1 : 0;
        e.connected = true;
    }

    updateForPacket(packet, isBar) {
        this.ensureInitialized();

        const s = this.strategy;
        const symbol = packet.symbol || (s.symbols && s.symbols[0]) || "";
        const price = packet.price ?? packet.close ?? 0;
        const high = packet.high ?? price;
        const low = packet.low ?? price;
        const close = packet.close ?? price;

        this._ctx.symbol = symbol;
        this._ctx.price = price;
        this._ctx.close = close;
        this._ctx.time = packet.time;
        this._ctx.isBar = isBar;
        this._ctx.barTime = isBar ? packet.time : (s.currentBar && s.currentBar.time) || 0;

        this._symbol = symbol;
        this._close = close;
        this._price = price;

        this._updatePosition(symbol);
        this._updateEngine();

        if (this.indicatorManager) {
            this.indicatorManager.updateIndicators(packet);
        }

        return this._ctx;
    }

    buildContext(packet, isBar) {
        this.ensureInitialized();
        this.updateForPacket(packet, isBar);
        return this._ctx;
    }

    get ctx() {
        return this._ctx;
    }
}

module.exports = { ContextBuilder };
