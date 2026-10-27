import assert from "node:assert/strict";
import test from "node:test";

import {
  ANGSTROM_PER_M,
  DEFAULT_REFERENCE_ANGSTROM,
  GRATING_ELEMENT_ANGSTROM,
  GRATING_ELEMENT_CM,
  GRATING_ELEMENT_M,
  GRATING_ELEMENT_NM,
  NOTEBOOK_READINGS,
  angularSeparation,
  apparentAngles,
  diffractionAngle,
  fitGratingElement,
  formatDMS,
  formatDMSAscii,
  maxOrder,
  notebookResults,
  normalizeDegrees,
  parseAngle,
  percentageDeviation,
  solveFromReadings,
  splitAngle,
  wavelengthInUnit,
} from "../src/physics/grating.js";

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

test("grating element follows 15 000 lines per inch", () => {
  close(GRATING_ELEMENT_CM, 2.54 / 15000, 1e-15);
  close(GRATING_ELEMENT_CM, 1.693333e-4, 1e-9);
  close(GRATING_ELEMENT_M, 1.693333e-6, 1e-11);
  close(GRATING_ELEMENT_ANGSTROM, 16933.333333, 1e-5);
  close(GRATING_ELEMENT_NM, 1693.3333333, 1e-6);
  close(GRATING_ELEMENT_ANGSTROM, GRATING_ELEMENT_M * ANGSTROM_PER_M, 1e-9);
});

test("wavelength unit conversion is exact", () => {
  const wavelength = 4387e-10;
  close(wavelengthInUnit(wavelength, "angstrom"), 4387, 1e-9);
  close(wavelengthInUnit(wavelength, "nanometre"), 438.7, 1e-9);
  close(wavelengthInUnit(wavelength, "metre"), 4.387e-7, 1e-18);
});

test("theoretical angles follow d sin(theta) = n lambda", () => {
  for (const [colour, angstrom] of Object.entries(DEFAULT_REFERENCE_ANGSTROM)) {
    const solution = diffractionAngle(1, angstrom * 1e-10);
    assert.equal(solution.valid, true, `${colour} should be valid`);
    close(solution.sinTheta * GRATING_ELEMENT_M, 1 * angstrom * 1e-10, 1e-20);
    close(Math.sin((solution.thetaDeg * Math.PI) / 180), solution.sinTheta, 1e-12);
  }
  const violet = diffractionAngle(1, 4387e-10).thetaDeg;
  const green = diffractionAngle(1, 5460e-10).thetaDeg;
  const yellow = diffractionAngle(1, 5790e-10).thetaDeg;
  const red = diffractionAngle(1, 6390e-10).thetaDeg;
  assert.ok(violet < green && green < yellow && yellow < red);
  close(violet, 15.0152, 1e-3);
  close(red, 22.1704, 1e-3);
});

test("impossible diffraction orders are rejected gracefully", () => {
  const red = 6390e-10;
  const third = diffractionAngle(3, red);
  assert.equal(third.valid, false);
  assert.match(third.reason, /no diffracted beam/);
  assert.ok(Number.isNaN(third.thetaDeg));

  const tooBig = diffractionAngle(1, 20000e-10);
  assert.equal(tooBig.valid, false);

  assert.equal(diffractionAngle(0, red).valid, false);
  assert.equal(diffractionAngle(-1, red).valid, false);
  assert.equal(diffractionAngle(1.5, red).valid, false);
  assert.equal(diffractionAngle(1, 0).valid, false);
  assert.equal(diffractionAngle(1, Number.NaN).valid, false);

  assert.equal(maxOrder(red), 2);
  assert.equal(maxOrder(4387e-10), 3);
  assert.equal(maxOrder(6000e-10), 2);
});

test("second order exists only while n lambda / d <= 1", () => {
  const second = diffractionAngle(2, 6390e-10);
  assert.equal(second.valid, true);
  close(second.thetaDeg, 49.001, 1e-3);
  assert.equal(diffractionAngle(2, 9000e-10).valid, false);
});

