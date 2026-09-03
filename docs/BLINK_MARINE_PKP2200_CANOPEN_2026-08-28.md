# Blink Marine PKP2200SI CANopen/J1939 — bench log, 2026-08-28

Unit: connected to the dash's CAN bus (10.89.161.237 / dash serial changes
across reboots — see gotcha at the bottom). Sources: `PKP2200SI_CANopen_UM_
REV1.4` and `PKP2200SI_J1939_UM_REV1.4` (both from blinkmarine.com), plus
`PKP2600SI_CANopen_UM_REV1.6` used for cross-checking.

## End state: DONE

**The keypad is on J1939, 500 kbit/s, source address 0x21.**

That is not where this log first ended, and the difference matters. The bench
work below finished with the keypad on **CANopen @ 500k, node 0x15** — correct,
verified, and *wrong for the actual goal*, which only came out afterwards:
MaxxECU is what will drive this keypad day to day, and MaxxECU's keypad
integration speaks J1939 only. So it was switched over, which reset it to
J1939's own factory 250k (see §5 — the same trap, a second time), and then
raised to 500k with the J1939 baud command `6Fh`.

Verified live at each stage:

| Stage | Evidence |
|---|---|
| CANopen @ 500k | `4F 10 20 00 02 00 00 00` (baud=500k), `4F 13 20 00 15 00 00 00` (node 0x15), bus `bus_errors: 0` |
| CANopen, visibly alive | backlight forced solid red @ 100% (NMT start `01 15` to id 0, then `3F 01 00 00 00 00 00 00` to `0x515`) |
| J1939 @ 250k | live keypress broadcast captured on `18EFFF21h` |
| J1939 @ 500k | second live keypress captured, source `0x21`, 140 ms old, with the dash and MaxxECU both at 500k |

MaxxECU's CAN Analyzer sees the key presses, which was the acceptance test.

**This is now a Studio feature, not a bench procedure** — see "What shipped"
at the bottom. The rest of this document is the log of finding all this out
the hard way, kept because the wizard's design is a direct response to it.

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
| 2003h | 04 | Default backlight colour (`01`-`09`, the same index as the PDO) |
| 2003h | 05 | Default LED brightness — **one** level for every ring, 00-3Fh |
| 2003h | 06 | Default backlight brightness, 00-3Fh |
| 1000h/1008h/1009h/100Ah | — | Standard identity objects (device type, manufacturer, HW/FW rev) |

PDO (needs NMT start first): backlight = `500h + node_id`, byte0=brightness
(00-3Fh), byte1=color (`01`=red `02`=green `03`=blue ... `08`=amber). LED-on
= `200h + node_id`, LED-blink = `300h + node_id`, same red/green/blue bitmask
byte layout.

Those two LED PDOs are what Studio's **Lightshow** section streams to animate
the keypad — see `docs/KEYPAD_LIGHTSHOW_2026-09.md` and ADR-0058. Worth knowing
here: a ring is three BITS, so seven colours and dark, with no per-key dimmer;
and above eight keys each colour channel is two bytes wide, keys 9-16 in the
high byte. The manual's LED-brightness object at `400h + node_id` is
deliberately unused — unverified on this bench, and `0x400-0x43F` is the range
reserved for RDM GPS nodes.

Those three `2003h` sub-objects are the whole of the keypad's own lighting, and
Studio's Lighting panel is exactly them: **Button brightness** (05), **Legend
backlight** colour (04) and **Legend brightness** (06). There is deliberately no
fourth control, because there is no fourth object — in particular the part has
no night brightness, so the "night" value Studio used to offer was never sent
anywhere (ADR-0063). Day/night dimming, if it is ever wanted, is the dash
re-sending the `500h` PDO, not a value the keypad stores.

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

## The dash as a CAN gateway (shipped 2026-09-02)

The bench work needed a way to put a raw frame on the wire, and got one as a
temporary hook in `web_server_test.c`. That file's own contract is "read-mostly
or inject-only; none change persisted config", which a raw transmitter is not,
so the write side now lives in **`RDM-7_Dash/main/net/web_server_can.c`** as a
permanent, guarded API:

| Endpoint | Does |
|---|---|
| `POST /api/can/send` | transmit one frame on the physical bus |
| `POST /api/can/monitor/reset` | wipe the per-ID tracker |
| `POST /api/can/promiscuous` | `{enable}` — accept every ID regardless of the loaded layout |

```
POST http://<dash-ip>/api/can/send
{ "id": 1557, "extd": false, "data": "2F10200002000000", "dlc": 8 }
```
`id`/`dlc` decimal, `data` hex (spaces ignored) or a byte array. `extd: true`
for 29-bit J1939 IDs. Response `{"ok":…, "id":…, "dlc":…}`, or `ok:false` with
`error` and a plain-English `detail`.

