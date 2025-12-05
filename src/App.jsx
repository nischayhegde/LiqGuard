import { useState, useEffect } from 'react'
import { ethers } from 'ethers'

// Get backend URL from environment variable, default to port 8000
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || '8000'
const API_BASE_URL = `http://localhost:${BACKEND_PORT}`

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
  const [showPositions, setShowPositions] = useState(false)
  const [policyRegistered, setPolicyRegistered] = useState(false)
  const [userPositions, setUserPositions] = useState([])
  const [loadingPositions, setLoadingPositions] = useState(false)
  const [currentSolPrice, setCurrentSolPrice] = useState(null)
  const [priceLoading, setPriceLoading] = useState(true)
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [account, setAccount] = useState(null)
  const [connected, setConnected] = useState(false)
  const [premiumPaid, setPremiumPaid] = useState(false)
  const [payingPremium, setPayingPremium] = useState(false)
  const [backendWalletAddress, setBackendWalletAddress] = useState(null)

  // Switch to Base mainnet if not already on it
  const switchToBaseNetwork = async () => {
    const BASE_MAINNET_CHAIN_ID = '0x2105' // 8453 in hex
    const BASE_MAINNET_CONFIG = {
      chainId: BASE_MAINNET_CHAIN_ID,
      chainName: 'Base',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    }

    try {
      // Try to switch to Base network
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_MAINNET_CHAIN_ID }],
      })
    } catch (switchError) {
      // This error code indicates that the chain has not been added to the wallet
      if (switchError.code === 4902) {
        try {
          // Add Base network to wallet
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_MAINNET_CONFIG],
          })
        } catch (addError) {
          console.error('Error adding Base network:', addError)
          throw new Error('Failed to add Base network to your wallet. Please add it manually.')
        }
      } else {
        throw switchError
      }
    }
  }

  // Connect wallet (MetaMask, Phantom, or any EIP-1193 compatible wallet) and ensure we're on Base network
  const connectWallet = async () => {
    // Check for any EIP-1193 compatible wallet (MetaMask, Phantom, etc.)
    if (typeof window.ethereum === 'undefined') {
      setError('No Ethereum wallet found. Please install MetaMask, Phantom, or another compatible wallet.')
      return
    }

    // Check if Phantom is in Solana mode (has window.solana but not Ethereum support)
    if (window.solana && !window.ethereum.isMetaMask) {
      // Phantom might need to be switched to Ethereum mode
      console.log('Phantom wallet detected. Make sure it\'s in Ethereum mode.')
    }

    try {
      // First, request accounts directly from window.ethereum (works better with Phantom)
      let accounts
      try {
        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      } catch (requestError) {
        // If direct request fails, try through ethers
        console.log('Direct request failed, trying through ethers...', requestError)
        const provider = new ethers.BrowserProvider(window.ethereum)
        accounts = await provider.send('eth_requestAccounts', [])
      }
      
      // If user cancels or no accounts, accounts will be empty
      if (!accounts || accounts.length === 0) {
        setError('Wallet connection cancelled or no accounts found. Please try again and approve the connection.')
        return
      }
      
      // Now switch to Base network after we have accounts
      try {
        await switchToBaseNetwork()
      } catch (networkError) {
        console.warn('Network switch error (continuing anyway):', networkError)
        // Continue even if network switch fails - user might already be on Base
      }
      
      // Create provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      
      // Verify we're on Base network
      const network = await provider.getNetwork()
      const BASE_MAINNET_CHAIN_ID = 8453n
      if (network.chainId !== BASE_MAINNET_CHAIN_ID) {
        // Try one more time to switch
        try {
          await switchToBaseNetwork()
          // Wait a moment for network switch
          await new Promise(resolve => setTimeout(resolve, 1000))
          // Re-check network
          const newNetwork = await provider.getNetwork()
          if (newNetwork.chainId !== BASE_MAINNET_CHAIN_ID) {
            throw new Error('Please switch to Base mainnet in your wallet')
          }
        } catch (switchErr) {
          throw new Error('Please switch to Base mainnet (Chain ID: 8453) in your wallet settings')
        }
      }
      
      setProvider(provider)
      setSigner(signer)
      setAccount(accounts[0])
      setConnected(true)
      setError(null) // Clear any previous errors
      console.log('✅ Connected to Base mainnet with account:', accounts[0])
    } catch (err) {
      console.error('Error connecting wallet:', err)
      
      // Handle specific error codes
      if (err.code === 4001 || err.code === -32002) {
        setError('Connection request rejected. Please approve the connection in your wallet and try again.')
      } else if (err.code === 4100) {
        setError('Unauthorized. Please unlock your wallet and try again.')
      } else if (err.message?.includes('authorized') || err.message?.includes('not been authorized')) {
        setError(
          'Wallet authorization required.\n\n' +
          'For Phantom wallet:\n' +
          '1. Make sure Phantom is unlocked\n' +
          '2. Click "Connect" when Phantom prompts you\n' +
          '3. Make sure you\'re in Ethereum mode (not Solana mode)\n' +
          '4. Try connecting again'
        )
      } else if (err.message?.includes('switch') || err.message?.includes('network')) {
        setError('Please approve the network switch in your wallet and try again.')
      } else if (err.message?.includes('cancelled') || err.message?.includes('rejected')) {
        setError('Wallet connection was cancelled. Please try again.')
      } else {
        setError(err.message || 'Failed to connect wallet. Please make sure your wallet is unlocked and try again.')
      }
    }
  }

  // Disconnect wallet
  const disconnectWallet = () => {
    setProvider(null)
    setSigner(null)
    setAccount(null)
    setConnected(false)
    setPremiumPaid(false)
  }

  // Pay premium with USDC
  const payPremium = async () => {
    if (!signer || !calculatedPremium) {
      setError('Please connect wallet and calculate premium first')
      return
    }

    setPayingPremium(true)
    setError(null)

    try {
      const premiumInUSD = parseFloat(calculatedPremium.toString())
      
      // Verify network is Base mainnet (chainId: 8453)
      const network = await provider.getNetwork()
      const BASE_MAINNET_CHAIN_ID = 8453n
      if (network.chainId !== BASE_MAINNET_CHAIN_ID) {
        // Try to switch networks automatically
        try {
          await switchToBaseNetwork()
          // Wait a moment for network switch
          await new Promise(resolve => setTimeout(resolve, 1000))
          // Re-check network
          const newNetwork = await provider.getNetwork()
          if (newNetwork.chainId !== BASE_MAINNET_CHAIN_ID) {
            throw new Error('Network switch failed')
          }
        } catch (switchErr) {
             throw new Error(
               `❌ Wrong network!\n\n` +
               `You are connected to chain ID: ${network.chainId}\n` +
               `Please switch to Base mainnet (chain ID: 8453)\n\n` +
               `Click "Connect Wallet" again to automatically switch networks, or manually switch in your wallet.`
             )
        }
      }
      
      // USDC contract address on Base mainnet
      const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      // USDC ABI (minimal - approve and transfer)
      const USDC_ABI = [
        'function transfer(address to, uint256 amount) returns (bool)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function balanceOf(address account) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ]
      
      // Convert USD to USDC (USDC has 6 decimals)
      const premiumAmount = ethers.parseUnits(premiumInUSD.toFixed(6), 6)
      
      console.log('💰 Premium payment:', {
        premiumUSD: premiumInUSD.toFixed(2) + ' USD',
        premiumUSDC: ethers.formatUnits(premiumAmount, 6) + ' USDC',
        network: network.name,
        chainId: network.chainId.toString()
      })
      
      // Get backend wallet address from backend API
      if (!backendWalletAddress) {
        throw new Error(
          'Backend wallet address not available.\n\n' +
          'Please make sure your backend server is running and the wallet is initialized.\n' +
          'Check backend logs for: "✅ Sender wallet initialized: 0x..."'
        )
      }
      
      // Normalize address using getAddress to ensure proper checksum format
      const backendAddress = ethers.getAddress(backendWalletAddress)
      
      // Check if user is trying to send to their own address (warn but allow for testing)
      if (account && account.toLowerCase() === backendAddress.toLowerCase()) {
        console.warn('⚠️ Warning: Sending to your own wallet address')
        console.warn('   Your wallet:', account)
        console.warn('   Backend wallet:', backendAddress)
        console.warn('   Note: For production, use different wallets. This is allowed for testing.')
      }
      
      // Get USDC contract instance
      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer)
      
      // Verify contract exists by checking code
      const code = await provider.getCode(USDC_ADDRESS)
      if (code === '0x') {
        throw new Error(
          `❌ USDC contract not found at address ${USDC_ADDRESS}\n\n` +
          `Make sure you are connected to Base mainnet (chain ID: 8453)\n` +
          `Current network: ${network.name} (chain ID: ${network.chainId})`
        )
      }
      
      // Check USDC balance with error handling
      let balance
      try {
        balance = await usdcContract.balanceOf(account)
      } catch (err) {
        console.error('Error calling balanceOf:', err)
        throw new Error(
          `❌ Failed to check USDC balance.\n\n` +
          `Make sure:\n` +
          `1. You are connected to Base mainnet (chain ID: 8453)\n` +
          `2. The USDC contract exists at ${USDC_ADDRESS}\n\n` +
          `Error: ${err.message}`
        )
      }
      
      const balanceInUSDC = parseFloat(ethers.formatUnits(balance, 6))
      
      console.log('💰 Balance check:', {
        yourBalance: balanceInUSDC.toFixed(2) + ' USDC',
        premiumAmount: premiumInUSD.toFixed(2) + ' USDC',
        sufficient: balance >= premiumAmount
      })
      
      if (balance < premiumAmount) {
        const shortfall = premiumInUSD - balanceInUSDC
        throw new Error(
          `❌ Insufficient USDC balance!\n\n` +
          `You have: ${balanceInUSDC.toFixed(2)} USDC\n` +
          `Premium requires: ${premiumInUSD.toFixed(2)} USDC\n` +
          `Need: ${shortfall.toFixed(2)} USDC more\n\n` +
          `Make sure you have sufficient USDC in your wallet.`
        )
      }
      
      // Check current allowance
      const currentAllowance = await usdcContract.allowance(account, backendAddress)
      
      // If allowance is insufficient, approve first
      if (currentAllowance < premiumAmount) {
        console.log('Approving USDC spend...')
        const approveTx = await usdcContract.approve(backendAddress, premiumAmount)
        console.log('Approve transaction sent:', approveTx.hash)
        await approveTx.wait()
        console.log('Approve transaction confirmed')
      }
      
      console.log('Transferring USDC to backend address:', backendAddress)
      console.log('Amount:', premiumInUSD.toFixed(2), 'USDC')
      
      // Transfer USDC
      const tx = await usdcContract.transfer(backendAddress, premiumAmount)

      console.log('Transaction sent:', tx.hash)
      const receipt = await tx.wait()
      console.log('Transaction confirmed:', receipt)

      // Notify backend of payment
      console.log('📤 Notifying backend of premium payment...')
      const response = await fetch(`${API_BASE_URL}/pay-premium`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userWalletAddress: account,
          premiumAmount: calculatedPremium,
          transactionSignature: tx.hash,
        }),
      })

      if (response.ok) {
        const paymentData = await response.json()
        console.log('✅ Payment confirmed by backend:', paymentData)
        setPremiumPaid(true)
        // Register policy immediately after payment confirmation
        // Don't rely on premiumPaid state since it's async
        console.log('📝 Starting policy registration...')
        await registerPolicy(true)
      } else {
        const errorData = await response.json()
        console.error('❌ Payment confirmation failed:', errorData)
        throw new Error(errorData.error || 'Failed to confirm payment')
      }
    } catch (err) {
      console.error('Error paying premium:', err)
      setError(err.message || 'Failed to pay premium')
    } finally {
      setPayingPremium(false)
    }
  }

  // Register policy after premium is paid
  const registerPolicy = async (forceRegister = false) => {
    // Allow forced registration (when called after payment) or check state
    if (!account || (!premiumPaid && !forceRegister)) {
      console.log('Skipping policy registration:', { account: !!account, premiumPaid, forceRegister })
      return
    }

    try {
      const liquidationPrice = parseFloat(formData.liquidationPrice) || 0
      if (liquidationPrice <= 0) {
        console.log('Skipping policy registration: no liquidation price')
        return
      }

      const policyData = {
        liquidationPrice: liquidationPrice,
        optionType: formData.optionType,
        insuranceAmount: parseFloat(formData.insuranceAmount) || 0,
        expirationDate: formData.expirationDate || null,
        userWalletAddress: account,
        premiumPaid: true,
        premiumAmount: parseFloat(calculatedPremium) || 0,
      }

      console.log('📝 Registering policy:', policyData)

      const response = await fetch(`${API_BASE_URL}/register-policy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(policyData),
      })

      if (response.ok) {
        const result = await response.json()
        setPolicyRegistered(true)
        console.log('✅ Policy registered successfully:', result.policyId)
        // Refresh positions after registration
        if (showPositions) {
          setTimeout(() => fetchUserPositions(), 1000)
        }
      } else {
        const errorData = await response.json()
        console.error('❌ Failed to register policy:', errorData)
        throw new Error(errorData.error || 'Failed to register policy')
      }
    } catch (err) {
      console.error('❌ Error registering policy:', err)
      setError(err.message || 'Failed to register policy. Please try again.')
    }
  }

  // Fetch current SOL price from backend
  useEffect(() => {
    const fetchSolPrice = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/current-price`)
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

  // Fetch backend wallet address from backend
  useEffect(() => {
    const fetchBackendWallet = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/backend-wallet-address`)
        if (response.ok) {
          const data = await response.json()
          setBackendWalletAddress(data.address)
          console.log('✅ Backend wallet address fetched:', data.address)
        } else {
          const errorData = await response.json()
          console.error('Failed to fetch backend wallet address:', errorData.error)
          setError('Backend wallet not initialized. Make sure backend server is running and SENDER_WALLET_PRIVATE_KEY is set.')
        }
      } catch (err) {
        console.error('Error fetching backend wallet address:', err)
        setError(`Cannot connect to backend server. Make sure it's running on ${API_BASE_URL}`)
      }
    }
    
    fetchBackendWallet()
  }, [])

  // Fetch user positions when account changes or when positions tab is opened
  const fetchUserPositions = async () => {
    if (!account) {
      setUserPositions([])
      return
    }

    setLoadingPositions(true)
    try {
      const response = await fetch(`${API_BASE_URL}/user-policies?address=${encodeURIComponent(account)}`)
      
      // Check if response is OK
      if (!response.ok) {
        // Try to parse as JSON, but handle HTML responses
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json()
          console.error('Failed to fetch user positions:', errorData.error || errorData)
        } else {
          // Response is HTML (likely an error page)
          const text = await response.text()
          console.error('Server returned HTML instead of JSON:', response.status, response.statusText)
          console.error('Response preview:', text.substring(0, 200))
        }
        setUserPositions([])
        return
      }

      // Parse JSON response
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Response is not JSON:', contentType)
        setUserPositions([])
        return
      }

      const data = await response.json()
      setUserPositions(data.policies || [])
      console.log('✅ Fetched user positions:', data.policies)
      if (data.debug) {
        console.log('📊 Debug info:', {
          totalPolicies: data.debug.totalPolicies,
          activePolicies: data.debug.activePolicies,
          searchedAddress: data.debug.searchedAddress,
          found: data.count
        })
      }
    } catch (err) {
      console.error('Error fetching user positions:', err)
      // If it's a JSON parse error, log more details
      if (err instanceof SyntaxError && err.message.includes('JSON')) {
        console.error('Failed to parse response as JSON. The server may have returned an error page.')
      }
      setUserPositions([])
    } finally {
      setLoadingPositions(false)
    }
  }

  // Fetch positions when account changes or when positions tab is shown
  useEffect(() => {
    if (showPositions && account) {
      fetchUserPositions()
    }
  }, [showPositions, account])


  // Auto-calculate premium when form data changes
  useEffect(() => {
    const insurance = parseFloat(formData.insuranceAmount) || 0
    const assetPrice = parseFloat(formData.currentAssetPrice) || 0
    
    // Only auto-calculate if we have the minimum required fields
    if (insurance > 0 && assetPrice > 0) {
      // Debounce the calculation to avoid too many API calls
      const timeoutId = setTimeout(() => {
        calculatePremium(formData)
      }, 800) // Wait 800ms after user stops typing
      
      return () => clearTimeout(timeoutId)
    } else {
      // Reset premium if required fields are missing
      setCalculatedPremium(null)
      setPremiumData(null)
      setPremiumPaid(false)
      setPolicyRegistered(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.insuranceAmount, formData.currentAssetPrice, formData.liquidationPrice, formData.optionType, formData.expirationDate])

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
      const response = await fetch(`${API_BASE_URL}/calculate-risk`, {
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
      
      // Reset premium paid status when recalculating
      setPremiumPaid(false)
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
        {/* Wallet Connection - Prominent Header */}
        <div className="mb-6 bg-[#131829] border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold mb-1">Connect Your Wallet</h2>
              <p className="text-sm text-gray-400">Connect your wallet (MetaMask, Phantom, etc.) to purchase insurance</p>
            </div>
            {!connected ? (
              <button
                onClick={connectWallet}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-sm font-medium text-green-400">
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Connected'}
                  </span>
                </div>
                <button
                  onClick={disconnectWallet}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>

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
                  readOnly
                  placeholder={priceLoading ? "Loading..." : "0.00"}
                  step="0.01"
                  min="0"
                  required
                  disabled={priceLoading}
                  className="w-full bg-[#1a1f35] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-not-allowed"
                />
                {currentSolPrice && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded">
                    Live
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {priceLoading ? 'Fetching current SOL price...' : 'Automatically updated from Pyth Network (read-only)'}
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

            {/* Premium Display and Payment Section */}
            {calculatedPremium && premiumData && (
              <div className="space-y-4">
                {/* Pay Premium Button - Prominent */}
                {!premiumPaid && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    {!connected ? (
                      <div className="text-center">
                        <p className="text-blue-400 text-sm font-semibold mb-2">Connect your wallet to purchase insurance</p>
                        <button
                          type="button"
                          onClick={connectWallet}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
                        >
                          Connect Wallet & Pay Premium
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-blue-400 text-sm font-semibold">Ready to Purchase</p>
                            <p className="text-gray-400 text-xs mt-1">
                              Premium: {calculatedPremium ? parseFloat(calculatedPremium).toFixed(2) + ' USDC' : 'Calculating...'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-white text-lg font-bold">${calculatedPremium}</p>
                            <p className="text-gray-400 text-xs">Coverage: ${formatUSD(formData.insuranceAmount)}</p>
                            <p className="text-gray-500 text-xs mt-1">
                              Pay with USDC on Base
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={payPremium}
                          disabled={payingPremium}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          {payingPremium ? (
                            <>
                              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Processing Payment...
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              Pay Premium & Take Position
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Premium Paid Status */}
                {premiumPaid && (
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-green-400 text-sm font-semibold">✅ Premium Paid Successfully</p>
                        <p className="text-gray-400 text-xs mt-1">Your policy is now active and being monitored for liquidation conditions</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Manual Calculate Button (Optional - for manual refresh) */}
            {calculatedPremium && (
              <button
                type="button"
                onClick={() => calculatePremium()}
                disabled={loading}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm py-2 rounded-lg transition-colors"
              >
                {loading ? 'Recalculating...' : 'Refresh Premium'}
              </button>
            )}
          </form>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => {
              setShowPositions(!showPositions)
              if (!showPositions && account) {
                fetchUserPositions()
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
              showPositions
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-[#131829] border-gray-800 text-gray-300 hover:text-white hover:border-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            My Positions {userPositions.length > 0 && `(${userPositions.length})`}
          </button>
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

        {/* User Positions Panel */}
        {showPositions && (
          <div className="bg-[#131829] rounded-xl p-6 mb-6 border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">My Open Positions</h2>
              <button
                onClick={fetchUserPositions}
                disabled={loadingPositions}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <svg className={`w-4 h-4 ${loadingPositions ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>

            {!connected ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-4">Please connect your wallet to view your positions</p>
                <button
                  onClick={connectWallet}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
                >
                  Connect Wallet
                </button>
              </div>
            ) : loadingPositions ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                <p className="text-gray-400 mt-4">Loading positions...</p>
              </div>
            ) : userPositions.length === 0 ? (
              <div className="text-center py-8">
                <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-gray-400 text-lg mb-2">No open positions found</p>
                <p className="text-gray-500 text-sm">Create a new insurance policy to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {userPositions.map((position, index) => {
                  const isCall = position.optionType === 'call'
                  const strikePrice = position.liquidationPrice || position.strikePrice || 0
                  const isInTheMoney = currentSolPrice && (
                    isCall 
                      ? currentSolPrice > strikePrice 
                      : currentSolPrice < strikePrice
                  )
                  
                  return (
                    <div
                      key={position.id || index}
                      className="bg-[#1a1f35] border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${isCall ? 'bg-green-500' : 'bg-red-500'}`}></div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">
                                {isCall ? 'Call' : 'Put'} Option
                              </span>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                isInTheMoney 
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                  : 'bg-gray-700 text-gray-300'
                              }`}>
                                {isInTheMoney ? 'In The Money' : 'Out of The Money'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Policy ID: {position.id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-400">Status</p>
                          <p className="text-green-400 font-semibold">Active</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Strike Price</p>
                          <p className="text-white font-semibold">${parseFloat(position.liquidationPrice || position.strikePrice || 0).toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Coverage Amount</p>
                          <p className="text-white font-semibold">${formatUSD(position.insuranceAmount || 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Current Price</p>
                          <p className="text-white font-semibold">
                            {currentSolPrice ? `$${currentSolPrice.toFixed(2)}` : 'Loading...'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Expiration</p>
                          <p className="text-white font-semibold">
                            {position.expirationDate 
                              ? new Date(position.expirationDate).toLocaleDateString()
                              : 'N/A'
                            }
                          </p>
                        </div>
                      </div>

                      {currentSolPrice && (
                        <div className="mt-4 pt-4 border-t border-gray-700">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">
                              {isCall 
                                ? `Price needs to rise above $${parseFloat(position.liquidationPrice || position.strikePrice || 0).toFixed(2)} to trigger`
                                : `Price needs to fall below $${parseFloat(position.liquidationPrice || position.strikePrice || 0).toFixed(2)} to trigger`
                              }
                            </span>
                            <span className={`text-sm font-medium ${
                              isInTheMoney ? 'text-green-400' : 'text-gray-400'
                            }`}>
                              {isInTheMoney 
                                ? '✓ Trigger Condition Met'
                                : `$${Math.abs(currentSolPrice - parseFloat(position.liquidationPrice || position.strikePrice || 0)).toFixed(2)} away`
                              }
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

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

