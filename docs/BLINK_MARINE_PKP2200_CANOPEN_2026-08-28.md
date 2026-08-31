# Blink Marine PKP2200SI CANopen/J1939 — bench log, 2026-08-28

Unit: connected to the dash's CAN bus (10.89.161.237 / dash serial changes
across reboots — see gotcha at the bottom). Sources: `PKP2200SI_CANopen_UM_
REV1.4` and `PKP2200SI_J1939_UM_REV1.4` (both from blinkmarine.com), plus
`PKP2600SI_CANopen_UM_REV1.6` used for cross-checking.

## End state: DONE

- Protocol: **CANopen**
- Baud rate: **500 kbit/s** (matches the dash and the rest of the live ECU bus)
- Node ID: **0x15** (factory default, never changed)
- Verified live: `4F 10 20 00 02 00 00 00` (baud=500k) and
  `4F 13 20 00 15 00 00 00` (node ID=0x15), bus health afterward
  `bus_errors: 0, rx_errors: 0, tx_errors: 0`.
- Backlight set to solid red @ 100% as a visible end-to-end proof (NMT start
  `01 15` to id 0, then `3F 01 00 00 00 00 00 00` to id 0x515).

## The story, in order

### 1. Starting point: keypad silent, huge bus error count

Keypad was at CANopen factory defaults (125 kbit/s, node 0x15). The dash
defaults to 500 kbit/s. Two devices at different bit rates on one physical
bus don't just fail to talk to each other — every frame either one
transmits looks like line noise to the other, so it also degrades everything
else on the bus. This alone had generated ~4.9M `bus_errors` on the dash
over one uptime with the keypad connected and mismatched.

### 2. Built a way to actually send raw CAN frames

The dash's `/api/can/inject` only feeds a synthetic frame into the local
*decode* path — it never touches the physical wire, so it's useless for
provisioning an external device. Added `POST /api/can/send` to
`RDM-7_Dash/main/net/web_server_test.c`, which calls `can_transmit_frame_ext`
and puts a real frame on the bus. Built and OTA-flashed to the dash. See
"Debug tooling" below for the exact shape — **it's still on the dash**,
marked temporary in the file header.

### 3. Found the keypad, read its defaults, confirmed the SDO server is alive

Dropped the dash to 125 kbit/s (matching the keypad's factory rate — this
requires a real `POST /api/system/reboot`, **not** just `POST /api/can/config`,
which only writes the setting to NVS and doesn't re-arm the TWAI driver
live). Then, over SDO:

- Read baud (`40 10 20 00 00 00 00 00` → `615h`) → `4F 10 20 00 04 00 00 00`
  = 125 kbit/s, confirms factory default and that node ID 15h is right.
