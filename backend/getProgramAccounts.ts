import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Program ID
const PROGRAM_ID = new PublicKey('D7hq6vJ7J9BkzZc8iXuGRynsTdXGiRcCWzyBPgPe9FNy');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

/**
 * Policy account structure (from lib.rs):
 * - Discriminator: 8 bytes (Anchor account discriminator)
 * - authority: Pubkey (32 bytes)
 * - nonce: u64 (8 bytes, little-endian)
 * - strike_price: u64 (8 bytes, little-endian)
 * - expiration_datetime: i64 (8 bytes, little-endian)
 * - underlying_asset: UnderlyingAsset (1 byte enum: 0=BTC, 1=ETH, 2=SOL)
 * - call_or_put: CallOrPut (1 byte enum: 0=Call, 1=Put)
 * - coverage_amount: u64 (8 bytes, little-endian)
 * - premium: u64 (8 bytes, little-endian)
 * - payout_wallet: Pubkey (32 bytes)
 * - payment_mint: Pubkey (32 bytes)
 * - status: PolicyStatus (1 byte enum: 0=Inactive, 1=Active)
 * - bump: u8 (1 byte)
 * 
 * Total: 8 + 32 + 8 + 8 + 8 + 1 + 1 + 8 + 8 + 32 + 32 + 1 + 1 = 148 bytes
 */
interface PolicyAccount {
    pubkey: PublicKey;
    authority: PublicKey;
    nonce: number;
    strikePrice: number;
    expirationDatetime: number;
    underlyingAsset: 'BTC' | 'ETH' | 'SOL';
    callOrPut: 'Call' | 'Put';
    coverageAmount: number;
    premium: number;
    payoutWallet: PublicKey;
    paymentMint: PublicKey;
    status: 'Inactive' | 'Active';
    bump: number;
}

/**
 * Decode Policy account data
 */
function decodePolicyAccount(data: Buffer, pubkey: PublicKey): PolicyAccount | null {
    try {
        // Skip Anchor discriminator (8 bytes)
        let offset = 8;

        // Read authority (32 bytes)
        const authorityBytes = data.slice(offset, offset + 32);
        const authority = new PublicKey(authorityBytes);
        offset += 32;

        // Read nonce (u64, 8 bytes, little-endian)
        const nonceBytes = data.slice(offset, offset + 8);
        const nonce = Number(nonceBytes.readBigUInt64LE(0));
        offset += 8;

        // Read strike_price (u64, 8 bytes, little-endian)
        const strikePriceBytes = data.slice(offset, offset + 8);
        const strikePrice = Number(strikePriceBytes.readBigUInt64LE(0));
        offset += 8;

        // Read expiration_datetime (i64, 8 bytes, little-endian)
        const expirationBytes = data.slice(offset, offset + 8);
        const expirationDatetime = Number(expirationBytes.readBigInt64LE(0));
        offset += 8;

        // Read underlying_asset (1 byte enum: 0=BTC, 1=ETH, 2=SOL)
        const underlyingAssetValue = data[offset];
        const underlyingAsset = underlyingAssetValue === 0 ? 'BTC' : underlyingAssetValue === 1 ? 'ETH' : 'SOL';
        offset += 1;

        // Read call_or_put (1 byte enum: 0=Call, 1=Put)
        const callOrPutValue = data[offset];
        const callOrPut = callOrPutValue === 0 ? 'Call' : 'Put';
        offset += 1;

        // Read coverage_amount (u64, 8 bytes, little-endian)
        const coverageAmountBytes = data.slice(offset, offset + 8);
        const coverageAmount = Number(coverageAmountBytes.readBigUInt64LE(0));
        offset += 8;

        // Read premium (u64, 8 bytes, little-endian)
        const premiumBytes = data.slice(offset, offset + 8);
        const premium = Number(premiumBytes.readBigUInt64LE(0));
        offset += 8;

        // Read payout_wallet (32 bytes)
        const payoutWalletBytes = data.slice(offset, offset + 32);
        const payoutWallet = new PublicKey(payoutWalletBytes);
        offset += 32;

        // Read payment_mint (32 bytes)
        const paymentMintBytes = data.slice(offset, offset + 32);
        const paymentMint = new PublicKey(paymentMintBytes);
        offset += 32;

        // Read status (1 byte enum: 0=Inactive, 1=Active)
        const statusValue = data[offset];
        const status = statusValue === 0 ? 'Inactive' : 'Active';
        offset += 1;

        // Read bump (u8, 1 byte)
        const bump = data[offset];

        return {
            pubkey,
            authority,
            nonce,
            strikePrice,
            expirationDatetime,
            underlyingAsset,
            callOrPut,
            coverageAmount,
            premium,
            payoutWallet,
            paymentMint,
            status,
            bump,
        };
    } catch (error) {
        console.error('Error decoding policy account:', error);
        return null;
    }
}

