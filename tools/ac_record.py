#!/usr/bin/env python3
"""
ac_record.py — record a stint in Assetto Corsa, open it in RDM Studio.

AC publishes its physics, graphics and static pages to Windows shared memory
(`Local\\acpmf_*`), which is how every AC dash app on the planet reads the car.
This walks the same three maps at 25 Hz — the GPS puck's own rate, so a sim
recording and a real one are the same shape of thing — and writes:

  * a .rdmsession, which Studio's Session view imports directly. From there
    the whole GPS workspace works on it: track map, lap deltas, sectors,
    corners, drift scoring, and export back out to VBO for Circuit Tools.
  * optionally a replay CSV for the dash itself (--csv), which the firmware
    plays back through the real signal system: Data Logging → Upload → Play.

THE ONE HARD PART is that a sim has no GPS. AC gives world coordinates in
metres on a track-local grid whose origin and north are arbitrary, and a
.rdmsession wants latitude and longitude. So the metres are pinned to the real
circuit: an anchor point (taken from Studio's own GP_PLACES table, never a
second copy of it) plus a rotation, projected through a local tangent plane.

Get the rotation right and the lap lies on the real circuit on the basemap,
Studio recognises the track by name, and the user's own gates and sectors time
it. Get it wrong and everything still works except the picture — lap times,
speeds and distances are all rotation-invariant.

    python tools/ac_record.py --check
    python tools/ac_record.py --out my_stint.rdmsession
    python tools/ac_record.py --out stint.rdmsession --csv stint.csv
    python tools/ac_record.py --selftest        (no AC needed — proves the writers)

Stop a recording with Ctrl-C; the file is written on the way out.

Stdlib only, deliberately: this repo has no package manager and adding one for
a dev tool would be a poor trade.
"""

import argparse
import base64
import ctypes
import json
import math
import os
import re
import struct
import sys
import time

# The console here is cp1252 by default, and this file talks in degrees and
# em-dashes. Without this every one of them comes out as a replacement char.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ── the format, as src/tauri-overlay.html defines it ──────────────────────
# These are not free parameters. They are the .rdmsession contract, and the
# app's own gpRowsPack/gpSessionFileParse are the spec:
#   lat/lon  Int32,  degrees × 1e7
#   kph      Uint16, km/h × 100
#   hdg      Uint16, degrees × 100
#   t        Uint32, milliseconds, 0xFFFFFFFF = "this recording predates time"
#   can      Uint16, raw counts; the scale lives in the channel def, and
#            0xFFFF is reserved for "this channel said nothing here"
GP_NO_T = 0xFFFFFFFF
GP_CHAN_STALE = 0xFFFF
GP_TRACE_HZ = 25
SESFILE_FMT = "rdm-session"

EARTH_R = 6371008.8
DEG = math.pi / 180

OVERLAY = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "src", "tauri-overlay.html")


# ══════════════════════════════════════════════════════════════════════════
#  Assetto Corsa shared memory
#
#  Field order IS the wire format — one field out of place and everything
#  after it is garbage. This is the documented layout for Assetto Corsa (the
#  original; Competizione's graphics page differs and is not handled here).
#  Native alignment, NOT _pack_ = 1: the C structs are naturally aligned, and
#  packing them tight would silently shift every field that follows a
#  wchar_t array of odd length.
# ══════════════════════════════════════════════════════════════════════════

class ACPhysics(ctypes.Structure):
    _fields_ = [
        ("packetId", ctypes.c_int),
        ("gas", ctypes.c_float),
        ("brake", ctypes.c_float),
        ("fuel", ctypes.c_float),
        ("gear", ctypes.c_int),
        ("rpms", ctypes.c_int),
        ("steerAngle", ctypes.c_float),
        ("speedKmh", ctypes.c_float),
        ("velocity", ctypes.c_float * 3),
        ("accG", ctypes.c_float * 3),
        ("wheelSlip", ctypes.c_float * 4),
        ("wheelLoad", ctypes.c_float * 4),
        ("wheelsPressure", ctypes.c_float * 4),
        ("wheelAngularSpeed", ctypes.c_float * 4),
        ("tyreWear", ctypes.c_float * 4),
        ("tyreDirtyLevel", ctypes.c_float * 4),
        ("tyreCoreTemperature", ctypes.c_float * 4),
        ("camberRAD", ctypes.c_float * 4),
        ("suspensionTravel", ctypes.c_float * 4),
        ("drs", ctypes.c_float),
        ("tc", ctypes.c_float),
        ("heading", ctypes.c_float),
        ("pitch", ctypes.c_float),
        ("roll", ctypes.c_float),
        ("cgHeight", ctypes.c_float),
        ("carDamage", ctypes.c_float * 5),
        ("numberOfTyresOut", ctypes.c_int),
        ("pitLimiterOn", ctypes.c_int),
        ("abs", ctypes.c_float),
    ]


