# PCCOE Lab

A static, dependency-free **F.Y. Engineering Physics** laboratory site. Two simulations
are implemented and fully working:

1. **Experiment No. 2 — Diffraction grating.** Determine the wavelengths of the mercury
   spectral lines with a spectrometer and a grating ruled with 15 000 lines per inch.
2. **Experiment No. 6 — Simple Harmonic Motion.** Drive a horizontal string and watch a
   disturbance travel, reflect at fixed/free ends, and decay.

There are no frameworks, no backend, no build step for the browser, and no network calls
at runtime. Everything runs from plain HTML, CSS, ES modules, SVG and Canvas, so the site
deploys directly to GitHub Pages.

## Run locally

Node.js 18 or newer is needed only for the local static server, lint script and tests.

```bash
npm install
npm run dev
```

Open <http://localhost:4173>. The server binds to `0.0.0.0` and accepts `PORT`:

```bash
PORT=8080 npm run dev
```

To build and preview exactly what GitHub Pages will serve:

```bash
npm run build      # copies index.html, assets/ and src/ into dist/
npm run preview    # serves dist/
```

You can also open `index.html` from a simple static file server (for example
`python3 -m http.server`). Opening the file directly with `file://` will not work because
ES modules require an HTTP origin.

## Deploy to GitHub Pages

1. Push the repository to GitHub on the branch you want to publish.
2. In **Settings → Pages**, choose **Deploy from a branch**, select the branch and the
   `/ (root)` folder, then save.
3. The site is served from `https://<user>.github.io/<repo>/`; `index.html` at the
   repository root is the entry point. All asset paths are relative, so a project
   sub-path works without changes.
4. The included `.nojekyll` file prevents Jekyll from processing the folder.

If you prefer publishing the built folder, run `npm run build` and point Pages at the
`dist/` output (or use a Pages action).

## The diffraction grating laboratory

### Apparatus and interactions

- **Mercury vapour lamp** — switch on/off. A moving beam travels from the lamp through the
  collimator to the grating, and the spectral lines only exist while it is on.
- **Collimator** — slit width is adjustable from 0.05 mm to 1.00 mm. A wide slit visibly
  broadens the spectral lines and increases the tolerance for setting the crosswire.
  The **Align collimator** action focuses the slit; while it is unaligned the beam is drawn
  as a diverging fan, the lines are blurred, and readings cannot be recorded.
- **Diffraction grating** — 15 000 lines/inch, mounted in the centre of the turntable.
  The grating tilt slider rotates the normal through ±3° about the incident beam. A tilt
  makes the two diffraction orders asymmetric and worsens the measurement; the setup panel
  reports whether the normal is within 0.5° of zero.
- **Rotating telescope** — the telescope rides a circular carriage track that is concentric
  with the graduated circle carrying the degree numerals, and its vernier index points at
  those numerals while it orbits them. Drag the carriage (or anywhere on the turntable rim),
  or use the coarse (30′), fine (1′) and 10″ buttons; the arm is rotated with an SVG
  `rotate(a 500 330)` transform about the spectrometer axis, so the orbit is exactly
  concentric with the scale in every browser. Travel is clamped to ±60° with end stops on
  the track, keeping the whole assembly inside the diagram. The arm can be locked; while
  locked the telescope cannot move. The eyepiece shows the spectral lines drifting past a fixed vertical
  crosswire and turns green when the selected line is centred.
- **Angular scale** — a graduated turntable with 1° ticks, numerals every 30° and a digital
  degree/minute/second readout. A configurable **vernier zero offset** shifts the raw scale
  reading so that the instrument behaves like a real spectrometer whose zero is not at the
  central maximum.
- **Spectrum** — the central maximum and the four mercury lines (violet, green, yellow,
  red) are drawn on both sides of the central beam at angles computed from the grating
  equation. First and second order can be selected; an order that has no real solution is
  never drawn and is reported as "no physical order".

### Guided experiment

The stage bar walks through nine stages: introduction, apparatus setup, observing the
spectrum, the left reading, the right reading, the diffraction angle, the wavelength, the
comparison with the standard value, and the completed result. The lab guide always states
the next action and offers a button for it. Measurements cannot be skipped: a reading needs
the lamp on, the grating mounted, the collimator aligned, the telescope locked, and the
selected spectral line centred on the crosswire.

Free-observation mode lets students explore the spectrum and record readings in any order.

### Physics

The grating element is computed, never hard-coded:

```
d = 2.54 / 15000 cm = 1.693333 × 10⁻⁴ cm = 1.693333 × 10⁻⁶ m ≈ 16933.33 Å
```

All internal calculations use SI units. Angles are derived from

```
d sin θ = n λ   →   θ = arcsin(n λ / d)
```

