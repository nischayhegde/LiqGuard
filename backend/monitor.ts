import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { HermesClient } from '@pythnetwork/hermes-client';
import { 
    addPostPriceUpdates, 
    PriceUpdateAccount, 
    PriceFeedUpdateData 
} from '@pythnetwork/pyth-solana-receiver';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const DEMO_MODE = process.env.DEMO_MODE || 'CRASH'; // 'CRASH' or 'PUMP'
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const PYTH_PRICE_UPDATE_ACCOUNT = new PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'); // Pyth Price Update account on Devnet

// BTC/USD Feed ID
const BTC_FEED_ID = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

// Demo trigger prices
const CRASH_TRIGGER_PRICE = 100000; // Trigger when Price < 100,000 (Long getting wrecked)
const PUMP_TRIGGER_PRICE = 90000;  // Trigger when Price > 90,000 (Short getting wrecked)

interface PriceData {
    price: number;
    timestamp: number;
}

/**
 * Normalize Pyth price from i64 + exponent to USD
 * Example: price = 9500000000000, expo = -8 -> 95000
 */
function normalizePrice(price: bigint, exponent: number): number {
    const priceMagnitude = Number(price);
    const normalizationFactor = Math.pow(10, Math.abs(exponent));
    return priceMagnitude / normalizationFactor;
}

/**
 * Load wallet from private key
 */
function loadWallet(): Keypair {
    if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY environment variable is required');
    }
    
    // Handle both array format and base58 string
    let secretKey: Uint8Array;
    if (PRIVATE_KEY.startsWith('[')) {
        // Array format: [1,2,3,...]
        secretKey = Uint8Array.from(JSON.parse(PRIVATE_KEY));
    } else {
        // Base58 string
        const bs58 = require('bs58');
        secretKey = bs58.decode(PRIVATE_KEY);
    }
    
    return Keypair.fromSecretKey(secretKey);
}

/**
 * Get policy PDA
 */
function getPolicyPDA(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('policy'), owner.toBuffer()],
        PROGRAM_ID
    );
}

/**
 * Get vault PDA
 */
function getVaultPDA(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), owner.toBuffer()],
        PROGRAM_ID
    );
}

/**
 * Check if liquidation condition is met
 */
function shouldLiquidate(
    currentPrice: number,
    strikePrice: number,
    isLongInsurance: boolean,
    demoMode: string
): boolean {
    // In demo mode, use demo triggers
    if (demoMode === 'CRASH') {
        return currentPrice < CRASH_TRIGGER_PRICE;
    } else if (demoMode === 'PUMP') {
        return currentPrice > PUMP_TRIGGER_PRICE;
    }
    
    // Normal mode: use policy logic
    if (isLongInsurance) {
        // Protect Long: Pay if price drops below strike
        return currentPrice < strikePrice;
    } else {
        // Protect Short: Pay if price rises above strike
        return currentPrice > strikePrice;
    }
}

/**
 * Execute liquidation transaction
 */
