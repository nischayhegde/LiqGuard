import { useState } from 'react'

function App() {
  const [formData, setFormData] = useState({
    optionPrice: '',
    strikePrice: '',
    expirationDate: '',
    optionType: 'call',
    collateralAmount: '',
    insuranceAmount: '',
  })

  const [calculatedPremium, setCalculatedPremium] = useState(null)

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const calculatePremium = () => {
    // Mock premium calculation (replace with actual logic)
    const price = parseFloat(formData.optionPrice) || 0
    const collateral = parseFloat(formData.collateralAmount) || 0
    const insurance = parseFloat(formData.insuranceAmount) || 0
    
    if (price > 0 && collateral > 0 && insurance > 0) {
      // Simple premium calculation: 2% of insurance amount + risk factor
      const basePremium = insurance * 0.02
      const riskFactor = (insurance / collateral) * 0.01
      const premium = basePremium + (insurance * riskFactor)
      setCalculatedPremium(premium.toFixed(4))
    } else {
      setCalculatedPremium(null)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    calculatePremium()
  }

  return (
    <div className="min-h-screen py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">
            Crypto Liquidation Insurance
          </h1>
          <p className="text-xl text-gray-300">
            Protect your crypto options from liquidation risk
          </p>
        </div>

        {/* Main Card */}
        <div className="glass-effect rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Option Price Input */}
            <div>
              <label htmlFor="optionPrice" className="block text-sm font-medium text-gray-300 mb-2">
                Option Price (USD) *
              </label>
              <input
                type="number"
                id="optionPrice"
                name="optionPrice"
                value={formData.optionPrice}
                onChange={handleInputChange}
                placeholder="Enter the option price"
                step="0.0001"
                min="0"
                className="input-field"
                required
              />
              <p className="mt-1 text-sm text-gray-400">
                The current price of the crypto option you want to insure
              </p>
            </div>

            {/* Strike Price */}
            <div>
              <label htmlFor="strikePrice" className="block text-sm font-medium text-gray-300 mb-2">
                Liquidation Price (USD)
              </label>
              <input
                type="number"
                id="strikePrice"
                name="strikePrice"
                value={formData.strikePrice}
                onChange={handleInputChange}
                placeholder="Enter strike price"
                step="0.0001"
                min="0"
                className="input-field"
              />
            </div>

            {/* Option Type */}
            <div>
              <label htmlFor="optionType" className="block text-sm font-medium text-gray-300 mb-2">
                Option Type
              </label>
              <select
                id="optionType"
                name="optionType"
                value={formData.optionType}
                onChange={handleInputChange}
                className="input-field"
              >
                <option value="call">Call Option</option>
                <option value="put">Put Option</option>
              </select>
            </div>

            {/* Expiration Date */}
            <div>
              <label htmlFor="expirationDate" className="block text-sm font-medium text-gray-300 mb-2">
                Expiration Date
              </label>
              <input
                type="date"
                id="expirationDate"
                name="expirationDate"
                value={formData.expirationDate}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>

            {/* Collateral Amount */}
            <div>
              <label htmlFor="collateralAmount" className="block text-sm font-medium text-gray-300 mb-2">
                Collateral Amount (USD)
              </label>
              <input
                type="number"
                id="collateralAmount"
                name="collateralAmount"
                value={formData.collateralAmount}
                onChange={handleInputChange}
                placeholder="Enter collateral amount"
                step="0.01"
                min="0"
                className="input-field"
              />
            </div>

            {/* Insurance Amount */}
            <div>
              <label htmlFor="insuranceAmount" className="block text-sm font-medium text-gray-300 mb-2">
                Insurance Coverage Amount (USD)
              </label>
              <input
                type="number"
                id="insuranceAmount"
                name="insuranceAmount"
                value={formData.insuranceAmount}
                onChange={handleInputChange}
                placeholder="Enter insurance coverage amount"
                step="0.01"
                min="0"
                className="input-field"
              />
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                className="btn-primary w-full text-lg"
              >
                Calculate Insurance Premium
              </button>
            </div>
          </form>

          {/* Premium Display */}
          {calculatedPremium && (
            <div className="mt-8 p-6 bg-gradient-to-r from-primary-500/20 to-purple-500/20 rounded-lg border border-primary-500/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-300 text-sm">Estimated Premium</p>
                  <p className="text-3xl font-bold text-white mt-1">
                    ${calculatedPremium}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-gray-300 text-sm">Coverage</p>
                  <p className="text-xl font-semibold text-white mt-1">
                    ${parseFloat(formData.insuranceAmount || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Info Section */}
          <div className="mt-8 pt-8 border-t border-white/10">
            <h3 className="text-lg font-semibold text-white mb-4">How It Works</h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="p-4 bg-white/5 rounded-lg">
                <div className="text-2xl font-bold text-primary-400 mb-2">1</div>
                <p className="text-gray-300 text-sm">
                  Enter your option price and coverage details
                </p>
              </div>
              <div className="p-4 bg-white/5 rounded-lg">
                <div className="text-2xl font-bold text-primary-400 mb-2">2</div>
                <p className="text-gray-300 text-sm">
                  Our algorithm calculates your premium based on risk factors
                </p>
              </div>
              <div className="p-4 bg-white/5 rounded-lg">
                <div className="text-2xl font-bold text-primary-400 mb-2">3</div>
                <p className="text-gray-300 text-sm">
                  Get protected against liquidation events
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>Secure your crypto options with liquidation insurance</p>
        </div>
      </div>
    </div>
  )
}

export default App

