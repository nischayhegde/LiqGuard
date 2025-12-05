import { HermesClient } from '@pythnetwork/hermes-client';

/**
 * Simple script to log SOL/USD price from Pyth Network websocket
 */
async function logSolPrice() {
    console.log('🚀 Starting SOL Price Logger...');
    
    // Initialize Hermes client
    const connection = new HermesClient('https://hermes.pyth.network', {});
    
    // First, find SOL/USD price feed ID
    console.log('🔍 Finding SOL/USD price feed...');
    const priceFeeds = await connection.getPriceFeeds({
        query: 'sol',
        assetType: 'crypto',
    });
    
    // Log all feeds found for debugging
    console.log(`Found ${priceFeeds.length} feeds matching 'sol':`);
    priceFeeds.forEach((feed, idx) => {
        console.log(`  ${idx + 1}. ID: ${feed.id}, Symbol: ${feed.symbol || 'N/A'}, Asset Type: ${feed.asset_type || 'N/A'}`);
    });
    
    // Find SOL/USD feed - try multiple ways
    let solUsdFeed = priceFeeds.find(feed => 
        feed.symbol?.toLowerCase() === 'sol/usd' || 
        feed.symbol?.toLowerCase() === 'solusd' ||
        (feed.symbol?.toLowerCase().includes('sol') && feed.symbol?.toLowerCase().includes('usd'))
    );
    
    // If not found, use the feed ID that looks like SOL/USD (usually the one ending in b56d)
    if (!solUsdFeed) {
        solUsdFeed = priceFeeds.find(feed => feed.id?.endsWith('b56d'));
    }
    
    // Fallback to known SOL/USD feed ID (without 0x prefix)
    const FALLBACK_SOL_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
    const SOL_FEED_ID = solUsdFeed?.id || FALLBACK_SOL_FEED_ID;
    
    if (solUsdFeed) {
        console.log(`\n✅ Using SOL/USD feed: ${SOL_FEED_ID}`);
        if (solUsdFeed.symbol) {
            console.log(`   Symbol: ${solUsdFeed.symbol}`);
        }
    } else {
        console.log(`\n⚠️  Using fallback SOL/USD feed ID: ${SOL_FEED_ID}`);
    }
    
    await startStreaming(connection, SOL_FEED_ID);
}

async function startStreaming(connection: HermesClient, feedId: string) {
    console.log(`📡 Starting stream for feed: ${feedId}\n`);
    
    try {
        // First, try to get latest price to verify feed ID works
        console.log('🔍 Verifying feed ID...');
        try {
            const latestPrice = await connection.getLatestPriceUpdates([feedId], { parsed: true });
            console.log('✅ Feed ID verified! Latest price data received.');
            if (latestPrice.parsed && latestPrice.parsed.length > 0) {
                const priceFeed = latestPrice.parsed[0];
                if (priceFeed.price_feed?.price?.price) {
                    const priceInfo = priceFeed.price_feed.price.price;
                    const exponent = priceInfo.expo || priceInfo.exponent || -8;
                    const currentPrice = Number(priceInfo.price) * Math.pow(10, exponent);
                    console.log(`   Current SOL/USD Price: $${currentPrice.toFixed(2)}\n`);
                }
            }
        } catch (verifyError) {
            console.log(`⚠️  Could not verify feed ID: ${verifyError}`);
        }
        
        // Get streaming price updates using EventSource
        // Remove 0x prefix if present
        const cleanFeedId = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
        const eventSource = await connection.getPriceUpdatesStream(
            [cleanFeedId],
            { parsed: true } // Request parsed price updates
        );
        
        let firstUpdate = true;
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Log the full structure first time to understand the format
                if (firstUpdate) {
                    console.log('📦 First update - Full data structure:');
                    console.log(JSON.stringify(data, null, 2));
                    console.log('');
                    firstUpdate = false;
                }
                
                // Handle price update - structure is data.parsed[0].price
                let priceValue = null;
                let exponent = -8; // default
                let confidence = null;
                
                // The actual structure: data.parsed is an array, each item has id, price, ema_price, metadata
                if (Array.isArray(data.parsed) && data.parsed.length > 0) {
                    const priceFeed = data.parsed[0];
                    
                    // The price object should have: price, expo, conf
                    if (priceFeed.price) {
                        const priceObj = priceFeed.price;
                        priceValue = priceObj.price;
                        exponent = priceObj.expo || priceObj.exponent || -8;
                        if (priceObj.conf !== undefined) {
                            confidence = priceObj.conf;
                        }
                    }
                }
                
                if (priceValue !== null && priceValue !== undefined) {
                    // Normalize price
                    const currentPrice = Number(priceValue) * Math.pow(10, exponent);
                    
                    // Log SOL price to console
                    console.log(`💰 SOL/USD Price: $${currentPrice.toFixed(2)}`);
                    console.log(`   Timestamp: ${new Date().toISOString()}`);
                    
                    if (confidence !== null && confidence !== undefined) {
                        const confidenceValue = Number(confidence) * Math.pow(10, exponent);
                        console.log(`   Confidence: ±$${confidenceValue.toFixed(2)}`);
                    }
                    console.log(''); // Empty line for readability
                } else {
                    // Log what we found for debugging
                    console.log('⚠️  Could not parse price from update');
                    if (Array.isArray(data.parsed) && data.parsed[0]) {
                        console.log('   First parsed item:', JSON.stringify(data.parsed[0], null, 2));
                    }
                }
            } catch (error) {
                console.error('❌ Error processing price update:', error);
            }
        };
        
        eventSource.onerror = (error) => {
            console.error('❌ EventSource error:', error);
        };
        
        console.log('✅ Monitor running. Waiting for SOL price updates...\n');
        
    } catch (error) {
        console.error('💥 Error setting up stream:', error);
        process.exit(1);
    }
}

// Run logger
logSolPrice().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});

