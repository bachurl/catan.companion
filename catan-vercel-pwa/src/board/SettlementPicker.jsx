// Carga de poblados tocando el tablero.
//
// Con un mapa cargado no hace falta tipear número + recurso hexágono por
// hexágono: se toca la esquina donde va el poblado y la app deduce lo que
// produce. Los selects manuales siguen disponibles como respaldo (por ejemplo
// si el tablero de la mesa no coincide con el mapa).
import { useState } from "react";
import { hexesForVertex, portForVertex } from "./geometry";
import { RM } from "../game/constants";
import BoardSvg from "./BoardSvg";
import HexSelect from "./HexSelect";

const emptySett = () => ({ hexes: [{ num: "", res: "" }] });

export default function SettlementPicker({ board, settlements, onChange, color, otherMarks = [] }) {
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);
  const [aviso, setAviso] = useState("");

  const marks = settlements
    .map((s, i) => (s.vertex ? { vertex: s.vertex, color, i } : null))
    .filter(Boolean);

  const pickVertex = vertexId => {
    const ocupadoPropio = settlements.findIndex((s, i) => s.vertex === vertexId && i !== active);
    if (ocupadoPropio >= 0) return setAviso(`Ese lugar ya es tu poblado ${ocupadoPropio + 1}.`);
    if (otherMarks.some(m => m.vertex === vertexId)) return setAviso("Ahí ya hay un poblado de otro jugador.");
    const hexes = hexesForVertex(board, vertexId);
    if (!hexes.length) return setAviso("Esa esquina no produce nada (todo desierto o agua).");
    setAviso("");
    const next = settlements.map((s, i) => (i === active ? { vertex: vertexId, hexes } : s));
    onChange(next);
    // Después del primero, pasa solo al que falte cargar.
    const siguiente = next.findIndex(s => !s.vertex);
    if (siguiente >= 0) setActive(siguiente);
  };

  const clear = i => {
    setAviso("");
    onChange(settlements.map((s, j) => (i === j ? emptySett() : s)));
    setActive(i);
  };

  if (manual) {
    return (
      <div>
        {settlements.map((sett, si) => (
          <div key={si} className="mb-4 bg-slate-800/50 rounded-2xl p-3">
            <h3 className="text-slate-300 font-semibold text-sm mb-2">🏠 Poblado {si + 1}</h3>
            <div className="space-y-2">
              {(sett.hexes || []).map((hex, hi) => (
                <HexSelect key={hi} board={board} hex={hex} label={`del hexágono ${hi + 1} del poblado ${si + 1}`}
                  onChange={patch => onChange(settlements.map((s, j) => j !== si ? s : ({
                    ...s,
                    vertex: null, // cargado a mano: ya no corresponde a una esquina del mapa
                    hexes: s.hexes.map((h, k) => (k === hi ? { ...h, ...patch } : h)),
                  })))}
                  onRemove={sett.hexes.length > 1 ? () => onChange(settlements.map((s, j) => j !== si ? s : ({
                    ...s, vertex: null, hexes: s.hexes.filter((_, k) => k !== hi),
                  }))) : null} />
              ))}
            </div>
            {(sett.hexes?.length || 0) < 3 && (
              <button onClick={() => onChange(settlements.map((s, j) => j !== si ? s : ({
                ...s, hexes: [...s.hexes, { num: "", res: "" }],
              })))} className="mt-2 text-sm text-amber-400 hover:text-amber-300">+ Agregar hexágono</button>
            )}
          </div>
        ))}
        <button onClick={() => setManual(false)}
          className="text-sm text-amber-400 hover:text-amber-300">🗺️ Volver a elegir en el mapa</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-slate-400 text-sm">
        Tocá en el mapa la esquina donde pusiste el <b className="text-amber-300">poblado {active + 1}</b>.
      </p>
      <BoardSvg board={board} className="w-full rounded-2xl" onVertex={pickVertex}
        marks={[...otherMarks, ...marks]} />
      {aviso && <p className="text-amber-400 text-xs text-center">{aviso}</p>}

      {settlements.map((sett, si) => {
        const puerto = sett.vertex ? portForVertex(board, sett.vertex) : null;
        return (
          <button key={si} onClick={() => { setActive(si); setAviso(""); }}
            className={`w-full text-left p-3 rounded-2xl border-2 transition-all ${active === si ? "border-amber-500 bg-amber-500/15" : "border-slate-700 bg-slate-800/60"}`}>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-300 text-sm">🏠 Poblado {si + 1}</span>
              {sett.vertex ? (
                <span className="flex flex-wrap gap-1 flex-1">
                  {sett.hexes.map((h, i) => (
                    <span key={i} className={`${RM[h.res]?.bg} ${RM[h.res]?.tx} px-2 py-0.5 rounded-full text-xs font-medium`}>
                      {RM[h.res]?.e} {h.num}
                    </span>
                  ))}
                  {puerto && (
                    <span className="bg-slate-700 text-amber-300 px-2 py-0.5 rounded-full text-xs font-medium">
                      ⚓ {puerto.type === "3:1" ? "3:1" : `${RM[puerto.type]?.e} 2:1`}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-400 text-xs flex-1">Sin cargar</span>
              )}
              {sett.vertex && (
                <span onClick={e => { e.stopPropagation(); clear(si); }}
                  className="text-red-400 hover:text-red-300 px-2 text-sm">✕</span>
              )}
            </div>
          </button>
        );
      })}

      <button onClick={() => setManual(true)}
        className="text-xs text-slate-400 hover:text-slate-200">
        ¿El tablero no coincide? Cargar a mano
      </button>
    </div>
  );
}
