/**
 * Regression tests for the *visual* pivot of the spectrometer telescope.
 *
 * These exist because the SVG `transform` attribute is a presentation
 * attribute for the CSS `transform` property: a stray `transform-origin` in
 * the stylesheet is composed with the attribute matrix
 * (`T(o) · M · T(−o)`), which slides the effective rotation centre from the
 * grating to `o + c` — the tube then orbits a point that is nowhere near the
 * apparatus. An earlier stylesheet carried `transform-origin: 500px 330px`
 * for exactly that reason: the painted pivot became (1000, 670) while every
 * geometric test still passed, because the tests only looked at the attribute.
 *
 * The tests below therefore model the browser pipeline (attribute matrix plus
 * whatever the stylesheet says) and assert on the *effective* pivot, and they
 * also pin the optical axis of the lamp, collimator and slit to the grating
 * centre.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GratingApparatus } from "../src/simulation/grating-view.js";
import {
  GRATING_PIVOT,
  TELESCOPE_INNER_RADIUS,
  telescopeRotationAttribute,
} from "../src/simulation/telescope-geometry.js";
import { createFakeSvg } from "./helpers/fake-dom.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(projectRoot, "src", "styles.css"), "utf8");

const close = (actual, expected, tolerance = 1e-6, label = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${actual} to be within ${tolerance} of ${expected}`,
  );

/** Body of a single CSS rule, matched by its selector. */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

/** `transform-origin: <x>px <y>px` of a rule, or null when it is not set. */
function declaredOrigin(selector) {
  const body = ruleBody(selector);
  if (!body) return null;
  const match = body.match(/transform-origin\s*:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/* ------------------------------------------------------------------ */
/* Affine helpers (SVG user space, y downwards)                        */
/* ------------------------------------------------------------------ */

const identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

const multiply = (m, n) => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});

const translate = (x, y) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });

function rotateDegrees(degrees, cx, cy) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return multiply(
    multiply(translate(cx, cy), { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }),
    translate(-cx, -cy),
  );
}

const apply = (m, point) => ({
  x: m.a * point.x + m.c * point.y + m.e,
  y: m.b * point.x + m.d * point.y + m.f,
});

/**
 * Point the matrix leaves fixed — the centre it rotates about. Returns
 * `{ identity: true }` for the identity (every point is fixed) so callers can
 * assert the placement instead of a pivot that does not exist.
 */
function fixedPoint(m) {
  const denominator = (1 - m.a) * (1 - m.d) - m.c * m.b;
  if (Math.abs(denominator) < 1e-12) {
    const displacement = Math.hypot(m.a - 1, m.b, m.c, m.d - 1, m.e, m.f);
    return displacement < 1e-12 ? { identity: true } : { degenerate: true };
  }
  return {
    x: ((1 - m.d) * m.e + m.c * m.f) / denominator,
    y: (m.b * m.e + (1 - m.a) * m.f) / denominator,
  };
}

/** Parse `rotate(a cx cy)` exactly as an SVG renderer does. */
function attributeMatrix(attribute) {
  const [rotation, cx, cy] = attribute
    .replace(/^rotate\(/, "")
    .replace(/\)$/, "")
    .split(" ")
    .map(Number);
  return rotateDegrees(rotation, cx, cy);
}

/**
 * Matrix a browser paints for this element: the attribute matrix, conjugated
 * by the CSS transform-origin when the stylesheet declares one.
 */
function paintedMatrix(attribute, origin) {
  const matrix = attributeMatrix(attribute);
  if (!origin) return matrix;
  return multiply(multiply(translate(origin.x, origin.y), matrix), translate(-origin.x, -origin.y));
}

function renderAt(angle) {
  const apparatus = new GratingApparatus(createFakeSvg());
  apparatus.render({
    telescope: angle,
    zeroOffset: 0,
    lampOn: true,
    collimatorAligned: true,
    gratingMounted: true,
    slitWidth: 0.2,
    tilt: 0,
    order: 1,
    selectedColour: "violet",
    lines: [],
    alignedLine: null,
  });
  return apparatus;
}

/* ------------------------------------------------------------------ */
/* Stylesheet guards                                                   */
/* ------------------------------------------------------------------ */

test("the telescope group carries no CSS transform of its own", () => {
  const body = ruleBody(".svg-telescope-arm");
  assert.ok(body, ".svg-telescope-arm rule should still exist (drop shadow only)");
  assert.doesNotMatch(body, /(^|[;\s])transform\s*:/, "a CSS transform would override the SVG attribute");
  assert.doesNotMatch(body, /transform-origin/, "transform-origin would move the pivot away from the grating");
  assert.doesNotMatch(body, /transform-box/, "transform-box only matters together with transform-origin");
  assert.equal(declaredOrigin(".svg-telescope-arm"), null);
});

test("no stylesheet rule pins the pivot to the old 330 axis", () => {
  assert.doesNotMatch(css, /transform-origin\s*:\s*[\d.]+px\s+330px/);
  assert.equal(declaredOrigin("#svg-collimator-body")?.y, GRATING_PIVOT.y);
});

