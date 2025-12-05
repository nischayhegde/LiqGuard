from flask import Flask, request, jsonify
from flask_cors import CORS
import math

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend communication

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

