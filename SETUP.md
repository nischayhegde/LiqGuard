# LiqGuard Setup Guide

Complete setup guide for the LiqGuard decentralized perpetual insurance app on Solana.

## Prerequisites

1. **Rust** (latest stable version)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Solana CLI** (v1.18+)
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   ```

3. **Anchor Framework** (v0.30.0+)
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```

4. **Node.js** (v18+)
   ```bash
   # Using nvm (recommended)
   nvm install 18
   nvm use 18
   ```

## Project Structure

```
LiqGuard/
├── programs/
│   └── liqguard/
│       ├── src/
│       │   └── lib.rs          # Anchor program
│       └── Cargo.toml
├── backend/
│   ├── monitor.ts              # Price monitor script
│   ├── package.json
│   └── .env                    # Environment variables
├── Anchor.toml
└── SETUP.md
```

## Step 1: Build the Anchor Program

1. Navigate to project root:
   ```bash
   cd /path/to/LiqGuard
   ```

2. Build the program:
   ```bash
   anchor build
   ```

3. This will:
   - Compile the Rust program
   - Generate the IDL in `target/idl/liqguard.json`
   - Generate the program keypair

## Step 2: Deploy to Devnet

1. Set Solana CLI to devnet:
   ```bash
   solana config set --url devnet
   ```

2. Get some devnet SOL:
   ```bash
   solana airdrop 2
   ```

3. Deploy the program:
   ```bash
   anchor deploy
   ```

4. **Important**: After deployment, update the program ID:
   - Copy the program ID from the deployment output
   - Update `programs/liqguard/src/lib.rs` line 4: `declare_id!("YOUR_PROGRAM_ID");`
   - Update `Anchor.toml` line 6: `liqguard = "YOUR_PROGRAM_ID"`
   - Update `backend/monitor.ts` line 20: `PROGRAM_ID = new PublicKey('YOUR_PROGRAM_ID')`
   - Rebuild and redeploy:
     ```bash
     anchor build
     anchor deploy
     ```

## Step 3: Setup Monitor Script

1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

4. Configure `.env`:
   ```env
   RPC_URL=https://api.devnet.solana.com
   PRIVATE_KEY=your_base58_private_key_here
   DEMO_MODE=CRASH
   PROGRAM_ID=YOUR_PROGRAM_ID
   ```

5. Get your private key:
   ```bash
   # If using Solana CLI keypair
   solana-keygen pubkey ~/.config/solana/id.json
   
   # To export private key as base58
   # You'll need to use a script or tool to convert
   ```

## Step 4: Generate Anchor Client (for monitor.ts)

After building the program, you need to generate the TypeScript client:

1. The IDL is generated at `target/idl/liqguard.json`

2. In `monitor.ts`, you'll need to load the IDL:
   ```typescript
   import idl from '../target/idl/liqguard.json';
   const program = new Program(idl as any, PROGRAM_ID, provider);
   ```

3. Update the `executeLiquidation` function in `monitor.ts` to use the generated client.

## Step 5: Initialize a Policy

Before the monitor can liquidate, you need to:

1. Create a policy account (via a frontend or script)
2. Fund the vault PDA with SOL

Example initialization (pseudo-code):
```typescript
const [policyPDA] = getPolicyPDA(owner);
const [vaultPDA] = getVaultPDA(owner);

await program.methods
  .initializePolicy(
    new BN(95000),      // strike_price
    true,               // is_long_insurance
    new BN(1_000_000_000) // coverage_amount (1 SOL in lamports)
  )
  .accounts({
    policy: policyPDA,
    vault: vaultPDA,
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// Fund the vault
await connection.requestAirdrop(vaultPDA, 2_000_000_000); // 2 SOL
```

## Step 6: Run the Monitor

```bash
cd backend
npm run monitor
```

The monitor will:
- Connect to Pyth Hermes WebSocket
- Listen for BTC/USD price updates
- Log price changes
- In demo mode, show when trigger conditions are met

## Testing

### Demo Mode: CRASH
- Triggers when BTC price < $100,000
- Simulates a Long position getting liquidated

### Demo Mode: PUMP
- Triggers when BTC price > $90,000
- Simulates a Short position getting liquidated

## Key Concepts

### Policy Direction

- **`is_long_insurance = true`**: Protects a Long position
  - Pays out if: `current_price < strike_price`
  - Example: You're long BTC at $100k, buy insurance at $95k strike
  - If BTC drops to $90k, you get paid

- **`is_long_insurance = false`**: Protects a Short position
  - Pays out if: `current_price > strike_price`
  - Example: You're short BTC at $90k, buy insurance at $95k strike
  - If BTC rises to $100k, you get paid

### Price Normalization

Pyth returns prices as:
- `magnitude`: i64 (e.g., 9500000000000)
- `exponent`: i32 (e.g., -8)

Normalized price = `magnitude / 10^|exponent|`
- Example: 9500000000000 / 10^8 = 95000 USD

## Troubleshooting

### "Price data is too stale"
- The price update account hasn't been updated recently
- Make sure `addPostPriceUpdates` is called before `liquidate_policy`

### "Math overflow occurred"
- Check that price normalization is working correctly
- Verify the exponent value from Pyth

### "Liquidation condition not met"
- The price hasn't crossed the strike price yet
- Check the direction (Long vs Short) matches your expectation

### Monitor not connecting
- Check your RPC URL is correct
- Verify your private key is in the correct format
- Ensure you have internet connectivity

## Next Steps

1. Integrate the monitor with your frontend
2. Add policy management UI
3. Implement vault funding mechanism
4. Add multiple asset support
5. Deploy to mainnet (after thorough testing)

## Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Pyth Network Docs](https://docs.pyth.network/)
- [Solana Cookbook](https://solanacookbook.com/)
- [Anchor Book](https://book.anchor-lang.com/)

