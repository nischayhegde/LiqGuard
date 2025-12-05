import { CallOrPutSide, UnderlyingSymbol } from "./helpers";
import {
  RISK_FREE_RATE,
  VIG_RATE,
  VOLATILITY_DEFAULTS,
} from "./config";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export const STRIKE_PRICE_DECIMALS = 2; // store strikes in cents
export const TOKEN_DECIMALS = 6; // USDC-style 6 decimals

export interface PricingInput {
  asset: UnderlyingSymbol;
  callOrPut: CallOrPutSide;
  spot: number; // live price in USD
  strike: number; // strike in USD
  coverage: number; // payout amount in quote currency (USDC)
  expiration: Date;
  volatility?: number;
  riskFreeRate?: number;
}

export interface PricingOutput {
  fairPremium: number;
  vigAmount: number;
  totalPremium: number;
  vigRate: number;
  timeYears: number;
  d1: number;
  d2: number;
  breachProbability: number;
}

function erf(x: number): number {
  // Numerical approximation of error function
  const sign = Math.sign(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

export function toAtomic(amount: number, decimals: number): number {
  return Math.round(amount * 10 ** decimals);
}

export function pricePolicy(input: PricingInput): PricingOutput {
  const now = Date.now();
  const timeSeconds = (input.expiration.getTime() - now) / 1000;
  if (timeSeconds <= 0) {
    throw new Error("Expiration must be in the future");
  }

  const timeYears = timeSeconds / SECONDS_PER_YEAR;
  const volatility = input.volatility ?? VOLATILITY_DEFAULTS[input.asset];
  const riskFreeRate = input.riskFreeRate ?? RISK_FREE_RATE;

  if (volatility <= 0) {
    throw new Error("Volatility must be greater than zero");
  }

  const logTerm = Math.log(input.spot / input.strike);
  const volTerm = volatility * Math.sqrt(timeYears);
  const d1 =
    (logTerm + (riskFreeRate + 0.5 * volatility * volatility) * timeYears) /
    volTerm;
  const d2 = d1 - volTerm;

  const breachProbability =
    input.callOrPut === "CALL" ? normCdf(d2) : normCdf(-d2);

  const discountedPayout = input.coverage * Math.exp(-riskFreeRate * timeYears);
  const fairPremium = discountedPayout * breachProbability;
  const vigAmount = fairPremium * VIG_RATE;
  const totalPremium = fairPremium + vigAmount;

  return {
    fairPremium,
    vigAmount,
    totalPremium,
    vigRate: VIG_RATE,
    timeYears,
    d1,
    d2,
    breachProbability,
  };
}