It refuses, with a reason the UI shows verbatim:

- the **RDM device-bus block** (`rdm_bus_get_base()` + 16) and the discovery ID
  `0x4FF` — a stray frame there is not noise, it is a valid message to the
  dash's own protocol handler, which will act on it;
- **OBD2 request IDs** `0x7DF` / `0x7E0-0x7E7` — if the dash is polling a car,
  an extra request interleaves with its own transaction and corrupts both;
- more than **24 frames a second**, because a caller that has lost its wait
  loop is putting sustained traffic on a bus a car is running on.

`POST /api/can/config` also changed: it now actually **applies** the bitrate
(`can_change_bitrate()`) instead of only writing it to NVS, and takes
`"persist": false` for a caller that is walking rates and will put the dash
back. `GET` reports `bitrate` (saved) and `live` separately, because during a
probe they legitimately differ. See the gotcha below — this was the single most
expensive false lead in the whole exercise.

## Gotchas hit along the way (worth knowing before touching this again)

- ~~`POST /api/can/config` only writes the bitrate to NVS~~ — **fixed
  2026-09-02**; it now calls `can_change_bitrate()`. Left here because of how
  much this cost: the endpoint answered `{"status":"ok"}` while changing
  nothing, so every probe at a "new" rate was really another probe at the old
  one, and the keypad's silence looked like a dead keypad rather than a dash
  that had not moved. If a bitrate change ever appears not to take, check
  whether `live` in the GET response actually followed `bitrate`.
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

## What shipped — "Set it up for me" (2026-09-02)

The five points this section used to list as future work are built. ADR-0055
records the reasoning; this is what exists.

**Where**: the keypad workspace's Connection panel, and the ECU guide's MaxxECU
tab. Code is `kpw*` in `src/tauri-overlay.html`, one contiguous block.

**What it does**, in the order it does it:

1. **Borrows the dash** — reads its current bitrate, turns promiscuous mode on
   so the loaded dashboard's acceptance filter cannot decide which IDs are
   audible, and promises to give both back. Every flow takes and restores
   independently; Find hands the dash back when it finishes, so Apply cannot
   inherit a saved rate from it.
2. **Hunts.** Each bit rate in turn — the dash's current one first, then 125k
   (CANopen's factory rate), 250k (J1939's), 500k, 1M — clearing the tracker
   between each. At each rate it reads object `2013h` at the node IDs that can
   plausibly be right (factory `0x15`, plus whatever Studio last configured),
   then confirms identity by reading `1009h`, which comes back as four ASCII
   characters. An SDO **abort** counts as found: it proves a live,
   protocol-correct server, which silence never does.
3. **J1939 is a second, opt-in phase**, because J1939 has no read side at all —
   nothing in the manual asks a J1939 keypad anything. It speaks when a key is
   pressed, so the wizard asks the user to hold one and listens for
   `18EFFF<sa>h` carrying the `04 1B` command prefix.
4. **Shows a diff** — what each setting is now, what it will become, and why —
   before writing anything.
5. **Writes**, strictly one request at a time, waiting for each reply and then
   waiting longer. Settings first, then the address, then the bit rate last,
   so a failure part-way leaves the keypad somewhere still reachable.
6. **Looks, rather than assumes**, after each move: the manual says a new
   address and bit rate apply after a power-cycle and this unit applied them
   immediately, so the wizard checks the new place *and* the old one and
   believes whoever answers. If the change is pending it says "power-cycle the
   keypad" instead of claiming success.
7. **Gives the dash back** — original bitrate, promiscuous off — on success,
   on failure, and on cancel.

**A file is still produced** for anyone with a USB-CAN dongle and no dash, and
both paths now come out of the same `kpProvisionSteps()`, so they cannot drift
apart. That refactor fixed a real bug in the file: the bit-rate frame used to
be sent **first**, which works only if the keypad defers it to a power-cycle —
and this one does not, so every frame after it went out at the wrong speed.

**Tested** by `tools/check_keypad.js`: 69 assertions, running the shipped code
(extracted, never copied) against a simulated dash and keypad on a virtual
clock. The simulation is deliberately meaner than the real unit — it goes deaf
on overlapping requests, it is invisible unless the dash's rate matches, and it
resets itself to the destination protocol's factory rate when switched. Among
the things pinned: a stale tracker entry from a previous bit rate is not read
as an answer; the dash is restored after success, failure and cancel; no two
frames ever go out closer together than `KPW_SETTLE_MS`; and a keypad that
needs more quiet than the wizard allows is reported as unanswered rather than
written.

Three real bugs were found by that harness before this shipped, all of them in
the "looks like it works" family: Apply left the dash on whatever rate its last
probe used, Apply sent its first frame at the dash's normal rate instead of the
keypad's, and the J1939→CANopen round trip therefore never completed.
