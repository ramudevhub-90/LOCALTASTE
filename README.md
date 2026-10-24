# Localtaste

A taste advisor for independent cafés and restaurants that can't afford market research.

Enter your café's address and current menu. Localtaste's agent asks [Qloo](https://qloo.com) what the
neighbourhood over-indexes on across food, music, film/TV and brands, then suggests:

- **Menu additions** the area likes that your menu doesn't cover yet
- **An in-store playlist** built from the artists the area favours
- **Theme nights**, e.g. "this area over-indexes on K-drama fans, so try a Korean street-food Friday"
- **An area comparison** for a competitor's neighbourhood or a second branch

Every suggestion has a **Why this?** link showing the Qloo signals and the exact workflow call behind it.
Results are aggregate neighbourhood affinities, never claims about individuals.

> Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com).

## Status

Day 0 skeleton. Qloo data is **sample data** (`QLOO_MODE=sample`) until the event API key arrives;
the UI labels it as such.

## Run locally

Requires Node 22.19+.

```sh
npm install
npm run build
npm start            # http://localhost:3000
```

For development with hot reload: `npm run dev` (API on :3000, Vite on :5173).

## Configuration

| Variable | Purpose |
| --- | --- |
| `QLOO_MODE` | `sample` (default) or `live` |
| `QLOO_API_KEY` | Event-issued Qloo key. Server-side only; used by the `qloo` CLI from `@qloo/qloo-harness`. |
| `ANTHROPIC_API_KEY` | Optional. Lets Claude write the suggestions; without it the app uses templates. |

Secrets go in the host's environment settings, never in the repo or the browser.

## Architecture

- `server/qloo/`: the only place that touches Qloo. `sample.ts` returns hand-written sample data;
  `live.ts` runs `qloo exec <workflow>` (`recommend` with `signal_location`, `compare_audiences`, …).
  Results are cached in memory.
- `server/agent.ts`: turns area taste signals and the menu into evidence-linked suggestions.
- `web/`: Vite + React front end, served by the same Express server.

## Deploy

`render.yaml` defines a Render web service. Set `QLOO_API_KEY` and `ANTHROPIC_API_KEY` in the dashboard.

## License

[MIT](LICENSE)
