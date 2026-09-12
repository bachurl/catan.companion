// Dibuja un tablero. SVG puro, sin dependencias: sirve para previsualizar un
// mapa generado y para mostrar el mapa de la partida en curso.
import { geometry, R, isRed } from "./geometry";
import { RM, dotStr } from "../game/constants";

const FILL = {
  madera: "#166534", ladrillo: "#b45309", trigo: "#ca8a04",
  oveja: "#65a30d", mineral: "#57534e", desierto: "#a8a29e",
};

const hexPath = (cx, cy) =>
  [0, 1, 2, 3, 4, 5].map(i => {
    const a = (Math.PI / 180) * (90 + 60 * i);
    return `${(cx + R * Math.cos(a)).toFixed(3)},${(cy - R * Math.sin(a)).toFixed(3)}`;
  }).join(" ");

/**
 * @param {object[]} [marks] — poblados a dibujar: { vertex, color, city }
 * @param {(vertexId: string) => void} [onVertex] — hace tocables los vértices
 */
export default function BoardSvg({ board, className = "", onHex, onVertex, marks = [], highlight = [] }) {
  if (!board) return null;
  const geo = geometry(board.layout);
  const marcados = new Set(highlight);
  const pad = 1.05;
  const w = geo.width + pad * 2, h = geo.height + pad * 2;

  return (
    <svg viewBox={`${-pad} ${-pad} ${w} ${h}`} className={className} role="img"
      aria-label={`Tablero ${geo.layout.name} de ${board.hexes.length} hexágonos`}>
      <rect x={-pad} y={-pad} width={w} height={h} fill="#0c4a6e" rx="0.4" />

      {board.hexes.map(hx => {
        const g = geo.hexes[hx.id];
        const blocked = board.robber === hx.id;
        return (
          <g key={hx.id} onClick={onHex ? () => onHex(hx) : undefined}
            style={onHex ? { cursor: "pointer" } : undefined}>
            <polygon points={hexPath(g.cx, g.cy)} fill={FILL[hx.res] || "#334155"}
              stroke={marcados.has(hx.id) ? "#fbbf24" : "#0f172a"}
              strokeWidth={marcados.has(hx.id) ? "0.09" : "0.04"}
              strokeDasharray={marcados.has(hx.id) ? "0.12 0.08" : undefined} />
            {hx.num && (
              <>
                <circle cx={g.cx} cy={g.cy} r={0.36} fill="#fef3c7" />
                <text x={g.cx} y={g.cy - 0.05} textAnchor="middle" dominantBaseline="central"
                  fontSize="0.42" fontWeight="bold" fill={isRed(hx.num) ? "#b91c1c" : "#292524"}>
                  {hx.num}
                </text>
                <text x={g.cx} y={g.cy + 0.24} textAnchor="middle" dominantBaseline="central"
                  fontSize="0.2" fill={isRed(hx.num) ? "#b91c1c" : "#292524"}>
                  {dotStr(hx.num)}
                </text>
              </>
            )}
            {blocked && (
              <text x={g.cx} y={g.cy} textAnchor="middle" dominantBaseline="central" fontSize="0.6">🥷</text>
            )}
          </g>
        );
      })}
      {board.ports.map((p, i) => (
        <g key={`p${i}`}>
          <circle cx={p.x} cy={p.y} r={0.3} fill="#0f172a" stroke="#fbbf24" strokeWidth="0.05" />
          <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
            fontSize={p.type === "3:1" ? 0.24 : 0.3} fill="#fbbf24" fontWeight="bold">
            {p.type === "3:1" ? "3:1" : RM[p.type]?.e}
          </text>
        </g>
      ))}

      {onVertex && geo.vertices.map(v => (
        <circle key={v.id} cx={v.x} cy={v.y} r={0.28} fill="transparent"
          style={{ cursor: "pointer" }} onClick={() => onVertex(v.id)}>
          <title>Vértice</title>
        </circle>
      ))}

      {marks.map(m => (
        <g key={m.vertex} pointerEvents="none">
          <circle cx={geo.vertexById[m.vertex]?.x} cy={geo.vertexById[m.vertex]?.y}
            r={0.2} fill={m.color} stroke="#0f172a" strokeWidth="0.06" />
          {m.city && (
            <circle cx={geo.vertexById[m.vertex]?.x} cy={geo.vertexById[m.vertex]?.y}
              r={0.09} fill="#0f172a" />
          )}
        </g>
      ))}
    </svg>
  );
}
