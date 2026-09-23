pub const SEED: &[u8] = b"funded-fee-router-v1";
pub const CLAIM_SEED: &[u8] = b"claim";
pub const MINT_ROUTER_SEED: &[u8] = b"funded-mint-router-v2";
pub const MINT_ROUTER_MAGIC: &[u8; 8] = b"FUNDMNT2";
pub const MINT_ROUTER_VERSION: u8 = 2;
pub const MINT_ROUTER_DATA_LEN: usize = 106;
pub const MAGIC: &[u8; 8] = b"FUNDFEE1";
pub const VERSION: u8 = 1;
pub const POLICY_HASH: [u8; 32] = [
    0x0e, 0x05, 0x7c, 0x44, 0xe5, 0xe3, 0xe3, 0x37,
    0x72, 0xe5, 0x39, 0xc9, 0x94, 0xcf, 0x73, 0xed,
    0x44, 0xc6, 0x9b, 0xa7, 0xa8, 0xf5, 0x7b, 0xa2,
    0x3f, 0xff, 0xa1, 0xc1, 0x0b, 0x89, 0x0e, 0x8b,
];
pub const ROUTER_HEADER_LEN: usize = 41;
pub const ROUTER_DATA_LEN: usize = 74;
pub const REWARD_VAULT_SEED: &[u8] = b"reward-vault-v1";
pub const REWARD_CYCLE_SEED: &[u8] = b"reward-cycle-v1";
pub const REWARD_PAYMENT_SEED: &[u8] = b"reward-payment-v1";
pub const REWARD_LEAF_DOMAIN: &[u8] = b"funded-reward-leaf-v1";
