from flask import Flask, request, jsonify
from flask_cors import CORS
import mibian

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
    if days_to_expiration <= 0:
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
        # Fallback to 0 if calculation fails
        print(f"Error in Black-Scholes calculation: {e}")
        return 0

def calculate_premium(option_price, insurance_amount, liquidation_price, current_price, volatility=0.3, risk_free_rate=0.05, days_to_expiration=30):
    """
    Calculate insurance premium based on Black-Scholes and risk factors
    
    Parameters:
    option_price: Current price of the option
    insurance_amount: Amount of insurance coverage requested
    liquidation_price: Price at which liquidation occurs
    current_price: Current market price of the underlying asset
    volatility: Annual volatility (default 0.3 = 30%)
    risk_free_rate: Risk-free interest rate (default 0.05 = 5%)
    days_to_expiration: Days to expiration (default 30)
    
    Returns:
    Premium amount
    """
    if option_price <= 0 or insurance_amount <= 0:
        return 0
    
    # Use liquidation price as strike price for risk calculation
    strike_price = liquidation_price if liquidation_price > 0 else current_price * 0.9
    
    # Calculate Black-Scholes price using mibian
    bs_price = black_scholes(
        S=current_price,
        K=strike_price,
        days_to_expiration=days_to_expiration,
        r=risk_free_rate,
        sigma=volatility,
        option_type='put'  # Insurance is like a put option
    )
    
    # Base premium: percentage of insurance amount
    base_premium_rate = 0.02  # 2% base rate
    
    # Risk factor based on distance to liquidation
    if liquidation_price > 0 and current_price > 0:
        distance_to_liquidation = abs(current_price - liquidation_price) / current_price
        # Higher risk if closer to liquidation
        risk_multiplier = max(1.0, 1.5 - (distance_to_liquidation * 2))
    else:
        risk_multiplier = 1.2
    
    # Volatility risk factor
    volatility_factor = 1 + (volatility - 0.2) * 0.5  # Adjust for volatility
    
    # Calculate premium
    premium = insurance_amount * base_premium_rate * risk_multiplier * volatility_factor
    
    # Add Black-Scholes component (weighted)
    bs_component = bs_price * (insurance_amount / current_price) * 0.1 if current_price > 0 else 0
    
    total_premium = premium + bs_component
    
    return round(total_premium, 4)

@app.route('/calculate-risk', methods=['POST'])
def calculate_risk():
    """
    Endpoint to calculate insurance premium using Black-Scholes
    
    Expected JSON payload:
    {
        "optionPrice": float,
        "liquidationPrice": float,
        "insuranceAmount": float,
        "optionType": "call" or "put",
        "expirationDate": "YYYY-MM-DD" (optional),
        "currentAssetPrice": float (required for Black-Scholes)
    }
    """
    try:
        data = request.get_json()
        
        # Extract required fields
        option_price = float(data.get('optionPrice', 0))
        liquidation_price = float(data.get('liquidationPrice', 0))
        insurance_amount = float(data.get('insuranceAmount', 0))
        current_asset_price = float(data.get('currentAssetPrice', 0))
        option_type = data.get('optionType', 'call')
        expiration_date = data.get('expirationDate', None)
        
        # Validate required fields
        if option_price <= 0:
            return jsonify({'error': 'Option price must be greater than 0'}), 400
        
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
        
        # Calculate Black-Scholes price using mibian
        bs_price = black_scholes(
            S=current_asset_price,
            K=strike_price,
            days_to_expiration=days_to_expiration,
            r=risk_free_rate,
            sigma=volatility,
            option_type=option_type
        )
        
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
            'blackScholesPrice': round(bs_price, 4),
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

