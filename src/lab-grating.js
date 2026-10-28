/**
 * Diffraction grating virtual laboratory.
 * Guided measurement workflow, instrument controls, observation tables,
 * notebook data mode, lab journal, exports and local persistence.
 */

import {
  DEFAULT_REFERENCE_ANGSTROM,
  GRATING_ELEMENT_ANGSTROM,
  GRATING_ELEMENT_M,
  LINE_IDS,
  LINE_BY_ID,
  NOTEBOOK_READINGS,
  SPECTRAL_LINES,
  apparentAngles,
  clamp,
  fitGratingElement,
  formatDMS,
  formatDMSAscii,
  formatWavelength,
  gratingElement,
  isFiniteNumber,
  maxOrder,
  normalizeDegrees,
  parseAngle,
  percentageDeviation,
  roundToArcSecond,
  solveFromReadings,
} from "./physics/grating.js";
import { GratingApparatus } from "./simulation/grating-view.js";
import {
  clampTelescope,
  lineTelescopeAngle,
} from "./simulation/telescope-geometry.js";
import {
  STAGES,
  STAGE_BY_ID,
  VIVA_NUMERICALS,
  VIVA_QUESTIONS,
  guideFor,
} from "./grating-content.js";

const STORAGE_KEY = "pccoe.grating.v1";
const SETUP_TILT_LIMIT = 0.5;
const ARC_MINUTE = 1 / 60;
const ARC_SECOND = 1 / 3600;
const GRATING = gratingElement();
const NUMERICAL_ANSWERS = {
  n1: { value: 20000, tolerance: 150, unit: "Å" },
  n2: { value: 5460, tolerance: 60, unit: "Å" },
  n3: { value: 2, tolerance: 0.01, unit: "" },
};

const DEFAULT_STATE = Object.freeze({
  version: 1,
  stage: 1,
  mode: "guided",
  order: 1,
  colour: "violet",
  side: "left",
  lampOn: false,
  collimatorAligned: false,
  gratingMounted: false,
  slitWidth: 0.2,
  tilt: 1.8,
  zeroOffset: 0,
  telescope: 0,
  locked: false,
  readings: {},
  reference: { ...DEFAULT_REFERENCE_ANGSTROM },
  unit: "angstrom",
  showSeconds: true,
  showLeft: true,
  showRight: true,
  animation: 1,
  contrast: false,
  history: [],
  notebookRows: NOTEBOOK_READINGS.map((row) => ({ ...row })),
});

let state = createDefaultState();
let apparatus = null;
let saveTimer = null;
let toastTimer = null;
let framePending = null;
const el = {};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function createDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function shortestDelta(fromDeg, toDeg) {
  let delta = (toDeg - fromDeg) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function formatNumber(value, digits) {
  if (!isFiniteNumber(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSignedPercent(value) {
  if (!isFiniteNumber(value)) return "—";
  const magnitude = Math.abs(value).toFixed(2);
  if (value > 0) return `+${magnitude} %`;
  if (value < 0) return `−${magnitude} %`;
  return `0.00 %`;
}

function formatPercentPlain(value) {
  if (!isFiniteNumber(value)) return "—";
  return `${Math.abs(value).toFixed(2)} %`;
}

function formatLength(metres) {
  return formatWavelength(metres, state.unit, state.unit === "metre" ? 3 : 1);
}

function deviationClass(value) {
  if (!isFiniteNumber(value)) return "";
  const magnitude = Math.abs(value);
  if (magnitude <= 1) return "is-good";
  if (magnitude <= 3) return "is-watch";
  return "is-bad";
}

function notify(message) {
  const toast = document.getElementById("lab-toast") || createToast();
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
  if (el.status) {
    el.status.textContent = "";
    window.setTimeout(() => {
      el.status.textContent = message;
    }, 20);
  }
}

function createToast() {
  const toast = document.createElement("div");
  toast.id = "lab-toast";
  toast.className = "lab-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.appendChild(toast);
  return toast;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function saveState() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (el.storageNote) {
        el.storageNote.textContent = "Progress saved in this browser just now.";
      }
    } catch (error) {
      if (el.storageNote) {
        el.storageNote.textContent = "This browser blocked local storage; progress will not be saved.";
      }
    }
  }, 250);
}

function loadState() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return { restored: false, blocked: true };
  }
  if (!raw) return { restored: false, blocked: false };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { restored: false, blocked: false };
    const merged = createDefaultState();
    merged.stage = clamp(Math.round(Number(parsed.stage) || 1), 1, 9);
    merged.mode = parsed.mode === "free" ? "free" : "guided";
    merged.order = parsed.order === 2 ? 2 : 1;
    merged.colour = LINE_BY_ID[parsed.colour] ? parsed.colour : "violet";
    merged.side = parsed.side === "right" ? "right" : "left";
    merged.lampOn = Boolean(parsed.lampOn);
    merged.collimatorAligned = Boolean(parsed.collimatorAligned);
    merged.gratingMounted = Boolean(parsed.gratingMounted);
    merged.slitWidth = clamp(Number(parsed.slitWidth) || 0.2, 0.05, 1);
    merged.tilt = clamp(Number(parsed.tilt) || 0, -3, 3);
    merged.zeroOffset = normalizeDegrees(Number(parsed.zeroOffset) || 0);
    merged.telescope = clampTelescope(Number(parsed.telescope) || 0);
    merged.locked = Boolean(parsed.locked);
    merged.unit = ["angstrom", "nanometre", "metre"].includes(parsed.unit) ? parsed.unit : "angstrom";
    merged.showSeconds = parsed.showSeconds !== false;
    merged.showLeft = parsed.showLeft !== false;
    merged.showRight = parsed.showRight !== false;
    merged.animation = clamp(Number(parsed.animation) || 1, 0.5, 2);
    merged.contrast = Boolean(parsed.contrast);
    merged.reference = { ...DEFAULT_REFERENCE_ANGSTROM };
    if (parsed.reference && typeof parsed.reference === "object") {
      for (const id of LINE_IDS) {
        const value = Number(parsed.reference[id]);
        if (Number.isFinite(value) && value >= 1000 && value <= 20000) merged.reference[id] = value;
      }
    }
    if (parsed.readings && typeof parsed.readings === "object") {
      for (const id of LINE_IDS) {
        const row = parsed.readings[id];
        if (!row || typeof row !== "object") continue;
        const clean = {};
        for (const side of ["left", "right"]) {
          const reading = row[side];
          if (!reading || typeof reading !== "object") continue;
          const value = Number(reading.reading);
          if (!Number.isFinite(value)) continue;
          clean[side] = {
            reading: normalizeDegrees(value),
            telescope: Number(reading.telescope) || 0,
            source: reading.source === "manual" ? "manual" : "simulated",
            order: reading.order === 2 ? 2 : 1,
            tolerance: Number(reading.tolerance) || 0,
          };
        }
        if (clean.left || clean.right) merged.readings[id] = clean;
      }
    }
    merged.history = Array.isArray(parsed.history)
      ? parsed.history
          .filter((entry) => entry && LINE_BY_ID[entry.colour] && (entry.side === "left" || entry.side === "right"))
          .slice(0, 40)
          .map((entry) => ({
            time: Number(entry.time) || Date.now(),
            colour: entry.colour,
            side: entry.side,
            reading: Number(entry.reading) || 0,
            order: entry.order === 2 ? 2 : 1,
          }))
      : [];
    if (Array.isArray(parsed.notebookRows)) {
      merged.notebookRows = parsed.notebookRows
        .filter((row) => row && LINE_BY_ID[row.id] && typeof row.left === "string" && typeof row.right === "string")
        .map((row) => ({ id: row.id, name: LINE_BY_ID[row.id].name, left: row.left, right: row.right }));
    }
    state = merged;
    return { restored: true, blocked: false };
  } catch (error) {
    return { restored: false, blocked: false };
  }
}

/* ------------------------------------------------------------------ */
/* Derived physics                                                     */
/* ------------------------------------------------------------------ */

function slitTolerance() {
  return 1 * ARC_MINUTE + 4.5 * ARC_MINUTE * state.slitWidth;
}

function setupIssues() {
  const issues = [];
  if (!state.lampOn) issues.push("switch on the mercury lamp");
  if (!state.collimatorAligned) issues.push("align the collimator");
  if (!state.gratingMounted) issues.push("mount the grating");
  if (Math.abs(state.tilt) > SETUP_TILT_LIMIT) issues.push("set the grating normal to 0.0°");
  return issues;
}

function setupComplete() {
  return setupIssues().length === 0;
}

function lineFor(colourId, order = state.order) {
  const line = LINE_BY_ID[colourId];
  const wavelengthM = (state.reference[colourId] || line.angstrom) * 1e-10;
  const angles = apparentAngles(wavelengthM, order, state.tilt, GRATING_ELEMENT_M);
  return { id: colourId, name: line.name, color: line.color, wavelengthM, angles };
}

function sideIsVisible(side) {
  return side === "left" ? state.showLeft : state.showRight;
}

function lineAngle(colourId, side) {
  const { angles } = lineFor(colourId);
  const angle = side === "left" ? angles.leftDeg : angles.rightDeg;
  const valid = side === "left" ? angles.leftValid : angles.rightValid;
  return {
    angle,
    valid: valid && Number.isFinite(angle) && sideIsVisible(side),
    angles,
  };
}

function selectedAlignment() {
  const info = lineAngle(state.colour, state.side);
  const visible = state.lampOn && state.gratingMounted && info.valid;
  if (!visible) {
    return { visible: false, aligned: false, offset: NaN, angle: NaN, tolerance: slitTolerance() };
  }
  const offset = shortestDelta(state.telescope, info.angle);
  const tolerance = slitTolerance();
  return {
    visible: true,
    aligned: Math.abs(offset) <= tolerance,
    offset,
    angle: info.angle,
    tolerance,
  };
}

function readingsFor(colourId) {
  return state.readings[colourId] || {};
}

function hasBothReadings(colourId) {
  const row = readingsFor(colourId);
  return Boolean(row.left && row.right);
}

function readingsComplete() {
  return LINE_IDS.every((id) => hasBothReadings(id));
}

function resultFor(colourId) {
  const row = readingsFor(colourId);
  if (!row.left || !row.right) return null;
  const order = row.left.order === row.right.order ? row.left.order : null;
  const standard = state.reference[colourId];
  if (!order) {
    return { valid: false, partial: true, mixedOrders: true, order: state.order, standard };
  }
  const solution = solveFromReadings(row.left.reading, row.right.reading, order);
  const deviation = percentageDeviation(solution.wavelengthAngstrom, standard);
  return {
    ...solution,
    order,
    standard,
    deviation,
    measured: row,
    valid: solution.valid && deviation.valid,
  };
}

function allResults() {
  const out = {};
  for (const id of LINE_IDS) out[id] = resultFor(id);
  return out;
}

function resolvedResults() {
  return Object.values(allResults()).filter((row) => row && row.valid);
}

function readingLabel(entry) {
  if (!entry) return "—";
  return formatDMS(entry.reading, { seconds: state.showSeconds });
}

function sourceTag(entry) {
  if (!entry) return "";
  const kind = entry.source === "manual" ? "manual" : "measured";
  const order = `order ${entry.order}`;
  return `<span class="source-tag is-${kind}" title="Recorded in ${order}">${kind}</span>`;
}

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

