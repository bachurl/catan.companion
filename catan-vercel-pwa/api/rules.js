import Anthropic from "@anthropic-ai/sdk";

// ═══════════════════════════════════════════════
//  CONSULTOR DE REGLAS (Vercel Function)
//
//  La app es una PWA estática: la API key no puede vivir en el cliente, así
//  que las preguntas pasan por acá. Sin ANTHROPIC_API_KEY el endpoint
//  responde 503 y la app muestra cómo configurarlo.
//
//  GET  → { available }  (para que el cliente sepa si está configurado)
//  POST → { question, history?, context? } → { answer }
// ═══════════════════════════════════════════════

// El modelo se puede cambiar por variable de entorno sin tocar el código.
const MODEL = process.env.CATAN_RULES_MODEL || "claude-opus-5";
const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_TOKENS = 4000;

const SYSTEM = `Sos el consultor de reglas de una app companion de Catán, y te consultan
en medio de una partida real, con el tablero físico en la mesa.

Cómo responder:
- En español rioplatense, tuteo con "vos", tono directo y amable.
- Muy conciso: 2 a 4 frases. La respuesta concreta primero; después, solo si hace
  falta, una aclaración corta.
- Nada de listas largas ni de explicar el juego entero: responden una duda puntual
  para poder seguir jugando.
- Si la regla cambia según la edición o suele jugarse distinto como regla de la
  casa, decilo en una frase para que lo resuelvan en la mesa.
- Si no estás seguro, decilo en vez de inventar.
- Si la pregunta no es sobre Catán, respondé que solo podés ayudar con reglas de Catán.

Cubrís el juego base y la expansión de 5-6 jugadores (incluida la fase de
construcción especial). No conocés el estado de la partida ni el tablero: si la
pregunta depende de eso, respondé la regla general.`;

const textOf = (content) => content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("\n")
  .trim();

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "El consultor de reglas no está configurado. Falta la variable ANTHROPIC_API_KEY en Vercel.",
    });
  }

  const body = req.body || {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return res.status(400).json({ error: "Falta la pregunta." });
  if (question.length > MAX_QUESTION_CHARS) {
    return res.status(400).json({ error: `La pregunta es muy larga (máximo ${MAX_QUESTION_CHARS} caracteres).` });
  }

  // Historial: solo turnos bien formados y acotados (el endpoint es público).
  const history = Array.isArray(body.history) ? body.history : [];
  const messages = history
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  messages.push({ role: "user", content: question });

  // Contexto de la partida: cambia qué reglas aplican.
  const ctx = body.context || {};
  const system = ctx.expansion
    ? `${SYSTEM}\n\nEsta partida usa la expansión de 5-6 jugadores.`
    : SYSTEM;

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Consultas de reglas: puntuales y factuales, no necesitan razonamiento profundo.
      output_config: { effort: "low" },
      // Si el modelo declina, el servidor reintenta en otro y la llamada no se pierde.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return res.status(200).json({
        answer: "No puedo responder eso. Probá con una pregunta sobre las reglas de Catán.",
      });
    }

    const answer = textOf(response.content);
    if (!answer) {
      return res.status(200).json({ answer: "No pude generar una respuesta. Probá reformulando la pregunta." });
    }
    // Se avisa si la respuesta quedó cortada por el tope de tokens.
    return res.status(200).json({
      answer,
      truncated: response.stop_reason === "max_tokens" || undefined,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: "La API key configurada no es válida." });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Muchas consultas seguidas. Probá de nuevo en unos segundos." });
    }
    if (error instanceof Anthropic.APIError) {
      return res.status(502).json({ error: "No se pudo consultar las reglas en este momento." });
    }
    return res.status(500).json({ error: "Error inesperado consultando las reglas." });
  }
}
