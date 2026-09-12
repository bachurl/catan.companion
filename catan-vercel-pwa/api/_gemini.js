// ═══════════════════════════════════════════════
//  GEMINI (Google AI) — cliente mínimo para las Vercel Functions
//
//  Sin SDK: un POST a generateContent alcanza. El guion bajo del nombre hace
//  que Vercel NO lo exponga como ruta; solo lo importan api/rules.js y
//  api/vision.js.
//
//  La key vive en GEMINI_API_KEY (o GOOGLE_API_KEY) del lado del servidor.
// ═══════════════════════════════════════════════

export const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export class GeminiError extends Error {
  constructor(status, message) {
    super(message || `Gemini respondió ${status}`);
    this.status = status;
  }
}

// Llama a generateContent y devuelve el primer candidato.
export async function generateContent({ model, system, contents, generationConfig }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (generationConfig) body.generationConfig = generationConfig;

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
    body: JSON.stringify(body),
  });

  let data = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }

  if (!r.ok) {
    throw new GeminiError(r.status, data?.error?.message);
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    // Bloqueado por seguridad antes de generar: sin candidatos.
    throw new GeminiError(422, data?.promptFeedback?.blockReason || "Sin respuesta");
  }
  return candidate;
}

// Junta el texto de un candidato (ignora las partes de "pensamiento").
export const textOf = (candidate) => (candidate?.content?.parts || [])
  .filter((p) => typeof p.text === "string" && !p.thought)
  .map((p) => p.text)
  .join("\n")
  .trim();

// Convierte un mensaje {role: "user"|"assistant", content} al formato de Gemini.
export const toContent = (m) => ({
  role: m.role === "assistant" ? "model" : "user",
  parts: [{ text: m.content }],
});