function collectElements() {
  const ids = [
    "spectrometer-svg",
    "apparatus-panel",
    "results-section",
    "grating-lab",
    "eyepiece-svg",
    "spectrum-legend",
    "stage-list",
    "stage-progress",
    "guide-text",
    "guide-action",
    "guide-stage",
    "guide-open-theory",
    "stage-intro",
    "stage-start",
    "app-status",
    "lamp-chip",
    "order-chip",
    "grating-chip",
    "lamp-toggle",
    "lamp-toggle-text",
    "collimator-align",
    "collimator-align-text",
    "grating-mount",
    "grating-mount-text",
    "slit-width",
    "slit-width-value",
    "grating-tilt",
    "grating-tilt-value",
    "zero-grating",
    "order-1",
    "order-2",
    "setup-status",
    "vernier-zero-deg",
    "vernier-zero-min",
    "apply-zero",
    "telescope-left",
    "telescope-right",
    "telescope-left-fine",
    "telescope-right-fine",
    "telescope-left-micro",
    "telescope-right-micro",
    "telescope-lock",
    "telescope-reset",
    "align-line",
    "align-line-text",
    "record-left",
    "record-right",
    "readout-dms",
    "readout-raw",
    "readout-telescope",
    "readout-offset",
    "readout-line",
    "readout-alignment",
    "alignment-state",
    "lock-chip",
    "eyepiece-chip",
    "eyepiece-status",
    "colour-select",
    "side-left",
    "side-right",
    "show-left",
    "show-right",
    "wavelength-unit",
    "show-seconds",
    "table-a-body",
    "table-b-body",
    "reading-count",
    "calc-count",
    "order-note",
    "calculation-colour",
    "worked-calculation",
    "graph-svg",
    "graph-chip",
    "graph-caption",
    "result-list",
    "result-chip",
    "conclusion-text",
    "history-list",
    "history-count",
    "ref-violet",
    "ref-green",
    "ref-yellow",
    "ref-red",
    "calculate-results",
    "export-csv",
    "print-record",
    "reset-experiment",
    "clear-storage",
    "storage-note",
    "reset-controls",
    "mode-toggle",
    "contrast-toggle",
    "animation-speed",
    "start-experiment",
    "theory-live",
    "order-validity",
    "notebook-body",
    "notebook-results",
    "notebook-summary",
    "notebook-chip",
    "notebook-result-chip",
    "notebook-restore",
    "notebook-clear",
    "notebook-export",
    "notebook-input",
    "notebook-apply",
    "notebook-reset-text",
    "notebook-feedback",
    "viva-list",
    "viva-numeric",
    "journal-content",
    "journal-print",
    "journal-csv",
    "print-report",
    "panel-live",
    "panel-notebook",
    "panel-theory",
    "panel-viva",
    "panel-journal",
    "tab-live",
    "tab-notebook",
    "tab-theory",
    "tab-viva",
    "tab-journal",
  ];
  for (const id of ids) el[id] = byId(id);
  el.stageButtons = [];
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function scheduleRender() {
  if (framePending !== null) return;
  framePending = window.requestAnimationFrame(() => {
    framePending = null;
    renderAll();
  });
}

function renderAll() {
  renderStageBar();
  renderHeaderChips();
  renderControlValues();
  renderSpectrumLegend();
  renderApparatus();
  renderEyepiece();
  renderReadouts();
  renderGuide();
  renderTables();
  renderWorkedCalculation();
  renderGraph();
  renderResults();
  renderHistory();
  renderTheoryLive();
  renderJournal();
  applySettings();
  saveState();
}

function renderStageBar() {
  const allowed = allowedStages();
  el["stage-intro"].hidden = state.stage !== 1;
  el["stage-progress"].textContent = `Stage ${state.stage} of 9`;
  el.stageButtons = STAGES.map((stage) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-chip";
    button.dataset.stage = String(stage.id);
    button.setAttribute(
      "aria-label",
      `Stage ${stage.id}: ${stage.title}${allowed.has(stage.id) ? "" : " (locked)"}`,
    );
    button.innerHTML = `<span class="stage-index">${stage.id}</span><span class="stage-name">${escapeHtml(stage.short)}</span>`;
    button.addEventListener("click", () => goToStage(stage.id));
    return button;
  });
  el["stage-list"].replaceChildren(...el.stageButtons);
  updateStageBar();
}

function updateStageBar() {
  const allowed = allowedStages();
  for (const button of el["stage-list"].querySelectorAll(".stage-chip")) {
    const id = Number(button.dataset.stage);
    const active = id === state.stage;
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-locked", !allowed.has(id));
    button.classList.toggle("is-done", isStageComplete(id));
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  el["stage-progress"].textContent = `Stage ${state.stage} of 9`;
}

function allowedStages() {
  const allowed = new Set([1, 2, 3]);
  if (setupComplete()) allowed.add(4);
  if (!setupComplete()) return allowed;
  const row = readingsFor(state.colour);
  if (row.left) allowed.add(5);
  if (row.left && row.right) {
    allowed.add(6);
    allowed.add(7);
    allowed.add(8);
  }
  if (readingsComplete()) {
    for (const id of [4, 5, 6, 7, 8, 9]) allowed.add(id);
  }
  return allowed;
}

function isStageComplete(id) {
  switch (id) {
    case 1:
      return state.stage > 1;
    case 2:
      return setupComplete();
    case 3:
      return readingsComplete();
    case 4:
    case 5:
      return hasBothReadings(state.colour);
    case 6:
    case 7:
    case 8:
      return Boolean(resultFor(state.colour)?.valid);
    case 9:
      return readingsComplete() && resolvedResults().length === 4;
    default:
      return false;
  }
}

function renderHeaderChips() {
  el["lamp-chip"].textContent = state.lampOn ? "Lamp on" : "Lamp off";
  el["lamp-chip"].classList.toggle("is-on", state.lampOn);
  el["order-chip"].textContent = `Order ${state.order}`;
  el["grating-chip"].textContent = state.gratingMounted
    ? Math.abs(state.tilt) <= SETUP_TILT_LIMIT
      ? "Grating aligned"
      : "Grating tilted"
    : "Grating not mounted";
  el["grating-chip"].classList.toggle("is-warn", state.gratingMounted && Math.abs(state.tilt) > SETUP_TILT_LIMIT);
}

function renderControlValues() {
  el["lamp-toggle"].setAttribute("aria-pressed", String(state.lampOn));
  el["lamp-toggle"].classList.toggle("is-on", state.lampOn);
  el["lamp-toggle-text"].textContent = state.lampOn ? "Switch off mercury lamp" : "Switch on mercury lamp";

  el["collimator-align"].setAttribute("aria-pressed", String(state.collimatorAligned));
  el["collimator-align"].classList.toggle("is-on", state.collimatorAligned);
  el["collimator-align-text"].textContent = state.collimatorAligned ? "Collimator aligned" : "Align collimator";

  el["grating-mount"].setAttribute("aria-pressed", String(state.gratingMounted));
  el["grating-mount"].classList.toggle("is-on", state.gratingMounted);
  el["grating-mount-text"].textContent = state.gratingMounted ? "Grating mounted" : "Mount grating";

  el["slit-width"].value = String(state.slitWidth);
  el["slit-width-value"].textContent = `${state.slitWidth.toFixed(2)} mm`;
  el["grating-tilt"].value = String(state.tilt);
  el["grating-tilt-value"].textContent = `${state.tilt.toFixed(1)}°`;
  el["grating-tilt"].classList.toggle("is-warn", Math.abs(state.tilt) > SETUP_TILT_LIMIT);

  el["order-1"].checked = state.order === 1;
  el["order-2"].checked = state.order === 2;

  const issues = setupIssues();
  el["setup-status"].textContent = issues.length
    ? `Not ready: ${issues.join(" · ")}.`
    : "Optical setup complete: parallel beam, grating normal centred and 0.0° tilt.";
  el["setup-status"].classList.toggle("is-ready", issues.length === 0);

  el["telescope-lock"].setAttribute("aria-pressed", String(state.locked));
  el["telescope-lock"].textContent = state.locked ? "Unlock telescope" : "Lock telescope";
  el["telescope-lock"].classList.toggle("is-on", state.locked);
  el["lock-chip"].textContent = state.locked ? "Locked" : "Unlocked";
  el["lock-chip"].classList.toggle("is-on", state.locked);

  if (document.activeElement !== el["vernier-zero-deg"]) {
    el["vernier-zero-deg"].value = String(Math.floor(state.zeroOffset));
  }
  if (document.activeElement !== el["vernier-zero-min"]) {
    el["vernier-zero-min"].value = String(Math.floor((state.zeroOffset % 1) * 60 + 1e-9));
  }

  el["side-left"].checked = state.side === "left";
  el["side-right"].checked = state.side === "right";

  el["show-left"].checked = state.showLeft;
  el["show-right"].checked = state.showRight;
  el["wavelength-unit"].value = state.unit;
  el["show-seconds"].checked = state.showSeconds;

  if (state.mode === "free") {
    el["mode-toggle"].textContent = "Guided mode";
    el["mode-toggle"].setAttribute("aria-pressed", "true");
  } else {
    el["mode-toggle"].textContent = "Free observation";
    el["mode-toggle"].setAttribute("aria-pressed", "false");
  }

  el["guide-stage"].textContent = `Stage ${state.stage} · ${STAGE_BY_ID[state.stage].short}`;
  el["guide-stage"].classList.toggle("is-free", state.mode === "free");

  for (const button of el["colour-select"].querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.colour === state.colour));
  }

  for (const [id, input] of Object.entries(referenceInputs())) {
    if (document.activeElement !== input) input.value = String(state.reference[id]);
  }
}

function referenceInputs() {
  return {
    violet: el["ref-violet"],
    green: el["ref-green"],
    yellow: el["ref-yellow"],
    red: el["ref-red"],
  };
}

function renderSpectrumLegend() {
  const order = state.order;
  const parts = SPECTRAL_LINES.map((line) => {
    const { angles } = lineFor(line.id);
    const valid = angles.leftValid || angles.rightValid;
    const angleText = valid
      ? `±${formatDMS(Math.abs(angles.rightDeg), { seconds: false })}`
      : "no physical order";
    return `
      <button type="button" class="legend-item ${line.id === state.colour ? "is-selected" : ""}" data-colour="${line.id}" ${valid ? "" : "disabled"}>
        <span class="legend-swatch" style="--swatch:${line.color}"></span>
        <span class="legend-name">${escapeHtml(line.name)}</span>
        <span class="legend-angle">${angleText}</span>
        <span class="legend-tag">${valid ? `n = ${order}` : "n/a"}</span>
      </button>
    `;
  });
  parts.push(`
    <span class="legend-item legend-central">
      <span class="legend-swatch is-white"></span>
      <span class="legend-name">Central maximum</span>
      <span class="legend-angle">0° 00′</span>
      <span class="legend-tag">n = 0</span>
    </span>
  `);
  el["spectrum-legend"].innerHTML = parts.join("");
  for (const button of el["spectrum-legend"].querySelectorAll("button[data-colour]")) {
    button.addEventListener("click", () => selectColour(button.dataset.colour));
  }
}

function spectrumLinesForApparatus() {
  return SPECTRAL_LINES.map((line) => {
    const { angles, wavelengthM } = lineFor(line.id);
    const leftVisible = angles.leftValid && Number.isFinite(angles.leftDeg) && state.showLeft;
    const rightVisible = angles.rightValid && Number.isFinite(angles.rightDeg) && state.showRight;
    return {
      id: line.id,
      name: line.name,
      letter: line.name.charAt(0),
      color: line.color,
      wavelengthM,
      leftDeg: leftVisible ? angles.leftDeg : NaN,
      rightDeg: rightVisible ? angles.rightDeg : NaN,
      leftValid: leftVisible,
      rightValid: rightVisible,
      selected: line.id === state.colour,
      blurred: !state.collimatorAligned,
      visible: state.lampOn && state.gratingMounted && (leftVisible || rightVisible),
      angleLabel: formatDMS(Math.abs(angles.rightDeg || 0), { seconds: false }),
    };
  });
}

