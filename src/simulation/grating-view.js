/**
 * SVG spectrometer: mercury lamp, collimator, grating turntable, rotating
 * telescope and the diffraction spectrum. All geometry is expressed in the
 * 1000 × 690 viewBox so it scales with the panel.
 *
 * The telescope is a rigid group rotated about the grating pivot — see
 * telescope-geometry.js, which owns the pivot, the angle convention and the
 * instrument's travel limits.
 */

import {
  DRAG_MIN_RADIUS,
  GRATING_PIVOT,
  TELESCOPE_INNER_RADIUS,
  TELESCOPE_LENGTH,
  TELESCOPE_MAX_DEG,
  TELESCOPE_MIN_DEG,
  TELESCOPE_OUTER_RADIUS,
  clampTelescope,
  polarToScreen,
  screenAngleAt,
  shortestAngleDelta,
  telescopeRotationAttribute,
} from "./telescope-geometry.js";

// The grating pivot is the only origin in the diagram: the telescope group is
// rotated about it, the graduated scale is centred on it and the diffraction
// rays start from it.
const CX = GRATING_PIVOT.x;
const CY = GRATING_PIVOT.y;
const PLINTH_RADIUS = 236;
const SCALE_RADIUS = 198;
const SCALE_OUTER = 216;
const RAY_RADIUS = 300;

/** Diagram point at `radius` and instrument angle `angleDeg` (y up). */
function polar(radius, angleDeg) {
  return polarToScreen(radius, angleDeg, GRATING_PIVOT);
}

// The telescope body is authored once, at 0 deg, with its axis along +x from
// the pivot. All offsets are radii measured from the grating, so the drawing
// and the authoritative geometry in telescope-geometry.js can never drift
// apart: the objective sits at TELESCOPE_INNER_RADIUS and the eyepiece face at
// TELESCOPE_OUTER_RADIUS.
const OBJECTIVE_FACE = TELESCOPE_INNER_RADIUS; // 202
const OBJECTIVE_LENS = OBJECTIVE_FACE + 11; // 213
const TUBE_START = OBJECTIVE_FACE + 16; // 218
const TUBE_END = TUBE_START + 104; // 322
const DRAW_TUBE_END = TUBE_END + 18; // 340
const EYEPIECE_CENTRE = TELESCOPE_OUTER_RADIUS - 9; // 355
const CROSSWIRE = TUBE_START + 50; // 268
const INDEX_MARK = OBJECTIVE_FACE + 5; // 207

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    return "&quot;";
  });
}

export class GratingApparatus {
  constructor(svg, options = {}) {
    this.svg = svg;
    this.onRotate = options.onRotate || (() => {});
    this.onInteraction = options.onInteraction || (() => {});
    this.telescope = 0;
    this.dragging = false;
    this.lastPointerAngle = 0;
    this.build();
    this.bindPointer();
  }

