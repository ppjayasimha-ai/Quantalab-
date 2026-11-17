import { useEffect, useRef, useState } from "react";
import * as math from "mathjs";
import {
  Calculator,
  Play,
  RotateCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { FunctionPlotterEngine } from "../three/FunctionPlotterEngine";
import { labAudio } from "../utils/sound";

interface MathEngineWorkspaceProps {
  externalPlotExpr?: string | null;
  onExplainTopic: (contextPrompt: string) => void;
}

interface CalcHistoryItem {
  id: string;
  expr: string;
  result: string;
  error?: boolean;
}

interface DerivationResponse {
  title: string;
  summary: string;
  steps: Array<{ label: string; equation: string; explanation: string }>;
  finalAnswer: string;
  physicalInsight: string;
}

const SURFACE_PRESETS = [
  { label: "Radial Wave", expr: "sin(sqrt(x^2 + y^2) * 1.8 - t) * 1.3" },
  { label: "Harmonic Grid", expr: "cos(x) * sin(y) * 1.5" },
  { label: "Gaussian Packet", expr: "2.4 * exp(-(x^2 + y^2) / 5) * cos(2*x - t)" },
  { label: "Hyperbolic Saddle", expr: "(x^2 - y^2) / 7" },
];

const QUICK_MATH_EXAMPLES = [
  { label: "Symbolic d/dx", expr: "derivative('x^3 * sin(x)', 'x')" },
  { label: "Matrix Det", expr: "det([[4, 2, 1], [0, 3, -1], [2, 1, 5]])" },
  { label: "Unit Convert", expr: "9.81 m/s^2 * 12 s to km/h" },
  { label: "Complex Power", expr: "(3 + 4i)^3" },
  { label: "Escape v (Earth)", expr: "sqrt(2 * 6.6743e-11 * 5.972e24 / 6.371e6)" },
];

export default function MathEngineWorkspace({
  externalPlotExpr,
  onExplainTopic,
}: MathEngineWorkspaceProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const plotterRef = useRef<FunctionPlotterEngine | null>(null);

  const [surfaceExpr, setSurfaceExpr] = useState(SURFACE_PRESETS[0].expr);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);

  const [calcInput, setCalcInput] = useState(
    "sqrt(2 * 6.6743e-11 * 5.972e24 / 6.371e6)",
  );
  const [calcHistory, setCalcHistory] = useState<CalcHistoryItem[]>([
    {
      id: "init-1",
      expr: "derivative('x^3 * sin(x)', 'x')",
      result: "3 * x ^ 2 * sin(x) + x ^ 3 * cos(x)",
    },
    {
      id: "init-2",
      expr: "9.81 m/s^2 * 12 s to km/h",
      result: "423.792 km / h",
    },
  ]);

  // Physics Formula Mini-Solver State
  const [solverTab, setSolverTab] = useState<"lorentz" | "idealgas" | "debroglie">(
    "lorentz",
  );
  const [relSpeedBeta, setRelSpeedBeta] = useState(0.86); // v/c
  const [gasMoles, setGasMoles] = useState(2.0);
  const [gasTempK, setGasTempK] = useState(300);
  const [gasVolL, setGasVolL] = useState(22.4);
  const [particleMassKg, setParticleMassKg] = useState(9.109e-31);
  const [particleVel, setParticleVel] = useState(2.2e6);

  // Step-by-step Gemini Derivation
  const [deriving, setDeriving] = useState(false);
  const [derivation, setDerivation] = useState<DerivationResponse | null>(null);
  const [deriveError, setDeriveError] = useState<string | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new FunctionPlotterEngine(mountRef.current, surfaceExpr);
    plotterRef.current = engine;
    return () => {
      engine.dispose();
      plotterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (externalPlotExpr && externalPlotExpr.trim()) {
      setSurfaceExpr(externalPlotExpr);
      const res = plotterRef.current?.evaluateExpression(externalPlotExpr);
      if (res && !res.ok) {
        setSurfaceError(res.error || "Could not plot extracted expression");
      } else {
        setSurfaceError(null);
      }
    }
  }, [externalPlotExpr]);

  const applySurfaceExpr = (expr: string) => {
    labAudio.playClick();
    setSurfaceExpr(expr);
    const res = plotterRef.current?.evaluateExpression(expr);
    if (res && !res.ok) {
      setSurfaceError(res.error || "Invalid function of x, y");
    } else {
      setSurfaceError(null);
    }
  };

  const evaluateCalc = (exprToRun?: string) => {
    const raw = (exprToRun ?? calcInput).trim();
    if (!raw) return;
    labAudio.playClick();
    try {
      let formatted: string;
      // Handle explicit derivative('...', 'x') calls cleanly
      const derivMatch = raw.match(
        /^derivative\(\s*['"](.+?)['"]\s*,\s*['"]([a-zA-Z]+)['"]\s*\)$/,
      );
      if (derivMatch) {
        formatted = math.derivative(derivMatch[1], derivMatch[2]).toString();
      } else {
        const val = math.evaluate(raw, {
          c: 299792458,
          G: 6.6743e-11,
          h: 6.62607015e-34,
          hbar: 1.054571817e-34,
          kB: 1.380649e-23,
          NA: 6.02214076e23,
          R: 8.314462618,
          me: 9.1093837e-31,
        });
        formatted = math.format(val, { precision: 10 });
      }
      setCalcHistory((prev) => [
        { id: `${Date.now()}`, expr: raw, result: formatted },
        ...prev.slice(0, 14),
      ]);
    } catch (err) {
      labAudio.playError();
      setCalcHistory((prev) => [
        {
          id: `${Date.now()}`,
          expr: raw,
          result: err instanceof Error ? err.message : "Evaluation error",
          error: true,
        },
        ...prev.slice(0, 14),
      ]);
    }
  };

  const requestDerivation = async () => {
    if (!calcInput.trim()) return;
    labAudio.playClick();
    setDeriving(true);
    setDeriveError(null);
    try {
      const resp = await fetch("/api/gemini/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expression: calcInput.trim(),
          domain: "Applied Mathematics & Physics",
          notes: `Active 3D surface: z = ${surfaceExpr}`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Derivation request failed.");
      }
      setDerivation(data as DerivationResponse);
    } catch (err) {
      setDeriveError(
        err instanceof Error ? err.message : "Failed to derive steps.",
      );
    } finally {
      setDeriving(false);
    }
  };

  // Computed solver outputs
  const lorentzGamma = 1 / Math.sqrt(Math.max(1e-8, 1 - relSpeedBeta ** 2));
  const idealGasPressureAtm = (gasMoles * 0.082057 * gasTempK) / Math.max(0.1, gasVolL);
  const deBroglieNm =
    (6.62607015e-34 / Math.max(1e-40, particleMassKg * particleVel)) * 1e9;

  return (
    <div className="h-full w-full grid grid-cols-1 lg:grid-cols-12 bg-[#07090E] overflow-hidden">
      {/* Left 6 Columns: Real-Time 3D Function Surface Plotter */}
      <div className="relative lg:col-span-6 h-[44vh] lg:h-full border-b lg:border-b-0 lg:border-r border-slate-800/90">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          aria-label="3D Mathematical Surface Plotter"
        />

        {/* Top Bar inside 3D Plotter */}
        <div className="absolute top-4 left-4 right-4 z-10 flex flex-col gap-2">
          <div className="bg-[#0B0F18]/92 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs text-slate-400">
                <span className="font-medium text-cyan-400">
                  3D Surface Plotter
                </span>
                <span aria-hidden="true"> · </span>
                <span className="font-mono">z = f(x, y, t)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !autoRotate;
                  setAutoRotate(next);
                  plotterRef.current?.setAutoRotate(next);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border cursor-pointer ${
                  autoRotate
                    ? "bg-cyan-500/15 border-cyan-500/50 text-cyan-300"
                    : "bg-slate-800/80 border-slate-700 text-slate-400"
                }`}
              >
                <RotateCw className="w-3 h-3" />
                {autoRotate ? "Orbiting" : "Static"}
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                applySurfaceExpr(surfaceExpr);
              }}
              className="flex items-center gap-2"
            >
              <span className="font-mono text-xs text-cyan-400 shrink-0">
                z =
              </span>
              <input
                type="text"
                value={surfaceExpr}
                onChange={(e) => setSurfaceExpr(e.target.value)}
                placeholder="sin(sqrt(x^2 + y^2))"
                className="flex-1 bg-[#121928] border border-slate-700/80 focus:border-cyan-500 rounded-lg px-3 py-1.5 font-mono text-xs text-slate-100 outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3 h-3" />
                Plot
              </button>
            </form>

            {surfaceError && (
              <div className="mt-1.5 text-xs text-rose-400 font-mono">
                {surfaceError}
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {SURFACE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applySurfaceExpr(p.expr)}
                  className="px-2.5 py-1 rounded-md bg-[#121928] hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right 6 Columns: Symbolic Calculator + Formula Solvers + Step-by-Step AI Derivation */}
      <div className="lg:col-span-6 h-full overflow-y-auto bg-[#0A0E17] p-5 space-y-5">
        {/* Symbolic & Unit-Aware Math Evaluator */}
        <section className="p-4 rounded-xl bg-[#0F1523] border border-slate-800/90">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Symbolic &amp; Scientific Calculation Engine
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Constants: c, G, h, hbar, kB, NA, R
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              evaluateCalc();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              value={calcInput}
              onChange={(e) => setCalcInput(e.target.value)}
              placeholder="Enter expression, derivative('...', 'x'), matrix, or unit conversion"
              className="flex-1 bg-[#141C2D] border border-slate-700/80 focus:border-cyan-500 rounded-lg px-3.5 py-2.5 font-mono text-xs text-slate-100 outline-none"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                className="px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs whitespace-nowrap cursor-pointer"
              >
                Evaluate
              </button>
              <button
                type="button"
                onClick={requestDerivation}
                disabled={deriving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[#161F33] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-cyan-300 whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {deriving ? "Deriving..." : "Derive Steps"}
              </button>
            </div>
          </form>

          {/* Quick Examples */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {QUICK_MATH_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setCalcInput(ex.expr);
                  evaluateCalc(ex.expr);
                }}
                className="px-2.5 py-1 rounded bg-[#141C2D] hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white cursor-pointer"
              >
                {ex.label}
              </button>
            ))}
          </div>

          {/* Calculation History Tape */}
          <div className="mt-4 space-y-2 max-h-48 overflow-y-auto pr-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Evaluation Tape</span>
              {calcHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCalcHistory([])}
                  className="inline-flex items-center gap-1 hover:text-slate-200 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
            {calcHistory.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg bg-[#0A0F1A] border border-slate-800/80 flex flex-col gap-1"
              >
                <div className="font-mono text-[11px] text-slate-400 truncate">
                  {item.expr}
                </div>
                <div
                  className={`font-mono text-xs font-semibold tabular-nums break-all ${
                    item.error ? "text-rose-400" : "text-cyan-300"
                  }`}
                >
                  = {item.result}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Gemini Step-by-Step Derivation Output */}
        {(deriveError || derivation) && (
          <section className="p-4 rounded-xl bg-[#0F1523] border border-cyan-500/35 space-y-3">
            {deriveError ? (
              <div className="text-xs text-rose-400">{deriveError}</div>
            ) : (
              derivation && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {derivation.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {derivation.summary}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onExplainTopic(
                          `Discuss this derivation in detail: ${derivation.title} — ${derivation.finalAnswer}`,
                        )
                      }
                      className="text-xs text-cyan-400 hover:text-cyan-300 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Open in Tutor
                    </button>
                  </div>

                  <div className="space-y-2">
                    {derivation.steps.map((s, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-[#0A0F1A] border border-slate-800/80"
                      >
                        <div className="text-xs font-medium text-slate-200">
                          {idx + 1}. {s.label}
                        </div>
                        <div className="mt-1 font-mono text-xs text-cyan-300">
                          {s.equation}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {s.explanation}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                    <div className="text-[11px] text-emerald-400 font-medium">
                      Final Result
                    </div>
                    <div className="font-mono text-sm font-semibold text-emerald-200 mt-0.5">
                      {derivation.finalAnswer}
                    </div>
                    <div className="text-xs text-slate-300 mt-1.5">
                      {derivation.physicalInsight}
                    </div>
                  </div>
                </>
              )
            )}
          </section>
        )}

        {/* Interactive Physics & Quantum Formula Solvers */}
        <section className="p-4 rounded-xl bg-[#0F1523] border border-slate-800/90 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">
              Live Law Calculators
            </h3>
            <div className="flex items-center gap-1 p-1 bg-[#141C2D] rounded-lg">
              {(
                [
                  ["lorentz", "Relativity γ"],
                  ["idealgas", "Ideal Gas"],
                  ["debroglie", "de Broglie λ"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSolverTab(id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                    solverTab === id
                      ? "bg-cyan-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {solverTab === "lorentz" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  Velocity Fraction (v / c)
                </span>
                <span className="font-mono tabular-nums text-cyan-300">
                  {relSpeedBeta.toFixed(3)} c
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.995}
                step={0.005}
                value={relSpeedBeta}
                onChange={(e) => setRelSpeedBeta(parseFloat(e.target.value))}
                className="lab-slider w-full"
              />
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="p-2.5 rounded-lg bg-[#0A0F1A] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Lorentz γ</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-amber-300">
                    {lorentzGamma.toFixed(4)}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0A0F1A] border border-slate-800">
                  <div className="text-[11px] text-slate-400">
                    Length Contraction
                  </div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-cyan-300">
                    {(100 / lorentzGamma).toFixed(1)}%
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0A0F1A] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Time Dilation</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-emerald-300">
                    {lorentzGamma.toFixed(2)}×
                  </div>
                </div>
              </div>
            </div>
          )}

          {solverTab === "idealgas" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Moles n</span>
                  <input
                    type="number"
                    min={0.1}
                    max={50}
                    step={0.1}
                    value={gasMoles}
                    onChange={(e) =>
                      setGasMoles(Math.max(0.1, Number(e.target.value) || 0.1))
                    }
                    className="w-full bg-[#141C2D] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Temp T (K)</span>
                  <input
                    type="number"
                    min={10}
                    max={5000}
                    step={10}
                    value={gasTempK}
                    onChange={(e) =>
                      setGasTempK(Math.max(10, Number(e.target.value) || 10))
                    }
                    className="w-full bg-[#141C2D] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Volume V (L)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={500}
                    step={0.5}
                    value={gasVolL}
                    onChange={(e) =>
                      setGasVolL(Math.max(0.5, Number(e.target.value) || 0.5))
                    }
                    className="w-full bg-[#141C2D] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </label>
              </div>
              <div className="p-3 rounded-lg bg-[#0A0F1A] border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Pressure P = nRT / V
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-cyan-300">
                  {idealGasPressureAtm.toFixed(3)} atm (
                  {(idealGasPressureAtm * 101.325).toFixed(1)} kPa)
                </span>
              </div>
            </div>
          )}

          {solverTab === "debroglie" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Mass m (kg)</span>
                  <input
                    type="number"
                    step="any"
                    value={particleMassKg}
                    onChange={(e) =>
                      setParticleMassKg(
                        Math.max(1e-35, Number(e.target.value) || 9.109e-31),
                      )
                    }
                    className="w-full bg-[#141C2D] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Velocity v (m/s)</span>
                  <input
                    type="number"
                    step="any"
                    value={particleVel}
                    onChange={(e) =>
                      setParticleVel(
                        Math.max(1, Number(e.target.value) || 1e6),
                      )
                    }
                    className="w-full bg-[#141C2D] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </label>
              </div>
              <div className="p-3 rounded-lg bg-[#0A0F1A] border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Matter Wavelength λ = h / mv
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-amber-300">
                  {deBroglieNm.toExponential(3)} nm
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
