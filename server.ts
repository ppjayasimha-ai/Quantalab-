import "dotenv/config";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  GenerateContentResponse,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please add it in Settings > Secrets.",
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function mapApiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("GEMINI_API_KEY")) {
    return { status: 500, message: msg };
  }
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
    return {
      status: 403,
      message:
        "Permission denied by Gemini API. Check your API key in Settings > Secrets.",
    };
  }
  if (msg.includes("400") || msg.includes("API_KEY_INVALID")) {
    return {
      status: 400,
      message:
        "Invalid request or API key. Verify your key in Settings > Secrets.",
    };
  }
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Rate limit reached. Please wait a moment and try again.",
    };
  }
  return { status: 500, message: msg || "Gemini service error." };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      hasKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Multi-turn streaming science & math tutor
  app.post("/api/gemini/chat", async (req: Request, res: Response) => {
    try {
      const {
        message,
        history = [],
        mode = "tutor",
        context = "",
      } = req.body as {
        message?: string;
        history?: Array<{ role: "user" | "model"; text: string }>;
        mode?: "fast" | "tutor" | "deep";
        context?: string;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Message is required." });
        return;
      }

      const ai = getAiClient();
      const model =
        mode === "fast" ? "gemini-3.1-flash-lite" : "gemini-4-hydrogen";

      const thinkingConfig =
        mode === "fast"
          ? { thinkingLevel: ThinkingLevel.MINIMAL }
          : mode === "deep"
            ? { thinkingLevel: ThinkingLevel.HIGH }
            : { thinkingLevel: ThinkingLevel.MEDIUM };

      const systemInstruction = [
        "You are Dr. Quanta, an expert Physics, Chemistry, and Applied Mathematics laboratory tutor inside QuantaLab 3D.",
        "Guide students and researchers clearly with physical intuition, exact equations, SI units, and experimental takeaways.",
        "Keep answers concise, structured, and scannable unless the user requests a full derivation.",
        "Use standard ASCII/Unicode math notation (e.g., ΔG = ΔH - TΔS, v = √(2GM/r), ∫, ∑, →) so formulas read cleanly in plain text.",
        context ? `Active workspace context: ${context}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const formattedHistory = history
        .filter((h) => h && typeof h.text === "string" && h.text.trim())
        .slice(-20)
        .map((h) => ({
          role: h.role === "model" ? "model" : "user",
          parts: [{ text: h.text }],
        }));

      const chat = ai.chats.create({
        model,
        history: formattedHistory,
        config: {
          systemInstruction,
          thinkingConfig,
        },
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const stream = await chat.sendMessageStream({ message: message.trim() });

      for await (const chunk of stream) {
        const c = chunk as GenerateContentResponse;
        const text = c.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, model })}\n\n`);
      res.end();
    } catch (err) {
      const { status, message } = mapApiError(err);
      if (!res.headersSent) {
        res.status(status).json({ error: message });
      } else {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  });

  // Step-by-step math/physics/chemistry derivation solver
  app.post("/api/gemini/solve", async (req: Request, res: Response) => {
    try {
      const { expression, domain = "Mathematics", notes = "" } = req.body as {
        expression?: string;
        domain?: string;
        notes?: string;
      };

      if (!expression || !expression.trim()) {
        res.status(400).json({ error: "Expression or problem is required." });
        return;
      }

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Domain: ${domain}\nExpression / Problem: ${expression}\n${notes ? `Additional context: ${notes}` : ""}`,
        config: {
          systemInstruction:
            "You are a precision STEM derivation engine. Break down the mathematical, physical, or chemical problem into clear sequential steps, verify dimensional analysis/units, and state the final result.",
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    equation: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                  },
                  required: ["label", "equation", "explanation"],
                },
              },
              finalAnswer: { type: Type.STRING },
              physicalInsight: { type: Type.STRING },
            },
            required: ["title", "summary", "steps", "finalAnswer", "physicalInsight"],
          },
        },
      });

      const raw = (response.text ?? "{}").trim();
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err) {
      const { status, message } = mapApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Lab Vision: Multimodal image understanding for handwritten math, circuits, molecules, apparatus
  app.post("/api/gemini/analyze-image", async (req: Request, res: Response) => {
    try {
      const {
        imageBase64,
        mimeType = "image/png",
        question = "Analyze this scientific diagram, equation, or experiment photo. Extract equations, identify physical/chemical principles, and solve step-by-step.",
      } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        question?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== "string") {
        res.status(400).json({ error: "Image data is required." });
        return;
      }

      // Strip data URI prefix if present
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            },
            {
              text: question,
            },
          ],
        },
        config: {
          systemInstruction:
            "You are a multimodal scientific vision analyzer for Physics, Chemistry, and Mathematics. Inspect the uploaded photo carefully, transcribe any equations or chemical formulas accurately, provide a clear step-by-step analysis, and if the image contains a 2D/3D plottable function f(x,y) or y=f(x), suggest a valid mathjs expression in plotExpression (otherwise empty string).",
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              domain: { type: Type.STRING },
              extractedExpression: { type: Type.STRING },
              summary: { type: Type.STRING },
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepTitle: { type: Type.STRING },
                    detail: { type: Type.STRING },
                  },
                  required: ["stepTitle", "detail"],
                },
              },
              finalConclusion: { type: Type.STRING },
              plotExpression: {
                type: Type.STRING,
                description:
                  "Optional mathjs expression in variables x and y (e.g. 'sin(x)*cos(y)' or 'x^2 - y^2') if plottable, otherwise empty string.",
              },
            },
            required: [
              "domain",
              "extractedExpression",
              "summary",
              "steps",
              "finalConclusion",
              "plotExpression",
            ],
          },
        },
      });

      const raw = (response.text ?? "{}").trim();
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err) {
      const { status, message } = mapApiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`QuantaLab 3D server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
