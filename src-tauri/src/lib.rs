use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

// ── Device Discovery (mDNS) ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub ip: String,
    pub port: u16,
    pub hostname: String,
    pub serial: String,
    pub version: String,
    pub schema: String,
}

#[tauri::command]
async fn discover_devices() -> Result<Vec<DiscoveredDevice>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let mdns = ServiceDaemon::new().map_err(|e| format!("mDNS init failed: {e}"))?;
    let receiver = mdns
        .browse("_rdm7._tcp.local.")
        .map_err(|e| format!("mDNS browse failed: {e}"))?;

    let mut devices = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }

        match tokio::time::timeout(remaining, tokio::task::spawn_blocking({
            let rx = receiver.clone();
            move || rx.recv_timeout(Duration::from_millis(500))
        }))
        .await
        {
            Ok(Ok(Ok(ServiceEvent::ServiceResolved(info)))) => {
                let ip = info
                    .get_addresses()
                    .iter()
                    .find(|a| a.is_ipv4())
                    .map(|a| a.to_string())
                    .unwrap_or_default();

                if ip.is_empty() {
                    continue;
                }

                let props = info.get_properties();
                let serial = props
                    .get("serial")
                    .map(|v| v.val_str().to_string())
                    .unwrap_or_default();
                let version = props
                    .get("version")
                    .map(|v| v.val_str().to_string())
                    .unwrap_or_default();
                let schema = props
                    .get("schema")
                    .map(|v| v.val_str().to_string())
                    .unwrap_or_default();

                devices.push(DiscoveredDevice {
                    ip,
                    port: info.get_port(),
                    hostname: info.get_hostname().to_string(),
                    serial,
                    version,
                    schema,
                });
            }
            Ok(Ok(Ok(_))) => {} // other events
            Ok(Ok(Err(_))) => break,  // channel closed or timeout
            Ok(Err(_)) => break,      // task panicked
            Err(_) => break,          // overall timeout
        }
    }

    let _ = mdns.shutdown();
    Ok(devices)
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
/// Skips non-STX bytes (ESP_LOG output). Times out after `timeout`.
fn read_frame(port: &mut Box<dyn serialport::SerialPort>, timeout: Duration) -> Result<Vec<u8>, String> {
    let start = std::time::Instant::now();
    let mut byte_buf = [0u8; 1];

    // Wait for STX
    loop {
        if start.elapsed() > timeout {
            return Err("Timeout waiting for STX".into());
        }
        match port.read(&mut byte_buf) {
            Ok(1) if byte_buf[0] == STX => break,
            Ok(0) => return Err("Port closed (EOF)".into()),
            Ok(_) => continue, // skip non-STX (log output)
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
}

impl SerialConnection {
    fn new() -> Self {
        Self {
            port: None,
            port_name: String::new(),
            request_id: 0,
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

        match read_frame(&mut port, Duration::from_millis(2000)) {
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
async fn serial_connect(port_name: String) -> Result<String, String> {
    // Close any existing port first so the OS releases the handle
    {
        let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;
        if conn.port.is_some() {
            drop(conn.port.take());
            conn.port_name.clear();
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

    Ok(format!("Connected to {port_name}"))
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
async fn serial_request(method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut conn = SERIAL.lock().map_err(|e| format!("Lock error: {e}"))?;

    let id = {
        conn.request_id += 1;
        conn.request_id
    };

    let port = conn.port.as_mut().ok_or("Not connected")?;

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

    // Read response while holding the lock
    let payload = read_frame(port, timeout)?;
    let response = parse_json_response(&payload)?;
    Ok(response)
}

/// Helper: send a JSON-RPC request and read response (requires lock already held)
fn serial_rpc_locked(
    port: &mut Box<dyn serialport::SerialPort>,
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
    let payload = read_frame(port, timeout)?;
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

    let result = (|| -> Result<serde_json::Value, String> {
        // Step 1: Send upload.start request
        let start_resp = serial_rpc_locked(&mut port, start_id, "upload.start", serde_json::json!({
            "type": upload_type,
            "name": name,
            "size": total_size,
        }), Duration::from_secs(5));

        // If "Upload already in progress", abort the stale session and retry
        let start_resp = match &start_resp {
            Err(e) if e.contains("Upload already in progress") => {
                let _ = serial_rpc_locked(&mut port, abort_id, "upload.abort",
                    serde_json::json!({}), Duration::from_secs(2));
                serial_rpc_locked(&mut port, start_id, "upload.start", serde_json::json!({
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

            // Wait for ACK
            let payload = read_frame(&mut port, Duration::from_secs(5))?;
            let ack = parse_json_response(&payload)?;

            let ack_result = ack.get("result").ok_or("Missing ACK result")?;
            let ok = ack_result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            if !ok {
                let _ = serial_rpc_locked(&mut port, abort_id, "upload.abort",
                    serde_json::json!({}), Duration::from_secs(2));
                return Err(format!("Chunk {} rejected by device", chunk_idx));
            }
        }

        // Step 3: Send upload.finish (large files need time for flash write)
        serial_rpc_locked(&mut port, finish_id, "upload.finish",
            serde_json::json!({}), Duration::from_secs(30))
    })();

    // On failure, try to abort the upload so the device doesn't stay stuck
    if result.is_err() {
        let _ = serial_rpc_locked(&mut port, abort_id, "upload.abort",
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
        let resp = serial_rpc_locked(
            &mut port, conn.request_id, "download.start",
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
            let request = serde_json::json!({
                "id": conn.request_id,
                "method": "download.chunk",
                "params": {"type": download_type, "name": name, "index": i},
            });
            let json_str = serde_json::to_string(&request)
                .map_err(|e| format!("JSON error: {e}"))?;
            let frame = build_json_frame(&json_str);
            port.write_all(&frame).map_err(|e| format!("Write error: {e}"))?;
            port.flush().map_err(|e| format!("Flush error: {e}"))?;

            let payload = read_frame(&mut port, Duration::from_secs(10))
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
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

#[tauri::command]
async fn http_fetch(req: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    let client = http_client()?;
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
    let client = http_client()?;
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
    let client = http_client()?;
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

// ── App Entry Point ─────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            discover_devices,
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
            http_fetch,
            http_fetch_binary,
            http_upload_binary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
