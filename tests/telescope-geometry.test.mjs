/**
 * Regression tests for the spectrometer telescope geometry.
 *
 * The telescope is a rigid body placed on a circle centred on the grating:
 * nothing is re-pointed vertex by vertex, the group is rotated about the
 * pivot. These tests pin down that convention — pivot, direction, length,
 * clamp and the mapping from a spectral line's diffraction angle onto the
 * tube — so the diagram cannot drift away from the physics again.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { apparentAngles, DEG_PER_RAD } from "../src/physics/grating.js";
import {
  DEG_PER_RAD as GEOMETRY_DEG_PER_RAD,
  DRAG_MIN_RADIUS,
  GRATING_PIVOT,
  TELESCOPE_INNER_RADIUS,
  TELESCOPE_LENGTH,
  TELESCOPE_MAX_DEG,
  TELESCOPE_MIN_DEG,
  TELESCOPE_OUTER_RADIUS,
  clampTelescope,
  lineTelescopeAngle,
  normalizeAngle,
  polarToScreen,
  rotateAboutPivot,
  screenAngleAt,
  shortestAngleDelta,
  telescopeAxis,
  telescopeLocalPoint,
  telescopeRotationAttribute,
} from "../src/simulation/telescope-geometry.js";

const close = (actual, expected, tolerance = 1e-9, label = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${actual} to be within ${tolerance} of ${expected}`,
  );

const localObjective = telescopeLocalPoint(TELESCOPE_INNER_RADIUS);
const localEyepiece = telescopeLocalPoint(TELESCOPE_OUTER_RADIUS);

test("grating pivot is a single fixed point at the centre of the turntable", () => {
  assert.deepEqual({ ...GRATING_PIVOT }, { x: 500, y: 340 });
  assert.ok(Object.isFrozen(GRATING_PIVOT));
  // Exposed for callers that only need the trigonometric conversion.
  close(GEOMETRY_DEG_PER_RAD, DEG_PER_RAD, 1e-15);
});

test("zero angle: telescope rests on the +x axis with the objective facing the grating", () => {
  const axis = telescopeAxis(0);
  close(axis.angleDeg, 0);
  close(axis.inner.x, GRATING_PIVOT.x + TELESCOPE_INNER_RADIUS);
  close(axis.inner.y, GRATING_PIVOT.y);
  close(axis.outer.x, GRATING_PIVOT.x + TELESCOPE_OUTER_RADIUS);
  close(axis.outer.y, GRATING_PIVOT.y);
  close(axis.directionDeg, 0);
  assert.equal(telescopeRotationAttribute(0), "rotate(0.000 500 340)");
});

test("quarter turn: 90 degrees places the tube straight up the screen", () => {
  const axis = telescopeAxis(90);
  close(axis.outer.x, GRATING_PIVOT.x, 1e-9, "x");
  close(axis.outer.y, GRATING_PIVOT.y - TELESCOPE_OUTER_RADIUS, 1e-9, "y");
  close(axis.directionDeg, 90);
  close(axis.length, TELESCOPE_LENGTH, 1e-9);
  assert.equal(telescopeRotationAttribute(90), "rotate(-60.000 500 340)");
  // The instrument itself is clamped: 90 deg is reachable geometrically but
  // not mechanically, so the clamp is the documented limit.
  close(clampTelescope(90), TELESCOPE_MAX_DEG);
});

test("half turn: 180 degrees points the tube back along −x", () => {
  // Rotation maths is unclamped; only the instrument travel is limited.
  const opposite = rotateAboutPivot(localObjective, 180);
  close(opposite.x, GRATING_PIVOT.x - TELESCOPE_INNER_RADIUS, 1e-9, "x");
  close(opposite.y, GRATING_PIVOT.y, 1e-9, "y");
  const point = polarToScreen(TELESCOPE_OUTER_RADIUS, 180);
  close(point.x, GRATING_PIVOT.x - TELESCOPE_OUTER_RADIUS, 1e-9, "x");
  close(point.y, GRATING_PIVOT.y, 1e-9, "y");
  close(Math.abs(screenAngleAt(opposite.x, opposite.y)), 180);
  assert.ok(normalizeAngle(-180) === 180 || normalizeAngle(-180) === 0);
});

test("pivot invariance: the rotation origin never leaves the grating centre", () => {
  for (let angle = TELESCOPE_MIN_DEG; angle <= TELESCOPE_MAX_DEG; angle += 5) {
    const rotatedPivot = rotateAboutPivot(GRATING_PIVOT, -angle);
    close(rotatedPivot.x, GRATING_PIVOT.x, 1e-9, `pivot x at ${angle}`);
    close(rotatedPivot.y, GRATING_PIVOT.y, 1e-9, `pivot y at ${angle}`);
    const axis = telescopeAxis(angle);
    close(
      Math.hypot(axis.inner.x - GRATING_PIVOT.x, axis.inner.y - GRATING_PIVOT.y),
      TELESCOPE_INNER_RADIUS,
      1e-9,
      `inner radius at ${angle}`,
    );
    close(
      Math.hypot(axis.outer.x - GRATING_PIVOT.x, axis.outer.y - GRATING_PIVOT.y),
      TELESCOPE_OUTER_RADIUS,
      1e-9,
      `outer radius at ${angle}`,
    );
  }
});

test("constant length: the body is rigid for every reachable angle", () => {
  for (let angle = TELESCOPE_MIN_DEG; angle <= TELESCOPE_MAX_DEG; angle += 1) {
    const axis = telescopeAxis(angle);
    close(axis.length, TELESCOPE_LENGTH, 1e-9, `length at ${angle}`);
    // Rotating both ends by the same transform preserves their separation.
    const inner = rotateAboutPivot(localObjective, -angle);
    const outer = rotateAboutPivot(localEyepiece, -angle);
    close(Math.hypot(outer.x - inner.x, outer.y - inner.y), TELESCOPE_LENGTH, 1e-9, `rotation at ${angle}`);
    close(inner.x, axis.inner.x, 1e-9, `inner x at ${angle}`);
    close(inner.y, axis.inner.y, 1e-9, `inner y at ${angle}`);
    close(outer.x, axis.outer.x, 1e-9, `outer x at ${angle}`);
    close(outer.y, axis.outer.y, 1e-9, `outer y at ${angle}`);
  }
});

test("the rendered rotation and the analytic placement agree", () => {
  for (const angle of [-60, -45, -22.5, 0, 7.5, 30, 45, 60]) {
    const attribute = telescopeRotationAttribute(angle);
    assert.match(attribute, /^rotate\(-?\d+\.\d{3} 500 340\)$/);
    const [rotation, cx, cy] = attribute
      .replace(/^rotate\(/, "")
      .replace(/\)$/, "")
      .split(" ");
    close(Number(cx), GRATING_PIVOT.x);
    close(Number(cy), GRATING_PIVOT.y);
    // SVG rotate uses screen coordinates (clockwise positive), so the sign of
    // the attribute is the negative of the instrument angle.
    close(Number(rotation), -clampTelescope(angle), 1e-3);
  }
});

test("optical alignment: the tube follows each spectral line's diffraction angle", () => {
  const wavelengths = { violet: 4387e-10, green: 5460e-10, yellow: 5790e-10, red: 6390e-10 };
  for (const [name, wavelength] of Object.entries(wavelengths)) {
    for (const order of [1, 2]) {
      const angles = apparentAngles(wavelength, order);
      for (const side of ["left", "right"]) {
        const target = lineTelescopeAngle(angles, side);
        assert.equal(target.valid, true, `${name} order ${order} ${side} should be visible`);
        const expected = side === "right" ? angles.rightDeg : angles.leftDeg;
        close(target.angleDeg, expected, 1e-12, `${name} ${side}`);
        const axis = telescopeAxis(target.angleDeg);
        close(axis.directionDeg, expected, 1e-9, `${name} ${side} direction`);
        // Left-side lines lie anticlockwise (negative), right-side clockwise.
        if (side === "left") assert.ok(axis.directionDeg < 0, `${name} left should be negative`);
        else assert.ok(axis.directionDeg > 0, `${name} right should be positive`);
        // And the drawn ray points along that same direction from the grating.
        close(axis.outer.y < GRATING_PIVOT.y, side === "right", 0, `${name} ${side} screen side`);
      }
    }
  }
});

test("angle consistency: diagram position and instrument angle round-trip", () => {
  for (let angle = -170; angle <= 179; angle += 7) {
    const point = polarToScreen(250, angle);
    close(screenAngleAt(point.x, point.y), angle, 1e-9, `round trip at ${angle}`);
  }
  // A pointer on the telescope body yields the angle the tube is drawn at.
  const dragged = rotateAboutPivot(telescopeLocalPoint(280), -33);
  close(screenAngleAt(dragged.x, dragged.y), 33, 1e-9);
  assert.ok(DRAG_MIN_RADIUS < TELESCOPE_INNER_RADIUS);
});

test("shortestAngleDelta and clampTelescope keep movement continuous and physical", () => {
  close(shortestAngleDelta(350, 10), 20);
  close(shortestAngleDelta(10, 350), -20);
  close(shortestAngleDelta(0, 180), 180);
  close(shortestAngleDelta(0, -180), 180);
  close(clampTelescope(-200), TELESCOPE_MIN_DEG);
  close(clampTelescope(200), TELESCOPE_MAX_DEG);
  close(clampTelescope(-12.5), -12.5);
  close(clampTelescope(Number.NaN), 0);
  assert.ok(TELESCOPE_MIN_DEG < 0 && TELESCOPE_MAX_DEG > 0);
});

test("lineTelescopeAngle rejects lines that this order cannot produce", () => {
  const invalid = apparentAngles(4387e-10, 4);
  assert.equal(lineTelescopeAngle(invalid, "right").valid, false);
  assert.ok(Number.isNaN(lineTelescopeAngle(invalid, "right").angleDeg));
  assert.equal(lineTelescopeAngle(null, "left").valid, false);
});
