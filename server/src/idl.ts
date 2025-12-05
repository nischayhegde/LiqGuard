// IDL type definition for policyfactory program
// This should match the generated IDL from Anchor
export type Policyfactory = {
  version: "0.1.0";
  name: "policyfactory";
  instructions: [
    {
      name: "createPolicy";
      accounts: [
        {
          name: "policy";
          isMut: true;
          isSigner: false;
        },
        {
          name: "authority";
          isMut: true;
          isSigner: true;
        },
        {
          name: "systemProgram";
          isMut: false;
          isSigner: false;
        }
      ];
      args: [
        {
          name: "nonce";
          type: "u64";
        },
        {
          name: "strikePrice";
          type: "u64";
        },
        {
          name: "expirationDatetime";
          type: "i64";
        },
        {
          name: "underlyingAsset";
          type: {
            defined: "UnderlyingAsset";
          };
        },
        {
          name: "callOrPut";
          type: {
            defined: "CallOrPut";
          };
        },
        {
          name: "coverageAmount";
          type: "u64";
        },
        {
          name: "premium";
          type: "u64";
        },
        {
          name: "payoutWallet";
          type: "publicKey";
        },
        {
          name: "paymentMint";
          type: "publicKey";
        }
      ];
    },
    {
      name: "activatePolicy";
      accounts: [
        {
          name: "policy";
          isMut: true;
          isSigner: false;
        },
        {
          name: "payer";
          isMut: true;
          isSigner: true;
        },
        {
          name: "payerTokenAccount";
          isMut: true;
          isSigner: false;
        },
        {
          name: "authorityTokenAccount";
          isMut: true;
          isSigner: false;
        },
        {
          name: "tokenProgram";
          isMut: false;
          isSigner: false;
        }
      ];
      args: [];
    },
    {
      name: "closePolicy";
      accounts: [
        {
          name: "policy";
          isMut: true;
          isSigner: false;
        },
        {
          name: "authority";
          isMut: true;
          isSigner: true;
        },
        {
          name: "authorityTokenAccount";
          isMut: true;
          isSigner: false;
        },
        {
          name: "payoutTokenAccount";
          isMut: true;
          isSigner: false;
        },
        {
          name: "tokenProgram";
          isMut: false;
          isSigner: false;
        }
      ];
      args: [
        {
          name: "payout";
          type: "bool";
        }
      ];
    }
  ];
  accounts: [
    {
      name: "Policy";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "publicKey";
          },
          {
            name: "nonce";
            type: "u64";
          },
          {
            name: "strikePrice";
            type: "u64";
          },
          {
            name: "expirationDatetime";
            type: "i64";
          },
          {
            name: "underlyingAsset";
            type: {
              defined: "UnderlyingAsset";
            };
          },
          {
            name: "callOrPut";
            type: {
              defined: "CallOrPut";
            };
          },
          {
            name: "coverageAmount";
            type: "u64";
          },
          {
            name: "premium";
            type: "u64";
          },
          {
            name: "payoutWallet";
            type: "publicKey";
          },
          {
            name: "paymentMint";
            type: "publicKey";
          },
          {
            name: "status";
            type: {
              defined: "PolicyStatus";
            };
          },
          {
            name: "bump";
            type: "u8";
          }
        ];
      };
    }
  ];
  types: [
    {
      name: "UnderlyingAsset";
      type: {
        kind: "enum";
        variants: [
          {
            name: "Btc";
          },
          {
            name: "Eth";
          },
          {
            name: "Sol";
          }
        ];
      };
    },
    {
      name: "CallOrPut";
      type: {
        kind: "enum";
        variants: [
          {
            name: "Call";
          },
          {
            name: "Put";
          }
        ];
      };
    },
    {
      name: "PolicyStatus";
      type: {
        kind: "enum";
        variants: [
          {
            name: "Inactive";
          },
          {
            name: "Active";
          }
        ];
      };
    }
  ];
  errors: [
    {
      code: 6000;
      name: "UnauthorizedPayer";
      msg: "Unauthorized payer - only payout wallet can activate policy";
    },
    {
      code: 6001;
      name: "PolicyAlreadyActive";
      msg: "Policy is already active";
    },
    {
      code: 6002;
      name: "PolicyNotActive";
      msg: "Policy is not active";
    },
    {
      code: 6003;
      name: "UnauthorizedAuthority";
      msg: "Unauthorized authority - only policy authority can call this instruction";
    },
    {
      code: 6004;
      name: "InsufficientBalance";
      msg: "Insufficient balance - payer does not have enough tokens to pay the premium";
    },
    {
      code: 6005;
      name: "TokenMintMismatch";
      msg: "Token mint mismatch - token accounts must match the policy's payment mint";
    },
    {
      code: 6006;
      name: "InvalidAmount";
      msg: "Invalid amount - premium, coverage amount, and strike price must be greater than zero";
    },
    {
      code: 6007;
      name: "InvalidTokenAccount";
      msg: "Invalid token account - token account owner does not match expected owner";
    }
  ];
};
