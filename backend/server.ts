import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { HermesClient } from '@pythnetwork/hermes-client';
import dotenv from 'dotenv';
import { dbOperations, type Policy } from './database.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 5000;
// Base mainnet RPC URL
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org'; // Base mainnet (default)
const SENDER_WALLET_PRIVATE_KEY = process.env.SENDER_WALLET_PRIVATE_KEY || '';
const SENDER_WALLET_ADDRESS = process.env.SENDER_WALLET_ADDRESS || '';
// USDC contract address on Base mainnet
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// USDC ABI (minimal - just transfer function)
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

// Global state
let currentSolPrice: number | null = null;
let currentEthPrice: number | null = null;

// Initialize provider and wallet
let provider: ethers.JsonRpcProvider | null = null;
let senderWallet: ethers.Wallet | null = null;

if (RPC_URL && SENDER_WALLET_PRIVATE_KEY) {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    senderWallet = new ethers.Wallet(SENDER_WALLET_PRIVATE_KEY, provider);
    const senderAddress = SENDER_WALLET_ADDRESS || senderWallet.address;
    console.log(`✅ Sender wallet initialized: ${senderAddress}`);
    console.log(`\n   This address will:`);
    console.log(`   - RECEIVE premium payments from users`);
    console.log(`   - SEND payouts to users when liquidation conditions are met\n`);
  } catch (error) {
    console.error('❌ Error initializing sender wallet:', error);
    console.warn('⚠️  Payout functionality will be disabled');
  }
} else {
  console.warn('⚠️  SENDER_WALLET_PRIVATE_KEY not set - payout functionality disabled');
  console.warn('   Set SENDER_WALLET_PRIVATE_KEY in backend/.env to enable payouts');
}

// Math functions (same as Python backend)
function normalCdf(x: number): number {
  return 0.5 * (1.0 + erf(x / Math.sqrt(2.0)));
}