  build() {
    this.svg.innerHTML = `
      <defs>
        <linearGradient id="metal-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4c5768" />
          <stop offset="40%" stop-color="#333d4c" />
          <stop offset="100%" stop-color="#1c242f" />
        </linearGradient>
        <linearGradient id="metal-tube" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7d8a9d" />
          <stop offset="18%" stop-color="#596678" />
          <stop offset="60%" stop-color="#333c4a" />
          <stop offset="100%" stop-color="#171d26" />
        </linearGradient>
        <linearGradient id="metal-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#0f151d" />
          <stop offset="50%" stop-color="#67748a" />
          <stop offset="100%" stop-color="#0f151d" />
        </linearGradient>
        <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#d9b877" />
          <stop offset="45%" stop-color="#a9884c" />
          <stop offset="100%" stop-color="#6d5730" />
        </linearGradient>
        <radialGradient id="lamp-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#dff3ff" stop-opacity="0.95" />
          <stop offset="35%" stop-color="#9ad8ff" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#4a8cff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="plinth-shade" cx="42%" cy="34%" r="72%">
          <stop offset="0%" stop-color="#2b3648" />
          <stop offset="65%" stop-color="#1d2635" />
          <stop offset="100%" stop-color="#111823" />
        </radialGradient>
        <radialGradient id="beam-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#dbeeff" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#8ecbff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="bench-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#182130" />
          <stop offset="100%" stop-color="#0d131c" />
        </linearGradient>
        <pattern id="grating-ruling" width="5" height="80" patternUnits="userSpaceOnUse">
          <rect width="5" height="80" fill="#0a1a24" />
          <rect x="0" width="2" height="80" fill="#6ee7ff" opacity="0.5" />
        </pattern>
        <pattern id="reticle-grid" width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M18 0H0V18" fill="none" stroke="#7de8ff" stroke-opacity="0.16" stroke-width="0.8" />
        </pattern>
      </defs>

      <rect class="svg-bench" x="0" y="672" width="1000" height="18" fill="url(#bench-gradient)" />
      <line class="svg-bench-line" x1="0" y1="672" x2="1000" y2="672" />

      <g class="spectrometer" aria-hidden="true">
        <ellipse cx="${CX}" cy="${CY + 16}" rx="${PLINTH_RADIUS + 12}" ry="${PLINTH_RADIUS}" fill="#0b111a" opacity="0.85" />
        <circle cx="${CX}" cy="${CY}" r="${PLINTH_RADIUS}" fill="url(#plinth-shade)" stroke="#3c4a5e" stroke-width="2" />
        <circle cx="${CX}" cy="${CY}" r="${PLINTH_RADIUS - 8}" fill="none" stroke="#0c1420" stroke-width="6" />
        <circle cx="${CX}" cy="${CY}" r="${SCALE_OUTER}" fill="#121b27" stroke="#4a5a70" stroke-width="1.5" />
        <circle cx="${CX}" cy="${CY}" r="${SCALE_RADIUS}" fill="#0d1621" stroke="#3a4a5f" stroke-width="1" />
        <circle cx="${CX}" cy="${CY}" r="118" fill="#101925" stroke="#334153" stroke-width="1.5" />

        <g id="svg-scale-ticks"></g>

        <g id="svg-turntable">
          <circle cx="${CX}" cy="${CY}" r="104" fill="none" stroke="#263447" stroke-width="1" />
          <circle cx="${CX}" cy="${CY}" r="74" fill="url(#metal-top)" stroke="#5a6a80" stroke-width="1.5" />
          <circle cx="${CX}" cy="${CY}" r="58" fill="#16202c" stroke="#39485c" stroke-width="1" />
          <g id="svg-grating-mount">
            <rect x="${CX - 44}" y="${CY - 34}" width="88" height="68" rx="6" fill="#101a26" stroke="#4a5c72" stroke-width="2" />
            <rect x="${CX - 34}" y="${CY - 25}" width="68" height="50" rx="3" fill="#0a141d" stroke="#2f4155" stroke-width="1" />
            <line x1="${CX - 34}" y1="${CY + 25}" x2="${CX + 34}" y2="${CY + 25}" stroke="#6d8298" stroke-width="3" />
            <g id="svg-grating-plate"></g>
            <circle cx="${CX}" cy="${CY}" r="5" fill="#0b1119" stroke="#5d7089" stroke-width="1.5" />
          </g>
        </g>

        <!-- The lamp, collimator and slit are all laid out on the optical axis
             (y = CY), which is the same line the incident beam travels along. -->
        <g id="svg-lamp-unit">
          <rect x="24" y="${CY - 44}" width="86" height="88" rx="12" fill="url(#metal-top)" stroke="#55647a" stroke-width="2" />
          <rect x="34" y="${CY - 30}" width="66" height="26" rx="4" fill="#0b121b" stroke="#2c3a4c" stroke-width="1" />
          <text x="67" y="${CY - 13}" text-anchor="middle" class="svg-plate-text">Hg</text>
          <circle cx="112" cy="${CY}" r="26" fill="url(#lamp-glow)" class="lamp-glow" />
          <circle cx="112" cy="${CY}" r="13" fill="#0d1a26" stroke="#7f93a8" stroke-width="2" />
          <circle cx="112" cy="${CY}" r="8" class="lamp-bulb" />
          <rect x="60" y="${CY + 44}" width="16" height="96" fill="url(#metal-edge)" />
          <rect x="26" y="${CY + 138}" width="84" height="14" rx="4" fill="url(#metal-top)" stroke="#47566b" stroke-width="1" />
          <text x="112" y="${CY + 122}" text-anchor="middle" class="svg-small-label">Mercury lamp</text>
        </g>

        <g id="svg-spectrum-rays"></g>

        <g id="svg-collimator-unit">
          <g id="svg-collimator-body">
            <rect x="150" y="${CY + 52}" width="18" height="96" fill="url(#metal-edge)" />
            <rect x="120" y="${CY + 140}" width="80" height="14" rx="4" fill="url(#metal-top)" stroke="#47566b" stroke-width="1" />
            <rect x="146" y="${CY - 18}" width="206" height="36" rx="10" fill="url(#metal-tube)" stroke="#5c6b80" stroke-width="1.5" />
            <rect x="156" y="${CY - 12}" width="60" height="6" rx="3" fill="#93a3b8" opacity="0.35" />
            <ellipse cx="236" cy="${CY}" rx="9" ry="17" fill="#1d3242" stroke="#7f97ad" stroke-width="2" />
            <rect x="330" y="${CY - 22}" width="16" height="44" rx="3" fill="url(#metal-top)" stroke="#5b6b81" stroke-width="1.5" />
            <g id="svg-slit-jaws">
              <rect x="346" y="${CY - 22}" width="8" height="16" rx="2" fill="#c0ccdb" />
              <rect x="346" y="${CY + 6}" width="8" height="16" rx="2" fill="#c0ccdb" />
            </g>
            <circle cx="176" cy="${CY}" r="8" fill="url(#brass)" stroke="#4c3f22" stroke-width="1" />
            <text x="238" y="${CY - 34}" text-anchor="middle" class="svg-small-label">Collimator</text>
          </g>
          <g id="svg-incident-beam" class="beam"></g>
        </g>

        <!-- Telescope: the body travels around the grating on a circular path
             at a constant radius, always keeping its objective facing the
             grating. The whole group is rotated about the turntable centre,
             which is the grating, so the orbit is exactly concentric with it. -->
        <g id="svg-telescope-arm" class="svg-telescope-arm">
          <!-- objective barrel, aimed at the grating -->
          <rect x="${CX + OBJECTIVE_FACE}" y="${CY - 21}" width="16" height="42" rx="5" fill="url(#metal-top)" stroke="#74879e" stroke-width="1.4" />
          <circle cx="${CX + OBJECTIVE_LENS}" cy="${CY}" r="8" fill="#0d1b26" stroke="#8ba0b6" stroke-width="1.4" />
          <circle cx="${CX + OBJECTIVE_LENS}" cy="${CY}" r="3.2" fill="#050c12" stroke="#5d7285" stroke-width="0.8" />

          <!-- index marks: where the body crosses the graduated ring -->
          <line x1="${CX + INDEX_MARK}" y1="${CY - 21}" x2="${CX + INDEX_MARK}" y2="${CY - 28}" stroke="#7de8ff" stroke-width="2" />
          <line x1="${CX + INDEX_MARK}" y1="${CY + 21}" x2="${CX + INDEX_MARK}" y2="${CY + 28}" stroke="#7de8ff" stroke-width="2" />

          <!-- main tube -->
          <rect x="${CX + TUBE_START}" y="${CY - 18}" width="${TUBE_END - TUBE_START}" height="36" rx="16" fill="url(#metal-tube)" stroke="#63738a" stroke-width="1.5" />
          <rect x="${CX + TUBE_START + 12}" y="${CY - 12}" width="${TUBE_END - TUBE_START - 24}" height="6" rx="3" fill="#b3c4d8" opacity="0.3" />
          <rect x="${CX + TUBE_START + 28}" y="${CY - 19}" width="7" height="38" rx="2" fill="#20303f" stroke="#5a6b81" stroke-width="0.8" />
          <rect x="${CX + TUBE_END - 26}" y="${CY - 19}" width="7" height="38" rx="2" fill="#20303f" stroke="#5a6b81" stroke-width="0.8" />

          <!-- draw tube and eyepiece -->
          <rect x="${CX + TUBE_END}" y="${CY - 13}" width="18" height="26" rx="5" fill="url(#metal-top)" stroke="#6a7b91" stroke-width="1" />
          <rect x="${CX + DRAW_TUBE_END}" y="${CY - 11}" width="13" height="22" rx="4" fill="url(#brass)" stroke="#4b3d20" stroke-width="1" />
          <circle cx="${CX + EYEPIECE_CENTRE}" cy="${CY}" r="9" fill="#111a24" stroke="url(#brass)" stroke-width="3" />
          <circle cx="${CX + EYEPIECE_CENTRE}" cy="${CY}" r="3.5" fill="#050c12" stroke="#8ea1b6" stroke-width="0.9" />

          <!-- vertical crosswire seen through the tube -->
          <g id="svg-telescope-crosshair">
            <line x1="${CX + CROSSWIRE}" y1="${CY - 17}" x2="${CX + CROSSWIRE}" y2="${CY + 17}" stroke="#7de8ff" stroke-width="1" opacity="0.55" />
          </g>

          <g id="svg-telescope-handle" class="telescope-handle">
            <rect x="${CX + TUBE_START}" y="${CY - 22}" width="${TUBE_END - TUBE_START}" height="44" rx="18" fill="transparent" />
            <path d="M${CX + TUBE_END - 34} ${CY - 29} L${CX + TUBE_END - 26} ${CY - 29} M${CX + TUBE_END - 34} ${CY + 29} L${CX + TUBE_END - 26} ${CY + 29}" stroke="#4ee3ff" stroke-width="1.6" opacity="0.45" stroke-linecap="round" />
          </g>
        </g>

        <g id="svg-spectrum-markers"></g>
        <g id="svg-alignment-badge" class="alignment-badge"></g>
      </g>
    `;

    this.scaleTicks = this.svg.querySelector("#svg-scale-ticks");
    this.spectrumRays = this.svg.querySelector("#svg-spectrum-rays");
    this.spectrumMarkers = this.svg.querySelector("#svg-spectrum-markers");
    this.arm = this.svg.querySelector("#svg-telescope-arm");
    this.gratingPlate = this.svg.querySelector("#svg-grating-plate");
    this.gratingMount = this.svg.querySelector("#svg-grating-mount");
    this.incidentBeam = this.svg.querySelector("#svg-incident-beam");
    this.slitJaws = this.svg.querySelector("#svg-slit-jaws");
    this.lampUnit = this.svg.querySelector("#svg-lamp-unit");
    this.collimatorBody = this.svg.querySelector("#svg-collimator-body");
    this.alignmentBadge = this.svg.querySelector("#svg-alignment-badge");
    this.telescopeHandle = this.svg.querySelector("#svg-telescope-handle");
    this.lastZero = null;
    this.renderScale(0);
    this.applyArmRotation();
  }