class ACGraphics(ctypes.Structure):
    _fields_ = [
        ("packetId", ctypes.c_int),
        ("status", ctypes.c_int),           # 0 off, 1 replay, 2 live, 3 pause
        ("session", ctypes.c_int),
        ("currentTime", ctypes.c_wchar * 15),
        ("lastTime", ctypes.c_wchar * 15),
        ("bestTime", ctypes.c_wchar * 15),
        ("split", ctypes.c_wchar * 15),
        ("completedLaps", ctypes.c_int),
        ("position", ctypes.c_int),
        ("iCurrentTime", ctypes.c_int),
        ("iLastTime", ctypes.c_int),
        ("iBestTime", ctypes.c_int),
        ("sessionTimeLeft", ctypes.c_float),
        ("distanceTraveled", ctypes.c_float),
        ("isInPit", ctypes.c_int),
        ("currentSectorIndex", ctypes.c_int),
        ("lastSectorTime", ctypes.c_int),
        ("numberOfLaps", ctypes.c_int),
        ("tyreCompound", ctypes.c_wchar * 33),
        ("replayTimeMultiplier", ctypes.c_float),
        ("normalizedCarPosition", ctypes.c_float),
        ("carCoordinates", ctypes.c_float * 3),   # x, y(up), z — metres
        ("penaltyTime", ctypes.c_float),
        ("flag", ctypes.c_int),
        ("idealLineOn", ctypes.c_int),
        ("isInPitLane", ctypes.c_int),
        ("surfaceGrip", ctypes.c_float),
        ("mandatoryPitDone", ctypes.c_int),
    ]


class ACStatic(ctypes.Structure):
    _fields_ = [
        ("smVersion", ctypes.c_wchar * 15),
        ("acVersion", ctypes.c_wchar * 15),
        ("numberOfSessions", ctypes.c_int),
        ("numCars", ctypes.c_int),
        ("carModel", ctypes.c_wchar * 33),
        ("track", ctypes.c_wchar * 33),
        ("playerName", ctypes.c_wchar * 33),
        ("playerSurname", ctypes.c_wchar * 33),
        ("playerNick", ctypes.c_wchar * 33),
        ("sectorCount", ctypes.c_int),
    ]


AC_LIVE = 2


def _mapping_exists(tag):
    """Is anyone publishing this shared-memory page right now?

    This has to be asked separately, and it is the whole reason this function
    exists: `mmap.mmap(-1, n, tagname=...)` on Windows CREATES the mapping
    when it does not already exist, even opened read-only. So with the game
    shut the reader does not fail — it hands back a page of zeros, and zero is
    a perfectly ordinary reading for speed, throttle, rpm and position. The
    tool would then record a stationary car at the origin and write a file
    full of plausible nothing. OpenFileMapping refuses instead, which is the
    answer we actually want.
    """
    import ctypes.wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenFileMappingW.restype = ctypes.wintypes.HANDLE
    k32.OpenFileMappingW.argtypes = [ctypes.wintypes.DWORD,
                                     ctypes.wintypes.BOOL,
                                     ctypes.wintypes.LPCWSTR]
    FILE_MAP_READ = 0x0004
    h = k32.OpenFileMappingW(FILE_MAP_READ, False, "Local\\" + tag)
    if not h:
        return False
    k32.CloseHandle(h)
    return True


class ACReader:
    """The three maps, opened read-only. Raises if AC is not running."""

    def __init__(self):
        import mmap
        if sys.platform != "win32":
            raise RuntimeError("AC shared memory is a Windows thing")

        def m(tag, size):
            if not _mapping_exists(tag):
                raise RuntimeError(
                    "Assetto Corsa is not publishing %s.\n"
                    "Start the game and get into a session — the pages only "
                    "exist once a car is loaded." % tag)
            try:
                return mmap.mmap(-1, size, tagname="Local\\" + tag,
                                 access=mmap.ACCESS_READ)
            except OSError as e:
                raise RuntimeError("cannot open %s (%s)" % (tag, e))

        # Map generously: AC's pages grew over the years and are longer than
        # the fields declared above. Reading a prefix of a longer page is
        # fine; reading past the end is not, so ask for the real page size.
        self._p = m("acpmf_physics", 2048)
        self._g = m("acpmf_graphics", 4096)
        self._s = m("acpmf_static", 1024)

    def physics(self):
        return ACPhysics.from_buffer_copy(self._p[:ctypes.sizeof(ACPhysics)])

    def graphics(self):
        return ACGraphics.from_buffer_copy(self._g[:ctypes.sizeof(ACGraphics)])

    def static(self):
        return ACStatic.from_buffer_copy(self._s[:ctypes.sizeof(ACStatic)])

    def close(self):
        for h in (self._p, self._g, self._s):
            try:
                h.close()
            except Exception:
                pass


