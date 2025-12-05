import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Database file path
const DB_PATH = path.join(process.cwd(), 'liqguard.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    user_wallet_address TEXT NOT NULL,
    strike_price REAL NOT NULL,
    option_type TEXT NOT NULL CHECK(option_type IN ('call', 'put')),
    insurance_amount REAL NOT NULL,
    premium_amount REAL NOT NULL,
    expiration_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved', 'expired', 'cancelled')),
    premium_paid BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    payout_tx_hash TEXT,
    policy_account_address TEXT,
    smart_contract_address TEXT,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_user_wallet ON policies(user_wallet_address);
  CREATE INDEX IF NOT EXISTS idx_status ON policies(status);
  CREATE INDEX IF NOT EXISTS idx_strike_price ON policies(strike_price);
  CREATE INDEX IF NOT EXISTS idx_created_at ON policies(created_at);
`);

// Policy interface
export interface Policy {
  id: string;
  userWalletAddress: string;
  strikePrice: number;
  optionType: 'call' | 'put';
  insuranceAmount: number;
  premiumAmount: number;
  expirationDate?: string | null;
  status: 'active' | 'resolved' | 'expired' | 'cancelled';
  premiumPaid: boolean;
  createdAt: string;
  resolvedAt?: string | null;
  payoutTxHash?: string | null;
  policyAccountAddress?: string | null;
  smartContractAddress?: string | null;
  metadata?: string | null;
}

// Database operations
export const dbOperations = {
  // Create a new policy
  createPolicy(policy: Omit<Policy, 'id' | 'createdAt'>): Policy {
    const id = `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date().toISOString();
    
    const stmt = db.prepare(`
      INSERT INTO policies (
        id, user_wallet_address, strike_price, option_type, insurance_amount,
        premium_amount, expiration_date, status, premium_paid, created_at,
        policy_account_address, smart_contract_address, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      policy.userWalletAddress,
      policy.strikePrice,
      policy.optionType,
      policy.insuranceAmount,
      policy.premiumAmount,
      policy.expirationDate || null,
      policy.status,
      policy.premiumPaid ? 1 : 0,
      createdAt,
      policy.policyAccountAddress || null,
      policy.smartContractAddress || null,
      policy.metadata ? JSON.stringify(policy.metadata) : null
    );
    
    return this.getPolicy(id)!;
  },

  // Get a policy by ID
  getPolicy(id: string): Policy | null {
    const stmt = db.prepare('SELECT * FROM policies WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return this.mapRowToPolicy(row);
  },

  // Get all policies for a user
  getUserPolicies(userWalletAddress: string, status?: string): Policy[] {
    let query = 'SELECT * FROM policies WHERE user_wallet_address = ?';
    const params: any[] = [userWalletAddress.toLowerCase()];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.mapRowToPolicy(row));
  },

  // Get all active policies
  getActivePolicies(): Policy[] {
    const stmt = db.prepare(`
      SELECT * FROM policies 
      WHERE status = 'active' 
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as any[];
    
    return rows.map(row => this.mapRowToPolicy(row));
  },

  // Update policy status
  updatePolicyStatus(id: string, status: Policy['status'], payoutTxHash?: string): boolean {
    const updates: string[] = ['status = ?'];
    const params: any[] = [status];
    
    if (payoutTxHash) {
      updates.push('payout_tx_hash = ?');
      updates.push('resolved_at = ?');
      params.push(payoutTxHash);
      params.push(new Date().toISOString());
    }
    
    const stmt = db.prepare(`
      UPDATE policies 
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    
    const result = stmt.run(...params, id);
    return result.changes > 0;
  },

  // Mark policy as resolved
  markPolicyResolved(id: string, payoutTxHash: string): boolean {
    return this.updatePolicyStatus(id, 'resolved', payoutTxHash);
  },

  // Get policies that need monitoring (active and not expired)
  getPoliciesToMonitor(): Policy[] {
    const stmt = db.prepare(`
      SELECT * FROM policies 
      WHERE status = 'active' 
        AND (expiration_date IS NULL OR expiration_date > datetime('now'))
      ORDER BY strike_price ASC
    `);
    const rows = stmt.all() as any[];
    
    return rows.map(row => this.mapRowToPolicy(row));
  },

  // Helper to map database row to Policy object
  mapRowToPolicy(row: any): Policy {
    return {
      id: row.id,
      userWalletAddress: row.user_wallet_address,
      strikePrice: row.strike_price,
      optionType: row.option_type,
      insuranceAmount: row.insurance_amount,
      premiumAmount: row.premium_amount,
      expirationDate: row.expiration_date,
      status: row.status,
      premiumPaid: row.premium_paid === 1,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      payoutTxHash: row.payout_tx_hash,
      policyAccountAddress: row.policy_account_address,
      smartContractAddress: row.smart_contract_address,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  },

  // Close database connection
  close(): void {
    db.close();
  }
};

// Export database instance for direct access if needed
export { db };