function renderApparatus() {
  const alignment = selectedAlignment();
  apparatus.render({
    telescope: state.telescope,
    zeroOffset: state.zeroOffset,
    lampOn: state.lampOn,
    collimatorAligned: state.collimatorAligned,
    gratingMounted: state.gratingMounted,
    slitWidth: state.slitWidth,
    tilt: state.tilt,
    order: state.order,
    selectedColour: state.colour,
    lines: spectrumLinesForApparatus(),
    alignedLine: alignment.aligned ? { id: state.colour, side: state.side } : null,
  });
}

function renderEyepiece() {
  const tolerance = slitTolerance();
  const pxPerDegree = 7.4;
  const center = 110;
  const fieldRadius = 92;
  const parts = [];
  const blurred = !state.collimatorAligned;
  const active = state.lampOn && state.gratingMounted;

  parts.push(`<defs>
    <pattern id="eyepiece-grid" width="18" height="18" patternUnits="userSpaceOnUse">
      <path d="M18 0H0V18" fill="none" stroke="#7de8ff" stroke-opacity="0.14" stroke-width="0.8" />
    </pattern>
  </defs>`);
  parts.push(`<circle cx="110" cy="110" r="102" fill="#050d10" stroke="#2a4650" stroke-width="3" />`);
  parts.push(`<circle cx="110" cy="110" r="92" fill="#04120d" />`);
  parts.push(`<circle cx="110" cy="110" r="92" fill="url(#eyepiece-grid)" />`);

  if (active) {
    // Ambient diffraction haze behind the lines.
    parts.push(`<ellipse cx="110" cy="110" rx="88" ry="70" fill="#0b2a22" opacity="0.35" />`);
    const linesToDraw = [];
    const centralOffset = shortestDelta(state.telescope, 0);
    linesToDraw.push({ key: "central", color: "#f2fbff", offset: centralOffset, selected: false, width: 1.6, label: "0" });
    for (const line of SPECTRAL_LINES) {
      for (const side of ["left", "right"]) {
        const info = lineAngle(line.id, side);
        if (!info.valid) continue;
        const offset = shortestDelta(state.telescope, info.angle);
        if (Math.abs(offset) > fieldRadius / pxPerDegree + 4) continue;
        const isTarget = line.id === state.colour && side === state.side;
        linesToDraw.push({
          key: side === "left" ? `${line.name} left` : `${line.name} right`,
          color: line.color,
          offset,
          selected: isTarget,
          width: blurred ? 9 : isTarget ? 3.2 : 1.8,
          label: line.name.charAt(0),
        });
      }
    }
    linesToDraw.sort((a, b) => a.selected - b.selected);
    for (const line of linesToDraw) {
      const x = center + line.offset * pxPerDegree;
      const distance = Math.abs(line.offset);
      const fade = clamp(1 - distance / 13, 0.18, 1);
      parts.push(
        `<rect x="${(x - line.width / 2).toFixed(2)}" y="26" width="${line.width.toFixed(2)}" height="168" rx="${Math.min(line.width / 2, 2)}" fill="${line.color}" opacity="${(fade * (line.selected ? 0.98 : 0.5)).toFixed(2)}" />`,
      );
      parts.push(
        `<text x="${x.toFixed(2)}" y="226" text-anchor="middle" class="eyepiece-label" fill="${line.color}" opacity="${fade.toFixed(2)}">${escapeHtml(line.label)}</text>`,
      );
    }
  } else {
    parts.push(`<text x="110" y="112" text-anchor="middle" class="eyepiece-message">Lamp off</text>`);
  }

  // Crosswires and reticle.
  parts.push(`<line x1="110" y1="18" x2="110" y2="202" stroke="#8ff3ff" stroke-width="1.4" opacity="0.9" />`);
  parts.push(`<line x1="26" y1="110" x2="194" y2="110" stroke="#8ff3ff" stroke-width="0.8" opacity="0.35" stroke-dasharray="4 6" />`);
  parts.push(`<circle cx="110" cy="110" r="52" fill="none" stroke="#7de8ff" stroke-width="0.7" opacity="0.35" />`);
  parts.push(`<circle cx="110" cy="110" r="8" fill="none" stroke="#7de8ff" stroke-width="0.8" opacity="0.45" />`);
  parts.push(`<circle cx="110" cy="110" r="102" fill="none" stroke="#3a5864" stroke-width="2" />`);

  const alignment = selectedAlignment();
  if (active && alignment.aligned) {
    parts.push(`<circle cx="110" cy="110" r="96" fill="none" stroke="#3fe4c8" stroke-width="3" class="eyepiece-aligned-ring" />`);
  }
  el["eyepiece-svg"].innerHTML = parts.join("");

  const lineName = LINE_BY_ID[state.colour].name;
  el["eyepiece-chip"].textContent = !active
    ? "No light"
    : alignment.aligned
      ? "Aligned"
      : alignment.visible
        ? "Line in view"
        : "No line";
  el["eyepiece-chip"].classList.toggle("is-on", active && alignment.aligned);
  el["eyepiece-chip"].classList.toggle("is-warn", active && !alignment.aligned);

  let status;
  if (!state.lampOn) {
    status = "Switch on the mercury lamp and mount the grating to see spectral lines.";
  } else if (!state.gratingMounted) {
    status = "Mount the diffraction grating. The eyepiece shows only the central beam until then.";
  } else if (!alignment.visible) {
    status = `The ${lineName.toLowerCase()} line is not visible in order ${state.order} on this side.`;
  } else if (alignment.aligned) {
    status = `${lineName} line centred on the crosswire within ${formatDMS(tolerance, { seconds: true })}. Lock the telescope and record the reading.`;
  } else {
    status = `The ${lineName} line is ${formatDMS(Math.abs(alignment.offset), { seconds: true })} off the crosswire. Rotate the telescope to centre it.`;
  }
  el["eyepiece-status"].textContent = status;
}

function renderReadouts() {
  const raw = normalizeDegrees(state.telescope + state.zeroOffset);
  el["readout-dms"].textContent = formatDMS(raw, { seconds: state.showSeconds });
  el["readout-raw"].textContent = `Vernier zero ${formatDMS(state.zeroOffset, { seconds: false })} · raw scale reading`;
  el["readout-telescope"].textContent = `${state.telescope >= 0 ? "+" : "−"}${Math.abs(state.telescope).toFixed(3)}°`;
  el["align-line-text"].textContent = `Point at ${LINE_BY_ID[state.colour].name.toLowerCase()} · ${state.side}`;
  const alignment = selectedAlignment();
  el["readout-offset"].textContent = alignment.visible
    ? formatDMS(Math.abs(alignment.offset), { seconds: true })
    : "—";
  el["readout-line"].textContent = `${LINE_BY_ID[state.colour].name} · ${state.side}`;
  el["readout-alignment"].textContent = alignment.aligned
    ? "Aligned"
    : alignment.visible
      ? "Off line"
      : "Not in view";
  el["readout-alignment"].classList.toggle("is-on", alignment.aligned);
  el["alignment-state"].classList.toggle("is-aligned", alignment.aligned);
  if (alignment.aligned) {
    el["alignment-state"].textContent = "Vertical crosswire coincident with the spectral line. The reading is ready to be locked and recorded.";
  } else if (!state.lampOn) {
    el["alignment-state"].textContent = "Switch on the mercury lamp to illuminate the grating.";
  } else if (!state.gratingMounted) {
    el["alignment-state"].textContent = "Mount the grating to produce the diffraction spectrum.";
  } else if (!alignment.visible) {
    el["alignment-state"].textContent = "The selected line is not visible on this side for this order.";
  } else {
    el["alignment-state"].textContent = `Rotate the telescope ${alignment.offset > 0 ? "anticlockwise" : "clockwise"} by ${formatDMS(Math.abs(alignment.offset), { seconds: true })} to centre the line.`;
  }
}

function guideSnapshot() {
  return {
    stage: state.stage,
    mode: state.mode,
    lampOn: state.lampOn,
    collimatorAligned: state.collimatorAligned,
    gratingMounted: state.gratingMounted,
    tiltOk: Math.abs(state.tilt) <= SETUP_TILT_LIMIT,
    colourName: LINE_BY_ID[state.colour].name,
    side: state.side,
    aligned: selectedAlignment().aligned,
    locked: state.locked,
    orderValid: lineAngle(state.colour, state.side).valid,
    readingsComplete: readingsComplete(),
    selectedReadings: readingsFor(state.colour),
  };
}

const GUIDE_ACTIONS = {
  start: { label: "Start experiment", run: () => goToStage(2) },
  lamp: { label: "Switch on the lamp", run: () => setLamp(true) },
  collimator: { label: "Align collimator", run: () => setCollimator(true) },
  grating: { label: "Mount grating", run: () => setGrating(true) },
  continue: { label: "Continue", run: () => goToStage(3) },
  left: { label: "Measure left side", run: () => startSide("left") },
  right: { label: "Measure right side", run: () => startSide("right") },
  align: { label: "Centre the line", run: null },
  lock: { label: "Lock telescope", run: () => setLocked(true) },
  unlock: { label: "Unlock telescope", run: () => setLocked(false) },
  "record-left": { label: "Record left reading", run: () => recordReading("left") },
  "record-right": { label: "Record right reading", run: () => recordReading("right") },
  angle: { label: "Calculate angular separation", run: () => goToStage(6) },
  wavelength: { label: "Calculate wavelength", run: () => goToStage(7) },
  compare: { label: "Compare with standard", run: () => goToStage(8) },
  "next-colour": { label: "Next colour", run: () => nextColour() },
  observe: { label: "Back to spectrum", run: () => goToStage(3) },
  complete: { label: "Complete experiment", run: () => goToStage(9) },
  null: { label: "Step complete", run: null },
};

function renderGuide() {
  const guide = guideFor(guideSnapshot());
  el["guide-text"].textContent = guide.text;
  const actionKey = guide.action || "null";
  const action = GUIDE_ACTIONS[actionKey] || GUIDE_ACTIONS.null;
  el["guide-action"].textContent = action.label;
  el["guide-action"].disabled = !action.run;
  el["guide-action"].dataset.action = actionKey;
  el["guide-stage"].textContent = `Stage ${state.stage} · ${STAGE_BY_ID[state.stage].short}`;
}