  /** Tick marks and degree numerals. Numerals show raw scale readings. */
  renderScale(zeroOffsetDeg = 0) {
    if (this.lastZero === zeroOffsetDeg) return;
    this.lastZero = zeroOffsetDeg;
    const parts = [];
    for (let reading = 0; reading < 360; reading += 1) {
      const angle = reading - zeroOffsetDeg;
      const major = reading % 30 === 0;
      const medium = reading % 5 === 0;
      const radiusInner = major ? 180 : medium ? 188 : 192;
      const inner = polar(radiusInner, angle);
      const outer = polar(SCALE_OUTER - 2, angle);
      parts.push(
        `<line x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}" stroke="${major ? "#9fb4cb" : medium ? "#70839a" : "#4b5c71"}" stroke-width="${major ? 1.8 : medium ? 1.1 : 0.7}" />`,
      );
      if (major) {
        const label = polar(172, angle);
        parts.push(
          `<text x="${label.x.toFixed(2)}" y="${(label.y + 3).toFixed(2)}" text-anchor="middle" class="scale-numeral">${reading}</text>`,
        );
      }
    }
    parts.push(
      `<circle cx="${CX}" cy="${CY}" r="${SCALE_OUTER - 2}" fill="none" stroke="#596a80" stroke-width="1" />`,
    );
    this.scaleTicks.innerHTML = parts.join("");
  }

