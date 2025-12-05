import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { PROGRAM_AUTHORITY, RPC_URL } from "./config";
import { createPolicy, closePolicy, UnderlyingAsset, CallOrPut, derivePolicyAddress } from "./helpers";

/**
 * Example usage of the helper functions
 */
async function main() {
  // Create connection to devnet
  const connection = new Connection(RPC_URL, "confirmed");

  // Load the authority keypair (you'll need to provide this)
  // For now, using PROGRAM_AUTHORITY as a placeholder
  // In production, load from a file or environment variable
  const authorityKeypair = Keypair.generate(); // Replace with actual keypair loading

  // Example: Create a policy
  console.log("Creating policy...");
  try {
    const createResult = await createPolicy(connection, {
      nonce: 1,
      strikePrice: 100000, // Example: $1000 in basis points
      expirationDatetime: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
      underlyingAsset: UnderlyingAsset.SOL,
      callOrPut: CallOrPut.Call,
      coverageAmount: 1000000, // Example: 10 SOL in lamports
      premium: 100000, // Example: 1 SOL in lamports
      payoutWallet: new PublicKey("AFsDyH5JNBDfEsiAzgNT2zdvUNL21T4QHSzYZqhZSCb7"), // Replace with actual wallet
      paymentMint: new PublicKey("So11111111111111111111111111111111111112"), // SOL mint
      authority: authorityKeypair,
    });

    console.log("Policy created!");
    console.log("Policy address:", createResult.policyAddress.toString());
    console.log("Transaction signature:", createResult.signature);
  } catch (error) {
    console.error("Error creating policy:", error);
  }

  // Example: Close a policy
  console.log("\nClosing policy...");
  try {
    // Derive policy address (you'd normally store this)
    const [policyAddress] = derivePolicyAddress(authorityKeypair.publicKey, 1);

    const closeResult = await closePolicy(connection, {
      policyAddress,
      payout: true,
      authorityTokenAccount: new PublicKey("11111111111111111111111111111111"), // Replace with actual token account
      payoutTokenAccount: new PublicKey("11111111111111111111111111111111"), // Replace with actual token account
      authority: authorityKeypair,
    });

    console.log("Policy closed!");
    console.log("Transaction signature:", closeResult.signature);
  } catch (error) {
    console.error("Error closing policy:", error);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { createPolicy, closePolicy, derivePolicyAddress, UnderlyingAsset, CallOrPut };
