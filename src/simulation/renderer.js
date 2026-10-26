import {
  MAX_AMPLITUDE,
  boundaryDisplacement,
  clamp,
  displacementAt,
  sourceDisplacement,
} from "../physics/shm.js";

const COLORS = Object.freeze({
  background: "#fbfcfa",
  surface: "#ffffff",
  ink: "#223033",
  muted: "#5e6d70",
  border: "#d3dcda",
  borderStrong: "#aab8b6",
  guide: "#dde5e3",
  guideLight: "#ecf0ee",
  string: "#3d4d50",
  accent: "#0b6b78",
  accentSoft: "#e4f0f0",
  red: "#b64840",
  cyan: "#168a96",
  rail: "#96a5a3",
});

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function drawArrow(ctx, x1, y1, x2, y2, color, headSize = 6) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headSize * Math.cos(angle - Math.PI / 6),
    y2 - headSize * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headSize * Math.cos(angle + Math.PI / 6),
    y2 - headSize * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawVerticalArrow(ctx, x, y0, y, color, label) {
  const distance = y - y0;
  if (Math.abs(distance) < 6) return;
  const direction = Math.sign(distance);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 4, y - direction * 7);
  ctx.lineTo(x + 4, y - direction * 7);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 7, (y0 + y) / 2);
}

function drawDoubleArrow(ctx, x, y1, y2, color) {
  drawArrow(ctx, x, (y1 + y2) / 2, x, y1, color, 4);
  drawArrow(ctx, x, (y1 + y2) / 2, x, y2, color, 4);
}

