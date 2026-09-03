import Anthropic from "@anthropic-ai/sdk";

// ═══════════════════════════════════════════════
//  RECONOCER EL TABLERO DESDE UNA FOTO (Vercel Function)
//
//  La app manda una foto del tablero físico y recibe qué recurso y qué número
//  tiene cada hexágono, en el mismo orden de filas que usa `src/board/geometry.js`.
//  Lo que vuelve es un borrador: la app lo muestra sobre el mapa para que el
//  usuario corrija antes de usarlo. Nada se aplica a la partida sin confirmar.
//
//  La imagen no se guarda: se manda a la API y se descarta.
//
//  GET  → { available }
//  POST → { image: <base64 sin encabezado>, mediaType, layout } → { hexes, notes? }
// ═══════════════════════════════════════════════

const MODEL = process.env.CATAN_VISION_MODEL || "claude-opus-5";
const MAX_TOKENS = 8000;
// La API acepta hasta 5 MB por imagen. El cliente además la achica antes de subir.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];

const RES = ["madera", "ladrillo", "trigo", "oveja", "mineral", "desierto"];
const NUMS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

// Mismos layouts que geometry.js. Se repiten acá porque las funciones de Vercel
// se empaquetan aparte del bundle del cliente.
const LAYOUTS = {
  base: { rows: [3, 4, 5, 4, 3], desiertos: 1 },
  ext: { rows: [3, 4, 5, 6, 5, 4, 3], desiertos: 2 },
};

const SYSTEM = `Reconocés tableros de Catán en fotos para una app que lleva el puntaje
de partidas reales.

Devolvés, hexágono por hexágono, qué terreno y qué ficha numerada tiene, usando la
herramienta que se te da. Reglas:

- El tablero es un hexágono de filas. Recorré la foto por filas de arriba hacia
  abajo y, dentro de cada fila, de izquierda a derecha. La fila 0 es la de más
  arriba. Ajustá la lectura si la foto está rotada o en ángulo: lo que importa es
  la forma del tablero, no la orientación de la cámara.
- Terrenos: bosque = madera, colinas/arcilla = ladrillo, sembrado amarillo = trigo,
  pastura verde claro = oveja, montaña gris = mineral, arena = desierto.
- El desierto no tiene ficha numerada: devolvé num = null.
- No existe la ficha del 7.
- Si un hexágono no se ve bien, igual dale tu mejor lectura y bajá la confianza.
  Nunca omitas un hexágono ni inventes uno de más.
- confidence va de 0 a 1: usá menos de 0.5 cuando realmente no estás seguro.
  El usuario va a corregir a mano lo que marques con poca confianza.
- En notes, una frase corta en español rioplatense si algo complicó la lectura
  (foto borrosa, reflejos, un sector tapado). Si salió limpio, dejalo vacío.`;

const toolFor = (layout) => {
  const def = LAYOUTS[layout];
  const total = def.rows.reduce((a, b) => a + b, 0);
  return {
    name: "cargar_tablero",
    description: `Carga los ${total} hexágonos del tablero leídos en la foto, en orden de filas`
      + ` (${def.rows.join("-")}), de arriba hacia abajo y de izquierda a derecha.`,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        hexes: {
          type: "array",
          description: `Los ${total} hexágonos en orden de lectura.`,
          items: {
            type: "object",
            properties: {
              row: { type: "integer", description: "Fila, empezando en 0 arriba." },
              col: { type: "integer", description: "Posición dentro de la fila, empezando en 0 a la izquierda." },
              res: { type: "string", enum: RES },
              num: { type: ["integer", "null"], enum: [...NUMS, null], description: "Ficha numerada; null en el desierto." },
              confidence: { type: "number", description: "0 a 1." },
            },
            required: ["row", "col", "res", "num", "confidence"],
            additionalProperties: false,
          },
        },
        notes: { type: "string", description: "Aclaración corta, o vacío." },
      },
      required: ["hexes", "notes"],
      additionalProperties: false,
    },
  };
};

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
      error: "El reconocimiento por foto no está configurado. Falta la variable ANTHROPIC_API_KEY en Vercel.",
    });
  }

  const body = req.body || {};
  const layout = body.layout === "ext" ? "ext" : "base";
  const mediaType = MEDIA_TYPES.includes(body.mediaType) ? body.mediaType : null;
  const image = typeof body.image === "string" ? body.image : "";

  if (!mediaType) return res.status(400).json({ error: "Formato de imagen no soportado (usá JPEG, PNG o WebP)." });
  if (!image) return res.status(400).json({ error: "Falta la foto." });
  // Largo en base64 → bytes aproximados, sin decodificar la imagen entera.
  if (image.length * 0.75 > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: "La foto es muy pesada. Sacá otra o probá con menos resolución." });
  }

  const tool = toolFor(layout);

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Leer 19 o 30 hexágonos de una foto real es trabajo fino: conviene que piense.
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          {
            type: "text",
            text: `Leé este tablero de Catán (${layout === "ext" ? "expansión de 5-6 jugadores, 30 hexágonos" : "tablero clásico, 19 hexágonos"})`
              + ` y cargá todos los hexágonos con la herramienta.`,
          },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "No se pudo leer la foto. Probá con otra." });
    }

    const call = response.content.find((b) => b.type === "tool_use" && b.name === tool.name);
    if (!call) {
      return res.status(422).json({ error: "No se reconoció ningún tablero en la foto. Probá con otra, más de frente y con buena luz." });
    }

    const input = call.input || {};
    return res.status(200).json({
      layout,
      hexes: Array.isArray(input.hexes) ? input.hexes : [],
      notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: "La API key configurada no es válida." });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Muchas fotos seguidas. Probá de nuevo en unos segundos." });
    }
    if (error instanceof Anthropic.APIError) {
      return res.status(502).json({ error: "No se pudo leer la foto en este momento." });
    }
    return res.status(500).json({ error: "Error inesperado leyendo la foto." });
  }
}
