/**
 * Pure SHM wave model. No DOM, timers, or rendering code lives here.
 *
 * The model uses a prescribed source at x = 0 and delayed copies of its
 * displacement history to build an incident wave and optional boundary
 * reflection. Each particle keeps a fixed horizontal position; only its
 * vertical displacement changes.
 */

export const STRING_LENGTH = 1.0; // m, model space
export const REFERENCE_TENSION = 1.5; // N, model units
export const REFERENCE_SPEED = 1.2; // m/s at reference tension
export const FIXED_DT = 1 / 120; // s of simulated time
export const MAX_AMPLITUDE = 0.03; // m
export const HISTORY_SIZE = 1024; // ~8.5 s of source history

export const MODES = Object.freeze([
  { value: "manual", label: "Manual" },
  { value: "oscillate", label: "Oscillate" },
  { value: "pulse", label: "Pulse" },
]);

export const ENDS = Object.freeze([
  { value: "fixed", label: "Fixed End", behavior: "inverted reflection" },
  { value: "loose", label: "Loose End", behavior: "upright reflection" },
  { value: "noEnd", label: "No End", behavior: "exits view" },
]);

export const CONTROL_RANGES = Object.freeze({
  amplitude: Object.freeze({ min: 0.5, max: 3.0, step: 0.1, unit: "cm" }),
  frequency: Object.freeze({ min: 0.2, max: 2.5, step: 0.1, unit: "Hz" }),
  damping: Object.freeze({ min: 0, max: 1.2, step: 0.05, unit: "s⁻¹" }),
  tension: Object.freeze({ min: 0.5, max: 4.0, step: 0.1, unit: "N" }),
  playbackSpeed: Object.freeze({ min: 0.25, max: 2, step: 0.25, unit: "×" }),
});

