# Get Program Accounts - Usage Guide

This utility fetches all Policy accounts from the LiqGuard Solana program and extracts strike prices.

## TypeScript Usage

### As a Module

```typescript
import { getProgramAccounts, getStrikePrices } from './getProgramAccounts';

// Get all policy accounts with full details
const accounts = await getProgramAccounts();
console.log('Strike prices:', accounts.map(acc => acc.strikePrice));

// Get only strike prices
const strikePrices = await getStrikePrices();
console.log('Strike prices:', strikePrices);
```

### As a Script

```bash
# Human-readable output
npm run get-accounts

# JSON output (for API consumption)
npm run get-accounts-json
```

## Python API Endpoints

### Get All Program Accounts

```bash
curl http://localhost:5000/program-accounts
```

Response:
```json
{
  "success": true,
  "count": 2,
  "accounts": [
    {
      "pubkey": "...",
      "owner": "...",
      "strikePrice": 95000,
      "isLongInsurance": true,
      "coverageAmount": 1000000000,
      "isClaimed": false,
      "policyBump": 255,
      "vaultBump": 254
    }
  ],
  "strikePrices": [95000, 100000]
}
```

### Get Only Strike Prices

```bash
curl http://localhost:5000/strike-prices
```

Response:
```json
{
  "success": true,
  "strikePrices": [95000, 100000],
  "count": 2
}
```

## Frontend Usage

```javascript
// Fetch all program accounts
const response = await fetch('http://localhost:5000/program-accounts');
const data = await response.json();

if (data.success) {
  console.log('Strike prices:', data.strikePrices);
  console.log('Accounts:', data.accounts);
}

// Or fetch only strike prices
const strikeResponse = await fetch('http://localhost:5000/strike-prices');
const strikeData = await strikeResponse.json();
console.log('Strike prices:', strikeData.strikePrices);
```

## Account Structure

Each Policy account contains:
- `pubkey`: The account's public key
- `authority`: The policy authority's public key
- `nonce`: Unique nonce for the policy
- `strikePrice`: The strike price (e.g., 95000)
- `expirationDatetime`: Expiration timestamp (Unix timestamp in seconds)
- `underlyingAsset`: The underlying asset ('BTC', 'ETH', or 'SOL')
- `callOrPut`: Option type ('Call' or 'Put')
- `coverageAmount`: Coverage amount (in token units)
- `premium`: Premium amount (in token units)
- `payoutWallet`: Wallet address that receives the payout
- `paymentMint`: Token mint address for payments
- `status`: Policy status ('Inactive' or 'Active')
- `bump`: PDA bump seed for the policy account

## Configuration

The script uses environment variables from `.env`:
- `RPC_URL`: Solana RPC endpoint (default: `https://api.devnet.solana.com`)
- `PROGRAM_ID`: Policy Factory program ID (hardcoded: `D7hq6vJ7J9BkzZc8iXuGRynsTdXGiRcCWzyBPgPe9FNy`)

## Notes

- The function filters accounts by data size (148 bytes) to only fetch Policy accounts
- Accounts are decoded manually based on the Rust struct layout from the Policy Factory program
- The script connects to the Solana network specified in `RPC_URL`
- Policy accounts are created with seeds: `[b"policy", authority.key().as_ref(), &nonce.to_le_bytes()]`

