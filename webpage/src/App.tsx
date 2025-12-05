// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL, Policyfactory } from "./idl/policyfactory";
import "@solana/wallet-adapter-react-ui/styles.css";

type CallOrPut = "CALL" | "PUT";
type Asset = "BTC" | "ETH" | "SOL";

type QuoteResponse = {
  asset: Asset;
  callOrPut: CallOrPut;
  spot: number;
  strikePrice: number;
  coverage: number;
  expiration: string;
  pricing: {
    fairPremium: number;
    vigAmount: number;
    totalPremium: number;
    breachProbability: number;
  };
  chainValues: {
    strikePriceAtomic: number;
    coverageAtomic: number;
    premiumAtomic: number;
    paymentMint: string;
  };
};

type PolicyResponse = {
  policyAddress: string;
  createSignature: string;
  paymentMint: string;
  strikePriceAtomic: number;
  coverageAtomic: number;
  premiumAtomic: number;
};

type ServerConfig = {
  programId: string;
  authority: string;
  paymentMint: string;
  pythFeeds: Record<string, string>;
  vigRate: number;
  riskFreeRate: number;
  volatilityDefaults: Record<string, number>;
  decimals: {
    strike: number;
    token: number;
  };
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_URL ?? clusterApiUrl("devnet");

const defaultExpiration = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 16);
};