def layout_is_sane(p, g, s):
    """Cheap proof that the struct definitions line up with this AC build.

    Every one of these would be wild garbage if a field were misplaced, and
    all of them are true for any car sitting in any pit box. Worth doing:
    a misread struct produces a file full of plausible-looking numbers, and
    that is the failure that wastes an afternoon.
    """
    checks = [
        ("the game says who it is",
         bool(re.match(r"^[\d.]+$", (s.smVersion or "").strip() or "x"))),
        ("the page has been written",
         any([(s.track or "").strip(), (s.carModel or "").strip(),
              p.rpms, p.speedKmh, g.status])),
        ("speed is a speed", -5.0 <= p.speedKmh <= 500.0),
        ("rpm is an rpm", -100 <= p.rpms <= 25000),
        ("gear in range", -2 <= p.gear <= 10),
        ("throttle 0..1", -0.05 <= p.gas <= 1.05),
        ("brake 0..1", -0.05 <= p.brake <= 1.05),
        ("lap fraction 0..1", -0.01 <= g.normalizedCarPosition <= 1.01),
        ("heading in radians", -math.pi - 0.1 <= p.heading <= math.pi + 0.1),
        ("coords are metres", all(abs(c) < 50000 for c in g.carCoordinates)),
    ]
    return checks


# ══════════════════════════════════════════════════════════════════════════
#  Where on earth
# ══════════════════════════════════════════════════════════════════════════

def load_places():
    """Studio's own circuit table, parsed out of the app rather than copied.

    A copy would drift, and then this tool would anchor a lap at a circuit
    Studio has since moved — the same reasoning as tools/check_autotrack.js
    pulling the real functions instead of reimplementing them.
    """
    try:
        with open(OVERLAY, "r", encoding="utf-8") as f:
            src = f.read()
    except OSError:
        return []
    i = src.find("var GP_PLACES = [")
    if i < 0:
        return []
    out = []
    for m in re.finditer(
            r'\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*where:\s*"([^"]*)",'
            r'\s*center:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]',
            src[i:i + 40000]):
        out.append({"id": m.group(1), "name": m.group(2), "where": m.group(3),
                    "lat": float(m.group(4)), "lon": float(m.group(5))})
    return out


# AC folder names are not circuit names. These are the stock and Kunos-DLC
# tracks whose names do not fall out of a plain text match; everything else
# is matched by name below, so this table stays short on purpose.
AC_TRACK_ALIAS = {
    "ks_nordschleife": "nordschleife",
    "nordschleife": "nordschleife",
    "ks_nurburgring": "nurburgring_gp",
    "nurburgring": "nurburgring_gp",
    "ks_brands_hatch": "brands",
    "ks_red_bull_ring": "redbullring",
    "red_bull_ring": "redbullring",
    "ks_laguna_seca": "lagunaseca",
    "laguna_seca": "lagunaseca",
    "ks_barcelona": "catalunya",
    "barcelona": "catalunya",
    "ks_silverstone": "silverstone",
    "ks_zandvoort": "zandvoort",
    "ks_highlands": "highlands",
    "spa": "spa",
    "monza": "monza",
    "imola": "imola",
    "mugello": "mugello",
    "ks_monza66": "monza",
}


def match_place(ac_track, places):
    """Best guess at which real circuit an AC track folder is."""
    if not ac_track:
        return None
    key = re.sub(r"[^a-z0-9_]", "", str(ac_track).lower())
    want = AC_TRACK_ALIAS.get(key)
    if want:
        for p in places:
            if p["id"] == want:
                return p
    # Fall back to comparing letters only, so "ks_brands_hatch" finds
    # "Brands Hatch" and "monza" finds "Monza" without a table entry.
    flat = re.sub(r"[^a-z]", "", key.replace("ks_", ""))
    if len(flat) < 4:
        return None
    best = None
    for p in places:
        pn = re.sub(r"[^a-z]", "", p["name"].lower())
        if not pn:
            continue
        if flat in pn or pn in flat:
            # Prefer the shortest name that contains it: "Monza" over
            # nothing, but never "Nürburgring GP" for a plain "nurburgring"
            # when the alias table has already spoken.
            if best is None or len(pn) < len(best[0]):
                best = (pn, p)
    return best[1] if best else None