export class WaveCanvas {
  constructor(canvas, { onResize } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    if (!this.ctx) {
      throw new Error("This browser does not provide a 2D canvas context.");
    }
    this.onResize = onResize;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.geometry = null;
    this.driverPoint = { x: 0, y: 0 };

    if ("ResizeObserver" in window) {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas.parentElement || canvas);
    } else {
      this.fallbackResize = () => this.resize();
      window.addEventListener("resize", this.fallbackResize);
    }
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return;

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geometry = this.computeGeometry();
    if (this.onResize) this.onResize();
  }

  computeGeometry() {
    const compact = this.width < 560;
    const left = compact ? 44 : 74;
    const right = this.width - (compact ? 36 : 62);
    const plotTop = compact ? 88 : 96;
    const plotBottom = Math.max(plotTop + 80, this.height - (compact ? 48 : 56));
    const y0 = (plotTop + plotBottom) / 2;
    const maxWavePx = Math.max(24, (plotBottom - plotTop) / 2 - 12);
    // Fixed display scale fits the largest possible loose-end antinode (2A).
    const pxPerMeter = maxWavePx / (2 * MAX_AMPLITUDE);
    return {
      compact,
      left,
      right,
      plotTop,
      plotBottom,
      y0,
      maxWavePx,
      pxPerMeter,
      plotWidth: Math.max(1, right - left),
    };
  }

  localPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  isPointerInDriverZone(clientX, clientY) {
    if (!this.geometry) return false;
    const point = this.localPoint(clientX, clientY);
    const { plotTop, plotBottom } = this.geometry;
    return Math.abs(point.x - this.driverPoint.x) <= 24
      && point.y >= plotTop - 12
      && point.y <= plotBottom + 12;
  }

  pointerToDisplacement(clientY, controls) {
    if (!this.geometry) return 0;
    const point = this.localPoint(0, clientY);
    const value = (this.geometry.y0 - point.y) / this.geometry.pxPerMeter;
    return clamp(value, -controls.amplitude, controls.amplitude);
  }

  render({ state, controls, view }) {
    if (!this.geometry) this.geometry = this.computeGeometry();
    const ctx = this.ctx;
    const g = this.geometry;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawTopInformation(ctx, g, { state, controls, view });
    this.drawReference(ctx, g, { state, controls, view });
    this.drawWave(ctx, g, { state, controls, view });
    this.drawOscillator(ctx, g, { state, controls });
    this.drawBoundary(ctx, g, { state, controls });
    this.drawFooter(ctx, g, { controls, view });
  }

  drawTopInformation(ctx, g, { state, controls, view }) {
    if (view.stopwatch) {
      const boxWidth = g.compact ? 114 : 132;
      const boxHeight = 34;
      const x = 10;
      const y = 8;
      ctx.fillStyle = COLORS.surface;
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, boxWidth, boxHeight);
      ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = `600 12px ${MONO}`;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(`t ${state.time.toFixed(2).padStart(5, " ")} s`, x + 8, y + 11);
      ctx.font = `10px ${SANS}`;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`playback ${controls.playbackSpeed.toFixed(2)}×`, x + 8, y + 25);
    }

    if (view.ruler) {
      const rulerY = g.compact ? 57 : 61;
      ctx.strokeStyle = COLORS.borderStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.left, rulerY + 0.5);
      ctx.lineTo(g.right, rulerY + 0.5);
      ctx.stroke();

      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = COLORS.muted;
      ctx.textBaseline = "bottom";
      for (let index = 0; index <= 4; index += 1) {
        const u = index / 4;
        const x = g.left + u * g.plotWidth;
        const edgeTick = index === 0 || index === 4;
        ctx.strokeStyle = COLORS.borderStrong;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, rulerY);
        ctx.lineTo(x + 0.5, rulerY + (edgeTick ? 8 : 5));
        ctx.stroke();
        ctx.textAlign = index === 0 ? "left" : index === 4 ? "right" : "center";
        const label = index === 0 ? "0" : index === 4 ? "1.00 m" : u.toFixed(2);
        ctx.fillText(label, x, rulerY - 5);
      }
    }

    const directionY = g.plotTop - (g.compact ? 15 : 17);
    drawArrow(ctx, g.left + 8, directionY, g.right - 8, directionY, COLORS.accent, 6);
    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("disturbance travels right", (g.left + g.right) / 2, directionY - 5);
  }

  drawReference(ctx, g, { controls, view }) {
    if (!view.referenceLine) {
      ctx.strokeStyle = COLORS.borderStrong;
      ctx.lineWidth = 1;
      for (const x of [g.left, g.right]) {
        ctx.beginPath();
        ctx.moveTo(x, g.y0 - 5);
        ctx.lineTo(x, g.y0 + 5);
        ctx.stroke();
      }
      return;
    }

    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = COLORS.borderStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.left, g.y0 + 0.5);
    ctx.lineTo(g.right, g.y0 + 0.5);
    ctx.stroke();
    ctx.restore();

    const amplitudePx = controls.amplitude * g.pxPerMeter;
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = COLORS.guide;
    ctx.lineWidth = 1;
    for (const y of [g.y0 - amplitudePx, g.y0 + amplitudePx]) {
      ctx.beginPath();
      ctx.moveTo(g.left, y + 0.5);
      ctx.lineTo(g.right, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("equilibrium", g.left + 8, g.y0 - 8);
    if (amplitudePx > 18) {
      ctx.fillText("+A", g.left + 8, g.y0 - amplitudePx - 8);
      ctx.fillText("−A", g.left + 8, g.y0 + amplitudePx + 8);
    }
  }

  drawWave(ctx, g, { state, controls, view }) {
    const spacing = g.compact ? 7 : 11;
    const count = Math.max(43, Math.min(91, Math.round(g.plotWidth / spacing) + 1));
    const points = [];

    for (let index = 0; index < count; index += 1) {
      const u = index / (count - 1);
      const displacement = displacementAt(u, state, controls);
      const rawY = g.y0 - displacement * g.pxPerMeter;
      points.push({
        x: g.left + u * g.plotWidth,
        y: clamp(rawY, g.plotTop + 4, g.plotBottom - 4),
        displacement,
      });
    }

    if (view.referenceLine) {
      ctx.strokeStyle = COLORS.guideLight;
      ctx.lineWidth = 1;
      for (let index = 5; index < count; index += 8) {
        const point = points[index];
        ctx.beginPath();
        ctx.moveTo(point.x + 0.5, g.y0);
        ctx.lineTo(point.x + 0.5, point.y);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = COLORS.string;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    const radius = g.compact ? 2.6 : 3.2;
    points.forEach((point, index) => {
      ctx.fillStyle = index % 2 === 0 ? COLORS.red : COLORS.cyan;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    if (view.referenceLine) {
      let marker = points[Math.round(count * 0.35)];
      const start = Math.round(count * 0.12);
      const end = Math.round(count * 0.82);
      for (let index = start; index < end; index += 1) {
        if (Math.abs(points[index].displacement) > Math.abs(marker.displacement)) {
          marker = points[index];
        }
      }
      drawVerticalArrow(ctx, marker.x, g.y0, marker.y, COLORS.accent, "y");
    }
  }

  drawOscillator(ctx, g, { state, controls }) {
    const railX = g.left - (g.compact ? 20 : 30);
    const railHalf = Math.min(g.maxWavePx + 12, (g.plotBottom - g.plotTop) / 2);
    const railTop = g.y0 - railHalf;
    const railBottom = g.y0 + railHalf;

    ctx.strokeStyle = COLORS.rail;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railX, railTop);
    ctx.lineTo(railX, railBottom);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const y of [railTop, railBottom]) {
      ctx.beginPath();
      ctx.moveTo(railX - 5, y + 0.5);
      ctx.lineTo(railX + 5, y + 0.5);
      ctx.stroke();
    }

    const source = sourceDisplacement(state, controls);
    const driverY = clamp(
      g.y0 - source * g.pxPerMeter,
      g.plotTop + 4,
      g.plotBottom - 4,
    );
    this.driverPoint = { x: railX, y: driverY };

    ctx.strokeStyle = COLORS.string;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railX, driverY);
    ctx.lineTo(g.left, driverY);
    ctx.stroke();

    ctx.fillStyle = COLORS.accentSoft;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(railX, driverY, g.compact ? 6 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = `600 11px ${SANS}`;
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Driver", railX, railTop - 7);
    if (controls.mode === "manual") {
      drawDoubleArrow(ctx, railX + 12, railTop + 10, railBottom - 10, COLORS.accent);
      ctx.font = `10px ${SANS}`;
      ctx.fillStyle = COLORS.accent;
      ctx.textBaseline = "top";
      ctx.fillText("drag", railX, railBottom + 6);
    }
  }

  drawBoundary(ctx, g, { state, controls }) {
    const boundaryX = g.right + (g.compact ? 10 : 16);
    const boundaryY = clamp(
      g.y0 - boundaryDisplacement(state, controls) * g.pxPerMeter,
      g.plotTop + 4,
      g.plotBottom - 4,
    );

    if (controls.end === "fixed") {
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(boundaryX, g.plotTop - 3);
      ctx.lineTo(boundaryX, g.plotBottom + 8);
      ctx.stroke();

      ctx.strokeStyle = COLORS.muted;
      ctx.lineWidth = 1;
      for (let y = g.plotTop; y <= g.plotBottom + 4; y += 11) {
        ctx.beginPath();
        ctx.moveTo(boundaryX + 3, y);
        ctx.lineTo(boundaryX + 10, y - 7);
        ctx.stroke();
      }

      ctx.fillStyle = COLORS.surface;
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.fillRect(boundaryX - 5, g.y0 - 8, 10, 16);
      ctx.strokeRect(boundaryX - 5, g.y0 - 8, 10, 16);
    } else if (controls.end === "loose") {
      ctx.strokeStyle = COLORS.rail;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(boundaryX, g.plotTop);
      ctx.lineTo(boundaryX, g.plotBottom);
      ctx.stroke();
      ctx.strokeStyle = COLORS.string;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(g.right, boundaryY);
      ctx.lineTo(boundaryX, boundaryY);
      ctx.stroke();
      ctx.fillStyle = COLORS.surface;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(boundaryX, boundaryY, g.compact ? 6 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = COLORS.borderStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.right + 5, g.plotTop);
      ctx.lineTo(g.right + 5, g.plotBottom);
      ctx.stroke();
      ctx.restore();
      drawArrow(ctx, g.right - 42, g.y0, g.right + 24, g.y0, COLORS.muted, 6);
    }

    const label = controls.end === "fixed"
      ? "Fixed end"
      : controls.end === "loose"
        ? "Loose end"
        : "No end";
    const behavior = controls.end === "fixed"
      ? "inverted reflection · node"
      : controls.end === "loose"
        ? "upright reflection · antinode"
        : "pulse exits · no reflection";

    ctx.font = `600 11px ${SANS}`;
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(label, g.right - 4, g.plotTop + 8);
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textBaseline = "top";
    ctx.fillText(behavior, g.right, g.plotBottom + 10);
  }

  drawFooter(ctx, g) {
    const y = this.height - 14;
    let x = 12;
    ctx.fillStyle = COLORS.red;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    x += 9;
    ctx.fillStyle = COLORS.cyan;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    x += 11;
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const footerText = g.compact
      ? "particles move up/down · wave travels right"
      : "neighboring particles move vertically; the wave travels right";
    ctx.fillText(footerText, x, y);
  }
}