function renderTables() {
  const results = allResults();
  const rowsA = [];
  const rowsB = [];
  let measuredCount = 0;
  let calculatedCount = 0;

  SPECTRAL_LINES.forEach((line, index) => {
    const reading = readingsFor(line.id);
    const result = results[line.id];
    if (reading.left && reading.right) measuredCount += 1;
    if (result && result.valid) calculatedCount += 1;

    const separationText = result && !result.mixedOrders ? formatDMS(result.separationDeg, { seconds: state.showSeconds }) : "—";
    const thetaText = result && !result.mixedOrders ? formatDMS(result.thetaDeg, { seconds: true }) : "—";

    rowsA.push(`
      <tr class="colour-row${state.colour === line.id ? " is-selected" : ""}">
        <td class="cell-index">${index + 1}</td>
        <th scope="row" class="cell-colour">
          <button type="button" class="colour-button" data-colour="${line.id}" aria-label="Select ${line.name}">
            <span class="colour-swatch" style="--swatch:${line.color}"></span>${line.name}
          </button>
        </th>
        <td class="cell-reading">
          ${readingInput("left", line.id, reading.left)}
          ${sourceTag(reading.left)}
        </td>
        <td class="cell-reading">
          ${readingInput("right", line.id, reading.right)}
          ${sourceTag(reading.right)}
        </td>
        <td class="cell-computed">${separationText}</td>
        <td class="cell-computed">${thetaText}</td>
      </tr>
    `);

    if (result && result.valid) {
      rowsB.push(`
        <tr>
          <td class="cell-index">${index + 1}</td>
          <th scope="row" class="cell-colour">
            <span class="colour-swatch" style="--swatch:${line.color}"></span>${line.name}
          </th>
          <td class="cell-computed">${result.sinTheta.toFixed(6)}</td>
          <td class="cell-computed is-strong">${formatNumber(result.wavelengthAngstrom, 1)}</td>
          <td class="cell-computed">${formatNumber(result.standard, 1)}</td>
          <td class="cell-computed ${deviationClass(result.deviation.signed)}">${formatSignedPercent(result.deviation.signed)}</td>
          <td class="cell-computed ${deviationClass(result.deviation.signed)}">${formatPercentPlain(result.deviation.absolute)}</td>
        </tr>
      `);
    } else {
      rowsB.push(`
        <tr>
          <td class="cell-index">${index + 1}</td>
          <th scope="row" class="cell-colour">
            <span class="colour-swatch" style="--swatch:${line.color}"></span>${line.name}
          </th>
          <td class="cell-computed">—</td>
          <td class="cell-computed">—</td>
          <td class="cell-computed">${formatNumber(state.reference[line.id], 1)}</td>
          <td class="cell-computed">—</td>
          <td class="cell-computed">${result && result.mixedOrders ? "mixed orders" : "—"}</td>
        </tr>
      `);
    }
  });

  el["table-a-body"].innerHTML = rowsA.join("");
  el["table-b-body"].innerHTML = rowsB.join("");
  el["reading-count"].textContent = `${measuredCount} of 4 colours`;
  el["calc-count"].textContent = `${calculatedCount} calculated`;

  const orders = new Set();
  for (const id of LINE_IDS) {
    const row = readingsFor(id);
    if (row.left) orders.add(row.left.order);
    if (row.right) orders.add(row.right.order);
  }
  if (orders.size === 0) {
    el["order-note"].textContent = "No readings recorded yet.";
  } else if (orders.size === 1) {
    el["order-note"].textContent = `All readings belong to order ${[...orders][0]}.`;
  } else {
    el["order-note"].textContent = "Readings from different orders are present; each colour is only calculated when its two readings share an order.";
  }
}

function readingInput(side, colourId, entry) {
  const value = entry ? formatDMS(entry.reading, { seconds: state.showSeconds }) : "";
  const manual = entry && entry.source === "manual" ? " is-manual" : "";
  return `<input
    class="reading-input${manual}"
    id="a-${side}-${colourId}"
    data-colour="${colourId}"
    data-side="${side}"
    type="text"
    inputmode="numeric"
    placeholder="—"
    value="${escapeHtml(value)}"
    aria-label="${side === "left" ? "Left" : "Right"} reading for ${LINE_BY_ID[colourId].name}"
  />`;
}

function renderWorkedCalculation() {
  const colourId = el["calculation-colour"].value || state.colour;
  const result = allResults()[colourId];
  const line = LINE_BY_ID[colourId];
  if (!result) {
    el["worked-calculation"].innerHTML = `
      <p class="calc-empty">No readings for ${line.name} yet. Record the left and right readings of the ${line.name.toLowerCase()} line to see the full calculation.</p>
    `;
    return;
  }
  if (result.mixedOrders) {
    el["worked-calculation"].innerHTML = `
      <p class="calc-empty">The two ${line.name} readings were taken in different orders. Re-record both readings in the same order.</p>
    `;
    return;
  }
  if (!result.valid) {
    el["worked-calculation"].innerHTML = `
      <p class="calc-empty">The readings for ${line.name} do not give a physical diffraction angle. Check the readings.</p>
    `;
    return;
  }
  const row = result.measured;
  const order = result.order;
  const template = `
    <li>
      <span class="calc-step">1</span>
      <div>
        <p class="calc-title">Readings from the scale</p>
        <p class="calc-line">θ<sub>1</sub> = ${formatDMSAscii(row.left.reading)} &nbsp;·&nbsp; θ<sub>2</sub> = ${formatDMSAscii(row.right.reading)}</p>
        <p class="calc-note">${row.left.source === "manual" || row.right.source === "manual" ? "One or both readings were entered manually." : "Both readings were measured with the simulated telescope."}</p>
      </div>
    </li>
    <li>
      <span class="calc-step">2</span>
      <div>
        <p class="calc-title">Angular separation (wrapped across 0°/360°)</p>
        <p class="calc-line">2θ = |${formatDMS(row.right.reading, { seconds: true })} − ${formatDMS(row.left.reading, { seconds: true })}| → <strong>${formatDMS(result.separationDeg, { seconds: true })}</strong></p>
        <p class="calc-note">= ${formatNumber(result.separationDeg, 6)}° on the instrument scale.</p>
      </div>
    </li>
    <li>
      <span class="calc-step">3</span>
      <div>
        <p class="calc-title">Diffraction angle</p>
        <p class="calc-line">θ = 2θ / 2 = ${formatNumber(result.separationDeg, 6)}° / 2 = <strong>${formatNumber(result.thetaDeg, 6)}°</strong> = ${formatDMS(result.thetaDeg, { seconds: true })}</p>
        <p class="calc-note">sin θ = ${result.sinTheta.toFixed(6)}</p>
      </div>
    </li>
    <li>
      <span class="calc-step">4</span>
      <div>
        <p class="calc-title">Wavelength from d sin θ = n λ</p>
        <p class="calc-line">λ<sub>exp</sub> = d sin θ / n = ${formatNumber(GRATING_ELEMENT_ANGSTROM, 2)} Å × ${result.sinTheta.toFixed(6)} / ${order} = <strong>${formatNumber(result.wavelengthAngstrom, 1)} Å</strong></p>
        <p class="calc-note">= ${formatNumber(result.wavelengthNm, 3)} nm = ${formatWavelength(result.wavelengthM, "metre", 3)}</p>
      </div>
    </li>
    <li>
      <span class="calc-step">5</span>
      <div>
        <p class="calc-title">Comparison with the standard value</p>
        <p class="calc-line">% deviation = ((${formatNumber(result.wavelengthAngstrom, 1)} − ${formatNumber(result.standard, 1)}) / ${formatNumber(result.standard, 1)}) × 100 = <strong class="${deviationClass(result.deviation.signed)}">${formatSignedPercent(result.deviation.signed)}</strong></p>
        <p class="calc-note">Absolute deviation: ${formatPercentPlain(result.deviation.absolute)}</p>
      </div>
    </li>
  `;
  el["worked-calculation"].innerHTML = `<ol class="calc-steps">${template}</ol>`;
}

function renderGraph() {
  const width = 460;
  const height = 300;
  const margin = { left: 58, right: 16, top: 20, bottom: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const xMax = 0.5;
  const yMin = 3500;
  const yMax = 7200;
  const xScale = (value) => margin.left + (clamp(value, 0, xMax) / xMax) * innerW;
  const yScale = (value) => margin.top + innerH - ((clamp(value, yMin, yMax) - yMin) / (yMax - yMin)) * innerH;

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0a131d" rx="6" />`);
  for (let value = 3500; value <= 7200; value += 500) {
    const y = yScale(value);
    parts.push(`<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${width - margin.right}" y2="${y.toFixed(1)}" stroke="#1b2a3b" stroke-width="1" />`);
    parts.push(`<text x="${margin.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="graph-tick">${value}</text>`);
  }
  for (let value = 0; value <= xMax + 1e-9; value += 0.1) {
    const x = xScale(value);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${margin.top + innerH}" stroke="#162435" stroke-width="1" />`);
    parts.push(`<text x="${x.toFixed(1)}" y="${margin.top + innerH + 18}" text-anchor="middle" class="graph-tick">${value.toFixed(1)}</text>`);
  }
  parts.push(`<line x1="${margin.left}" y1="${margin.top + innerH}" x2="${width - margin.right}" y2="${margin.top + innerH}" stroke="#4a6076" stroke-width="1.4" />`);
  parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerH}" stroke="#4a6076" stroke-width="1.4" />`);
  parts.push(`<text x="${margin.left + innerW / 2}" y="${height - 10}" text-anchor="middle" class="graph-axis">sin θ</text>`);
  parts.push(`<text x="14" y="${margin.top + innerH / 2}" text-anchor="middle" transform="rotate(-90 14 ${margin.top + innerH / 2})" class="graph-axis">λ (Å)</text>`);

  // Theoretical line λ = d sin θ / n for the displayed order.
  const n = state.order;
  const theoryPoints = [];
  for (let step = 0; step <= 100; step += 1) {
    const sinTheta = (step / 100) * xMax;
    const lambda = (GRATING_ELEMENT_ANGSTROM * sinTheta) / n;
    if (lambda < yMin) continue;
    if (lambda > yMax) break;
    theoryPoints.push(`${xScale(sinTheta).toFixed(1)},${yScale(lambda).toFixed(1)}`);
  }
  if (theoryPoints.length > 1) {
    parts.push(`<polyline points="${theoryPoints.join(" ")}" fill="none" stroke="#3f8fa8" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.85" />`);
  }
  parts.push(`<text x="${width - margin.right - 6}" y="${margin.top + 14}" text-anchor="end" class="graph-note">dashed: λ = d sinθ / ${n}</text>`);

  const points = [];
  for (const line of SPECTRAL_LINES) {
    const result = allResults()[line.id];
    if (!result || !result.valid) continue;
    if (!(result.sinTheta > 0)) continue;
    const x = xScale(result.sinTheta);
    const y = yScale(result.wavelengthAngstrom);
    points.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${line.color}" stroke="#04121a" stroke-width="2" />`,
      `<text x="${(x + 8).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="graph-point-label" fill="${line.color}">${line.name.charAt(0)}</text>`,
    );
  }
  if (points.length === 0) {
    parts.push(`<text x="${margin.left + innerW / 2}" y="${margin.top + innerH / 2}" text-anchor="middle" class="graph-empty">No measurements yet</text>`);
  }
  el["graph-svg"].innerHTML = parts.join("");

  const fit = fitGratingElement(
    SPECTRAL_LINES.map((line) => {
      const result = allResults()[line.id];
      return result && result.valid
        ? { sinTheta: result.sinTheta, wavelengthM: result.wavelengthM }
        : null;
    }).filter(Boolean),
  );
  el["graph-chip"].textContent = points.length ? `${points.length / 2} points` : "No data";
  el["graph-caption"].textContent = fit.valid
    ? `Best-fit gradient gives d = ${formatNumber(fit.slopeAngstrom, 0)} Å against the grating value ${formatNumber(GRATING_ELEMENT_ANGSTROM, 0)} Å.`
    : "The gradient of the best-fit line through the origin is the grating element d.";
}

function renderResults() {
  const results = allResults();
  const valid = resolvedResults();
  const entries = [];
  for (const line of SPECTRAL_LINES) {
    const result = results[line.id];
    if (!result || !result.valid) {
      entries.push(`
        <div class="result-row is-pending">
          <span class="colour-swatch" style="--swatch:${line.color}"></span>
          <span class="result-name">${line.name}</span>
          <span class="result-value">Not measured</span>
          <span class="result-deviation">—</span>
        </div>
      `);
      continue;
    }
    entries.push(`
      <div class="result-row">
        <span class="colour-swatch" style="--swatch:${line.color}"></span>
        <span class="result-name">${line.name}</span>
        <span class="result-value">${formatLength(result.wavelengthM)}</span>
        <span class="result-deviation ${deviationClass(result.deviation.signed)}">${formatSignedPercent(result.deviation.signed)}</span>
      </div>
    `);
  }
  el["result-list"].innerHTML = entries.join("");
  el["result-chip"].textContent = valid.length === 4 ? "Complete" : `${valid.length} of 4 measured`;
  el["result-chip"].classList.toggle("is-on", valid.length === 4);

  el["conclusion-text"].textContent = buildConclusion(valid);
}