class Georef:
    """AC's track-local metres onto the real world.

    A local tangent plane is exact enough by a wide margin: over the ~5 km a
    circuit spans, the error against a proper geodesic projection is
    centimetres, and the recording it is being compared against is a 2.5 m
    GPS fix.
    """

    def __init__(self, lat0, lon0, rot_deg=0.0, mirror=False):
        self.lat0, self.lon0 = lat0, lon0
        self.rot = rot_deg * DEG
        self.mirror = mirror
        self.m_lat = DEG * EARTH_R
        self.m_lon = DEG * EARTH_R * math.cos(lat0 * DEG)
        self.x0 = self.z0 = None

    def origin_from(self, x, z):
        """Centre the projection on the track, not on sample zero — a lap
        that starts in the pit lane would otherwise hang the whole circuit
        off its own pit exit."""
        self.x0, self.z0 = x, z

    def to_latlon(self, x, z):
        dx = x - (self.x0 or 0.0)
        dz = z - (self.z0 or 0.0)
        # AC's world is left-handed (X right, Y up, Z forward), so seen from
        # above one axis has to turn over or the circuit comes out as its own
        # mirror image. --mirror flips it back if this reading is wrong for
        # a given track; --fit decides it from the evidence instead.
        north = dz if self.mirror else -dz
        east = dx
        c, s = math.cos(self.rot), math.sin(self.rot)
        e = east * c - north * s
        n = east * s + north * c
        return self.lat0 + n / self.m_lat, self.lon0 + e / self.m_lon