function erf(x: number): number {
  // Approximation of error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

function touchProbDown(spot: number, barrier: number, T: number, sigma: number): number {
  if (barrier >= spot) {
    throw new Error('For down-touch, barrier must be < spot.');
  }
  if (T <= 0 || sigma <= 0) {
    throw new Error('T and sigma must be positive.');
  }
  
  const z = Math.log(barrier / spot) / (sigma * Math.sqrt(T));
  return 2.0 * normalCdf(z);
}

function touchProbUp(spot: number, barrier: number, T: number, sigma: number): number {
  if (barrier <= spot) {
    throw new Error('For up-touch, barrier must be > spot.');
  }
  if (T <= 0 || sigma <= 0) {
    throw new Error('T and sigma must be positive.');
  }
  
  const z = Math.log(barrier / spot) / (sigma * Math.sqrt(T));
  return 2.0 * normalCdf(-z);
}

function oneTouchPremium(
  spot: number,
  barrier: number,
  daysToExpiry: number,
  coverage: number,
  sigma: number,
  r: number = 0.0,
  daysInYear: number = 365.0
): number {
  const T = daysToExpiry / daysInYear;
  
  let pTouch: number;
  if (barrier < spot) {
    pTouch = touchProbDown(spot, barrier, T, sigma);
  } else if (barrier > spot) {
    pTouch = touchProbUp(spot, barrier, T, sigma);
  } else {
    pTouch = 1.0;
  }
  
  const premium = coverage * Math.exp(-r * T) * pTouch;
  return premium;
}

function calculatePremium(
  insuranceAmount: number,
  liquidationPrice: number,
  currentPrice: number,
  volatility: number = 0.3,
  riskFreeRate: number = 0.05,
  daysToExpiration: number = 30
): number {
  if (insuranceAmount <= 0 || currentPrice <= 0) {
    return 0;
  }
  
  const barrierPrice = liquidationPrice > 0 ? liquidationPrice : currentPrice * 0.9;
  
  try {
    const premium = oneTouchPremium(
      currentPrice,
      barrierPrice,
      daysToExpiration,
      insuranceAmount,
      volatility,
      riskFreeRate,
      365.0
    );
    
    // Add 20% vig
    return Math.round(premium * 1.20 * 10000) / 10000;
  } catch (error) {
    console.error('Error calculating premium:', error);
    if (barrierPrice >= currentPrice) {
      return insuranceAmount * 0.95;
    }
    return 0;
  }
}

// Start price monitoring for SOL and ETH
async function startPriceMonitoring() {
  const hermesClient = new HermesClient('https://hermes.pyth.network', {});
  const SOL_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
  // ETH/USD Feed ID (Pyth Network)
  const ETH_FEED_ID = 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
  
  console.log('🚀 Starting price monitors...');
  
  // Monitor SOL price
  setInterval(async () => {
    try {
      const url = `https://hermes.pyth.network/api/latest_price_feeds`;
      const params = new URLSearchParams({
        'ids[]': SOL_FEED_ID,
        'parsed': 'true'
      });
      
      const response = await fetch(`${url}?${params}`);
      if (response.ok) {
        const data = await response.json();
        
        if (Array.isArray(data) && data.length > 0) {
          const priceFeed = data[0];
          if (priceFeed.price) {
            const priceObj = priceFeed.price;
            const priceValue = priceObj.price;
            const exponent = priceObj.expo || -8;
            const normalizedPrice = Number(priceValue) * Math.pow(10, exponent);
            
            currentSolPrice = normalizedPrice;
            console.log(`💰 SOL/USD Price: $${normalizedPrice.toFixed(2)}`);
            
            // Check liquidation conditions from database
            const policiesToCheck = dbOperations.getPoliciesToMonitor();
            
            for (const policy of policiesToCheck) {
              const strikePrice = policy.strikePrice;
              const optionType = policy.optionType;
              
              let conditionMet = false;
              if (optionType === 'call') {
                conditionMet = normalizedPrice > strikePrice;
              } else if (optionType === 'put') {
                conditionMet = normalizedPrice < strikePrice;
              }
              
              if (conditionMet) {
                console.log(`\n🔥 LIQUIDATION TRIGGERED! Policy: ${policy.id}`);
                console.log(`   Strike: $${strikePrice}, Current: $${normalizedPrice.toFixed(2)}, Type: ${optionType}`);
                await resolveLiquidation(policy, normalizedPrice);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching SOL price:', error);
    }
  }, 5000);

  // Monitor ETH price
  setInterval(async () => {
    try {
      const url = `https://hermes.pyth.network/api/latest_price_feeds`;
      const params = new URLSearchParams({
        'ids[]': ETH_FEED_ID,
        'parsed': 'true'
      });
      
      const response = await fetch(`${url}?${params}`);
      if (response.ok) {
        const data = await response.json();
        
        if (Array.isArray(data) && data.length > 0) {
          const priceFeed = data[0];
          if (priceFeed.price) {
            const priceObj = priceFeed.price;
            const priceValue = priceObj.price;
            const exponent = priceObj.expo || -8;
            const normalizedPrice = Number(priceValue) * Math.pow(10, exponent);
            
            currentEthPrice = normalizedPrice;
            console.log(`💰 ETH/USD Price: $${normalizedPrice.toFixed(2)}`);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching ETH price:', error);
    }
  }, 5000);
}

async function resolveLiquidation(policy: Policy, currentPrice: number) {
  try {
    if (!senderWallet || !provider) {
      console.error('❌ Sender wallet not initialized');
      return;
    }
    
    const userAddress = policy.userWalletAddress;
    const insuranceAmount = policy.insuranceAmount;
    
    // Check ETH balance for gas fees first
    const ethBalance = await provider.getBalance(senderWallet.address);
    const minEthForGas = ethers.parseEther('0.001'); // Minimum 0.001 ETH for gas
    console.log(`   Backend ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    if (ethBalance < minEthForGas) {
      console.error(`❌ Insufficient ETH for gas fees. Need at least 0.001 ETH, have ${ethers.formatEther(ethBalance)} ETH`);
      console.error(`   Please fund the backend wallet (${senderWallet.address}) with ETH on Base network`);
      return;
    }
    
    // Convert USD to USDC (USDC has 6 decimals)
    const amountInUSDC = ethers.parseUnits(insuranceAmount.toFixed(6), 6);
    
    console.log(`💰 Sending USDC payout:`);
    console.log(`   To: ${userAddress}`);
    console.log(`   Amount: $${insuranceAmount} USDC`);
    
    // Get USDC contract instance
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, senderWallet);
    
    // Check USDC balance
    const balance = await usdcContract.balanceOf(senderWallet.address);
    console.log(`   Backend USDC balance: ${ethers.formatUnits(balance, 6)} USDC`);
    
    if (balance < amountInUSDC) {
      console.error(`❌ Insufficient USDC balance. Need ${insuranceAmount} USDC, have ${ethers.formatUnits(balance, 6)} USDC`);
      return;
    }
    
    // Send USDC transfer transaction
    const tx = await usdcContract.transfer(userAddress, amountInUSDC);
    
    console.log(`   Transaction: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt) {
      console.log(`✅ USDC payout sent! Block: ${receipt.blockNumber}`);
    }
    
    // Update policy status in database
    dbOperations.markPolicyResolved(policy.id, tx.hash);
    console.log(`✅ Policy ${policy.id} marked as resolved in database`);
    
    // If Solana policy account address is set, call Solana smart contract to close policy
    // This would require Solana web3.js and Anchor client setup
    if (policy.policyAccountAddress) {
      console.log(`📞 Solana policy account: ${policy.policyAccountAddress}`);
      console.log(`   To integrate: Use @solana/web3.js and Anchor client to call close_policy with payout=true`);
      // Example integration:
      // const connection = new Connection(SOLANA_RPC_URL);
      // const program = new Program(idl, PROGRAM_ID, provider);
      // await program.methods.closePolicy(true).accounts({...}).rpc();
    }
  } catch (error) {
    console.error('❌ Error sending payout:', error);
  }
}

// Routes
app.get('/health', (req, res) => {
  try {
    const activePolicies = dbOperations.getActivePolicies();
    res.json({
      status: 'healthy',
      currentSolPrice,
      activePolicies: activePolicies.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/current-price', (req, res) => {
  if (currentSolPrice === null) {
    return res.status(503).json({ error: 'Price not available yet' });
  }
  res.json({ price: currentSolPrice });
});

app.get('/eth-price', (req, res) => {
  if (currentEthPrice === null) {
    return res.status(503).json({ error: 'ETH price not available yet' });
  }
  res.json({ price: currentEthPrice });
});

app.get('/backend-wallet-address', (req, res) => {
  if (!senderWallet) {
    return res.status(503).json({ 
      error: 'Backend wallet not initialized',
      message: 'SENDER_WALLET_PRIVATE_KEY not set in backend .env file'
    });
  }
  const address = SENDER_WALLET_ADDRESS || senderWallet.address;
  res.json({ address });
});

app.post('/calculate-risk', (req, res) => {
  try {
    const {
      liquidationPrice = 0,
      insuranceAmount = 0,
      currentAssetPrice = 0,
      optionType = 'call',
      expirationDate,
      volatility = 0.3,
      riskFreeRate = 0.05
    } = req.body;
    
    if (insuranceAmount <= 0 || currentAssetPrice <= 0) {
      return res.status(400).json({ error: 'Insurance amount and current asset price must be greater than 0' });
    }
    
    const expiration = expirationDate ? new Date(expirationDate) : new Date();
    expiration.setDate(expiration.getDate() + 30);
    const daysToExpiration = Math.max(Math.ceil((expiration.getTime() - Date.now()) / (1000 * 60 * 60 * 24)), 0);
    
    const premium = calculatePremium(
      insuranceAmount,
      liquidationPrice,
      currentAssetPrice,
      volatility,
      riskFreeRate,
      daysToExpiration
    );
    
    res.json({
      premium,
      optionPrice: premium,
      currentAssetPrice,
      strikePrice: liquidationPrice || currentAssetPrice * 0.9,
      timeToExpiration: daysToExpiration,
      volatility,
      riskFreeRate
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/pay-premium', (req, res) => {
  try {
    const { userWalletAddress, premiumAmount, transactionSignature } = req.body;
    
    if (!userWalletAddress) {
      return res.status(400).json({ error: 'User wallet address is required' });
    }
    
    console.log(`✅ Premium payment received from ${userWalletAddress}: $${premiumAmount}`);
    console.log(`   Transaction: ${transactionSignature}`);
    
    // Update premium amount in database if policy exists
    // This will be handled when policy is registered
    
    res.json({
      status: 'paid',
      message: 'Premium payment confirmed',
      premiumAmount,
      userWalletAddress
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/register-policy', (req, res) => {
  try {
    const {
      liquidationPrice,
      optionType = 'put',
      insuranceAmount,
      expirationDate,
      userWalletAddress,
      premiumPaid = false
    } = req.body;
    
    if (liquidationPrice <= 0) {
      return res.status(400).json({ error: 'Liquidation price must be greater than 0' });
    }
    
    if (!userWalletAddress) {
      return res.status(400).json({ error: 'User wallet address is required' });
    }
    
    if (!premiumPaid) {
      return res.status(400).json({ error: 'Premium must be paid before registering policy' });
    }
    
    // Get premium amount from request or calculate it
    // For now, we'll use a default or get it from the request
    const premiumAmount = req.body.premiumAmount || 0;
    
    // Save to database
    const policy = dbOperations.createPolicy({
      userWalletAddress: userWalletAddress.toLowerCase(),
      strikePrice: liquidationPrice,
      optionType: optionType as 'call' | 'put',
      insuranceAmount,
      premiumAmount: premiumAmount,
      expirationDate: expirationDate || null,
      status: 'active',
      premiumPaid: true,
    });
    
    console.log(`✅ Registered policy ${policy.id} for monitoring`);
    console.log(`   User: ${userWalletAddress}`);
    console.log(`   Liquidation: $${liquidationPrice}, Type: ${optionType}`);
    console.log(`   Saved to database`);
    
    res.json({
      status: 'registered',
      policyId: policy.id,
      message: 'Policy registered for monitoring'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/active-policies', (req, res) => {
  try {
    const policies = dbOperations.getActivePolicies();
    res.json({
      policies: policies.map(p => ({
        id: p.id,
        liquidationPrice: p.strikePrice,
        optionType: p.optionType,
        insuranceAmount: p.insuranceAmount,
        expirationDate: p.expirationDate,
        userWalletAddress: p.userWalletAddress,
        premiumPaid: p.premiumPaid,
        createdAt: p.createdAt,
        status: p.status
      })),
      count: policies.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/user-policies', (req, res) => {
  try {
    const userAddress = req.query.address as string;
    
    if (!userAddress) {
      return res.status(400).json({ error: 'User wallet address is required' });
    }
    
    // Fetch from database
    const userPolicies = dbOperations.getUserPolicies(userAddress, 'active');
    
    console.log(`🔍 Fetched ${userPolicies.length} active policies for user: ${userAddress}`);
    
    res.json({
      policies: userPolicies.map(p => ({
        id: p.id,
        liquidationPrice: p.strikePrice,
        optionType: p.optionType,
        insuranceAmount: p.insuranceAmount,
        expirationDate: p.expirationDate,
        userWalletAddress: p.userWalletAddress,
        premiumPaid: p.premiumPaid,
        createdAt: p.createdAt,
        status: p.status,
        resolvedAt: p.resolvedAt,
        payoutTxHash: p.payoutTxHash
      })),
      count: userPolicies.length,
      userAddress: userAddress
    });
  } catch (error: any) {
    res.status(500).json({ error: `Error fetching user policies: ${error.message}` });
  }
});

app.post('/resolve', (req, res) => {
  // This endpoint is called by the monitor when liquidation is detected
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  startPriceMonitoring();
});

