# Crypto Liquidation Insurance

A full-stack application for crypto liquidation insurance for option prices, featuring a modern React frontend and Flask backend with Black-Scholes pricing model.

## Features

- Clean, modern UI styled like a crypto exchange
- Price input for crypto options
- Insurance premium calculation using Black-Scholes algorithm
- Real-time premium calculation
- Responsive design
- Backend API with risk assessment

## Project Structure

```
jewbot/
├── src/              # React frontend
├── backend/          # Flask backend API
└── README.md
```

## Getting Started

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Run the Flask server:
```bash
python app.py
```

The backend API will be available at `http://localhost:5000`

### Frontend Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Tech Stack

### Frontend
- React 18
- Vite
- Tailwind CSS
- Modern ES6+ JavaScript

### Backend
- Flask
- Python
- scipy (for Black-Scholes calculations)
- flask-cors

## Usage

1. Start the backend server (port 5000)
2. Start the frontend development server (port 5173)
3. Enter the option price you want to insure
4. Enter the current asset price (required for Black-Scholes calculation)
5. Fill in additional details (liquidation price, expiration date, option type)
6. Enter insurance coverage amount
7. Click "Calculate Insurance Premium" to see the estimated premium calculated using Black-Scholes model

## API Endpoints

See `backend/README.md` for detailed API documentation.

