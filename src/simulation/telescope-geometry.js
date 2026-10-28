/**
 * Authoritative geometry for the spectrometer telescope.
 *
 * Every part of the diagram that needs to know where the telescope is —
 * the SVG group transform, the drag handle hit test, the angular readout and
 * the "point at this line" control — derives its numbers from this module, so
 * there is exactly one pivot and one angle convention in the application.
 *
 * Convention (screen coordinates, y grows downwards):
 *   • The grating sits at GRATING_PIVOT and never moves.
 *   • A telescope angle θ measured in degrees is anticlockwise on screen, so
 *     the objective end of the tube lies at
 *         x = cx + r·cos θ,      y = cy − r·sin θ
 *     with r = TELESCOPE_INNER_RADIUS. A positive θ therefore puts the
 *     telescope on the +θ (right-hand) side of the spectrum, matching
 *     `theoreticalAngles(...).rightDeg`.
 *   • The whole tube is a rigid body drawn once, along the +x axis at angle 0,
 *     and rotated into place with the SVG attribute
 *         rotate(−θ cx cy)
 *     (SVG rotate is clockwise-positive because the y axis points down).
 *     Nothing is repositioned point-by-point, so the arm can never stretch,
 *     detach or be double-transformed.
 */

export const GRATING_PIVOT = Object.freeze({ x: 500, y: 340 });

/** Instrument travel. Far enough for the central image and the first order. */
export const TELESCOPE_MIN_DEG = -60;
export const TELESCOPE_MAX_DEG = 60;

/** Radii of the tube, measured from the grating along the telescope axis. */
export const TELESCOPE_INNER_RADIUS = 202; // objective face, nearest the grating
export const TELESCOPE_OUTER_RADIUS = 364; // eyepiece face
export const TELESCOPE_LENGTH = TELESCOPE_OUTER_RADIUS - TELESCOPE_INNER_RADIUS;

/** A pointer closer than this to the pivot cannot grab the telescope. */
export const DRAG_MIN_RADIUS = 95;

export const RAD_PER_DEG = Math.PI / 180;
export const DEG_PER_RAD = 180 / Math.PI;

/** Wrap any angle (degrees) into [0, 360). */
export function normalizeAngle(deg) {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Smallest signed rotation that takes `from` to `to`, in (−180, 180]. */
export function shortestAngleDelta(from, to) {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Clamp an instrument angle to the telescope's physical travel. */
export function clampTelescope(angleDeg) {
  const value = Number(angleDeg);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, TELESCOPE_MIN_DEG), TELESCOPE_MAX_DEG);
}

/**
 * Point on the instrument circle at `radius` and instrument angle `angleDeg`.
 * Screen y grows downwards, so the sine term is subtracted.
 */
export function polarToScreen(radius, angleDeg, pivot = GRATING_PIVOT) {
  const radians = angleDeg * RAD_PER_DEG;
  return {
    x: pivot.x + radius * Math.cos(radians),
    y: pivot.y - radius * Math.sin(radians),
  };
}

/** Instrument angle (degrees, anticlockwise on screen) of a diagram point. */
export function screenAngleAt(x, y, pivot = GRATING_PIVOT) {
  return Math.atan2(-(y - pivot.y), x - pivot.x) * DEG_PER_RAD;
}

/**
 * The SVG transform that places the rigid telescope group at `angleDeg`.
 * The group is authored at angle 0 (tube along +x from the pivot), so the
 * rotation is about the grating by −θ.
 */
export function telescopeRotationAttribute(angleDeg, pivot = GRATING_PIVOT) {
  const angle = clampTelescope(angleDeg);
  return `rotate(${(-angle).toFixed(3)} ${pivot.x} ${pivot.y})`;
}

/** Local (unrotated) point of the telescope body, in diagram coordinates. */
export function telescopeLocalPoint(radius, offsetY = 0, pivot = GRATING_PIVOT) {
  return { x: pivot.x + radius, y: pivot.y + offsetY };
}

/**
 * Rotate a diagram point about the grating pivot exactly as the SVG
 * `rotate(−θ cx cy)` attribute does (clockwise-positive on screen).
 */
export function rotateAboutPivot(point, svgAngleDeg, pivot = GRATING_PIVOT) {
  const radians = svgAngleDeg * RAD_PER_DEG;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

/**
 * Both ends of the telescope axis once it has been placed at `angleDeg`.
 * `inner` is the objective face (nearest the grating), `outer` the eyepiece.
 * This is pure geometry (any angle is allowed); the instrument's travel is
 * limited separately by `clampTelescope`, which the controller and the
 * renderer both apply before they ask for a placement.
 */
export function telescopeAxis(angleDeg, pivot = GRATING_PIVOT) {
  const angle = Number(angleDeg);
  const inner = polarToScreen(TELESCOPE_INNER_RADIUS, angle, pivot);
  const outer = polarToScreen(TELESCOPE_OUTER_RADIUS, angle, pivot);
  return {
    angleDeg: angle,
    inner,
    outer,
    length: Math.hypot(outer.x - inner.x, outer.y - inner.y),
    directionDeg: screenAngleAt(outer.x, outer.y, pivot),
  };
}

/**
 * Instrument angle at which a spectral line of the given side is seen.
 * `side` is "left" (−θ) or "right" (+θ), matching `apparentAngles`.
 */
export function lineTelescopeAngle(angles, side) {
  if (!angles) return { angleDeg: NaN, valid: false };
  const right = side === "right";
  const valid = right ? Boolean(angles.rightValid) : Boolean(angles.leftValid);
  const angleDeg = right ? angles.rightDeg : angles.leftDeg;
  return { angleDeg: valid && Number.isFinite(angleDeg) ? angleDeg : NaN, valid };
}
