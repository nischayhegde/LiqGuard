import { PublicKey } from "@solana/web3.js";

// Program ID from the smart contract
export const PROGRAM_ID = new PublicKey("D7hq6vJ7J9BkzZc8iXuGRynsTdXGiRcCWzyBPgPe9FNy");

// Hardcoded program authority (this should be set to your authority keypair)
// Replace this with your actual authority public key
export const PROGRAM_AUTHORITY = new PublicKey("YOUR_AUTHORITY_PUBLIC_KEY_HERE");

// Devnet cluster
export const CLUSTER = "devnet";
export const RPC_URL = "https://api.devnet.solana.com";