export const DEFAULT_CONTROLS = Object.freeze({
  mode: "oscillate",
  end: "fixed",
  amplitude: 0.018, // m
  frequency: 1.0, // Hz
  damping: 0.35, // s^-1
  tension: 1.5, // N, model units
  playbackSpeed: 1.0,
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function waveSpeed(tension) {
  const safeTension = Number.isFinite(tension) ? Math.max(0.001, tension) : REFERENCE_TENSION;
  return REFERENCE_SPEED * Math.sqrt(safeTension / REFERENCE_TENSION);
}

export function getPulseDuration(frequency) {
  const safeFrequency = Number.isFinite(frequency) ? clamp(frequency, 0.05, 10) : 1;
  return clamp(0.5 / safeFrequency, 0.14, 1.2);
}

export function attenuation(damping, delay) {
  const gamma = Number.isFinite(damping) ? Math.max(0, damping) : 0;
  const travelTime = Math.max(0, delay);
  return Math.exp(-gamma * travelTime);
}

export function waveMetrics(controls) {
  const speed = waveSpeed(controls.tension);
  const frequency = Number.isFinite(controls.frequency) && controls.frequency > 0
    ? controls.frequency
    : DEFAULT_CONTROLS.frequency;
  const period = 1 / frequency;
  const pulseDuration = getPulseDuration(frequency);
  return {
    speed,
    period,
    wavelength: speed * period,
    pulseDuration,
    pulseWidth: speed * pulseDuration,
  };
}

export function clampControlValue(name, value) {
  const range = CONTROL_RANGES[name];
  const numeric = Number(value);
  if (!range || !Number.isFinite(numeric)) {
    return DEFAULT_CONTROLS[name];
  }
  return clamp(numeric, range.min, range.max);
}

export function createSimulationState() {
  return {
    time: 0,
    stepIndex: 0,
    phase: 0,
    manualSource: 0,
    manualTarget: 0,
    pulseTriggerTime: Number.NEGATIVE_INFINITY,
    lastSource: 0,
    history: new Float64Array(HISTORY_SIZE),
  };
}

function slotFor(index, length) {
  return ((index % length) + length) % length;
}

function writeSample(state, index, value) {
  if (index < 0) return;
  state.history[slotFor(index, state.history.length)] = value;
}

function readSample(state, index) {
  if (index < 0 || index > state.stepIndex) return 0;
  const oldestKept = state.stepIndex - state.history.length + 1;
  if (index < oldestKept) return 0;
  return state.history[slotFor(index, state.history.length)];
}

/** Source displacement at an arbitrary simulated time, interpolated from history. */
export function sampleSourceHistory(state, time) {
  if (!Number.isFinite(time) || time < 0) return 0;
  const position = time / FIXED_DT;
  const firstIndex = Math.floor(position);
  const fraction = position - firstIndex;
  const first = readSample(state, firstIndex);
  const second = readSample(state, firstIndex + 1);
  return first + (second - first) * fraction;
}

export function resetSimulation(state, controls = DEFAULT_CONTROLS) {
  state.time = 0;
  state.stepIndex = 0;
  state.phase = 0;
  state.manualSource = 0;
  state.manualTarget = 0;
  state.lastSource = 0;
  state.pulseTriggerTime = controls.mode === "pulse" ? 0 : Number.NEGATIVE_INFINITY;
  state.history.fill(0);
  return state;
}

/** Arm a single smooth half-cycle at the current simulated time. */
export function triggerPulse(state) {
  state.pulseTriggerTime = state.time;
  state.manualTarget = 0;
  state.manualSource = 0;
  state.lastSource = 0;
  writeSample(state, state.stepIndex, 0);
  return state;
}

/**
 * Set the manual driver target in metres. When `immediate` is true, also
 * apply the value to the current time sample so a paused display responds.
 */
export function setManualDriver(state, value, controls, immediate = false) {
  const numeric = Number.isFinite(value) ? value : 0;
  const limit = Math.max(0, controls.amplitude || DEFAULT_CONTROLS.amplitude);
  state.manualTarget = clamp(numeric, -limit, limit);
  if (immediate) {
    state.manualSource = state.manualTarget;
    state.lastSource = state.manualTarget;
    writeSample(state, state.stepIndex, state.manualTarget);
  }
  return state.manualTarget;
}

function sourceAtCurrentStep(state, controls) {
  if (controls.mode === "manual") {
    // A short time constant smooths pointer/slider input without hiding it.
    const blend = 1 - Math.exp(-24 * FIXED_DT);
    state.manualSource += (state.manualTarget - state.manualSource) * blend;
    return state.manualSource;
  }

  if (controls.mode === "pulse") {
    const elapsed = state.time - state.pulseTriggerTime;
    const duration = getPulseDuration(controls.frequency);
    if (elapsed < 0 || elapsed > duration) return 0;
    return controls.amplitude * Math.sin(Math.PI * (elapsed / duration));
  }

  return controls.amplitude * Math.sin(state.phase);
}

/** Advance exactly one fixed simulation step. */
export function advanceFixedStep(state, controls) {
  state.stepIndex += 1;
  state.time = state.stepIndex * FIXED_DT;

  state.phase += 2 * Math.PI * controls.frequency * FIXED_DT;
  if (state.phase >= 2 * Math.PI) state.phase -= 2 * Math.PI;

  const source = sourceAtCurrentStep(state, controls);
  writeSample(state, state.stepIndex, source);
  state.lastSource = source;
  return state;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Vertical displacement in metres at normalized position 0..1. */
export function displacementAt(normalizedX, state, controls) {
  const u = clamp(normalizedX, 0, 1);
  const x = u * STRING_LENGTH;
  const speed = waveSpeed(controls.tension);
  const forwardDelay = x / speed;

  let displacement = attenuation(controls.damping, forwardDelay)
    * sampleSourceHistory(state, state.time - forwardDelay);

  if (controls.end !== "noEnd") {
    const reflectedDelay = (2 * STRING_LENGTH - x) / speed;
    const reflected = attenuation(controls.damping, reflectedDelay)
      * sampleSourceHistory(state, state.time - reflectedDelay);
    const sign = controls.end === "fixed" ? -1 : 1;
    // Keep the driven left endpoint prescribed rather than overwriting it.
    const reflectionFade = smoothstep(0, 0.14, u);
    displacement += sign * reflectionFade * reflected;
  }

  return displacement;
}

export function sourceDisplacement(state, controls) {
  return displacementAt(0, state, controls);
}

export function boundaryDisplacement(state, controls) {
  return displacementAt(1, state, controls);
}
