import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const errors = [];
const skippedDirectories = new Set([
  ".git",
  ".cache",
  "node_modules",
  "dist",
  "coverage",
]);

function walk(relativeDir = "") {
  const absoluteDir = path.join(projectRoot, relativeDir);
  const results = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) results.push(...walk(relativePath));
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }
  return results;
}

const files = walk();
const javascriptFiles = files.filter((file) => /\.(?:js|mjs)$/i.test(file));

for (const file of javascriptFiles) {
  try {
    execFileSync(process.execPath, ["--check", path.join(projectRoot, file)], {
      stdio: "pipe",
    });
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString().trim() : error.message;
    errors.push(`Syntax error in ${file}: ${detail}`);
  }
}

for (const file of javascriptFiles) {
  const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
  for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
    const target = path.resolve(path.dirname(path.join(projectRoot, file)), match[1]);
    if (!fs.existsSync(target)) {
      errors.push(`Unresolved module import in ${file}: ${match[1]}`);
    }
  }
}

const htmlPath = path.join(projectRoot, "index.html");
const cssPath = path.join(projectRoot, "src", "styles.css");
const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const ids = new Set();
const duplicateIds = new Set();
for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
  if (ids.has(match[1])) duplicateIds.add(match[1]);
  ids.add(match[1]);
}
for (const id of duplicateIds) errors.push(`Duplicate id in index.html: #${id}`);

// Template strings in JavaScript must not reuse an id that already exists in
// the document (getElementById would silently return the wrong element).
for (const file of javascriptFiles) {
  const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
  for (const match of source.matchAll(/\sid="([A-Za-z][\w-]*)"/g)) {
    if (ids.has(match[1])) {
      errors.push(`JavaScript-generated id collides with index.html: #${match[1]} (${file})`);
    }
  }
}

const forIds = new Set(Array.from(html.matchAll(/\sfor="([^"]+)"/g), (match) => match[1]));

const requiredIds = [
  // Shell
  "main",
  "top",
  "grating-lab",
  "shm-simulation",
  "model-notes",
  // Diffraction grating laboratory
  "spectrometer-svg",
  "spectrometer-title",
  "spectrometer-desc",
  "eyepiece-svg",
  "eyepiece-status",
  "spectrum-legend",
  "stage-list",
  "stage-progress",
  "guide-text",
  "guide-action",
  "lamp-toggle",
  "collimator-align",
  "grating-mount",
  "slit-width",
  "grating-tilt",
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
  "record-left",
  "record-right",
  "readout-dms",
  "readout-raw",
  "readout-telescope",
  "readout-offset",
  "readout-line",
  "readout-alignment",
  "alignment-state",
  "colour-select",
  "show-left",
  "show-right",
  "wavelength-unit",
  "show-seconds",
  "table-a-body",
  "table-b-body",
  "calculation-colour",
  "worked-calculation",
  "graph-svg",
  "result-list",
  "conclusion-text",
  "history-list",
  "ref-violet",
  "ref-green",
  "ref-yellow",
  "ref-red",
  "calculate-results",
  "export-csv",
  "print-record",
  "reset-experiment",
  "clear-storage",
  "mode-toggle",
  "contrast-toggle",
  "animation-speed",
  "start-experiment",
  "theory-live",
  "order-validity",
  "notebook-body",
  "notebook-results",
  "notebook-summary",
  "notebook-input",
  "notebook-apply",
  "notebook-clear",
  "notebook-restore",
  "viva-list",
  "viva-numeric",
  "journal-content",
  "journal-print",
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
  "print-report",
  // SHM laboratory
  "model-notes",
  "wave-canvas",
  "canvas-instructions",
  "play-button",
  "pause-button",
  "step-button",
  "reset-button",
  "pulse-button",
  "manual-controls",
  "amplitude",
  "frequency",
  "damping",
  "tension",
  "playback-speed",
  "show-ruler",
  "show-stopwatch",
  "show-reference",
  "explanation-text",
  "model-summary",
  "simulation-status",
];
for (const id of requiredIds) {
  if (!ids.has(id)) errors.push(`Missing required id: #${id}`);
}

for (const id of forIds) {
  if (!ids.has(id)) errors.push(`label/output references missing id: ${id}`);
}

const labelsFor = new Set(forIds);
for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
  const tag = match[0];
  const id = (tag.match(/\sid="([^"]+)"/) || [])[1];
  if (!id) {
    errors.push(`Input is missing an id: ${tag.slice(0, 90)}`);
  } else if (!labelsFor.has(id)) {
    errors.push(`Input #${id} has no associated <label for="...">`);
  }
}

for (const match of html.matchAll(/<label\b[^>]*>/gi)) {
  if (!/\sfor=/.test(match[0])) {
    errors.push(`Label is missing a for attribute: ${match[0]}`);
  }
}

for (const match of html.matchAll(/<output\b[^>]*>/gi)) {
  const tag = match[0];
  const target = (tag.match(/\sfor="([^"]+)"/) || [])[1];
  if (!target) {
    errors.push(`Output is missing a for attribute: ${tag}`);
  } else if (!ids.has(target)) {
    errors.push(`Output references missing input id: ${target}`);
  }
}

for (const match of html.matchAll(/\saria-(?:describedby|labelledby|controls)="([^"]+)"/gi)) {
  for (const id of match[1].trim().split(/\s+/)) {
    if (!ids.has(id)) errors.push(`ARIA reference points to missing id: ${id}`);
  }
}

for (const match of html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/gi)) {
  const href = match[1];
  if (href === "#" || href === "") {
    errors.push("Placeholder links are not allowed.");
  } else if (href.startsWith("#")) {
    if (!ids.has(href.slice(1))) errors.push(`Anchor points to missing id: ${href}`);
  } else if (href.startsWith("./")) {
    const target = path.resolve(projectRoot, href);
    if (!fs.existsSync(target)) errors.push(`Anchor points to missing asset: ${href}`);
  }
}

for (const match of html.matchAll(/\s(?:src|href)="(\.\/[^"#]+)"/gi)) {
  const target = path.resolve(projectRoot, match[1]);
  if (!fs.existsSync(target)) errors.push(`Local asset is missing: ${match[1]}`);
}

// The lab index must only advertise simulations that actually exist.
if (/Coming soon/i.test(html)) {
  errors.push("Placeholder topics marked 'Coming soon' must be removed.");
}
if (/aria-disabled="true"/i.test(html)) {
  errors.push("Unavailable topics must not be rendered as disabled placeholders.");
}

const openBraces = (css.match(/\{/g) || []).length;
const closeBraces = (css.match(/\}/g) || []).length;
if (openBraces !== closeBraces) {
  errors.push(`Unbalanced CSS braces: ${openBraces} opening, ${closeBraces} closing`);
}

const requiredCssSelectors = [
  ".lab-layout",
  ".instrument-panel",
  ".data-table",
  ".stage-chip",
  ".svg-telescope-arm",
  ".lab-toast",
  ".print-only",
  "@media print",
  "high-contrast",
];
for (const selector of requiredCssSelectors) {
  if (!css.includes(selector)) errors.push(`Stylesheet is missing ${selector}`);
}

if (errors.length > 0) {
  console.error(`Lint failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Lint passed: ${javascriptFiles.length} JavaScript files, ${ids.size} unique HTML ids, local assets and module imports verified.`,
);
