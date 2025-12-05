import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { HermesClient } from '@pythnetwork/hermes-client';
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

// SOL/USD Feed ID (Pyth Network) - Fallback ID
const FALLBACK_SOL_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

// Liquidation monitoring configuration
const LIQUIDATION_PRICE = parseFloat(process.env.LIQUIDATION_PRICE || '0');
const OPTION_TYPE = (process.env.OPTION_TYPE || 'put').toLowerCase(); // 'call' or 'put'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

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
    policyOwner: PublicKey
): Promise<void> {
    try {
        console.log('📦 Building liquidation transaction...');
        
        // Get PDAs
        const [policyPDA] = getPolicyPDA(policyOwner);
        const [vaultPDA] = getVaultPDA(policyOwner);
        
        // Create transaction
        const transaction = new Transaction();
        
        // Note: Price update instructions would be added here
        // This requires the pyth-solana-receiver package or manual instruction building
        
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
 * Call /resolve endpoint when liquidation condition is met
 */
async function callResolveEndpoint(currentPrice: number, liquidationPrice: number, optionType: string): Promise<void> {
    try {
        const response = await fetch(`${BACKEND_URL}/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                currentPrice: currentPrice,
                liquidationPrice: liquidationPrice,
                optionType: optionType,
                timestamp: new Date().toISOString(),
            }),
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ /resolve endpoint error (${response.status}):`, errorText);
        } else {
            const result = await response.json();
            console.log('✅ /resolve endpoint called successfully:', result);
        }
    } catch (error) {
        console.error('❌ Error calling /resolve endpoint:', error);
    }
}

/**
 * Check if liquidation condition is met based on option type
 */
function checkLiquidationCondition(
    currentPrice: number,
    liquidationPrice: number,
    optionType: string
): boolean {
    if (liquidationPrice <= 0) {
        return false; // No liquidation price set
    }
    
    if (optionType === 'call') {
        // Call option: liquidate if price goes ABOVE liquidation price
        return currentPrice > liquidationPrice;
    } else if (optionType === 'put') {
        // Put option: liquidate if price goes BELOW liquidation price
        return currentPrice < liquidationPrice;
    }
    
    return false;
}

/**
 * Main monitor function
 */
async function main() {
    console.log('🚀 Starting LiqGuard Monitor...');
    console.log(`📊 Demo Mode: ${DEMO_MODE}`);
    console.log(`🌐 RPC: ${RPC_URL}`);
    console.log(`🔗 Backend URL: ${BACKEND_URL}`);
    
    // Display liquidation monitoring config
    if (LIQUIDATION_PRICE > 0) {
        console.log(`\n📊 Liquidation Monitoring:`);
        console.log(`   Liquidation Price: $${LIQUIDATION_PRICE.toFixed(2)}`);
        console.log(`   Option Type: ${OPTION_TYPE.toUpperCase()}`);
        if (OPTION_TYPE === 'call') {
            console.log(`   Condition: Price > $${LIQUIDATION_PRICE.toFixed(2)}`);
        } else {
            console.log(`   Condition: Price < $${LIQUIDATION_PRICE.toFixed(2)}`);
        }
    } else {
        console.log(`\n⚠️  No liquidation price set. Set LIQUIDATION_PRICE env var to enable monitoring.`);
    }
    
    // Setup
    const solanaConnection = new Connection(RPC_URL, 'confirmed');
    const wallet = loadWallet();
    
    console.log(`👛 Wallet: ${wallet.publicKey.toString()}`);
    
    // Initialize Hermes client
    const hermesClient = new HermesClient('https://hermes.pyth.network', {});
    
    // Find SOL/USD price feed ID
    console.log('\n🔍 Finding SOL/USD price feed...');
    const priceFeeds = await hermesClient.getPriceFeeds({
        query: 'sol',
        assetType: 'crypto',
    });
    
    const solUsdFeed = priceFeeds.find((feed: any) => 
        feed.symbol?.toLowerCase().includes('sol') && 
        feed.symbol?.toLowerCase().includes('usd')
    );
    
    // Remove 0x prefix if present
    const foundFeedId = solUsdFeed?.id?.startsWith('0x') 
        ? solUsdFeed.id.slice(2) 
        : solUsdFeed?.id;
    const SOL_FEED_ID = foundFeedId || FALLBACK_SOL_FEED_ID;
    
    if (!solUsdFeed || !solUsdFeed.id) {
        console.log('⚠️  Could not find SOL/USD price feed, using fallback ID');
    } else {
        console.log(`✅ Found SOL/USD feed: ${solUsdFeed.symbol || 'N/A'}`);
    }
    
    console.log(`📡 Subscribing to SOL/USD feed: ${SOL_FEED_ID}\n`);
    
    try {
        // Get streaming price updates using EventSource
        const eventSource = await hermesClient.getPriceUpdatesStream(
            [SOL_FEED_ID],
            { parsed: true } // Request parsed price updates
        );
        
        eventSource.onmessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                
                // Parse price from data.parsed[0].price structure
                let currentPrice: number | null = null;
                let exponent = -8;
                
                if (Array.isArray(data.parsed) && data.parsed.length > 0) {
                    const priceFeed = data.parsed[0];
                    if (priceFeed.price) {
                        const priceObj = priceFeed.price;
                        currentPrice = Number(priceObj.price) * Math.pow(10, priceObj.expo || priceObj.exponent || -8);
                        exponent = priceObj.expo || priceObj.exponent || -8;
                    }
                }
                
                if (currentPrice !== null) {
                    const timestamp = Date.now();
                    
                    // Log price update
                    console.log(`📈 SOL/USD Price: $${currentPrice.toFixed(2)}`);
                    console.log(`   Timestamp: ${new Date(timestamp).toISOString()}`);
                    
                    // Check liquidation condition if configured
                    if (LIQUIDATION_PRICE > 0) {
                        const conditionMet = checkLiquidationCondition(
                            currentPrice,
                            LIQUIDATION_PRICE,
                            OPTION_TYPE
                        );
                        
                        console.log(`   Liquidation Price: $${LIQUIDATION_PRICE.toFixed(2)}`);
                        console.log(`   Condition Met? ${conditionMet ? '✅ YES' : '❌ NO'}`);
                        
                        if (conditionMet) {
                            console.log(`\n🔥 LIQUIDATION TRIGGERED!`);
                            console.log(`   Current Price: $${currentPrice.toFixed(2)}`);
                            console.log(`   Liquidation Price: $${LIQUIDATION_PRICE.toFixed(2)}`);
                            console.log(`   Option Type: ${OPTION_TYPE.toUpperCase()}`);
                            console.log(`   Calling /resolve endpoint...\n`);
                            
                            callResolveEndpoint(currentPrice, LIQUIDATION_PRICE, OPTION_TYPE);
                        }
                    }
                    
                    // Demo mode triggers (for testing)
                    if (DEMO_MODE === 'CRASH') {
                        const conditionMet = currentPrice < CRASH_TRIGGER_PRICE;
                        console.log(`   Demo Trigger: $${CRASH_TRIGGER_PRICE.toLocaleString()}`);
                        console.log(`   Demo Condition Met? ${conditionMet ? '✅ TRUE' : '❌ FALSE'}`);
                    } else if (DEMO_MODE === 'PUMP') {
                        const conditionMet = currentPrice > PUMP_TRIGGER_PRICE;
                        console.log(`   Demo Trigger: $${PUMP_TRIGGER_PRICE.toLocaleString()}`);
                        console.log(`   Demo Condition Met? ${conditionMet ? '✅ TRUE' : '❌ FALSE'}`);
                    }
                    
                    console.log(''); // Empty line for readability
                }
            } catch (error) {
                console.error('❌ Error processing price update:', error);
            }
        };
        
        eventSource.onerror = (error: Event) => {
            console.error('❌ EventSource error:', error);
        };
        
        console.log('✅ Monitor running. Waiting for price updates...\n');
    } catch (error) {
        console.error('💥 Error setting up stream:', error);
        throw error;
    }
}

// Run monitor
main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});

