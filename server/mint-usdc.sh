#!/bin/bash
# Script to mint a fake USDC SPL token on devnet

# Set Solana to devnet (if not already set)
solana config set --url devnet 2>/dev/null || true

# Create a new SPL token with 6 decimals (like USDC)
echo "Creating USDC token mint..."
TOKEN_OUTPUT=$(spl-token create-token --decimals 6 2>&1)
echo "$TOKEN_OUTPUT"

# Extract token mint address from output
TOKEN_MINT=$(echo "$TOKEN_OUTPUT" | grep -i "token" | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1)

if [ -z "$TOKEN_MINT" ]; then
    # Try to get it from the last line
    TOKEN_MINT=$(echo "$TOKEN_OUTPUT" | tail -1 | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1)
fi

if [ -z "$TOKEN_MINT" ]; then
    echo "Error: Could not extract token mint address. Please run manually:"
    echo "  spl-token create-token --decimals 6"
    exit 1
fi

echo "Token mint created: $TOKEN_MINT"

# Create a token account for the default keypair
echo "Creating token account..."
spl-token create-account "$TOKEN_MINT" 2>&1

# Mint 1000000 USDC (1 million with 6 decimals = 1 USDC)
echo "Minting 1000000 USDC tokens..."
spl-token mint "$TOKEN_MINT" 1000000 2>&1

# Check balance
echo ""
echo "Checking balance..."
spl-token balance "$TOKEN_MINT" 2>&1

echo ""
echo "=========================================="
echo "USDC Token Mint: $TOKEN_MINT"
echo "Balance: 1000000 (1 USDC with 6 decimals)"
echo "=========================================="
echo ""
echo "To use this token in your code:"
echo "  paymentMint: new PublicKey(\"$TOKEN_MINT\")"
