# LiqGuard Implementation Details

## Core Components

### 1. Anchor Program (`lib.rs`)

#### Policy Account Structure
```rust
pub struct Policy {
    pub owner: Pubkey,              // Policy owner
    pub strike_price: u64,          // Strike price in USD (e.g., 95000)
    pub is_long_insurance: bool,    // Direction flag
    pub coverage_amount: u64,       // Payout amount in lamports
    pub is_claimed: bool,           // Whether already liquidated
    pub policy_bump: u8,            // PDA bump for policy
    pub vault_bump: u8,            // PDA bump for vault
}
```

#### Key Instruction: `liquidate_policy`

**Step 1: Feed ID**
```rust
let btc_feed_id = get_feed_id_from_hex(
    "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
)?;
```
- This is the universal BTC/USD feed ID for Pyth V2
- Works across all chains (Solana, Arbitrum, Base, etc.)

**Step 2: Get Price (no older than 60 seconds)**
```rust
let price_info = price_update.get_price_no_older_than(&btc_feed_id, 60)
    .ok_or(LiqGuardError::PriceStale)?;
```

**Step 3: Price Normalization (THE CRITICAL MATH)**

This is the "gotcha" mentioned in the prompt. Pyth returns:
- `magnitude`: i64 (e.g., 9,500,000,000,000)
- `exponent`: i32 (e.g., -8)

**Without normalization**, comparing `9,500,000,000,000` directly to a strike price of `95,000` would be wrong!

```rust
// Extract values
let price_magnitude = price_info.price.magnitude;  // e.g., 9500000000000
let price_exponent = price_info.price.exponent;    // e.g., -8

// Calculate normalization: 10^|exponent|
let normalization_factor = 10u64
    .checked_pow(price_exponent.abs() as u32)  // 10^8 = 100,000,000
    .ok_or(LiqGuardError::MathOverflow)?;

// Normalize: divide by 10^8
let current_price = (price_magnitude as u64)
    .checked_div(normalization_factor)  // 9500000000000 / 100000000 = 95000
    .ok_or(LiqGuardError::MathOverflow)?;
```

**Result**: `current_price = 95000` (clean USD amount)

**Step 4: Direction Check (THE BOOLEAN LOGIC)**

```rust
let should_liquidate = if policy.is_long_insurance {
    // is_long_insurance = true: "I am Long BTC. I am afraid it will drop."
    // Pay me if Price < Strike
    current_price < policy.strike_price
} else {
    // is_long_insurance = false: "I am Short BTC. I am afraid it will moon."
    // Pay me if Price > Strike
    current_price > policy.strike_price
};
```

**Examples:**

1. **Long Protection** (`is_long_insurance = true`):
   - Strike: $95,000
   - Current: $90,000
   - Condition: `90000 < 95000` → ✅ **TRUE** → Pay out

2. **Short Protection** (`is_long_insurance = false`):
   - Strike: $95,000
   - Current: $100,000
   - Condition: `100000 > 95000` → ✅ **TRUE** → Pay out

**Step 5: Execute Payout**
```rust
// Transfer SOL from vault to user
anchor_lang::system_program::transfer(cpi_context, policy.coverage_amount)?;
policy.is_claimed = true;
```

### 2. Monitor Script (`monitor.ts`)

#### Price Normalization (TypeScript)
```typescript
function normalizePrice(price: bigint, exponent: number): number {
    const priceMagnitude = Number(price);
    const normalizationFactor = Math.pow(10, Math.abs(exponent));
    return priceMagnitude / normalizationFactor;
}
```

#### Demo Modes

**CRASH Mode** (Long getting wrecked):
```typescript
if (DEMO_MODE === 'CRASH') {
    const conditionMet = currentPrice < 100000;
    // Triggers when BTC crashes below $100k
}
```

**PUMP Mode** (Short getting wrecked):
```typescript
if (DEMO_MODE === 'PUMP') {
    const conditionMet = currentPrice > 90000;
    // Triggers when BTC pumps above $90k
}
```

#### Transaction Bundling

The monitor bundles two instructions atomically:
1. `addPostPriceUpdates` - Updates Pyth price on-chain
2. `liquidate_policy` - Executes liquidation

```typescript
const transaction = new Transaction();

// Add Pyth price update
const priceUpdateIx = await addPostPriceUpdates(
    connection,
    PYTH_PRICE_UPDATE_ACCOUNT,
    priceUpdateData
);
transaction.add(...priceUpdateIx);

// Add liquidation
const liquidateIx = await program.methods
    .liquidatePolicy()
    .accounts({...})
    .instruction();
transaction.add(liquidateIx);

// Send atomically
await sendAndConfirmTransaction(connection, transaction, [wallet]);
```

## Critical Implementation Notes

### 1. The Math "Gotcha"

**Problem**: Pyth price format is not intuitive
- Raw: `9,500,000,000,000` with exponent `-8`
- Looks like: 9.5 trillion dollars ❌
- Actually: `95,000` dollars ✅

**Solution**: Always normalize before comparison
```rust
normalized_price = magnitude / (10 ^ |exponent|)
```

### 2. The Direction Boolean

**Mental Model**:
- `is_long_insurance = true` → "I'm long, protect me from drops"
- `is_long_insurance = false` → "I'm short, protect me from pumps"

**Logic**:
- Long protection: `price < strike` → liquidate
- Short protection: `price > strike` → liquidate

### 3. Feed ID vs Account Address

**Important**: The feed ID `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` is:
- ✅ Universal across all chains
- ✅ Used with `get_feed_id_from_hex()`
- ❌ NOT the same as legacy account addresses

### 4. Atomic Transactions

The monitor MUST:
1. First call `addPostPriceUpdates` to bring price on-chain
2. Then call `liquidate_policy` in the same transaction
3. This ensures the price is fresh when checked

### 5. Error Handling

The program handles:
- **PriceStale**: Price older than 60 seconds
- **MathOverflow**: Normalization calculation fails
- **LiquidationConditionNotMet**: Price hasn't crossed strike
- **AlreadyClaimed**: Policy already liquidated

## Testing Checklist

- [ ] Price normalization works correctly
- [ ] Long protection triggers on price drop
- [ ] Short protection triggers on price rise
- [ ] Stale price detection works
- [ ] Double-claim prevention works
- [ ] Vault has sufficient funds
- [ ] Transaction bundling is atomic
- [ ] Demo modes trigger correctly

## Common Pitfalls

1. **Forgetting normalization**: Comparing raw Pyth values to strike prices
2. **Wrong direction logic**: Mixing up Long vs Short conditions
3. **Stale prices**: Not updating price before liquidation check
4. **Missing vault funding**: Vault PDA not funded with SOL
5. **Wrong feed ID**: Using legacy account address instead of feed ID

## Performance Considerations

- Price updates: ~1 per second from Pyth
- Transaction costs: ~0.000005 SOL per liquidation
- Monitor overhead: Minimal (WebSocket subscription)
- On-chain checks: O(1) for price lookup