- Read a bogus object (`40 99 99 00 00 00 00 00`) → `80 99 99 00 00 00 02 06`
  = a correct SDO abort (object doesn't exist). Proves the SDO server is
  live and protocol-correct, not just echoing cached traffic.
- Read hardware rev (1009h) → ASCII `"V_03"`, matches the manual's own
  worked example exactly. Read manufacturer (1008h) → "BlinkMarine".
- Read node ID (2013h) → confirms `0x15`.

### 4. Writes appeared to be silently ignored — actually a request-overlap bug

Every SDO **write** (baud 2010h, boot-up service 2011h, startup LED show
2014h — three unrelated objects) got zero response, including a deliberate
30-request rapid-fire burst. Sending **one write and waiting a few seconds**
before the next got an immediate ack (`60 10 20 00 00 00 00 00`) on the
first try, every time.

**The keypad's SDO server can't handle overlapping requests.** It doesn't
queue or reject a second request while one is outstanding — it silently
drops everything until traffic settles down. No abort, no ack, nothing.
This also explains why reads only landed ~60-80% of the time during initial
testing: normal script/HTTP round-trip timing happened to space them out
enough most of the time, by luck, not by design.

**Rule for anything that talks SDO to this keypad**: send one request, wait
for the reply (or a generous multi-second timeout), before sending the next.
Never pipeline.

Applied the lesson: single spaced write of `2F 10 20 00 02 00 00 00`
(baud=500k) got acked immediately. Switched the dash to 500k, read the baud
back: `02h`. Bus went completely clean (0 errors). **Looked done.**

### 5. It broke again — MaxxECU switched it to J1939

Mid-session, the user's MaxxECU software has a "Keypad Protocol setup" panel
with a "Write to Keypad" button and a Protocol dropdown (CANopen/J1939).
Because MaxxECU's own keypad integration always runs J1939, that panel was
used with the dropdown on J1939 and "Write to Keypad" clicked — which sends
exactly the documented CANopen→J1939 switch command
(`2B FF 20 01 01` to `615h`, see "Set CAN protocol" in the CANopen manual).

The keypad went **completely silent on every CANopen address**, at every
bit rate tried (125k, 500k) — not a garbled reply, no trace of it on the
bus at all. This looked like a hardware fault (dead keypad, disconnected
wire) and cost real time chasing that theory (physical power-cycles of the
whole rig during this window — unrelated coincidence — didn't help either).

**The actual cause**: switching protocol also resets the device to *that
protocol's own* factory defaults, and J1939 mode's default bit rate is
**250 kbit/s**, per the J1939 manual's defaults table — completely different
from CANopen's 125k default. The keypad was never gone, it was just on a
third bit rate nobody had tried yet.

### 6. Recovery: found it on J1939 at 250k, switched back, redid the baud fix

- Dropped the dash to 250 kbit/s. Immediately caught a real, unsolicited
  J1939 key-event frame from the keypad: `18EFFF21h` (broadcast, source
  address `0x21`) data `04 1B 01 04 01 21 FF FF` = "Key 4 ON", byte-for-byte
  matching the J1939 manual's own worked example. Confirmed alive on 250k.
- Sent the documented J1939→CANopen switch command (no ack defined for this
  one in either manual — it's fire-and-hope):
  ```
  18EF2100h (extended) : 04 1B 80 00 FF FF FF FF
  ```
  (`0x18EF2100` = PGN 0xEF00 "Proprietary A", destination address `0x21` —
  the keypad's default/only J1939 source address per its own manual — source
  address `0x00`.)
- Dropped the dash to 125 kbit/s (CANopen's own factory default, since
  switching protocol resets to *that* protocol's defaults too) and got a
  live SDO reply: `4F 10 20 00 04 00 00 00` = back in CANopen, at 125k,
  node ID still `0x15`.
- Redid the exact single-spaced-write baud fix from step 4:
  `2F 10 20 00 02 00 00 00` → acked immediately → switched dash to 500k →
  read back `02h` → clean bus.
- Proved it end-to-end with a visible backlight change (see "End state").

## Manufacturer defaults

**CANopen mode:**

| Setting | Default | Object |
|---|---|---|
| Baud rate | **125 kbit/s** | 2010h |
| Node ID | **15h** (21 decimal) | 2013h |
| Device active on startup | Not active (needs NMT start before LED/PDO commands work — SDO works regardless) | 2012h |
| Boot-up service | Active | 2011h |
| Periodic key-state transmission | Disabled | 1800h |
| Heartbeat producer/consumer | Disabled | 1017h/1016h |

**J1939 mode:**

| Setting | Default | Command |
|---|---|---|
| Baud rate | **250 kbit/s** | 6Fh |
| Source address / keypad identifier | **21h** | 70h |
| Destination address (for its own key-state broadcasts) | FFh (broadcast) | 6Eh |
| Heartbeat | Disabled | 75h |
| Periodic key-state transmission | Disabled | 71h |
| Event state transmission | Enabled | 72h |

**The dash's own default bitrate is 500 kbit/s.** Any mismatch between
whatever protocol/bitrate the keypad is actually in and what the dash is
listening at looks identical from the outside: total silence, climbing
`bus_errors`. There is no CAN-side way to ask "what rate are you actually
on" — the only method that works is trying rates one at a time and reading
back a known object once one answers.

## Wire format reference

### CANopen (11-bit standard frames)

SDO traffic uses `600h + node_id` (dash→keypad) and `580h + node_id`
(keypad→dash) — with node ID 15h that's **0x615** and **0x595**.

Read (upload) any object:
```
615h: 40 <idx_lo> <idx_hi> <sub> 00 00 00 00
```
Reply: `4F`/`4B`/`47`/`43` (expedited, 1/2/3/4 bytes) or `41` (segmented) with
the value in bytes 4-7, or `80` (abort) with a 4-byte abort code.

Write (download) a 1-byte object — **send one at a time, wait for the
reply**:
```
615h: 2F <idx_lo> <idx_hi> <sub> <value> 00 00 00
```
Reply: `60` (ack) or `80` (abort).

NMT (always ID 0h): start node = `01 <node_id>` (or `01 00` for "all"),
reset = `81 <node_id>`, enter pre-op = `80 <node_id>`.

Objects relevant to a Studio keypad-setup panel:

| Object | Sub | Purpose |
|---|---|---|
| 2010h | 00 | Baud rate: `00`=1M `02`=500k `03`=250k `04`=125k(default) `06`=50k `07`=20k |
| 2013h | 00 | Node ID (01h-7Fh, default 15h) |
| 2011h | 00 | Boot-up message on power-up |
| 2012h | 00 | Device active without NMT start |
| 1000h/1008h/1009h/100Ah | — | Standard identity objects (device type, manufacturer, HW/FW rev) |

PDO (needs NMT start first): backlight = `500h + node_id`, byte0=brightness
(00-3Fh), byte1=color (`01`=red `02`=green `03`=blue ... `08`=amber). LED-on
= `200h + node_id`, LED-blink = `300h + node_id`, same red/green/blue bitmask
byte layout.

### J1939 (29-bit extended frames)

ID structure: priority(3) + reserved(1) + data-page(1) + PF(8) + PS(8) +
SA(8). PKP keypads use PF=`EFh` (PGN 0xEF00, "Proprietary A"), PS=destination
address, SA=source address. Commands **to** the keypad use
`18EF<dest><src>h` (default `18EF2100h` = dest 0x21, src 0x00); broadcasts
**from** the keypad use `18EFFF<src>h` (default `18EFFF21h`).

General command frame: `04 1B <cmd> <data...> FF` padding. Set CAN protocol
(no ack defined for either direction):
```
J1939 → CANopen:  18EF2100h (ext) : 04 1B 80 00 FF FF FF FF
CANopen → J1939:  615h (std)      : 2B FF 20 01 01
```
Baud rate (J1939 command 6Fh): `18EF2100h : 04 1B 6F <rate> FF FF FF FF`
(rate byte codes match the CANopen ones — `02`=500k).

## Debug tooling added for this (temporary)

`RDM-7_Dash/main/net/web_server_test.c` gained `POST /api/can/send` — unlike
`/api/can/inject` (decode-path only, never touches the wire), this calls
`can_transmit_frame_ext` and puts a real frame on the physical bus:

```
POST http://<dash-ip>/api/can/send
{ "id": 1557, "extd": false, "data": "2F10200002000000", "dlc": 8 }
```
`id`/`dlc` decimal, `data` hex (spaces ignored) or a byte array. Response:
`{"ok": true/false, "id":, "dlc":, "error"?: "<esp_err name>"}`. `extd: true`
for 29-bit J1939-style IDs.

Marked temporary in the file header — **still on the dash as of 2026-08-28**.
Decide whether to keep it for further hands-on work or pull it in the next
build.

## Gotchas hit along the way (worth knowing before touching this again)

- `POST /api/can/config` only writes the bitrate to NVS — it does **not**
  re-arm the TWAI driver. A bitrate change needs a real
  `POST /api/system/reboot` to take effect. (There's a live-apply function,
  `can_change_bitrate()`, used by the on-device UI and the OBD2 bus-scan
  path — the HTTP config endpoint just doesn't call it.)
- The dash's reported `serial` in `/api/device/info` is **not stable across
  reboots** on this unit (`RDM-E806-90A2` one boot, `RDM-90A2-19B4` the
  next) — don't key anything off it staying constant. Untriaged, unrelated
  to this investigation.
- The dash had multiple genuine power-on resets during this session
  (`prev_reason: 1`, `prev_was_crash: false` each time — not our commands,
  not a firmware crash) that briefly looked like they were caused by the
  CAN commands. They weren't; the panic counter never moved. Worth ruling
  out crash vs. real power blip via `/api/selftest`'s `crash` block before
  chasing a command as the cause.
- Switching CANopen↔J1939 resets the device to *the destination protocol's*
  factory defaults, including bit rate. If this keypad ever goes silent
  again after looking configured, protocol got flipped (check for any
  ECU/tool on the bus that manages it, e.g. MaxxECU's keypad setup panel)
  before assuming it's broken.

## For later: a Studio "Blink Marine keypad setup" feature

1. **A permanent, scoped raw-CAN-TX primitive** on the dash — today's
   `/api/can/send` is a fine starting shape but should reject IDs that
   collide with the RDM device-bus or dash's own transmit ranges before it's
   a permanent always-on API rather than a bench debug tool.
2. **A bitrate/protocol hunt**: try each rate (and both protocols) in turn,
   probing with a read after each. Much less disruptive to a shared bus if
   `POST /api/can/config` is changed to call `can_change_bitrate()` live
   instead of requiring a reboot per attempt.
3. **Serialize every SDO/J1939 request** — one at a time, wait for the reply
   or a generous multi-second timeout. This was the actual root cause of
   "writes silently fail" — a real UI must never fire a second request while
   one is outstanding.
4. **Detect and warn about protocol switches from other bus participants** —
   if another ECU on the bus can flip this keypad's protocol out from under
   a saved Studio config (as happened here), the panel should probably
   re-verify before trusting a cached "keypad is configured" state.
5. Reuse the object/command tables above directly as the panel's field list.
