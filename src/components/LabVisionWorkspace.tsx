import { ChangeEvent, useState } from "react";
import {
  ArrowRight,
  ImagePlus,
  Loader2,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { labAudio } from "../utils/sound";

interface LabVisionWorkspaceProps {
  onSendToPlotter: (expr: string) => void;
  onExplainTopic: (contextPrompt: string) => void;
}

interface VisionAnalysisResult {
  domain: string;
  extractedExpression: string;
  summary: string;
  steps: Array<{ stepTitle: string; detail: string }>;
  finalConclusion: string;
  plotExpression: string;
}

function generateSampleDiagramDataUrl(
  kind: "schrodinger" | "titration" | "projectile",
): string {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle grid
  ctx.strokeStyle = "#1E293B";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#E2E8F0";
  ctx.font = "bold 28px monospace";

  if (kind === "schrodinger") {
    ctx.fillText("2D Quantum Harmonic Wavefunction", 54, 72);
    ctx.fillStyle = "#38BDF8";
    ctx.font = "26px monospace";
    ctx.fillText("f(x, y) = cos(x) * sin(y) + 0.4 * exp(-(x^2 + y^2)/6)", 54, 130);
    ctx.fillStyle = "#94A3B8";
    ctx.font = "22px monospace";
    ctx.fillText("Evaluate local extrema on domain [-4, 4] x [-4, 4]", 54, 185);

    // Draw wave curve
    ctx.strokeStyle = "#06B6D4";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 60; x <= 900; x += 4) {
      const t = (x - 480) / 70;
      const y = 360 - Math.cos(t) * Math.exp((-t * t) / 10) * 110;
      if (x === 60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === "titration") {
    ctx.fillText("Stoichiometry & Combustion Lab Problem", 54, 72);
    ctx.fillStyle = "#F59E0B";
    ctx.font = "28px monospace";
    ctx.fillText("2 C₂H₆ + 7 O₂  ->  4 CO₂ + 6 H₂O", 54, 145);
    ctx.fillStyle = "#CBD5E1";
    ctx.font = "22px monospace";
    ctx.fillText("Given: 15.0 g of Ethane (C₂H₆, 30.07 g/mol)", 54, 215);
    ctx.fillText("Find: Moles of O₂ consumed and mass of CO₂ produced", 54, 260);
    ctx.fillText("Standard Enthalpy: ΔH° = -1560 kJ/mol C₂H₆", 54, 305);
  } else {
    ctx.fillText("Inclined Plane & Projectile Mechanics", 54, 72);
    ctx.fillStyle = "#10B981";
    ctx.font = "26px monospace";
    ctx.fillText("v₀ = 24.0 m/s   θ = 35°   g = 9.81 m/s²", 54, 135);
    ctx.fillStyle = "#CBD5E1";
    ctx.font = "22px monospace";
    ctx.fillText("Calculate: (a) Time of flight T", 54, 195);
    ctx.fillText("           (b) Maximum apex height H_max", 54, 235);
    ctx.fillText("           (c) Horizontal range R", 54, 275);

    ctx.strokeStyle = "#F59E0B";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(120, 460);
    ctx.quadraticCurveTo(480, 220, 840, 460);
    ctx.stroke();
  }

  return canvas.toDataURL("image/png");
}

export default function LabVisionWorkspace({
  onSendToPlotter,
  onExplainTopic,
}: LabVisionWorkspaceProps) {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("image/png");
  const [question, setQuestion] = useState(
    "Transcribe all equations or chemical formulas, verify the scientific principles, and solve step-by-step.",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<VisionAnalysisResult | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMimeType(file.type || "image/png");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImagePreview(reader.result);
        setAnalysis(null);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const loadSample = (kind: "schrodinger" | "titration" | "projectile") => {
    labAudio.playClick();
    const url = generateSampleDiagramDataUrl(kind);
    setImagePreview(url);
    setMimeType("image/png");
    setAnalysis(null);
    setError(null);
  };

  const analyzePhoto = async () => {
    if (!imagePreview) return;
    labAudio.playClick();
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/gemini/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imagePreview,
          mimeType,
          question,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Image analysis failed.");
      }
      setAnalysis(data as VisionAnalysisResult);
      labAudio.playReactionSuccess();
    } catch (err) {
      labAudio.playError();
      setError(err instanceof Error ? err.message : "Failed to analyze photo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#07090E] p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 Columns: Photo Upload & Sample Lab Boards */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl bg-[#0F1523] border border-slate-800">
            <h1 className="text-xl font-semibold text-white">
              Lab Vision Analyzer
            </h1>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Upload a photo of handwritten calculus, physics kinematics,
              molecular structures, or laboratory notes for multimodal Gemini
              extraction and step-by-step verification.
            </p>

            <label className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 hover:border-cyan-500/70 bg-[#0A0F1A] p-6 text-center cursor-pointer transition-colors">
              <ImagePlus className="w-7 h-7 text-cyan-400 mb-2" />
              <span className="text-xs font-medium text-slate-200">
                Choose Photo or Diagram
              </span>
              <span className="text-[11px] text-slate-500 mt-1">
                PNG, JPG, or WebP supported
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            <div className="mt-4">
              <div className="text-[11px] text-slate-400 mb-2">
                Or test immediately with a lab whiteboard snapshot:
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => loadSample("schrodinger")}
                  className="px-2.5 py-1.5 rounded-lg bg-[#141C2D] hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 cursor-pointer"
                >
                  Wavefunction 3D
                </button>
                <button
                  type="button"
                  onClick={() => loadSample("titration")}
                  className="px-2.5 py-1.5 rounded-lg bg-[#141C2D] hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 cursor-pointer"
                >
                  Combustion Stoich
                </button>
                <button
                  type="button"
                  onClick={() => loadSample("projectile")}
                  className="px-2.5 py-1.5 rounded-lg bg-[#141C2D] hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 cursor-pointer"
                >
                  Ballistics Board
                </button>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs text-slate-300 mb-1.5">
                Analysis Prompt
              </label>
              <textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="w-full rounded-lg bg-[#141C2D] border border-slate-700/80 focus:border-cyan-500 px-3 py-2 text-xs text-slate-100 outline-none resize-none"
              />
            </div>

            <button
              type="button"
              onClick={analyzePhoto}
              disabled={!imagePreview || loading}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-45 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing Image...
                </>
              ) : (
                <>
                  <ScanSearch className="w-4 h-4" />
                  Analyze with Gemini Vision
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right 7 Columns: Image Preview & Structured Scientific Breakdown */}
        <div className="lg:col-span-7 space-y-4">
          {imagePreview ? (
            <div className="rounded-xl overflow-hidden border border-slate-800 bg-[#0B0F18]">
              <img
                src={imagePreview}
                alt="Uploaded scientific diagram or equation"
                referrerPolicy="no-referrer"
                className="w-full max-h-72 object-contain bg-[#080B12]"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800/90 bg-[#0F1523] p-10 text-center">
              <ScanSearch className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-300">
                No Image Selected Yet
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Upload a photo on the left or load one of the sample lab boards
                to run multimodal extraction.
              </p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              {error}
            </div>
          )}

          {analysis && (
            <div className="p-5 rounded-xl bg-[#0F1523] border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium text-cyan-400">
                    {analysis.domain}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Multimodal Extraction</span>
                </div>
                <div className="flex items-center gap-2">
                  {analysis.plotExpression && (
                    <button
                      type="button"
                      onClick={() => onSendToPlotter(analysis.plotExpression)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/50 text-xs font-medium text-cyan-300 cursor-pointer"
                    >
                      Plot in 3D Math Engine
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onExplainTopic(
                        `Continue explaining this analyzed problem: ${analysis.extractedExpression}. Conclusion: ${analysis.finalConclusion}`,
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161F33] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    Ask Tutor
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[#0A0F1A] border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  Extracted Expression / Formula
                </div>
                <div className="mt-1 font-mono text-sm font-semibold text-white">
                  {analysis.extractedExpression}
                </div>
                <p className="mt-1.5 text-xs text-slate-300">
                  {analysis.summary}
                </p>
              </div>

              <div className="space-y-2">
                {analysis.steps.map((step, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-[#0A0F1A] border border-slate-800/80"
                  >
                    <div className="text-xs font-medium text-cyan-300">
                      {i + 1}. {step.stepTitle}
                    </div>
                    <div className="mt-1 text-xs text-slate-300 leading-relaxed">
                      {step.detail}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-500/35">
                <div className="text-[11px] font-medium text-emerald-400">
                  Verified Conclusion
                </div>
                <div className="mt-1 text-sm font-mono font-semibold text-emerald-100">
                  {analysis.finalConclusion}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
