import { useState, useEffect } from 'react'

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
  const [policyRegistered, setPolicyRegistered] = useState(false)
  const [currentSolPrice, setCurrentSolPrice] = useState(null)
  const [priceLoading, setPriceLoading] = useState(true)

  // Fetch current SOL price from backend
  useEffect(() => {
    const fetchSolPrice = async () => {
      try {
        const response = await fetch('http://localhost:5000/current-price')
        if (response.ok) {
          const data = await response.json()
          const price = data.price
          setCurrentSolPrice(price)
          // Auto-populate current asset price with SOL price and recalculate option type
          setFormData(prev => {
            const updated = {
              ...prev,
              currentAssetPrice: price.toFixed(2)
            }
            
            // Auto-determine option type based on liquidation price vs current price
            const liquidationPrice = parseFloat(prev.liquidationPrice) || 0
            if (liquidationPrice > 0 && price > 0) {
              if (liquidationPrice > price) {
                updated.optionType = 'call'
              } else if (liquidationPrice < price) {
                updated.optionType = 'put'
              }
            }
            
            return updated
          })
          setPriceLoading(false)
        } else {
          setPriceLoading(false)
        }
      } catch (err) {
        console.error('Failed to fetch SOL price:', err)
        setPriceLoading(false)
      }
    }

    // Fetch immediately
    fetchSolPrice()

    // Then fetch every 5 seconds to keep price updated
    const interval = setInterval(fetchSolPrice, 5000)

    return () => clearInterval(interval)
  }, [])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => {
      const updated = {
        ...prev,
        [name]: value
      }
      
      // Automatically determine option type based on liquidation price vs current price
      if (name === 'liquidationPrice' || name === 'currentAssetPrice') {
        const liquidationPrice = parseFloat(name === 'liquidationPrice' ? value : updated.liquidationPrice) || 0
        const currentPrice = parseFloat(name === 'currentAssetPrice' ? value : updated.currentAssetPrice) || 0
        
        if (liquidationPrice > 0 && currentPrice > 0) {
          // If liquidation price > current price: CALL option (protection against price increase)
          // If liquidation price < current price: PUT option (protection against price decline)
          if (liquidationPrice > currentPrice) {
            updated.optionType = 'call'
          } else if (liquidationPrice < currentPrice) {
            updated.optionType = 'put'
          }
          // If equal, keep current option type
        }
      }
      
      return updated
    })
    setError(null)
  }

  const calculatePremium = async (data = formData) => {
    const insurance = parseFloat(data.insuranceAmount) || 0
    const assetPrice = parseFloat(data.currentAssetPrice) || 0
    
    // Don't calculate if required fields are missing
    if (insurance <= 0 || assetPrice <= 0) {
      setCalculatedPremium(null)
      setPremiumData(null)
      setPolicyRegistered(false)
      return
    }

    setLoading(true)
    setError(null)
    setPolicyRegistered(false) // Reset when recalculating

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
      
      // Automatically register policy for monitoring if liquidation price is provided
      const liquidationPrice = parseFloat(data.liquidationPrice) || 0
      if (liquidationPrice > 0) {
        try {
          const registerResponse = await fetch('http://localhost:5000/register-policy', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              liquidationPrice: liquidationPrice,
              optionType: data.optionType,
              insuranceAmount: insurance,
              expirationDate: data.expirationDate || null,
            }),
          })
          
          if (registerResponse.ok) {
            const registerResult = await registerResponse.json()
            setPolicyRegistered(true)
            console.log('✅ Policy registered for monitoring:', registerResult.policyId)
          }
        } catch (registerErr) {
          console.error('Failed to register policy for monitoring:', registerErr)
          // Don't show error to user, just log it
        }
      }
    } catch (err) {
      setError(err.message)
      setCalculatedPremium(null)
      setPremiumData(null)
      setPolicyRegistered(false)
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
            {/* Current Asset Price (SOL) */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Current SOL Price (USD) *
                {currentSolPrice && (
                  <span className="ml-2 text-green-400 text-xs">
                    (Live: ${currentSolPrice.toFixed(2)})
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type="number"
                  name="currentAssetPrice"
                  value={formData.currentAssetPrice}
                  onChange={handleInputChange}
                  placeholder={priceLoading ? "Loading..." : "0.00"}
                  step="0.01"
                  min="0"
                  required
                  disabled={priceLoading}
                  className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {currentSolPrice && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        currentAssetPrice: currentSolPrice.toFixed(2)
                      }))
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors"
                  >
                    Use Live Price
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {priceLoading ? 'Fetching current SOL price...' : 'Automatically updated from Pyth Network'}
              </p>
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
              <label className="block text-sm text-gray-400 mb-2">
                Option Type
                {formData.liquidationPrice && formData.currentAssetPrice && (
                  <span className="ml-2 text-xs text-gray-500">
                    (Auto-selected: {formData.optionType === 'call' 
                      ? 'Call - Protection if price rises above liquidation' 
                      : 'Put - Protection if price falls below liquidation'})
                  </span>
                )}
              </label>
              <select
                name="optionType"
                value={formData.optionType}
                onChange={handleInputChange}
                className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-gray-600 transition-colors"
              >
                <option value="call">Call Option (Price rises above liquidation)</option>
                <option value="put">Put Option (Price falls below liquidation)</option>
              </select>
              {formData.liquidationPrice && formData.currentAssetPrice && (
                <p className="mt-1 text-xs text-gray-500">
                  {formData.optionType === 'call' 
                    ? `Call option selected: Protection if SOL price rises above $${parseFloat(formData.liquidationPrice).toFixed(2)}`
                    : `Put option selected: Protection if SOL price falls below $${parseFloat(formData.liquidationPrice).toFixed(2)}`
                  }
                </p>
              )}
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
                {policyRegistered && formData.liquidationPrice && (
                  <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-green-400 text-sm font-semibold">Monitoring Active</p>
                        <p className="text-gray-400 text-xs">
                          Liquidation price: ${parseFloat(formData.liquidationPrice).toFixed(2)} ({formData.optionType === 'call' ? 'Call' : 'Put'} option)
                        </p>
                      </div>
                    </div>
                  </div>
                )}
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
                <div className="text-lg font-semibold">
                  {currentSolPrice ? `$${currentSolPrice.toFixed(2)}` : (formData.currentAssetPrice ? `$${formData.currentAssetPrice}` : '$0.9997')}
                </div>
                <div className="text-xs text-gray-400">Live Price</div>
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

