use std::{env, fs, path::PathBuf};

fn public_key(name: &str) -> String {
    let value = env::var(name).unwrap_or_else(|_| panic!("Network builds require explicit {name}; there is no default"));
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
    ].contains(&value.as_str()), "{name} requires a dedicated program identity");
    value
}

fn main() {
    println!("cargo:rerun-if-env-changed=FUNDED_MAINNET_PROGRAM_ID");
    println!("cargo:rerun-if-env-changed=FUNDED_DEVNET_PROGRAM_ID");
    println!("cargo:rerun-if-changed=build.rs");
    let production = env::var_os("CARGO_FEATURE_MAINNET_V3_PROGRAM").is_some();
    let devnet = env::var_os("CARGO_FEATURE_DEVNET_V3_PROGRAM").is_some();
    assert!(!(production && devnet), "Mainnet and Devnet program features are mutually exclusive");
    assert!(!production || env::var_os("CARGO_FEATURE_HISTORICAL_QA_RECOVERY").is_none(),
        "Historical QA recovery must never be compiled into Mainnet");
    assert!(production || devnet || env::var_os("CARGO_FEATURE_CONFIGURABLE_RICH_ASSETS").is_none(),
        "Configurable RICH assets require a V3 network feature");
    if devnet && env::var_os("CARGO_FEATURE_CONFIGURABLE_RICH_ASSETS").is_some() {
        let id = public_key("FUNDED_DEVNET_PROGRAM_ID");
        fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("devnet_id.rs"),
            format!("declare_id!(\"{id}\");\n")).expect("write Devnet program identity");
    }
    if !production { return; }
    let id = public_key("FUNDED_MAINNET_PROGRAM_ID");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("mainnet_id.rs"),
        format!("declare_id!(\"{id}\");\n")).expect("write production program identity");
    // Reviewed WSOL/<paired token> PumpSwap pools for token-budget conversion:
    // FUNDED_MAINNET_CONVERSION_POOLS="<paired mint>:<pool>,...". Empty means
    // conversion stays unavailable until pools are reviewed.
    println!("cargo:rerun-if-env-changed=FUNDED_MAINNET_CONVERSION_POOLS");
    let raw = env::var("FUNDED_MAINNET_CONVERSION_POOLS").unwrap_or_default();
    let mut pools = Vec::new();
    for entry in raw.split(',').map(str::trim).filter(|entry| !entry.is_empty()) {
        let (paired, pool_key) = entry.split_once(':').expect("conversion pools use <paired mint>:<pool>");
        env::set_var("FUNDED_CONVERSION_ENTRY", paired);
        let paired = public_key("FUNDED_CONVERSION_ENTRY");
        env::set_var("FUNDED_CONVERSION_ENTRY", pool_key);
        let pool_key = public_key("FUNDED_CONVERSION_ENTRY");
        assert!(paired != pool_key && pool_key != id, "conversion pool must be a distinct pool address");
        pools.push(format!("(\"{paired}\", \"{pool_key}\")"));
    }
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("mainnet_conversion.rs"),
        format!("const CONVERSION_POOLS: [(&str, &str); {}] = [{}];\n", pools.len(), pools.join(", ")))
        .expect("write production conversion pools");
}
