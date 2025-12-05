import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { HermesClient } from '@pythnetwork/hermes-client';
import dotenv from 'dotenv';

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

// Global state
let currentSolPrice: number | null = null;
let currentEthPrice: number | null = null;
const activePolicies: Array<{
  id: string;
  liquidationPrice: number;
  optionType: string;
  insuranceAmount: number;
  expirationDate?: string;
  userWalletAddress: string;
  premiumPaid: boolean;
  createdAt: string;
  status: string;
}> = [];

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
            
            // Check liquidation conditions
            for (const policy of activePolicies) {
              if (policy.status !== 'active') continue;
              
              const liquidationPrice = policy.liquidationPrice;
              const optionType = policy.optionType;
              
              let conditionMet = false;
              if (optionType === 'call') {
                conditionMet = normalizedPrice > liquidationPrice;
              } else if (optionType === 'put') {
                conditionMet = normalizedPrice < liquidationPrice;
              }
              
              if (conditionMet) {
                console.log(`\n🔥 LIQUIDATION TRIGGERED! Policy: ${policy.id}`);
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

async function resolveLiquidation(policy: typeof activePolicies[0], currentPrice: number) {
  try {
    if (!senderWallet || !provider) {
      console.error('❌ Sender wallet not initialized');
      return;
    }
    
    const userAddress = policy.userWalletAddress;
    const insuranceAmount = policy.insuranceAmount;
    
    // Convert USD to ETH (simplified - in production use oracle or USDC)
    const ethPrice = currentSolPrice || 2000; // Use SOL price as proxy for ETH
    const amountInEth = insuranceAmount / ethPrice;
    const amountWei = ethers.parseEther(amountInEth.toFixed(18));
    
    console.log(`💰 Sending payout:`);
    console.log(`   To: ${userAddress}`);
    console.log(`   Amount: $${insuranceAmount} (≈ ${amountInEth.toFixed(6)} ETH)`);
    
    // Send transaction
    const tx = await senderWallet.sendTransaction({
      to: userAddress,
      value: amountWei,
    });
    
    console.log(`   Transaction: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt) {
      console.log(`✅ Payout sent! Block: ${receipt.blockNumber}`);
    }
    
    // Update policy status
    const policyIndex = activePolicies.findIndex(p => p.id === policy.id);
    if (policyIndex !== -1) {
      const updatedPolicy = {
        ...activePolicies[policyIndex],
        status: 'resolved' as const,
        resolvedAt: new Date().toISOString(),
        payoutAmount: insuranceAmount,
        payoutTxHash: tx.hash,
      };
      activePolicies[policyIndex] = updatedPolicy;
    }
  } catch (error) {
    console.error('❌ Error sending payout:', error);
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    currentSolPrice,
    activePolicies: activePolicies.length
  });
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
    
    const policyId = `policy_${Date.now()}`;
    const policy = {
      id: policyId,
      liquidationPrice,
      optionType,
      insuranceAmount,
      expirationDate,
      userWalletAddress,
      premiumPaid,
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    
    activePolicies.push(policy);
    
    console.log(`✅ Registered policy ${policyId} for monitoring`);
    console.log(`   User: ${userWalletAddress}`);
    console.log(`   Liquidation: $${liquidationPrice}, Type: ${optionType}`);
    
    res.json({
      status: 'registered',
      policyId,
      message: 'Policy registered for monitoring'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/active-policies', (req, res) => {
  res.json({
    policies: activePolicies,
    count: activePolicies.length
  });
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

