import { useState } from 'react'

function App() {
  const [formData, setFormData] = useState({
    liquidationPrice: '',
    expirationDate: '',
    optionType: 'call',
    insuranceAmount: '',
    currentAssetPrice: '',
  })

  const [calculatedPremium, setCalculatedPremium] = useState(null)
  const [premiumData, setPremiumData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showChart, setShowChart] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
    setError(null)
  }

  const calculatePremium = async (data = formData) => {
    const insurance = parseFloat(data.insuranceAmount) || 0
    const assetPrice = parseFloat(data.currentAssetPrice) || 0
    
    // Don't calculate if required fields are missing
    if (insurance <= 0 || assetPrice <= 0) {
      setCalculatedPremium(null)
      setPremiumData(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('http://localhost:5000/calculate-risk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          liquidationPrice: parseFloat(data.liquidationPrice) || 0,
          insuranceAmount: insurance,
          optionType: data.optionType,
          expirationDate: data.expirationDate || null,
          currentAssetPrice: assetPrice,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to calculate premium')
      }

      const result = await response.json()
      setCalculatedPremium(result.premium.toFixed(4))
      setPremiumData(result)
    } catch (err) {
      setError(err.message)
      setCalculatedPremium(null)
      setPremiumData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    await calculatePremium()
  }

  const formatUSD = (value) => {
    const num = parseFloat(value) || 0
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <div className="min-h-screen bg-[#0a0e27] text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Main Transaction Panel */}
        <div className="bg-[#131829] rounded-xl p-6 mb-6 border border-gray-800">
          {/* Badge */}
          <div className="flex items-center gap-2 mb-6">
            <span className="px-3 py-1 bg-[#1a1f35] border border-gray-700 rounded text-xs text-gray-300 flex items-center gap-1">
              <span>💎</span> Ultra V3
            </span>
            <button className="text-gray-400 hover:text-gray-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current Asset Price */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Current Asset Price (USD) *</label>
              <input
                type="number"
                name="currentAssetPrice"
                value={formData.currentAssetPrice}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.0001"
                min="0"
                required
                className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
              />
              <p className="mt-1 text-xs text-gray-500">Current market price of the underlying asset</p>
            </div>

            {/* Liquidation Price */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Liquidation Price (USD)</label>
              <input
                type="number"
                name="liquidationPrice"
                value={formData.liquidationPrice}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.0001"
                min="0"
                className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
              />
            </div>

            {/* Option Type */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Option Type</label>
              <select
                name="optionType"
                value={formData.optionType}
                onChange={handleInputChange}
                className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-gray-600 transition-colors"
              >
                <option value="call">Call Option</option>
                <option value="put">Put Option</option>
              </select>
            </div>

            {/* Expiration Date */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Expiration Date</label>
              <input
                type="date"
                name="expirationDate"
                value={formData.expirationDate}
                onChange={handleInputChange}
                className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-gray-600 transition-colors"
              />
            </div>

            {/* Insurance Amount */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Insurance Coverage Amount (USD)</label>
              <input
                type="number"
                name="insuranceAmount"
                value={formData.insuranceAmount}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Premium Display */}
            {calculatedPremium && premiumData && (
              <div className="p-4 bg-[#1a1f35] border border-gray-700 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Estimated Premium</p>
                    <p className="text-2xl font-bold text-green-400 mt-1">
                      ${calculatedPremium}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-sm">Coverage</p>
                    <p className="text-lg font-semibold text-white mt-1">
                      ${formatUSD(formData.insuranceAmount)}
                    </p>
                  </div>
                </div>
                <div className="pt-3 border-t border-gray-700">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Option Price (Calculated)</p>
                      <p className="text-white font-semibold">${premiumData.optionPrice || premiumData.blackScholesPrice}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Strike Price</p>
                      <p className="text-white font-semibold">${premiumData.strikePrice.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Time to Expiration</p>
                      <p className="text-white font-semibold">{premiumData.timeToExpiration} days</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Volatility</p>
                      <p className="text-white font-semibold">{(premiumData.volatility * 100).toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-lg transition-colors"
            >
              {loading ? 'Calculating...' : 'Calculate Insurance Premium'}
            </button>
          </form>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setShowChart(!showChart)}
            className="flex items-center gap-2 px-4 py-2 bg-[#131829] border border-gray-800 rounded-lg text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Show Chart
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 px-4 py-2 bg-[#131829] border border-gray-800 rounded-lg text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Show History
          </button>
        </div>

        {/* Market Data Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* USDC Card */}
          <div className="bg-[#131829] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold">
                  $
                </div>
                <div>
                  <div className="font-semibold">USDC</div>
                  <div className="text-xs text-gray-500">EPjF...Dt1v</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">${formData.currentAssetPrice || '0.9997'}</div>
                <div className="text-xs text-red-400">-0.01%</div>
              </div>
              <div className="w-20 h-10 flex items-end">
                <svg viewBox="0 0 100 40" className="w-full h-full">
                  <polyline
                    points="0,35 20,30 40,32 60,28 80,30 100,25"
                    fill="none"
                    stroke="#ec4899"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </div>
            <a href="#" className="text-xs text-gray-400 hover:text-gray-300 mt-2 inline-block">
              Open Page &gt;
            </a>
          </div>

          {/* SOL Card */}
          <div className="bg-[#131829] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded flex items-center justify-center">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-white rotate-45"></div>
                </div>
                <div>
                  <div className="font-semibold">SOL</div>
                  <div className="text-xs text-gray-500">So11...1112</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">${formData.insuranceAmount || '139.03'}</div>
                <div className="text-xs text-red-400">-3.5%</div>
              </div>
              <div className="w-20 h-10 flex items-end">
                <svg viewBox="0 0 100 40" className="w-full h-full">
                  <polyline
                    points="0,20 20,25 40,30 60,35 80,38 100,40"
                    fill="none"
                    stroke="#ec4899"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </div>
            <a href="#" className="text-xs text-gray-400 hover:text-gray-300 mt-2 inline-block">
              Open Page &gt;
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

