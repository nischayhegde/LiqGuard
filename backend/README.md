# LiqGuard Monitor

Node.js monitor script that listens to Pyth Network price feeds and triggers liquidations on Solana.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Set your Solana private key in `.env`:
```
PRIVATE_KEY=your_base58_private_key_here
```

4. Configure demo mode (optional):
```
DEMO_MODE=CRASH  # or PUMP
```

## Usage

Run the monitor:
```bash
npm run monitor
```

Or in development mode with auto-reload:
```bash
npm run dev
```

## Demo Modes

- **CRASH**: Triggers when BTC price < $100,000 (simulates Long getting wrecked)
- **PUMP**: Triggers when BTC price > $90,000 (simulates Short getting wrecked)

## Architecture

The monitor:
1. Connects to Pyth Hermes WebSocket
2. Listens for BTC/USD price updates
3. Normalizes prices from Pyth format (i64 + exponent) to USD
4. Checks liquidation conditions based on policy parameters
5. Bundles `addPostPriceUpdates` + `liquidate_policy` into atomic transactions
6. Executes liquidations when conditions are met

## Notes

- The monitor requires the Anchor program IDL to be generated first
- Run `anchor build` in the project root to generate the IDL
- The generated IDL should be placed in `target/idl/liqguard.json`
- Update the monitor.ts to load and use the generated Anchor client