function buildConclusion(valid) {
  if (valid.length === 0) {
    return "Record the left and right readings for each colour to generate the result and conclusion.";
  }
  if (valid.length < 4) {
    return `${valid.length} of the 4 colours have been measured so far. Complete the remaining readings before drawing a conclusion; percent deviations depend on how accurately the crosswire is set and on the alignment of the grating.`;
  }
  const deviations = valid.map((row) => row.deviation.signed);
  const magnitudes = deviations.map((value) => Math.abs(value));
  const maxDeviation = Math.max(...magnitudes);
  const meanAbsolute = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
  const range = `${formatLength(Math.min(...valid.map((row) => row.wavelengthM)))} to ${formatLength(Math.max(...valid.map((row) => row.wavelengthM)))}`;

  let verdict;
  if (maxDeviation <= 1) {
    verdict =
      "The measured wavelengths agree closely with the standard values: every deviation is below 1 %, which is consistent with careful setting of the crosswire on sharp lines and a well-aligned grating.";
  } else if (maxDeviation <= 3) {
    verdict =
      "The measured wavelengths are close to the standard values but not identical. A largest deviation of a few percent is consistent with a small alignment error, a slit that is too wide, or readings taken slightly off the line centre.";
  } else {
    verdict =
      "The measured wavelengths do not agree closely with the standard values. Check that the collimator is aligned, the grating normal is at 0.0°, the correct order is selected, and that each reading was taken with the line centred on the crosswire.";
  }

  return `The wavelengths determined with the grating lie in the range ${range}. The largest absolute deviation is ${maxDeviation.toFixed(2)} % and the mean absolute deviation is ${meanAbsolute.toFixed(2)} %. ${verdict} Since λ = d sin θ, an error δθ in the diffraction angle changes the wavelength by approximately d cos θ · δθ, so the accuracy of the angular measurement controls the accuracy of the result.`;
}

function renderHistory() {
  const list = state.history.slice(0, 12);
  if (list.length === 0) {
    el["history-list"].innerHTML = `<li class="history-empty">No measurements yet.</li>`;
  } else {
    el["history-list"].innerHTML = list
      .map((entry) => {
        const line = LINE_BY_ID[entry.colour];
        const time = new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        return `<li class="history-item">
          <span class="history-time">${time}</span>
          <span class="history-colour" style="--swatch:${line.color}">${line.name}</span>
          <span class="history-side">${entry.side}</span>
          <span class="history-reading">${formatDMS(entry.reading, { seconds: true })}</span>
          <span class="history-order">order ${entry.order}</span>
        </li>`;
      })
      .join("");
  }
  el["history-count"].textContent = `${state.history.length} ${state.history.length === 1 ? "entry" : "entries"}`;
}

function renderTheoryLive() {
  const line = LINE_BY_ID[state.colour];
  const { angles, wavelengthM } = lineFor(state.colour);
  const result = allResults()[state.colour];
  const orderValidity = SPECTRAL_LINES.map((entry) => {
    const lambda = (state.reference[entry.id] || entry.angstrom) * 1e-10;
    return `${entry.name}: n ≤ ${maxOrder(lambda)}`;
  }).join(" · ");

  el["theory-live"].innerHTML = `
    <dl class="live-values">
      <div><dt>Grating element d</dt><dd>${formatNumber(GRATING_ELEMENT_ANGSTROM, 2)} Å = ${GRATING_ELEMENT_M.toExponential(4)} m</dd></div>
      <div><dt>Order n</dt><dd>${state.order}</dd></div>
      <div><dt>Selected line</dt><dd><span class="colour-swatch" style="--swatch:${line.color}"></span>${line.name}</dd></div>
      <div><dt>Reference λ</dt><dd>${formatNumber(state.reference[state.colour], 1)} Å = ${formatWavelength(wavelengthM, state.unit, 1)}</dd></div>
      <div><dt>sin θ = n λ / d</dt><dd>${angles.sinTheta.toFixed(6)}</dd></div>
      <div><dt>Theoretical θ</dt><dd>${angles.valid ? formatDMS(angles.rightDeg, { seconds: true }) : "no real solution"}</dd></div>
      <div><dt>Measured θ</dt><dd>${result && result.valid ? `${result.thetaDeg.toFixed(4)}° (${formatDMS(result.thetaDeg, { seconds: true })})` : "—"}</dd></div>
      <div><dt>Telescope</dt><dd>${formatDMS(normalizeDegrees(state.telescope + state.zeroOffset), { seconds: true })} on the scale</dd></div>
    </dl>
    <p class="live-note">Maximum physically possible order with these wavelengths: ${orderValidity}.</p>
  `;
  if (el["order-validity"]) {
    el["order-validity"].textContent = ` With the current reference values: ${orderValidity}.`;
  }
}

/* ------------------------------------------------------------------ */
/* Settings, tabs                                                      */
/* ------------------------------------------------------------------ */

function applySettings() {
  document.documentElement.style.setProperty("--anim-speed", String(state.animation));
  document.body.classList.toggle("high-contrast", state.contrast);
  el["contrast-toggle"].setAttribute("aria-pressed", String(state.contrast));
  el["contrast-toggle"].textContent = state.contrast ? "Standard contrast" : "High contrast";
  el["animation-speed"].value = String(state.animation);
}

function setupTabs() {
  const tabs = [
    { button: el["tab-live"], panel: el["panel-live"], render: null },
    { button: el["tab-notebook"], panel: el["panel-notebook"], render: renderNotebook },
    { button: el["tab-theory"], panel: el["panel-theory"], render: renderTheoryLive },
    { button: el["tab-viva"], panel: el["panel-viva"], render: renderViva },
    { button: el["tab-journal"], panel: el["panel-journal"], render: renderJournal },
  ];
  const activate = (index) => {
    tabs.forEach((tab, tabIndex) => {
      const active = tabIndex === index;
      tab.button.classList.toggle("is-active", active);
      tab.button.setAttribute("aria-selected", String(active));
      tab.button.tabIndex = active ? 0 : -1;
      tab.panel.hidden = !active;
      if (active && tab.render) tab.render();
    });
    tabs[index].button.focus({ preventScroll: true });
  };
  tabs.forEach((tab, index) => {
    tab.button.addEventListener("click", () => activate(index));
    tab.button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        activate((index + 1) % tabs.length);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        activate((index - 1 + tabs.length) % tabs.length);
      } else if (event.key === "Home") {
        event.preventDefault();
        activate(0);
      } else if (event.key === "End") {
        event.preventDefault();
        activate(tabs.length - 1);
      }
    });
  });
}

