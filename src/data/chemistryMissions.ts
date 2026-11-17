export interface AtomNode {
  element: string;
  color: string;
  radius: number;
  position: [number, number, number];
}

export interface BondEdge {
  from: number;
  to: number;
  order: 1 | 2 | 3;
}

export interface ReagentDef {
  id: string;
  formula: string;
  name: string;
  state: "gas" | "liquid" | "solid" | "aqueous";
  color: string;
  molarMass: number;
  atoms: AtomNode[];
  bonds: BondEdge[];
}

export interface ChemistryReaction {
  id: string;
  title: string;
  category: string;
  equation: string;
  reactants: Array<{ id: string; coeff: number }>;
  products: Array<{ formula: string; coeff: number; atoms: AtomNode[]; bonds: BondEdge[] }>;
  deltaH: number; // kJ/mol (negative = exothermic, positive = endothermic)
  deltaS: number; // J/(mol*K)
  activationEnergy: number; // kJ/mol
  minTempK: number;
  minPressureAtm: number;
  needsCatalyst: boolean;
  liquidColor: string;
  glowColor: string;
  effectType: "flame" | "bubbles" | "precipitate" | "crystal" | "neutralize";
  xpReward: number;
  briefing: string;
  realWorldNote: string;
}

export const REAGENTS: Record<string, ReagentDef> = {
  H2: {
    id: "H2",
    formula: "H₂",
    name: "Hydrogen Gas",
    state: "gas",
    color: "#E2E8F0",
    molarMass: 2.016,
    atoms: [
      { element: "H", color: "#F8FAFC", radius: 0.26, position: [-0.32, 0, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.26, position: [0.32, 0, 0] },
    ],
    bonds: [{ from: 0, to: 1, order: 1 }],
  },
  O2: {
    id: "O2",
    formula: "O₂",
    name: "Oxygen Gas",
    state: "gas",
    color: "#EF4444",
    molarMass: 31.998,
    atoms: [
      { element: "O", color: "#EF4444", radius: 0.36, position: [-0.42, 0, 0] },
      { element: "O", color: "#EF4444", radius: 0.36, position: [0.42, 0, 0] },
    ],
    bonds: [{ from: 0, to: 1, order: 2 }],
  },
  Na: {
    id: "Na",
    formula: "Na",
    name: "Sodium Metal",
    state: "solid",
    color: "#A855F7",
    molarMass: 22.99,
    atoms: [{ element: "Na", color: "#A855F7", radius: 0.48, position: [0, 0, 0] }],
    bonds: [],
  },
  Cl2: {
    id: "Cl2",
    formula: "Cl₂",
    name: "Chlorine Gas",
    state: "gas",
    color: "#22C55E",
    molarMass: 70.906,
    atoms: [
      { element: "Cl", color: "#22C55E", radius: 0.42, position: [-0.48, 0, 0] },
      { element: "Cl", color: "#22C55E", radius: 0.42, position: [0.48, 0, 0] },
    ],
    bonds: [{ from: 0, to: 1, order: 1 }],
  },
  N2: {
    id: "N2",
    formula: "N₂",
    name: "Nitrogen Gas",
    state: "gas",
    color: "#3B82F6",
    molarMass: 28.014,
    atoms: [
      { element: "N", color: "#3B82F6", radius: 0.35, position: [-0.38, 0, 0] },
      { element: "N", color: "#3B82F6", radius: 0.35, position: [0.38, 0, 0] },
    ],
    bonds: [{ from: 0, to: 1, order: 3 }],
  },
  CH4: {
    id: "CH4",
    formula: "CH₄",
    name: "Methane",
    state: "gas",
    color: "#64748B",
    molarMass: 16.043,
    atoms: [
      { element: "C", color: "#334155", radius: 0.4, position: [0, 0, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.24, position: [0, 0.62, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.24, position: [0.58, -0.22, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.24, position: [-0.29, -0.22, 0.5] },
      { element: "H", color: "#F8FAFC", radius: 0.24, position: [-0.29, -0.22, -0.5] },
    ],
    bonds: [
      { from: 0, to: 1, order: 1 },
      { from: 0, to: 2, order: 1 },
      { from: 0, to: 3, order: 1 },
      { from: 0, to: 4, order: 1 },
    ],
  },
  HCl: {
    id: "HCl",
    formula: "HCl",
    name: "Hydrochloric Acid",
    state: "aqueous",
    color: "#10B981",
    molarMass: 36.46,
    atoms: [
      { element: "Cl", color: "#22C55E", radius: 0.42, position: [-0.28, 0, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.25, position: [0.42, 0, 0] },
    ],
    bonds: [{ from: 0, to: 1, order: 1 }],
  },
  NaOH: {
    id: "NaOH",
    formula: "NaOH",
    name: "Sodium Hydroxide",
    state: "aqueous",
    color: "#06B6D4",
    molarMass: 39.997,
    atoms: [
      { element: "Na", color: "#A855F7", radius: 0.44, position: [-0.65, 0, 0] },
      { element: "O", color: "#EF4444", radius: 0.36, position: [0.15, 0, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.24, position: [0.72, 0.25, 0] },
    ],
    bonds: [
      { from: 0, to: 1, order: 1 },
      { from: 1, to: 2, order: 1 },
    ],
  },
  Mg: {
    id: "Mg",
    formula: "Mg",
    name: "Magnesium Ribbon",
    state: "solid",
    color: "#CBD5E1",
    molarMass: 24.305,
    atoms: [{ element: "Mg", color: "#CBD5E1", radius: 0.45, position: [0, 0, 0] }],
    bonds: [],
  },
  CO2: {
    id: "CO2",
    formula: "CO₂",
    name: "Carbon Dioxide",
    state: "gas",
    color: "#94A3B8",
    molarMass: 44.01,
    atoms: [
      { element: "C", color: "#334155", radius: 0.38, position: [0, 0, 0] },
      { element: "O", color: "#EF4444", radius: 0.35, position: [-0.72, 0, 0] },
      { element: "O", color: "#EF4444", radius: 0.35, position: [0.72, 0, 0] },
    ],
    bonds: [
      { from: 0, to: 1, order: 2 },
      { from: 0, to: 2, order: 2 },
    ],
  },
  H2O: {
    id: "H2O",
    formula: "H₂O",
    name: "Water",
    state: "liquid",
    color: "#0EA5E9",
    molarMass: 18.015,
    atoms: [
      { element: "O", color: "#EF4444", radius: 0.38, position: [0, 0.16, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.25, position: [-0.52, -0.26, 0] },
      { element: "H", color: "#F8FAFC", radius: 0.25, position: [0.52, -0.26, 0] },
    ],
    bonds: [
      { from: 0, to: 1, order: 1 },
      { from: 0, to: 2, order: 1 },
    ],
  },
};

export const CHEMISTRY_MISSIONS: ChemistryReaction[] = [
  {
    id: "water-synthesis",
    title: "Cryogenic Propellant Synthesis",
    category: "Combustion & Synthesis",
    equation: "2 H₂ + O₂ → 2 H₂O",
    reactants: [
      { id: "H2", coeff: 2 },
      { id: "O2", coeff: 1 },
    ],
    products: [
      {
        formula: "H₂O",
        coeff: 2,
        atoms: REAGENTS.H2O.atoms,
        bonds: REAGENTS.H2O.bonds,
      },
    ],
    deltaH: -571.6,
    deltaS: -326.8,
    activationEnergy: 48,
    minTempK: 520,
    minPressureAtm: 1.0,
    needsCatalyst: false,
    liquidColor: "#0EA5E9",
    glowColor: "#F59E0B",
    effectType: "flame",
    xpReward: 150,
    briefing:
      "Combine Hydrogen (H₂) and Oxygen (O₂) in exact 2:1 stoichiometry and heat above 520 K to overcome the activation barrier.",
    realWorldNote:
      "Used in liquid-hydrogen rocket engines (RS-25). Notice how ΔG stays negative despite ΔS < 0 because ΔH is strongly exothermic.",
  },
  {
    id: "nacl-halide",
    title: "Alkali Halide Lattice Formation",
    category: "Ionic Redox",
    equation: "2 Na + Cl₂ → 2 NaCl",
    reactants: [
      { id: "Na", coeff: 2 },
      { id: "Cl2", coeff: 1 },
    ],
    products: [
      {
        formula: "NaCl",
        coeff: 2,
        atoms: [
          { element: "Na⁺", color: "#A855F7", radius: 0.42, position: [-0.45, 0, 0] },
          { element: "Cl⁻", color: "#22C55E", radius: 0.48, position: [0.45, 0, 0] },
        ],
        bonds: [{ from: 0, to: 1, order: 1 }],
      },
    ],
    deltaH: -822.4,
    deltaS: -181.4,
    activationEnergy: 28,
    minTempK: 340,
    minPressureAtm: 1.0,
    needsCatalyst: false,
    liquidColor: "#E2E8F0",
    glowColor: "#FBBF24",
    effectType: "crystal",
    xpReward: 180,
    briefing:
      "React 2 moles of Sodium metal with 1 mole of Chlorine gas at 340 K+ to crystallize ionic Sodium Chloride.",
    realWorldNote:
      "Sodium transfers its 3s¹ valence electron to Chlorine, releasing massive lattice energy and a bright golden-yellow D-line emission.",
  },
  {
    id: "haber-bosch",
    title: "Haber-Bosch Ammonia Equilibrium",
    category: "Catalytic Equilibrium",
    equation: "N₂ + 3 H₂ ⇌ 2 NH₃",
    reactants: [
      { id: "N2", coeff: 1 },
      { id: "H2", coeff: 3 },
    ],
    products: [
      {
        formula: "NH₃",
        coeff: 2,
        atoms: [
          { element: "N", color: "#3B82F6", radius: 0.38, position: [0, 0.18, 0] },
          { element: "H", color: "#F8FAFC", radius: 0.24, position: [0.55, -0.25, 0] },
          { element: "H", color: "#F8FAFC", radius: 0.24, position: [-0.28, -0.25, 0.48] },
          { element: "H", color: "#F8FAFC", radius: 0.24, position: [-0.28, -0.25, -0.48] },
        ],
        bonds: [
          { from: 0, to: 1, order: 1 },
          { from: 0, to: 2, order: 1 },
          { from: 0, to: 3, order: 1 },
        ],
      },
    ],
    deltaH: -92.4,
    deltaS: -198.7,
    activationEnergy: 115,
    minTempK: 650,
    minPressureAtm: 5.0,
    needsCatalyst: true,
    liquidColor: "#38BDF8",
    glowColor: "#06B6D4",
    effectType: "bubbles",
    xpReward: 260,
    briefing:
      "Break the N≡N triple bond! Combine 1 N₂ + 3 H₂, enable the Iron Catalyst, raise Pressure ≥ 5 atm, and heat ≥ 650 K.",
    realWorldNote:
      "Le Chatelier's Principle: 4 gas moles → 2 gas moles, so high pressure shifts equilibrium toward NH₃ while the Fe catalyst lowers Eₐ.",
  },
  {
    id: "neutralization",
    title: "Strong Acid-Base Neutralization",
    category: "Aqueous Proton Transfer",
    equation: "HCl + NaOH → NaCl + H₂O",
    reactants: [
      { id: "HCl", coeff: 1 },
      { id: "NaOH", coeff: 1 },
    ],
    products: [
      {
        formula: "H₂O + NaCl",
        coeff: 1,
        atoms: REAGENTS.H2O.atoms,
        bonds: REAGENTS.H2O.bonds,
      },
    ],
    deltaH: -57.3,
    deltaS: 80.7,
    activationEnergy: 12,
    minTempK: 285,
    minPressureAtm: 1.0,
    needsCatalyst: false,
    liquidColor: "#10B981",
    glowColor: "#10B981",
    effectType: "neutralize",
    xpReward: 140,
    briefing:
      "Balance 1 mole of HCl with 1 mole of NaOH at ambient temperature to reach exact neutral pH 7.0.",
    realWorldNote:
      "H⁺ + OH⁻ → H₂O has a nearly constant standard enthalpy of neutralization (-57.3 kJ/mol) across strong monoprotic acids and bases.",
  },
  {
    id: "methane-combustion",
    title: "Complete Hydrocarbon Oxidation",
    category: "Thermodynamics",
    equation: "CH₄ + 2 O₂ → CO₂ + 2 H₂O",
    reactants: [
      { id: "CH4", coeff: 1 },
      { id: "O2", coeff: 2 },
    ],
    products: [
      {
        formula: "CO₂",
        coeff: 1,
        atoms: REAGENTS.CO2.atoms,
        bonds: REAGENTS.CO2.bonds,
      },
    ],
    deltaH: -890.3,
    deltaS: -242.8,
    activationEnergy: 64,
    minTempK: 580,
    minPressureAtm: 1.0,
    needsCatalyst: false,
    liquidColor: "#0284C7",
    glowColor: "#38BDF8",
    effectType: "flame",
    xpReward: 210,
    briefing:
      "Oxidize 1 mole of Methane (CH₄) with 2 moles of Oxygen (O₂) above 580 K for clean blue complete combustion.",
    realWorldNote:
      "Stoichiometric oxygen guarantees CO₂ rather than toxic CO soot; the blue emission comes from excited CH* and C₂* radical bands.",
  },
  {
    id: "magnesium-acid",
    title: "Single-Displacement Hydrogen Evolution",
    category: "Metal-Acid Kinetics",
    equation: "Mg + 2 HCl → MgCl₂ + H₂↑",
    reactants: [
      { id: "Mg", coeff: 1 },
      { id: "HCl", coeff: 2 },
    ],
    products: [
      {
        formula: "MgCl₂",
        coeff: 1,
        atoms: [
          { element: "Mg²⁺", color: "#CBD5E1", radius: 0.42, position: [0, 0, 0] },
          { element: "Cl⁻", color: "#22C55E", radius: 0.38, position: [-0.72, 0, 0] },
          { element: "Cl⁻", color: "#22C55E", radius: 0.38, position: [0.72, 0, 0] },
        ],
        bonds: [
          { from: 0, to: 1, order: 1 },
          { from: 0, to: 2, order: 1 },
        ],
      },
    ],
    deltaH: -467.0,
    deltaS: 54.0,
    activationEnergy: 25,
    minTempK: 295,
    minPressureAtm: 1.0,
    needsCatalyst: false,
    liquidColor: "#34D399",
    glowColor: "#10B981",
    effectType: "bubbles",
    xpReward: 190,
    briefing:
      "Drop 1 mole of Magnesium into 2 moles of Hydrochloric Acid to liberate vigorous H₂ gas bubbles.",
    realWorldNote:
      "Magnesium sits well above hydrogen in the standard reduction potential series (E° = -2.37 V), rapidly reducing H⁺ ions to H₂ gas.",
  },
];
