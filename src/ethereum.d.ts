// Type declarations for Ethereum/MetaMask
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      send: (method: string, params?: any[]) => Promise<any>;
      isMetaMask?: boolean;
    };
  }
}

export {};

