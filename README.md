# Türsprint

Kiosk game for Variocube lockers (`@variocube/cube-app-react-sdk` 1.3.1). The locker pops doors open, the player closes as many as possible within a time limit (default 60 s). Top-10 highscores with 3-letter initials are kept in the kiosk's localStorage; staff reset: hold the title for 5 s.

Playable compartments are chosen automatically: every compartment the SDK reports with `enabled === true` whose `types` does not contain `Master` (case-insensitive). SDK 1 has no occupancy info, so the game cannot know which compartments hold goods: use `boxes=` to exclude those. With fewer than `parallel + 1` playable compartments the start screen shows a staff notice instead of the start button.

## URL parameters

| Param | Default | Range | Meaning |
|---|---|---|---|
| `time` | 60 | 10..600 | game length in seconds |
| `parallel` | 2 | 1..3 | doors open at once |
| `boxes` | all eligible | list/ranges `2-10,12`, or `all` | optional restriction (still intersected with enabled non-Master compartments) |
| `minopen` | 400 | 0..5000 | ms a door must have been open to count (calibration knob for real locks) |
| `stuck` | 4000 | 500..60000 | ms to wait for the OPEN event after an open command, then the door is dropped (no point) |
| `lang` | from `locale`, else de | de, en | language |
| `locale` | - | e.g. `de-AT` | set by the kiosk; default language if `lang` is absent |
| `languages` | - | e.g. `de,en` | set by the kiosk; DE \| EN toggle if both are listed (or absent) |
| `debug` | off | 1 | logs lock events to the console |

Invalid values are clamped. Example: `?time=45&parallel=2&boxes=1-12&lang=en`

A box whose `openCompartment` throws is dropped for the rest of the game (console.error with the box number only); if fewer than `parallel` boxes remain, the game ends with the staff screen.

## Development

```
npx @variocube/cube-app-service   # virtual cube, UI at http://localhost:4000 (open it first: compartments only exist while it is connected)
npm install
npm run dev                       # open the printed URL; click doors in the mock UI to close them
npm test                          # node src/game.test.ts
npm run build                     # dist/, relative base, es2020
```

## On a cube

Host `dist/` on a public URL, set it (incl. params) as `cubeAppUrl` on the cube, and install the package `variocube-cube-app-service`, which replaces app-host. A kiosk with unit < 5 additionally needs `/var/lib/variocube-kiosk/cube-app-url.env`. After the kiosk points at the app, restart `variocube-cube-app-service` so mock compartments from earlier runs do not linger.