and a tilted grating uses the general form `d(sin i + sin θ) = n λ`, which produces the
asymmetric positions seen on either side of the central maximum. The measured wavelength
comes from the two-side method:

```
2θ = |θ₂ − θ₁| (wrapped across 0°/360°)    θ = 2θ / 2
λ_exp = d sin θ / n
% deviation = ((λ_exp − λ_std) / λ_std) × 100
```

Reference wavelengths from the manual: violet 4387 Å, green 5460 Å, yellow 5790 Å,
red 6390 Å. They can be edited in the results panel; every derived value recalculates.

The simulated readings are the actual telescope angles, so a well-aligned instrument gives
deviations of a few hundredths of a percent while a tilted grating, a wide slit or an
off-centre crosswire produces visibly larger deviations. Nothing is forced to match the
reference values.

### Observation tables, journal and exports

- **Table A** lists serial number, colour, left reading, right reading, separation and
  diffraction angle. Readings can be edited as text in degrees/minutes/seconds; manual
  entries are tagged `manual`, simulated readings are tagged `measured`.
- **Table B** lists sin θ, experimental wavelength, standard wavelength, signed deviation
  and absolute deviation. Every cell recalculates when any reading changes.
- **Worked calculation** shows the five steps for the selected colour with full precision.
- **λ against sin θ** graph plots the measurements against the theoretical line; the
  best-fit gradient gives an independent estimate of the grating element.
- **Lab journal** generates the aim, apparatus, formula, observations, calculations, result
  and a conclusion derived from the actual deviations.
- **CSV export** downloads both tables, the parameters and the conclusion. **Print Lab
  Record** opens a print stylesheet that produces a neat practical-journal page.
- Progress is saved in `localStorage`; **Clear saved data** removes it.

### Notebook data mode

The **Notebook data** tab contains the handwritten readings transcribed from the manual:

| Colour | Left     | Right    |
| ------ | -------- | -------- |
| Violet | 346° 12′ | 16° 14′  |
| Green  | 350° 00′ | 27° 37′  |
| Yellow | 351° 03′ | 31° 02′  |
| Red    | 355° 15′ | 39° 35′  |

They are recomputed from the raw readings (never from precomputed answers), can be edited
row by row, cleared, restored, or replaced by pasting `Colour, left, right` lines. This data
is kept separately from the live experiment and is labelled as imported, not simulated.

## The Simple Harmonic Motion laboratory

Choose Manual, Oscillate or Pulse; choose a fixed, loose or open right end; set amplitude,
frequency, damping, tension and playback speed; then Play, Pause, Step or Reset. In Pulse
mode use **Send pulse**; in Manual mode use the driver slider or drag the handle on the
canvas. The ruler, stopwatch and reference guides can be toggled.

The string is 1.00 m long in model space. A point at distance x repeats the source motion
delayed by x/v with v = 1.20 √(T / 1.50) m/s and an attenuation exp(−γ · travel time).
Fixed ends add an inverted delayed copy of the source, loose ends add an upright copy, and
no end adds no reflection. The display scale is chosen to fit the maximum amplitude.

## Project layout

```
index.html                    shell, both laboratories, theory, viva, journal, print target
src/styles.css                dark design system, responsive layout, print stylesheet
src/lab-grating.js            diffraction grating state, interactions, tables, exports
src/physics/grating.js        pure grating physics, units, DMS parsing/formatting
src/simulation/grating-view.js SVG spectrometer renderer and pointer rotation
src/grating-content.js        stage copy, lab guide text, viva questions
src/app.js                    SHM controls, animation loop, state synchronisation
src/physics/shm.js            pure string/wave model
src/simulation/renderer.js    Canvas rendering for the SHM simulation
src/content.js                SHM teaching copy
scripts/serve.mjs             static server (0.0.0.0, PORT aware)
scripts/build.mjs             copies the static site into dist/
scripts/lint.mjs              syntax, module, id, accessibility and asset checks
tests/grating.test.mjs        grating physics and unit tests
tests/physics.test.mjs        SHM model tests
assets/favicon.svg            site icon
```

## Checks

```bash
npm run lint    # JS syntax, module imports, unique ids, labels, ARIA, assets, CSS balance
npm test        # grating physics + SHM tests with Node's built-in runner
npm run build   # copy the deployable files to dist/
npm run check   # all of the above
```

## Accessibility and behaviour notes

- The apparatus is keyboard operable: focus the spectrometer and use ← / → (Shift for fine
  steps), `L` to lock, `0` to return to the central maximum.
- Every control has a label; live regions announce guide changes, recordings and errors.
- Tabs support arrow-key navigation and expose `aria-selected`, `role="tabpanel"` and hidden
  inactive panels.
- High-contrast mode, reduced-motion support and a responsive layout down to narrow phones
  are provided. A print stylesheet renders only the practical record.
- No external requests, no analytics, no accounts.