/* ------------------------------------------------------------------ */
/* Effective (painted) pivot                                           */
/* ------------------------------------------------------------------ */

test("the telescope pivots about the grating for every angle", () => {
  const origin = declaredOrigin(".svg-telescope-arm");
  for (const angle of [-60, -45, -30, -15.0152, 0, 18.8106, 30, 45, 60]) {
    const { arm } = renderAt(angle);
    const attribute = arm.getAttribute("transform");
    assert.match(attribute, /^rotate\(-?[\d.]+ 500 340\)$/, `attribute at ${angle}`);

    const matrix = paintedMatrix(attribute, origin);
    const pivot = fixedPoint(matrix);
    assert.ok(!pivot.degenerate, `rotation matrix at ${angle} should have a centre`);
    if (pivot.identity) {
      // 0 deg: no rotation at all, so assert the objective is where the
      // geometry says it is — on the +x axis, one inner radius from the grating.
      const objective = apply(matrix, {
        x: GRATING_PIVOT.x + TELESCOPE_INNER_RADIUS,
        y: GRATING_PIVOT.y,
      });
      close(objective.x, GRATING_PIVOT.x + TELESCOPE_INNER_RADIUS, 1e-6, "objective x at 0");
      close(objective.y, GRATING_PIVOT.y, 1e-6, "objective y at 0");
      continue;
    }
    close(pivot.x, GRATING_PIVOT.x, 1e-6, `painted pivot x at ${angle}`);
    close(pivot.y, GRATING_PIVOT.y, 1e-6, `painted pivot y at ${angle}`);
  }
});

test("the pivot check is sensitive to a stray transform-origin", () => {
  // Self-check: with the old declaration the painted pivot would have been
  // (1000, 670) — the bottom-right corner of the viewBox — which is precisely
  // the "moves in a circle but not around the grating" symptom.
  const attribute = telescopeRotationAttribute(30);
  const stray = fixedPoint(paintedMatrix(attribute, { x: 500, y: 330 }));
  close(stray.x, 1000, 1e-6, "stray origin x");
  close(stray.y, 670, 1e-6, "stray origin y");
  assert.notEqual(stray.x, GRATING_PIVOT.x);
  assert.notEqual(stray.y, GRATING_PIVOT.y);
});

test("turntable, scale and grating centres all use the same pivot", () => {
  const markup = renderAt(0).svg.innerHTML;
  // The plinth, the scale rings and the turntable rings are drawn as circles
  // centred on GRATING_PIVOT; a mismatch here is what makes the telescope look
  // off-centre even when the rotation itself is correct.
  const ringRadii = [236, 216, 198, 118, 104, 74, 58];
  let checked = 0;
  for (const match of markup.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="(\d+)"/g)) {
    if (!ringRadii.includes(Number(match[3]))) continue;
    close(Number(match[1]), GRATING_PIVOT.x, 1e-6, `ring r=${match[3]} x`);
    close(Number(match[2]), GRATING_PIVOT.y, 1e-6, `ring r=${match[3]} y`);
    checked += 1;
  }
  assert.ok(checked >= 6, `expected the apparatus rings to be found, found ${checked}`);
  assert.equal(GRATING_PIVOT.y, 340);
});

/* ------------------------------------------------------------------ */
/* Optical axis: lamp, collimator and slit sit on the grating centre   */
/* ------------------------------------------------------------------ */

test("the lamp, collimator and slit are centred on the optical axis", () => {
  const apparatus = renderAt(0);
  const markup = apparatus.svg.innerHTML;

  // Mercury lamp bulb, collimator objective and brass collar.
  for (const [label, pattern] of [
    ["lamp bulb", /<circle cx="112" cy="([\d.]+)" r="8" class="lamp-bulb"/],
    ["collimator lens", /<ellipse cx="236" cy="([\d.]+)"/],
    ["collimator collar", /<circle cx="176" cy="([\d.]+)"/],
  ]) {
    const match = markup.match(pattern);
    assert.ok(match, `${label} should be present in the apparatus markup`);
    close(Number(match[1]), GRATING_PIVOT.y, 1e-6, `${label} axis`);
  }

  // The two slit jaws must be symmetric about the axis for every slit width.
  for (const slitWidth of [0.05, 0.2, 0.6, 1]) {
    const app = new GratingApparatus(createFakeSvg());
    app.render({
      telescope: 0,
      zeroOffset: 0,
      lampOn: true,
      collimatorAligned: true,
      gratingMounted: true,
      slitWidth,
      tilt: 0,
      order: 1,
      selectedColour: "violet",
      lines: [],
      alignedLine: null,
    });
    const jaws = Array.from(
      app.slitJaws.innerHTML.matchAll(/y="([\d.]+)" width="8" height="([\d.]+)"/g),
      (match) => ({ top: Number(match[1]), height: Number(match[2]) }),
    );
    assert.equal(jaws.length, 2, "two slit jaws expected");
    const top = Math.min(...jaws.map((jaw) => jaw.top));
    const bottom = Math.max(...jaws.map((jaw) => jaw.top + jaw.height));
    close((top + bottom) / 2, GRATING_PIVOT.y, 1e-6, `slit centre at ${slitWidth} mm`);
  }
});
