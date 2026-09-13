# BIOBUZZ Scorer — FTC 2026-27

An unofficial match score calculator for the *FIRST* Tech Challenge **BIOBUZZ** season,
built from the [BIOBUZZ Competition Manual V1](https://ftc-resources.firstinspires.org/ftc/game/cm-html/BIOBUZZ%20Competition%20Manual%20-%20V1.htm).

**No backend.** Three static files, no build step, no dependencies. All state lives in the
browser (`localStorage`); nothing is uploaded anywhere.

## Features

- **Live dual-alliance scoring** with an itemised running total for red and blue.
- **Match timer** modelling the real field clock: 2:30 → 2:00 AUTO, an 8-second
  transition, then 2:00 TELEOP, with cues at the 1:00 FLOWER unlock and the final 20 seconds.
- **FLOWER ownership modelled per FLOWER** — the fiddliest part of BIOBUZZ scoring. Set the
  owner (the alliance holding the top-most NECTAR of its colour) and the element count, and
  the app awards 2 pts per element to the owner only, plus the 5 pt Bottom NECTAR Bonus
  tracked independently per alliance.
- **Ranking points** — SWARM, POLLINATOR 1, POLLINATOR 2 and Win/Tie, with editable
  thresholds (defaults are the *All Other Events* column; Championship values are TBA).
- **Fouls** credited to the opponent, and disqualification zeroing points and RP.
- **Field check** — flags impossible element counts (only 40 POLLEN + 16 NECTAR exist) and
  owner/element mismatches that would silently cost an alliance points.
- **Match history** with a full per-alliance breakdown, plus JSON export.
- Dark UI, tablet- and phone-friendly, keyboard shortcuts
  (`Space` start/pause, `R` reset, `1`–`4` tabs).

## Scoring reference (Table 10-2)

| Achievement | AUTO | TELEOP |
|---|---|---|
| LEAVE — no longer contacting the perimeter wall | 3 | – |
| PARK — at least partially in the LOADING ZONE | 5 | 5 |
| HIVE TIP | 20 | 20 |
| POLLEN / NECTAR remaining in CELL | – | 2 |
| Bottom NECTAR Bonus | – | 5 |
| POLLEN / NECTAR in an owned FLOWER | – | 2 |
| POLLEN / NECTAR in GARDEN | – | 1 |

Ranking points: SWARM (LEAVE + PARK points ≥ 16), POLLINATOR 1 (≥ 4 TIPS),
POLLINATOR 2 (≥ 7 TIPS), Win 3, Tie 1. MINOR FOUL gives 5 pts to the opponent, MAJOR FOUL 20.

## Running locally

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

## Single-file build

For handing to a scorekeeper on a tablet, or for use with no server at all:

```bash
python3 build-standalone.py    # -> biobuzz-scorer-standalone.html
```

That inlines the CSS and JS into one portable HTML file you can open straight
from disk. It is generated, so it is not checked in.

## Deploying

Any static host works — the repo root is the site root. On Vercel there is nothing to
configure: no framework, no build command, no output directory. For GitHub Pages, point
Pages at this branch with the folder set to `/ (root)`; `.nojekyll` keeps Jekyll out of it.

## Disclaimer

Unofficial and not affiliated with or endorsed by *FIRST*. The Head REFEREE and the official
*FIRST* scoring system are always authoritative. Thresholds and rules change through Team
Updates — verify before relying on this at an event.
