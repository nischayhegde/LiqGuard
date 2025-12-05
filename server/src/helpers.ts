import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, PROGRAM_AUTHORITY_KEYPAIR } from "./config";
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

export interface ActivatePolicyParams {
  policyAddress: PublicKey;
  payer: Keypair; // The payer keypair (must be the payout wallet)
  idl?: Policyfactory;
}

export interface ClosePolicyParams {
  policyAddress: PublicKey;
  payout: boolean;
  programAuthority?: Keypair; // Optional: defaults to loaded program authority from config
  idl?: Policyfactory;
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
  // Use provided program authority or use from config
  const programAuthority = params.programAuthority || PROGRAM_AUTHORITY_KEYPAIR;

  // Derive the policy PDA using program authority
  const [policyAddress] = derivePolicyAddress(
    programAuthority.publicKey,
    params.nonce
  );

  // Create a wallet from the program authority keypair
  const wallet = new Wallet(programAuthority);
  const program = getProgram(connection, wallet, idl);

  // Call the create_policy instruction
  // Note: Only the program authority can create policies
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
      authority: programAuthority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { signature: tx, policyAddress };
}

/**
 * Activates a policy using the activate_policy instruction
 * @param connection - Solana connection
 * @param params - Parameters for activating the policy
 * @returns Transaction signature
 */
export async function activatePolicy(
  connection: Connection,
  params: ActivatePolicyParams
): Promise<{ signature: string }> {
  const wallet = new Wallet(params.payer);
  const program = getProgram(connection, wallet, params.idl);

  // Fetch the policy account to get payment_mint and authority
  const policyAccount = await program.account.policy.fetch(params.policyAddress);
  const paymentMint = policyAccount.paymentMint as PublicKey;
  const authority = policyAccount.authority as PublicKey;

  // Automatically derive token account addresses
  const payerTokenAccount = getAssociatedTokenAddress(
    paymentMint,
    params.payer.publicKey
  );
  
  const authorityTokenAccount = getAssociatedTokenAddress(
    paymentMint,
    authority
  );

  // Call the activate_policy instruction
  // Anchor SDK will automatically derive payer_token_account via associated_token constraint
  const tx = await program.methods
    .activatePolicy()
    .accounts({
      policy: params.policyAddress,
      payer: params.payer.publicKey,
      payerTokenAccount: payerTokenAccount,
      authorityTokenAccount: authorityTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  return { signature: tx };
}

/**
 * Closes a policy using the close_policy instruction
 * @param connection - Solana connection
 * @param params - Parameters for closing the policy
 * @returns Transaction signature
 */
export async function closePolicy(
  connection: Connection,
  params: ClosePolicyParams
): Promise<{ signature: string }> {
  // Use provided program authority or use from config
  const programAuthority = params.programAuthority || PROGRAM_AUTHORITY_KEYPAIR;

  // Create a wallet from the program authority keypair
  // Note: Only the program authority can close policies
  const wallet = new Wallet(programAuthority);
  const program = getProgram(connection, wallet, params.idl);

  // Fetch the policy account to get payment_mint, authority, and payout_wallet
  const policyAccount = await program.account.policy.fetch(params.policyAddress);
  const paymentMint = policyAccount.paymentMint as PublicKey;
  const authority = policyAccount.authority as PublicKey; // This will be the program authority
  const payoutWallet = policyAccount.payoutWallet as PublicKey;

  // Automatically derive token account addresses
  // authorityTokenAccount is the ATA for the program authority (who holds the coverage funds)
  const authorityTokenAccount = getAssociatedTokenAddress(
    paymentMint,
    authority
  );
  
  const payoutTokenAccount = getAssociatedTokenAddress(
    paymentMint,
    payoutWallet
  );

  // Call the close_policy instruction
  const tx = await program.methods
    .closePolicy(params.payout)
    .accounts({
      policy: params.policyAddress,
      authority: programAuthority.publicKey,
      authorityTokenAccount: authorityTokenAccount,
      payoutTokenAccount: payoutTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  return { signature: tx };
}
