# PCCOE Lab

A small, static **F.Y. Physics** lab site. The topic browser is a set of clearly marked placeholders; the **Simple Harmonic Motion (SHM)** string/wave simulation is the only working lab.

The repository originally contained no application framework, build scripts, or reference screenshots, so this site uses plain HTML, CSS, and ES modules with a Canvas visualization. There are no runtime or development dependencies.

## Run locally

Node.js 18 or newer is required for the built-in static server, lint script, and test runner.

```bash
npm install
npm run dev
```

Open `http://localhost:4173`. The server binds to `0.0.0.0` and accepts a `PORT` environment variable:

```bash
PORT=8080 npm run dev
```

To build and preview the static output:

```bash
npm run build
npm run preview
```

## Checks

```bash
npm run lint    # JavaScript syntax, local asset references, and basic accessibility wiring
npm test        # physics model tests using Node's built-in test runner
npm run build   # copies the static site to dist/
npm run check   # all of the above
```

`npm run dev`, `npm run preview`, and `npm run build` were also added as project scripts; there are no framework-specific build steps.

## Project layout

- `index.html` — site shell, topic browser, simulation controls, and model notes
- `src/styles.css` — responsive design system and component styles
- `src/physics/shm.js` — pure simulation state, wave propagation, reflection, and metrics
- `src/simulation/renderer.js` — Canvas rendering and pointer geometry
- `src/content.js` — mode/boundary teaching text
- `src/app.js` — DOM controls, animation loop, and state synchronization
- `scripts/` — zero-dependency static server, build, and lint scripts
- `tests/physics.test.mjs` — core physics behavior tests
- `assets/favicon.svg` — small site icon

## Using the simulation

1. Choose **Manual**, **Oscillate**, or **Pulse**.
2. Choose **Fixed End**, **Loose End**, or **No End**.
3. Set amplitude, frequency, damping, tension, and playback speed.
4. Press **Play**. Use **Pause**, **Step**, and **Reset** as needed.
5. In **Pulse** mode, use **Send pulse** to launch a single disturbance. In **Manual** mode, use the driver position slider or drag the driver handle on the canvas.
6. Toggle the ruler, stopwatch, and equilibrium/reference guides on or off.

Changing the mode or end condition restarts the trace at `t = 0`; other controls apply immediately. The **Step** button advances `1/30 s` of simulated time while paused.

## Physics model and limitations

- The horizontal string is `1.00 m` long in model space. Red and cyan dots identify neighboring particles; each dot has a fixed horizontal position and moves only vertically around equilibrium. The **disturbance** travels; the particles do not travel with it.
- A point at position `x` shows the source history delayed by `x / v`, where `v = 1.20 * sqrt(T / 1.50 N) m/s`. Tension `T` is in model units with constant linear density; this is a qualitative relationship, not a calibration of a real string.
- Damping is `exp(-gamma * travelTime)` with `gamma` in `s^-1`. It is a travel-time attenuation model, not a full numerical solution of a damped wave equation.
- Oscillate mode drives the source sinusoidally. Pulse mode sends one smooth half-cycle whose duration is set by frequency. Manual mode records the driver position supplied by the slider or pointer drag.
- A fixed end adds an inverted, delayed source copy; a loose end adds an upright copy; no end adds no reflection. Reflected components fade in near the prescribed left driver so the oscillator stays visually consistent.
- The animation uses fixed `1/120 s` simulation steps, clamps frame deltas to `50 ms`, and scales accumulated time by playback speed. Large delays after a background-tab pause are clamped.
- The display scale is chosen to fit the maximum allowed amplitude and reflection. Values shown in the readouts are the model values, not measured data from a physical apparatus.

## Topic placeholders

The topic list is a starter set of neutral physics areas, **not** a complete or official PCCOE F.Y. Physics syllabus. Only the SHM simulation is implemented; other entries are intentionally non-interactive and marked “Coming soon.”
