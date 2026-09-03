// Cargar el tablero sacando una foto.
//
// El reconocimiento es un borrador: se muestra sobre el mapa, con los hexágonos
// de poca confianza marcados, y no se puede usar hasta que el tablero cierre
// (las piezas de la caja) y el usuario confirme.
import { useState } from "react";
import { LAYOUTS } from "./geometry.js";
import { preparePhoto, readBoardPhoto, boardFromRecognition, boardIssues, patchHex } from "./photo.js";
import { RES, RM, NUMS, dotStr } from "../game/constants.js";
import BoardSvg from "./BoardSvg";

const DUDOSO = 0.6; // por debajo de esto, el hexágono se marca para revisar

export default function PhotoBoard({ layout, onUse, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [board, setBoard] = useState(null);
  const [confidence, setConfidence] = useState({});
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(null); // hexágono abierto para corregir

  const issues = board ? boardIssues(board) : [];
  const dudosos = board
    ? board.hexes.filter(h => !h.res || (confidence[h.id] ?? 1) < DUDOSO).map(h => h.id)
    : [];

  const takePhoto = async (file) => {
    if (!file) return;
    setError(""); setBusy(true); setEditing(null);
    try {
      const photo = await preparePhoto(file);
      setPreview(photo.preview);
      const read = await readBoardPhoto({ image: photo.image, mediaType: photo.mediaType, layout });
      const r = boardFromRecognition(layout, read.hexes);
      setBoard(r.board);
      setConfidence(r.confidence);
      setNotes(read.notes || "");
      // Lo primero que conviene revisar es lo que el modelo leyó con dudas.
      const primero = r.board.hexes.find(h => !h.res || (r.confidence[h.id] ?? 1) < DUDOSO);
      setEditing(primero ? primero.id : null);
    } catch (e) {
      setError(e.message || "No se pudo leer la foto.");
    }
    setBusy(false);
  };

  const hex = board && editing !== null ? board.hexes.find(h => h.id === editing) : null;
  const setHex = patch => {
    setBoard(b => patchHex(b, editing, patch));
    setConfidence(c => ({ ...c, [editing]: 1 })); // corregido a mano: ya no es dudoso
  };

  return (
    <div className="catan-app">
      <div className="catan-container p-4 max-w-md mx-auto space-y-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-amber-400">Tablero por foto</h2>
          <p className="text-muted text-xs">
            Sacale una foto de frente al tablero {LAYOUTS[layout].name.toLowerCase()} y corregí lo que haga falta.
          </p>
        </div>

        {!board && (
          <label className={`block w-full p-6 rounded-2xl border-2 border-dashed text-center transition-all ${busy ? "border-slate-700 bg-slate-800/40" : "border-amber-500/60 bg-amber-500/10 cursor-pointer"}`}>
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
              onChange={e => takePhoto(e.target.files?.[0])} />
            <div className="text-4xl mb-2">{busy ? "⏳" : "📷"}</div>
            <div className="font-bold text-amber-300">{busy ? "Leyendo el tablero..." : "Sacar o elegir una foto"}</div>
            <div className="text-slate-400 text-xs mt-1">
              {busy ? "Puede tardar unos segundos." : "De frente, con el tablero entero y buena luz."}
            </div>
          </label>
        )}

        {error && (
          <div className="bg-red-500/15 border border-red-500/40 rounded-2xl p-3 text-red-200 text-sm">{error}</div>
        )}

        {preview && !board && (
          <img src={preview} alt="Foto del tablero" className="w-full rounded-2xl opacity-60" />
        )}

        {board && (
          <>
            <BoardSvg board={board} className="w-full rounded-2xl shadow-2xl"
              onHex={h => setEditing(h.id)} highlight={dudosos} />

            {notes && <p className="text-muted text-xs text-center">📝 {notes}</p>}

            {dudosos.length > 0 && (
              <p className="text-amber-400 text-xs text-center">
                {dudosos.length} hexágono{dudosos.length > 1 ? "s" : ""} para revisar (marcados en el mapa). Tocá cualquiera para corregirlo.
              </p>
            )}

            {hex && (
              <div className="bg-slate-900/80 rounded-2xl p-3 border border-amber-600/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-amber-300 font-bold text-sm">Hexágono {hex.row + 1}·{hex.col + 1}</span>
                  <button onClick={() => setEditing(null)} className="text-slate-400 text-xs">Cerrar</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[...RES, { id: "desierto", n: "Desierto", e: "🏜️" }].map(r => (
                    <button key={r.id} onClick={() => setHex({ res: r.id })}
                      className={`px-2 py-1 rounded-lg text-xs font-medium border ${hex.res === r.id ? "border-amber-400 bg-amber-500/20 text-amber-200" : "border-slate-700 bg-slate-800 text-slate-300"}`}>
                      {r.e} {r.n}
                    </button>
                  ))}
                </div>
                {hex.res !== "desierto" && (
                  <div className="flex flex-wrap gap-1">
                    {NUMS.map(n => (
                      <button key={n} onClick={() => setHex({ num: n })}
                        className={`px-2 py-1 rounded-lg text-xs font-bold border ${hex.num === n ? "border-amber-400 bg-amber-500/20 text-amber-200" : "border-slate-700 bg-slate-800 text-slate-300"}`}>
                        {n} <span className="text-[9px]">{dotStr(n)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {issues.length > 0 ? (
              <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-3 space-y-1">
                <p className="text-amber-300 font-bold text-sm">Todavía no cierra con las piezas de la caja</p>
                {issues.map((t, i) => <p key={i} className="text-slate-300 text-xs">• {t}</p>)}
              </div>
            ) : (
              <p className="text-emerald-400 text-xs text-center">✓ El tablero cierra con las piezas de la caja.</p>
            )}

            <button onClick={() => onUse(board)} disabled={issues.length > 0}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-lg transition-all shadow-lg shadow-amber-500/20">
              Usar este tablero
            </button>
            <button onClick={() => { setBoard(null); setPreview(null); setNotes(""); setEditing(null); }}
              className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm font-semibold">
              📷 Sacar otra foto
            </button>
          </>
        )}

        <button onClick={onCancel} className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm font-semibold">
          ← Volver
        </button>
      </div>
    </div>
  );
}