def fit_rotation(xz, outline, lat0, lon0, step=0.5):
    """Solve rotation (and the mirror bit) against a real track outline.

    Brute force over every half-degree, both mirror states, scoring by mean
    distance from each recorded point to the nearest outline point. The
    circuit only fits one way round, so the winner wins by a mile — which is
    also how we can tell a bad outline from a good one and say so.

    `outline` is a list of [lat, lon]; Studio exports one per saved track.
    """
    m_lat = DEG * EARTH_R
    m_lon = DEG * EARTH_R * math.cos(lat0 * DEG)
    # Outline into local metres about the same origin, once.
    ol = [((la - lat0) * m_lat, (lo - lon0) * m_lon) for la, lo in outline]
    if len(ol) < 8 or len(xz) < 8:
        return None

    # Thin the recording — a 25 Hz lap is thousands of points and the fit
    # does not get better for using all of them.
    pts = xz[:: max(1, len(xz) // 400)]
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    on = sum(p[0] for p in ol) / len(ol)
    oe = sum(p[1] for p in ol) / len(ol)

    best = None
    for mirror in (False, True):
        base = [(p[0] - cx, (p[1] - cz) if mirror else -(p[1] - cz)) for p in pts]
        k = 0
        while k < 360:
            th = k * DEG
            c, s = math.cos(th), math.sin(th)
            tot = 0.0
            for (e0, n0) in base:
                e = e0 * c - n0 * s
                n = e0 * s + n0 * c
                # nearest outline point, in (north, east) metres
                tn, te = n + on, e + oe
                d = min((tn - a) * (tn - a) + (te - b) * (te - b) for a, b in ol)
                tot += math.sqrt(d)
            mean = tot / len(base)
            if best is None or mean < best[0]:
                best = (mean, k, mirror)
            k += step
    return best  # (mean_error_m, rot_deg, mirror)


# ══════════════════════════════════════════════════════════════════════════
#  Channels
# ══════════════════════════════════════════════════════════════════════════

# What gets pulled out of the physics page, in the order the columns land.
# `get` takes (physics, graphics) and returns a float or None for "no
# reading here" — None is not zero, and the format has a way to say so.
CHANNELS = [
    ("Engine RPM",  "rpm", 0, lambda p, g: float(p.rpms)),
    ("Throttle",    "%",   1, lambda p, g: p.gas * 100.0),
    ("Brake",       "%",   1, lambda p, g: p.brake * 100.0),
    ("Gear",        "",    0, lambda p, g: float(p.gear - 1)),   # AC: 0=R, 1=N
    ("Steering",    "%",   1, lambda p, g: p.steerAngle * 100.0),
    ("Lateral g",   "g",   2, lambda p, g: p.accG[0]),
    ("Longitudinal g", "g", 2, lambda p, g: p.accG[2]),
    ("Slip angle",  "deg", 1, lambda p, g: slip_angle(p)),
    ("Fuel",        "L",   1, lambda p, g: p.fuel),
]


def slip_angle(p):
    """Angle between where the car points and where it is actually going.

    A sim knows this exactly, which no GPS puck does — it is the one channel
    here that is better than the real hardware's. Below walking pace the
    velocity vector is noise, so the honest answer is no reading at all.
    """
    vx, _, vz = p.velocity[0], p.velocity[1], p.velocity[2]
    if math.hypot(vx, vz) < 1.5:
        return None
    course = math.atan2(vx, vz)
    d = (course - p.heading + math.pi) % (2 * math.pi) - math.pi
    return d / DEG


def fit_channel_defs(cols, stamp):
    """One scale and offset per channel, fitted to the range it actually used.

    Same reasoning as the VBO importer: channels are stored as u16, and a
    fixed scale would spend the same precision on 8,000 rpm as on a 0-1 g
    trace. 65535 is not available — it is the stale marker — so the range
    maps onto 0..65534.
    """
    defs = []
    for i, (name, unit, dp, _) in enumerate(CHANNELS):
        vals = [v for v in cols[i] if v is not None]
        lo = min(vals) if vals else 0.0
        hi = max(vals) if vals else 0.0
        if not hi > lo:
            hi = lo + 1.0
        defs.append({
            "id": "sim:%s_%d" % (stamp, i),
            "name": name, "unit": unit, "decimals": dp,
            "scale": (hi - lo) / 65534.0, "offset": lo,
        })
    return defs


def pack_channel(v, d):
    if v is None:
        return GP_CHAN_STALE
    u = int(round((v - d["offset"]) / d["scale"]))
    return 0 if u < 0 else (65534 if u > 65534 else u)


# ══════════════════════════════════════════════════════════════════════════
#  Writers
# ══════════════════════════════════════════════════════════════════════════

def b64(fmt, seq):
    return base64.b64encode(struct.pack("<%d%s" % (len(seq), fmt), *seq)).decode()


def write_session(path, rows, cols, meta_in):
    """The .rdmsession, exactly as gpSessionFileParse reads it back."""
    n = len(rows)
    stamp = format(int(time.time() * 1000), "x")
    defs = fit_channel_defs(cols, stamp)
    nch = len(defs)

    lat = [int(round(r["lat"] * 1e7)) for r in rows]
    lon = [int(round(r["lon"] * 1e7)) for r in rows]
    kph = [max(0, min(65535, int(round(r["kph"] * 100)))) for r in rows]
    hdg = [max(0, min(65535, int(round(r["hdg"] * 100)))) for r in rows]
    t = [min(GP_NO_T - 1, int(r["t"])) for r in rows]
    can = []
    for i in range(n):
        for c in range(nch):
            can.append(pack_channel(cols[c][i], defs[c]))

    meta = dict(meta_in)
    meta.update({
        "samples": n,
        "durationS": (t[-1] - t[0]) / 1000.0 if n > 1 else 0.0,
        # Left for Studio to work out from the track's gates, exactly as a
        # VBO import does. AC's own lap times are printed instead of written:
        # if Studio's gate timing agrees with them, the whole chain — frame,
        # projection, sample rate — is proven end to end.
        "lapCount": 0, "bestLapS": None, "lapTimesS": [], "corners": [],
        "chanIds": [d["id"] for d in defs],
        "chanDefs": defs,
    })

    out = {
        "format": SESFILE_FMT, "version": 1, "meta": meta,
        "data": {
            "n": n,
            "lat": b64("i", lat), "lon": b64("i", lon),
            "kph": b64("H", kph), "hdg": b64("H", hdg), "t": b64("I", t),
            "nch": nch, "can": b64("H", can),
        },
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    return defs


# The dash's replay reader matches column headers against ITS signal names
# (signal_replay.c → signal_find_by_name) and silently skips what it does not
# know, so these default to the firmware's canonical channel names. Anything
# the layout does not use costs nothing but a skipped column.
CSV_SIGNALS = [
    ("rpm", 0), ("vehicle_speed", None), ("throttle_position", 1),
    ("brake_position", 2), ("gear", 3), ("fuel_level", 8),
]


def write_csv(path, rows, cols):
    """The dash replay CSV: first column timestamp_ms, then signal names."""
    head = ["timestamp_ms"] + [nm for nm, _ in CSV_SIGNALS]
    lines = [",".join(head)]
    for i, r in enumerate(rows):
        line = [str(int(r["t"]))]
        for nm, ci in CSV_SIGNALS:
            if ci is None:                       # speed comes from the fix
                line.append("%.1f" % r["kph"])
            else:
                v = cols[ci][i]
                line.append("" if v is None else "%.2f" % v)
        lines.append(",".join(line))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    return head


# ══════════════════════════════════════════════════════════════════════════
#  Recording
# ══════════════════════════════════════════════════════════════════════════

def heading_from(prev, cur, fallback):
    """Course over ground, the way a GPS reports it.

    Derived from the projected track rather than taken from the car's own
    heading, so it stays true after the rotation is applied — and because it
    is what every other consumer of this file assumes it is. Holds the last
    good value when the car is barely moving, where the direction between
    two fixes is noise.
    """
    dlat = cur[0] - prev[0]
    dlon = cur[1] - prev[1]
    if abs(dlat) < 1e-9 and abs(dlon) < 1e-9:
        return fallback
    east = dlon * math.cos(cur[0] * DEG)
    return (math.atan2(east, dlat) / DEG) % 360.0


def record(args, places):
    reader = ACReader()
    st = reader.static()
    g0 = reader.graphics()
    p0 = reader.physics()

    checks = layout_is_sane(p0, g0, st)
    bad = [n for n, ok in checks if not ok]
    if bad and not args.force:
        print("The shared memory does not read like Assetto Corsa:")
        for n, ok in checks:
            print("   %-22s %s" % (n, "ok" if ok else "NO"))
        print("\nRun --check for the raw values. --force records anyway.")
        return 2

    ac_track = (st.track or "").strip()
    car = (st.carModel or "").strip()
    driver = " ".join(x for x in [(st.playerName or "").strip(),
                                  (st.playerSurname or "").strip()] if x)

    # Where to pin it
    place = None
    if args.anchor:
        try:
            la, lo = [float(x) for x in args.anchor.split(",")[:2]]
            place = {"id": None, "name": args.track_name or ac_track or "Anchor",
                     "where": "", "lat": la, "lon": lo}
        except ValueError:
            print("--anchor wants LAT,LON")
            return 2
    else:
        place = match_place(ac_track, places)
    if place is None:
        print("No idea where '%s' is on earth.\n" % ac_track)
        print("Pass --anchor LAT,LON with the circuit's centre and it will be")
        print("pinned there. Studio matches a recording to a track within")
        print("3 km, so the centre of the infield is close enough.")
        return 2

    geo = Georef(place["lat"], place["lon"], args.rotate, args.mirror)
    print("Assetto Corsa %s · %s" % ((st.acVersion or "?").strip(), car or "car?"))
    print("track '%s' → %s (%.5f, %.5f)%s" %
          (ac_track, place["name"], place["lat"], place["lon"],
           "  rot %.1f°%s" % (args.rotate, " mirrored" if args.mirror else "")))
    print("recording at %d Hz — Ctrl-C to stop\n" % GP_TRACE_HZ)

    rows, cols = [], [[] for _ in CHANNELS]
    xz = []
    dt = 1.0 / GP_TRACE_HZ
    t_start = None
    last_ll = None
    last_hdg = 0.0
    last_packet = -1
    ac_laps = []          # (lap number, AC's own time in ms)
    seen_laps = None
    stalls = 0
    next_tick = time.perf_counter()

    try:
        while True:
            now = time.perf_counter()
            if now < next_tick:
                time.sleep(min(dt / 4, next_tick - now))
                continue
            next_tick += dt
            if now - next_tick > 1.0:      # fell far behind; resync
                next_tick = now + dt

            p = reader.physics()
            g = reader.graphics()

            if g.status != AC_LIVE:
                continue
            if p.packetId == last_packet:
                # Same physics frame twice: the game is running slower than
                # this loop is asking. Skipping is right — a duplicated
                # sample would read as the car standing still for 40 ms.
                stalls += 1
                continue
            last_packet = p.packetId

            # AC's own lap timing, kept for the comparison at the end.
            if seen_laps is None:
                seen_laps = g.completedLaps
            elif g.completedLaps > seen_laps:
                seen_laps = g.completedLaps
                if g.iLastTime > 0:
                    ac_laps.append((seen_laps, g.iLastTime))

            x, _, z = g.carCoordinates[0], g.carCoordinates[1], g.carCoordinates[2]
            if geo.x0 is None:
                geo.origin_from(x, z)
            ll = geo.to_latlon(x, z)
            if t_start is None:
                t_start = now
            hdg = heading_from(last_ll, ll, last_hdg) if last_ll else 0.0
            last_hdg, last_ll = hdg, ll

            rows.append({"lat": ll[0], "lon": ll[1],
                         "kph": max(0.0, p.speedKmh), "hdg": hdg,
                         "t": int(round((now - t_start) * 1000))})
            xz.append((x, z))
            for i, (_, _, _, get) in enumerate(CHANNELS):
                try:
                    cols[i].append(get(p, g))
                except Exception:
                    cols[i].append(None)

            if len(rows) % (GP_TRACE_HZ * 5) == 0:
                print("\r  %6.1f s · %5d samples · lap %d · %5.1f km/h" %
                      ((now - t_start), len(rows), g.completedLaps, p.speedKmh),
                      end="", flush=True)
    except KeyboardInterrupt:
        print()
    finally:
        reader.close()

    if len(rows) < GP_TRACE_HZ * 2:
        print("Nothing worth writing — %d samples. Was the car on track?"
              % len(rows))
        return 1
    if stalls > len(rows) * 0.2:
        print("note: %d ticks found no new physics frame — the game was "
              "running below %d Hz, so the trace is thinner than it looks."
              % (stalls, GP_TRACE_HZ))

    return finish(args, rows, cols, xz, geo, place, {
        "name": args.name or ("%s — %s" % (place["name"], car or "AC")),
        "trackId": None, "trackName": place["name"], "trial": False,
        "recordedAt": int(time.time() * 1000) - rows[-1]["t"],
        # The PC clock is real UTC, which is what "gps" means downstream —
        # the date is known, so video sync has something true to hang on.
        "dated": "gps", "savedAt": int(time.time() * 1000),
        "device": "Assetto Corsa", "car": car, "driver": driver,
    }, ac_laps)


def finish(args, rows, cols, xz, geo, place, meta, ac_laps):
    # Fit the rotation if an outline was handed over.
    if args.fit:
        try:
            with open(args.fit, "r", encoding="utf-8") as f:
                ol = json.load(f)
            pts = ol.get("points") if isinstance(ol, dict) else ol
            pts = [(float(a), float(b)) for a, b in pts]
        except Exception as e:
            print("could not read --fit outline: %s" % e)
            pts = None
        if pts:
            best = fit_rotation(xz, pts, place["lat"], place["lon"])
            if best:
                err, rot, mirror = best
                print("fit: rotation %.1f°%s, mean %.1f m off the outline"
                      % (rot, " mirrored" if mirror else "", err))
                if err > 40:
                    print("  (that is a poor fit — wrong outline for this "
                          "track, or the wrong configuration of it)")
                geo.rot = rot * DEG
                geo.mirror = mirror
                # Re-project everything through the solved frame.
                last = None
                hdg = 0.0
                for i, (x, z) in enumerate(xz):
                    la, lo = geo.to_latlon(x, z)
                    if last:
                        hdg = heading_from(last, (la, lo), hdg)
                    rows[i]["lat"], rows[i]["lon"], rows[i]["hdg"] = la, lo, hdg
                    last = (la, lo)

    defs = write_session(args.out, rows, cols, meta)
    dur = rows[-1]["t"] / 1000.0
    print("wrote %s — %d samples, %.1f s, %d channels"
          % (args.out, len(rows), dur, len(defs)))

    if args.csv:
        head = write_csv(args.csv, rows, cols)
        print("wrote %s — replay CSV, columns: %s" % (args.csv, ", ".join(head)))
        print("  Studio → Data Logging → Upload, then Play. Column names have")
        print("  to match the dash's own signal names or they are skipped;")
        print("  the dash must be on WiFi (replay is stubbed over USB).")

    if ac_laps:
        print("\nAC's own lap times, for checking Studio's against:")
        for lap, ms in ac_laps:
            print("  lap %-3d %d:%06.3f" % (lap, ms // 60000, (ms % 60000) / 1000.0))
    print("\nImport it: Studio → GPS → Sessions → Import.")
    return 0


# ══════════════════════════════════════════════════════════════════════════
#  Modes
# ══════════════════════════════════════════════════════════════════════════

def do_check(places):
    reader = ACReader()
    p, g, s = reader.physics(), reader.graphics(), reader.static()
    print("shared memory version   %s (AC %s)" %
          ((s.smVersion or "?").strip(), (s.acVersion or "?").strip()))
    print("track                   %s" % (s.track or "?"))
    print("car                     %s" % (s.carModel or "?"))
    print("driver                  %s %s" % (s.playerName or "", s.playerSurname or ""))
    print("status                  %d (2 = live)" % g.status)
    print("speed                   %.1f km/h" % p.speedKmh)
    print("rpm / gear              %d / %d" % (p.rpms, p.gear - 1))
    print("throttle / brake        %.2f / %.2f" % (p.gas, p.brake))
    print("coordinates             %.1f, %.1f, %.1f" %
          (g.carCoordinates[0], g.carCoordinates[1], g.carCoordinates[2]))
    print("lap fraction            %.4f" % g.normalizedCarPosition)
    print("heading                 %.3f rad" % p.heading)
    print()
    ok = True
    for n, good in layout_is_sane(p, g, s):
        print("  %-22s %s" % (n, "ok" if good else "NO"))
        ok = ok and good
    place = match_place((s.track or "").strip(), places)
    print("\ncircuit match           %s" %
          (("%s (%.5f, %.5f)" % (place["name"], place["lat"], place["lon"]))
           if place else "none — you will need --anchor LAT,LON"))
    reader.close()
    return 0 if ok else 1


def do_selftest(args):
    """Prove the writers without AC: a synthetic lap through the real code.

    The rules are the ones the fixture generator learned the hard way —
    integrate position from speed so lap time follows lap speed, and use a
    closed polar curve that is positive everywhere so the course provably
    never crosses itself.
    """
    lat0, lon0 = -36.518502, 146.087158        # Winton, from GP_PLACES
    geo = Georef(lat0, lon0, 0.0, False)
    geo.origin_from(0.0, 0.0)
    rows, cols, xz = [], [[] for _ in CHANNELS], []
    t = 0
    last = None
    hdg = 0.0
    R0, A, B = 380.0, 90.0, 45.0

    def at(th):
        r = R0 + A * math.cos(3 * th) + B * math.cos(5 * th)
        return r * math.cos(th), r * math.sin(th)

    th = 0.0
    total = 0.0
    prev_v = None
    fuel = 45.0
    while total < 2 * 2 * math.pi * R0:
        x, z = at(th)
        # speed from local curvature, so it brakes for the tight bits
        h = 0.01
        x0, z0 = at(th - h)
        x2, z2 = at(th + h)
        a = math.hypot(x - x0, z - z0)
        b = math.hypot(x2 - x, z2 - z)
        c = math.hypot(x2 - x0, z2 - z0)
        area = abs((x - x0) * (z2 - z0) - (x2 - x0) * (z - z0)) / 2
        cr = 1e6 if area < 1e-9 else (a * b * c) / (4 * area)
        v = max(12.0, min(55.0, math.sqrt(1.1 * 9.81 * cr)))
        ll = geo.to_latlon(x, z)
        if last:
            hdg = heading_from(last, ll, hdg)
        last = ll
        rows.append({"lat": ll[0], "lon": ll[1], "kph": v * 3.6,
                     "hdg": hdg, "t": t})
        xz.append((x, z))

        # Every channel has to MOVE. A constant column packs through the
        # hi == lo branch of the scale fit and would round-trip perfectly
        # while proving nothing — which is the bug this fixture exists to
        # catch, so the fixture must not contain it.
        # Clamped to grip. The polar curve's speed can step faster than any
        # car could, and an unclamped fixture prints an 8 g stab of brake —
        # which reads as a bug in the writer rather than in the fixture.
        accel = 0.0 if prev_v is None else (v - prev_v) * GP_TRACE_HZ
        accel = max(-1.1 * 9.81, min(0.45 * 9.81, accel))
        prev_v = v
        gear = max(1.0, min(6.0, math.floor(v / 9.0) + 1))
        rpm = max(1200.0, min(7200.0, v / max(1.0, gear) * 340.0))
        thr = max(0.0, min(100.0, 50.0 + accel * 14.0))
        brk = max(0.0, min(100.0, -accel * 22.0))
        lat_g = (v * v / max(20.0, cr)) / 9.81
        fuel -= 0.0004
        vals = [rpm, thr, brk, gear, math.copysign(min(100.0, 900.0 / max(20.0, cr)), area or 1),
                lat_g, accel / 9.81, lat_g * 6.0, fuel]
        for i in range(len(CHANNELS)):
            # one deliberate gap per lap, so the "channel went quiet" path
            # is exercised too — 0xFFFF must read back as no reading
            cols[i].append(None if (i == 7 and len(rows) % 900 == 400) else vals[i])
        step = v / GP_TRACE_HZ
        th += step / max(50.0, R0)
        total += step
        t += int(1000 / GP_TRACE_HZ)

    meta = {"name": "AC selftest — Winton", "trackId": None,
            "trackName": "Winton National", "trial": False,
            "recordedAt": int(time.time() * 1000), "dated": "gps",
            "savedAt": int(time.time() * 1000), "device": "Assetto Corsa",
            "car": "selftest", "driver": "selftest"}
    defs = write_session(args.out, rows, cols, meta)
    print("wrote %s — %d samples, %.1f s, %d channels"
          % (args.out, len(rows), rows[-1]["t"] / 1000.0, len(defs)))
    if args.csv:
        write_csv(args.csv, rows, cols)
        print("wrote %s" % args.csv)
    print("\nnow prove Studio accepts it:  node tools/check_ac_session.js %s"
          % args.out)
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="Record Assetto Corsa into an RDM Studio session.")
    ap.add_argument("--out", default="ac_stint.rdmsession",
                    help="the .rdmsession to write")
    ap.add_argument("--csv", help="also write a replay CSV for the dash")
    ap.add_argument("--anchor", help="LAT,LON to pin the track on, when the "
                                     "circuit is not one Studio knows")
    ap.add_argument("--rotate", type=float, default=0.0,
                    help="degrees to turn the track by, to line it up with "
                         "the basemap")
    ap.add_argument("--mirror", action="store_true",
                    help="flip the track's handedness, if it comes out as its "
                         "own mirror image")
    ap.add_argument("--fit", help="JSON [[lat,lon],...] of the real track's "
                                  "outline; solves rotation and mirror from it")
    ap.add_argument("--name", help="name for the session")
    ap.add_argument("--track-name", help="track name when using --anchor")
    ap.add_argument("--force", action="store_true",
                    help="record even if the memory layout looks wrong")
    ap.add_argument("--check", action="store_true",
                    help="print what AC is publishing and stop")
    ap.add_argument("--selftest", action="store_true",
                    help="write a synthetic session; no AC needed")
    args = ap.parse_args()

    places = load_places()
    if not places:
        print("warning: could not read GP_PLACES out of %s — --anchor only"
              % os.path.normpath(OVERLAY))

    try:
        if args.selftest:
            return do_selftest(args)
        if args.check:
            return do_check(places)
        return record(args, places)
    except RuntimeError as e:
        print(str(e))
        return 2


if __name__ == "__main__":
    sys.exit(main())
