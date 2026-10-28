/**
 * A deliberately tiny stand-in for the parts of the DOM that
 * `GratingApparatus` touches, so the SVG renderer can be exercised in `node
 * --test` without a browser or a heavyweight DOM dependency.
 *
 * It supports exactly what the renderer uses: assigning `innerHTML` (elements
 * with an `id` attribute become queryable), `querySelector("#id")`,
 * `setAttribute`, `classList`, `style`, `addEventListener`/`dispatchEvent`
 * and the pointer-capture calls. Screen-coordinate helpers used by dragging
 * are stubbed with an identity viewport matrix.
 */

export class FakeElement {
  constructor(tagName = "g") {
    this.tagName = tagName;
    this.attributes = new Map();
    this.style = {};
    this.children = new Map();
    this.listeners = new Map();
    this.classNames = new Set();
    this._html = "";
    this.classList = {
      add: (...names) => names.forEach((name) => this.classNames.add(name)),
      remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
      toggle: (name, force) => {
        const next = force === undefined ? !this.classNames.has(name) : Boolean(force);
        if (next) this.classNames.add(name);
        else this.classNames.delete(name);
        return next;
      },
      contains: (name) => this.classNames.has(name),
    };
  }

  get innerHTML() {
    return this._html;
  }

  /** Storing markup registers every `id="..."` as a queryable child stub. */
  set innerHTML(markup) {
    this._html = String(markup);
    for (const match of this._html.matchAll(/\sid="([A-Za-z][\w-]*)"/g)) {
      if (!this.children.has(match[1])) this.children.set(match[1], new FakeElement());
    }
  }

  querySelector(selector) {
    if (!selector.startsWith("#")) throw new Error(`FakeElement cannot query ${selector}`);
    return this.children.get(selector.slice(1)) || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = (this.listeners.get(type) || []).filter((entry) => entry !== handler);
    this.listeners.set(type, handlers);
  }

  dispatchEvent(event) {
    const payload = { target: this, preventDefault() {}, ...event };
    for (const handler of this.listeners.get(payload.type) || []) handler(payload);
    return true;
  }

  setPointerCapture() {}

  releasePointerCapture() {}

  /** Identity viewport: client coordinates are treated as diagram units. */
  createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform() {
        return this;
      },
    };
  }

  getScreenCTM() {
    return { inverse: () => ({}) };
  }
}

export function createFakeSvg() {
  return new FakeElement("svg");
}
