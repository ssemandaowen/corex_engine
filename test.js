const dataForge = require('data-forge')
const { writeFile, writeFileSync } = require('fs')
require('data-forge-fs')
const ta = require('data-forge')
require('data-forge')
const fs = require('fs')
const path = require('path')

const { backtest, analyze, computeEquityCurve, computeDrawdown } = require('grademark')
let time_length = 30;
let stopLossPercentage = 20;
let startingCapital = 100

let inputSeries = dataForge.readFileSync('data/uploads/5910df942067e817db796372aecd9013')
    .parseCSV()
    .parseFloats(["open", "high", "low", "close"])

inputSeries = inputSeries
    .skip(time_length)
let s = true
const trades = backtest({
    entryRule: (enter, args) => {
        if (s) {
            enter({ direction: 'long' })
            s = false
        }
    },
    exitRule: (exit, args) => {
        if (!s) {
            exit()
            s = true
        }
    },
    stopLoss: args => {
        return args.entryPrice * (stopLossPercentage / 100);
    }
}, inputSeries);


const analysis = analyze(startingCapital, trades)


// console.log(analysis);
async function report() {
    let eq = computeEquityCurve(startingCapital, trades)
    let dd = computeDrawdown(startingCapital, trades)

    let df = {analyse: analysis, stat:[ eq, dd ]}
    await fs.writeFileSync('message.json', JSON.stringify(df, null, 2));
}

report()