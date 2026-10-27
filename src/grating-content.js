/** Teaching copy for the diffraction grating laboratory. */

export const STAGES = Object.freeze([
  { id: 1, key: "intro", short: "Introduction", title: "Introduction and aim" },
  { id: 2, key: "setup", short: "Apparatus setup", title: "Set up the spectrometer" },
  { id: 3, key: "observe", short: "Observe spectrum", title: "Observe the diffraction spectrum" },
  { id: 4, key: "left", short: "Left reading", title: "Measure the left-hand spectral line" },
  { id: 5, key: "right", short: "Right reading", title: "Measure the right-hand spectral line" },
  { id: 6, key: "angle", short: "Diffraction angle", title: "Calculate the diffraction angle" },
  { id: 7, key: "wavelength", short: "Wavelength", title: "Calculate the wavelength" },
  { id: 8, key: "compare", short: "Comparison", title: "Compare with the standard value" },
  { id: 9, key: "complete", short: "Complete", title: "Complete observation table and result" },
]);

export const STAGE_BY_ID = Object.freeze(
  Object.fromEntries(STAGES.map((stage) => [stage.id, stage])),
);

export const THEORY_NOTES = Object.freeze({
  gratingElement:
    "The grating element d is the distance between the centres of two adjacent slits. A grating ruled with N lines per inch has d = 2.54 / N cm.",
  equation:
    "Parallel rays from the collimator fall on the grating. For a principal maximum, the path difference between light from adjacent slits must be a whole number of wavelengths: d sin θ = n λ.",
  order:
    "The integer n is the order of the spectrum. Only orders with n λ / d ≤ 1 exist, so θ = arcsin(n λ / d) has a real solution.",
  colour:
    "Because θ = arcsin(n λ / d) increases with λ, red light is diffracted through a larger angle than violet light in the same order.",
  twoSide:
    "The diffraction angle is measured as half the angular separation of a line and its counterpart on the other side of the central maximum: θ = (θ₂ − θ₁) / 2. Using both sides cancels a constant zero error of the scale.",
  deviation:
    "Percentage deviation compares the experimental wavelength with the standard value: ((λ_exp − λ_std) / λ_std) × 100.",
});

export const ALIGNMENT_COPY = Object.freeze({
  lampOff: "The mercury lamp is off. Switch it on to see the spectrum.",
  collimatorOff:
    "The collimator is not producing parallel rays. Align it so the slit is at the focal length of the collimating lens.",
  gratingOff: "The grating is not mounted in the holder. Mount the grating to obtain a spectrum.",
  tilted:
    "The grating normal is tilted with respect to the incident beam, so the two sides are not symmetric. Rotate the grating back towards 0.0°.",
  telescopeOffLine: "Rotate the telescope until the selected spectral line lies on the vertical crosswire.",
});

/** Guide text: the function receives a compact lab-state snapshot. */
export function guideFor(state) {
  const { stage, mode, lampOn, collimatorAligned, gratingMounted, colourName, side, aligned, locked, orderValid, readingsComplete, selectedReadings } = state;

  if (mode === "free") {
    if (!lampOn) return { text: "Free-observation mode: switch on the mercury lamp to start exploring.", action: "lamp" };
    if (!gratingMounted) return { text: "Free-observation mode: mount the grating in the central holder.", action: "grating" };
    return {
      text: "Free-observation mode. Rotate the telescope, lock it on any spectral line and record readings whenever you like. The observation tables update automatically.",
      action: null,
    };
  }

  if (stage === 1) {
    return {
      text: "Read the aim and theory, then start the experiment to set up the spectrometer.",
      action: "start",
    };
  }

  if (stage === 2) {
    if (!lampOn) return { text: "Switch on the mercury lamp to begin.", action: "lamp" };
    if (!collimatorAligned) {
      return { text: "Align the collimator so that it sends a parallel beam of light onto the grating.", action: "collimator" };
    }
    if (!gratingMounted) return { text: "Mount the diffraction grating on the spectrometer turntable.", action: "grating" };
    return {
      text: "The grating normal must be perpendicular to the incident beam. Set the grating tilt to 0.0° and continue to the spectrum.",
      action: "continue",
    };
  }

  if (stage === 3) {
    if (!readingsComplete) {
      return {
        text: `Observe the ${colourName.toLowerCase()} line on both sides of the central maximum, then measure the left-hand reading.`,
        action: "left",
      };
    }
    return { text: "All four colours have readings. Continue to complete the experiment.", action: "complete" };
  }

  if (stage === 4) {
    if (side === "left" && selectedReadings.left) {
      return { text: "Left reading recorded. Now measure the matching line on the right side.", action: "right" };
    }
    if (locked && !aligned) {
      return { text: "The telescope is still locked from the last reading. Unlock it before rotating.", action: "unlock" };
    }
    if (!aligned) {
      return {
        text: `Rotate the telescope towards the ${colourName.toLowerCase()} line on the left of the central maximum and align the vertical crosswire with it.`,
        action: "align",
      };
    }
    if (!locked) {
      return { text: "The crosswire is on the line. Lock the telescope to take the reading.", action: "lock" };
    }
    return { text: "Telescope locked. Record the left-hand angular position as θ₁.", action: "record-left" };
  }

  if (stage === 5) {
    if (side === "left") {
      return { text: "Left reading saved. Measure the corresponding spectral line on the right side.", action: "right" };
    }
    if (selectedReadings.right) {
      return { text: "Both readings are recorded. Calculate the angular separation.", action: "angle" };
    }
    if (locked && !aligned) {
      return { text: "Unlock the telescope, swing it across the central maximum to the matching line, then lock it again.", action: "unlock" };
    }
    if (!aligned) {
      return {
        text: `Swing the telescope across the central maximum to the ${colourName.toLowerCase()} line on the right side and centre it on the crosswire.`,
        action: "align",
      };
    }
    if (!locked) {
      return { text: "The crosswire is on the line. Lock the telescope to take the reading.", action: "lock" };
    }
    return { text: "Telescope locked. Record the right-hand angular position as θ₂.", action: "record-right" };
  }

  if (stage === 6) {
    if (!(selectedReadings.left && selectedReadings.right)) {
      return { text: "Record both left and right readings for this colour first.", action: "left" };
    }
    return { text: "The separation and the diffraction angle are shown below. Continue to the wavelength calculation.", action: "wavelength" };
  }

  if (stage === 7) {
    if (!(selectedReadings.left && selectedReadings.right)) {
      return { text: "Record both readings before calculating the wavelength.", action: "left" };
    }
    return { text: "Use λ = d sin θ with the measured half-separation, then compare it with the standard wavelength.", action: "compare" };
  }

  if (stage === 8) {
    return {
      text: "Compare the experimental and standard wavelengths, note the percentage deviation, and continue when you are satisfied with the reading.",
      action: "next-colour",
    };
  }

  if (!readingsComplete) {
    return { text: "Some colours are still unmeasured. Return to the spectrum and complete them.", action: "observe" };
  }
  return { text: "All four wavelengths are calculated. Review the observation table and the lab journal.", action: null };
}