test("angular separation wraps correctly across 0/360", () => {
  close(angularSeparation(350, 15), 25, 1e-12);
  close(angularSeparation(15, 350), 25, 1e-12);
  close(angularSeparation(355 + 15 / 60, 39 + 35 / 60), 44 + 20 / 60, 1e-12);
  close(angularSeparation(10, 350), 20, 1e-12);
  close(angularSeparation(0, 180), 180, 1e-12);
  close(angularSeparation(1, 359), 2, 1e-12);
  assert.equal(normalizeDegrees(-15), 345);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(725), 5);
});

test("degree, minute and second arithmetic carries correctly", () => {
  assert.equal(formatDMS(346.2, { seconds: false }), "346° 12′");
  assert.equal(formatDMS(346.2, { seconds: true }), "346° 12′ 00″");
  assert.equal(formatDMS(18.8083333333, { seconds: true }), "18° 48′ 30″");
  assert.equal(formatDMS(19.9999999, { seconds: true }), "20° 00′ 00″");
  assert.equal(formatDMS(15.9999999, { seconds: false }), "16° 00′");
  assert.equal(formatDMS(0, { seconds: true }), "0° 00′ 00″");
  assert.equal(formatDMS(360.00001, { seconds: false }), "0° 00′");

  const parts = splitAngle(22 + 10 / 60 + 30 / 3600);
  assert.deepEqual(parts, { sign: 1, degrees: 22, minutes: 10, seconds: 30 });

  assert.equal(formatDMSAscii(15 + 1 / 60), "15 deg 01 min 00 sec");

  const parsed = parseAngle("346° 12′");
  assert.equal(parsed.ok, true);
  close(parsed.degrees, 346.2, 1e-12);
  close(parseAngle("16.25").degrees, 16.25, 1e-12);
  close(parseAngle("346 12 30").degrees, 346 + 12 / 60 + 30 / 3600, 1e-12);
  close(parseAngle("350:00").degrees, 350, 1e-12);
  close(parseAngle("−4° 30′").degrees, -4.5, 1e-12);

  assert.equal(parseAngle("").ok, false);
  assert.equal(parseAngle("abc").ok, false);
  assert.equal(parseAngle("350 75").ok, false);
  assert.equal(parseAngle("350 12 75").ok, false);
  assert.equal(parseAngle("361").ok, false);
});

test("half the separation of opposite readings gives the diffraction angle", () => {
  const greenTheta = (18.810556 * Math.PI) / 180;
  const left = 360 - 18.810556;
  const right = 18.810556;
  const solved = solveFromReadings(left, right, 1);
  assert.equal(solved.valid, true);
  close(solved.separationDeg, 2 * 18.810556, 1e-9);
  close(solved.thetaDeg, 18.810556, 1e-9);
  close(solved.sinTheta, Math.sin(greenTheta), 1e-12);
  close(solved.wavelengthAngstrom, 5460, 0.2);

  // A shared vernier zero must cancel in the two-side method.
  const shifted = solveFromReadings(normalizeDegrees(left + 12.5), normalizeDegrees(right + 12.5), 1);
  close(shifted.wavelengthAngstrom, solved.wavelengthAngstrom, 1e-9);

  // Order 2 halves the computed wavelength for the same measured angle.
  const secondOrder = solveFromReadings(left, right, 2);
  close(secondOrder.wavelengthAngstrom, solved.wavelengthAngstrom / 2, 1e-9);
});

test("percentage deviation uses the manual's formula", () => {
  const zero = percentageDeviation(6390, 6390);
  close(zero.signed, 0, 1e-12);
  close(zero.absolute, 0, 1e-12);

  const high = percentageDeviation(6470, 6390);
  close(high.signed, ((6470 - 6390) / 6390) * 100, 1e-12);
  close(high.absolute, Math.abs(high.signed), 1e-12);
  assert.ok(high.signed > 0);

  const low = percentageDeviation(6300, 6390);
  assert.ok(low.signed < 0);
  close(low.absolute, Math.abs(low.signed), 1e-12);

  assert.equal(percentageDeviation(6300, 0).valid, false);
  assert.equal(percentageDeviation(Number.NaN, 6390).valid, false);
});

