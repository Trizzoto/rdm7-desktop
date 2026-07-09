use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

// ── Device Discovery (HTTP subnet sweep) ────────────────────────────
// The firmware removed mDNS (2026-04-27, memory pressure), so discovery
// probes every host on the local /24 subnets with GET /api/device/info —
// the firmware answers with a JSON body containing "serial" and CORS *.
// ~254 hosts x 400 ms connect timeout at 128-way concurrency ≈ 2 s.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub ip: String,
    pub port: u16,
    pub hostname: String,
    pub serial: String,
    pub version: String,
    pub schema: String,
}

/// Probe one IP for an RDM-7. Any HTTP 200 from /api/device/info whose JSON
/// carries a string "serial" is treated as a dash.
async fn probe_device_info(
    client: &reqwest::Client,
    ip: &str,
    timeout: Duration,
) -> Option<DiscoveredDevice> {
    let url = format!("http://{ip}/api/device/info");
    let resp = client.get(&url).timeout(timeout).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().await.ok()?;
    let serial = v.get("serial")?.as_str()?.to_string();
    let schema = v
        .get("schema")
        .map(|s| s.to_string())
        .unwrap_or_default();
    let w = v.pointer("/display/width").and_then(|x| x.as_i64()).unwrap_or(0);
    let h = v.pointer("/display/height").and_then(|x| x.as_i64()).unwrap_or(0);
    let shape = v
        .pointer("/display/shape")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let dims = if w > 0 {
        format!(" {w}\u{00D7}{h}{}", if shape == "round" { " round" } else { "" })
    } else {
        String::new()
    };
    Some(DiscoveredDevice {
        ip: ip.to_string(),
        port: 80,
        hostname: format!("RDM-7 {serial}{dims}"),
        serial,
        version: String::new(),
        schema,
    })
}

/// Candidate /24 subnets from every non-loopback IPv4 interface. Covers both
/// the LAN (dash on home WiFi) and the 192.168.4.x case (PC joined to the
/// dash's own hotspot).
fn local_subnets() -> Vec<(u8, u8, u8)> {
    let mut nets: Vec<(u8, u8, u8)> = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if let std::net::IpAddr::V4(ip) = iface.addr.ip() {
                let o = ip.octets();
                let link_local = o[0] == 169 && o[1] == 254;
                if !iface.is_loopback() && !link_local {
                    let key = (o[0], o[1], o[2]);
                    if !nets.contains(&key) {
                        nets.push(key);
                    }
                }
            }
        }
    }
    nets
}

#[tauri::command]
async fn discover_devices(
    app: tauri::AppHandle,
    extra_ips: Option<Vec<String>>,
) -> Result<Vec<DiscoveredDevice>, String> {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(400))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    // Known/likely IPs first (last-connected etc.) with a friendlier timeout.
    let mut candidates: Vec<String> = extra_ips.unwrap_or_default();
    let subnets = local_subnets();
    for (a, b, c) in &subnets {
        for d in 1..=254u8 {
            let ip = format!("{a}.{b}.{c}.{d}");
            if !candidates.contains(&ip) {
                candidates.push(ip);
            }
        }
    }
    if candidates.is_empty() {
        return Err("No local IPv4 network found to scan".into());
    }

    let total = candidates.len();
    let scanned = Arc::new(AtomicUsize::new(0));
    let sem = Arc::new(tokio::sync::Semaphore::new(128));
    let mut set = tokio::task::JoinSet::new();

    for ip in candidates {
        let client = client.clone();
        let sem = sem.clone();
        let scanned = scanned.clone();
        let app = app.clone();
        set.spawn(async move {
            let _permit = sem.acquire_owned().await.ok()?;
            let dev = probe_device_info(&client, &ip, Duration::from_millis(1500)).await;
            let done = scanned.fetch_add(1, Ordering::Relaxed) + 1;
            if done % 32 == 0 || dev.is_some() || done == total {
                let _ = app.emit(
                    "scan-progress",
                    serde_json::json!({ "scanned": done, "total": total, "found": dev.is_some() }),
                );
            }
            dev
        });
    }

    let mut devices: Vec<DiscoveredDevice> = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok(Some(dev)) = res {
            /* Serial is unique per chip — the same dash reachable on two
             * interface addresses is still one device. */
            if !devices.iter().any(|d| d.serial == dev.serial) {
                devices.push(dev);
            }
        }
    }
    devices.sort_by(|a, b| a.ip.cmp(&b.ip));
    Ok(devices)
}

/// Probe a single IP — used by the frontend for fast reconnect checks
/// before falling back to a full sweep.
#[tauri::command]
async fn probe_device(ip: String, timeout_ms: Option<u64>) -> Result<Option<DiscoveredDevice>, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(timeout_ms.unwrap_or(1500).min(5000)))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    Ok(probe_device_info(&client, &ip, Duration::from_millis(timeout_ms.unwrap_or(1500))).await)
}

// ── File System Commands ────────────────────────────────────────────

#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
async fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write {path}: {e}"))
}

// ── Serial Port Protocol ────────────────────────────────────────────

const STX: u8 = 0x02;
const ETX: u8 = 0x03;
const PAYLOAD_JSON: u8 = 0x00;
const PAYLOAD_BINARY: u8 = 0x01;
const CHUNK_SIZE: usize = 4096;

/// ANSI CSI SGR escape stripper (e.g. "\x1B[0;32m" used by ESP-IDF log colors).
/// Strips only the SGR subset (`\x1B[ ... m`); other CSI sequences are rare in
/// log output and left alone to keep this cheap.
fn strip_ansi(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1B && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b';') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'm' {
                i = j + 1;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Append raw bytes to the log-line accumulator and emit any complete
/// `\n`-terminated lines as `serial-log` events. Strips ANSI SGR escapes.
fn ingest_log_bytes(buf: &mut String, bytes: &[u8], app: &tauri::AppHandle) {
    /* Lossy UTF-8 — boot logs occasionally contain garbage bytes (esp. before
     * UART pad setup); we don't want them to drop entire lines. */
    buf.push_str(&String::from_utf8_lossy(bytes));
    while let Some(nl) = buf.find('\n') {
        let line: String = buf.drain(..=nl).collect();
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            continue;
        }
        let cleaned = strip_ansi(trimmed);
        let _ = app.emit("serial-log", cleaned);
    }
    /* Cap the partial-line buffer so a missing '\n' can't grow it without
     * bound (e.g. binary garbage during boot). 8KB is generous for any real
     * single log line. */
    if buf.len() > 8192 {
        if let Some(idx) = buf.char_indices().nth(buf.len() / 2).map(|(i, _)| i) {
            buf.drain(..idx);
        } else {
            buf.clear();
        }
    }
}

fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// Build a framed message: STX + 4-byte LE length + payload + CRC16 LE + ETX
fn build_frame(payload: &[u8]) -> Vec<u8> {
    let len = payload.len() as u32;
    let crc = crc16_ccitt(payload);
    let mut frame = Vec::with_capacity(1 + 4 + payload.len() + 2 + 1);
    frame.push(STX);
    frame.extend_from_slice(&len.to_le_bytes());
    frame.extend_from_slice(payload);
    frame.extend_from_slice(&crc.to_le_bytes());
    frame.push(ETX);
    frame
}

/// Build a JSON request frame with type tag
fn build_json_frame(json: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(1 + json.len());
    payload.push(PAYLOAD_JSON);
    payload.extend_from_slice(json.as_bytes());
    build_frame(&payload)
}

/// Build a binary chunk frame with type tag
fn build_binary_frame(session_id: u64, chunk_idx: u16, data: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(1 + 8 + 2 + data.len());
    payload.push(PAYLOAD_BINARY);
    payload.extend_from_slice(&session_id.to_le_bytes());
    payload.extend_from_slice(&chunk_idx.to_le_bytes());
    payload.extend_from_slice(data);
    build_frame(&payload)
}

/// Read a complete frame from a serial port, returning the payload.
///
/// Bytes received outside a frame are interleaved ESP_LOG output: they're
/// accumulated into `log_buf` and emitted to the frontend as `serial-log`
/// events on each `\n`. `log_buf` persists across calls so a line split
/// across multiple `read_frame` calls (or by an intervening frame) is
/// preserved. Times out after `timeout`.
fn read_frame(
    port: &mut Box<dyn serialport::SerialPort>,
    log_buf: &mut String,
    app: &tauri::AppHandle,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let start = std::time::Instant::now();
    let mut byte_buf = [0u8; 1];

    // Wait for STX — non-STX bytes are log output and get routed to the Logs UI.
    loop {
        if start.elapsed() > timeout {
            return Err("Timeout waiting for STX".into());
        }
        match port.read(&mut byte_buf) {
            Ok(1) if byte_buf[0] == STX => break,
            Ok(0) => return Err("Port closed (EOF)".into()),
            Ok(_) => ingest_log_bytes(log_buf, &byte_buf, app),
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(e) => return Err(format!("Read error: {e}")),
        }
    }

    // Read 4-byte length
    let mut len_buf = [0u8; 4];
    read_exact(port, &mut len_buf, timeout.saturating_sub(start.elapsed()))?;
    let payload_len = u32::from_le_bytes(len_buf) as usize;
    if payload_len == 0 || payload_len > 256 * 1024 {
        return Err(format!("Invalid frame length: {payload_len}"));
    }

    // Read payload
    let mut payload = vec![0u8; payload_len];
    read_exact(port, &mut payload, timeout.saturating_sub(start.elapsed()))?;

    // Read CRC16
    let mut crc_buf = [0u8; 2];
    read_exact(port, &mut crc_buf, timeout.saturating_sub(start.elapsed()))?;
    let received_crc = u16::from_le_bytes(crc_buf);

    // Read ETX
    let mut etx_buf = [0u8; 1];
    read_exact(port, &mut etx_buf, timeout.saturating_sub(start.elapsed()))?;
    if etx_buf[0] != ETX {
        return Err(format!("Expected ETX, got 0x{:02X}", etx_buf[0]));
    }

    // Validate CRC
    let computed_crc = crc16_ccitt(&payload);
    if received_crc != computed_crc {
        return Err(format!("CRC mismatch: got 0x{received_crc:04X}, expected 0x{computed_crc:04X}"));
    }

    Ok(payload)
}

/// Read exactly `buf.len()` bytes from the port within timeout
fn read_exact(port: &mut Box<dyn serialport::SerialPort>, buf: &mut [u8], timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    let mut pos = 0;
    while pos < buf.len() {
        if start.elapsed() > timeout {
            return Err("Timeout reading frame data".into());
        }
        match port.read(&mut buf[pos..]) {
            Ok(n) => pos += n,
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(e) => return Err(format!("Read error: {e}")),
        }
    }
    Ok(())
}

/// Parse a JSON response payload (strips type tag byte)
fn parse_json_response(payload: &[u8]) -> Result<serde_json::Value, String> {
    if payload.is_empty() {
        return Err("Empty payload".into());
    }
    if payload[0] != PAYLOAD_JSON {
        return Err(format!("Expected JSON payload type, got 0x{:02X}", payload[0]));
    }
    let json_str = std::str::from_utf8(&payload[1..])
        .map_err(|e| format!("Invalid UTF-8: {e}"))?;
    serde_json::from_str(json_str)
        .map_err(|e| format!("Invalid JSON: {e}"))
}

// Global serial port connection
struct SerialConnection {
    port: Option<Box<dyn serialport::SerialPort>>,
    port_name: String,
    request_id: u32,
    /// Partial log line — accumulates non-framed bytes between '\n' chars.
    /// Persists across read_frame calls so a line split by an intervening
    /// frame, or arriving in multiple reads, isn't lost.
    log_partial: String,
}

impl SerialConnection {
    fn new() -> Self {
        Self {
            port: None,
            port_name: String::new(),
            request_id: 0,
            log_partial: String::new(),
        }
    }
}

// Thread-safe global state
static SERIAL: std::sync::LazyLock<Mutex<SerialConnection>> =
    std::sync::LazyLock::new(|| Mutex::new(SerialConnection::new()));

// ── Serial Port Info ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SerialPortInfo {
    pub name: String,
    pub vid: u16,
    pub pid: u16,
    pub manufacturer: String,
    pub product: String,
    pub port_type: String,  // "uart_bridge" or "usb_cdc"
}

