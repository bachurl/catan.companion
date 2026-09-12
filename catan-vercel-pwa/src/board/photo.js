// ═══════════════════════════════════════════════
//  CARGAR EL TABLERO DESDE UNA FOTO
// ═══════════════════════════════════════════════
// El endpoint devuelve lo que leyó en la foto; acá se convierte en un tablero
// del mismo formato que genera el generador, y se calcula qué no cierra
// (terrenos o fichas de más o de menos) para avisarlo antes de confirmar.

import { LAYOUTS, geometry } from "./geometry.js";
import { defaultPorts } from "./generate.js";
import { RM } from "../game/constants.js";

// La foto se manda achicada: la calidad que se gana con más resolución no
// compensa lo que tarda en subir desde un celular.
const MAX_SIDE = 1400;
const QUALITY = 0.82;

export async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok;
      img.onerror = () => fail(new Error("No se pudo abrir la foto."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Devuelve { image, mediaType, preview } listo para mandar al endpoint.
export async function preparePhoto(file) {
  const img = await fileToImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  return { image: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl };
}

export async function readBoardPhoto({ image, mediaType, layout }) {
  const r = await fetch("/api/vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, mediaType, layout }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "No se pudo leer la foto.");
  return data;
}

export async function visionAvailable() {
  try {
    const r = await fetch("/api/vision");
    if (!r.ok) return false;
    return Boolean((await r.json()).available);
  } catch {
    return false;
  }
}

// ── Del reconocimiento al tablero ──

const bagOf = layout => {
  const def = LAYOUTS[layout];
  return {
    terrains: def.terrains,
    numbers: def.numbers.reduce((acc, n) => ({ ...acc, [n]: (acc[n] || 0) + 1 }), {}),
  };
};

const countBy = (list, key) => list.reduce((acc, h) => {
  const v = h[key];
  if (v === null || v === undefined || v === "") return acc;
  return { ...acc, [v]: (acc[v] || 0) + 1 };
}, {});

const frase = (verbo, n, nombre) => `${n > 1 ? `${verbo}n` : verbo} ${n} ${nombre}`;

// Compara lo leído contra las piezas que trae la caja. Devuelve un aviso por
// tipo de pieza, o [] si el tablero cierra.
export function boardIssues(board) {
  const bag = bagOf(board.layout);
  const out = [];

  const check = (leidos, esperados, label, name) => {
    const partes = [];
    [...new Set([...Object.keys(leidos), ...Object.keys(esperados)])].forEach(k => {
      const d = (leidos[k] || 0) - (esperados[k] || 0);
      if (d > 0) partes.push(frase("sobra", d, label(k)));
      if (d < 0) partes.push(frase("falta", -d, label(k)));
    });
    if (partes.length) out.push(`${name}: ${partes.join(", ")}`);
  };

  check(countBy(board.hexes, "res"), bag.terrains,
    k => (k === "desierto" ? "desierto" : RM[k]?.n || k), "Terrenos");
  check(countBy(board.hexes, "num"), bag.numbers, k => `del ${k}`, "Fichas");

  const sinCargar = board.hexes.filter(h => !h.res).length;
  if (sinCargar) out.unshift(`${sinCargar} hexágono${sinCargar > 1 ? "s" : ""} sin reconocer`);
  return out;
}

/**
 * Arma un tablero con lo que devolvió el reconocimiento.
 * Lo que no se pudo leer queda vacío para completar a mano; nada se descarta
 * en silencio.
 */
export function boardFromRecognition(layout, recognized = [], seed = "FOTO") {
  const def = LAYOUTS[layout];
  if (!def) throw new Error(`layout desconocido: ${layout}`);
  const geo = geometry(layout);

  const byCell = new Map();
  recognized.forEach(h => {
    if (!h || typeof h.row !== "number" || typeof h.col !== "number") return;
    byCell.set(`${h.row},${h.col}`, h);
  });

  const confidence = {};
  const hexes = geo.hexes.map(g => {
    const read = byCell.get(`${g.row},${g.col}`);
    const res = read && Object.prototype.hasOwnProperty.call(def.terrains, read.res) ? read.res : null;
    const num = res && res !== "desierto" && def.numbers.includes(read?.num) ? read.num : null;
    if (read) confidence[g.id] = typeof read.confidence === "number" ? read.confidence : null;
    return { id: g.id, row: g.row, col: g.col, res, num };
  });

  const desert = hexes.find(h => h.res === "desierto");
  const board = {
    layout,
    difficulty: "foto",
    seed,
    source: "foto",
    hexes,
    ports: defaultPorts(layout),
    robber: desert ? desert.id : null,
  };
  return { board, confidence, issues: boardIssues(board) };
}

// Cambia un hexágono (corrección a mano sobre lo que salió de la foto).
export function patchHex(board, id, patch) {
  const hexes = board.hexes.map(h => (h.id === id ? { ...h, ...patch } : h));
  // El desierto no lleva ficha, y si el desierto se mudó, el ladrón se muda con él.
  const fixed = hexes.map(h => (h.res === "desierto" ? { ...h, num: null } : h));
  const desert = fixed.find(h => h.res === "desierto");
  return { ...board, hexes: fixed, robber: desert ? desert.id : board.robber };
}
