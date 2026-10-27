/**
 * Pure physics for the diffraction grating experiment.
 *
 * All internal calculations use SI units (metres, radians). Values are only
 * converted to nanometres / angstroms / degrees for display.
 *
 * Grating equation:  d sin(theta) = n * lambda
 * Grating: 15 000 lines per inch, 1 inch = 2.54 cm.
 */

export const DEG_PER_RAD = 180 / Math.PI;
export const RAD_PER_DEG = Math.PI / 180;

export const LINES_PER_INCH = 15000;
export const CM_PER_INCH = 2.54;
export const M_PER_CM = 0.01;

/** Grating element (slit spacing) in every unit used by the experiment. */
export const GRATING_ELEMENT_CM = CM_PER_INCH / LINES_PER_INCH; // 1.69333e-4 cm
export const GRATING_ELEMENT_M = GRATING_ELEMENT_CM * M_PER_CM; // 1.69333e-6 m
export const GRATING_ELEMENT_ANGSTROM = GRATING_ELEMENT_M * 1e10; // 16933.33 Å
export const GRATING_ELEMENT_NM = GRATING_ELEMENT_M * 1e9; // 1693.33 nm

export const ANGSTROM_PER_M = 1e10;
export const NM_PER_M = 1e9;

/** Reference wavelengths printed in the laboratory manual (angstroms). */
export const DEFAULT_REFERENCE_ANGSTROM = Object.freeze({
  violet: 4387,
  green: 5460,
  yellow: 5790,
  red: 6390,
});

/** Spectral lines: label, manual reference wavelength and display colour. */
export const SPECTRAL_LINES = Object.freeze([
  Object.freeze({ id: "violet", name: "Violet", angstrom: 4387, color: "#b48cff", hint: "inner line" }),
  Object.freeze({ id: "green", name: "Green", angstrom: 5460, color: "#59e08c", hint: "middle line" }),
  Object.freeze({ id: "yellow", name: "Yellow", angstrom: 5790, color: "#ffd75a", hint: "doublet" }),
  Object.freeze({ id: "red", name: "Red", angstrom: 6390, color: "#ff6b63", hint: "outer line" }),
]);

export const LINE_BY_ID = Object.freeze(
  Object.fromEntries(SPECTRAL_LINES.map((line) => [line.id, line])),
);

export const LINE_IDS = Object.freeze(SPECTRAL_LINES.map((line) => line.id));

/** Handwritten notebook readings imported from the manual (degrees/minutes). */
export const NOTEBOOK_READINGS = Object.freeze([
  Object.freeze({ id: "violet", name: "Violet", left: "346° 12′", right: "16° 14′" }),
  Object.freeze({ id: "green", name: "Green", left: "350° 00′", right: "27° 37′" }),
  Object.freeze({ id: "yellow", name: "Yellow", left: "351° 03′", right: "31° 02′" }),
  Object.freeze({ id: "red", name: "Red", left: "355° 15′", right: "39° 35′" }),
]);

export const ARC_SECONDS_PER_DEGREE = 3600;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Normalise any angle to [0, 360). */
export function normalizeDegrees(deg) {
  if (!isFiniteNumber(deg)) return 0;
  const wrapped = deg % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  // Guard against 359.9999999999 -> 360.0 due to floating point.
  return positive >= 360 ? 0 : positive;
}

/** Smallest absolute separation between two directions, in [0, 180]. */
export function angularSeparation(aDeg, bDeg) {
  if (!isFiniteNumber(aDeg) || !isFiniteNumber(bDeg)) return 0;
  const diff = Math.abs(normalizeDegrees(aDeg) - normalizeDegrees(bDeg));
  return diff > 180 ? 360 - diff : diff;
}

/** Rounds an angle to the nearest arcsecond without crossing the 360° seam. */
export function roundToArcSecond(deg) {
  if (!isFiniteNumber(deg)) return 0;
  const totalSeconds = Math.round(normalizeDegrees(deg) * ARC_SECONDS_PER_DEGREE);
  return normalizeDegrees(totalSeconds / ARC_SECONDS_PER_DEGREE);
}

