"use strict";

class PlotBuffer {
    constructor({ maxSeriesCount = 20, maxPointsPerSeries = 1000, maxMarks = 200 } = {}) {
        this.maxSeriesCount = maxSeriesCount;
        this.maxPointsPerSeries = maxPointsPerSeries;
        this.maxMarks = maxMarks;

        this.seriesMap = new Map();
        this._lastName = null;
        this._lastSeries = null;
        
        this.marks = new Array(maxMarks);
        this.marksSize = 0;
        this.marksWriteIndex = 0;
        this.marksTotalWritten = 0;
        this.marksLastReadTotal = 0;
    }

    _getOrCreateSeries(name) {
        if (name === this._lastName && this._lastSeries) {
            return this._lastSeries;
        }
        let series = this.seriesMap.get(name);
        if (!series) {
            if (this.seriesMap.size >= this.maxSeriesCount) {
                throw new Error(`[PlotBuffer] Maximum series count (${this.maxSeriesCount}) exceeded for series '${name}'.`);
            }
            series = {
                time: new Float64Array(this.maxPointsPerSeries),
                value: new Float64Array(this.maxPointsPerSeries),
                size: 0,
                writeIndex: 0,
                totalWritten: 0,
                lastReadTotal: 0
            };
            this.seriesMap.set(name, series);
        }
        this._lastName = name;
        this._lastSeries = series;
        return series;
    }

    plot(name, value, time = Date.now()) {
        const val = Number(value);
        if (!Number.isFinite(val)) return;
        const t = Number(time);
        const timestamp = Number.isFinite(t) ? t : Date.now();

        const series = this._getOrCreateSeries(name);
        const idx = series.writeIndex;
        series.time[idx] = timestamp;
        series.value[idx] = val;

        series.writeIndex = (series.writeIndex + 1) % this.maxPointsPerSeries;
        if (series.size < this.maxPointsPerSeries) {
            series.size++;
        }
        series.totalWritten++;
    }

    mark(name, message, time = Date.now()) {
        const t = Number(time);
        const timestamp = Number.isFinite(t) ? t : Date.now();
        const msg = String(message || "");

        const idx = this.marksWriteIndex;
        this.marks[idx] = { time: timestamp, name: String(name), message: msg };
        this.marksWriteIndex = (this.marksWriteIndex + 1) % this.maxMarks;
        if (this.marksSize < this.maxMarks) {
            this.marksSize++;
        }
        this.marksTotalWritten++;
    }

    getPlotDelta() {
        const seriesDelta = {};

        for (const [name, series] of this.seriesMap) {
            const unreadCount = series.totalWritten - series.lastReadTotal;
            if (unreadCount <= 0) continue;

            const count = Math.min(this.maxPointsPerSeries, unreadCount);
            const points = new Array(count);
            const capacity = this.maxPointsPerSeries;
            const writeIdx = series.writeIndex;

            for (let i = 0; i < count; i++) {
                const idx = (writeIdx - count + i + capacity) % capacity;
                points[i] = {
                    time: series.time[idx],
                    value: series.value[idx]
                };
            }

            series.lastReadTotal = series.totalWritten;
            seriesDelta[name] = points;
        }

        const marksUnread = this.marksTotalWritten - this.marksLastReadTotal;
        const marksDelta = [];
        if (marksUnread > 0) {
            const count = Math.min(this.maxMarks, marksUnread);
            const capacity = this.maxMarks;
            const writeIdx = this.marksWriteIndex;

            for (let i = 0; i < count; i++) {
                const idx = (writeIdx - count + i + capacity) % capacity;
                const m = this.marks[idx];
                if (m) {
                    marksDelta.push({ ...m });
                }
            }
            this.marksLastReadTotal = this.marksTotalWritten;
        }

        return {
            series: seriesDelta,
            marks: marksDelta
        };
    }
}

module.exports = PlotBuffer;
