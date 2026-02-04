// Support CommonJS require() typings in Monaco JS files
declare function require(path: string): any;
declare function require(path: "@utils/BaseStrategy"): typeof import("@utils/BaseStrategy").BaseStrategy;

declare module "@utils/BaseStrategy" {
  export type Intent = "ENTER" | "EXIT" | "NONE";
  export type Side = "long" | "short" | "flat";

 /**
   * Detailed Indicator Typings
   * Maps to the 'technicalindicators' package structure
   */
  export interface IndicatorProvider {
    // Oscillators
    RSI: { calculate(input: { values: number[]; period: number }): number[] };
    MACD: { calculate(input: { values: number[]; fastPeriod: number; slowPeriod: number; signalPeriod: number; SimpleMAOscillator?: boolean; SimpleMASignal?: boolean }): { MACD?: number; signal?: number; histogram?: number }[] };
    Stochastic: { calculate(input: { high: number[]; low: number[]; close: number[]; period: number; signalPeriod: number }): { k: number; d: number }[] };
    CCI: { calculate(input: { open: number[]; high: number[]; low: number[]; close: number[]; period: number }): number[] };
    WilliamsR: { calculate(input: { high: number[]; low: number[]; close: number[]; period: number }): number[] };
    
    // Moving Averages
    SMA: { calculate(input: { values: number[]; period: number }): number[] };
    EMA: { calculate(input: { values: number[]; period: number }): number[] };
    WMA: { calculate(input: { values: number[]; period: number }): number[] };
    WEMA: { calculate(input: { values: number[]; period: number }): number[] };
    TRIMA: { calculate(input: { values: number[]; period: number }): number[] };
    TEMA: { calculate(input: { values: number[]; period: number }): number[] };
    
    // Volatility & Trend
    BollingerBands: { calculate(input: { values: number[]; period: number; stdDev: number }): { upper: number; middle: number; lower: number }[] };
    ATR: { calculate(input: { high: number[]; low: number[]; close: number[]; period: number }): number[] };
    ADX: { calculate(input: { high: number[]; low: number[]; close: number[]; period: number }): { adx: number; pdi: number; mdi: number }[] };
    IchimokuCloud: { calculate(input: { high: number[]; low: number[]; close: number[]; conversionPeriod: number; basePeriod: number; spanPeriod: number; displacement: number }): { conversionLine: number; baseLine: number; spanA: number; spanB: number }[] };
    KeltnerChannels: { calculate(input: { high: number[]; low: number[]; close: number[]; maPeriod: number; atrPeriod: number; multiplier: number }): { upper: number; middle: number; lower: number }[] };
    PSAR: { calculate(input: { high: number[]; low: number[]; step: number; max: number }): number[] };
    SuperTrend: { calculate(input: { high: number[]; low: number[]; close: number[]; period: number; multiplier: number }): { value: number; direction: number }[] };

    // Volume
    OBV: { calculate(input: { close: number[]; volume: number[] }): number[] };
    VWAP: { calculate(input: { high: number[]; low: number[]; close: number[]; volume: number[] }): number[] };
    MFI: { calculate(input: { high: number[]; low: number[]; close: number[]; volume: number[]; period: number }): number[] };
    ADL: { calculate(input: { high: number[]; low: number[]; close: number[]; volume: number[] }): number[] };
    ForceIndex: { calculate(input: { close: number[]; volume: number[]; period: number }): number[] };

    // Candlestick Patterns (Boolean results)
    AbandonedBaby: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
    Doji: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
    BearishEngulfingPattern: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
    BullishEngulfingPattern: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
    HammerPattern: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
    MorningStar: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
    EveningStar: { check(input: { open: number[]; high: number[]; low: number[]; close: number[] }): boolean };
  }

  export interface StrategySignal {
    intent: Intent;
    side: Side;
    symbol: string;
    price: number;
    strategyId: string;
    timestamp: number;
    barTime?: number;
    tf: string;
    [key: string]: any;
  }

  export interface StrategySchema {
    [key: string]: {
      type?: "string" | "boolean" | "number" | "integer" | "float" | "enum";
      min?: number;
      max?: number;
      default?: any;
      label?: string;
      description?: string;
      options?: string[];
    };
  }

