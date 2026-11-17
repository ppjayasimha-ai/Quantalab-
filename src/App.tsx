import { useCallback, useState } from "react";
import ChemistryWorkspace from "./components/ChemistryWorkspace";
import LabVisionWorkspace from "./components/LabVisionWorkspace";
import MathEngineWorkspace from "./components/MathEngineWorkspace";
import PhysicsWorkspace from "./components/PhysicsWorkspace";
import TutorDrawer from "./components/TutorDrawer";
import { labAudio } from "./utils/sound";

type WorkspaceTab = "physics" | "chemistry" | "math" | "vision";

const WORKSPACE_LABELS: Record<WorkspaceTab, string> = {
  physics: "3D Physics & 720 Hz RK4 Sandbox",
  chemistry: "Gamified 3D Molecular Chemistry Reactor",
  math: "Symbolic Math Engine & 3D Function Plotter",
  vision: "Multimodal Lab Vision Equation Analyzer",
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("physics");
  const [tutorOpen, setTutorOpen] = useState(false);
  const [seededPrompt, setSeededPrompt] = useState<string | null>(null);
  const [plotExprFromVision, setPlotExprFromVision] = useState<string | null>(
    null,
  );

  const handleExplainTopic = useCallback((prompt: string) => {
    setSeededPrompt(prompt);
    setTutorOpen(true);
  }, []);

  const handleSendToPlotter = useCallback((expr: string) => {
    labAudio.playClick();
    setPlotExprFromVision(expr);
    setActiveTab("math");
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07090E] text-slate-100 overflow-hidden">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="h-14 px-6 border-b border-slate-800/90 bg-[#0A0E17] flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("physics");
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          QuantaLab 3D
        </a>

        {/* Zone 2: 4 Single-Line Text Navigation Links */}
        <nav
          aria-label="Primary Workspaces"
          className="flex items-center gap-6 overflow-x-auto"
        >
          {(
            [
              ["physics", "Physics 3D"],
              ["chemistry", "Chemistry Game"],
              ["math", "Math Engine"],
              ["vision", "Lab Vision"],
            ] as const
          ).map(([id, label]) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  labAudio.playClick();
                  setActiveTab(id);
                }}
                className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? "text-white"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => {
              labAudio.playClick();
              setTutorOpen(true);
            }}
            className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Ask Tutor
          </button>
        </div>
      </header>

      {/* Main Active Workspace */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "physics" && (
          <PhysicsWorkspace onExplainTopic={handleExplainTopic} />
        )}
        {activeTab === "chemistry" && (
          <ChemistryWorkspace onExplainTopic={handleExplainTopic} />
        )}
        {activeTab === "math" && (
          <MathEngineWorkspace
            externalPlotExpr={plotExprFromVision}
            onExplainTopic={handleExplainTopic}
          />
        )}
        {activeTab === "vision" && (
          <LabVisionWorkspace
            onSendToPlotter={handleSendToPlotter}
            onExplainTopic={handleExplainTopic}
          />
        )}
      </main>

      {/* Multi-turn Gemini Science Tutor Drawer */}
      <TutorDrawer
        open={tutorOpen}
        onClose={() => setTutorOpen(false)}
        activeContext={WORKSPACE_LABELS[activeTab]}
        seededPrompt={seededPrompt}
        onClearSeededPrompt={() => setSeededPrompt(null)}
      />
    </div>
  );
}
