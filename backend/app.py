from flask import Flask, request, jsonify
from flask_cors import CORS

# Check if scipy is available (required by mibian)
try:
    import scipy.stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    print("ERROR: scipy is not installed. mibian requires scipy to work properly.")
    print("Please install scipy: pip install scipy")

try:
    import mibian
    # Test if mibian actually works (it needs scipy at runtime)
    try:
        test_calc = mibian.BS([100, 90, 5, 30], volatility=30)
        MIBIAN_AVAILABLE = True
        print("mibian is available and working")
    except Exception as e:
        MIBIAN_AVAILABLE = False
        print(f"ERROR: mibian imported but cannot calculate (likely missing scipy): {e}")
except ImportError:
    MIBIAN_AVAILABLE = False
    print("ERROR: mibian is not installed. Please install: pip install mibian")

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend communication

def black_scholes(S, K, days_to_expiration, r, sigma, option_type='call'):
    """
    Calculate Black-Scholes option price using mibian library
    
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
    if not SCIPY_AVAILABLE or not MIBIAN_AVAILABLE:
        print("ERROR: scipy or mibian not available. Cannot calculate option price.")
        return 0
    
    if days_to_expiration <= 0:
        return 0
    
    # Validate inputs
    if S <= 0 or K <= 0:
        print(f"ERROR: Invalid prices - S={S}, K={K}")
        return 0
    
    try:
        # mibian.BS expects: [underlying_price, strike_price, interest_rate_percent, days_to_expiration]
        # Interest rate and volatility should be in percentage form (e.g., 5 for 5%, 30 for 30%)
        # Time is in days
        c = mibian.BS([S, K, r * 100, days_to_expiration], volatility=sigma * 100)
        
        if option_type.lower() == 'call':
            price = c.callPrice
        else:
            price = c.putPrice
        
        return max(price, 0)  # Ensure non-negative price
    except Exception as e:
        # Fallback to 0 if calculation fails - log the full error
        import traceback
        print(f"Error in Black-Scholes calculation: {e}")
        print(f"Parameters: S={S}, K={K}, days={days_to_expiration}, r={r}, sigma={sigma}, type={option_type}")
        traceback.print_exc()
        return 0

def calculate_premium(option_price, insurance_amount, liquidation_price, current_price, volatility=0.3, risk_free_rate=0.05, days_to_expiration=30):
    """
    Calculate insurance premium based on option price and coverage amount
    
    Parameters:
    option_price: Current price of the option (calculated via Black-Scholes)
    insurance_amount: Amount of insurance coverage requested
    liquidation_price: Price at which liquidation occurs
    current_price: Current market price of the underlying asset
    volatility: Annual volatility (default 0.3 = 30%)
    risk_free_rate: Risk-free interest rate (default 0.05 = 5%)
    days_to_expiration: Days to expiration (default 30)
    
    Returns:
    Premium amount
    """
    if option_price <= 0 or insurance_amount <= 0 or current_price <= 0:
        return 0
    
    # The premium is the option price scaled by the coverage ratio
    # Premium = option_price * (insurance_amount / current_price)
    # This represents the cost to insure the insurance_amount worth of assets
    
    coverage_ratio = insurance_amount / current_price
    premium = option_price * coverage_ratio
    
    # Add a small risk premium based on volatility and time to expiration
    # Higher volatility and longer time = higher risk premium
    risk_premium_factor = 1 + (volatility * 0.1) + (days_to_expiration / 365.0 * 0.05)
    premium = premium * risk_premium_factor
    
    return round(premium, 4)

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
        
        # Calculate option price using Black-Scholes (this is what we're determining automatically)
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
        
        # Calculate premium using our risk model
        premium = calculate_premium(
            option_price=option_price,
            insurance_amount=insurance_amount,
            liquidation_price=liquidation_price,
            current_price=current_asset_price,
            volatility=volatility,
            risk_free_rate=risk_free_rate,
            days_to_expiration=days_to_expiration
        )
        
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
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)

