import {
  DEFAULT_CONTROLS,
  FIXED_DT,
  STRING_LENGTH,
  advanceFixedStep,
  clamp,
  clampControlValue,
  createSimulationState,
  resetSimulation,
  setManualDriver,
  sourceDisplacement,
  triggerPulse,
  waveMetrics,
} from "./physics/shm.js";
import { WaveCanvas } from "./simulation/renderer.js";
import { END_COPY, MODE_COPY } from "./content.js";

const STEP_ADVANCES = 4; // 4 / 120 s = 1/30 s
const MAX_FRAME_DELTA = 0.05;
const MAX_FRAME_STEPS = 24;
const READOUT_INTERVAL_MS = 100;

const controls = { ...DEFAULT_CONTROLS };
const view = { ruler: true, stopwatch: true, referenceLine: true };
let state = createSimulationState();
let el = null;
let renderer = null;
let isPlaying = false;
let loopRafId = null;
let renderRafId = null;
let lastFrameTime = 0;
let lastUiUpdate = 0;
let accumulator = 0;
let draggingDriver = false;

function query(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function collectElements() {
  return {
    canvas: query("#wave-canvas"),
    canvasError: query("#canvas-error"),
    status: query("#simulation-status"),
    motionNote: query("#motion-note"),
    modeInputs: Array.from(document.querySelectorAll('input[name="mode"]')),
    endInputs: Array.from(document.querySelectorAll('input[name="end"]')),

    playButton: query("#play-button"),
    pauseButton: query("#pause-button"),
    stepButton: query("#step-button"),
    resetButton: query("#reset-button"),
    pulseButton: query("#pulse-button"),
    playState: query("#play-state"),
    transportHint: query("#transport-hint"),

    manualControls: query("#manual-controls"),
    manualPosition: query("#manual-position"),
    manualPositionValue: query("#manual-position-value"),
    centerDriver: query("#center-driver"),

    amplitude: query("#amplitude"),
    amplitudeValue: query("#amplitude-value"),
    frequency: query("#frequency"),
    frequencyValue: query("#frequency-value"),
    frequencyHelp: query("#frequency-help"),
    damping: query("#damping"),
    dampingValue: query("#damping-value"),
    tension: query("#tension"),
    tensionValue: query("#tension-value"),
    playbackSpeed: query("#playback-speed"),
    playbackSpeedValue: query("#playback-speed-value"),

    rulerToggle: query("#show-ruler"),
    stopwatchToggle: query("#show-stopwatch"),
    referenceToggle: query("#show-reference"),

    readoutTime: query("#readout-time"),
    readoutDriver: query("#readout-driver"),
    readoutAmplitude: query("#readout-amplitude"),
    readoutFrequency: query("#readout-frequency"),
    readoutPeriod: query("#readout-period"),
    readoutSpeed: query("#readout-speed"),
    spatialLabel: query("#spatial-label"),
    spatialValue: query("#spatial-value"),
    readoutBoundary: query("#readout-boundary"),

    modeExplanationHeading: query("#mode-explanation-heading"),
    modeExplanation: query("#mode-explanation"),
    endExplanationHeading: query("#end-explanation-heading"),
    endExplanation: query("#end-explanation"),
    modelSummary: query("#model-summary"),
  };
}

function formatSigned(value, digits) {
  const threshold = 0.5 * 10 ** -digits;
  const safe = Math.abs(value) < threshold ? 0 : value;
  return `${safe >= 0 ? "+" : ""}${safe.toFixed(digits)}`;
}

function boundaryText(end) {
  if (end === "fixed") return "Fixed · inverted";
  if (end === "loose") return "Loose · upright";
  return "No end · exits";
}

function announce(message) {
  if (!el) return;
  el.status.textContent = "";
  window.setTimeout(() => {
    if (el) el.status.textContent = message;
  }, 0);
}

function renderFrame() {
  if (!renderer) return;
  renderer.render({ state, controls, view });
}

function requestRender() {
  if (!renderer || loopRafId !== null || renderRafId !== null) return;
  renderRafId = window.requestAnimationFrame(() => {
    renderRafId = null;
    if (!isPlaying) renderFrame();
  });
}

function tick(now) {
  if (!isPlaying) {
    loopRafId = null;
    return;
  }
  loopRafId = window.requestAnimationFrame(tick);

  const delta = Math.min(Math.max((now - lastFrameTime) / 1000, 0), MAX_FRAME_DELTA);
  lastFrameTime = now;
  accumulator += delta * controls.playbackSpeed;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_FRAME_STEPS) {
    advanceFixedStep(state, controls);
    accumulator -= FIXED_DT;
    steps += 1;
  }
  if (steps === MAX_FRAME_STEPS && accumulator >= FIXED_DT) accumulator = 0;

  renderFrame();
  if (now - lastUiUpdate >= READOUT_INTERVAL_MS) {
    updateReadouts();
    lastUiUpdate = now;
  }
}