async function executeLiquidation(
    connection: Connection,
    wallet: Keypair,
    policyOwner: PublicKey,
    priceUpdateData: PriceFeedUpdateData[]
): Promise<void> {
    try {
        console.log('📦 Building liquidation transaction...');
        
        // Get PDAs
        const [policyPDA] = getPolicyPDA(policyOwner);
        const [vaultPDA] = getVaultPDA(policyOwner);
        
        // Create transaction
        const transaction = new Transaction();
        
        // Add Pyth price update instruction
        const priceUpdateIx = await addPostPriceUpdates(
            connection,
            PYTH_PRICE_UPDATE_ACCOUNT,
            priceUpdateData
        );
        transaction.add(...priceUpdateIx);
        
        // Add liquidation instruction
        // Note: You'll need to load your IDL and create the instruction
        // This is a placeholder - you'll need to generate the client from your IDL
        const provider = new AnchorProvider(
            connection,
            new Wallet(wallet),
            { commitment: 'confirmed' }
        );
        
        // Load program (you'll need to generate this from your IDL)
        // const program = new Program(idl, PROGRAM_ID, provider);
        // const liquidateIx = await program.methods
        //     .liquidatePolicy()
        //     .accounts({
        //         policy: policyPDA,
        //         priceUpdate: PYTH_PRICE_UPDATE_ACCOUNT,
        //         vault: vaultPDA,
        //         user: policyOwner,
        //         signer: wallet.publicKey,
        //         systemProgram: SystemProgram.programId,
        //     })
        //     .instruction();
        // transaction.add(liquidateIx);
        
        // For now, log what would happen
        console.log('⚠️  Transaction building requires generated Anchor client from IDL');
        console.log('   Policy PDA:', policyPDA.toString());
        console.log('   Vault PDA:', vaultPDA.toString());
        console.log('   User:', policyOwner.toString());
        
        // Send transaction (commented out until IDL client is generated)
        // const signature = await sendAndConfirmTransaction(
        //     connection,
        //     transaction,
        //     [wallet],
        //     { commitment: 'confirmed' }
        // );
        // console.log('✅ Liquidation executed! Signature:', signature);
        
    } catch (error) {
        console.error('❌ Error executing liquidation:', error);
        throw error;
    }
}

/**
 * Main monitor function
 */
async function main() {
    console.log('🚀 Starting LiqGuard Monitor...');
    console.log(`📊 Demo Mode: ${DEMO_MODE}`);
    console.log(`🌐 RPC: ${RPC_URL}`);
    
    // Setup
    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = loadWallet();
    
    console.log(`👛 Wallet: ${wallet.publicKey.toString()}`);
    
    // Initialize Hermes client
    const hermesClient = new HermesClient('https://hermes.pyth.network');
    
    // Subscribe to BTC/USD price feed
    console.log(`📡 Subscribing to BTC/USD feed: ${BTC_FEED_ID}`);
    
    hermesClient.subscribePriceFeedUpdates([BTC_FEED_ID], (priceFeedUpdate) => {
        try {
            // Extract price data
            const priceInfo = priceFeedUpdate.priceFeed.price;
            if (!priceInfo) {
                console.log('⚠️  No price data available');
                return;
            }
            
            // Normalize price
            const currentPrice = normalizePrice(
                priceInfo.price,
                priceInfo.exponent
            );
            
            const timestamp = Date.now();
            
            // Log price update
            console.log('\n📈 Price Update:');
            console.log(`   BTC Price: $${currentPrice.toLocaleString()}`);
            console.log(`   Timestamp: ${new Date(timestamp).toISOString()}`);
            
            // Demo mode triggers
            if (DEMO_MODE === 'CRASH') {
                const conditionMet = currentPrice < CRASH_TRIGGER_PRICE;
                console.log(`   Trigger: $${CRASH_TRIGGER_PRICE.toLocaleString()}`);
                console.log(`   Condition Met? ${conditionMet ? '✅ TRUE' : '❌ FALSE'}`);
                
                if (conditionMet) {
                    console.log('🔥 CRASH MODE: Triggering liquidation...');
                    // In real implementation, you would:
                    // 1. Fetch all active policies
                    // 2. Check each policy's conditions
                    // 3. Execute liquidations for matching policies
                }
            } else if (DEMO_MODE === 'PUMP') {
                const conditionMet = currentPrice > PUMP_TRIGGER_PRICE;
                console.log(`   Trigger: $${PUMP_TRIGGER_PRICE.toLocaleString()}`);
                console.log(`   Condition Met? ${conditionMet ? '✅ TRUE' : '❌ FALSE'}`);
                
                if (conditionMet) {
                    console.log('🚀 PUMP MODE: Triggering liquidation...');
                    // Same as above
                }
            }
            
            // In production, you would:
            // 1. Query all active policies from on-chain
            // 2. For each policy, check if liquidation condition is met
            // 3. If yes, bundle addPostPriceUpdates + liquidate_policy
            // 4. Send transaction
            
        } catch (error) {
            console.error('❌ Error processing price update:', error);
        }
    });
    
    console.log('✅ Monitor running. Waiting for price updates...');
}

// Run monitor
main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});

