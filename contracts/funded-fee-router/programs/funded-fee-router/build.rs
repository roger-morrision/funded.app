use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=FUNDED_MAINNET_PROGRAM_ID");
    println!("cargo:rerun-if-changed=build.rs");
    let production = env::var_os("CARGO_FEATURE_MAINNET_V3_PROGRAM").is_some();
    let devnet = env::var_os("CARGO_FEATURE_DEVNET_V3_PROGRAM").is_some();
    assert!(!(production && devnet), "Mainnet and Devnet program features are mutually exclusive");
    assert!(!production || env::var_os("CARGO_FEATURE_HISTORICAL_QA_RECOVERY").is_none(),
        "Historical QA recovery must never be compiled into Mainnet");
    if !production { return; }
    let id = env::var("FUNDED_MAINNET_PROGRAM_ID")
        .expect("Mainnet builds require an explicit FUNDED_MAINNET_PROGRAM_ID; there is no default");
    // Restrict generated Rust to a base58 literal. declare_id! checks its decoded length.
    let alphabet = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    assert!((32..=44).contains(&id.len()) && id.bytes().all(|b| alphabet.contains(&b)),
        "FUNDED_MAINNET_PROGRAM_ID must be a base58 public key");
    assert!(![
        "11111111111111111111111111111111",
        "61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa",
        "9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm",
    ].contains(&id.as_str()), "Mainnet requires a dedicated program identity");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("mainnet_id.rs"),
        format!("declare_id!(\"{id}\");\n")).expect("write production program identity");
}