function startLoop() {
  if (loopRafId !== null) return;
  if (renderRafId !== null) {
    window.cancelAnimationFrame(renderRafId);
    renderRafId = null;
  }
  lastFrameTime = performance.now();
  lastUiUpdate = 0;
  accumulator = 0;
  loopRafId = window.requestAnimationFrame(tick);
}

function stopLoop() {
  if (loopRafId !== null) window.cancelAnimationFrame(loopRafId);
  loopRafId = null;
  accumulator = 0;
}

function setPlaying(value, shouldAnnounce = true) {
  if (isPlaying === value) return;
  isPlaying = value;
  if (value) {
    startLoop();
  } else {
    stopLoop();
    requestRender();
  }
  updateTransportUI();
  if (shouldAnnounce) announce(value ? "Playback started." : "Playback paused.");
}

function syncManualSliderBounds() {
  const maxCm = controls.amplitude * 100;
  el.manualPosition.min = (-maxCm).toFixed(1);
  el.manualPosition.max = maxCm.toFixed(1);
  const current = Number(el.manualPosition.value);
  const bounded = clamp(current, -maxCm, maxCm);
  el.manualPosition.value = bounded.toFixed(1);
  return bounded / 100;
}

function updateManualOutput() {
  const cm = Number(el.manualPosition.value);
  el.manualPositionValue.textContent = `${formatSigned(cm, 1)} cm`;
}

function updateControlOutputs() {
  el.amplitudeValue.textContent = `${(controls.amplitude * 100).toFixed(1)} cm`;
  el.frequencyValue.textContent = `${controls.frequency.toFixed(1)} Hz`;
  el.dampingValue.textContent = `${controls.damping.toFixed(2)} s⁻¹`;
  el.tensionValue.textContent = `${controls.tension.toFixed(1)} N`;
  el.playbackSpeedValue.textContent = `${controls.playbackSpeed.toFixed(2)}×`;
  updateManualOutput();
}

function updateReadouts() {
  const metrics = waveMetrics(controls);
  const driverCm = sourceDisplacement(state, controls) * 100;

  el.readoutTime.textContent = `${state.time.toFixed(2)} s`;
  el.readoutDriver.textContent = `${formatSigned(driverCm, 2)} cm`;
  el.readoutAmplitude.textContent = `${(controls.amplitude * 100).toFixed(1)} cm`;
  el.readoutFrequency.textContent = controls.mode === "manual"
    ? "—"
    : `${controls.frequency.toFixed(1)} Hz`;
  el.readoutPeriod.textContent = controls.mode === "manual"
    ? "—"
    : `${metrics.period.toFixed(2)} s`;
  el.readoutSpeed.textContent = `${metrics.speed.toFixed(2)} m/s`;

  if (controls.mode === "oscillate") {
    el.spatialLabel.textContent = "Wavelength λ";
    el.spatialValue.textContent = `${metrics.wavelength.toFixed(2)} m`;
  } else if (controls.mode === "pulse") {
    el.spatialLabel.textContent = "Pulse width";
    el.spatialValue.textContent = `${metrics.pulseWidth.toFixed(2)} m`;
  } else {
    el.spatialLabel.textContent = "Wavefront";
    el.spatialValue.textContent = `${Math.min(STRING_LENGTH, metrics.speed * state.time).toFixed(2)} m`;
  }

  el.readoutBoundary.textContent = boundaryText(controls.end);
}

function updateExplanation() {
  const modeCopy = MODE_COPY[controls.mode];
  const endCopy = END_COPY[controls.end];
  const metrics = waveMetrics(controls);

  el.modeExplanationHeading.textContent = modeCopy.heading;
  el.modeExplanation.textContent = modeCopy.observe;
  el.endExplanationHeading.textContent = endCopy.heading;
  el.endExplanation.textContent = endCopy.observe;
  el.modelSummary.textContent =
    `v = ${metrics.speed.toFixed(2)} m/s · γ = ${controls.damping.toFixed(2)} s⁻¹ · `
    + `${modeCopy.controlNote} Boundary: ${endCopy.short}.`;
}

function updateModeUI() {
  const isManual = controls.mode === "manual";
  const isPulse = controls.mode === "pulse";

  el.manualControls.hidden = !isManual;
  el.pulseButton.hidden = !isPulse;
  el.canvas.classList.toggle("is-draggable", isManual);
  if (!isManual) el.canvas.style.cursor = "default";

  const frequencyBlock = el.frequency.closest(".control-block");
  frequencyBlock.classList.toggle("is-disabled", isManual);
  el.frequency.disabled = isManual;
  el.frequencyHelp.textContent = isManual
    ? "Frequency is not used in Manual mode."
    : isPulse
      ? "Higher frequency makes a shorter pulse (half an equivalent period)."
      : "Sets the oscillator period T = 1/f and wavelength λ = v/f.";
}