/// Known UART bridge VID/PID pairs
#[allow(dead_code)]
const KNOWN_BRIDGES: &[(u16, u16)] = &[
    (0x10C4, 0xEA60), // CP2102/CP2104
    (0x1A86, 0x7523), // CH340
    (0x1A86, 0x55D3), // CH343
    (0x1A86, 0x55D4), // CH9102
    (0x0403, 0x6001), // FTDI FT232R
    (0x0403, 0x6015), // FTDI FT231X
];

/// Known USB CDC VID/PID pairs (ESP32-S3 native USB)
const KNOWN_CDC: &[(u16, u16)] = &[
    (0x303A, 0x4001), // Espressif USB JTAG/serial debug unit
    (0x303A, 0x4002), // Espressif ESP32-S3 CDC
    (0x303A, 0x1001), // Espressif TinyUSB CDC
];

fn classify_port(vid: u16, pid: u16) -> &'static str {
    if KNOWN_CDC.iter().any(|&(v, p)| v == vid && p == pid) {
        "usb_cdc"
    } else {
        "uart_bridge"
    }
}

#[tauri::command]
async fn serial_list_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports()
        .map_err(|e| format!("Failed to list ports: {e}"))?;

    let mut result = Vec::new();
    for p in ports {
        let (vid, pid, manufacturer, product) = match &p.port_type {
            serialport::SerialPortType::UsbPort(usb) => (
                usb.vid,
                usb.pid,
                usb.manufacturer.clone().unwrap_or_default(),
                usb.product.clone().unwrap_or_default(),
            ),
            _ => continue, // skip non-USB ports
        };

        result.push(SerialPortInfo {
            name: p.port_name,
            vid,
            pid,
            manufacturer,
            product,
            port_type: classify_port(vid, pid).to_string(),
        });
    }
    Ok(result)
}

/// Read one frame from the port without emitting log events (used pre-connect
/// during port probing, where no AppHandle exists and bytes are noise).
fn read_frame_silent(
    port: &mut Box<dyn serialport::SerialPort>,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let start = std::time::Instant::now();
    let mut byte_buf = [0u8; 1];

    loop {
        if start.elapsed() > timeout {
            return Err("Timeout waiting for STX".into());
        }
        match port.read(&mut byte_buf) {
            Ok(1) if byte_buf[0] == STX => break,
            Ok(0) => return Err("Port closed (EOF)".into()),
            Ok(_) => continue,
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(e) => return Err(format!("Read error: {e}")),
        }
    }

    let mut len_buf = [0u8; 4];
    read_exact(port, &mut len_buf, timeout.saturating_sub(start.elapsed()))?;
    let payload_len = u32::from_le_bytes(len_buf) as usize;
    if payload_len == 0 || payload_len > 256 * 1024 {
        return Err(format!("Invalid frame length: {payload_len}"));
    }
    let mut payload = vec![0u8; payload_len];
    read_exact(port, &mut payload, timeout.saturating_sub(start.elapsed()))?;
    let mut crc_buf = [0u8; 2];
    read_exact(port, &mut crc_buf, timeout.saturating_sub(start.elapsed()))?;
    let received_crc = u16::from_le_bytes(crc_buf);
    let mut etx_buf = [0u8; 1];
    read_exact(port, &mut etx_buf, timeout.saturating_sub(start.elapsed()))?;
    if etx_buf[0] != ETX {
        return Err(format!("Expected ETX, got 0x{:02X}", etx_buf[0]));
    }
    let computed_crc = crc16_ccitt(&payload);
    if received_crc != computed_crc {
        return Err(format!("CRC mismatch: got 0x{received_crc:04X}, expected 0x{computed_crc:04X}"));
    }
    Ok(payload)
}

/// Probe a serial port to check if an RDM-7 device is connected.
/// Opens the port, sends a device.info request, checks for valid response.
/// Retries once in case port-open toggled DTR and reset the device.
fn probe_port(port_name: &str) -> bool {
    let port = serialport::new(port_name, 921600)
        .timeout(Duration::from_millis(100))
        .open();

    let mut port = match port {
        Ok(p) => p,
        Err(_) => return false,
    };

    // Prevent DTR/RTS toggling from resetting the device
    let _ = port.write_data_terminal_ready(false);
    let _ = port.write_request_to_send(false);

    // Wait for device to be ready (ESP32 may have been reset by port open)
    std::thread::sleep(Duration::from_millis(500));

    // Flush any pending boot output
    let mut flush_buf = [0u8; 4096];
    loop {
        match port.read(&mut flush_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => continue,
        }
    }

    let request = serde_json::json!({
        "id": 0,
        "method": "device.info",
        "params": {},
    });
    let json_str = serde_json::to_string(&request).unwrap_or_default();
    let frame = build_json_frame(&json_str);

    // Try up to 2 times (device may need time after DTR reset)
    for attempt in 0..2 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(1000));
            // Flush again before retry
            loop {
                match port.read(&mut flush_buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => continue,
                }
            }
        }

        if port.write_all(&frame).is_err() {
            continue;
        }
        let _ = port.flush();

        match read_frame_silent(&mut port, Duration::from_millis(2000)) {
            Ok(payload) => {
                if let Ok(resp) = parse_json_response(&payload) {
                    if let Some(result) = resp.get("result") {
                        if result.get("serial").is_some() && result.get("schema").is_some() {
                            return true;
                        }
                    }
                }
            }
            Err(_) => continue,
        }
    }
    false
}

/// Auto-detect RDM-7 device by probing all USB serial ports
#[tauri::command]
async fn serial_auto_detect() -> Result<Option<SerialPortInfo>, String> {
    let ports = serialport::available_ports()
        .map_err(|e| format!("Failed to list ports: {e}"))?;

    let usb_ports: Vec<_> = ports.into_iter().filter_map(|p| {
        match &p.port_type {
            serialport::SerialPortType::UsbPort(usb) => Some(SerialPortInfo {
                name: p.port_name.clone(),
                vid: usb.vid,
                pid: usb.pid,
                manufacturer: usb.manufacturer.clone().unwrap_or_default(),
                product: usb.product.clone().unwrap_or_default(),
                port_type: classify_port(usb.vid, usb.pid).to_string(),
            }),
            _ => None,
        }
    }).collect();

    // Try CDC ports first (faster transport), then UART bridges
    let mut cdc_ports: Vec<_> = usb_ports.iter().filter(|p| p.port_type == "usb_cdc").collect();
    let mut uart_ports: Vec<_> = usb_ports.iter().filter(|p| p.port_type == "uart_bridge").collect();
    let ordered: Vec<_> = cdc_ports.drain(..).chain(uart_ports.drain(..)).collect();

    for port_info in ordered {
        if probe_port(&port_info.name) {
            return Ok(Some(port_info.clone()));
        }
    }

    Ok(None)
}

