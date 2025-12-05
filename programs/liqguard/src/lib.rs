use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod liqguard {
    use super::*;

    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        strike_price: u64,
        is_long_insurance: bool,
        coverage_amount: u64,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        policy.owner = ctx.accounts.owner.key();
        policy.strike_price = strike_price;
        policy.is_long_insurance = is_long_insurance;
        policy.coverage_amount = coverage_amount;
        policy.is_claimed = false;
        policy.policy_bump = ctx.bumps.policy;
        policy.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn liquidate_policy(ctx: Context<LiquidatePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        
        // Check if already claimed
        require!(!policy.is_claimed, LiqGuardError::AlreadyClaimed);

        // BTC/USD Feed ID: e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
        let btc_feed_id = get_feed_id_from_hex(
            "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
        )?;

        // Get price from Pyth price update account
        let price_update = &ctx.accounts.price_update;
        
        // Get price no older than 60 seconds
        let price_info = price_update.get_price_no_older_than(&btc_feed_id, 60)
            .ok_or(LiqGuardError::PriceStale)?;

        // Step 3: Normalize Price
        // Pyth returns price as i64 with an exponent
        // Example: price = 9500000000000, expo = -8
        // Normalized = 9500000000000 / 10^8 = 95000
        let price_magnitude = price_info.price.magnitude;
        let price_exponent = price_info.price.exponent;
        
        // Handle negative prices (shouldn't happen for BTC, but be safe)
        require!(price_magnitude >= 0, LiqGuardError::MathOverflow);
        
        // Calculate normalization factor: 10^|exponent|
        // Since exponent is negative (e.g., -8), we need to divide by 10^8
        let normalization_factor = 10u64
            .checked_pow(price_exponent.abs() as u32)
            .ok_or(LiqGuardError::MathOverflow)?;
        
        // Normalize to USD (divide by 10^|exponent|)
        let current_price = (price_magnitude as u64)
            .checked_div(normalization_factor)
            .ok_or(LiqGuardError::MathOverflow)?;

        // Step 4: Check Direction
        let should_liquidate = if policy.is_long_insurance {
            // Protect Long: Pay if price drops below strike
            // is_long_insurance = true: "I am Long BTC. I am afraid it will drop. Pay me if Price < Strike."
            current_price < policy.strike_price
        } else {
            // Protect Short: Pay if price rises above strike
            // is_long_insurance = false: "I am Short BTC. I am afraid it will moon. Pay me if Price > Strike."
            current_price > policy.strike_price
        };

        require!(should_liquidate, LiqGuardError::LiquidationConditionNotMet);

        // Step 5: Transfer SOL from vault to user and mark as claimed
        let seeds = &[
            b"vault",
            policy.owner.as_ref(),
            &[policy.vault_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer,
        );

        anchor_lang::system_program::transfer(cpi_context, policy.coverage_amount)?;

        policy.is_claimed = true;

        msg!(
            "Liquidation executed: Price={}, Strike={}, Direction={}, Amount={}",
            current_price,
            policy.strike_price,
            if policy.is_long_insurance { "Long" } else { "Short" },
            policy.coverage_amount
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Policy::LEN,
        seeds = [b"policy", owner.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, Policy>,
    
    #[account(
        init,
        payer = owner,
        space = 8,
        seeds = [b"vault", owner.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LiquidatePolicy<'info> {
    #[account(
        mut,
        seeds = [b"policy", policy.owner.as_ref()],
        bump = policy.policy_bump
    )]
    pub policy: Account<'info, Policy>,

    /// CHECK: Pyth price update account
    pub price_update: Account<'info, PriceUpdateV2>,

    #[account(
        mut,
        seeds = [b"vault", policy.owner.as_ref()],
        bump = policy.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: User account to receive payout
    #[account(mut)]
    pub user: AccountInfo<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Policy {
    pub owner: Pubkey,
    pub strike_price: u64,        // USD price (e.g., 95000)
    pub is_long_insurance: bool,  // true = Protect Long, false = Protect Short
    pub coverage_amount: u64,     // lamports
    pub is_claimed: bool,
    pub policy_bump: u8,
    pub vault_bump: u8,
}

impl Policy {
    pub const LEN: usize = 32 + 8 + 1 + 8 + 1 + 1 + 1; // owner + strike_price + is_long_insurance + coverage_amount + is_claimed + policy_bump + vault_bump
}

#[error_code]
pub enum LiqGuardError {
    #[msg("Price data is too stale")]
    PriceStale,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Liquidation condition not met")]
    LiquidationConditionNotMet,
    #[msg("Policy has already been claimed")]
    AlreadyClaimed,
}

