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
  breachProbability: number; // interpreted now as first-hit probability
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

// First-hit probability for a single barrier (strike) before expiry
// Using reflection-principle-based approximation for log-price Brownian with drift
function firstHitProbability(
  spot: number,
  strike: number,
  vol: number,
  riskFreeRate: number,
  timeYears: number,
  callOrPut: CallOrPutSide
): number {
  // If already beyond the barrier in the direction that pays out, probability is 1
  if (callOrPut === "CALL" && spot >= strike) return 1;
  if (callOrPut === "PUT" && spot <= strike) return 1;

  // If the strike is in the wrong direction (e.g., call with strike below spot), handled above.
  const logM = Math.log(strike / spot); // positive for up-barrier, negative for down-barrier
  const h = Math.abs(logM);

  // Drift of log-price
  const drift = riskFreeRate - 0.5 * vol * vol;
  const denom = vol * Math.sqrt(timeYears);

  if (denom === 0) {
    return 0;
  }

  // Reflection principle formula for first passage of drifted Brownian to a single barrier
  const term1 = (-h - drift * timeYears) / denom;
  const term2 = (-h + drift * timeYears) / denom;
  const expTerm = Math.exp((2 * drift * h) / (vol * vol));

  const prob = normCdf(term1) + expTerm * normCdf(term2);

  // Clamp to [0,1] to avoid numerical spillover
  return Math.min(1, Math.max(0, prob));
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

  const volTerm = volatility * Math.sqrt(timeYears);
  const d1 =
    (Math.log(input.spot / input.strike) +
      (riskFreeRate + 0.5 * volatility * volatility) * timeYears) /
    volTerm;
  const d2 = d1 - volTerm;

  const breachProbability = firstHitProbability(
    input.spot,
    input.strike,
    volatility,
    riskFreeRate,
    timeYears,
    input.callOrPut
  );

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