  /**
   * Rotates the telescope arm about the turntable centre.
   *
   * The whole tube is one rigid group authored at 0°, so the only thing that
   * changes is the SVG transform. It is written as the attribute
   * `transform="rotate(a 500 340)"` rather than a CSS transform: an SVG
   * transform attribute is resolved in user space by every browser, so the
   * tube always pivots about the grating instead of its own bounding box.
   *
   * The angle is applied exactly as given (no easing): the drawing and the
   * vernier readout both come from `state.telescope`, so the tube can never
   * be left chasing a stale angle while the numbers have already moved on.
   */
  setTelescope(angleDeg) {
    this.telescope = clampTelescope(angleDeg);
    this.applyArmRotation();
  }

  applyArmRotation() {
    if (!this.arm) return;
    this.arm.setAttribute(
      "transform",
      telescopeRotationAttribute(this.telescope, GRATING_PIVOT),
    );
  }

  /** Moves the telescope by a delta in degrees. */
  nudge(deltaDeg) {
    const next = clampTelescope(this.telescope + deltaDeg);
    this.setTelescope(next);
    this.onRotate(next);
  }

  render(state) {
    this.setTelescope(state.telescope);
    this.renderScale(state.zeroOffset || 0);
    this.lampUnit.classList.toggle("is-on", Boolean(state.lampOn));
    this.collimatorBody.classList.toggle("is-misaligned", !state.collimatorAligned);
    this.gratingMount.classList.toggle("is-empty", !state.gratingMounted);
    this.gratingMount.classList.toggle("is-tilted", Math.abs(state.tilt) > 0.05);

    // Slit jaws: 0.05 - 1.00 mm maps to a visible gap.
    const gap = clamp(3 + state.slitWidth * 14, 3, 18);
    const jawLength = 38 - gap / 2;
    this.slitJaws.innerHTML = `
      <rect x="346" y="${(CY - 22).toFixed(1)}" width="8" height="${jawLength.toFixed(1)}" rx="2" fill="#c0ccdb" />
      <rect x="346" y="${(CY + 22 - jawLength).toFixed(1)}" width="8" height="${jawLength.toFixed(1)}" rx="2" fill="#c0ccdb" />
    `;

    // Incident beam from the collimator slit to the grating.
    if (state.lampOn) {
      const start = 356;
      const endX = CX - 46;
      const beamWidth = clamp(4 + state.slitWidth * 6, 4, 12);
      if (state.collimatorAligned) {
        this.incidentBeam.innerHTML = `
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY}" stroke="#8fd4ff" stroke-width="${beamWidth}" opacity="0.16" />
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY}" stroke="#d7f0ff" stroke-width="2" class="incident-ray" />
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY}" stroke="#ffffff" stroke-width="${clamp(1 + state.slitWidth * 3, 1, 4)}" opacity="0.55" stroke-dasharray="7 12" class="flow-dash" />
        `;
      } else {
        const spread = 22 + state.slitWidth * 26;
        this.incidentBeam.innerHTML = `
          <path d="M${start} ${CY} L${endX} ${CY - spread} L${endX} ${CY + spread} Z" fill="#8fd4ff" opacity="0.1" />
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY - spread}" stroke="#d7f0ff" stroke-width="1.4" opacity="0.7" />
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY}" stroke="#d7f0ff" stroke-width="1.4" opacity="0.5" />
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY + spread}" stroke="#d7f0ff" stroke-width="1.4" opacity="0.7" />
          <line x1="${start}" y1="${CY}" x2="${endX}" y2="${CY + spread * 0.45}" stroke="#ffffff" stroke-width="1" opacity="0.4" stroke-dasharray="5 10" class="flow-dash" />
          <text x="${(start + endX) / 2}" y="${CY - spread - 8}" text-anchor="middle" class="divergent-label">Divergent rays · align collimator</text>
        `;
      }
      this.incidentBeam.classList.add("is-live");
    } else {
      this.incidentBeam.innerHTML = "";
      this.incidentBeam.classList.remove("is-live");
    }

    this.renderGrating(state);
    this.renderSpectrum(state);
    this.renderBadge(state);
  }

