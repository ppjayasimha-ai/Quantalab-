import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  CameraPresetId,
  PhysicsExperimentId,
  PhysicsLabEngine,
  PhysicsParams,
  PhysicsTelemetry,
} from "../three/PhysicsLabEngine";
import { labAudio } from "../utils/sound";

interface PhysicsWorkspaceProps {
  onExplainTopic: (contextPrompt: string) => void;
}

const DEFAULT_PARAMS: PhysicsParams = {
  gravity: 9.81,
  timeScale: 1.0,
  paused: false,
  length1: 1.85,
  length2: 1.65,
  mass1: 1.4,
  mass2: 1.2,
  damping: 0.002,
  starMass: 1.15,
  probeSpeed: 2.35,
  waveFreq: 1.6,
  waveAmp: 0.55,
  wavePhase: 0,
  launchAngle: 42,
  launchVelocity: 11.2,
  airDrag: 0.02,
  windSpeed: -0.8,
};

const EXPERIMENT_META: Record<
  PhysicsExperimentId,
  { title: string; equation: string; actionLabel: string }
> = {
  pendulum: {
    title: "Double Compound Pendulum",
    equation: "L = T - V (Lagrange RK4)",
    actionLabel: "Apply Impulse",
  },
  orbital: {
    title: "Keplerian Gravity Well",
    equation: "F = -G·M·m / r²",
    actionLabel: "Launch Probe",
  },
  wave: {
    title: "Dual-Source Wave Lattice",
    equation: "ψ(r,t) = Σ A·sin(kr - ωt) / √r",
    actionLabel: "Reset Phase",
  },
  projectile: {
    title: "Aerodynamic Ballistic Tunnel",
    equation: "F_d = -½·ρ·v²·C_d·A",
    actionLabel: "Fire Projectile",
  },
};