#[tauri::command]
async fn serial_connect(app: tauri::AppHandle, port_name: String) -> Result<String, String> {
    // Close any existing port first so the OS releases the handle
    {
        let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
        if conn.port.is_some() {
            drop(conn.port.take());
            conn.port_name.clear();
            conn.log_partial.clear();
        }
    }
    // Brief pause to let Windows fully release the handle
    tokio::time::sleep(Duration::from_millis(50)).await;

    let port = serialport::new(&port_name, 921600)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Failed to open {port_name}: {e}"))?;

    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    conn.port = Some(port);
    conn.port_name = port_name.clone();
    conn.request_id = 0;
    conn.log_partial.clear();
    drop(conn);

    /* Spawn idle-drain task: while no RPC is in flight, pull any bytes the
     * firmware has sent and route log lines to the Logs UI. Exits when the
     * port is disconnected. */
    spawn_log_drain(app);

    Ok(format!("Connected to {port_name}"))
}

/// Background task: every ~80ms, if we can grab the SERIAL lock without
/// blocking, drain any bytes that arrived between RPCs and route them to
/// the Logs UI. Exits when the port becomes None (disconnect).
fn spawn_log_drain(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(80));

            let mut conn = match SERIAL.try_lock() {
                Ok(c) => c,
                Err(_) => continue, // RPC in flight; it will drain on its own
            };

            if conn.port.is_none() {
                return; // disconnected
            }

            /* Destructure for disjoint field borrows — we mutate both
             * conn.port and conn.log_partial below. */
            let SerialConnection { port: port_opt, log_partial, .. } = &mut *conn;
            let port = match port_opt.as_mut() {
                Some(p) => p,
                None => return,
            };

            let bytes_available = port.bytes_to_read().unwrap_or(0);
            if bytes_available == 0 {
                continue;
            }

            /* Drain whatever's pending. The try_lock above guarantees no
             * RPC is in flight, so any bytes here are either log text or
             * (unexpected) unsolicited frame bytes. */
            let mut buf = [0u8; 4096];
            match port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    /* Split on STX: bytes before STX are log text; if STX
                     * appears we have to drain the rest of that frame too,
                     * since we've already taken its leading byte out of the
                     * OS RX buffer. */
                    let stx_pos = buf[..n].iter().position(|&b| b == STX);
                    let drain_len = stx_pos.unwrap_or(n);
                    if drain_len > 0 {
                        ingest_log_bytes(log_partial, &buf[..drain_len], &app);
                    }
                    if let Some(stx_pos) = stx_pos {
                        let already = &buf[stx_pos..n];
                        let _ = consume_unsolicited_frame(port, already, log_partial, &app);
                    }
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => {
                    /* Port error → probably disconnected. Drop the port so
                     * subsequent commands return "Not connected" cleanly. */
                    *port_opt = None;
                    return;
                }
            }
        }
    });
}

/// Best-effort consume of a frame whose STX we've already swallowed during
/// idle draining. `already` contains bytes from STX onward that were in the
/// read buffer. Discards the frame (we're not in an RPC context, so no one
/// is waiting for the response). Logs go to `log_buf` as usual.
fn consume_unsolicited_frame(
    port: &mut Box<dyn serialport::SerialPort>,
    already: &[u8],
    _log_buf: &mut String,
    _app: &tauri::AppHandle,
) -> Result<(), String> {
    /* already[0] == STX. Need length(4) + payload + crc(2) + etx(1). */
    if already.len() < 5 {
        let mut more = vec![0u8; 5 - already.len()];
        read_exact(port, &mut more, Duration::from_millis(500))?;
        let mut buf = already.to_vec();
        buf.extend_from_slice(&more);
        return drain_rest_of_frame(port, &buf);
    }
    drain_rest_of_frame(port, already)
}

fn drain_rest_of_frame(
    port: &mut Box<dyn serialport::SerialPort>,
    head: &[u8],
) -> Result<(), String> {
    let payload_len = u32::from_le_bytes([head[1], head[2], head[3], head[4]]) as usize;
    if payload_len == 0 || payload_len > 256 * 1024 {
        return Err("Invalid frame length in unsolicited frame".into());
    }
    let needed = 1 + 4 + payload_len + 2 + 1;
    let mut total = head.to_vec();
    if total.len() < needed {
        let mut more = vec![0u8; needed - total.len()];
        read_exact(port, &mut more, Duration::from_millis(2000))?;
        total.extend_from_slice(&more);
    }
    Ok(())
}

#[tauri::command]
async fn serial_disconnect() -> Result<(), String> {
    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    drop(conn.port.take()); // Explicit drop to release OS handle
    conn.port_name.clear();
    Ok(())
}

#[tauri::command]
async fn serial_is_connected() -> Result<bool, String> {
    let conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(conn.port.is_some())
}

#[tauri::command]
async fn serial_get_port() -> Result<String, String> {
    let conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(conn.port_name.clone())
}

/// Send a JSON-RPC request and return the parsed response
#[tauri::command]
async fn serial_request(
    app: tauri::AppHandle,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;

    let id = {
        conn.request_id += 1;
        conn.request_id
    };

    /* Split borrow: take port out so we can pass &mut log_partial alongside. */
    let mut port = conn.port.take().ok_or("Not connected")?;

    let result = (|| -> Result<serde_json::Value, String> {
        let request = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });
        let json_str = serde_json::to_string(&request)
            .map_err(|e| format!("JSON serialization error: {e}"))?;

        let frame = build_json_frame(&json_str);
        port.write_all(&frame).map_err(|e| format!("Write error: {e}"))?;
        port.flush().map_err(|e| format!("Flush error: {e}"))?;

        // Longer timeout for screenshot and layout.current (large responses)
        let timeout = if method == "screenshot" || method == "layout.current" {
            Duration::from_secs(10)
        } else {
            Duration::from_secs(5)
        };

        let payload = read_frame(&mut port, &mut conn.log_partial, &app, timeout)?;
        parse_json_response(&payload)
    })();

    conn.port = Some(port);
    result
}