function updateTransportUI() {
  el.playButton.disabled = isPlaying;
  el.pauseButton.disabled = !isPlaying;
  el.stepButton.disabled = isPlaying;
  el.playState.textContent = isPlaying ? "Playing" : "Paused";

  if (isPlaying) {
    el.transportHint.textContent = "Simulation time is advancing.";
  } else if (controls.mode === "pulse") {
    el.transportHint.textContent = "Press Play to continue, or Send pulse to launch another pulse.";
  } else if (controls.mode === "manual") {
    el.transportHint.textContent = "Move the driver, then Play or Step.";
  } else {
    el.transportHint.textContent = "Press Play to start the continuous drive.";
  }
}

function updateAll() {
  updateModeUI();
  updateControlOutputs();
  updateReadouts();
  updateExplanation();
  updateTransportUI();
}

function readControlsFromDom() {
  const selectedMode = el.modeInputs.find((input) => input.checked);
  const selectedEnd = el.endInputs.find((input) => input.checked);
  if (selectedMode) controls.mode = selectedMode.value;
  if (selectedEnd) controls.end = selectedEnd.value;

  controls.amplitude = clampControlValue("amplitude", Number(el.amplitude.value)) / 100;
  controls.frequency = clampControlValue("frequency", Number(el.frequency.value));
  controls.damping = clampControlValue("damping", Number(el.damping.value));
  controls.tension = clampControlValue("tension", Number(el.tension.value));
  controls.playbackSpeed = clampControlValue("playbackSpeed", Number(el.playbackSpeed.value));

  view.ruler = el.rulerToggle.checked;
  view.stopwatch = el.stopwatchToggle.checked;
  view.referenceLine = el.referenceToggle.checked;
}

function restartForConfiguration(reason) {
  const wasPlaying = isPlaying;
  resetSimulation(state, controls);
  if (controls.mode === "manual") {
    const manualValue = syncManualSliderBounds();
    setManualDriver(state, manualValue, controls, true);
  }
  accumulator = 0;
  lastFrameTime = performance.now();
  updateAll();
  requestRender();
  announce(
    `${reason} changed. Trace restarted at 0 seconds${wasPlaying ? " and playback continues" : ""}.`,
  );
}

function resetAll() {
  setPlaying(false, false);
  resetSimulation(state, controls);
  if (controls.mode === "manual") {
    const manualValue = syncManualSliderBounds();
    setManualDriver(state, manualValue, controls, true);
  }
  accumulator = 0;
  updateAll();
  requestRender();
  announce("Simulation reset and paused.");
}

function stepOnce() {
  if (isPlaying || !renderer) return;
  for (let index = 0; index < STEP_ADVANCES; index += 1) {
    advanceFixedStep(state, controls);
  }
  updateReadouts();
  requestRender();
  announce(`Stepped ${(STEP_ADVANCES * FIXED_DT).toFixed(3)} seconds of simulated time.`);
}

function sendPulse() {
  if (controls.mode !== "pulse") return;
  triggerPulse(state);
  if (!isPlaying) setPlaying(true, false);
  updateAll();
  requestRender();
  announce("Pulse sent; playback started.");
}

function updateDriverFromPointer(event) {
  if (!renderer) return;
  const value = renderer.pointerToDisplacement(event.clientY, controls);
  el.manualPosition.value = (value * 100).toFixed(1);
  setManualDriver(state, value, controls, !isPlaying);
  updateManualOutput();
  updateReadouts();
  requestRender();
}

