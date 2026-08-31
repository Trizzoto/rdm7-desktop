# Aerial imagery for the GPS map — what we use, and what we can't

2026-08-29. Companion to the `GP_IMAGERY` table in `src/tauri-overlay.html`.

The map under a driven line is not decoration: gates get placed against painted
lines, and apex markers get read off kerbs. Esri's worldwide layer stops having
anything at zoom 18 — above that it returns an identical 2,521-byte placeholder
that Leaflet upscales, so the top of the zoom range was invented detail. This
document records which real sources exist, which we ship, and which we tested
and rejected, with the evidence for each.

**Every row below was fetched.** Status codes, byte counts and checksums per
zoom level, at his own circuits. A source that "supports zoom 21" according to
its capabilities document and returns the same 549 bytes at every level above
19 does not support zoom 21.

## The stack

Three layers, bottom to top:

| Layer | What it is | When it is drawn |
| --- | --- | --- |
| World | Esri World_Imagery, sharp to z18 | whenever the ground is on |
| Region | the sharpest state source covering the map centre | where one covers, and is allowed |
| Labels | that region's transparent place-names tiles | when "Place names" is on and the region has one |

The regional layer sits **on top of** the worldwide one rather than replacing
it. That is the difference that matters: a state server answers 404 outside its
own state, so under the old swap a region shape that was merely close left a
grey hole exactly where someone was racing. Now a missing tile shows the layer
underneath. The shapes went from load-bearing to advisory.

Labels get their own Leaflet pane above the tile pane, because "Map: dim"
desaturates the tile pane and a dimmed place name is a name you cannot read.

## What we ship

| Where | Source | Sharp to | Licence | On by default |
| --- | --- | --- | --- | --- |
| South Australia | Location SA PublicMosaic | z21 | CC BY 4.0, `Fees: None` in its own capabilities | yes |
| New South Wales + ACT | NSW Spatial Services NSW_Imagery | z20 | free public service | yes |
| Queensland | Queensland Government LatestStateProgram | z20 | free public service, no token | yes |
| Victoria | Vicmap Basemaps AERIAL_WM_256 | z20 | **access fee required** | **no** |
| Everywhere else | Esri World_Imagery | z18 | see "unfinished business" | yes |

Labels overlays: Queensland's `QldImageryLabel` (free, transparent PNG32, z19)
and Victoria's `CARTO_OVERLAY_WM_256` (comes with the Vicmap opt-in).

### Measured, at his circuits

| Source | z18 | z19 | z20 | z21 |
| --- | --- | --- | --- | --- |
| Location SA @ Mallala | 91,953 B | 71,995 B | 63,599 B | 48,733 B |
| Vicmap @ Phillip Island | 99,568 B | 92,794 B | 83,399 B | 400 |
| Vicmap @ Calder Park | 120,471 B | 118,353 B | 94,745 B | 400 |
| Queensland @ Queensland Raceway | 18,823 B | 16,660 B | 12,304 B | 404 |
| Queensland @ Lakeside | 17,171 B | 16,403 B | 13,499 B | 404 |
| NSW @ Canberra (ACT) | 20,253 B | — | 12,363 B | — |

All distinct checksums, so this is real detail rather than one upscaled tile
repeated.

## Victoria: the one that costs money

Vicmap Basemaps is the only aerial imagery service published for Victoria, and
it answers openly — no key, no token. It also says this in its own
`GetCapabilities`:

> Vicmap Basemaps is a licensed service and an access fee is required. Contact
> vicmap@transport.vic.gov.au for more information.

Compare Location SA, whose same field reads `None`. Studio is sold, so quietly
billing a customer's licence to a service they have never heard of is not a
default anyone would choose if they were asked. It therefore ships **off**,
listed in the imagery picker with its price stated, behind a one-time
confirmation. Turned on, Winton, Phillip Island, Calder and Sandown go from
zoom 18 to zoom 20 — four times the linear detail.

The underlying imagery data is separately published on data.vic.gov.au under
CC BY 4.0. It is the *service* that is licensed. If Victoria matters enough,
the two honest routes are a licence (vicmap@transport.vic.gov.au) or hosting
the open data ourselves.

## Tested and rejected

| Source | What happened | Verdict |
| --- | --- | --- |
| Tasmania — LIST Orthophoto | works, real tiles to z19 | **rejected**: `copyrightText` is CC BY-**NC**-ND 3.0 AU. NC means non-commercial, and Studio is sold |
| Western Australia — SLIP public | the public imagery folder holds one 2021 bushfire capture | no statewide service to use |
| Northern Territory — NTLIS | Cloudflare challenge page instead of a service | not usable from an app |
| ACT — data.actmapi.act.gov.au | host does not resolve | not needed: NSW's mosaic covers Canberra at z20 (measured) |
| Queensland — QImagery | `{"error":{"code":499,"message":"Token Required"}}` | use `Basemaps/LatestStateProgram_AllUsers` instead, which needs no token |
| Victoria — a guessed `AerialPhoto2023` endpoint | 400 | the real service is base.maps.vic.gov.au, above |
| ArcGIS Online, searching for public Victorian imagery | nothing statewide; one 1950 Canadian harbour, some Murray river reaches | no free alternative exists |

## Things worth knowing before touching this

- **A state server is not politely empty outside its state.** NSW answers 404
  for Victoria, for South Australia and for the sea. This used to be fatal; it
  is now invisible, but it still means the shapes have to be right or the
  picker offers the wrong menu.
- **Borders are shared, not copied.** Victoria and NSW use one list of Murray
  points; Queensland and NSW use one list of border points. Two polygons that
  each guess at the same line disagree somewhere, and the somewhere is a strip
  of country with the wrong photograph on it.
- **The Queensland border is not a straight line.** It runs along 29°S to
  Mungindi, climbs *north* to Goondiwindi, drops *south* to Bonshaw, then goes
  north-east along the range. A straight leg there put Boggabilla (NSW) on
  Queensland tiles.
- **Holes are normal.** NSW has no imagery over Jervis Bay, because that is a
  Commonwealth territory. A run of failing tiles therefore stands a source down
  *where it failed*, for ten minutes — not for the session. The session-wide
  version of that rule cost you Bathurst for the afternoon if you had looked at
  Jervis Bay first.
- **CSP already allows any https image host**, so a new tile server needs no
  configuration.
- `node tools/check_imagery.js` pins every circuit in his library, both sides of
  the Murray at four river towns, both sides of the Queensland border, the
  licence gate, the stand-down rule and the manual picker. 83 checks.

## Unfinished business

- **Esri's own licence is unresolved.** Its terms want an account and a paid
  licence for commercial use, which is the same objection raised against
  Vicmap, and it is still the worldwide default. The honest end state is
  regional free sources everywhere his customers drive plus a "bring your own
  key" field for the licensed ones. New Zealand (LINZ, free, deep) is the
  obvious next region.
- **No free worldwide labels source.** CARTO and Stadia want an account for
  commercial use; the OSM tile policy rules out an app. So "Place names" only
  appears where the region publishes one — Queensland today, Victoria with the
  opt-in.