/// Helper: send a JSON-RPC request and read response (requires lock already held)
fn serial_rpc_locked(
    port: &mut Box<dyn serialport::SerialPort>,
    log_buf: &mut String,
    app: &tauri::AppHandle,
    id: u32,
    method: &str,
    params: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let request = serde_json::json!({
        "id": id,
        "method": method,
        "params": params,
    });
    let json_str = serde_json::to_string(&request)
        .map_err(|e| format!("JSON serialization error: {e}"))?;
    let frame = build_json_frame(&json_str);
    port.write_all(&frame).map_err(|e| format!("Write error: {e}"))?;
    port.flush().map_err(|e| format!("Flush error: {e}"))?;
    let payload = read_frame(port, log_buf, app, timeout)?;
    let resp = parse_json_response(&payload)?;

    // Check for device-side errors ({"result": null, "error": "..."})
    if let Some(err) = resp.get("error") {
        if !err.is_null() {
            let msg = err.as_str().unwrap_or("Unknown device error");
            return Err(format!("Device error: {msg}"));
        }
    }

    Ok(resp)
}

/// Send a chunked binary upload over serial (for images, fonts, OTA)
#[tauri::command]
async fn serial_upload_chunked(
    app: tauri::AppHandle,
    upload_type: String,
    name: String,
    data: Vec<u8>,
) -> Result<serde_json::Value, String> {
    // Run entire upload synchronously under one lock to avoid Send issues
    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    let total_size = data.len();

    // Pre-allocate request IDs (avoid borrow conflicts with port)
    let start_id = conn.request_id + 1;
    let abort_id = conn.request_id + 2;
    let finish_id = conn.request_id + 3;
    conn.request_id += 3;

    // Take the port out temporarily to avoid double-borrow
    let mut port = conn.port.take().ok_or("Not connected")?;
    let log_buf = &mut conn.log_partial;

    let result = (|| -> Result<serde_json::Value, String> {
        // Step 1: Send upload.start request
        let start_resp = serial_rpc_locked(&mut port, log_buf, &app, start_id, "upload.start", serde_json::json!({
            "type": upload_type,
            "name": name,
            "size": total_size,
        }), Duration::from_secs(5));

        // If "Upload already in progress", abort the stale session and retry
        let start_resp = match &start_resp {
            Err(e) if e.contains("Upload already in progress") => {
                let _ = serial_rpc_locked(&mut port, log_buf, &app, abort_id, "upload.abort",
                    serde_json::json!({}), Duration::from_secs(2));
                serial_rpc_locked(&mut port, log_buf, &app, start_id, "upload.start", serde_json::json!({
                    "type": upload_type,
                    "name": name,
                    "size": total_size,
                }), Duration::from_secs(5))?
            }
            _ => start_resp?,
        };

        // Extract session info from response
        let result = start_resp.get("result").ok_or("Missing result in upload.start response")?;
        let session_id = result.get("session")
            .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
            .ok_or("Missing session ID")?;
        let chunk_size = result.get("chunk_size")
            .and_then(|v| v.as_u64())
            .unwrap_or(CHUNK_SIZE as u64) as usize;
        let total_chunks = result.get("total_chunks")
            .and_then(|v| v.as_u64())
            .ok_or("Missing total_chunks")? as u16;

        // Step 2: Send binary chunks
        for chunk_idx in 0..total_chunks {
            let offset = chunk_idx as usize * chunk_size;
            let end = std::cmp::min(offset + chunk_size, data.len());
            let chunk_data = &data[offset..end];

            let frame = build_binary_frame(session_id, chunk_idx, chunk_data);
            port.write_all(&frame).map_err(|e| format!("Write error at chunk {chunk_idx}: {e}"))?;
            port.flush().map_err(|e| format!("Flush error: {e}"))?;

            // Wait for ACK — allow extra time for flash-busy ESP32
            let payload = read_frame(&mut port, log_buf, &app, Duration::from_secs(10))?;
            let ack = parse_json_response(&payload)?;

            let ack_result = ack.get("result").ok_or("Missing ACK result")?;
            let ok = ack_result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            if !ok {
                let _ = serial_rpc_locked(&mut port, log_buf, &app, abort_id, "upload.abort",
                    serde_json::json!({}), Duration::from_secs(2));
                return Err(format!("Chunk {} rejected by device", chunk_idx));
            }
        }

        // Step 3: Send upload.finish (large files need time for flash write)
        serial_rpc_locked(&mut port, log_buf, &app, finish_id, "upload.finish",
            serde_json::json!({}), Duration::from_secs(30))
    })();

    // On failure, try to abort the upload so the device doesn't stay stuck
    if result.is_err() {
        let _ = serial_rpc_locked(&mut port, log_buf, &app, abort_id, "upload.abort",
            serde_json::json!({}), Duration::from_secs(2));
    }

    // Put the port back
    conn.port = Some(port);
    result
}

// ── Serial Binary Download (single lock, emits progress events) ─────

