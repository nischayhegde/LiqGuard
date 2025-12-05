import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { RPC_URL, PROGRAM_AUTHORITY_KEYPAIR } from "./config";
import { createPolicy, activatePolicy, closePolicy, UnderlyingAsset, CallOrPut, derivePolicyAddress } from "./helpers";

/**
 * Example usage of the helper functions
 */
async function main() {
  // Create connection to devnet
  const connection = new Connection(RPC_URL, "confirmed");

  // Program authority keypair is loaded from config.ts
  console.log("Using program authority:", PROGRAM_AUTHORITY_KEYPAIR.publicKey.toString());

  // Example: Create a policy
  console.log("Creating policy...");
  try {
    // programAuthority is optional - will use loaded keypair automatically
    const createResult = await createPolicy(connection, {
      nonce: 1,
      strikePrice: 100000, // Example: $1000 in basis points
      expirationDatetime: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
      underlyingAsset: UnderlyingAsset.SOL,
      callOrPut: CallOrPut.Call,
      coverageAmount: 1000000, // Example: 10 SOL in lamports
      premium: 100000, // Example: 1 SOL in lamports
      payoutWallet: new PublicKey("AFsDyH5JNBDfEsiAzgNT2zdvUNL21T4QHSzYZqhZSCb7"), // Replace with actual wallet
      paymentMint: new PublicKey("2PrZzabMzDhpRd1mtRxqWwQLvQDASjdCYNxcZbNk5hLs"), // SOL mint
      // programAuthority is optional - will use loaded keypair automatically
    });

    console.log("Policy created!");
    console.log("Policy address:", createResult.policyAddress.toString());
    console.log("Transaction signature:", createResult.signature);
  } catch (error) {
    console.error("Error creating policy:", error);
  }

  // Example: Activate a policy
  console.log("\nActivating policy...");
  try {
    // Derive policy address (you'd normally store this)
    const [policyAddress] = derivePolicyAddress(authorityKeypair.publicKey, 1);

    // For activation, the payer must be the payout wallet
    // In a real scenario, you'd use the payout wallet keypair
    const payoutWalletKeypair = Keypair.generate(); // Replace with actual payout wallet

    const activateResult = await activatePolicy(connection, {
      policyAddress,
      payer: payoutWalletKeypair,
    });

    console.log("Policy activated!");
    console.log("Transaction signature:", activateResult.signature);
  } catch (error) {
    console.error("Error activating policy:", error);
  }

  // Example: Close a policy
  console.log("\nClosing policy...");
  try {
    // Derive policy address (you'd normally store this)
    // Note: Policy PDA is derived from program authority
    const [policyAddress] = derivePolicyAddress(PROGRAM_AUTHORITY_KEYPAIR.publicKey, 1);

    // programAuthority is optional - will use loaded keypair automatically
    const closeResult = await closePolicy(connection, {
      policyAddress,
      payout: true,
      // programAuthority is optional - will use loaded keypair automatically
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

export { createPolicy, activatePolicy, closePolicy, derivePolicyAddress, UnderlyingAsset, CallOrPut };