  renderGrating(state) {
    if (!state.gratingMounted) {
      this.gratingPlate.innerHTML = "";
      return;
    }
    this.gratingPlate.innerHTML = `
      <g transform="rotate(${(state.tilt || 0).toFixed(2)} ${CX} ${CY})">
        <rect x="${CX - 32}" y="${CY - 23}" width="64" height="46" rx="2" fill="url(#grating-ruling)" stroke="#6ee7ff" stroke-opacity="0.55" stroke-width="1.2" />
        <rect x="${CX - 32}" y="${CY - 23}" width="64" height="46" rx="2" fill="#7de8ff" opacity="0.06" />
        <text x="${CX}" y="${CY + 4}" text-anchor="middle" class="svg-grating-label">15000 / inch</text>
        <line x1="${CX}" y1="${CY - 23}" x2="${CX}" y2="${CY + 23}" stroke="#e9f6ff" stroke-width="1" opacity="0.5" />
      </g>
    `;
    this.telescopeHandle.style.cursor = "grab";
  }

  renderSpectrum(state) {
    const rays = [];
    const markers = [];

    if (state.lampOn && state.gratingMounted) {
      // Central (zero order) maximum always follows the incident beam.
      rays.push(
        `<line x1="${CX}" y1="${CY}" x2="${polar(RAY_RADIUS, 0).x}" y2="${polar(RAY_RADIUS, 0).y}" stroke="#eaf6ff" stroke-width="7" opacity="0.12" />`,
        `<line x1="${CX}" y1="${CY}" x2="${polar(RAY_RADIUS, 0).x}" y2="${polar(RAY_RADIUS, 0).y}" stroke="#f4fbff" stroke-width="2" opacity="0.75" />`,
      );
      markers.push(`
        <g class="central-max">
          <rect x="${polar(SCALE_RADIUS - 6, 0).x - 3}" y="${CY - 13}" width="6" height="26" rx="2" fill="#f6fcff" />
          <text x="${CX + 348}" y="${CY - 11}" text-anchor="middle" class="spectrum-label central-label">0°</text>
        </g>
      `);
      // Name the two sides of the spectrum so the scale readings make sense.
      markers.push(`
        <text x="872" y="196" text-anchor="end" class="spectrum-side-label">RIGHT · +θ</text>
        <text x="872" y="506" text-anchor="end" class="spectrum-side-label">LEFT · −θ</text>
      `);
    }

    for (const line of state.lines || []) {
      if (!line.visible) continue;
      const dim = line.selected ? 1 : state.selectedColour ? 0.42 : 0.8;
      const sides = [
        { angle: line.leftDeg, valid: line.leftValid, side: -1 },
        { angle: line.rightDeg, valid: line.rightValid, side: 1 },
      ];
      for (const side of sides) {
        if (!side.valid || !Number.isFinite(side.angle)) continue;
        const end = polar(RAY_RADIUS, side.angle);
        const glowStart = polar(56, side.angle);
        const width = line.selected ? 3.4 : 2.2;
        rays.push(
          `<line x1="${glowStart.x.toFixed(2)}" y1="${glowStart.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" stroke="${line.color}" stroke-width="${width + 6}" opacity="${(0.12 * dim).toFixed(2)}" stroke-linecap="round" />`,
          `<line x1="${glowStart.x.toFixed(2)}" y1="${glowStart.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" stroke="${line.color}" stroke-width="${width}" opacity="${(0.85 * dim).toFixed(2)}" stroke-linecap="round" ${line.selected ? 'class="selected-ray"' : ""} />`,
        );
        const markInner = polar(SCALE_RADIUS - 4, side.angle);
        const markOuter = polar(SCALE_OUTER - 1, side.angle);
        const labelPos = polar(SCALE_RADIUS + 16, side.angle);
        const blurWidth = line.blurred ? 10 : 4;
        markers.push(
          `<line x1="${markInner.x.toFixed(2)}" y1="${markInner.y.toFixed(2)}" x2="${markOuter.x.toFixed(2)}" y2="${markOuter.y.toFixed(2)}" stroke="${line.color}" stroke-width="${blurWidth}" opacity="${(0.35 * dim).toFixed(2)}" stroke-linecap="round" />`,
          `<line x1="${markInner.x.toFixed(2)}" y1="${markInner.y.toFixed(2)}" x2="${markOuter.x.toFixed(2)}" y2="${markOuter.y.toFixed(2)}" stroke="${line.color}" stroke-width="${blurWidth / 2}" opacity="${(0.95 * dim).toFixed(2)}" stroke-linecap="round" />`,
          `<text x="${labelPos.x.toFixed(2)}" y="${(labelPos.y + 3).toFixed(2)}" text-anchor="middle" class="spectrum-letter ${line.selected ? "is-selected" : ""}" fill="${line.color}" opacity="${(line.selected ? 1 : 0.72).toFixed(2)}">${esc(line.letter)}</text>`,
        );
        if (line.selected) {
          const full = polar(RAY_RADIUS + 56, side.angle);
          const labelY = Math.min(Math.max(full.y, 34), 592);
          const label = `${line.name} · ${line.angleLabel}`;
          const width = label.length * 5.6 + 14;
          markers.push(
            `<g class="spectrum-name-group">
              <line x1="${polar(RAY_RADIUS + 4, side.angle).x.toFixed(1)}" y1="${full.y.toFixed(1)}" x2="${(full.x - (side.angle >= 0 ? width / 2 : -width / 2)).toFixed(1)}" y2="${labelY.toFixed(1)}" stroke="${line.color}" stroke-opacity="0.35" stroke-width="1" />
              <rect x="${(full.x - width / 2).toFixed(2)}" y="${(labelY - 10).toFixed(2)}" width="${width.toFixed(1)}" height="17" rx="8.5" fill="#050e16" opacity="0.86" stroke="${line.color}" stroke-opacity="0.3" />
              <text x="${full.x.toFixed(2)}" y="${(labelY + 2.5).toFixed(2)}" text-anchor="middle" class="spectrum-name" fill="${line.color}">${esc(label)}</text>
            </g>`,
          );
        }
      }
    }

    this.spectrumRays.innerHTML = rays.join("");
    this.spectrumMarkers.innerHTML = markers.join("");
  }