function InsuranceApp() {
  const wallet = useWallet();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [status, setStatus] = useState<string>("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);

  const [form, setForm] = useState({
    asset: "BTC" as Asset,
    callOrPut: "CALL" as CallOrPut,
    strikePrice: 30000,
    coverage: 100,
    expiration: defaultExpiration(),
  });

  useEffect(() => {
    axios
      .get<ServerConfig>(`${API_BASE}/config`)
      .then((res) => setConfig(res.data))
      .catch((err) => {
        console.error(err);
        setStatus("Unable to load server config");
      });
  }, []);

  const handleChange = (
    key: keyof typeof form,
    value: string | number
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleQuote = async () => {
    setQuote(null);
    setPolicy(null);
    setStatus("");
    setQuoteLoading(true);
    try {
      const body = {
        ...form,
        strikePrice: Number(form.strikePrice),
        coverage: Number(form.coverage),
        expiration: new Date(form.expiration).toISOString(),
      };
      const { data } = await axios.post<QuoteResponse>(
        `${API_BASE}/quote`,
        body
      );
      setQuote(data);
      setStatus("Quote refreshed from oracle pricing");
    } catch (error: any) {
      setStatus(error?.response?.data?.error ?? "Failed to fetch quote");
    } finally {
      setQuoteLoading(false);
    }
  };

  const activatePolicy = async (
    policyAddress: string,
    paymentMint: string
  ): Promise<TransactionSignature> => {
    if (!wallet.publicKey || !wallet.sendTransaction || !config) {
      throw new Error("Connect your wallet first");
    }

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const provider = new AnchorProvider(
      connection,
      wallet as any,
      AnchorProvider.defaultOptions()
    );
    // Loosen typing for the Anchor client to avoid IDE/TS noise
    const program = new Program(
      IDL as any,
      config.programId as any,
      provider as any
    ) as any;

    const payerAta = await getAssociatedTokenAddress(
      new PublicKey(paymentMint),
      wallet.publicKey
    );
    const authorityAta = await getAssociatedTokenAddress(
      new PublicKey(paymentMint),
      new PublicKey(config.authority)
    );

    const tx = await (program as any).methods
      .activatePolicy()
      .accounts({
        policy: new PublicKey(policyAddress),
        payer: wallet.publicKey,
        payerTokenAccount: payerAta,
        authorityTokenAccount: authorityAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .transaction();

    const signature = await wallet.sendTransaction(
      tx,
      provider.connection
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
    return signature;
  };

  const handleCreatePolicy = async () => {
    if (!wallet.publicKey) {
      setStatus("Connect your wallet first.");
      return;
    }
    setPolicyLoading(true);
    setStatus("Creating policy on server…");
    try {
      const body = {
        ...form,
        strikePrice: Number(form.strikePrice),
        coverage: Number(form.coverage),
        expiration: new Date(form.expiration).toISOString(),
        payoutWallet: wallet.publicKey.toBase58(),
      };
      const { data } = await axios.post<PolicyResponse>(
        `${API_BASE}/policies`,
        body
      );
      setPolicy(data);
      setStatus("Policy created. Activating with your wallet…");
      const sig = await activatePolicy(
        data.policyAddress,
        data.paymentMint
      );
      setStatus(`Policy activated. Signature: ${sig}`);
    } catch (error: any) {
      setStatus(error?.response?.data?.error ?? "Policy creation failed");
    } finally {
      setPolicyLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="card inline" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>LiqGuard Insurance</h2>
          <div className="pill">
            {config ? `Program: ${config.programId}` : "Loading config…"}
          </div>
        </div>
        <WalletMultiButton />
      </div>

      <div className="card">
        <div className="grid">
          <div>
            <label>Underlying Asset</label>
            <select
              value={form.asset}
              onChange={(e) =>
                handleChange("asset", e.target.value as Asset)
              }
            >
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="SOL">SOL</option>
            </select>
          </div>
          <div>
            <label>Call or Put</label>
            <select
              value={form.callOrPut}
              onChange={(e) =>
                handleChange("callOrPut", e.target.value as CallOrPut)
              }
            >
              <option value="CALL">Call</option>
              <option value="PUT">Put</option>
            </select>
          </div>
          <div>
            <label>Strike Price (USD)</label>
            <input
              type="number"
              value={form.strikePrice}
              onChange={(e) =>
                handleChange("strikePrice", Number(e.target.value))
              }
            />
          </div>
          <div>
            <label>Coverage (USDC)</label>
            <input
              type="number"
              value={form.coverage}
              onChange={(e) =>
                handleChange("coverage", Number(e.target.value))
              }
            />
          </div>
          <div>
            <label>Expiration</label>
            <input
              type="datetime-local"
              value={form.expiration}
              onChange={(e) => handleChange("expiration", e.target.value)}
            />
          </div>
        </div>
        <div className="cta-row">
          <button disabled={quoteLoading} onClick={handleQuote}>
            {quoteLoading ? "Loading quote…" : "Get Quote"}
          </button>
          <button
            disabled={!quote || policyLoading}
            onClick={handleCreatePolicy}
          >
            {policyLoading ? "Creating…" : "Confirm Policy"}
          </button>
          {status && <div className="status">{status}</div>}
        </div>
      </div>

      {quote && (
        <div className="card">
          <h3 className="section-title">Pricing</h3>
          <div className="grid">
            <div>
              <label>Spot (Pyth)</label>
              <div className="pill">${quote.spot.toFixed(2)}</div>
            </div>
            <div>
              <label>Fair Premium</label>
              <div className="pill">
                ${quote.pricing.fairPremium.toFixed(4)}
              </div>
            </div>
            <div>
              <label>Vig (20%)</label>
              <div className="pill">${quote.pricing.vigAmount.toFixed(4)}</div>
            </div>
            <div>
              <label>Total Premium</label>
              <div className="pill">
                ${quote.pricing.totalPremium.toFixed(4)} USDC
              </div>
            </div>
            <div>
              <label>Hit Probability</label>
              <div className="pill">
                {(quote.pricing.breachProbability * 100).toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {policy && (
        <div className="card">
          <h3 className="section-title">Policy Created</h3>
          <div className="grid">
            <div>
              <label>Policy Address</label>
              <div className="pill">{policy.policyAddress}</div>
            </div>
            <div>
              <label>Create Tx</label>
              <div className="pill">{policy.createSignature}</div>
            </div>
            <div>
              <label>Premium (atomic)</label>
              <div className="pill">{policy.premiumAtomic}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <InsuranceApp />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
