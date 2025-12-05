use anchor_lang::prelude::*;
use anchor_spl::associated_token::{AssociatedToken, get_associated_token_address};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("D7hq6vJ7J9BkzZc8iXuGRynsTdXGiRcCWzyBPgPe9FNy");

// Program authority - only this address can create and close policies
// TODO: Replace with your actual program authority public key
// This should be the public key of the keypair that will sign create_policy and close_policy transactions
const PROGRAM_AUTHORITY: Pubkey = Pubkey::from_str_const("GhgQwWfyZqjjaDBtVUmmc3rg9NEX9qQYhew1ACFRJmp8");

#[program]
pub mod policyfactory {
    use super::*;

    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        nonce: u64,
        strike_price: u64,
        expiration_datetime: i64,
        underlying_asset: UnderlyingAsset,
        call_or_put: CallOrPut,
        coverage_amount: u64,
        premium: u64,
        payout_wallet: Pubkey,
        payment_mint: Pubkey,
    ) -> Result<()> {
        // Validate inputs
        require!(premium > 0, ErrorCode::InvalidAmount);
        require!(coverage_amount > 0, ErrorCode::InvalidAmount);
        require!(strike_price > 0, ErrorCode::InvalidAmount);

        // Verify the caller is the program authority
        require!(
            ctx.accounts.authority.key() == PROGRAM_AUTHORITY,
            ErrorCode::UnauthorizedProgramAuthority
        );

        let policy = &mut ctx.accounts.policy;
        
        policy.authority = ctx.accounts.authority.key();
        policy.nonce = nonce;
        policy.strike_price = strike_price;
        policy.expiration_datetime = expiration_datetime;
        policy.underlying_asset = underlying_asset;
        policy.call_or_put = call_or_put;
        policy.coverage_amount = coverage_amount;
        policy.premium = premium;
        policy.payout_wallet = payout_wallet;
        policy.payment_mint = payment_mint;
        policy.status = PolicyStatus::Inactive;
        policy.bump = ctx.bumps.policy;

        msg!(
            "Policy created: nonce={}, strike={}, expiration={}, asset={:?}, type={:?}, coverage={}, premium={}",
            nonce,
            strike_price,
            expiration_datetime,
            underlying_asset,
            call_or_put,
            coverage_amount,
            premium
        );

        Ok(())
    }

    pub fn activate_policy(ctx: Context<ActivatePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        
        // Verify the caller is the payout wallet
        require!(
            ctx.accounts.payer.key() == policy.payout_wallet,
            ErrorCode::UnauthorizedPayer
        );

        // Verify policy is inactive
        require!(
            policy.status == PolicyStatus::Inactive,
            ErrorCode::PolicyAlreadyActive
        );

        // Verify payer has sufficient balance before attempting transfer
        require!(
            ctx.accounts.payer_token_account.amount >= policy.premium,
            ErrorCode::InsufficientBalance
        );

        // Verify authority token account is the correct ATA for policy.authority
        // (The associated_token constraint handles payer_token_account verification)
        let expected_ata = get_associated_token_address(
            &policy.authority,
            &policy.payment_mint
        );
        require!(
            ctx.accounts.authority_token_account.key() == expected_ata,
            ErrorCode::InvalidTokenAccount
        );

        // Transfer premium from payer to authority's wallet
        // If this fails, the entire transaction will be rolled back atomically
        // and the policy status will remain Inactive
        let cpi_accounts = Transfer {
            from: ctx.accounts.payer_token_account.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, policy.premium)?;

        // Only set policy status to active after successful transfer
        // If transfer fails, this line won't execute due to transaction rollback
        policy.status = PolicyStatus::Active;

        msg!("Policy activated by payout wallet: {}", policy.payout_wallet);

        Ok(())
    }

    pub fn close_policy(ctx: Context<ClosePolicy>, payout: bool) -> Result<()> {
        let policy = &ctx.accounts.policy;

        // Verify the caller is the program authority
        require!(
            ctx.accounts.authority.key() == PROGRAM_AUTHORITY,
            ErrorCode::UnauthorizedProgramAuthority
        );

        // Only payout if policy is active AND payout is requested
        if payout && policy.status == PolicyStatus::Active {
            // Verify authority token account is the correct ATA for policy.authority
            let expected_authority_ata = get_associated_token_address(
                &policy.authority,
                &policy.payment_mint
            );
            require!(
                ctx.accounts.authority_token_account.key() == expected_authority_ata,
                ErrorCode::InvalidTokenAccount
            );

            // Verify payout token account is the correct ATA for policy.payout_wallet
            let expected_payout_ata = get_associated_token_address(
                &policy.payout_wallet,
                &policy.payment_mint
            );
            require!(
                ctx.accounts.payout_token_account.key() == expected_payout_ata,
                ErrorCode::InvalidTokenAccount
            );

            // Verify authority has sufficient balance before attempting transfer
            require!(
                ctx.accounts.authority_token_account.amount >= policy.coverage_amount,
                ErrorCode::InsufficientBalance
            );

            // Transfer coverage amount from authority's wallet to payout wallet
            let cpi_accounts = Transfer {
                from: ctx.accounts.authority_token_account.to_account_info(),
                to: ctx.accounts.payout_token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, policy.coverage_amount)?;

            msg!("Policy closed with payout: {} tokens to {}", policy.coverage_amount, policy.payout_wallet);
        } else {
            msg!("Policy closed without payout");
        }

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(nonce: u64, strike_price: u64, expiration_datetime: i64)]
pub struct CreatePolicy<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Policy::LEN,
        seeds = [b"policy", authority.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub policy: Account<'info, Policy>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivatePolicy<'info> {
    #[account(mut)]
    pub policy: Account<'info, Policy>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        mut,
        associated_token::mint = policy.payment_mint,
        associated_token::authority = payer
    )]
    pub payer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct ClosePolicy<'info> {
    #[account(mut, close = authority)]
    pub policy: Account<'info, Policy>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub payout_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