export const VIVA_QUESTIONS = Object.freeze([
  {
    id: "q1",
    question: "What is diffraction?",
    answer:
      "Diffraction is the bending and spreading of a wave when it passes through an obstacle or an aperture whose size is comparable with its wavelength. The spreading is appreciable only when the aperture is of the order of the wavelength, which is why light shows diffraction only at very narrow slits.",
  },
  {
    id: "q2",
    question: "What is a diffraction grating?",
    answer:
      "A diffraction grating is a transparent plate ruled with a very large number of equidistant, equally wide, parallel slits. The grating used here has 15 000 lines per inch, so the spacing between adjacent slits (the grating element) is d = 2.54 / 15 000 cm ≈ 1.693 × 10⁻⁴ cm.",
    math: "d = 2.54 / N cm = 2.54 / 15000 cm = 1.6933 × 10⁻⁴ cm = 16933 Å",
  },
  {
    id: "q3",
    question: "Which gives a more intense spectrum, a grating or a prism, and why?",
    answer:
      "A prism gives a brighter spectrum. In a grating most of the light goes into the central (zero-order) maximum and little into any one higher order, because the light is spread over many orders. In a prism the whole beam is dispersed, so each wavelength region is more intense.",
  },
  {
    id: "q4",
    question: "What are the advantages of a grating over a prism?",
    answer:
      "A grating gives a much larger dispersion and constant dispersion, is unaffected by the material's absorption (so it can be used in the ultraviolet and infrared), can be used over a very wide wavelength range without calibration, has no hysteresis, and can be made with an accurately known grating element.",
  },
  {
    id: "q5",
    question: "What are the essential parts of a spectrometer?",
    answer:
      "A collimator (with an adjustable slit and a lens) to produce parallel rays, a prism or grating table (turntable) to hold the dispersing element, a telescope (with a crosswire and eyepiece) to view the spectrum, and a circular scale with a vernier for measuring angular positions.",
  },
  {
    id: "q6",
    question: "How do you adjust the collimator?",
    answer:
      "Focus the telescope for infinity, then view the slit through the telescope while adjusting the collimator. Move the slit towards or away from the collimating lens until the image of the slit is sharp, narrow and without a coloured edge, which shows that the emergent beam is parallel. Keep the slit vertical and as narrow as gives adequate light.",
  },
  {
    id: "q7",
    question: "Why is red light diffracted at the largest angle in a diffraction grating?",
    answer:
      "For a principal maximum, d sin θ = n λ, so sin θ is proportional to the wavelength for a fixed order and grating spacing. Red light has the longest wavelength among the visible lines, therefore it has the largest value of sin θ and hence the largest diffraction angle.",
    math: "sin θ = n λ / d  →  θ increases with λ",
  },
  {
    id: "q8",
    question: "Why are two readings (on either side of the central maximum) taken?",
    answer:
      "The reading of a spectral line is taken with the telescope on the left and on the right of the central maximum. Half their difference gives the diffraction angle, so any zero error of the circular scale or slight misalignment of the grating normal cancels out, and the measurement becomes more accurate.",
  },
]);

export const VIVA_NUMERICALS = Object.freeze([
  {
    id: "n1",
    question: "A grating has 5 000 lines per cm. Calculate the grating element d in ångström.",
    answer: "d = 1 / 5000 cm = 2 × 10⁻⁴ cm = 2 × 10⁻⁶ m = 20 000 Å.",
  },
  {
    id: "n2",
    question: "With d = 16 933 Å, the first-order green line is at θ = 18° 49′. Calculate λ.",
    answer: "λ = d sin θ = 16 933 × sin 18.8167° = 16 933 × 0.3226 ≈ 5 462 Å ≈ 5 460 Å.",
  },
  {
    id: "n3",
    question: "For λ = 6 390 Å and d = 16 933 Å, what is the largest order that can be observed?",
    answer: "n ≤ d / λ = 16 933 / 6 390 = 2.65, so only orders 1 and 2 exist. Order 3 would require sin θ = 1.13, which is impossible.",
  },
]);
