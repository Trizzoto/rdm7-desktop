//! Device-type discrimination, against payloads captured from real hardware.
//!
//! `include!`s the real module source rather than linking the crate: the Tauri
//! lib pulls in DLLs that make the `--lib` unittest harness fail to start on
//! Windows, and mirroring the function here would let it drift out of lockstep
//! with the code it claims to cover.

include!("../src/device_type.rs");

/// Captured 2026-07-27 from the RDM GPS node on COM37 (firmware 0.1.0) — this
/// is the exact `result` object the board replies with, not a hand-written
/// approximation. It carries `serial` but NO `schema`, which is precisely why
/// the old probe (which required `schema`) never recognised the puck.
fn real_gps_device_info() -> serde_json::Value {
    serde_json::json!({
        "device_type": "gps", "device_class": 2, "name": "RDM GPS",
        "serial": "1CDBD4880D18", "firmware": "0.1.0", "hw_rev": 0,
        "base_id": 1024, "bitrate_idx": 2, "bitrate": "500 kbps",
        "fast_hz": 25, "slow_hz": 5, "imu_present": true
    })
}

#[test]
fn recognises_the_real_gps_node() {
    assert_eq!(device_type_of(&real_gps_device_info()).as_deref(), Some("gps"));
}

#[test]
fn absent_device_type_means_dash() {
    // Dash firmware predates the field and answers with `schema` instead.
    // Treating its absence as "dash" is what keeps every device already in the
    // field working unchanged.
    let dash = serde_json::json!({ "serial": "A1B2C3D4E5F6", "schema": 17 });
    assert_eq!(device_type_of(&dash).as_deref(), Some("dash"));
}

#[test]
fn future_nodes_are_taken_at_their_word() {
    let keypad = serde_json::json!({ "serial": "0011", "device_type": "keypad" });
    assert_eq!(device_type_of(&keypad).as_deref(), Some("keypad"));
}

#[test]
fn rejects_anything_that_is_not_ours() {
    // No serial at all — a captive portal or an unrelated CDC device.
    assert_eq!(device_type_of(&serde_json::json!({ "schema": 17 })), None);
    // A serial but neither discriminator: not enough to claim it is a dash.
    assert_eq!(device_type_of(&serde_json::json!({ "serial": "X" })), None);
    assert_eq!(device_type_of(&serde_json::json!({})), None);
    // An empty string must not be mistaken for a declared type.
    assert_eq!(
        device_type_of(&serde_json::json!({ "serial": "X", "device_type": "" })),
        None
    );
}
