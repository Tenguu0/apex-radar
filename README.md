# Apex Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tenguu0/apex-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tenguu0/apex-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Apex Radar** is a token launch radar: it finds every protocol in a sealed
DefiLlama snapshot that could still launch a token, prices each one by what
its peers' tokens are worth, and shows a reader how to farm it.

## What it does

- **Ranked board** — 178 launch candidates, ranked by implied value. The
  40-protocol watchlist (TVL ≥ $50M, no token, no wrapped/staked parent) is
  fully covered; the board goes further and carries every rankable pre-token
  protocol, including the early ones below the floor.
- **Peer-multiple model** — implied value = TVL × the median market-cap/TVL
  of the token-bearing protocols in the same category (shrunk toward the
  global median when peers are few) × growth × maturity × chain breadth.
  Two guards keep one thin peer from setting a whole category's price: the
  shrink needs eight peers before a category's own median dominates, and no
  category's multiple may exceed twice the global median. In this snapshot
  the Risk Curators peer set is a single token at 2.97× and Prediction
  Market's is a single token winsorised from 400× — without the cap both
  would price near 0.77×, four times the field median. Every factor comes
  from the snapshot itself; no protocol name is special-cased.
- **What counts as a launch** — the house's watchlist rule, applied to the
  whole board. Exchanges, bridges, wrapped/staked products and versioned
  pools are not ranked: WBTC is Bitcoin on Ethereum, not a launch. The 164
  protocols the rule leaves out are listed apart under "Not a launch", each
  with its reason, so the separation is visible instead of silent.
- **Detail view** — click any row for the model broken down factor by
  factor, the live peers its multiple comes from, its 7-day growth against
  its category and the field, and a concrete farm plan.
- **Farm plans** — every row carries 7 steps with what each costs in gas
  and how long it takes, tailored to the protocol's category family and
  chain, plus a position-size rule and a record-keeping rule.
- **Filter, sort, search** — by category, chain, minimum TVL, watchlist,
  or starred protocols (stars persist in localStorage).
- **Model sandbox** — two sliders in the Method tab re-rank the board live
  from the same snapshot figures (growth weight, peer cap). The sandbox
  never changes board.json: the submitted ranking is the one `main.ts`
  wrote.
- **Already trading** — the token-bearing protocols, shown apart at the
  market's own value. They are the peers the board's multiples come from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later, standard library only — nothing is
installed. Then open `out/dashboard/index.html` in a browser (it reads
`out/data.js`, no network).

## The model (apex-comps-2)

```
implied = TVL × peer × growth × maturity × breadth
peer    = min(shrunk category median mcap/TVL, 2 × global median)
growth  = 1 + clamp(change_7d, −50, +150)% × 0.6
maturity = 0.80 + 0.20 × min(age_days, 1095) / 1095
breadth = 1 + 0.02 × min(chains − 1, 5)
```

Size is the anchor, priced like the market prices comparable tokens;
growth rewards momentum, maturity rewards a long run with no token
(pent-up launch value), breadth rewards a multi-chain footprint. Implied
value is this radar's claim, never a promise: it does not predict whether
or when a token launches.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes
  `board.json`, `data.js`, the dashboard, the screenshots and `dossier.json`
- `lib/apex-model.ts` — the peer-multiple model, the launch rule, the farm
  plans and the board's own gate check
- `dashboard/` — the static page (index.html, app.css, app.js), no network
- `vendor/makefun-board.ts` — the make.fun dossier library (vendored from
  the kit, byte for byte)
- `screenshots/` — the board, a protocol's detail view and a filtered view

---

<sub>Entered on [make.fun](https://make.fun/?ref=zesty-condor-68&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
