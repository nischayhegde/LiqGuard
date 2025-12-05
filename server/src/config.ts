import { Keypair, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

const DEFAULT_PROGRAM_ID = "B1Q17cQbVb333jFhQNVHWWK1Ttv59FiqFURaf27qAhPj";
const DEFAULT_PROGRAM_AUTHORITY =
  "GhgQwWfyZqjjaDBtVUmmc3rg9NEX9qQYhew1ACFRJmp8";
const DEFAULT_PAYMENT_MINT = "2PrZzabMzDhpRd1mtRxqWwQLvQDASjdCYNxcZbNk5hLs";

const PROGRAM_AUTHORITY_SECRET_KEY = process.env.PROGRAM_AUTHORITY_SECRET_KEY;

function loadAuthorityKeypair(): Keypair {
  if (!PROGRAM_AUTHORITY_SECRET_KEY) {
    throw new Error(
      "PROGRAM_AUTHORITY_SECRET_KEY is not set. Provide the authority secret key JSON array."
    );
  }

  try {
    const secret = Uint8Array.from(JSON.parse(PROGRAM_AUTHORITY_SECRET_KEY));
    return Keypair.fromSecretKey(secret);
  } catch (error) {
    throw new Error(
      "Failed to parse PROGRAM_AUTHORITY_SECRET_KEY. Expected a JSON array from solana-keygen."
    );
  }
}

// Cluster / RPC
export const CLUSTER = process.env.CLUSTER ?? "devnet";
export const RPC_URL =
  process.env.RPC_URL ?? "https://api.devnet.solana.com";

// Program + authority
export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? DEFAULT_PROGRAM_ID
);
export const PROGRAM_AUTHORITY_PUBKEY = new PublicKey(
  process.env.PROGRAM_AUTHORITY_PUBKEY ?? DEFAULT_PROGRAM_AUTHORITY
);
export const PROGRAM_AUTHORITY_KEYPAIR = loadAuthorityKeypair();

// Payment mint (devnet USDC – override in env if you minted your own)
export const PAYMENT_MINT = new PublicKey(
  process.env.PAYMENT_MINT ?? DEFAULT_PAYMENT_MINT
);

// Pyth price feed IDs (override via env to change assets)
export const PYTH_PRICE_FEEDS: Record<string, string> = {
  BTC:
    process.env.PYTH_BTC_FEED ??
    "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH:
    process.env.PYTH_ETH_FEED ??
    "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL:
    process.env.PYTH_SOL_FEED ??
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

// Pricing / vig
export const VIG_RATE = 0.2; // 20% vig on top of fair premium
export const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE ?? 0.02);
export const VOLATILITY_DEFAULTS: Record<string, number> = {
  BTC: Number(process.env.VOL_BTC ?? 0.6),
  ETH: Number(process.env.VOL_ETH ?? 0.7),
  SOL: Number(process.env.VOL_SOL ?? 0.8),
};

// API / service
export const SERVER_PORT = Number(process.env.PORT ?? 8787);
export const PRICE_SERVICE_URL =
  process.env.PRICE_SERVICE_URL ?? "https://hermes.pyth.network";
