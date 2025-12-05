# LiqGuard Server

Server to interact with the policyfactory smart contract on Solana devnet.

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Configure the program authority in `src/config.ts`:
   - Replace `YOUR_AUTHORITY_PUBLIC_KEY_HERE` with your actual authority public key
   - Or load the keypair from a file/environment variable

3. Build the project:
```bash
npm run build
# or
yarn build
```

## Usage

### Create Policy (First Instruction)

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createPolicy, UnderlyingAsset, CallOrPut } from "./helpers";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authority = Keypair.fromSecretKey(/* your secret key */);

const result = await createPolicy(connection, {
  nonce: 1,
  strikePrice: 100000,
  expirationDatetime: Math.floor(Date.now() / 1000) + 86400 * 30,
  underlyingAsset: UnderlyingAsset.SOL,
  callOrPut: CallOrPut.Call,
  coverageAmount: 1000000,
  premium: 100000,
  payoutWallet: new PublicKey("..."),
  paymentMint: new PublicKey("So11111111111111111111111111111111111112"),
  authority: authority,
});
```

### Close Policy (Third Instruction)

```typescript
import { closePolicy, derivePolicyAddress } from "./helpers";

const [policyAddress] = derivePolicyAddress(authority.publicKey, nonce);

const result = await closePolicy(connection, {
  policyAddress,
  payout: true,
  authorityTokenAccount: new PublicKey("..."),
  payoutTokenAccount: new PublicKey("..."),
  authority: authority,
});
```

## Notes

- The program authority is hardcoded in `src/config.ts`
- Make sure to provide the IDL when calling the functions, or load it from a file
- The IDL type definition is in `src/idl.ts` but you may need to generate the actual IDL file using `anchor build` in the policyfactory directory