#[tauri::command]
async fn serial_download_base64(
    app: tauri::AppHandle,
    download_type: String,
    name: String,
) -> Result<String, String> {
    use base64::Engine;

    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    let mut port = conn.port.take().ok_or("Not connected")?;

    let result = (|| -> Result<String, String> {
        /* Step 1: download.start — get metadata */
        conn.request_id += 1;
        let req_id = conn.request_id;
        let resp = serial_rpc_locked(
            &mut port, &mut conn.log_partial, &app, req_id, "download.start",
            serde_json::json!({"type": download_type, "name": name}),
            Duration::from_secs(5),
        )?;

        if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
            return Err(format!("Device error: {err}"));
        }
        let result_obj = resp.get("result").ok_or("Missing result")?;
        let size = result_obj.get("size").and_then(|v| v.as_u64())
            .ok_or("Missing size — firmware may need updating")? as usize;
        let chunks = result_obj.get("chunks").and_then(|v| v.as_u64())
            .ok_or("Missing chunks")? as usize;

        /* Step 2: download chunks — binary frames, lock held throughout */
        let mut data = Vec::with_capacity(size);

        for i in 0..chunks {
            conn.request_id += 1;
            let req_id = conn.request_id;
            let request = serde_json::json!({
                "id": req_id,
                "method": "download.chunk",
                "params": {"type": download_type, "name": name, "index": i},
            });
            let json_str = serde_json::to_string(&request)
                .map_err(|e| format!("JSON error: {e}"))?;
            let frame = build_json_frame(&json_str);
            port.write_all(&frame).map_err(|e| format!("Write error: {e}"))?;
            port.flush().map_err(|e| format!("Flush error: {e}"))?;

            let payload = read_frame(&mut port, &mut conn.log_partial, &app, Duration::from_secs(10))
                .map_err(|e| format!("Chunk {i}/{chunks}: {e}"))?;

            if payload.is_empty() {
                return Err(format!("Chunk {i}: empty response"));
            }

            if payload[0] == PAYLOAD_BINARY {
                data.extend_from_slice(&payload[1..]);
            } else if payload[0] == PAYLOAD_JSON {
                let s = std::str::from_utf8(&payload[1..]).unwrap_or("?");
                let r: serde_json::Value = serde_json::from_str(s).unwrap_or_default();
                let msg = r.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                return Err(format!("Chunk {i}: {msg}"));
            } else {
                return Err(format!("Chunk {i}: unexpected type 0x{:02X}", payload[0]));
            }

            /* Emit progress event for UI */
            let _ = app.emit("download-progress", serde_json::json!({
                "chunk": i + 1, "total": chunks, "name": name,
            }));
        }

        Ok(base64::engine::general_purpose::STANDARD.encode(&data))
    })();

    conn.port = Some(port);
    result
}

// ── Log Download (chunked binary over serial) ──────────────────────────

#[tauri::command]
async fn serial_download_log(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<u8>, String> {
    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
    let mut port = conn.port.take().ok_or("Not connected")?;

    let result = (|| -> Result<Vec<u8>, String> {
        /* Step 1: log.download.start — get metadata */
        conn.request_id += 1;
        let req_id = conn.request_id;
        let resp = serial_rpc_locked(
            &mut port, &mut conn.log_partial, &app, req_id, "log.download.start",
            serde_json::json!({"name": name}),
            Duration::from_secs(5),
        )?;

        if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
            return Err(format!("Device error: {err}"));
        }
        let result_obj = resp.get("result").ok_or("Missing result")?;
        let size = result_obj.get("size").and_then(|v| v.as_u64())
            .ok_or("Missing size")? as usize;
        let chunks = result_obj.get("chunks").and_then(|v| v.as_u64())
            .ok_or("Missing chunks")? as usize;

        /* Step 2: download chunks — binary frames */
        let mut data = Vec::with_capacity(size);

        for i in 0..chunks {
            conn.request_id += 1;
            let req_id = conn.request_id;
            let request = serde_json::json!({
                "id": req_id,
                "method": "log.download.chunk",
                "params": {"name": name, "index": i},
            });
            let json_str = serde_json::to_string(&request)
                .map_err(|e| format!("JSON error: {e}"))?;
            let frame = build_json_frame(&json_str);
            port.write_all(&frame).map_err(|e| format!("Write error: {e}"))?;
            port.flush().map_err(|e| format!("Flush error: {e}"))?;

            let payload = read_frame(&mut port, &mut conn.log_partial, &app, Duration::from_secs(10))
                .map_err(|e| format!("Log chunk {i}/{chunks}: {e}"))?;

            if payload.is_empty() {
                return Err(format!("Log chunk {i}: empty response"));
            }

            if payload[0] == PAYLOAD_BINARY {
                data.extend_from_slice(&payload[1..]);
            } else if payload[0] == PAYLOAD_JSON {
                let s = std::str::from_utf8(&payload[1..]).unwrap_or("?");
                let r: serde_json::Value = serde_json::from_str(s).unwrap_or_default();
                let msg = r.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                return Err(format!("Log chunk {i}: {msg}"));
            } else {
                return Err(format!("Log chunk {i}: unexpected type 0x{:02X}", payload[0]));
            }

            let _ = app.emit("download-progress", serde_json::json!({
                "chunk": i + 1, "total": chunks, "name": name,
            }));
        }

        Ok(data)
    })();

    conn.port = Some(port);
    result
}

// ── HTTP Proxy (bypasses WebView CORS) ──────────────────────────────

#[derive(Debug, Deserialize)]
struct HttpFetchRequest {
    url: String,
    method: Option<String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct HttpFetchResponse {
    status: u16,
    body: String,
}

/// Shared HTTP client — bypasses system proxy so requests to local
/// devices (ESP32 hotspot at 192.168.4.1 etc.) always use direct routing.
/// FOLLOWS redirects — used for GitHub/OTA downloads which 3xx to a CDN.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

/// HTTP client for device-facing calls (the /api/* transport). Does NOT
/// follow redirects: a real RDM-7 never 3xx-redirects its API, but a
/// captive portal or router sharing the target IP (e.g. the hotspot's
/// 192.168.4.1 colliding with a home router's gateway) answers a 303 to a
/// block page. Following that turned a "no device" into a bogus 200 with a
/// foreign HTML body, which the frontend mistook for a live device. With
/// redirects off, that 303 surfaces as a non-2xx status and is rejected.
fn device_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

#[tauri::command]
async fn http_fetch(req: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    let client = device_http_client()?;
    let method = req.method.as_deref().unwrap_or("GET");
    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(10000));

    let mut builder = match method.to_uppercase().as_str() {
        "POST" => client.post(&req.url),
        "PUT" => client.put(&req.url),
        "DELETE" => client.delete(&req.url),
        _ => client.get(&req.url),
    };

    builder = builder.timeout(timeout);

    if let Some(body) = req.body {
        builder = builder
            .header("Content-Type", "application/json")
            .body(body);
    }

    let resp = builder.send().await.map_err(|e| format!("HTTP request failed: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;

    Ok(HttpFetchResponse { status, body })
}

#[tauri::command]
async fn http_fetch_binary(url: String, timeout_ms: Option<u64>) -> Result<Vec<u8>, String> {
    let client = device_http_client()?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(15000));

    let resp = client
        .get(&url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read response: {e}"))
}

#[tauri::command]
async fn http_upload_binary(url: String, data: Vec<u8>, timeout_ms: Option<u64>) -> Result<String, String> {
    let client = device_http_client()?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30000));