function openTab(panelId) {
  const map = {
    "panel-live": el["tab-live"],
    "panel-notebook": el["tab-notebook"],
    "panel-theory": el["tab-theory"],
    "panel-viva": el["tab-viva"],
    "panel-journal": el["tab-journal"],
  };
  map[panelId]?.click();
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function setLamp(on) {
  state.lampOn = Boolean(on);
  if (!on) {
    state.locked = false;
  }
  renderAll();
  notify(on ? "Mercury lamp on. The incident beam now reaches the collimator." : "Mercury lamp switched off.");
}

function setCollimator(aligned) {
  state.collimatorAligned = Boolean(aligned);
  renderAll();
  notify(
    aligned
      ? "Collimator adjusted: the slit is at the focus, so the emergent beam is parallel and the lines become sharp."
      : "The collimator is out of focus, so the rays diverge and the spectral lines are blurred.",
  );
}

function setGrating(mounted) {
  state.gratingMounted = Boolean(mounted);
  if (!mounted) state.locked = false;
  renderAll();
  notify(mounted ? "Grating mounted on the turntable." : "Grating removed from the turntable.");
}

function setLocked(locked) {
  state.locked = Boolean(locked);
  renderAll();
  notify(locked ? "Telescope locked. The scale reading is now fixed." : "Telescope unlocked. You can rotate it again.");
}

/**
 * Swings the telescope onto the selected spectral line.
 *
 * The angle comes from the same `apparentAngles` result that drives the
 * diagram and the alignment badge, and it is written into the same
 * `state.telescope` variable as the dial, the drag handle and the arrow keys,
 * so the rendered tube, the vernier readout and the alignment test all update
 * together.
 */
function pointTelescopeAtSelectedLine() {
  if (state.locked) {
    notify("The telescope is locked. Unlock it before rotating it.");
    return;
  }
  if (!state.lampOn) {
    notify("Switch on the mercury lamp to see where the line lies.");
    return;
  }
  if (!state.gratingMounted) {
    notify("Mount the diffraction grating before looking for a spectral line.");
    return;
  }
  const info = lineAngle(state.colour, state.side);
  if (!info.valid) {
    notify(`The ${LINE_BY_ID[state.colour].name.toLowerCase()} line is not visible in order ${state.order} on the ${state.side}.`);
    return;
  }
  const { angleDeg } = lineTelescopeAngle(info.angles, state.side);
  if (!Number.isFinite(angleDeg)) {
    notify("That line cannot be reached with the telescope's travel.");
    return;
  }
  const target = clampTelescope(angleDeg);
  state.telescope = target;
  renderAll();
  notify(
    `Telescope swung to ${formatDMS(normalizeDegrees(target + state.zeroOffset), { seconds: true })} on the scale; the ${LINE_BY_ID[state.colour].name.toLowerCase()} line is centred on the crosswire.`,
  );
}

function nudgeTelescope(deltaDeg) {
  if (state.locked) {
    notify("The telescope is locked. Unlock it before rotating.");
    return;
  }
  state.telescope = clampTelescope(state.telescope + deltaDeg);
  renderAll();
}

function startSide(side) {
  if (!setupComplete()) {
    notify("Complete the apparatus setup before measuring.");
    return;
  }
  state.side = side;
  goToStage(side === "left" ? 4 : 5);
}

function selectColour(colourId) {
  if (!LINE_BY_ID[colourId]) return;
  state.colour = colourId;
  el["calculation-colour"].value = colourId;
  const row = readingsFor(colourId);
  if (!row.left) {
    state.side = "left";
    if (state.mode === "guided" && setupComplete()) state.stage = 4;
    else if (state.mode === "guided") state.stage = 3;
  } else if (!row.right) {
    state.side = "right";
    if (state.mode === "guided" && setupComplete()) state.stage = 5;
  }
  renderAll();
  notify(`${LINE_BY_ID[colourId].name} selected. Align its line with the vertical crosswire.`);
}

function goToStage(stageNumber) {
  const target = clamp(Math.round(stageNumber), 1, 9);
  if (!allowedStages().has(target)) {
    notify(stageLockMessage(target));
    return;
  }
  state.stage = target;
  if (target === 4) state.side = "left";
  if (target === 5) state.side = "right";
  if (target === 3 && readingsComplete()) {
    // still valid: the student may revisit the spectrum
  }
  renderAll();
  const targetPanel = target >= 6 ? el["results-section"] : el["apparatus-panel"];
  targetPanel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function stageLockMessage(target) {
  if (target === 4 || target === 5) return "Finish the apparatus setup before taking readings.";
  if (target >= 6) {
    const row = readingsFor(state.colour);
    if (!row.left || !row.right) {
      return `Record both the left and right ${LINE_BY_ID[state.colour].name.toLowerCase()} readings before this stage.`;
    }
  }
  if (target === 9) return "Record all four colours to complete the experiment.";
  return "This stage is not available yet.";
}

function recordReading(side) {
  if (!state.lampOn) {
    notify("Switch on the mercury lamp first.");
    return;
  }
  if (!state.gratingMounted) {
    notify("Mount the diffraction grating before taking readings.");
    return;
  }
  if (!state.collimatorAligned) {
    notify("Align the collimator. Divergent rays make the line positions unreliable.");
    return;
  }
  if (!state.locked) {
    notify("Lock the telescope before recording a reading.");
    return;
  }
  const info = lineAngle(state.colour, side);
  if (!info.valid) {
    notify(`The ${LINE_BY_ID[state.colour].name.toLowerCase()} line is not visible in order ${state.order} on the ${side}.`);
    return;
  }
  const offset = shortestDelta(state.telescope, info.angle);
  const tolerance = slitTolerance();
  if (Math.abs(offset) > tolerance) {
    notify(`The line is ${formatDMS(Math.abs(offset), { seconds: true })} from the crosswire. Centre it before recording (tolerance ${formatDMS(tolerance, { seconds: true })}).`);
    return;
  }

  const reading = roundToArcSecond(state.telescope + state.zeroOffset);
  const row = { ...readingsFor(state.colour) };
  const opposite = side === "left" ? "right" : "left";
  let replacedOrderNote = "";
  if (row[opposite] && row[opposite].order !== state.order) {
    delete row[opposite];
    replacedOrderNote = " The earlier reading on the other side belonged to a different order and has been cleared.";
  }
  row[side] = {
    reading,
    telescope: state.telescope,
    source: "simulated",
    order: state.order,
    tolerance,
  };
  state.readings[state.colour] = row;
  state.history.unshift({
    time: Date.now(),
    colour: state.colour,
    side,
    reading,
    order: state.order,
  });
  state.history = state.history.slice(0, 40);

  const name = LINE_BY_ID[state.colour].name;
  notify(`${side === "left" ? "Left" : "Right"} ${name} reading recorded: ${formatDMS(reading, { seconds: true })} (order ${state.order}).${replacedOrderNote}`);

  if (state.mode === "guided") {
    if (side === "left" && state.stage === 4) {
      state.stage = 5;
      state.side = "right";
    } else if (side === "right" && state.stage === 5) {
      state.stage = 6;
    }
  }
  renderAll();
}

function nextColour() {
  const order = [state.colour, ...LINE_IDS.filter((id) => id !== state.colour)];
  const next = order.find((id) => !hasBothReadings(id));
  if (!next) {
    goToStage(9);
    notify("All four colours are measured. The complete observation table is ready.");
    return;
  }
  state.colour = next;
  el["calculation-colour"].value = next;
  state.side = "left";
  state.stage = 3;
  renderAll();
  notify(`${LINE_BY_ID[next].name} selected. Observe both sides, then measure the left-hand line.`);
}

function updateReference(colourId, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    notify("Reference wavelengths must be positive numbers in ångström.");
    renderControlValues();
    return;
  }
  if (numeric > 20000) {
    notify("That reference wavelength is beyond the grating element (16 933 Å). Enter a visible-light value.");
    renderControlValues();
    return;
  }
  state.reference[colourId] = numeric;
  renderAll();
}

function resetExperiment() {
  const confirmed = window.confirm(
    "Reset the experiment? All measured readings, manual entries and measurement history for this session will be deleted. Reference values and display settings are kept.",
  );
  if (!confirmed) return;
  const keep = {
    reference: { ...state.reference },
    unit: state.unit,
    showSeconds: state.showSeconds,
    showLeft: state.showLeft,
    showRight: state.showRight,
    animation: state.animation,
    contrast: state.contrast,
    notebookRows: state.notebookRows,
  };
  state = createDefaultState();
  Object.assign(state, keep);
  state.stage = 1;
  state.mode = "guided";
  renderAll();
  notify("Experiment reset. All live readings were deleted; the notebook dataset is unchanged.");
}

function resetControls() {
  state.lampOn = false;
  state.collimatorAligned = false;
  state.gratingMounted = false;
  state.slitWidth = 0.2;
  state.tilt = 1.8;
  state.telescope = 0;
  state.locked = false;
  renderAll();
  notify("Apparatus controls reset. Recorded readings were kept.");
}

function clearStorage() {
  const confirmed = window.confirm("Clear the saved experiment data from this browser? The page keeps its current measurements until you reload.");
  if (!confirmed) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    notify("Saved data cleared from this browser.");
    el["storage-note"].textContent = "Saved data cleared. Progress will be saved again after the next action.";
  } catch (error) {
    notify("This browser blocked local storage.");
  }
}

/* ------------------------------------------------------------------ */
/* Notebook data                                                       */
/* ------------------------------------------------------------------ */

function notebookResults() {
  return state.notebookRows.map((row) => {
    const left = parseAngle(row.left);
    const right = parseAngle(row.right);
    const solution = solveFromReadings(
      left.ok ? left.degrees : NaN,
      right.ok ? right.degrees : NaN,
      1,
    );
    const standard = state.reference[row.id] || LINE_BY_ID[row.id]?.angstrom;
    const deviation = percentageDeviation(solution.wavelengthAngstrom, standard);
    return { row, left, right, solution, standard, deviation };
  });
}

function renderNotebook() {
  if (!el["notebook-body"]) return;
  const rows = notebookResults();
  el["notebook-body"].innerHTML = rows.length
    ? rows
        .map(({ row, left, right, solution }) => {
          const valid = left.ok && right.ok && solution.valid;
          return `
            <tr>
              <th scope="row" class="cell-colour">
                <span class="colour-swatch" style="--swatch:${LINE_BY_ID[row.id].color}"></span>${LINE_BY_ID[row.id].name}
              </th>
              <td class="cell-reading">
                <input class="reading-input" id="nb-left-${row.id}" data-notebook="left" data-colour="${row.id}" type="text" value="${escapeHtml(row.left)}" aria-label="Notebook left reading for ${LINE_BY_ID[row.id].name}" />
              </td>
              <td class="cell-reading">
                <input class="reading-input" id="nb-right-${row.id}" data-notebook="right" data-colour="${row.id}" type="text" value="${escapeHtml(row.right)}" aria-label="Notebook right reading for ${LINE_BY_ID[row.id].name}" />
              </td>
              <td class="cell-computed">${valid ? formatDMS(solution.separationDeg, { seconds: true }) : "—"}</td>
              <td class="cell-computed">${valid ? formatDMS(solution.thetaDeg, { seconds: true }) : "—"}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="table-empty">The notebook dataset is empty. Restore it or paste a new dataset below.</td></tr>`;

  el["notebook-results"].innerHTML = rows.length
    ? rows
        .map(({ row, solution, standard, deviation }) => `
          <tr>
            <th scope="row" class="cell-colour">
              <span class="colour-swatch" style="--swatch:${LINE_BY_ID[row.id].color}"></span>${LINE_BY_ID[row.id].name}
            </th>
            <td class="cell-computed">${solution.valid ? solution.sinTheta.toFixed(6) : "—"}</td>
            <td class="cell-computed is-strong">${solution.valid ? formatNumber(solution.wavelengthAngstrom, 1) : "—"}</td>
            <td class="cell-computed">${formatNumber(standard, 1)}</td>
            <td class="cell-computed ${deviationClass(deviation.signed)}">${solution.valid ? formatSignedPercent(deviation.signed) : "—"}</td>
            <td class="cell-computed ${deviationClass(deviation.signed)}">${solution.valid ? formatPercentPlain(deviation.absolute) : "—"}</td>
          </tr>
        `)
        .join("")
    : `<tr><td colspan="6" class="table-empty">No imported readings.</td></tr>`;

  const valid = rows.filter((entry) => entry.solution.valid);
  el["notebook-chip"].textContent = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
  el["notebook-result-chip"].textContent = valid.length === rows.length && rows.length ? "Recalculated from readings" : "Partial data";
  el["notebook-summary"].textContent = valid.length
    ? `Recomputed from the imported readings with d = ${formatNumber(GRATING_ELEMENT_ANGSTROM, 2)} Å and n = 1. Mean absolute deviation: ${(
        valid.reduce((sum, entry) => sum + entry.deviation.absolute, 0) / valid.length
      ).toFixed(2)} %. These are notebook readings, not measurements produced by the simulation.`
    : "Enter valid readings in degrees and minutes to recompute the wavelengths.";
}

function updateNotebookReading(colourId, side, text) {
  const row = state.notebookRows.find((entry) => entry.id === colourId);
  if (!row) return;
  const parsed = parseAngle(text);
  if (!parsed.ok) {
    notify(`Notebook ${side} reading: ${parsed.error}`);
    renderNotebook();
    return;
  }
  row[side] = text.trim();
  renderNotebook();
  saveState();
}

function restoreNotebook() {
  state.notebookRows = NOTEBOOK_READINGS.map((row) => ({ ...row }));
  el["notebook-input"].value = NOTEBOOK_READINGS.map((row) => `${row.name}, ${row.left}, ${row.right}`).join("\n");
  el["notebook-feedback"].textContent = "Original notebook readings restored.";
  renderNotebook();
  saveState();
}

function clearNotebook() {
  const confirmed = window.confirm("Clear the imported notebook dataset? The live experiment is not affected.");
  if (!confirmed) return;
  state.notebookRows = [];
  el["notebook-feedback"].textContent = "Notebook dataset cleared.";
  renderNotebook();
  saveState();
}

function applyNotebookDataset() {
  const text = el["notebook-input"].value;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    el["notebook-feedback"].textContent = "Paste at least one line: Colour, left reading, right reading.";
    return;
  }
  const next = [];
  const errors = [];
  for (const [index, line] of lines.entries()) {
    const parts = line.split(/[,;\t]/).map((part) => part.trim());
    if (parts.length < 3) {
      errors.push(`Line ${index + 1}: expected "Colour, left, right".`);
      continue;
    }
    const id = LINE_IDS.find((candidate) => LINE_BY_ID[candidate].name.toLowerCase() === parts[0].toLowerCase());
    if (!id) {
      errors.push(`Line ${index + 1}: unknown colour "${parts[0]}".`);
      continue;
    }
    if (next.some((row) => row.id === id)) {
      errors.push(`Line ${index + 1}: ${parts[0]} appears more than once.`);
      continue;
    }
    const left = parseAngle(parts[1]);
    const right = parseAngle(parts[2]);
    if (!left.ok) {
      errors.push(`Line ${index + 1}: left reading — ${left.error}`);
      continue;
    }
    if (!right.ok) {
      errors.push(`Line ${index + 1}: right reading — ${right.error}`);
      continue;
    }
    next.push({ id, name: LINE_BY_ID[id].name, left: parts[1], right: parts[2] });
  }
  if (errors.length) {
    el["notebook-feedback"].textContent = `Dataset not applied. ${errors.join(" ")}`;
    return;
  }
  state.notebookRows = next;
  el["notebook-feedback"].textContent = `Dataset applied: ${next.length} ${next.length === 1 ? "colour" : "colours"} (${next.map((row) => row.name).join(", ")}).`;
  renderNotebook();
  saveState();
  notify("Notebook dataset replaced. The live observation table is unchanged.");
}

/* ------------------------------------------------------------------ */
/* Viva                                                                */
/* ------------------------------------------------------------------ */

function renderViva() {
  if (el["viva-list"].childElementCount) return;
  el["viva-list"].innerHTML = VIVA_QUESTIONS.map(
    (item, index) => `
      <li class="viva-item">
        <details>
          <summary><span class="viva-index">${index + 1}</span>${escapeHtml(item.question)}</summary>
          <div class="viva-answer">
            <p>${escapeHtml(item.answer)}</p>
            ${item.math ? `<p class="formula-block">${escapeHtml(item.math)}</p>` : ""}
          </div>
        </details>
      </li>
    `,
  ).join("");

  el["viva-numeric"].innerHTML = VIVA_NUMERICALS.map(
    (item, index) => `
      <div class="numeric-item" data-numeric="${item.id}">
        <p class="numeric-question"><span class="viva-index">${index + 1}</span>${escapeHtml(item.question)}</p>
        <div class="numeric-row">
          <label class="sr-only" for="numeric-${item.id}">Answer for numerical question ${index + 1}</label>
          <input id="numeric-${item.id}" data-numeric-input="${item.id}" type="text" inputmode="decimal" placeholder="Your answer" />
          <button class="button button-small" type="button" data-numeric-check="${item.id}">Check</button>
          <span class="numeric-feedback" data-numeric-feedback="${item.id}" role="status"></span>
        </div>
        <details>
          <summary>Show the worked answer</summary>
          <p>${escapeHtml(item.answer)}</p>
        </details>
      </div>
    `,
  ).join("");

  el["viva-numeric"].querySelectorAll("[data-numeric-check]").forEach((button) => {
    button.addEventListener("click", () => checkNumeric(button.dataset.numericCheck));
  });
  el["viva-numeric"].querySelectorAll("[data-numeric-input]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        checkNumeric(input.dataset.numericInput);
      }
    });
  });
}

