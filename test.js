const dataForge = require('data-forge');
require('data-forge-fs');
const fs = require('fs');
const { backtest, analyze, computeEquityCurve, computeDrawdown } = require('grademark');

const time_length = 30;
const stopLossPercentage = 20;
const startingCapital = 100;

// Load CSV
let inputSeries = dataForge.readFileSync('data/uploads/eeda66db1beb0fc443c45d7283faa6f7')
    .parseCSV()
    .parseFloats(["open", "high", "low", "close"])
    .skip(time_length);

const inputArray = inputSeries; // convert to array for detailed access
let s = true;

const trades = backtest({
    entryRule: (enter, args) => {
        const bar = args.bar;
        const timestamp = new Date(bar.Time / 1000).toISOString();
        const direction = 'long';

        console.log(`--- ENTRY ---`);
        console.log(`Timestamp: ${timestamp}`);
        console.log(`OHLC: O:${bar.Open} H:${bar.High} L:${bar.Low} C:${bar.Close}`);
        console.log(`Direction: ${direction}`);
        console.log(`StopLoss: ${bar.Close * (stopLossPercentage / 100)}\n`);

        enter({ direction });
        s = false;
    },
    exitRule: (exit, args) => {
        const bar = args.bar;
        const timestamp = new Date(bar.Time / 1000).toISOString();

        console.log(`--- EXIT ---`);
        console.log(`Timestamp: ${timestamp}`);
        console.log(`OHLC: O:${bar.Open} H:${bar.High} L:${bar.Low} C:${bar.Close}\n`);

        if (!s) {
            exit();
            s = true;
        }
    }
}, inputArray);

const analysis = analyze(startingCapital, trades);

async function report() {
    const eq = computeEquityCurve(startingCapital, trades);
    const dd = computeDrawdown(startingCapital, trades);

    const df = {
        analysis,
        stats: { equityCurve: eq, drawdown: dd },
        trades
    };

    await fs.writeFileSync('message.json', JSON.stringify(df, null, 2));
    console.log("Backtest complete, results saved to message.json");
    console.log("Detailed logs already printed above.");
}

report();
