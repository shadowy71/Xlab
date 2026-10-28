/**
 * Renderer tests for the spectrometer telescope.
 *
 * These drive the real `GratingApparatus` against a minimal DOM stub and check
 * the attribute that actually moves the tube in the browser
 * (`transform="rotate(a 500 340)"`), the drag pipeline, and the link between
 * the selected spectral line and the rendered orientation.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { apparentAngles } from "../src/physics/grating.js";
import { GratingApparatus } from "../src/simulation/grating-view.js";
import {
  GRATING_PIVOT,
  TELESCOPE_INNER_RADIUS,
  TELESCOPE_LENGTH,
  TELESCOPE_OUTER_RADIUS,
  polarToScreen,
  rotateAboutPivot,
  telescopeAxis,
  telescopeLocalPoint,
} from "../src/simulation/telescope-geometry.js";
import { createFakeSvg } from "./helpers/fake-dom.mjs";

const close = (actual, expected, tolerance = 1e-3, label = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${actual} to be within ${tolerance} of ${expected}`,
  );

function apparatusState(overrides = {}) {
  return {
    telescope: 0,
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
    ...overrides,
  };
}

function build() {
  const svg = createFakeSvg();
  const rotations = [];
  const apparatus = new GratingApparatus(svg, {
    onRotate: (angle) => rotations.push(angle),
    onInteraction: () => {},
  });
  return { svg, apparatus, rotations, arm: apparatus.arm };
}

/** Instrument angle encoded in an SVG rotate attribute. */
function attributeAngle(attribute) {
  const [rotation, cx, cy] = attribute
    .replace(/^rotate\(/, "")
    .replace(/\)$/, "")
    .split(" ")
    .map(Number);
  return { angle: rotation, cx, cy };
}

test("initial render places the telescope at 0 deg about the grating", () => {
  const { arm } = build();
  const { angle, cx, cy } = attributeAngle(arm.getAttribute("transform"));
  close(angle, 0);
  close(cx, GRATING_PIVOT.x);
  close(cy, GRATING_PIVOT.y);
});

test("changing the telescope angle rotates the group about the grating pivot", () => {
  const { apparatus, arm } = build();
  for (const angle of [-60, -22.5, 0, 18.81, 30, 60]) {
    apparatus.render(apparatusState({ telescope: angle }));
    const parsed = attributeAngle(arm.getAttribute("transform"));
    close(parsed.angle, -angle, 1e-3, `rotation attribute at ${angle}`);
    close(parsed.cx, GRATING_PIVOT.x, 1e-9, "pivot x");
    close(parsed.cy, GRATING_PIVOT.y, 1e-9, "pivot y");
  }
});

test("the rendered tube stays rigid and constant length at every angle", () => {
  const { apparatus, arm } = build();
  const markup = arm.innerHTML;
  for (const angle of [-60, -30, 0, 30, 60]) {
    apparatus.render(apparatusState({ telescope: angle }));
    // Only the group transform changes; the body is never re-laid out.
    assert.equal(arm.innerHTML, markup, `body markup changed at ${angle}`);

    const { angle: rotation } = attributeAngle(arm.getAttribute("transform"));
    const inner = rotateAboutPivot(telescopeLocalPoint(TELESCOPE_INNER_RADIUS), rotation);
    const outer = rotateAboutPivot(telescopeLocalPoint(TELESCOPE_OUTER_RADIUS), rotation);
    close(Math.hypot(outer.x - inner.x, outer.y - inner.y), TELESCOPE_LENGTH, 1e-9, `length at ${angle}`);

    const expected = polarToScreen(TELESCOPE_INNER_RADIUS, angle);
    close(inner.x, expected.x, 1e-9, `objective x at ${angle}`);
    close(inner.y, expected.y, 1e-9, `objective y at ${angle}`);
    // The pivot itself is a fixed point of the transform.
    const pivot = rotateAboutPivot(GRATING_PIVOT, rotation);
    close(pivot.x, GRATING_PIVOT.x, 1e-9);
    close(pivot.y, GRATING_PIVOT.y, 1e-9);
  }
});

test("the instrument clamps travel instead of leaving the panel", () => {
  const { apparatus, arm } = build();
  apparatus.render(apparatusState({ telescope: 120 }));
  close(attributeAngle(arm.getAttribute("transform")).angle, -60);
  apparatus.render(apparatusState({ telescope: -200 }));
  close(attributeAngle(arm.getAttribute("transform")).angle, 60);
  assert.equal(apparatus.telescope, -60);
});

test("dragging the telescope updates the same authoritative angle", () => {
  const { svg, apparatus, arm, rotations } = build();
  const grab = polarToScreen(300, 0);
  svg.dispatchEvent({ type: "pointerdown", button: 0, clientX: grab.x, clientY: grab.y, pointerId: 1 });
  const moved = polarToScreen(300, 12);
  svg.dispatchEvent({ type: "pointermove", clientX: moved.x, clientY: moved.y, pointerId: 1 });

  assert.equal(rotations.length, 1);
  close(rotations[0], 12, 1e-9, "angle reported to the controller");
  close(apparatus.telescope, 12, 1e-9);
  close(attributeAngle(arm.getAttribute("transform")).angle, -12, 1e-3);

  // A pointer near the grating must not grab the telescope.
  svg.dispatchEvent({ type: "pointerup", pointerId: 1 });
  svg.dispatchEvent({ type: "pointerdown", button: 0, clientX: GRATING_PIVOT.x + 10, clientY: GRATING_PIVOT.y, pointerId: 2 });
  const far = polarToScreen(300, -45);
  svg.dispatchEvent({ type: "pointermove", clientX: far.x, clientY: far.y, pointerId: 2 });
  assert.equal(rotations.length, 1, "a click near the pivot must not rotate the telescope");
});

test("selecting a different spectral line moves the tube to that line's angle", () => {
  const { apparatus, arm } = build();
  const wavelengths = { violet: 4387e-10, green: 5460e-10, yellow: 5790e-10, red: 6390e-10 };
  const seen = new Map();

  for (const [colour, wavelength] of Object.entries(wavelengths)) {
    const angles = apparentAngles(wavelength, 1);
    for (const side of ["left", "right"]) {
      const target = side === "right" ? angles.rightDeg : angles.leftDeg;
      apparatus.render(
        apparatusState({
          telescope: target,
          selectedColour: colour,
          lines: [{ id: colour, name: colour, letter: colour[0].toUpperCase(), color: "#fff", leftDeg: angles.leftDeg, rightDeg: angles.rightDeg, leftValid: true, rightValid: true, visible: true, selected: true }],
          alignedLine: { id: colour, side },
        }),
      );
      const rendered = attributeAngle(arm.getAttribute("transform")).angle;
      close(rendered, -target, 1e-3, `${colour} ${side}`);
      const axis = telescopeAxis(target);
      close(axis.directionDeg, target, 1e-9, `${colour} ${side} axis`);
      assert.ok(apparatus.alignmentBadge.innerHTML.includes("Crosswire aligned"));
      seen.set(`${colour}-${side}`, rendered);
    }
  }

  // Every one of the eight placements is distinct: the tube really moves.
  assert.equal(new Set(Array.from(seen.values(), (value) => value.toFixed(2))).size, 8);
});
