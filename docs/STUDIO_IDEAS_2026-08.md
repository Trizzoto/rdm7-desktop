# Things worth building next

2026-08-31. Parked here rather than done — noted at his request while working
on the video overlay. Ordered by what I think each is worth, with the reason,
because a list of features without the argument for them is a list nobody can
prioritise later.

## 1. A calibration run, per car

Nothing in Studio knows whether a puck's gyro is scaled or mounted correctly.
`gpDriftAngle` integrates whatever it is handed, and on the 23 Aug Mallala
session it produced **+54° then −48° inside one corner, wearing ±2.1°**, on
footage that shows the car tracking the racing line. The engine is accurate to
under 3° on synthetic data where the gyro is perfect — so the fault is in the
instrument chain, and there is currently no way to find that out.

A guided routine — straight line, a slalom, a few steady corners — measures the
gyro's scale and its mounting offset against GPS, and stores them against the
CAR. Drift scoring and the corner ratings are standing on this number today
without it.

See `VIDEO_HUD_EXPORT_2026-08.md` → the slip-angle investigation for the
measurements.

## 2. "Can I trust this recording?" — one panel

The session already knows about quiet channels, dropped frames, GNSS gaps,
anchor counts and leg closure error. They are scattered across four surfaces
and mostly invisible. One panel with a plain verdict would have caught the 50°
angle in seconds instead of a day of bisection. Mostly plumbing of numbers that
already exist.

## 3. Golden-recording regression tests

Every harness here is synthetic, and synthetic data is exactly where the drift
engine looks perfect. Pin two or three REAL sessions with their expected lap
times, best lap, corner count and angle summary; any engine change that shifts
them fails loudly. This is the test that would have caught the slip angle
before he did.

## 4. One layout format for the dash and the overlay

They already share a widget vocabulary, names and icons (2026-08-31). Sharing
the FILE means "design once, use on the dash and on your videos", and it makes
the Marketplace twice as interesting because a shared layout works in both
places.

## 5. Auto-highlights

Moments, best lap, corner scoring and a fast exporter all exist. "Make me a
forty-second reel of this session" — best lap, biggest slide, latest brake — is
mostly assembly of parts that are already built, and it is the feature that
gets the app shared.

## 6. Two-lap comparison video

Best lap and a reference side by side, or one over the other with the delta
running. The exporter already does the hard parts.

## 7. Background exports

A 40-second export currently owns the app. Queue them and let them run while
the analysis carries on.

## 8. Session history that fills in

"History at this track" exists and is empty. A trend of best lap and
consistency across days is what makes the app worth opening between track days.
