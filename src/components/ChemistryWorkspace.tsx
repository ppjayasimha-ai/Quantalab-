import { useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  CheckCircle2,
  Flame,
  FlaskConical,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  CHEMISTRY_MISSIONS,
  ChemistryReaction,
  REAGENTS,
} from "../data/chemistryMissions";
import { ChemistryLabEngine } from "../three/ChemistryLabEngine";
import { labAudio } from "../utils/sound";

interface ChemistryWorkspaceProps {
  onExplainTopic: (contextPrompt: string) => void;
}

export default function ChemistryWorkspace({
  onExplainTopic,
}: ChemistryWorkspaceProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ChemistryLabEngine | null>(null);

  const [missionIdx, setMissionIdx] = useState(0);
  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("quantalab_chem_completed");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [xp, setXp] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("quantalab_chem_xp");
      return saved ? Number(saved) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const [reagentCounts, setReagentCounts] = useState<Record<string, number>>({
    H2: 2,
    O2: 0,
  });
  const [tempK, setTempK] = useState(298);
  const [pressureAtm, setPressureAtm] = useState(1.0);
  const [catalystActive, setCatalystActive] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{
    tone: "neutral" | "success" | "warning";
    text: string;
  }>({
    tone: "neutral",
    text: "Load exact stoichiometric reactants and tune reactor conditions to synthesize.",
  });
  const [synthesizedProduct, setSynthesizedProduct] = useState<
    ChemistryReaction["products"][0] | null
  >(null);

  const mission = CHEMISTRY_MISSIONS[missionIdx];

  // Real thermodynamic metrics: ΔG = ΔH - T * ΔS (converted to kJ/mol)
  const gibbsDeltaG = useMemo(() => {
    return mission.deltaH - (tempK * mission.deltaS) / 1000;
  }, [mission, tempK]);

  // Effective activation barrier lowered by catalyst
  const effectiveEa = catalystActive
    ? mission.activationEnergy * 0.55
    : mission.activationEnergy;

  // Arrhenius kinetic readiness index (0 - 100%)
  const kineticReadiness = useMemo(() => {
    const tempRatio = tempK / mission.minTempK;
    const pressRatio = pressureAtm / mission.minPressureAtm;
    const catOk = !mission.needsCatalyst || catalystActive ? 1 : 0.35;
    return Math.min(
      100,
      Math.round(Math.min(1, tempRatio) * Math.min(1, pressRatio) * catOk * 100),
    );
  }, [tempK, pressureAtm, catalystActive, mission]);

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new ChemistryLabEngine(mountRef.current, {
      tempK,
      pressureAtm,
      catalystActive,
      reagentCounts,
      reacting: false,
      reactionColor: mission.liquidColor,
      effectType: mission.effectType,
      productSpec: null,
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.updateState({
      tempK,
      pressureAtm,
      catalystActive,
      reagentCounts,
      reactionColor: synthesizedProduct
        ? mission.liquidColor
        : "#0ea5e9",
      effectType: mission.effectType,
      productSpec: synthesizedProduct,
    });
  }, [
    tempK,
    pressureAtm,
    catalystActive,
    reagentCounts,
    mission,
    synthesizedProduct,
  ]);

  const selectMission = (idx: number) => {
    labAudio.playClick();
    setMissionIdx(idx);
    setSynthesizedProduct(null);
    setReagentCounts({});
    setTempK(298);
    setPressureAtm(1.0);
    setCatalystActive(false);
    setStatusMessage({
      tone: "neutral",
      text: CHEMISTRY_MISSIONS[idx].briefing,
    });
  };

  const adjustReagent = (id: string, delta: number) => {
    labAudio.playClick();
    setSynthesizedProduct(null);
    setReagentCounts((prev) => {
      const nextVal = Math.max(0, Math.min(6, (prev[id] || 0) + delta));
      const copy = { ...prev };
      if (nextVal === 0) delete copy[id];
      else copy[id] = nextVal;
      return copy;
    });
  };

  const attemptReaction = () => {
    // Verify stoichiometry
    const activeEntries = Object.entries(reagentCounts).filter(([, c]) => c > 0);
    const matchesTarget =
      activeEntries.length === mission.reactants.length &&
      mission.reactants.every((r) => reagentCounts[r.id] === r.coeff);

    if (!matchesTarget) {
      labAudio.playError();
      const targetStr = mission.reactants
        .map((r) => `${r.coeff} ${REAGENTS[r.id]?.formula ?? r.id}`)
        .join(" + ");
      setStatusMessage({
        tone: "warning",
        text: `Stoichiometry mismatch. Required: ${targetStr}. Check mole ratios in your vessel.`,
      });
      return;
    }

    if (mission.needsCatalyst && !catalystActive) {
      labAudio.playError();
      setStatusMessage({
        tone: "warning",
        text: `Activation energy Eₐ = ${mission.activationEnergy} kJ/mol is too high without a catalyst. Enable the Fe/Pt Catalyst Mesh.`,
      });
      return;
    }

    if (tempK < mission.minTempK) {
      labAudio.playError();
      setStatusMessage({
        tone: "warning",
        text: `Insufficient thermal energy (${tempK} K). Raise reactor temperature to at least ${mission.minTempK} K to cross Eₐ.`,
      });
      return;
    }

    if (pressureAtm < mission.minPressureAtm) {
      labAudio.playError();
      setStatusMessage({
        tone: "warning",
        text: `Pressure too low (${pressureAtm.toFixed(1)} atm). Compress vessel to ≥ ${mission.minPressureAtm.toFixed(1)} atm.`,
      });
      return;
    }

    // Success!
    labAudio.playReactionSuccess();
    const product = mission.products[0];
    setSynthesizedProduct(product);
    engineRef.current?.updateState(
      {
        reacting: true,
        reactionColor: mission.glowColor,
        productSpec: product,
      },
      true,
    );

    const firstClear = !completedIds.includes(mission.id);
    if (firstClear) {
      const nextCompleted = [...completedIds, mission.id];
      const nextXp = xp + mission.xpReward;
      setCompletedIds(nextCompleted);
      setXp(nextXp);
      try {
        localStorage.setItem(
          "quantalab_chem_completed",
          JSON.stringify(nextCompleted),
        );
        localStorage.setItem("quantalab_chem_xp", String(nextXp));
      } catch {
        // ignore storage errors
      }
    }

    setStatusMessage({
      tone: "success",
      text: `Reaction Complete: ${mission.equation} (${mission.deltaH} kJ/mol). ${firstClear ? `+${mission.xpReward} XP earned!` : "Synthesized cleanly."}`,
    });
  };

  return (
    <div className="h-full w-full grid grid-cols-1 lg:grid-cols-12 bg-[#07090E] overflow-hidden">
      {/* Left 7 Columns: 3D Reactor Stage */}
      <div className="relative lg:col-span-7 h-[46vh] lg:h-full border-b lg:border-b-0 lg:border-r border-slate-800/90">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          aria-label="3D Chemistry Reactor Viewport"
        />

        {/* Top Telemetry Overlay */}
        <div className="pointer-events-none absolute top-4 left-4 right-4 flex flex-wrap items-start justify-between gap-3 z-10">
          <div className="pointer-events-auto bg-[#0B0F18]/92 border border-slate-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-cyan-400">
                Mission {missionIdx + 1} / {CHEMISTRY_MISSIONS.length}
              </span>
              <span aria-hidden="true">·</span>
              <span>{mission.category}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-amber-400">
                {xp} XP
              </span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-100">
              {mission.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-slate-300">
              <span>ΔH = {mission.deltaH.toFixed(1)} kJ/mol</span>
              <span aria-hidden="true">·</span>
              <span>
                ΔG = {gibbsDeltaG.toFixed(1)} kJ/mol{" "}
                {gibbsDeltaG < 0 ? "(Spontaneous)" : "(Endergonic)"}
              </span>
              <span aria-hidden="true">·</span>
              <span>Eₐ = {effectiveEa.toFixed(1)} kJ/mol</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              labAudio.playClick();
              onExplainTopic(
                `Explain the chemistry mechanism, thermodynamics (ΔH=${mission.deltaH} kJ/mol, ΔG=${gibbsDeltaG.toFixed(1)} kJ/mol at ${tempK}K), and molecular geometry for: ${mission.equation}`,
              );
            }}
            className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#0B0F18]/92 border border-slate-700/80 hover:border-cyan-500/60 text-xs font-medium text-slate-200 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Ask Chemistry Tutor
          </button>
        </div>

        {/* Bottom Status Bar inside 3D Viewport */}
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10">
          <div
            className={`pointer-events-auto rounded-xl px-4 py-3 border text-xs leading-relaxed ${
              statusMessage.tone === "success"
                ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-200"
                : statusMessage.tone === "warning"
                  ? "bg-amber-950/90 border-amber-500/40 text-amber-200"
                  : "bg-[#0B0F18]/92 border-slate-800 text-slate-300"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{statusMessage.text}</span>
              <span className="font-mono tabular-nums text-slate-400 shrink-0">
                Readiness {kineticReadiness}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right 5 Columns: Mission Selector, Reagent Bench & Reactor Controls */}
      <div className="lg:col-span-5 h-full overflow-y-auto bg-[#0A0E17] p-5 flex flex-col gap-5">
        {/* Mission Stepper */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-slate-200">
              Reaction Missions
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {completedIds.length} / {CHEMISTRY_MISSIONS.length} Cleared
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CHEMISTRY_MISSIONS.map((m, i) => {
              const cleared = completedIds.includes(m.id);
              const active = i === missionIdx;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => selectMission(i)}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                    active
                      ? "bg-cyan-500/15 border-cyan-500/60 text-cyan-200"
                      : "bg-[#101624] border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] text-slate-400">
                      0{i + 1}
                    </span>
                    {cleared && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <div className="mt-0.5 font-medium truncate">{m.title}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Target Stoichiometry & Briefing */}
        <div className="p-4 rounded-xl bg-[#0F1523] border border-slate-800/90">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-400">
              Target Synthesis
            </span>
            <span className="text-xs font-mono text-amber-400">
              +{mission.xpReward} XP
            </span>
          </div>
          <div className="mt-1.5 text-base font-mono font-semibold text-white">
            {mission.equation}
          </div>
          <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
            {mission.briefing}
          </p>
        </div>

        {/* Reagent Dosing Bench */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-slate-200">
              Reagent Dosing Tray (Moles)
            </h3>
            <button
              type="button"
              onClick={() => {
                labAudio.playClick();
                setReagentCounts({});
                setSynthesizedProduct(null);
              }}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Clear Vessel
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.values(REAGENTS).map((r) => {
              const count = reagentCounts[r.id] || 0;
              return (
                <div
                  key={r.id}
                  className={`p-2.5 rounded-lg border transition-colors ${
                    count > 0
                      ? "bg-[#131C2E] border-cyan-500/50"
                      : "bg-[#0E1421] border-slate-800/90"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-sm text-slate-100">
                      {r.formula}
                    </span>
                    <span className="text-[11px] text-slate-400 capitalize">
                      {r.state}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {r.name}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => adjustReagent(r.id, -1)}
                      disabled={count === 0}
                      className="w-7 h-7 rounded bg-slate-800/90 hover:bg-slate-700 disabled:opacity-35 flex items-center justify-center text-slate-200 cursor-pointer"
                      aria-label={`Remove ${r.name}`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono tabular-nums text-sm font-semibold text-cyan-300">
                      {count} mol
                    </span>
                    <button
                      type="button"
                      onClick={() => adjustReagent(r.id, 1)}
                      className="w-7 h-7 rounded bg-slate-800/90 hover:bg-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                      aria-label={`Add ${r.name}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reactor Thermodynamic Controls */}
        <div className="p-4 rounded-xl bg-[#0F1523] border border-slate-800/90 space-y-4">
          <label className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Reactor Temperature (T)</span>
              <span className="font-mono tabular-nums text-amber-300">
                {tempK} K ({(tempK - 273.15).toFixed(0)} °C)
              </span>
            </div>
            <input
              type="range"
              min={273}
              max={950}
              step={5}
              value={tempK}
              onChange={(e) => setTempK(parseInt(e.target.value, 10))}
              className="lab-slider w-full"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Vessel Pressure (P)</span>
              <span className="font-mono tabular-nums text-cyan-300">
                {pressureAtm.toFixed(1)} atm
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={10.0}
              step={0.5}
              value={pressureAtm}
              onChange={(e) => setPressureAtm(parseFloat(e.target.value))}
              className="lab-slider w-full"
            />
          </label>

          <div className="flex items-center justify-between pt-1">
            <div>
              <div className="text-xs font-medium text-slate-200">
                Fe / Pt Catalytic Mesh
              </div>
              <div className="text-[11px] text-slate-400">
                Lowers activation energy barrier Eₐ by 45%
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                labAudio.playClick();
                setCatalystActive((v) => !v);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                catalystActive
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                  : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {catalystActive ? "Catalyst Active" : "Insert Catalyst"}
            </button>
          </div>
        </div>

        {/* Trigger Reaction CTA */}
        <div className="flex items-center gap-3 pb-2">
          <button
            type="button"
            onClick={attemptReaction}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
          >
            <Flame className="w-4 h-4" />
            Trigger Synthesis
          </button>
          {synthesizedProduct && (
            <div className="inline-flex items-center gap-1.5 px-3 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs font-medium text-emerald-300">
              <Award className="w-4 h-4" />
              Verified
            </div>
          )}
        </div>

        {synthesizedProduct && (
          <div className="p-3.5 rounded-xl bg-[#0F1523] border border-emerald-500/30 text-xs text-slate-300 leading-relaxed">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-300 mb-1">
              <FlaskConical className="w-3.5 h-3.5" />
              Lab Note
            </div>
            {mission.realWorldNote}
          </div>
        )}
      </div>
    </div>
  );
}