function bindEvents() {
  for (const input of el.modeInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      controls.mode = input.value;
      restartForConfiguration("Mode");
    });
  }

  for (const input of el.endInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      controls.end = input.value;
      restartForConfiguration("End condition");
    });
  }

  el.amplitude.addEventListener("input", () => {
    controls.amplitude = clampControlValue("amplitude", Number(el.amplitude.value)) / 100;
    const manualValue = syncManualSliderBounds();
    setManualDriver(state, manualValue, controls, !isPlaying);
    updateControlOutputs();
    updateReadouts();
    updateExplanation();
    requestRender();
  });

  el.frequency.addEventListener("input", () => {
    controls.frequency = clampControlValue("frequency", Number(el.frequency.value));
    updateControlOutputs();
    updateReadouts();
    updateExplanation();
    requestRender();
  });

  el.damping.addEventListener("input", () => {
    controls.damping = clampControlValue("damping", Number(el.damping.value));
    updateControlOutputs();
    updateExplanation();
    requestRender();
  });

  el.tension.addEventListener("input", () => {
    controls.tension = clampControlValue("tension", Number(el.tension.value));
    updateControlOutputs();
    updateReadouts();
    updateExplanation();
    requestRender();
  });

  el.playbackSpeed.addEventListener("input", () => {
    controls.playbackSpeed = clampControlValue("playbackSpeed", Number(el.playbackSpeed.value));
    updateControlOutputs();
    requestRender();
  });

  el.manualPosition.addEventListener("input", () => {
    const value = Number(el.manualPosition.value) / 100;
    setManualDriver(state, value, controls, !isPlaying);
    updateManualOutput();
    updateReadouts();
    requestRender();
  });

  el.centerDriver.addEventListener("click", () => {
    el.manualPosition.value = "0.0";
    setManualDriver(state, 0, controls, true);
    updateManualOutput();
    updateReadouts();
    requestRender();
    announce("Driver centered.");
  });

  el.rulerToggle.addEventListener("change", () => {
    view.ruler = el.rulerToggle.checked;
    requestRender();
    announce(`Ruler ${view.ruler ? "shown" : "hidden"}.`);
  });

  el.stopwatchToggle.addEventListener("change", () => {
    view.stopwatch = el.stopwatchToggle.checked;
    requestRender();
    announce(`Stopwatch ${view.stopwatch ? "shown" : "hidden"}.`);
  });

  el.referenceToggle.addEventListener("change", () => {
    view.referenceLine = el.referenceToggle.checked;
    requestRender();
    announce(`Reference line ${view.referenceLine ? "shown" : "hidden"}.`);
  });

  el.playButton.addEventListener("click", () => setPlaying(true));
  el.pauseButton.addEventListener("click", () => setPlaying(false));
  el.stepButton.addEventListener("click", stepOnce);
  el.resetButton.addEventListener("click", resetAll);
  el.pulseButton.addEventListener("click", sendPulse);

  el.canvas.addEventListener("pointerdown", (event) => {
    if (controls.mode !== "manual" || !renderer) return;
    if (!renderer.isPointerInDriverZone(event.clientX, event.clientY)) return;
    draggingDriver = true;
    if (el.canvas.setPointerCapture) el.canvas.setPointerCapture(event.pointerId);
    el.canvas.style.cursor = "grabbing";
    updateDriverFromPointer(event);
    event.preventDefault();
  });

  el.canvas.addEventListener("pointermove", (event) => {
    if (!renderer) return;
    if (draggingDriver) {
      updateDriverFromPointer(event);
      event.preventDefault();
      return;
    }
    el.canvas.style.cursor = controls.mode === "manual"
      && renderer.isPointerInDriverZone(event.clientX, event.clientY)
      ? "grab"
      : "default";
  });

  const endDrag = (event) => {
    if (!draggingDriver) return;
    draggingDriver = false;
    if (
      el.canvas.releasePointerCapture
      && typeof event.pointerId === "number"
      && el.canvas.hasPointerCapture
      && el.canvas.hasPointerCapture(event.pointerId)
    ) {
      el.canvas.releasePointerCapture(event.pointerId);
    }
    el.canvas.style.cursor = "default";
  };
  el.canvas.addEventListener("pointerup", endDrag);
  el.canvas.addEventListener("pointercancel", endDrag);
  el.canvas.addEventListener("lostpointercapture", endDrag);

  document.addEventListener("visibilitychange", () => {
    lastFrameTime = performance.now();
    accumulator = 0;
  });
}

function setupReducedMotion() {
  const motionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  if (!motionQuery) return;

  const applyPreference = () => {
    const reduce = motionQuery.matches;
    el.motionNote.hidden = !reduce;
    if (reduce && isPlaying) setPlaying(false);
  };

  applyPreference();
  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", applyPreference);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(applyPreference);
  }
}

function showFatalError(error) {
  console.error(error);
  const errorBox = document.getElementById("canvas-error");
  const status = document.getElementById("simulation-status");
  if (errorBox) errorBox.hidden = false;
  if (status) status.textContent = "Simulation initialization failed.";
  for (const control of document.querySelectorAll(".sim-panel button, .sim-panel input")) {
    control.disabled = true;
  }
}

function initialize() {
  try {
    el = collectElements();
    renderer = new WaveCanvas(el.canvas, { onResize: () => requestRender() });
    readControlsFromDom();
    syncManualSliderBounds();
    bindEvents();
    setupReducedMotion();
    updateAll();
    requestRender();
  } catch (error) {
    showFatalError(error);
  }
}

initialize();
