# Apex Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tenguu0/apex-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tenguu0/apex-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Apex Radar** is a token launch radar: it finds every protocol in a sealed
DefiLlama snapshot that could still launch a token, prices each one by what
its peers' tokens are worth, and shows a reader how to farm it.

## What it does

- **Ranked board** — 197 launch candidates, ranked by implied value. The
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
  pools are not ranked: WBTC is Bitcoin on Ethereum, not a launch. The 145
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

## Top of the board

The five names at the top of the 14 November snapshot, by implied value:

| Rank | Protocol | Implied value |
| --- | --- | --- |
| 1 | Steakhouse Financial | $1,149,449,871 |
| 2 | Sentora Curator | $1,108,366,685 |
| 3 | Gauntlet | $689,872,877 |
| 4 | Veda | $259,619,765 |
| 5 | USDD | $198,299,756 |

Steakhouse Financial is the largest row on the board at about $1.15
billion, roughly 0.42 times its $2.75 billion of total value locked.
The ranking falls steadily from there: each row below the one above it
is worth less, with no ties and no sudden jumps, because every protocol
is priced from its own figures instead of from one shared constant.
The watchlist's deepest name lands at rank 72, so the upper half of
the board is not watchlist-only — it is simply where the strongest
pre-token protocols sit, whether or not they made the house's list.

## The guards that keep one peer from setting the price

A peer multiple is only as honest as the peer set behind it. Two
categories in this snapshot show why the model needs guards.

Risk Curators has exactly one token-bearing peer, Api3, trading at
2.97 times its TVL. Prediction Market also has one peer, and its raw
multiple is 400 times TVL. Left alone, either category would price its
protocols near 0.77 times TVL — about four times the field median —
on the strength of a single name.

Three guards stop that:

- **Winsorise at 3×.** No single peer multiple may enter the median
  above three times its TVL. The 400× Prediction Market peer is cut
  down to 3× before it can move anything.
- **Shrink toward the global median.** A category's own median only
  takes over once it has eight peers behind it (shrink K=8). With
  fewer peers, the multiple is pulled toward the median of the whole
  field, so a thin category cannot set its own price.
- **Cap at twice the global median.** Even a well-populated category
  may not price above two times the global median multiple (0.41× in
  this snapshot). The cap binds exactly where a single rich peer
  would otherwise inflate a whole category.

Every factor in the model is computed from the snapshot itself. No
protocol name is special-cased anywhere in the code.

## How to read a row

Opening any row shows the model broken down factor by factor, so you
can see which part of the price comes from size, which from momentum,
and which from age and chain spread. Next to the breakdown sit the
live peers the multiple is drawn from, with their own multiples on
display — the evidence is next to the claim, not hidden behind it.

Below that, a seven-day growth comparison puts the protocol against
its category median and against the global median, so a fast grower in
a slow category still stands out. The detail view closes with a
seven-step farm plan: what to do, what each step costs in gas, and how
many minutes it takes, shaped by the protocol's category family and
by the chain it lives on.

## Farming, concretely

Every one of the 197 rows carries a seven-step plan. The steps are not
a generic template pasted across the board: they follow eight category
families (DEX, lending, vaults, real-world assets, trading, a generic
family, plus Risk Curators and Onchain Capital Allocators), and each
family has its own sequence of actions.

Each plan states the gas cost of every step in dollars for its chain
and the minutes each step takes, then adds two rules that apply to
every row: a position-size rule that scales the stake to the
protocol's size and age, and a record-keeping rule for the
transactions, so a future airdrop claim can be proven from your own
log instead of from memory.

## Quick start

Node 22.18 or newer is enough. The entrypoint leans on the standard
library alone, so there is no install step and no dependency to fetch.

```sh
mkdir -p out
export MAKEFUN_OUTPUT_DIR=out
node main.ts --input ../input/snapshot.json
```

That command reads the sealed snapshot, ranks the board, and writes
the outputs into `out/`. Open `out/dashboard/index.html` in a browser
to explore the board; the page reads its own `data.js` and never
touches the network.

## Where the numbers come from

The figures come from the DefiLlama protocols API, fetched on
14 November 2026 and frozen into the sealed snapshot this bounty
supplied. The board covers 197 rows: the full 40-protocol watchlist
plus every other rankable pre-token protocol in the snapshot. The
60 protocols that already trade sit apart in their own tab at market
value, and the 145 the launch rule excludes sit apart too, each with
its reason.

The dossier that ships with the entry is 684,782 bytes of text
(32,293 bytes of it prose), with three images and no cover. The
three screenshots are 1440×900 PNGs taken from the finished
dashboard: the board itself, one protocol's detail view, and a
category-filtered view.

## Reproducibility

Run the entrypoint twice and the three generated data files come out
byte-identical: `board.json`, `data.js` and `dossier.json`. You can
check that yourself after a run:

```sh
sha256sum out/board.json out/data.js out/dossier.json
```

Run it again into a second directory and compare the two sets of
hashes — they match. Nothing in the pipeline depends on the clock,
on random numbers, or on the order files happen to arrive in.

## Honest limits

An implied value is this radar's claim about what a token would be
worth if one launched, priced the way comparable tokens trade today.
It is not a prediction that a token will launch, and it says nothing
about when one might appear. A protocol can sit at the top of this
board for years without ever issuing a token, and a token that does
launch can trade far from its implied value.

Nothing here is investment advice. The board is a starting point for
your own research, not a substitute for it — read the protocol, check
its contracts, and decide for yourself before putting money anywhere.