  export class BaseStrategy {
    public id: string;
    public name: string;
    public symbols: string[];
    public lookback: number;
    public timeframe: string;
    public candleBased: boolean;
    public max_data_history: number;
    public params: Record<string, any>;
    public schema: StrategySchema;
    public data: Map<string, any>;
    
    /** * Access to technical analysis indicators.
     * Use as: this.indicators.RSI.calculate({ values: [...], period: 14 })
     */
    public indicators: IndicatorProvider;
    
    /** Access to mathjs for complex matrix/vector calculations */
    public math: any;
    
    /** CoreX Logger instance */
    /**
     * Winston-like logger interface
     * Common methods from winston.Logger
     */
    public log: {
      (level: string, message: string, meta?: any, callback?: (...args: any[]) => void): void;
      (info: { level: string; message: string; [key: string]: any }): void;

      error(message: string, meta?: any, callback?: (...args: any[]) => void): void;
      warn(message: string, meta?: any, callback?: (...args: any[]) => void): void;
      info(message: string, meta?: any, callback?: (...args: any[]) => void): void;
      http?(message: string, meta?: any, callback?: (...args: any[]) => void): void;
      verbose?(message: string, meta?: any, callback?: (...args: any[]) => void): void;
      debug?(message: string, meta?: any, callback?: (...args: any[]) => void): void;
      silly?(message: string, meta?: any, callback?: (...args: any[]) => void): void;

      child?(options?: Record<string, any>): any;
      profile?(id: string): void;
      startTimer?(): { done: (info?: any) => void };

      add?(transport: any): void;
      remove?(transport: any): void;
      clear?(): void;
      close?(): void;
    };

    public readonly INTENT: { ENTER: "ENTER"; EXIT: "EXIT"; NONE: "NONE" };
    public readonly SIDE: { LONG: "long"; SHORT: "short"; FLAT: "flat" };

    constructor(config?: {
      id?: string;
      name?: string;
      symbols?: string[];
      lookback?: number;
      timeframe?: string;
      candleBased?: boolean;
      max_data_history?: number;
    });

    /**
     * Updates strategy parameters dynamically. 
     * Validates against the defined 'schema' and coerces types (e.g., "10" -> 10).
     */
    updateParams(params: Record<string, any>): void;

    /**
     * Entry point for raw price updates (Ticks).
     * If 'candleBased' is true, this aggregates ticks into a bar and only calls next() when the bar closes.
     */
    onTick(tick: { 
        symbol: string; 
        time: number; 
        price?: number; 
        close?: number; 
        volume?: number 
    }): StrategySignal | null;

    /**
     * Entry point for pre-formed OHLCV candles.
     * Pushes the bar into the CircularBuffer and immediately triggers next().
     */
    onBar(bar: { 
        symbol: string; 
        time: number; 
        open: number; 
        high: number; 
        low: number; 
        close: number; 
        volume?: number 
    }): StrategySignal | null;

    /**
     * The core logic loop. Override this in your strategy class.
     * @param data The tick or bar that triggered the update.
     * @returns A StrategySignal to trade, or null to do nothing.
     */
    next(data: { 
        symbol: string; 
        time: number; 
        open: number; 
        high: number; 
        low: number; 
        close: number; 
        volume?: number; 
    }, isWarmedUp: boolean): StrategySignal | null;

    /**
     * Factory: Returns a LONG entry signal.
     * @param params Optional metadata (e.g., custom price, stop loss, or comments).
     */
    buy(params?: Record<string, any>): StrategySignal | null;

    /**
     * Factory: Returns a SHORT entry signal.
     * @param params Optional metadata (e.g., custom price, stop loss, or comments).
     */
    sell(params?: Record<string, any>): StrategySignal | null;

    /**
     * Factory: Returns a FLAT (Exit) signal.
     * Use this to close existing positions regardless of side.
     */
    exit(params?: Record<string, any>): StrategySignal | null;

    /**
     * Retrieves the historical array of closed bars for a specific symbol.
     * Use this to feed the 'values' array into your indicators.
     */
    getLookbackWindow(symbol: string): Array<{ 
        time: number; 
        open: number; 
        high: number; 
        low: number; 
        close: number; 
        volume?: number 
    }>;

    /**
     * Returns true if the CircularBuffer has enough bars to satisfy the 'lookback' requirement.
     * Prevents indicators from crashing on empty or small arrays.
     */
    isWarmedUp(symbol: string): boolean;
  }
}
