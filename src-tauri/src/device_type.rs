// Which RDM device is on the other end of a `device.info` reply.
//
// Its own module so `tests/device_type.rs` can `include!` and compile THIS
// source rather than mirroring it — the crate's Tauri linkage makes the
// `--lib` unittest harness unrunnable on Windows (STATUS_ENTRYPOINT_NOT_FOUND),
// and a mirrored test drifts out of lockstep without anything failing.

/// Identify the RDM device behind a `device.info` reply, or None if this is
/// not one of ours.
///
/// The RDM family shares one wire protocol but not one API, so the probe
/// cannot key off dash-only fields. `device_type` is the discriminator
/// (rdm-gps-node/docs/USB_RPC.md); dash firmware predates that field and
/// answers with `schema` instead, so its absence means "dash".
pub(crate) fn device_type_of(result: &serde_json::Value) -> Option<String> {
    // No serial: not an RDM device at all (a captive portal, an unrelated CDC).
    result.get("serial")?;
    match result.get("device_type").and_then(|v| v.as_str()) {
        Some(t) if !t.is_empty() => Some(t.to_string()),
        _ => result.get("schema").map(|_| "dash".to_string()),
    }
}