    let resp = client
        .post(&url)
        .header("Content-Type", "application/octet-stream")
        .body(data)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("HTTP upload failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    resp.text().await.map_err(|e| format!("Failed to read response: {e}"))
}

// ── Firmware Update Check (GitHub API) ──────────────────────────────

#[derive(serde::Serialize)]
struct FirmwareUpdateInfo {
    available: bool,
    latest_version: String,
    current_version: String,
    download_url: String,
    file_size: u64,
    release_notes: String,
}

#[tauri::command]
async fn check_firmware_update(repo: String, current_version: String) -> Result<FirmwareUpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = http_client()?;

    let resp = client
        .get(&url)
        .header("User-Agent", "RDM7-Desktop")
        .header("Accept", "application/vnd.github.v3+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status().as_u16()));
    }

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Failed to parse GitHub response: {e}"))?;

    let tag = body["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
    let notes = body["body"].as_str().unwrap_or("");

    // Find the .bin asset
    let mut download_url = String::new();
    let mut file_size: u64 = 0;
    if let Some(assets) = body["assets"].as_array() {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.ends_with(".bin") {
                download_url = asset["browser_download_url"].as_str().unwrap_or("").to_string();
                file_size = asset["size"].as_u64().unwrap_or(0);
                break;
            }
        }
    }

    // Compare versions using semver
    let latest = semver::Version::parse(tag).unwrap_or(semver::Version::new(0, 0, 0));
    let current_clean = current_version.trim_start_matches('v')
        .split('-').next().unwrap_or("0.0.0");
    let current = semver::Version::parse(current_clean).unwrap_or(semver::Version::new(0, 0, 0));

    Ok(FirmwareUpdateInfo {
        available: latest > current && !download_url.is_empty(),
        latest_version: tag.to_string(),
        current_version: current_version,
        download_url,
        file_size,
        release_notes: notes.to_string(),
    })
}

#[tauri::command]
async fn download_firmware_binary(url: String) -> Result<Vec<u8>, String> {
    let client = http_client()?;

    let resp = client
        .get(&url)
        .header("User-Agent", "RDM7-Desktop")
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Firmware download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status().as_u16()));
    }

    resp.bytes().await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read firmware: {e}"))
}

#[tauri::command]
async fn check_desktop_update(repo: String, current_version: String) -> Result<FirmwareUpdateInfo, String> {
    // Reuse same GitHub API check for desktop releases
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = http_client()?;

    let resp = client
        .get(&url)
        .header("User-Agent", "RDM7-Desktop")
        .header("Accept", "application/vnd.github.v3+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status().as_u16()));
    }

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Failed to parse GitHub response: {e}"))?;

    let tag = body["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
    let notes = body["body"].as_str().unwrap_or("");

    // Find installer asset (.msi or .exe)
    let mut download_url = String::new();
    let mut file_size: u64 = 0;
    if let Some(assets) = body["assets"].as_array() {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.ends_with(".msi") || name.ends_with(".exe") {
                download_url = asset["browser_download_url"].as_str().unwrap_or("").to_string();
                file_size = asset["size"].as_u64().unwrap_or(0);
                break;
            }
        }
    }

    let latest = semver::Version::parse(tag).unwrap_or(semver::Version::new(0, 0, 0));
    let current_clean = current_version.trim_start_matches('v')
        .split('-').next().unwrap_or("0.0.0");
    let current = semver::Version::parse(current_clean).unwrap_or(semver::Version::new(0, 0, 0));

    Ok(FirmwareUpdateInfo {
        available: latest > current && !download_url.is_empty(),
        latest_version: tag.to_string(),
        current_version,
        download_url,
        file_size,
        release_notes: notes.to_string(),
    })
}

// ── Self-update (#22) ───────────────────────────────────────────────
// Uses tauri-plugin-updater to silently download + install a signed update
// in-place, then restart the app. Requires an endpoint configured in
// tauri.conf.json (updater.endpoints) and a signing pubkey (updater.pubkey).
//
// Progress events are emitted on the 'self-update-progress' channel so the
// frontend can show a progress bar. Emitted payloads:
//   { phase: 'checking' | 'downloading' | 'installing' | 'done' | 'error',
//     downloaded?: u64, total?: u64, error?: string }

#[derive(Debug, Serialize, Clone)]
pub struct UpdateProgress {
    pub phase: String,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
    pub error: Option<String>,
}

#[tauri::command]
async fn self_update_check(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let _ = app.emit("self-update-progress", UpdateProgress {
        phase: "checking".into(), downloaded: None, total: None, error: None,
    });
    match app.updater() {
        Ok(updater) => {
            match updater.check().await {
                Ok(Some(update)) => Ok(Some(update.version.to_string())),
                Ok(None) => Ok(None),
                Err(e) => Err(format!("updater check failed: {e}")),
            }
        }
        Err(e) => Err(format!("updater not available: {e}")),
    }
}

#[tauri::command]
async fn self_update_install(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("updater unavailable: {e}"))?;
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return Err("no update available".into()),
        Err(e) => return Err(format!("check failed: {e}")),
    };

    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk_len, content_length| {
                let _ = app_handle.emit("self-update-progress", UpdateProgress {
                    phase: "downloading".into(),
                    downloaded: Some(chunk_len as u64),
                    total: content_length,
                    error: None,
                });
            },
            move || {
                // finish callback — installation starting
            },
        )
        .await
        .map_err(|e| format!("download/install failed: {e}"))?;

    let _ = app.emit("self-update-progress", UpdateProgress {
        phase: "installing".into(), downloaded: None, total: None, error: None,
    });

    // Restart — this replaces the running binary with the new one.
    app.restart();
}

// ── Layout Backup/Restore (#25) ─────────────────────────────────────
// Pulls all layouts off the connected dash into a zip, and pushes them back.
// Uses the existing serial protocol (layout.list / layout.load / layout.save) on
// the frontend side; this backend only handles zip packaging since doing that
// in the browser costs ~200KB of JS.

