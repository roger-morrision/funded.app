use std::{env, fs, path::PathBuf};

fn public_key(name: &str) -> String {
    let value = env::var(name).unwrap_or_else(|_| panic!("Mainnet builds require explicit {name}; there is no default"));
    let alphabet = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    assert!((32..=44).contains(&value.len()), "{name} must be a 32-byte base58 public key");
    // Decode without build dependencies so the same guard runs standalone in CI.
    let mut decoded = vec![0u8];
    for digit in value.bytes() {
        let mut carry = alphabet.iter().position(|b| *b == digit)
            .unwrap_or_else(|| panic!("{name} must be a base58 public key")) as u32;
        for byte in decoded.iter_mut() {
            carry += u32::from(*byte) * 58;
            *byte = (carry & 255) as u8;
            carry >>= 8;
        }
        while carry > 0 { decoded.push((carry & 255) as u8); carry >>= 8; }
    }
    let significant = if decoded == [0] { 0 } else { decoded.len() };
    assert!(significant + value.bytes().take_while(|b| *b == b'1').count() == 32,
        "{name} must decode to exactly 32 bytes");
    assert!(![
        "11111111111111111111111111111111",
        "61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa",
        "9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm",
        "C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64",
        "EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32",
    ].contains(&value.as_str()), "{name} requires a dedicated Mainnet identity");
    value
}

fn main() {
    println!("cargo:rerun-if-env-changed=FUNDED_MAINNET_PROGRAM_ID");
    println!("cargo:rerun-if-env-changed=FUNDED_MAINNET_FUNDED_MINT");
    println!("cargo:rerun-if-env-changed=FUNDED_MAINNET_FUNDED_POOL");
    println!("cargo:rerun-if-changed=build.rs");
    let production = env::var_os("CARGO_FEATURE_MAINNET_V3_PROGRAM").is_some();
    let devnet = env::var_os("CARGO_FEATURE_DEVNET_V3_PROGRAM").is_some();
    assert!(!(production && devnet), "Mainnet and Devnet program features are mutually exclusive");
    assert!(!production || env::var_os("CARGO_FEATURE_HISTORICAL_QA_RECOVERY").is_none(),
        "Historical QA recovery must never be compiled into Mainnet");
    if !production { return; }
    let id = public_key("FUNDED_MAINNET_PROGRAM_ID");
    let mint = public_key("FUNDED_MAINNET_FUNDED_MINT");
    let pool = public_key("FUNDED_MAINNET_FUNDED_POOL");
    assert!(id != mint && id != pool && mint != pool, "Mainnet program, mint and pool must be distinct");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("mainnet_id.rs"),
        format!("declare_id!(\"{id}\");\n")).expect("write production program identity");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("mainnet_assets.rs"),
        format!("const FUNDED_MINT: &str = \"{mint}\";\nconst FUNDED_POOL: &str = \"{pool}\";\n"))
        .expect("write production buyback assets");
}
