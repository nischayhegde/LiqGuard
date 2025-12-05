# Flask Backend API

Backend API for calculating insurance premiums using the Black-Scholes model.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the Flask server:
```bash
python app.py
```

The server will start on `http://localhost:5000`

## API Endpoints

### POST /calculate-risk

Calculate insurance premium using Black-Scholes algorithm.

**Request Body:**
```json
{
  "optionPrice": 100.0,
  "liquidationPrice": 90.0,
  "insuranceAmount": 1000.0,
  "optionType": "call",
  "expirationDate": "2024-12-31",
  "currentAssetPrice": 150.0,
  "volatility": 0.3,
  "riskFreeRate": 0.05
}
```

**Response:**
```json
{
  "premium": 25.50,
  "blackScholesPrice": 5.25,
  "strikePrice": 90.0,
  "timeToExpiration": 30.0,
  "volatility": 0.3,
  "riskFreeRate": 0.05
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy"
}
```

## Black-Scholes Model

The endpoint uses the Black-Scholes model to calculate option prices, which is then used as a component in the premium calculation along with risk factors based on:
- Distance to liquidation price
- Volatility
- Time to expiration
- Insurance coverage amount

