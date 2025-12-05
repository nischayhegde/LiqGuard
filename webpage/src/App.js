import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ConnectionProvider, WalletProvider, useWallet, } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton, } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl, Connection, PublicKey, } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddress, } from "@solana/spl-token";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL } from "./idl/policyfactory";
import "@solana/wallet-adapter-react-ui/styles.css";
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const RPC_ENDPOINT = import.meta.env.VITE_RPC_URL ?? clusterApiUrl("devnet");
const defaultExpiration = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
};
function InsuranceApp() {
    const wallet = useWallet();
    const [config, setConfig] = useState(null);
    const [quote, setQuote] = useState(null);
    const [policy, setPolicy] = useState(null);
    const [status, setStatus] = useState("");
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [policyLoading, setPolicyLoading] = useState(false);
    const [form, setForm] = useState({
        asset: "BTC",
        callOrPut: "CALL",
        strikePrice: 30000,
        coverage: 100,
        expiration: defaultExpiration(),
    });
    useEffect(() => {
        axios
            .get(`${API_BASE}/config`)
            .then((res) => setConfig(res.data))
            .catch((err) => {
            console.error(err);
            setStatus("Unable to load server config");
        });
    }, []);
    const handleChange = (key, value) => {
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
            const { data } = await axios.post(`${API_BASE}/quote`, body);
            setQuote(data);
            setStatus("Quote refreshed from oracle pricing");
        }
        catch (error) {
            setStatus(error?.response?.data?.error ?? "Failed to fetch quote");
        }
        finally {
            setQuoteLoading(false);
        }
    };
    const activatePolicy = async (policyAddress, paymentMint) => {
        if (!wallet.publicKey || !wallet.sendTransaction || !config) {
            throw new Error("Connect your wallet first");
        }
        const connection = new Connection(RPC_ENDPOINT, "confirmed");
        const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
        const program = new Program(IDL, new PublicKey(config.programId), provider);
        const payerAta = await getAssociatedTokenAddress(new PublicKey(paymentMint), wallet.publicKey);
        const authorityAta = await getAssociatedTokenAddress(new PublicKey(paymentMint), new PublicKey(config.authority));
        const tx = await program.methods
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
        const signature = await wallet.sendTransaction(tx, provider.connection);
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
            const { data } = await axios.post(`${API_BASE}/policies`, body);
            setPolicy(data);
            setStatus("Policy created. Activating with your wallet…");
            const sig = await activatePolicy(data.policyAddress, data.paymentMint);
            setStatus(`Policy activated. Signature: ${sig}`);
        }
        catch (error) {
            setStatus(error?.response?.data?.error ?? "Policy creation failed");
        }
        finally {
            setPolicyLoading(false);
        }
    };
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("div", { className: "card inline", style: { justifyContent: "space-between" }, children: [_jsxs("div", { children: [_jsx("h2", { style: { margin: 0 }, children: "LiqGuard Insurance" }), _jsx("div", { className: "pill", children: config ? `Program: ${config.programId}` : "Loading config…" })] }), _jsx(WalletMultiButton, {})] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "grid", children: [_jsxs("div", { children: [_jsx("label", { children: "Underlying Asset" }), _jsxs("select", { value: form.asset, onChange: (e) => handleChange("asset", e.target.value), children: [_jsx("option", { value: "BTC", children: "BTC" }), _jsx("option", { value: "ETH", children: "ETH" }), _jsx("option", { value: "SOL", children: "SOL" })] })] }), _jsxs("div", { children: [_jsx("label", { children: "Call or Put" }), _jsxs("select", { value: form.callOrPut, onChange: (e) => handleChange("callOrPut", e.target.value), children: [_jsx("option", { value: "CALL", children: "Call" }), _jsx("option", { value: "PUT", children: "Put" })] })] }), _jsxs("div", { children: [_jsx("label", { children: "Strike Price (USD)" }), _jsx("input", { type: "number", value: form.strikePrice, onChange: (e) => handleChange("strikePrice", Number(e.target.value)) })] }), _jsxs("div", { children: [_jsx("label", { children: "Coverage (USDC)" }), _jsx("input", { type: "number", value: form.coverage, onChange: (e) => handleChange("coverage", Number(e.target.value)) })] }), _jsxs("div", { children: [_jsx("label", { children: "Expiration" }), _jsx("input", { type: "datetime-local", value: form.expiration, onChange: (e) => handleChange("expiration", e.target.value) })] })] }), _jsxs("div", { className: "cta-row", children: [_jsx("button", { disabled: quoteLoading, onClick: handleQuote, children: quoteLoading ? "Loading quote…" : "Get Quote" }), _jsx("button", { disabled: !quote || policyLoading, onClick: handleCreatePolicy, children: policyLoading ? "Creating…" : "Confirm Policy" }), status && _jsx("div", { className: "status", children: status })] })] }), quote && (_jsxs("div", { className: "card", children: [_jsx("h3", { className: "section-title", children: "Pricing" }), _jsxs("div", { className: "grid", children: [_jsxs("div", { children: [_jsx("label", { children: "Spot (Pyth)" }), _jsxs("div", { className: "pill", children: ["$", quote.spot.toFixed(2)] })] }), _jsxs("div", { children: [_jsx("label", { children: "Fair Premium" }), _jsxs("div", { className: "pill", children: ["$", quote.pricing.fairPremium.toFixed(4)] })] }), _jsxs("div", { children: [_jsx("label", { children: "Vig (20%)" }), _jsxs("div", { className: "pill", children: ["$", quote.pricing.vigAmount.toFixed(4)] })] }), _jsxs("div", { children: [_jsx("label", { children: "Total Premium" }), _jsxs("div", { className: "pill", children: ["$", quote.pricing.totalPremium.toFixed(4), " USDC"] })] }), _jsxs("div", { children: [_jsx("label", { children: "Hit Probability" }), _jsxs("div", { className: "pill", children: [(quote.pricing.breachProbability * 100).toFixed(2), "%"] })] })] })] })), policy && (_jsxs("div", { className: "card", children: [_jsx("h3", { className: "section-title", children: "Policy Created" }), _jsxs("div", { className: "grid", children: [_jsxs("div", { children: [_jsx("label", { children: "Policy Address" }), _jsx("div", { className: "pill", children: policy.policyAddress })] }), _jsxs("div", { children: [_jsx("label", { children: "Create Tx" }), _jsx("div", { className: "pill", children: policy.createSignature })] }), _jsxs("div", { children: [_jsx("label", { children: "Premium (atomic)" }), _jsx("div", { className: "pill", children: policy.premiumAtomic })] })] })] }))] }));
}
export default function App() {
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
    return (_jsx(ConnectionProvider, { endpoint: RPC_ENDPOINT, children: _jsx(WalletProvider, { wallets: wallets, autoConnect: true, children: _jsx(WalletModalProvider, { children: _jsx(InsuranceApp, {}) }) }) }));
}
