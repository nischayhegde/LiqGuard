import { PublicKey, Keypair } from "@solana/web3.js";

// Program ID from the smart contract
export const PROGRAM_ID = new PublicKey("B1Q17cQbVb333jFhQNVHWWK1Ttv59FiqFURaf27qAhPj");

// Program authority public key (must match the constant in Rust program)
export const PROGRAM_AUTHORITY_PUBKEY = new PublicKey("GhgQwWfyZqjjaDBtVUmmc3rg9NEX9qQYhew1ACFRJmp8");

// Program authority keypair - replace with your actual keypair
// You can generate one with: solana-keygen new -o program-authority.json
// Then load it: import * as fs from "fs"; const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./program-authority.json", "utf-8"))));
export const PROGRAM_AUTHORITY_KEYPAIR: Keypair = Keypair.generate(); // TODO: Replace with your actual program authority keypair

// Devnet cluster
export const CLUSTER = "devnet";
export const RPC_URL = "https://api.devnet.solana.com";