export function splitAngle(deg) {
  const safe = isFiniteNumber(deg) ? deg : 0;
  const sign = safe < 0 ? -1 : 1;
  const absolute = Math.abs(safe);
  const totalSeconds = Math.round(absolute * ARC_SECONDS_PER_DEGREE);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { sign, degrees, minutes, seconds };
}

/**
 * Formats an angle using degree / minute / second symbols.
 * Minutes are rounded when seconds are hidden, carrying correctly.
 */
export function formatDMS(deg, options = {}) {
  const { seconds = true, pad = false, wrap = true } = options;
  if (!isFiniteNumber(deg)) return "—";
  const value = wrap ? normalizeDegrees(deg) : deg;
  const negative = value < 0;
  const totalSeconds = Math.round(Math.abs(value) * ARC_SECONDS_PER_DEGREE);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const degText = pad ? String(degrees).padStart(3, "0") : String(degrees);
  const minText = String(minutes).padStart(2, "0");
  const secText = String(secs).padStart(2, "0");
  const sign = negative ? "−" : "";
  return seconds
    ? `${sign}${degText}° ${minText}′ ${secText}″`
    : `${sign}${degText}° ${minText}′`;
}

/** Compact DMS used inside export files (ASCII friendly). */
export function formatDMSAscii(deg) {
  if (!isFiniteNumber(deg)) return "";
  const { degrees, minutes, seconds } = splitAngle(deg);
  return `${degrees} deg ${String(minutes).padStart(2, "0")} min ${String(seconds).padStart(2, "0")} sec`;
}

/**
 * Parses a reading typed by a student.
 * Accepted: "346° 12′ 30″", "346 12 30", "346:12", "16.25", "-4.5", "350 0".
 */
