import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONTROLS,
  FIXED_DT,
  advanceFixedStep,
  attenuation,
  createSimulationState,
  displacementAt,
  getPulseDuration,
  resetSimulation,
  setManualDriver,
  waveMetrics,
  waveSpeed,
} from "../src/physics/shm.js";

function controlsWith(overrides = {}) {
  return { ...DEFAULT_CONTROLS, ...overrides };
}

function advanceFor(state, controls, seconds) {
  const steps = Math.round(seconds / FIXED_DT);
  for (let index = 0; index < steps; index += 1) {
    advanceFixedStep(state, controls);
  }
}

test("wave speed follows v proportional to sqrt(tension)", () => {
  const reference = waveSpeed(1.5);
  const doubledTension = waveSpeed(3.0);
  assert.ok(Math.abs(reference - 1.2) < 1e-12);
  assert.ok(Math.abs(doubledTension / reference - Math.sqrt(2)) < 1e-12);
  assert.ok(waveSpeed(4.0) > waveSpeed(0.5));
});

test("wave metrics keep period, wavelength, and pulse width consistent", () => {
  const metrics = waveMetrics(controlsWith({ frequency: 2, tension: 1.5 }));
  assert.equal(metrics.period, 0.5);
  assert.ok(Math.abs(metrics.wavelength - 0.6) < 1e-12);
  assert.ok(getPulseDuration(2) < getPulseDuration(0.5));
  assert.ok(metrics.pulseWidth > 0);
  assert.equal(attenuation(0, 2), 1);
  assert.ok(attenuation(1, 2) < attenuation(0.5, 2));
});

test("oscillate mode propagates source motion with a phase delay", () => {
  const controls = controlsWith({
    mode: "oscillate",
    end: "noEnd",
    damping: 0,
    tension: 1.5,
    frequency: 1,
    amplitude: 0.018,
  });
  const state = createSimulationState();

  advanceFor(state, controls, 0.25);
  assert.ok(Math.abs(displacementAt(0, state, controls)) > 1e-4);
  assert.equal(displacementAt(0.9, state, controls), 0);

  advanceFor(state, controls, 0.6);
  assert.ok(displacementAt(0.9, state, controls) > 0);
});

test("higher tension lets the same disturbance reach farther in the same time", () => {
  const base = {
    mode: "oscillate",
    end: "noEnd",
    damping: 0,
    frequency: 1,
    amplitude: 0.018,
  };
  const slow = createSimulationState();
  const fast = createSimulationState();
  const slowControls = controlsWith({ ...base, tension: 0.5 });
  const fastControls = controlsWith({ ...base, tension: 4.0 });

  advanceFor(slow, slowControls, 0.3);
  advanceFor(fast, fastControls, 0.3);

  assert.equal(displacementAt(0.4, slow, slowControls), 0);
  assert.ok(displacementAt(0.4, fast, fastControls) > 0);
});

test("fixed end is a node during continuous oscillation", () => {
  const controls = controlsWith({ mode: "oscillate", end: "fixed", damping: 0 });
  const state = createSimulationState();
  advanceFor(state, controls, 1.5);
  assert.ok(Math.abs(displacementAt(1, state, controls)) < 1e-12);
});

test("a pulse inverts at a fixed end, stays upright at a loose end, and exits at no end", () => {
  function reflectedValue(end) {
    const controls = controlsWith({
      mode: "pulse",
      end,
      damping: 0,
      tension: 1.5,
      frequency: 1,
      amplitude: 0.018,
    });
    const state = createSimulationState();
    resetSimulation(state, controls);
    advanceFor(state, controls, 1.3);
    return displacementAt(0.9, state, controls);
  }

  const fixed = reflectedValue("fixed");
  const loose = reflectedValue("loose");
  const open = reflectedValue("noEnd");

  assert.ok(fixed < -1e-4, `expected inverted reflection, got ${fixed}`);
  assert.ok(loose > 1e-4, `expected upright reflection, got ${loose}`);
  assert.equal(open, 0);
  assert.ok(Math.abs(loose + fixed) < 1e-12);
});

test("damping attenuates by exp(-gamma * travel time)", () => {
  function pulseValue(damping) {
    const controls = controlsWith({
      mode: "pulse",
      end: "noEnd",
      damping,
      tension: 1.5,
      frequency: 1,
      amplitude: 0.018,
    });
    const state = createSimulationState();
    resetSimulation(state, controls);
    advanceFor(state, controls, 0.85);
    return displacementAt(0.8, state, controls);
  }

  const undamped = pulseValue(0);
  const damped = pulseValue(1.0);
  const expected = undamped * Math.exp(-1.0 * (0.8 / 1.2));

  assert.ok(undamped > 0);
  assert.ok(damped > 0);
  assert.ok(damped < undamped);
  assert.ok(Math.abs(damped - expected) < 1e-6);
});

test("manual driver motion is recorded and travels without moving particles horizontally", () => {
  const controls = controlsWith({
    mode: "manual",
    end: "noEnd",
    damping: 0,
    tension: 1.5,
    amplitude: 0.018,
  });
  const state = createSimulationState();
  setManualDriver(state, 0.015, controls, true);

  advanceFor(state, controls, 0.25);
  assert.ok(displacementAt(0, state, controls) > 0.01);
  assert.equal(displacementAt(0.9, state, controls), 0);

  advanceFor(state, controls, 0.6);
  assert.ok(displacementAt(0.9, state, controls) > 0.01);
});

test("a paused manual driver position is visible at the source", () => {
  const controls = controlsWith({ mode: "manual", end: "noEnd", damping: 0 });
  const state = createSimulationState();
  resetSimulation(state, controls);
  setManualDriver(state, 0.01, controls, true);
  assert.ok(Math.abs(displacementAt(0, state, controls) - 0.01) < 1e-12);
});

test("reset clears elapsed time and source history", () => {
  const controls = controlsWith({ mode: "oscillate", end: "noEnd", damping: 0 });
  const state = createSimulationState();
  advanceFor(state, controls, 1);
  assert.ok(state.time > 0);
  assert.notEqual(displacementAt(0.5, state, controls), 0);

  resetSimulation(state, controls);
  assert.equal(state.time, 0);
  assert.equal(state.stepIndex, 0);
  assert.equal(displacementAt(0.5, state, controls), 0);
  assert.equal(state.lastSource, 0);
});