  renderBadge(state) {
    if (!state.lampOn || !state.gratingMounted) {
      this.alignmentBadge.innerHTML = "";
      return;
    }
    if (state.alignedLine) {
      const text = "Crosswire aligned";
      this.alignmentBadge.innerHTML = `
        <g transform="translate(${CX} 52)">
          <rect x="-84" y="-15" width="168" height="30" rx="15" fill="#062a2f" stroke="#3fe4c8" stroke-width="1.5" />
          <circle cx="-62" cy="0" r="4.5" fill="#3fe4c8" />
          <text x="-48" y="5" class="badge-text">${esc(text)}</text>
        </g>
      `;
      return;
    }
    this.alignmentBadge.innerHTML = "";
  }

  bindPointer() {
    const toLocal = (event) => {
      const point = this.svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = this.svg.getScreenCTM();
      if (!matrix) return null;
      return point.matrixTransform(matrix.inverse());
    };

    const pointerAngle = (event) => {
      const local = toLocal(event);
      if (!local) return null;
      return {
        angle: screenAngleAt(local.x, local.y, GRATING_PIVOT),
        radius: Math.hypot(local.x - CX, local.y - CY),
      };
    };

    this.svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const info = pointerAngle(event);
      if (!info || info.radius < DRAG_MIN_RADIUS) return;
      this.dragging = true;
      this.lastPointerAngle = info.angle;
      this.svg.setPointerCapture?.(event.pointerId);
      this.svg.classList.add("is-dragging");
      this.telescopeHandle.style.cursor = "grabbing";
      event.preventDefault();
      this.onInteraction("drag-start");
    });

    this.svg.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const info = pointerAngle(event);
      if (!info) return;
      const delta = shortestAngleDelta(this.lastPointerAngle, info.angle);
      this.lastPointerAngle = info.angle;
      const next = clampTelescope(this.telescope + delta);
      if (Math.abs(next - this.telescope) < 1e-6) return;
      this.setTelescope(next);
      this.onRotate(next);
    });

    const endDrag = (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.svg.classList.remove("is-dragging");
      this.telescopeHandle.style.cursor = "grab";
      this.svg.releasePointerCapture?.(event.pointerId);
      this.onInteraction("drag-end");
    };
    this.svg.addEventListener("pointerup", endDrag);
    this.svg.addEventListener("pointercancel", endDrag);
    this.svg.addEventListener("lostpointercapture", () => {
      this.dragging = false;
      this.svg.classList.remove("is-dragging");
    });
  }
}

export const APPARATUS_GEOMETRY = Object.freeze({
  centerX: CX,
  centerY: CY,
  minTelescope: TELESCOPE_MIN_DEG,
  maxTelescope: TELESCOPE_MAX_DEG,
  scaleRadius: SCALE_RADIUS,
  telescopeInnerRadius: TELESCOPE_INNER_RADIUS,
  telescopeOuterRadius: TELESCOPE_OUTER_RADIUS,
  telescopeLength: TELESCOPE_LENGTH,
});