#[tauri::command]
fn zip_layouts(entries: Vec<LayoutEntry>) -> Result<Vec<u8>, String> {
    use std::io::Write;
    // Lazy dep — use zip crate. If not available, fall back to a simple concatenation
    // format. Rather than forcing another dep, we produce a minimal TAR-like bundle.
    //
    // Each entry: name_len(u16 LE) + name bytes (UTF-8) + data_len(u32 LE) + data bytes.
    // Magic header: "RDMBACKUP" + version(u8=1) + entry_count(u32 LE).
    let mut out = Vec::<u8>::new();
    out.extend_from_slice(b"RDMBACKUP");
    out.push(1u8);
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for e in entries.iter() {
        let name_bytes = e.name.as_bytes();
        if name_bytes.len() > u16::MAX as usize {
            return Err(format!("layout name too long: {}", e.name));
        }
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&e.data);
    }
    // Prefix the whole thing with a 32-bit length for safety (optional, helps tools).
    let mut framed = Vec::with_capacity(out.len() + 4);
    framed.extend_from_slice(&(out.len() as u32).to_le_bytes());
    framed.write_all(&out).map_err(|e| format!("write: {e}"))?;
    Ok(framed)
}

#[tauri::command]
fn unzip_layouts(data: Vec<u8>) -> Result<Vec<LayoutEntry>, String> {
    if data.len() < 4 + 9 + 1 + 4 {
        return Err("backup file too small".into());
    }
    let payload_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if payload_len + 4 > data.len() {
        return Err("backup payload length invalid".into());
    }
    let body = &data[4..4 + payload_len];
    if &body[0..9] != b"RDMBACKUP" {
        return Err("not an RDM backup file".into());
    }
    if body[9] != 1 {
        return Err(format!("unsupported backup version: {}", body[9]));
    }
    let mut off = 14usize;
    let entry_count = u32::from_le_bytes([body[10], body[11], body[12], body[13]]) as usize;
    let mut entries = Vec::with_capacity(entry_count);
    for _ in 0..entry_count {
        if off + 2 > body.len() { return Err("truncated entry".into()); }
        let name_len = u16::from_le_bytes([body[off], body[off + 1]]) as usize;
        off += 2;
        if off + name_len > body.len() { return Err("truncated entry name".into()); }
        let name = std::str::from_utf8(&body[off..off + name_len])
            .map_err(|e| format!("invalid utf8: {e}"))?.to_string();
        off += name_len;
        if off + 4 > body.len() { return Err("truncated entry data length".into()); }
        let data_len = u32::from_le_bytes([body[off], body[off + 1], body[off + 2], body[off + 3]]) as usize;
        off += 4;
        if off + data_len > body.len() { return Err("truncated entry data".into()); }
        let mut data_vec = Vec::with_capacity(data_len);
        data_vec.extend_from_slice(&body[off..off + data_len]);
        off += data_len;
        entries.push(LayoutEntry { name, data: data_vec });
    }
    Ok(entries)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LayoutEntry {
    pub name: String,
    pub data: Vec<u8>,
}

// ── App Entry Point ─────────────────────────────────────────────────

/// Build and install the native menu bar. Custom items emit `menu-action`
/// (handled in run()'s on_menu_event); the frontend maps each id to an editor
/// function. Gives the app real desktop-program chrome instead of a bare
/// webview.
fn build_app_menu(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};

    let file = SubmenuBuilder::new(app, "File")
        .text("new_layout", "New Layout")
        .text("open_rdm", "Open .rdm Bundle…")
        .separator()
        .text("save", "Save / Apply")
        .text("save_as", "Save As…")
        .separator()
        .text("export_json", "Export Layout JSON…")
        .text("export_rdm", "Export .rdm Bundle…")
        .separator()
        .text("backup_all", "Backup All Device Layouts…")
        .text("restore_all", "Restore Layouts from Backup…")
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Exit"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .text("undo", "Undo")
        .text("redo", "Redo")
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .text("fit", "Fit to Screen")
        .text("reset_view", "Reset View")
        .separator()
        .text("toggle_sim", "Toggle Simulator")
        .text("toggle_live", "Toggle Live View")
        .build()?;

    let device = SubmenuBuilder::new(app, "Device")
        .text("connect_wifi", "Connect over WiFi…")
        .text("scan", "Scan for Devices")
        .separator()
        .text("device_manager", "Device Manager…")
        .text("go_local", "Go Offline (Local)")
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .text("shortcuts", "Keyboard Shortcuts")
        .text("check_update", "Check for Updates…")
        .separator()
        .text("about", "About RDM-7 Visual Designer")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &device, &help])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn run() {
    // Collect any file paths passed on the command line (Windows/Linux file
    // associations open the app with the file path as argv[1]). On macOS the
    // 'Opened' event is delivered to the NSApplication; Tauri's `on_opened_url`
    // handles that.
    let cli_files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".rdm"))
        .collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            // Emit the initial file-open event (if any) after a short delay so
            // the frontend JS has a chance to register its listener.
            if !cli_files.is_empty() {
                let app_handle = app.handle().clone();
                let files = cli_files.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    let _ = app_handle.emit("file-opened", serde_json::json!({ "paths": files }));
                });
            }

            // ── Native application menu ──────────────────────────────────
            // Every custom item emits a `menu-action` event carrying its id;
            // the frontend routes it to the matching editor function. Native
            // predefined items (cut/copy/paste/quit) keep OS-standard behavior.
            build_app_menu(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.emit("menu-action", id);
            }
        })
        .on_window_event(|window, event| {
            // Windows drag-and-drop: if a user drops a .rdm on the running app,
            // forward the paths to the frontend.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let rdm_paths: Vec<String> = paths.iter()
                    .filter_map(|p| p.to_str().map(|s| s.to_string()))
                    .filter(|s| s.to_lowercase().ends_with(".rdm"))
                    .collect();
                if !rdm_paths.is_empty() {
                    let _ = window.emit("file-opened", serde_json::json!({ "paths": rdm_paths }));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            probe_device,
            read_binary_file,
            write_binary_file,
            serial_list_ports,
            serial_auto_detect,
            serial_connect,
            serial_disconnect,
            serial_is_connected,
            serial_get_port,
            serial_request,
            serial_upload_chunked,
            serial_download_base64,
            serial_download_log,
            http_fetch,
            http_fetch_binary,
            http_upload_binary,
            check_firmware_update,
            download_firmware_binary,
            check_desktop_update,
            self_update_check,
            self_update_install,
            zip_layouts,
            unzip_layouts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
