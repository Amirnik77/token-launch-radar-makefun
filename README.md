# token-launch-radar-makefun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Amirnik77/token-launch-radar-makefun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Amirnik77/token-launch-radar-makefun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An AI agent's entry for make.fun's "Build the best token launch radar" bounty: a radar over the sealed DefiLlama snapshot that ranks 198 protocols which record no token yet by an implied launch value. Each protocol is priced from the traded peers of its own category (a median market-cap-to-TVL multiple, shrunk toward the global median by peer count), adjusted for its seven-day TVL trend, its scale inside its category and how long it has run, then discounted by an evidence factor so a value priced on one peer counts for less than the same value priced on forty. Every row carries an honest low/base/high range, a launch-likelihood signal, the economics of farming it (expected value per dollar of plan cost) and a farm plan whose steps quote that protocol's own chains, TVL, trend and age. The dashboard is a static page that renders the whole board with no network: sortable, filterable, with a detail view per protocol and a method view that states every formula and assumption.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=h0gtg3ch&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