export function parseAngle(text) {
  if (typeof text !== "string") return { ok: false, error: "Enter an angle." };
  const cleaned = text
    .replace(/[−–—]/g, "-")
    .replace(/[’‘′']/g, "′")
    .replace(/[”“″"]/g, "″")
    .replace(/[º°d]/g, " ")
    .replace(/[′″]/g, " ")
    .replace(/[,:;]/g, " ")
    .trim();
  if (cleaned === "") return { ok: false, error: "Enter an angle." };

  const match = cleaned.match(/^(-)?\s*(\d+(?:\.\d+)?)\s*(?:(\d+(?:\.\d+)?)\s*)?(?:(\d+(?:\.\d+)?)\s*)?(?:[a-zA-Z]+\s*)?$/);
  if (!match) return { ok: false, error: "Use degrees and minutes, e.g. 346° 12′." };

  const sign = match[1] ? -1 : 1;
  const degrees = Number(match[2]);
  const hasMinutes = match[3] !== undefined;
  const hasSeconds = match[4] !== undefined;

  if (!Number.isFinite(degrees)) return { ok: false, error: "Not a valid number." };
  if (hasMinutes && degrees % 1 !== 0) {
    return { ok: false, error: "Write minutes only with whole degrees." };
  }
  if (hasSeconds && !hasMinutes) {
    return { ok: false, error: "Write seconds after minutes." };
  }

  const minutes = hasMinutes ? Number(match[3]) : 0;
  const seconds = hasSeconds ? Number(match[4]) : 0;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 60) {
    return { ok: false, error: "Minutes must be between 0 and 59." };
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 60) {
    return { ok: false, error: "Seconds must be between 0 and 59." };
  }
  if (degrees >= 360) return { ok: false, error: "A scale reading must be below 360°." };

  const value = sign * (degrees + minutes / 60 + seconds / 3600);
  return {
    ok: true,
    degrees: value,
    normalized: normalizeDegrees(value),
    seconds: Math.round(Math.abs(value) * ARC_SECONDS_PER_DEGREE),
  };
}

/** Converts a wavelength between display units. Input and output in metres. */
export function wavelengthInUnit(metres, unit = "angstrom") {
  if (!isFiniteNumber(metres)) return NaN;
  if (unit === "metre") return metres;
  if (unit === "nanometre") return metres * NM_PER_M;
  return metres * ANGSTROM_PER_M;
}

export function unitSymbol(unit) {
  if (unit === "metre") return "m";
  if (unit === "nanometre") return "nm";
  return "Å";
}

export function formatWavelength(metres, unit = "angstrom", digits = 1) {
  if (!isFiniteNumber(metres)) return "—";
  const value = wavelengthInUnit(metres, unit);
  const places = unit === "metre" ? Math.max(digits + 6, 9) : digits;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })} ${unitSymbol(unit)}`;
}

/** Grating element reported in several units, derived from lines per inch. */
export function gratingElement(linesPerInch = LINES_PER_INCH) {
  const safeLines = isFiniteNumber(linesPerInch) && linesPerInch > 0 ? linesPerInch : LINES_PER_INCH;
  const cm = CM_PER_INCH / safeLines;
  const metres = cm * M_PER_CM;
  return {
    linesPerInch: safeLines,
    cm,
    metres,
    nanometre: metres * NM_PER_M,
    angstrom: metres * ANGSTROM_PER_M,
  };
}

/**
 * Solves d sin(theta) = n lambda.
 * Returns validity information rather than NaN so impossible orders are rejected.
 */
export function diffractionAngle(order, wavelengthM, dM = GRATING_ELEMENT_M) {
  const result = { valid: false, reason: "", order, wavelengthM, dM, sinTheta: NaN, thetaRad: NaN, thetaDeg: NaN };
  if (!isFiniteNumber(order) || order < 1 || !Number.isInteger(order)) {
    result.reason = "Diffraction order must be a whole number of at least 1.";
    return result;
  }
  if (!isFiniteNumber(wavelengthM) || wavelengthM <= 0) {
    result.reason = "Wavelength must be greater than zero.";
    return result;
  }
  if (!isFiniteNumber(dM) || dM <= 0) {
    result.reason = "Grating spacing must be greater than zero.";
    return result;
  }
  const ratio = (order * wavelengthM) / dM;
  if (ratio > 1) {
    result.reason = `nλ/d = ${ratio.toFixed(4)} > 1: no diffracted beam for order ${order}.`;
    result.ratio = ratio;
    return result;
  }
  const sinTheta = clamp(ratio, -1, 1);
  const thetaRad = Math.asin(sinTheta);
  return {
    ...result,
    valid: true,
    ratio,
    sinTheta,
    thetaRad,
    thetaDeg: thetaRad * DEG_PER_RAD,
  };
}

/** True diffraction angle (no mounting tilt) in degrees. */
export function theoreticalAngles(wavelengthM, order, dM = GRATING_ELEMENT_M) {
  const solution = diffractionAngle(order, wavelengthM, dM);
  return {
    valid: solution.valid,
    thetaDeg: solution.valid ? solution.thetaDeg : NaN,
    sinTheta: solution.sinTheta,
    leftDeg: solution.valid ? -solution.thetaDeg : NaN,
    rightDeg: solution.valid ? solution.thetaDeg : NaN,
    reason: solution.reason,
  };
}

/**
 * Angles actually seen when the grating normal is tilted by `incidenceDeg`
 * with respect to the collimator axis. The general grating equation is
 * d (sin i + sin theta) = n lambda with i and theta on opposite sides of the
 * normal, which gives, measured from the undeviated beam:
 *   phi_+ = i + asin(n lambda / d - sin i)
 *   phi_- = i - asin(n lambda / d + sin i)
 * At i = 0 this reduces to the symmetric +/-theta case. A tilted grating makes
 * the two sides asymmetric, which is exactly what the two-side method must
 * tolerate.
 */
export function apparentAngles(wavelengthM, order, incidenceDeg = 0, dM = GRATING_ELEMENT_M) {
  const base = diffractionAngle(order, wavelengthM, dM);
  const incidence = isFiniteNumber(incidenceDeg) ? incidenceDeg : 0;
  if (!base.valid) {
    return {
      valid: false,
      leftDeg: NaN,
      rightDeg: NaN,
      leftValid: false,
      rightValid: false,
      reason: base.reason,
      sinTheta: base.sinTheta,
      ratio: base.ratio,
    };
  }
  const sinI = Math.sin(incidence * RAD_PER_DEG);
  const sinTheta = base.sinTheta;
  const rightArg = sinTheta - sinI;
  const leftArg = sinTheta + sinI;
  const rightValid = Math.abs(rightArg) <= 1;
  const leftValid = Math.abs(leftArg) <= 1;
  return {
    valid: rightValid && leftValid,
    leftValid,
    rightValid,
    leftDeg: leftValid ? incidence - Math.asin(leftArg) * DEG_PER_RAD : NaN,
    rightDeg: rightValid ? incidence + Math.asin(rightArg) * DEG_PER_RAD : NaN,
    sinTheta,
    ratio: base.ratio,
    reason: rightValid && leftValid ? "" : "The grating is tilted too far for this order on one side.",
  };
}

/** Highest physical order for a wavelength and grating spacing. */
export function maxOrder(wavelengthM, dM = GRATING_ELEMENT_M) {
  if (!isFiniteNumber(wavelengthM) || wavelengthM <= 0 || !isFiniteNumber(dM) || dM <= 0) return 0;
  return Math.floor(dM / wavelengthM + 1e-12);
}

/**
 * Full calculation chain from the two opposite-side scale readings.
 * The separation is measured on the instrument scale first, so a shared
 * vernier zero offset cancels automatically.
 */
export function solveFromReadings(leftDeg, rightDeg, order = 1, dM = GRATING_ELEMENT_M) {
  const validInputs = isFiniteNumber(leftDeg) && isFiniteNumber(rightDeg);
  const separationDeg = validInputs ? angularSeparation(leftDeg, rightDeg) : NaN;
  const thetaDeg = separationDeg / 2;
  const sinTheta = validInputs ? Math.sin(thetaDeg * RAD_PER_DEG) : NaN;
  const wavelengthM = isFiniteNumber(sinTheta) ? (dM * sinTheta) / order : NaN;
  const valid = validInputs && order >= 1 && wavelengthM > 0 && wavelengthM <= dM / order;

  return {
    valid,
    order,
    dM,
    leftDeg,
    rightDeg,
    separationDeg,
    thetaDeg,
    sinTheta,
    wavelengthM,
    wavelengthAngstrom: wavelengthM * ANGSTROM_PER_M,
    wavelengthNm: wavelengthM * NM_PER_M,
    reason: valid ? "" : "The two readings do not produce a physical diffraction angle.",
  };
}

/** Percentage deviation, signed and absolute, using the manual's formula. */
export function percentageDeviation(measuredAngstrom, standardAngstrom) {
  if (!isFiniteNumber(measuredAngstrom) || !isFiniteNumber(standardAngstrom) || standardAngstrom === 0) {
    return { valid: false, signed: NaN, absolute: NaN };
  }
  const signed = ((measuredAngstrom - standardAngstrom) / standardAngstrom) * 100;
  return { valid: true, signed, absolute: Math.abs(signed) };
}

/**
 * Least-squares slope through the origin for lambda = d sin(theta).
 * Returns the inferred grating spacing, which is a good sanity check.
 */
export function fitGratingElement(points) {
  const usable = (points || []).filter(
    (point) => isFiniteNumber(point.sinTheta) && isFiniteNumber(point.wavelengthM) && point.sinTheta > 0,
  );
  if (usable.length === 0) return { valid: false, slope: NaN, slopeAngstrom: NaN, points: 0 };
  let numerator = 0;
  let denominator = 0;
  for (const point of usable) {
    numerator += point.sinTheta * point.wavelengthM;
    denominator += point.sinTheta * point.sinTheta;
  }
  const slope = denominator === 0 ? NaN : numerator / denominator;
  return {
    valid: Number.isFinite(slope) && slope > 0,
    slope,
    slopeAngstrom: slope * ANGSTROM_PER_M,
    points: usable.length,
  };
}

/** Calculates the complete notebook table (raw readings -> wavelengths). */
export function notebookResults(referenceAngstrom = DEFAULT_REFERENCE_ANGSTROM) {
  return NOTEBOOK_READINGS.map((row, index) => {
    const left = parseAngle(row.left);
    const right = parseAngle(row.right);
    const solution = solveFromReadings(left.ok ? left.degrees : NaN, right.ok ? right.degrees : NaN, 1);
    const standard = Number(referenceAngstrom[row.id]);
    const deviation = percentageDeviation(solution.wavelengthAngstrom, standard);
    return {
      serial: index + 1,
      id: row.id,
      name: row.name,
      leftDeg: left.ok ? left.degrees : NaN,
      rightDeg: right.ok ? right.degrees : NaN,
      ...solution,
      standardAngstrom: standard,
      deviation,
    };
  });
}
