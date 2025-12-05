import express from "express";
import cors from "cors";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  CallOrPutSide,
  UnderlyingSymbol,
  createPolicy,
  derivePolicyAddress,
} from "./helpers";
import {
  PAYMENT_MINT,
  PROGRAM_AUTHORITY_PUBKEY,
  PROGRAM_ID,
  PYTH_PRICE_FEEDS,
  RPC_URL,
  RISK_FREE_RATE,
  SERVER_PORT,
  VIG_RATE,
  VOLATILITY_DEFAULTS,
} from "./config";
import { fetchPythPrice } from "./pyth";
import {
  STRIKE_PRICE_DECIMALS,
  TOKEN_DECIMALS,
  pricePolicy,
  toAtomic,
} from "./pricing";

const app = express();
app.use(cors());
app.use(express.json());

const connection = new Connection(RPC_URL, "confirmed");

const quoteSchema = z.object({
  asset: z.enum(["BTC", "ETH", "SOL"]),
  callOrPut: z.enum(["CALL", "PUT"]),
  strikePrice: z.number().positive(),
  coverage: z.number().positive(),
  expiration: z.string(),
  volatility: z.number().positive().optional(),
  riskFreeRate: z.number().optional(),
});

const policySchema = quoteSchema.extend({
  payoutWallet: z.string().min(32),
  nonce: z.number().optional(),
});

function parseExpiration(expiration: string): Date {
  const date = new Date(expiration);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid expiration datetime");
  }
  return date;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    programId: PROGRAM_ID.toBase58(),
    authority: PROGRAM_AUTHORITY_PUBKEY.toBase58(),
    paymentMint: PAYMENT_MINT.toBase58(),
  });
});

app.get("/config", (_req, res) => {
  res.json({
    programId: PROGRAM_ID.toBase58(),
    authority: PROGRAM_AUTHORITY_PUBKEY.toBase58(),
    paymentMint: PAYMENT_MINT.toBase58(),
    pythFeeds: PYTH_PRICE_FEEDS,
    vigRate: VIG_RATE,
    riskFreeRate: RISK_FREE_RATE,
    volatilityDefaults: VOLATILITY_DEFAULTS,
    decimals: {
      strike: STRIKE_PRICE_DECIMALS,
      token: TOKEN_DECIMALS,
    },
  });
});

app.get("/price/:asset", async (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase() as UnderlyingSymbol;
    if (!["BTC", "ETH", "SOL"].includes(asset)) {
      return res.status(400).json({ error: "Unsupported asset" });
    }

    const oracle = await fetchPythPrice(asset);
    res.json({
      asset,
      price: oracle.price,
      conf: oracle.conf,
      expo: oracle.expo,
      publishTime: oracle.publishTime,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message ?? "Failed to fetch price" });
  }
});

app.post("/quote", async (req, res) => {
  try {
    const parsed = quoteSchema.parse(req.body);
    const expiration = parseExpiration(parsed.expiration);
    const asset = parsed.asset as UnderlyingSymbol;
    const callOrPut = parsed.callOrPut as CallOrPutSide;

    const oracle = await fetchPythPrice(asset);
    const pricing = pricePolicy({
      asset,
      callOrPut,
      spot: oracle.price,
      strike: parsed.strikePrice,
      coverage: parsed.coverage,
      expiration,
      volatility: parsed.volatility,
      riskFreeRate: parsed.riskFreeRate,
    });

    const strikePriceAtomic = toAtomic(
      parsed.strikePrice,
      STRIKE_PRICE_DECIMALS
    );
    const coverageAtomic = toAtomic(parsed.coverage, TOKEN_DECIMALS);
    const premiumAtomic = toAtomic(pricing.totalPremium, TOKEN_DECIMALS);

    res.json({
      asset,
      callOrPut,
      spot: oracle.price,
      strikePrice: parsed.strikePrice,
      coverage: parsed.coverage,
      expiration: expiration.toISOString(),
      pricing,
      chainValues: {
        strikePriceAtomic,
        coverageAtomic,
        premiumAtomic,
        paymentMint: PAYMENT_MINT.toBase58(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.flatten() });
    }
    res.status(400).json({ error: error.message ?? "Failed to create quote" });
  }
});

app.post("/policies", async (req, res) => {
  try {
    const parsed = policySchema.parse(req.body);
    const expiration = parseExpiration(parsed.expiration);
    const asset = parsed.asset as UnderlyingSymbol;
    const callOrPut = parsed.callOrPut as CallOrPutSide;

    const oracle = await fetchPythPrice(asset);
    const pricing = pricePolicy({
      asset,
      callOrPut,
      spot: oracle.price,
      strike: parsed.strikePrice,
      coverage: parsed.coverage,
      expiration,
      volatility: parsed.volatility,
      riskFreeRate: parsed.riskFreeRate,
    });

    const strikePriceAtomic = toAtomic(
      parsed.strikePrice,
      STRIKE_PRICE_DECIMALS
    );
    const coverageAtomic = toAtomic(parsed.coverage, TOKEN_DECIMALS);
    const premiumAtomic = toAtomic(pricing.totalPremium, TOKEN_DECIMALS);

    const { policyAddress, signature } = await createPolicy(connection, {
      nonce: parsed.nonce ?? Math.floor(Date.now() / 1000),
      strikePrice: strikePriceAtomic,
      expirationDatetime: Math.floor(expiration.getTime() / 1000),
      underlyingAsset: asset,
      callOrPut,
      coverageAmount: coverageAtomic,
      premium: premiumAtomic,
      payoutWallet: new PublicKey(parsed.payoutWallet),
      paymentMint: PAYMENT_MINT,
    });

    res.json({
      policyAddress: policyAddress.toBase58(),
      createSignature: signature,
      paymentMint: PAYMENT_MINT.toBase58(),
      strikePriceAtomic,
      coverageAtomic,
      premiumAtomic,
      oracle,
      pricing,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.flatten() });
    }
    res
      .status(400)
      .json({ error: error.message ?? "Failed to create policy" });
  }
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(SERVER_PORT, () => {
  console.log(`LiqGuard server listening on port ${SERVER_PORT}`);
});

export {
  createPolicy,
  derivePolicyAddress,
  CallOrPutSide,
  UnderlyingSymbol,
};
