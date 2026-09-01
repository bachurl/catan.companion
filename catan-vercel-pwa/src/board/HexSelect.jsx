// Selector de un hexágono adyacente a un poblado: número + recurso.
//
// Sin mapa cargado se comporta como siempre (todos los números y todos los
// recursos). Con un mapa generado, en cambio, la app ya sabe qué hay en el
// tablero: al elegir el número ofrece solo los recursos que ese número tiene,
// y si hay uno solo lo completa sin preguntar.
import { RES, RM, NUMS, dotStr } from "../game/constants";
import { boardNumbers, resourcesForNumber } from "./geometry";

const SELECT = "bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-amber-500 focus:outline-none";

export default function HexSelect({ board, hex, onChange, onRemove, label }) {
  const nums = board ? boardNumbers(board) : NUMS;
  const options = board ? resourcesForNumber(board, hex.num) : null;
  // Con mapa y sin número elegido todavía no hay nada que ofrecer: primero el
  // número, que es lo que el jugador ve en la ficha.
  const resList = options
    ? options.map(o => ({ ...RM[o.res], id: o.res, count: o.count }))
    : RES.map(r => ({ ...r, count: null }));

  const pickNumber = num => {
    if (!board) return onChange({ num });
    const opts = resourcesForNumber(board, num);
    // Un solo recurso con ese número: se completa solo. Si el recurso que
    // estaba puesto no existe para el número nuevo, se limpia.
    if (opts.length === 1) return onChange({ num, res: opts[0].res });
    if (!opts.some(o => o.res === hex.res)) return onChange({ num, res: "" });
    onChange({ num });
  };

  const soloUno = Boolean(board) && resList.length === 1 && hex.num;

  return (
    <div className="flex items-center gap-2">
      <select value={hex.num} aria-label={`Número ${label}`} className={SELECT}
        onChange={e => pickNumber(e.target.value)}>
        <option value="">Nro</option>
        {nums.map(n => <option key={n} value={n}>{n} {dotStr(n)}</option>)}
      </select>
      <select value={hex.res} aria-label={`Recurso ${label}`} className={`flex-1 min-w-0 ${SELECT}`}
        disabled={soloUno} onChange={e => onChange({ res: e.target.value })}>
        <option value="">{board && !hex.num ? "Elegí el número" : "Recurso"}</option>
        {resList.map(r => (
          <option key={r.id} value={r.id}>
            {r.e} {r.n}{r.count > 1 ? ` (×${r.count})` : ""}
          </option>
        ))}
      </select>
      {onRemove && <button onClick={onRemove} className="text-red-400 hover:text-red-300 px-2">✕</button>}
    </div>
  );
}