test("a tilted grating makes the two sides asymmetric but keeps the mean angle", () => {
  const symmetric = apparentAngles(5460e-10, 1, 0);
  assert.equal(symmetric.valid, true);
  close(symmetric.leftDeg, -symmetric.rightDeg, 1e-12);

  const tilted = apparentAngles(5460e-10, 1, 2);
  assert.equal(tilted.valid, true);
  // A tilt skews the pattern: one side moves towards the central maximum and
  // the other moves away from it.
  assert.ok(tilted.rightDeg < symmetric.rightDeg);
  assert.ok(Math.abs(tilted.leftDeg) > Math.abs(symmetric.leftDeg));
  assert.ok(Math.abs(tilted.leftDeg) - Math.abs(tilted.rightDeg) > 0.15);
  assert.ok(
    Math.abs((tilted.rightDeg - tilted.leftDeg) / 2 - symmetric.rightDeg) < 0.05,
    "two-side method mostly cancels a small grating tilt",
  );

  const zeroOrder = apparentAngles(5460e-10, 0, 2);
  assert.equal(zeroOrder.valid, false);
});

test("best-fit slope recovers the grating element", () => {
  const points = Object.values(DEFAULT_REFERENCE_ANGSTROM).map((angstrom) => {
    const angle = diffractionAngle(1, angstrom * 1e-10);
    return { sinTheta: angle.sinTheta, wavelengthM: angstrom * 1e-10 };
  });
  const fit = fitGratingElement(points);
  assert.equal(fit.valid, true);
  close(fit.slopeAngstrom, GRATING_ELEMENT_ANGSTROM, 1e-6);
  assert.equal(fitGratingElement([]).valid, false);
});

test("imported notebook readings reproduce the manual's angles and wavelengths", () => {
  const rows = notebookResults();
  assert.equal(rows.length, NOTEBOOK_READINGS.length);

  const expected = [
    { name: "Violet", separation: 30 + 2 / 60, theta: 15 + 1 / 60, wavelength: 4387.4 },
    { name: "Green", separation: 37 + 37 / 60, theta: 18 + 48 / 60 + 30 / 3600, wavelength: 5459.4 },
    { name: "Yellow", separation: 39 + 59 / 60, theta: 19 + 59 / 60 + 30 / 3600, wavelength: 5789.2 },
    { name: "Red", separation: 44 + 20 / 60, theta: 22 + 10 / 60, wavelength: 6389.0 },
  ];

  rows.forEach((row, index) => {
    const reference = expected[index];
    assert.equal(row.name, reference.name);
    close(row.separationDeg, reference.separation, 1e-9);
    close(row.thetaDeg, reference.theta, 1e-9);
    close(row.wavelengthAngstrom, reference.wavelength, 0.2);
    assert.equal(formatDMS(row.separationDeg, { seconds: false }), formatDMS(reference.separation, { seconds: false }));
    assert.ok(Math.abs(row.deviation.signed) < 0.05);
  });

  assert.equal(formatDMS(rows[0].separationDeg, { seconds: true }), "30° 02′ 00″");
  assert.equal(formatDMS(rows[1].thetaDeg, { seconds: true }), "18° 48′ 30″");
  assert.equal(formatDMS(rows[2].thetaDeg, { seconds: true }), "19° 59′ 30″");
  assert.equal(formatDMS(rows[3].separationDeg, { seconds: true }), "44° 20′ 00″");
});

test("invalid readings never produce a wavelength", () => {
  const solved = solveFromReadings(Number.NaN, 20, 1);
  assert.equal(solved.valid, false);
  assert.ok(Number.isNaN(solved.wavelengthAngstrom));

  const equal = solveFromReadings(12.5, 12.5, 1);
  assert.equal(equal.valid, false);
  assert.equal(equal.separationDeg, 0);
  assert.equal(equal.wavelengthM, 0);
});