function checkNumeric(id) {
  const input = el["viva-numeric"].querySelector(`[data-numeric-input="${id}"]`);
  const feedback = el["viva-numeric"].querySelector(`[data-numeric-feedback="${id}"]`);
  if (!input || !feedback) return;
  const answer = NUMERICAL_ANSWERS[id];
  const value = Number(String(input.value).replace(/[^0-9.\-eE+]/g, ""));
  if (!Number.isFinite(value)) {
    feedback.textContent = "Enter a number.";
    feedback.className = "numeric-feedback is-bad";
    return;
  }
  if (Math.abs(value - answer.value) <= answer.tolerance) {
    feedback.textContent = "Correct.";
    feedback.className = "numeric-feedback is-good";
  } else {
    feedback.textContent = `Not quite. Expected about ${answer.value}${answer.unit ? ` ${answer.unit}` : ""}.`;
    feedback.className = "numeric-feedback is-bad";
  }
}

/* ------------------------------------------------------------------ */
/* Exports, journal and print                                          */
/* ------------------------------------------------------------------ */

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv() {
  const lines = [];
  lines.push(`Diffraction grating experiment,15000 lines per inch`);
  lines.push(`Grating element d (cm),${GRATING_ELEMENT_ANGSTROM * 1e-8}`);
  lines.push(`Grating element d (m),${GRATING_ELEMENT_M}`);
  lines.push(`Grating element d (angstrom),${GRATING_ELEMENT_ANGSTROM}`);
  lines.push(`Date,${new Date().toISOString()}`);
  lines.push("");
  lines.push("Table A - Angular observations");
  lines.push(
    ["S. no.", "Colour", "Left reading", "Right reading", "2 theta", "theta", "Order", "Left source", "Right source"]
      .join(","),
  );
  SPECTRAL_LINES.forEach((line, index) => {
    const row = readingsFor(line.id);
    const result = allResults()[line.id];
    lines.push(
      [
        index + 1,
        line.name,
        row.left ? formatDMSAscii(row.left.reading) : "",
        row.right ? formatDMSAscii(row.right.reading) : "",
        result && !result.mixedOrders ? formatDMSAscii(result.separationDeg) : "",
        result && !result.mixedOrders ? result.thetaDeg.toFixed(6) : "",
        row.left ? row.left.order : "",
        row.left ? row.left.source : "",
        row.right ? row.right.source : "",
      ]
        .map(csvEscape)
        .join(","),
    );
  });
  lines.push("");
  lines.push("Table B - Wavelength calculations");
  lines.push(
    ["S. no.", "Colour", "sin theta", "lambda_exp (angstrom)", "lambda_std (angstrom)", "Signed deviation (%)", "Absolute deviation (%)"]
      .join(","),
  );
  SPECTRAL_LINES.forEach((line, index) => {
    const result = allResults()[line.id];
    if (result && result.valid) {
      lines.push(
        [
          index + 1,
          line.name,
          result.sinTheta.toFixed(8),
          result.wavelengthAngstrom.toFixed(3),
          result.standard.toFixed(1),
          result.deviation.signed.toFixed(4),
          result.deviation.absolute.toFixed(4),
        ]
          .map(csvEscape)
          .join(","),
      );
    } else {
      lines.push([index + 1, line.name, "", "", state.reference[line.id], "", ""].map(csvEscape).join(","));
    }
  });
  lines.push("");
  lines.push("Conclusion");
  lines.push(csvEscape(buildConclusion(resolvedResults())));
  return lines.join("\r\n");
}

