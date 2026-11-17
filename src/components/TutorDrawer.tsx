import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Send, Trash2, X } from "lucide-react";
import { labAudio } from "../utils/sound";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  modelUsed?: string;
}

interface TutorDrawerProps {
  open: boolean;
  onClose: () => void;
  activeContext: string;
  seededPrompt: string | null;
  onClearSeededPrompt: () => void;
}

export default function TutorDrawer({
  open,
  onClose,
  activeContext,
  seededPrompt,
  onClearSeededPrompt,
}: TutorDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "model",
      text: "Hello! I am Dr. Quanta, your Physics, Chemistry, and Mathematics lab tutor. Ask me about any 3D experiment, thermodynamic reaction, or symbolic derivation.",
    },
  ]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"fast" | "tutor" | "deep">("tutor");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open && seededPrompt) {
      setInput(seededPrompt);
      onClearSeededPrompt();
    }
  }, [open, seededPrompt, onClearSeededPrompt]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || streaming) return;

    labAudio.playClick();
    setError(null);
    setInput("");

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
    };
    const modelMsgId = `m-${Date.now() + 1}`;
    const historySnapshot = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: modelMsgId, role: "model", text: "" },
    ]);
    setStreaming(true);

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: historySnapshot,
          mode,
          context: activeContext,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Chat request failed.");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Streaming response unavailable.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payloadStr = line.slice(6).trim();
          if (!payloadStr) continue;
          const payload = JSON.parse(payloadStr) as {
            chunk?: string;
            done?: boolean;
            model?: string;
            error?: string;
          };

          if (payload.error) {
            throw new Error(payload.error);
          }

          if (payload.chunk) {
            accumulated += payload.chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === modelMsgId ? { ...m, text: accumulated } : m,
              ),
            );
          }

          if (payload.done && payload.model) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === modelMsgId ? { ...m, modelUsed: payload.model } : m,
              ),
            );
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to contact Gemini tutor.";
      setError(msg);
      setMessages((prev) =>
        prev.filter((m) => m.id !== modelMsgId || m.text.trim().length > 0),
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Science & Math Tutor Drawer"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0B0F18] border-l border-slate-800 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Dr. Quanta · Lab Tutor
          </h2>
          <p className="text-xs text-slate-400 truncate max-w-[270px]">
            Context: {activeContext}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              labAudio.playClick();
              setMessages([
                {
                  id: "welcome",
                  role: "model",
                  text: "Conversation reset. What physics, chemistry, or calculus problem would you like to explore?",
                },
              ]);
              setError(null);
            }}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Clear History"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close Tutor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="px-5 py-2.5 border-b border-slate-800/80 bg-[#0E1420] flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">Reasoning Mode</span>
        <div className="flex items-center gap-1 p-0.5 bg-[#141C2D] rounded-lg">
          {(
            [
              ["fast", "Fast"],
              ["tutor", "Tutor"],
              ["deep", "Deep Proof"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                mode === id
                  ? "bg-cyan-500 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Thread */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${
              m.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div className="text-[11px] text-slate-500 mb-1">
              {m.role === "user" ? "You" : "Dr. Quanta"}
              {m.modelUsed ? ` · ${m.modelUsed}` : ""}
            </div>
            <div
              className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-cyan-500 text-slate-950 font-medium"
                  : "bg-[#121928] border border-slate-800 text-slate-200"
              }`}
            >
              {m.text || (
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Thinking...
                </span>
              )}
            </div>
          </div>
        ))}

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
            {error}
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-slate-800 bg-[#0A0E17] flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about equations, forces, or reactions..."
          className="flex-1 bg-[#141C2D] border border-slate-700/80 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-45 text-slate-950 transition-colors shrink-0 cursor-pointer"
          aria-label="Send Message"
        >
          {streaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </form>
    </aside>
  );
}
