import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, PROGRAM_AUTHORITY, RPC_URL } from "./config";
import { Policyfactory } from "./idl";

// Types matching the smart contract
export enum UnderlyingAsset {
  BTC = { btc: {} },
  ETH = { eth: {} },
  SOL = { sol: {} },
}

export enum CallOrPut {
  Call = { call: {} },
  Put = { put: {} },
}

export interface CreatePolicyParams {
  nonce: number;
  strikePrice: number;
  expirationDatetime: number; // Unix timestamp in seconds
  underlyingAsset: UnderlyingAsset;
  callOrPut: CallOrPut;
  coverageAmount: number;
  premium: number;
  payoutWallet: PublicKey;
  paymentMint: PublicKey;
  authority: Keypair; // The authority keypair (signer)
}

export interface ClosePolicyParams {
  policyAddress: PublicKey;
  payout: boolean;
  authorityTokenAccount: PublicKey;
  payoutTokenAccount: PublicKey;
  authority: Keypair; // The authority keypair (signer)
}

/**
 * Gets or creates an Anchor program instance
 * @param connection - Solana connection
 * @param wallet - Wallet instance
 * @param idl - Program IDL (optional, can be loaded from file or network)
 * @returns Program instance
 */
function getProgram(
  connection: Connection,
  wallet: Wallet,
  idl?: Policyfactory
): Program<Policyfactory> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // If IDL is provided, use it; otherwise, Anchor will try to fetch it
  if (idl) {
    return new Program(idl, PROGRAM_ID, provider);
  }

  // For now, we'll need to provide the IDL
  // In production, you'd load it from a file or fetch it from the network
  throw new Error("IDL must be provided. Please load it from a file or network.");
}

/**
 * Derives the policy PDA address
 * @param authority - Authority public key
 * @param nonce - Policy nonce
 * @returns Policy PDA address and bump
 */
export function derivePolicyAddress(
  authority: PublicKey,
  nonce: number
): [PublicKey, number] {
  // Convert nonce to little-endian bytes (matching Rust's to_le_bytes())
  const nonceBuffer = Buffer.allocUnsafe(8);
  nonceBuffer.writeBigUInt64LE(BigInt(nonce), 0);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), authority.toBuffer(), nonceBuffer],
    PROGRAM_ID
  );
}

/**
 * Creates a new policy using the create_policy instruction (first instruction)
 * @param connection - Solana connection
 * @param params - Parameters for creating the policy
 * @param idl - Program IDL (optional)
 * @returns Transaction signature and policy account address
 */
export async function createPolicy(
  connection: Connection,
  params: CreatePolicyParams,
  idl?: Policyfactory
): Promise<{ signature: string; policyAddress: PublicKey }> {
  // Derive the policy PDA
  const [policyAddress] = derivePolicyAddress(
    params.authority.publicKey,
    params.nonce
  );

  // Create a wallet from the authority keypair
  const wallet = new Wallet(params.authority);
  const program = getProgram(connection, wallet, idl);

  // Call the create_policy instruction
  const tx = await program.methods
    .createPolicy(
      new BN(params.nonce),
      new BN(params.strikePrice),
      new BN(params.expirationDatetime),
      params.underlyingAsset,
      params.callOrPut,
      new BN(params.coverageAmount),
      new BN(params.premium),
      params.payoutWallet,
      params.paymentMint
    )
    .accounts({
      policy: policyAddress,
      authority: params.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { signature: tx, policyAddress };
}

/**
 * Closes a policy using the close_policy instruction (third instruction)
 * @param connection - Solana connection
 * @param params - Parameters for closing the policy
 * @param idl - Program IDL (optional)
 * @returns Transaction signature
 */
export async function closePolicy(
  connection: Connection,
  params: ClosePolicyParams,
  idl?: Policyfactory
): Promise<{ signature: string }> {
  const wallet = new Wallet(params.authority);
  const program = getProgram(connection, wallet, idl);

  // Call the close_policy instruction
  const tx = await program.methods
    .closePolicy(params.payout)
    .accounts({
      policy: params.policyAddress,
      authority: params.authority.publicKey,
      authorityTokenAccount: params.authorityTokenAccount,
      payoutTokenAccount: params.payoutTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  return { signature: tx };
}