function download(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCsv() {
  const date = new Date().toISOString().slice(0, 10);
  download(`diffraction-grating-observations-${date}.csv`, buildCsv());
  notify("Observation tables exported as CSV.");
}

function notebookCsv() {
  const lines = ["Imported notebook data - diffraction grating", ""];
  lines.push(["Colour", "Left reading", "Right reading", "2 theta", "theta", "lambda_exp (angstrom)"].join(","));
  for (const entry of notebookResults()) {
    lines.push(
      [
        entry.row.name,
        entry.row.left,
        entry.row.right,
        entry.solution.valid ? formatDMSAscii(entry.solution.separationDeg) : "",
        entry.solution.valid ? formatDMSAscii(entry.solution.thetaDeg) : "",
        entry.solution.valid ? entry.solution.wavelengthAngstrom.toFixed(3) : "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  download(`diffraction-grating-notebook-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\r\n"));
  notify("Notebook dataset exported as CSV.");
}

function observationTableHtml() {
  const rows = SPECTRAL_LINES.map((line, index) => {
    const reading = readingsFor(line.id);
    const result = allResults()[line.id];
    return `<tr>
      <td>${index + 1}</td>
      <td>${line.name}</td>
      <td>${reading.left ? formatDMS(reading.left.reading, { seconds: true }) : "—"}</td>
      <td>${reading.right ? formatDMS(reading.right.reading, { seconds: true }) : "—"}</td>
      <td>${result && !result.mixedOrders ? formatDMS(result.separationDeg, { seconds: true }) : "—"}</td>
      <td>${result && !result.mixedOrders ? formatDMS(result.thetaDeg, { seconds: true }) : "—"}</td>
    </tr>`;
  }).join("");

  const calcRows = SPECTRAL_LINES.map((line, index) => {
    const result = allResults()[line.id];
    return `<tr>
      <td>${index + 1}</td>
      <td>${line.name}</td>
      <td>${result && result.valid ? result.sinTheta.toFixed(6) : "—"}</td>
      <td>${result && result.valid ? formatNumber(result.wavelengthAngstrom, 1) : "—"}</td>
      <td>${formatNumber(state.reference[line.id], 1)}</td>
      <td>${result && result.valid ? formatSignedPercent(result.deviation.signed) : "—"}</td>
      <td>${result && result.valid ? formatPercentPlain(result.deviation.absolute) : "—"}</td>
    </tr>`;
  }).join("");

  return { rows, calcRows };
}

function calculationHtml() {
  const blocks = SPECTRAL_LINES.map((line) => {
    const result = allResults()[line.id];
    if (!result || !result.valid) {
      return `<div class="journal-calculation"><h4>${line.name}</h4><p>Not measured.</p></div>`;
    }
    return `<div class="journal-calculation">
      <h4>${line.name} (n = ${result.order})</h4>
      <p>θ<sub>1</sub> = ${formatDMS(result.measured.left.reading, { seconds: true })}, θ<sub>2</sub> = ${formatDMS(result.measured.right.reading, { seconds: true })}</p>
      <p>2θ = |θ<sub>2</sub> − θ<sub>1</sub>| = ${formatDMS(result.separationDeg, { seconds: true })}; θ = ${formatDMS(result.thetaDeg, { seconds: true })} = ${result.thetaDeg.toFixed(5)}°</p>
      <p>sin θ = ${result.sinTheta.toFixed(6)}</p>
      <p>λ<sub>exp</sub> = d sin θ / n = ${formatNumber(GRATING_ELEMENT_ANGSTROM, 2)} × ${result.sinTheta.toFixed(6)} / ${result.order} = <strong>${formatNumber(result.wavelengthAngstrom, 1)} Å</strong> = ${formatNumber(result.wavelengthNm, 2)} nm</p>
      <p>% deviation = ((${formatNumber(result.wavelengthAngstrom, 1)} − ${formatNumber(result.standard, 1)}) / ${formatNumber(result.standard, 1)}) × 100 = ${formatSignedPercent(result.deviation.signed)} (absolute ${formatPercentPlain(result.deviation.absolute)})</p>
    </div>`;
  }).join("");
  return blocks;
}

function journalHtml({ print = false } = {}) {
  const valid = resolvedResults();
  const { rows, calcRows } = observationTableHtml();
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const header = print
    ? `<div class="journal-print-head">
        <p class="journal-institution">PCCOE · Department of Applied Physics</p>
        <h1>Engineering Physics Laboratory Record</h1>
        <p>Experiment No. 2 · Diffraction grating · ${date}</p>
      </div>`
    : "";

  return `
    ${header}
    <header class="journal-head">
      <p class="journal-label">Experiment No. 2</p>
      <h2>Determination of the wavelengths of different colours of light using a diffraction grating</h2>
    </header>
    <dl class="journal-meta">
      <div><dt>Aim</dt><dd>To determine the wavelengths of the different colours of light using a plane diffraction grating, and to compare them with the standard values.</dd></div>
      <div><dt>Apparatus</dt><dd>Spectrometer, plane diffraction grating (15 000 lines per inch), mercury vapour lamp, collimator, telescope with crosswire, reading lens.</dd></div>
      <div><dt>Formula</dt><dd>d sin θ = n λ, with d = 2.54 / 15 000 cm = ${formatNumber(GRATING_ELEMENT_ANGSTROM, 2)} Å; λ = d sin θ / n and θ = 2θ / 2.</dd></div>
      <div><dt>Least count</dt><dd>Spectrometer scale: 1° divisions, vernier reading to 1′; simulation readout to 1″.</dd></div>
    </dl>
    <h3>Observations</h3>
    <table class="journal-table">
      <thead><tr><th>S. no.</th><th>Colour</th><th>θ<sub>1</sub></th><th>θ<sub>2</sub></th><th>2θ</th><th>θ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="journal-table">
      <thead><tr><th>S. no.</th><th>Colour</th><th>sin θ</th><th>λ<sub>exp</sub> (Å)</th><th>λ<sub>std</sub> (Å)</th><th>Signed deviation</th><th>|Deviation|</th></tr></thead>
      <tbody>${calcRows}</tbody>
    </table>
    <h3>Calculations</h3>
    <div class="journal-calculations">${calculationHtml()}</div>
    <h3>Result</h3>
    <p>${
      valid.length
        ? `The wavelengths determined experimentally are: ${SPECTRAL_LINES.map((line) => {
            const row = allResults()[line.id];
            return row && row.valid ? `${line.name} ${formatNumber(row.wavelengthAngstrom, 1)} Å` : null;
          })
            .filter(Boolean)
            .join("; ")}.`
        : "The experiment is incomplete; record both readings for each colour."
    }</p>
    <h3>Conclusion</h3>
    <p>${escapeHtml(buildConclusion(valid))}</p>
    <p class="journal-footnote">Generated by the PCCOE virtual laboratory on ${date}. Percentage deviation uses the manual's formula ((λ<sub>exp</sub> − λ<sub>std</sub>) / λ<sub>std</sub>) × 100. Imported notebook data is not included in this record.</p>
  `;
}

function renderJournal() {
  if (!el["journal-content"]) return;
  el["journal-content"].innerHTML = journalHtml();
}

function printRecord() {
  const report = el["print-report"];
  if (report) {
    report.innerHTML = journalHtml({ print: true });
  }
  renderJournal();
  window.print();
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

function bindEvents() {
  el["lamp-toggle"].addEventListener("click", () => setLamp(!state.lampOn));
  el["collimator-align"].addEventListener("click", () => setCollimator(!state.collimatorAligned));
  el["grating-mount"].addEventListener("click", () => setGrating(!state.gratingMounted));
  el["telescope-lock"].addEventListener("click", () => setLocked(!state.locked));

  el["slit-width"].addEventListener("input", (event) => {
    state.slitWidth = clamp(Number(event.target.value), 0.05, 1);
    renderAll();
  });
  el["grating-tilt"].addEventListener("input", (event) => {
    state.tilt = clamp(Number(event.target.value), -3, 3);
    renderAll();
  });
  el["zero-grating"].addEventListener("click", () => {
    state.tilt = 0;
    renderAll();
    notify("Grating normal set perpendicular to the incident beam (0.0°).");
  });

  el["order-1"].addEventListener("change", () => setOrder(1));
  el["order-2"].addEventListener("change", () => setOrder(2));

  el["apply-zero"].addEventListener("click", () => {
    const degrees = clamp(Number(el["vernier-zero-deg"].value) || 0, 0, 359);
    const minutes = clamp(Number(el["vernier-zero-min"].value) || 0, 0, 59);
    state.zeroOffset = normalizeDegrees(degrees + minutes / 60);
    renderAll();
    notify(`Vernier zero set to ${formatDMS(state.zeroOffset, { seconds: false })}.`);
  });

  el["telescope-left"].addEventListener("click", () => nudgeTelescope(30 * ARC_MINUTE));
  el["telescope-right"].addEventListener("click", () => nudgeTelescope(-30 * ARC_MINUTE));
  el["telescope-left-fine"].addEventListener("click", () => nudgeTelescope(ARC_MINUTE));
  el["telescope-right-fine"].addEventListener("click", () => nudgeTelescope(-ARC_MINUTE));
  el["telescope-left-micro"].addEventListener("click", () => nudgeTelescope(ARC_SECOND * 10));
  el["telescope-right-micro"].addEventListener("click", () => nudgeTelescope(-ARC_SECOND * 10));

  el["telescope-reset"].addEventListener("click", () => {
    if (state.locked) {
      notify("Unlock the telescope before moving it.");
      return;
    }
    state.telescope = 0;
    renderAll();
    notify("Telescope returned to the central maximum direction.");
  });

  el["align-line"].addEventListener("click", pointTelescopeAtSelectedLine);

  el["record-left"].addEventListener("click", () => recordReading("left"));
  el["record-right"].addEventListener("click", () => recordReading("right"));

  el["guide-action"].addEventListener("click", () => {
    const action = GUIDE_ACTIONS[el["guide-action"].dataset.action];
    if (action && action.run) action.run();
  });
  el["guide-open-theory"].addEventListener("click", () => openTab("panel-theory"));
  const startExperiment = () => {
    state.stage = 2;
    el["grating-lab"]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    renderAll();
    notify("Experiment started. Switch on the mercury lamp to begin the apparatus setup.");
  };
  el["start-experiment"].addEventListener("click", startExperiment);
  el["stage-start"].addEventListener("click", startExperiment);

  el["mode-toggle"].addEventListener("click", () => {
    state.mode = state.mode === "guided" ? "free" : "guided";
    if (state.mode === "free") state.stage = 3;
    renderAll();
    notify(
      state.mode === "free"
        ? "Free-observation mode. Explore the spectrum and record readings in any order."
        : "Guided mode restored. The lab guide will walk through the remaining steps.",
    );
  });

  el["side-left"].addEventListener("change", () => {
    state.side = "left";
    renderAll();
  });
  el["side-right"].addEventListener("change", () => {
    state.side = "right";
    renderAll();
  });

  el["show-left"].addEventListener("change", (event) => {
    state.showLeft = event.target.checked;
    renderAll();
  });
  el["show-right"].addEventListener("change", (event) => {
    state.showRight = event.target.checked;
    renderAll();
  });

  el["wavelength-unit"].addEventListener("change", (event) => {
    state.unit = event.target.value;
    renderAll();
  });
  el["show-seconds"].addEventListener("change", (event) => {
    state.showSeconds = event.target.checked;
    renderAll();
  });

  el["calculation-colour"].addEventListener("change", (event) => {
    renderWorkedCalculation();
  });

  for (const [id, input] of Object.entries(referenceInputs())) {
    input.addEventListener("change", (event) => updateReference(id, event.target.value));
    input.addEventListener("blur", () => renderControlValues());
  }

  el["table-a-body"].addEventListener("change", (event) => {
    const input = event.target.closest(".reading-input");
    if (!input) return;
    const { colour, side } = input.dataset;
    const parsed = parseAngle(input.value);
    if (!parsed.ok) {
      input.classList.add("is-invalid");
      input.setAttribute("title", parsed.error);
      notify(`Reading not saved: ${parsed.error}`);
      return;
    }
    const row = { ...readingsFor(colour) };
    row[side] = {
      reading: roundToArcSecond(parsed.normalized),
      telescope: normalizeDegrees(parsed.normalized - state.zeroOffset),
      source: "manual",
      order: state.order,
      tolerance: slitTolerance(),
    };
    state.readings[colour] = row;
    renderAll();
    notify(`Manual ${side} ${LINE_BY_ID[colour].name.toLowerCase()} reading accepted and recalculated.`);
  });

  el["table-a-body"].addEventListener("click", (event) => {
    const button = event.target.closest(".colour-button");
    if (button) selectColour(button.dataset.colour);
  });

  el["calculate-results"].addEventListener("click", () => {
    const missing = LINE_IDS.filter((id) => !hasBothReadings(id));
    const invalid = LINE_IDS.filter((id) => {
      const result = allResults()[id];
      return hasBothReadings(id) && (!result || !result.valid);
    });
    const fit = fitGratingElement(
      LINE_IDS.map((id) => {
        const result = allResults()[id];
        return result && result.valid ? { sinTheta: result.sinTheta, wavelengthM: result.wavelengthM } : null;
      }).filter(Boolean),
    );
    if (missing.length === 0) {
      goToStage(9);
      notify(
        `Results calculated for all four colours.${fit.valid ? ` Best-fit grating element: ${formatNumber(fit.slopeAngstrom, 0)} Å.` : ""}`,
      );
    } else if (invalid.length) {
      notify(`Check the readings for ${invalid.map((id) => LINE_BY_ID[id].name).join(", ")}: they do not produce a physical angle.`);
    } else {
      notify(
        `Calculated so far: ${4 - missing.length} of 4 colours. Missing: ${missing.map((id) => LINE_BY_ID[id].name).join(", ")}.`,
      );
    }
    renderAll();
  });

  el["reset-experiment"].addEventListener("click", resetExperiment);
  el["reset-controls"].addEventListener("click", resetControls);
  el["clear-storage"].addEventListener("click", clearStorage);
  el["export-csv"].addEventListener("click", exportCsv);
  el["print-record"].addEventListener("click", printRecord);
  el["journal-print"].addEventListener("click", printRecord);
  el["journal-csv"].addEventListener("click", exportCsv);

  el["notebook-restore"].addEventListener("click", restoreNotebook);
  el["notebook-clear"].addEventListener("click", clearNotebook);
  el["notebook-export"].addEventListener("click", notebookCsv);
  el["notebook-apply"].addEventListener("click", applyNotebookDataset);
  el["notebook-reset-text"].addEventListener("click", () => {
    el["notebook-input"].value = NOTEBOOK_READINGS.map((row) => `${row.name}, ${row.left}, ${row.right}`).join("\n");
    el["notebook-feedback"].textContent = "";
  });
  el["notebook-body"].addEventListener("change", (event) => {
    const input = event.target.closest(".reading-input");
    if (!input) return;
    updateNotebookReading(input.dataset.colour, input.dataset.notebook, input.value);
  });

  el["contrast-toggle"].addEventListener("click", () => {
    state.contrast = !state.contrast;
    applySettings();
    saveState();
  });
  el["animation-speed"].addEventListener("change", (event) => {
    state.animation = clamp(Number(event.target.value) || 1, 0.5, 2);
    applySettings();
    saveState();
  });

  // Navigation links to tab panels must open the tab, not jump to a hidden node.
  for (const link of document.querySelectorAll('a[href^="#panel-"]')) {
    link.addEventListener("click", (event) => {
      const panelId = link.getAttribute("href").slice(1);
      if (!document.getElementById(panelId)) return;
      event.preventDefault();
      openTab(panelId);
      el["grating-lab"]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  el["spectrometer-svg"].addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeTelescope(event.shiftKey ? ARC_MINUTE : 30 * ARC_MINUTE);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeTelescope(-(event.shiftKey ? ARC_MINUTE : 30 * ARC_MINUTE));
    } else if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      setLocked(!state.locked);
    } else if (event.key === "0") {
      event.preventDefault();
      el["telescope-reset"].click();
    }
  });
}

function setOrder(order) {
  const next = order === 2 ? 2 : 1;
  if (next === state.order) return;
  state.order = next;
  const invalid = LINE_IDS.filter((id) => {
    const info = lineAngle(id, state.side);
    return !info.valid;
  });
  renderAll();
  notify(
    next === 2
      ? `Second-order spectrum selected.${invalid.length ? ` Not available for ${invalid.map((id) => LINE_BY_ID[id].name).join(", ")}.` : ""}`
      : "First-order spectrum selected.",
  );
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

function buildColourButtons() {
  el["colour-select"].innerHTML = SPECTRAL_LINES.map(
    (line) => `
      <button type="button" class="colour-chip" data-colour="${line.id}" aria-pressed="${line.id === state.colour}">
        <span class="colour-swatch" style="--swatch:${line.color}"></span>
        <span>${line.name}</span>
      </button>
    `,
  ).join("");
  el["colour-select"].querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectColour(button.dataset.colour));
  });
}

function initialise() {
  try {
    collectElements();
    const loaded = loadState();
    buildColourButtons();
    setupTabs();
    apparatus = new GratingApparatus(el["spectrometer-svg"], {
      onRotate: (angle) => {
        if (state.locked) {
          apparatus.setTelescope(state.telescope);
          notify("The telescope is locked. Unlock it before rotating.");
          return;
        }
        state.telescope = angle;
        scheduleRender();
      },
      onInteraction: () => {},
    });
    bindEvents();
    el["calculation-colour"].value = state.colour;
    renderNotebook();
    renderViva();
    renderAll();
    if (loaded.restored) {
      el["storage-note"].textContent = "Previous session restored from this browser's local storage.";
      notify("Previous experiment progress restored.");
    } else if (loaded.blocked) {
      el["storage-note"].textContent = "Local storage is unavailable; progress will not be saved.";
    }
  } catch (error) {
    console.error(error);
    const status = document.getElementById("app-status");
    if (status) status.textContent = "The diffraction grating laboratory failed to initialise. Reload the page.";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise);
} else {
  initialise();
}
