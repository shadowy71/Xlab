export const MODE_COPY = Object.freeze({
  manual: {
    heading: "Manual drive",
    observe:
      "Move the left driver with its slider or by dragging the handle, then press Play. Each particle stays at the same horizontal position and responds only after the disturbance reaches it. Watch the delay between the driver and points farther right.",
    controlNote:
      "Frequency is not used while Manual is selected. Step advances 1/30 s of simulated time when playback is paused.",
  },
  oscillate: {
    heading: "Continuous drive",
    observe:
      "The driver repeats sinusoidally. The wave at a point farther right is the same motion delayed by x/v. Watch the phase lag from left to right: the pattern travels while individual particles oscillate vertically around equilibrium.",
    controlNote:
      "Wavelength λ = v/f. Frequency changes the source for future samples; the existing wave keeps its earlier history.",
  },
  pulse: {
    heading: "Single pulse",
    observe:
      "Send pulse launches one smooth, localized half-cycle. Follow its shape to the right boundary and then watch what returns. The particle dots stay in place; only the disturbance changes position.",
    controlNote:
      "Frequency sets pulse duration: one pulse is half of the equivalent oscillator period, clamped to 0.14–1.20 s.",
  },
});

export const END_COPY = Object.freeze({
  fixed: {
    heading: "Fixed end",
    observe:
      "The endpoint cannot move, so it is a node. The reflected pulse is inverted: a crest returns as a trough. The display adds an inverted, delayed copy of the source.",
    short: "inverted reflection · node",
  },
  loose: {
    heading: "Loose end",
    observe:
      "The end ring can slide vertically, so it is an antinode. The reflected pulse keeps its sign: a crest returns as a crest. The display adds an upright, delayed copy of the source.",
    short: "upright reflection · antinode",
  },
  noEnd: {
    heading: "No end",
    observe:
      "There is no reflecting boundary in view. The disturbance continues out of the visible region and no pulse returns. The right edge is an open view boundary, not a physical termination.",
    short: "exits view · no reflection",
  },
});

export const TOPIC_DISCLAIMER =
  "Starter placeholders only — not a complete or official PCCOE F.Y. Physics syllabus.";
