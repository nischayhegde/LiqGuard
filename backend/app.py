from flask import Flask, request, jsonify
from flask_cors import CORS
import math
import threading
import requests
import json
import time
import os
import base58
from datetime import datetime
from typing import Dict, List, Optional

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend communication

# Solana configuration
SOLANA_RPC_URL = os.getenv('SOLANA_RPC_URL', 'https://api.devnet.solana.com')
SENDER_WALLET_PRIVATE_KEY = os.getenv('SENDER_WALLET_PRIVATE_KEY', '')  # Base58 encoded private key

# Global state for price monitoring
current_sol_price: Optional[float] = None
price_lock = threading.Lock()
active_policies: List[Dict] = []  # List of active insurance policies to monitor

def normal_cdf(x: float) -> float:
    """Standard normal CDF using the error function (no scipy needed)."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def touch_prob_down(spot: float, barrier: float, T: float, sigma: float) -> float:
    """
    Approx probability that a LOWER barrier is touched before time T
    under a driftless log-Brownian approximation.
    Requires: barrier < spot.
    """
    if barrier >= spot:
        raise ValueError("For down-touch, barrier must be < spot.")
    if T <= 0 or sigma <= 0:
        raise ValueError("T and sigma must be positive.")
    
    z = math.log(barrier / spot) / (sigma * math.sqrt(T))
    # Formula from reflection principle for minimum of Brownian motion
    p_touch = 2.0 * normal_cdf(z)
    # z is negative, so this is between 0 and 1
    return p_touch

def touch_prob_up(spot: float, barrier: float, T: float, sigma: float) -> float:
    """
    Approx probability that an UPPER barrier is touched before time T
    under a driftless log-Brownian approximation.
    Requires: barrier > spot.
    """
    if barrier <= spot:
        raise ValueError("For up-touch, barrier must be > spot.")
    if T <= 0 or sigma <= 0:
        raise ValueError("T and sigma must be positive.")
    
    z = math.log(barrier / spot) / (sigma * math.sqrt(T))
    # Probability to ever reach the upper barrier before T
    p_touch = 2.0 * normal_cdf(-z)
    return p_touch

def one_touch_premium(
    spot: float,
    barrier: float,
    days_to_expiry: float,
    coverage: float,
    sigma: float,
    r: float = 0.0,
    days_in_year: float = 365.0,
) -> float:
    """
    Price a one-touch (barrier) insurance contract that pays `coverage`
    if the price EVER hits `barrier` before expiry.
    Automatically chooses down-touch vs up-touch based on barrier vs spot.
    """
    T = days_to_expiry / days_in_year
    
    if barrier < spot:
        p_touch = touch_prob_down(spot, barrier, T, sigma)
    elif barrier > spot:
        p_touch = touch_prob_up(spot, barrier, T, sigma)
    else:
        # If barrier == spot, we assume immediate touch (prob ~1)
        p_touch = 1.0
    
    premium = coverage * math.exp(-r * T) * p_touch
    return premium

def d1_d2(spot: float, strike: float, T: float, sigma: float, r: float):
    """Helper to compute Black–Scholes d1 and d2 (for regular option price display)."""
    sqrtT = math.sqrt(T)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * T) / (sigma * sqrtT)
    d2 = d1 - sigma * sqrtT
    return d1, d2

def black_scholes(S, K, days_to_expiration, r, sigma, option_type='call'):
    """
    Calculate Black-Scholes option price using pure Python implementation
    
    Parameters:
    S: Current stock/asset price
    K: Strike price
    days_to_expiration: Time to expiration (in days)
    r: Risk-free interest rate (annual, as decimal, e.g., 0.05 for 5%)
    sigma: Volatility (annual, as decimal, e.g., 0.3 for 30%)
    option_type: 'call' or 'put'
    
    Returns:
    Option price
    """
    if days_to_expiration <= 0:
        return 0
    
    # Validate inputs
    if S <= 0 or K <= 0:
        return 0
    
    try:
        T = days_to_expiration / 365.0
        d1, d2 = d1_d2(S, K, T, sigma, r)
        
        if option_type.lower() == 'call':
            price = S * normal_cdf(d1) - K * math.exp(-r * T) * normal_cdf(d2)
        else:
            price = K * math.exp(-r * T) * normal_cdf(-d2) - S * normal_cdf(-d1)
        
        return max(price, 0)  # Ensure non-negative price
    except Exception as e:
        print(f"Error in Black-Scholes calculation: {e}")
        return 0

def calculate_premium(insurance_amount, liquidation_price, current_price, volatility=0.3, risk_free_rate=0.05, days_to_expiration=30):
    """
    Calculate insurance premium using one-touch barrier option pricing
    
    Parameters:
    insurance_amount: Amount of insurance coverage requested (coverage amount)
    liquidation_price: Price at which liquidation occurs (barrier price)
    current_price: Current market price of the underlying asset (spot price)
    volatility: Annual volatility (default 0.3 = 30%)
    risk_free_rate: Risk-free interest rate (default 0.05 = 5%)
    days_to_expiration: Days to expiration (default 30)
    
    Returns:
    Premium amount (one-touch barrier option price)
    """
    if insurance_amount <= 0 or current_price <= 0:
        return 0
    
    # Use liquidation price as barrier, or default to 90% of current price
    barrier_price = liquidation_price if liquidation_price > 0 else current_price * 0.9
    
    try:
        # Calculate premium using one-touch barrier option pricing
        # One-touch pays out coverage amount if price EVER touches barrier before expiry
        premium = one_touch_premium(
            spot=current_price,
            barrier=barrier_price,
            days_to_expiry=days_to_expiration,
            coverage=insurance_amount,
            sigma=volatility,
            r=risk_free_rate,
            days_in_year=365.0
        )
    except ValueError as e:
        # Handle edge cases (e.g., barrier == spot)
        print(f"Warning in premium calculation: {e}")
        # If barrier equals or exceeds spot for down-touch, premium should be high
        if barrier_price >= current_price:
            # Very high risk - premium approaches coverage amount
            premium = insurance_amount * 0.95
        else:
            premium = 0
    
    # Add 20% vig (house edge) for profit
    premium_with_vig = premium * 1.20
    
    return round(premium_with_vig, 4)

@app.route('/calculate-risk', methods=['POST'])
def calculate_risk():
    """
    Endpoint to calculate insurance premium using Black-Scholes
    
    Expected JSON payload:
    {
        "liquidationPrice": float,
        "insuranceAmount": float,
        "optionType": "call" or "put",
        "expirationDate": "YYYY-MM-DD" (optional),
        "currentAssetPrice": float (required for Black-Scholes),
        "volatility": float (optional, default 0.3),
        "riskFreeRate": float (optional, default 0.05)
    }
    """
    try:
        data = request.get_json()
        
        # Extract required fields
        liquidation_price = float(data.get('liquidationPrice', 0))
        insurance_amount = float(data.get('insuranceAmount', 0))
        current_asset_price = float(data.get('currentAssetPrice', 0))
        option_type = data.get('optionType', 'call')
        expiration_date = data.get('expirationDate', None)
        
        # Validate required fields
        if insurance_amount <= 0:
            return jsonify({'error': 'Insurance amount must be greater than 0'}), 400
        
        if current_asset_price <= 0:
            return jsonify({'error': 'Current asset price is required and must be greater than 0'}), 400
        
        # Calculate time to expiration in days
        if expiration_date:
            from datetime import datetime
            try:
                exp_date = datetime.strptime(expiration_date, '%Y-%m-%d')
                current_date = datetime.now()
                days_to_expiration = max((exp_date - current_date).days, 0)
            except ValueError:
                days_to_expiration = 30  # Default to 30 days
        else:
            days_to_expiration = 30  # Default to 30 days
        
        # Default parameters (can be made configurable)
        volatility = float(data.get('volatility', 0.3))  # 0.3 = 30% default volatility
        risk_free_rate = float(data.get('riskFreeRate', 0.05))  # 0.05 = 5% default risk-free rate
        
        # Use liquidation price as strike, or default to 90% of current price
        strike_price = liquidation_price if liquidation_price > 0 else current_asset_price * 0.9
        
        # For liquidation insurance, we always use PUT options (protection against price decline)
        # The user's option_type selection is for reference, but insurance is always a put
        insurance_option_type = 'put'
        
        # Calculate regular option price using Black-Scholes (for display purposes)
        option_price = black_scholes(
            S=current_asset_price,
            K=strike_price,
            days_to_expiration=days_to_expiration,
            r=risk_free_rate,
            sigma=volatility,
            option_type=insurance_option_type
        )
        
        # Debug logging
        print(f"DEBUG: current_price={current_asset_price}, strike={strike_price}, days={days_to_expiration}, vol={volatility}, rate={risk_free_rate}")
        print(f"DEBUG: option_price={option_price}, insurance_amount={insurance_amount}")
        
        # If option_price is 0, there's likely an error - check if it's a valid scenario
        if option_price == 0 and current_asset_price > 0:
            print(f"WARNING: Option price is 0. This might indicate:")
            print(f"  - Strike price ({strike_price}) >= Current price ({current_asset_price}) for PUT option")
            print(f"  - Or an error in mibian calculation")
        
        # Calculate premium using binary option pricing
        premium = calculate_premium(
            insurance_amount=insurance_amount,
            liquidation_price=liquidation_price,
            current_price=current_asset_price,
            volatility=volatility,
            risk_free_rate=risk_free_rate,
            days_to_expiration=days_to_expiration
        )
        
        # Optionally register policy for monitoring if requested
        register_for_monitoring = data.get('registerForMonitoring', False)
        if register_for_monitoring and liquidation_price > 0:
            policy_id = f"policy_{int(time.time())}"
            policy = {
                'id': policy_id,
                'liquidationPrice': liquidation_price,
                'optionType': option_type,
                'insuranceAmount': insurance_amount,
                'expirationDate': expiration_date,
                'createdAt': datetime.now().isoformat()
            }
            with price_lock:
                active_policies.append(policy)
            print(f"✅ Registered policy {policy_id} for monitoring (Liquidation: ${liquidation_price}, Type: {option_type})")
        
        return jsonify({
            'premium': premium,
            'optionPrice': round(option_price, 4),  # The calculated option price
            'blackScholesPrice': round(option_price, 4),  # Same as option price (for backward compatibility)
            'currentAssetPrice': current_asset_price,  # Include for debugging
            'strikePrice': strike_price,
            'timeToExpiration': days_to_expiration,  # Return in days
            'volatility': volatility,
            'riskFreeRate': risk_free_rate
        }), 200
        
    except ValueError as e:
        return jsonify({'error': f'Invalid input: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    with price_lock:
        return jsonify({
            'status': 'healthy',
            'currentSolPrice': current_sol_price,
            'activePolicies': len(active_policies)
        }), 200

def send_sol_payout(to_address: str, amount_sol: float) -> Dict:
    """Send SOL payout to user wallet using Solana RPC"""
    try:
        if not SENDER_WALLET_PRIVATE_KEY:
            return {'success': False, 'error': 'SENDER_WALLET_PRIVATE_KEY not configured'}
        
        # Convert USD amount to SOL (simplified - use current SOL price)
        # In production, you'd want to use USDC or convert properly
        with price_lock:
            sol_price = current_sol_price or 150  # Fallback price
        
        amount_in_sol = amount_sol / sol_price
        
        # For now, return success - full implementation requires:
        # 1. Load sender wallet from private key
        # 2. Build transfer transaction
        # 3. Sign transaction
        # 4. Send transaction via RPC
        # This requires solders library or solana-py for proper implementation
        
        print(f"💰 Sending payout:")
        print(f"   To: {to_address}")
        print(f"   Amount: ${amount_sol} (≈ {amount_in_sol:.6f} SOL)")
        print(f"   Note: Full transaction implementation requires Solana SDK")
        
        # Placeholder - in production, implement actual transaction
        return {
            'success': True,
            'to': to_address,
            'amountUSD': amount_sol,
            'amountSOL': amount_in_sol,
            'message': 'Payout transaction prepared (implement full Solana transaction)'
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}

@app.route('/resolve', methods=['POST'])
def resolve():
    """
    Endpoint called when liquidation condition is met
    This will be called by the price monitor when SOL price crosses liquidation threshold
    """
    try:
        data = request.get_json()
        current_price = data.get('currentPrice')
        liquidation_price = data.get('liquidationPrice')
        option_type = data.get('optionType', 'put')
        policy_id = data.get('policyId')
        timestamp = data.get('timestamp')
        
        print(f"\n🔥 LIQUIDATION RESOLVED!")
        print(f"   Current Price: ${current_price}")
        print(f"   Liquidation Price: ${liquidation_price}")
        print(f"   Option Type: {option_type}")
        print(f"   Policy ID: {policy_id}")
        print(f"   Timestamp: {timestamp}\n")
        
        # Find the policy and send payout
        policy = None
        with price_lock:
            for p in active_policies:
                if (p.get('liquidationPrice') == liquidation_price and 
                    p.get('optionType') == option_type):
                    policy = p
                    break
        
        if not policy:
            return jsonify({'error': 'Policy not found'}), 404
        
        user_wallet = policy.get('userWalletAddress')
        insurance_amount = policy.get('insuranceAmount', 0)
        
        if not user_wallet:
            return jsonify({'error': 'User wallet address not found in policy'}), 400
        
        # Send payout
        payout_result = send_sol_payout(user_wallet, insurance_amount)
        
        if payout_result.get('success'):
            # Mark policy as resolved
            with price_lock:
                for i, p in enumerate(active_policies):
                    if p.get('id') == policy.get('id'):
                        active_policies[i]['status'] = 'resolved'
                        active_policies[i]['resolvedAt'] = datetime.now().isoformat()
                        active_policies[i]['payoutAmount'] = insurance_amount
                        break
            
            return jsonify({
                'status': 'resolved',
                'message': 'Liquidation condition met and payout sent',
                'currentPrice': current_price,
                'liquidationPrice': liquidation_price,
                'optionType': option_type,
                'payout': payout_result
            }), 200
        else:
            return jsonify({
                'status': 'error',
                'error': payout_result.get('error', 'Failed to send payout')
            }), 500
        
    except Exception as e:
        return jsonify({'error': f'Error resolving liquidation: {str(e)}'}), 500

@app.route('/current-price', methods=['GET'])
def get_current_price():
    """Get current SOL price from websocket monitor"""
    with price_lock:
        if current_sol_price is None:
            return jsonify({'error': 'Price not available yet'}), 503
        return jsonify({'price': current_sol_price}), 200

@app.route('/pay-premium', methods=['POST'])
def pay_premium():
    """Handle premium payment from user wallet"""
    try:
        data = request.get_json()
        
        user_wallet_address = data.get('userWalletAddress')
        premium_amount = float(data.get('premiumAmount', 0))
        transaction_signature = data.get('transactionSignature')  # User signs transaction on frontend
        
        if not user_wallet_address:
            return jsonify({'error': 'User wallet address is required'}), 400
        
        if premium_amount <= 0:
            return jsonify({'error': 'Premium amount must be greater than 0'}), 400
        
        # Verify transaction signature (simplified - in production, verify on-chain)
        # For now, we'll trust the frontend signature
        
        print(f"✅ Premium payment received")
        print(f"   User Wallet: {user_wallet_address}")
        print(f"   Premium Amount: ${premium_amount}")
        print(f"   Transaction: {transaction_signature}")
        
        return jsonify({
            'status': 'paid',
            'message': 'Premium payment confirmed',
            'premiumAmount': premium_amount,
            'userWalletAddress': user_wallet_address
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Error processing premium payment: {str(e)}'}), 500

@app.route('/register-policy', methods=['POST'])
def register_policy():
    """Register an insurance policy for liquidation monitoring"""
    try:
        data = request.get_json()
        
        liquidation_price = float(data.get('liquidationPrice', 0))
        option_type = data.get('optionType', 'put')
        insurance_amount = float(data.get('insuranceAmount', 0))
        expiration_date = data.get('expirationDate', None)
        user_wallet_address = data.get('userWalletAddress')  # User's wallet address
        premium_paid = data.get('premiumPaid', False)  # Whether premium has been paid
        
        if liquidation_price <= 0:
            return jsonify({'error': 'Liquidation price must be greater than 0'}), 400
        
        if not user_wallet_address:
            return jsonify({'error': 'User wallet address is required'}), 400
        
        if not premium_paid:
            return jsonify({'error': 'Premium must be paid before registering policy'}), 400
        
        policy_id = f"policy_{int(time.time())}"
        policy = {
            'id': policy_id,
            'liquidationPrice': liquidation_price,
            'optionType': option_type,
            'insuranceAmount': insurance_amount,
            'expirationDate': expiration_date,
            'userWalletAddress': user_wallet_address,
            'premiumPaid': premium_paid,
            'createdAt': datetime.now().isoformat(),
            'status': 'active'
        }
        
        with price_lock:
            active_policies.append(policy)
        
        print(f"✅ Registered policy {policy_id} for monitoring")
        print(f"   User Wallet: {user_wallet_address}")
        print(f"   Liquidation Price: ${liquidation_price}")
        print(f"   Option Type: {option_type}")
        print(f"   Insurance Amount: ${insurance_amount}")
        
        return jsonify({
            'status': 'registered',
            'policyId': policy_id,
            'message': 'Policy registered for monitoring'
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Error registering policy: {str(e)}'}), 500

@app.route('/active-policies', methods=['GET'])
def get_active_policies():
    """Get list of active policies being monitored"""
    with price_lock:
        return jsonify({
            'policies': active_policies,
            'count': len(active_policies)
        }), 200

def check_liquidation_condition(current_price: float, liquidation_price: float, option_type: str) -> bool:
    """Check if liquidation condition is met"""
    if liquidation_price <= 0:
        return False
    
    if option_type.lower() == 'call':
        # Call option: liquidate if price goes ABOVE liquidation price
        return current_price > liquidation_price
    elif option_type.lower() == 'put':
        # Put option: liquidate if price goes BELOW liquidation price
        return current_price < liquidation_price
    
    return False

def call_resolve_endpoint(current_price: float, liquidation_price: float, option_type: str, policy_id: str):
    """Call /resolve endpoint when liquidation condition is met"""
    try:
        url = f'http://localhost:5000/resolve'
        payload = {
            'currentPrice': current_price,
            'liquidationPrice': liquidation_price,
            'optionType': option_type,
            'policyId': policy_id,
            'timestamp': datetime.now().isoformat()
        }
        response = requests.post(url, json=payload, timeout=5)
        if response.status_code == 200:
            print(f"✅ Successfully called /resolve endpoint")
        else:
            print(f"⚠️  /resolve endpoint returned status {response.status_code}")
    except Exception as e:
        print(f"❌ Error calling /resolve endpoint: {e}")

def monitor_sol_price():
    """Background thread to monitor SOL price from Pyth Network"""
    global current_sol_price, active_policies
    
    # SOL/USD Feed ID (Pyth Network) - without 0x prefix
    SOL_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
    HERMES_URL = 'https://hermes.pyth.network'
    
    print("🚀 Starting SOL price monitor...")
    print(f"   Monitoring SOL/USD feed: {SOL_FEED_ID}")
    
    while True:
        try:
            # Get latest price updates from Pyth Hermes API
            # Using the same endpoint format as the Hermes client
            url = f"{HERMES_URL}/api/latest_price_feeds"
            params = {
                'ids[]': SOL_FEED_ID,
                'parsed': 'true'
            }
            
            response = requests.get(url, params=params, timeout=10, headers={
                'Accept': 'application/json'
            })
            
            if response.status_code == 200:
                data = response.json()
                
                # Parse price from response
                # The Hermes API returns data in format: {"parsed": [{"id": "...", "price": {...}}]}
                price_value = None
                exponent = -8
                
                if isinstance(data, dict) and 'parsed' in data:
                    parsed_data = data['parsed']
                    if isinstance(parsed_data, list) and len(parsed_data) > 0:
                        price_feed = parsed_data[0]
                        if 'price' in price_feed and price_feed['price']:
                            price_obj = price_feed['price']
                            price_value = price_obj.get('price')
                            exponent = price_obj.get('expo', -8)
                elif isinstance(data, list) and len(data) > 0:
                    # Fallback: direct array format
                    price_feed = data[0]
                    if 'price' in price_feed and price_feed['price']:
                        price_obj = price_feed['price']
                        price_value = price_obj.get('price')
                        exponent = price_obj.get('expo', -8)
                
                if price_value is not None:
                    # Normalize price
                    normalized_price = float(price_value) * (10 ** exponent)
                    
                    with price_lock:
                        current_sol_price = normalized_price
                    
                    print(f"💰 SOL/USD Price: ${normalized_price:.2f} (Updated: {datetime.now().strftime('%H:%M:%S')})")
                    
                    # Check liquidation conditions for all active policies
                    with price_lock:
                        policies_to_check = active_policies.copy()
                    
                    for policy in policies_to_check:
                        liquidation_price = policy.get('liquidationPrice')
                        option_type = policy.get('optionType', 'put')
                        
                        if check_liquidation_condition(normalized_price, liquidation_price, option_type):
                            print(f"\n🔥 LIQUIDATION TRIGGERED!")
                            print(f"   Policy: {policy.get('id', 'unknown')}")
                            print(f"   Current Price: ${normalized_price:.2f}")
                            print(f"   Liquidation Price: ${liquidation_price:.2f}")
                            print(f"   Option Type: {option_type}\n")
                            
                            call_resolve_endpoint(normalized_price, liquidation_price, option_type, policy.get('id'))
                            
                            # Policy will be marked as resolved in /resolve endpoint
                else:
                    print(f"⚠️  Could not parse price from API response")
                    if isinstance(data, dict):
                        print(f"   Response keys: {list(data.keys())}")
            
            # Poll every 5 seconds
            time.sleep(5)
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Network error in price monitor: {e}")
            time.sleep(10)  # Wait longer on error
        except Exception as e:
            print(f"❌ Error in price monitor: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(10)  # Wait longer on error

def start_price_monitor():
    """Start the price monitoring thread"""
    monitor_thread = threading.Thread(target=monitor_sol_price, daemon=True)
    monitor_thread.start()
    print("✅ Price monitor thread started")

if __name__ == '__main__':
    # Start price monitoring in background thread
    start_price_monitor()
    app.run(debug=True, port=5000)