pub struct Policy {
    pub authority: Pubkey,
    pub nonce: u64,
    pub strike_price: u64,
    pub expiration_datetime: i64,
    pub underlying_asset: UnderlyingAsset,
    pub call_or_put: CallOrPut,
    pub coverage_amount: u64,
    pub premium: u64,
    pub payout_wallet: Pubkey,
    pub payment_mint: Pubkey,
    pub status: PolicyStatus,
    pub bump: u8,
}

impl Policy {
    pub const LEN: usize = 32 + // authority
        8 + // nonce
        8 + // strike_price
        8 + // expiration_datetime
        1 + // underlying_asset
        1 + // call_or_put
        8 + // coverage_amount
        8 + // premium
        32 + // payout_wallet
        32 + // payment_mint
        1 + // status
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum UnderlyingAsset {
    BTC,
    ETH,
    SOL,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CallOrPut {
    Call,
    Put,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PolicyStatus {
    Inactive,
    Active,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized payer - only payout wallet can activate policy")]
    UnauthorizedPayer,
    #[msg("Policy is already active")]
    PolicyAlreadyActive,
    #[msg("Policy is not active")]
    PolicyNotActive,
    #[msg("Unauthorized authority - only policy authority can call this instruction")]
    UnauthorizedAuthority,
    #[msg("Unauthorized program authority - only program authority can call this instruction")]
    UnauthorizedProgramAuthority,
    #[msg("Insufficient balance - payer does not have enough tokens to pay the premium")]
    InsufficientBalance,
    #[msg("Token mint mismatch - token accounts must match the policy's payment mint")]
    TokenMintMismatch,
    #[msg("Invalid amount - premium, coverage amount, and strike price must be greater than zero")]
    InvalidAmount,
    #[msg("Invalid token account - token account owner does not match expected owner")]
    InvalidTokenAccount,
}