export default function PhysicsWorkspace({
  onExplainTopic,
}: PhysicsWorkspaceProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PhysicsLabEngine | null>(null);

  const [experiment, setExperiment] =
    useState<PhysicsExperimentId>("pendulum");
  const [params, setParams] = useState<PhysicsParams>(DEFAULT_PARAMS);
  const [dockOpen, setDockOpen] = useState(true);
  const [telemetry, setTelemetry] = useState<PhysicsTelemetry>({
    fps: 60,
    solverHz: 720,
    primaryMetricLabel: "Upper Angle θ₁",
    primaryMetricValue: "122.4°",
    secondaryMetricLabel: "Lower Angle θ₂",
    secondaryMetricValue: "153.0°",
    tertiaryMetricLabel: "Kinetic Energy",
    tertiaryMetricValue: "0.00 J",
    energyLabel: "Total Mechanical E",
    energyValue: "0.00 J",
  });

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new PhysicsLabEngine(mountRef.current, params, (next) => {
      setTelemetry(next);
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // Mount WebGL canvas once and keep stable across parameter updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "h" || e.key === "H") {
        setDockOpen((prev) => !prev);
      } else if (e.key === " ") {
        e.preventDefault();
        setParams((prev) => ({ ...prev, paused: !prev.paused }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectExperiment = (id: PhysicsExperimentId) => {
    labAudio.playClick();
    setExperiment(id);
    engineRef.current?.setExperiment(id);
  };

  const handlePreset = (preset: CameraPresetId) => {
    labAudio.playClick();
    engineRef.current?.setCameraPreset(preset);
  };

  const updateParam = <K extends keyof PhysicsParams>(
    key: K,
    value: PhysicsParams[K],
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const meta = EXPERIMENT_META[experiment];

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07090E]">
      {/* Dedicated WebGL Mount */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="3D Physics Viewport"
      />

      {/* Top-Left Compact Live Telemetry Strip (No backdrop-blur over WebGL) */}
      <div className="pointer-events-none absolute top-4 left-4 right-4 flex flex-wrap items-start justify-between gap-4 z-10">
        <div className="pointer-events-auto bg-[#0B0F18]/92 border border-slate-800/90 rounded-xl px-4 py-3 max-w-xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-medium text-cyan-400">{meta.title}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-300">{meta.equation}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {telemetry.solverHz} Hz Solver / {telemetry.fps} FPS
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-slate-800/80 pt-2.5">
            <div>
              <div className="text-[11px] text-slate-400">
                {telemetry.primaryMetricLabel}
              </div>
              <div className="text-sm font-mono font-semibold tabular-nums text-slate-100">
                {telemetry.primaryMetricValue}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">
                {telemetry.secondaryMetricLabel}
              </div>
              <div className="text-sm font-mono font-semibold tabular-nums text-slate-100">
                {telemetry.secondaryMetricValue}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">
                {telemetry.tertiaryMetricLabel}
              </div>
              <div className="text-sm font-mono font-semibold tabular-nums text-cyan-300">
                {telemetry.tertiaryMetricValue}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">
                {telemetry.energyLabel}
              </div>
              <div className="text-sm font-mono font-semibold tabular-nums text-amber-300">
                {telemetry.energyValue}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            labAudio.playClick();
            onExplainTopic(
              `Explain the live physics of ${meta.title} (${meta.equation}) with current telemetry: ${telemetry.primaryMetricLabel}=${telemetry.primaryMetricValue}, ${telemetry.energyLabel}=${telemetry.energyValue}.`,
            );
          }}
          className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#0B0F18]/92 border border-slate-700/80 hover:border-cyan-500/60 text-xs font-medium text-slate-200 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          Analyze Physics
        </button>
      </div>

      {/* Collapsible Bottom Control Dock (Zero Central Occlusion) */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center transition-transform duration-200 ease-out"
        style={{
          width: "min(960px, 95vw)",
          transform: dockOpen
            ? "translate(-50%, 0)"
            : "translate(-50%, calc(100% - 36px))",
        }}
      >
        <button
          type="button"
          onClick={() => {
            labAudio.playClick();
            setDockOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-t-lg bg-[#0E1422] border border-b-0 border-slate-800 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {dockOpen ? (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Hide Controls (H)
            </>
          ) : (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show Controls (H)
            </>
          )}
        </button>

        <div className="w-full bg-[#0B0F18]/95 border border-slate-800 rounded-xl p-4 shadow-2xl">
          {/* Row 1: Experiment Switcher + Playback + Camera Presets */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/90">
            <div className="flex items-center gap-1 p-1 bg-[#131A29] rounded-lg overflow-x-auto">
              {(
                [
                  ["pendulum", "Double Pendulum"],
                  ["orbital", "Orbital Gravity"],
                  ["wave", "Wave Interference"],
                  ["projectile", "Ballistics & Drag"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectExperiment(id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    experiment === id
                      ? "bg-cyan-500 text-slate-950"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  labAudio.playClick();
                  updateParam("paused", !params.paused);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#131A29] hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {params.paused ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    Pause
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  labAudio.playIgnition();
                  engineRef.current?.triggerAction();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-medium text-cyan-300 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                {meta.actionLabel}
              </button>

              <button
                type="button"
                onClick={() => {
                  labAudio.playClick();
                  engineRef.current?.resetExperiment();
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#131A29] hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0 cursor-pointer"
                title="Reset Experiment"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>

              <div className="hidden sm:flex items-center gap-1 pl-2 border-l border-slate-800">
                <Camera className="w-3.5 h-3.5 text-slate-400 mr-1" />
                {(["iso", "top", "side"] as CameraPresetId[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePreset(preset)}
                    className="px-2 py-1 rounded text-[11px] font-medium uppercase text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Experiment-Specific Precision Parameter Sliders */}
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Time Scale</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {params.timeScale.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.25}
                max={2.5}
                step={0.05}
                value={params.timeScale}
                onChange={(e) =>
                  updateParam("timeScale", parseFloat(e.target.value))
                }
                className="lab-slider w-full"
              />
            </label>

            {experiment === "pendulum" && (
              <>
                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Gravity g</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.gravity.toFixed(2)} m/s²
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.62}
                    max={24.79}
                    step={0.1}
                    value={params.gravity}
                    onChange={(e) =>
                      updateParam("gravity", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Upper Arm L₁</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.length1.toFixed(2)} m
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.9}
                    max={2.4}
                    step={0.05}
                    value={params.length1}
                    onChange={(e) =>
                      updateParam("length1", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Lower Arm L₂</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.length2.toFixed(2)} m
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.9}
                    max={2.4}
                    step={0.05}
                    value={params.length2}
                    onChange={(e) =>
                      updateParam("length2", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>
              </>
            )}

            {experiment === "orbital" && (
              <>
                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Solar Mass M</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.starMass.toFixed(2)} M☉
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.2}
                    step={0.05}
                    value={params.starMass}
                    onChange={(e) =>
                      updateParam("starMass", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Probe Launch v₀</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.probeSpeed.toFixed(2)} km/s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.1}
                    max={3.4}
                    step={0.05}
                    value={params.probeSpeed}
                    onChange={(e) =>
                      updateParam("probeSpeed", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <div className="flex items-end text-xs text-slate-400 pb-1">
                  Click &quot;Launch Probe&quot; to test slingshot &amp; escape
                  trajectories.
                </div>
              </>
            )}

            {experiment === "wave" && (
              <>
                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Frequency f</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.waveFreq.toFixed(2)} Hz
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={3.0}
                    step={0.05}
                    value={params.waveFreq}
                    onChange={(e) =>
                      updateParam("waveFreq", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Amplitude A</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.waveAmp.toFixed(2)} m
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={1.1}
                    step={0.05}
                    value={params.waveAmp}
                    onChange={(e) =>
                      updateParam("waveAmp", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Phase Offset Δφ</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {Math.round((params.wavePhase * 180) / Math.PI)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.PI * 2}
                    step={0.1}
                    value={params.wavePhase}
                    onChange={(e) =>
                      updateParam("wavePhase", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>
              </>
            )}

            {experiment === "projectile" && (
              <>
                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Elevation Angle θ</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.launchAngle}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={1}
                    value={params.launchAngle}
                    onChange={(e) =>
                      updateParam("launchAngle", parseInt(e.target.value, 10))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Muzzle Velocity v₀</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.launchVelocity.toFixed(1)} m/s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={16}
                    step={0.2}
                    value={params.launchVelocity}
                    onChange={(e) =>
                      updateParam("launchVelocity", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Air Drag &amp; Wind</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {params.windSpeed.toFixed(1)} m/s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-5}
                    max={5}
                    step={0.2}
                    value={params.windSpeed}
                    onChange={(e) =>
                      updateParam("windSpeed", parseFloat(e.target.value))
                    }
                    className="lab-slider w-full"
                  />
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