/**
 * Get all Policy accounts from the program
 * Returns an array of PolicyAccount objects with strike prices
 */
export async function getProgramAccounts(): Promise<PolicyAccount[]> {
    const connection = new Connection(RPC_URL, 'confirmed');

    try {
        console.log(`🔍 Fetching all Policy accounts for program: ${PROGRAM_ID.toString()}`);

        // Get all accounts owned by the program
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
            filters: [
                {
                    // Filter by data size: 8 (discriminator) + Policy::LEN
                    // Policy::LEN = 32 + 8 + 8 + 8 + 1 + 1 + 8 + 8 + 32 + 32 + 1 + 1 = 140
                    dataSize: 8 + 140, // 148 bytes total
                },
            ],
        });

        console.log(`✅ Found ${accounts.length} Policy account(s)`);

        // Decode each account
        const policyAccounts: PolicyAccount[] = [];

        for (const account of accounts) {
            const decoded = decodePolicyAccount(account.account.data, account.pubkey);
            if (decoded) {
                policyAccounts.push(decoded);
            }
        }

        return policyAccounts;
    } catch (error) {
        console.error('Error fetching program accounts:', error);
        throw error;
    }
}

/**
 * Get only strike prices from all Policy accounts
 */
export async function getStrikePrices(): Promise<number[]> {
    const accounts = await getProgramAccounts();
    return accounts.map(account => account.strikePrice);
}

/**
 * Get Policy accounts with detailed information
 */
export async function getPolicyAccountsDetailed(): Promise<PolicyAccount[]> {
    return await getProgramAccounts();
}

// Run if executed directly as a script
(async () => {
    // Only run if this file is executed directly (not imported)
    // Check if the script name includes 'getProgramAccounts'
    const scriptName = process.argv[1] || '';
    if (!scriptName.includes('getProgramAccounts')) {
        return; // Don't run if imported as a module
    }
    
    try {
        const accounts = await getProgramAccounts();
        
        // Output as JSON for API consumption
        if (process.argv.includes('--json')) {
            console.log(JSON.stringify({
                success: true,
                count: accounts.length,
                accounts: accounts.map(acc => ({
                    pubkey: acc.pubkey.toString(),
                    authority: acc.authority.toString(),
                    nonce: acc.nonce,
                    strikePrice: acc.strikePrice,
                    expirationDatetime: acc.expirationDatetime,
                    underlyingAsset: acc.underlyingAsset,
                    callOrPut: acc.callOrPut,
                    coverageAmount: acc.coverageAmount,
                    premium: acc.premium,
                    payoutWallet: acc.payoutWallet.toString(),
                    paymentMint: acc.paymentMint.toString(),
                    status: acc.status,
                    bump: acc.bump,
                })),
                strikePrices: accounts.map(acc => acc.strikePrice),
            }, null, 2));
        } else {
            // Human-readable output
            console.log('\n📊 Policy Accounts Summary:');
            console.log('='.repeat(80));
            
            if (accounts.length === 0) {
                console.log('No Policy accounts found.');
            } else {
                accounts.forEach((account, index) => {
                    console.log(`\nPolicy ${index + 1}:`);
                    console.log(`  Account: ${account.pubkey.toString()}`);
                    console.log(`  Authority: ${account.authority.toString()}`);
                    console.log(`  Nonce: ${account.nonce}`);
                    console.log(`  Strike Price: $${account.strikePrice.toLocaleString()}`);
                    console.log(`  Expiration: ${new Date(account.expirationDatetime * 1000).toISOString()}`);
                    console.log(`  Underlying Asset: ${account.underlyingAsset}`);
                    console.log(`  Type: ${account.callOrPut}`);
                    console.log(`  Coverage Amount: ${account.coverageAmount.toLocaleString()}`);
                    console.log(`  Premium: ${account.premium.toLocaleString()}`);
                    console.log(`  Payout Wallet: ${account.payoutWallet.toString()}`);
                    console.log(`  Payment Mint: ${account.paymentMint.toString()}`);
                    console.log(`  Status: ${account.status}`);
                });
                
                console.log('\n' + '='.repeat(80));
                console.log(`\n💰 Strike Prices: ${accounts.map(a => `$${a.strikePrice.toLocaleString()}`).join(', ')}`);
            }
        }
    } catch (error) {
        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        
        if (process.argv.includes('--json')) {
            console.log(JSON.stringify(errorResponse, null, 2));
        } else {
            console.error('Failed to fetch program accounts:', error);
        }
        process.exit(1);
    }
})();

