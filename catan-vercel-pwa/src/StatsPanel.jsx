// ═══════════════════════════════════════════════
//  PANEL DE ESTADÍSTICAS
//
//  Se muestra en vivo durante la partida (tab 📊) y de nuevo al terminar,
//  con el mismo componente: las estadísticas del final son las mismas de
//  siempre, congeladas.
//
//  Los colores identifican entidades, no rangos: cada jugador va con el color
//  de sus piezas y cada recurso con el suyo, así el gráfico se lee igual que
//  la mesa. Nunca se distingue solo por color — siempre hay emoji o nombre al
//  lado.
// ═══════════════════════════════════════════════
import { RES, COLORS, playerMark } from "./game/constants";

const INK = "#f0e6d3";           // tinta principal
const GOLD = "#d4a853";          // acento de la app
const GRID = "rgba(240,230,211,.14)";

// Las barras de producción van todas del mismo color a propósito.
// Los cinco recursos de Catán incluyen dos verdes (madera y oveja) y un
// amarillo lindante: pintados con sus colores de mesa quedan pares
// indistinguibles para daltonismo (ΔE < 3 en protanopia). Como cada barra ya
// lleva su emoji y su nombre al lado, la identidad no depende del color y las
// barras se dedican a lo único que comparan: la magnitud.

// Tile de un número suelto: cuando el dato es un titular, no un gráfico.
const Tile = ({ label, value, sub }) => (
  <div className="bg-slate-700/40 rounded-xl py-2 px-1 text-center">
    <div className="text-slate-400 text-[10px] uppercase tracking-wider">{label}</div>
    <div className="text-amber-300 text-xl font-black leading-tight">{value}</div>
    {sub ? <div className="text-muted text-[10px]">{sub}</div> : null}
  </div>
);

const veces = (n) => `${n} ${n === 1 ? "vez" : "veces"}`;

const Card = ({ title, right, children }) => (
  <div className="bg-slate-800 rounded-2xl p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-slate-300 font-semibold">{title}</h3>
      {right ? <span className="text-muted text-xs">{right}</span> : null}
    </div>
    {children}
  </div>
);

// ── Barra horizontal fina, con el extremo redondeado y el valor al lado ──
const Bar = ({ value, max, color, label, mark }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs w-5 text-center shrink-0">{mark}</span>
    <div className="flex-1 h-2.5 rounded-full bg-slate-700/50 overflow-hidden">
      <div style={{
        width: max > 0 ? `${Math.max(value > 0 ? 3 : 0, (value / max) * 100)}%` : 0,
        height: "100%", borderRadius: 4, background: color,
      }} />
    </div>
    <span className="text-slate-300 text-xs font-bold w-6 text-right tabular-nums shrink-0">{value}</span>
    {label ? <span className="text-muted text-[10px] w-14 shrink-0">{label}</span> : null}
  </div>
);

// ═══════════════════════════════════════════════
//  TIRADAS — cuántas veces salió cada número vs. lo esperado
// ═══════════════════════════════════════════════
export function DiceStats({ dice, round, history = [] }) {
  if (!dice || dice.total === 0) {
    return (
      <Card title="Tiradas" right={`Ronda ${round}`}>
        <p className="text-muted text-sm">Todavía no hay tiradas en esta partida.</p>
      </Card>
    );
  }
  const H = 56;
  const max = Math.max(1, ...dice.rows.map(r => Math.max(r.count, r.expected)));
  return (
    <Card title="Tiradas" right={`Ronda ${round} · ${dice.total} tirada${dice.total === 1 ? "" : "s"}`}>
      {history.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {history.slice(0, 12).map((n, i) => (
            <span key={i} className={`px-3 py-1 rounded-full text-sm font-bold ${i === 0 ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-200"}`}>
              {n}
            </span>
          ))}
        </div>
      )}

      {/* Barra = veces que salió. Línea punteada = veces esperadas según la
          probabilidad real de cada número. */}
      <div className="grid grid-cols-11 gap-1 items-end">
        {dice.rows.map(({ n, count, expected }) => (
          <div key={n} className="flex flex-col items-center gap-1">
            <div style={{ position: "relative", width: "100%", height: H }}
              title={`${n}: salió ${veces(count)} · esperado ${expected.toFixed(1)}`}>
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: Math.max(2, (count / max) * H), borderRadius: 4,
                background: n === 7 ? "#b94a3c" : count > expected ? GOLD : "#475569",
              }} />
              <div style={{
                position: "absolute", bottom: (expected / max) * H, left: -1, right: -1,
                borderTop: "1px dashed rgba(240,230,211,.5)",
              }} />
            </div>
            <span className="text-[10px] text-slate-400">{n}</span>
            <span className="text-[9px] text-muted">{count}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 mt-4">
        <Tile label="Más salió" value={dice.hot ? dice.hot.n : "—"} sub={dice.hot ? veces(dice.hot.count) : ""} />
        <Tile label="Menos salió" value={dice.cold ? dice.cold.n : "—"} sub={dice.cold ? veces(dice.cold.count) : ""} />
        <Tile label="Sietes" value={dice.sevens} sub="ladrón" />
        <Tile label="Sin 7 hace" value={dice.since7 === null ? "—" : dice.since7}
          sub={dice.since7 === null ? "todavía ninguno" : "tiradas"} />
      </div>
      <p className="text-muted text-xs mt-3">
        La línea punteada es lo esperado por probabilidad (6 y 8 son los más probables). Ojo: los dados no tienen
        memoria — que un número venga frío no lo hace más probable en la próxima.
      </p>
    </Card>
  );
}

// ═══════════════════════════════════════════════
//  CARRERA DE PUNTOS — cómo evolucionó el puntaje ronda a ronda
// ═══════════════════════════════════════════════
function ScoreRace({ timeline, players, finalScores, winningScore }) {
  // Con una sola ronda todavía no hay evolución que mostrar: el gráfico
  // aparece cuando hay al menos dos puntos.
  if (!timeline || timeline.length < 2 || players.length === 0) return null;

  const W = 320, H = 130, PL = 22, PR = 34, PT = 10, PB = 18;
  const rounds = timeline.map(t => t.round);
  const minR = rounds[0], maxR = rounds[rounds.length - 1];
  const top = Math.max(winningScore, ...timeline.flatMap(t => t.scores));
  const x = (r) => PL + (maxR === minR ? 0 : ((r - minR) / (maxR - minR)) * (W - PL - PR));
  const y = (v) => PT + (1 - v / top) * (H - PT - PB);

  // Etiquetas del eje Y: 0, la mitad y la meta.
  const yTicks = [0, Math.round(top / 2), top];

  return (
    <Card title="Carrera de puntos" right={`Ronda ${minR}–${maxR}`}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
        role="img" aria-label="Evolución del puntaje de cada jugador por ronda">
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1"
              vectorEffect="non-scaling-stroke" />
            <text x={PL - 5} y={y(v) + 3} textAnchor="end" fontSize="8" fill="rgba(240,230,211,.45)">{v}</text>
          </g>
        ))}
        {/* Meta: la línea que hay que cruzar para ganar */}
        <line x1={PL} x2={W - PR} y1={y(winningScore)} y2={y(winningScore)}
          stroke={GOLD} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <text x={W - PR + 3} y={y(winningScore) + 3} fontSize="7" fill={GOLD}>meta</text>

        <text x={PL} y={H - 5} fontSize="8" fill="rgba(240,230,211,.45)">R{minR}</text>
        <text x={W - PR} y={H - 5} textAnchor="end" fontSize="8" fill="rgba(240,230,211,.45)">R{maxR}</text>

        {/* Empates: los puntajes iguales caen en la misma altura y las etiquetas
            se taparían entre sí. Se separan verticalmente lo mínimo para que se
            lean las tres; el valor sigue siendo el real. */}
        {(() => {
          const lanes = players
            .map((p, pi) => ({ pi, p, v: finalScores[pi] }))
            .sort((a, b) => b.v - a.v);
          const labelY = {};
          let floor = -Infinity;
          lanes.forEach(({ pi, v }) => {
            const want = y(v);
            const placed = Math.max(want, floor + 9);
            labelY[pi] = placed;
            floor = placed;
          });
          return players.map((p, pi) => {
            const color = COLORS[p.ci]?.h || INK;
            const pts = timeline.map(t => ({ r: t.round, v: t.scores[pi] ?? 0 }));
            const d = pts.map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.r).toFixed(1)},${y(pt.v).toFixed(1)}`).join(" ");
            const last = pts[pts.length - 1];
            return (
              <g key={pi}>
                <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {/* Anillo del color de la superficie: separa las líneas cuando se cruzan */}
                <circle cx={x(last.r)} cy={y(last.v)} r="3.5" fill={color} stroke="#1e293b" strokeWidth="1.5" />
                {/* Guía al valor cuando la etiqueta se corrió por un empate: la
                    identidad la lleva la guía, el número queda en tinta. */}
                {Math.abs(labelY[pi] - y(last.v)) > 1 && (
                  <path d={`M${x(last.r) + 3.5},${y(last.v)} L${x(last.r) + 5},${labelY[pi]}`}
                    stroke={color} strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke" />
                )}
                <text x={x(last.r) + 7} y={labelY[pi] + 3} fontSize="9" fontWeight="700" fill={INK}>
                  {finalScores[pi]}
                </text>
                <title>{`${p.name}: ${finalScores[pi]} puntos`}</title>
              </g>
            );
          });
        })()}
      </svg>

      {/* Leyenda: la identidad nunca queda solo en el color */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {players.map((p, pi) => (
          <span key={pi} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[p.ci]?.h }} />
            {playerMark(p.ci)} {p.name}
          </span>
        ))}
      </div>
      <p className="text-muted text-[11px] mt-2">
        Incluye cartas de punto de victoria y los +2 de camino más largo / ejército más grande, así que puede
        subir sin que se construya nada.
      </p>
    </Card>
  );
}

// ═══════════════════════════════════════════════
//  PRODUCCIÓN — qué cobró cada jugador, por recurso
// ═══════════════════════════════════════════════
function Production({ stats, players }) {
  const max = Math.max(1, ...stats.flatMap(s => RES.map(r => s.produced[r.id] || 0)));
  const anything = stats.some(s => s.producedTotal > 0);
  if (!anything) {
    return (
      <Card title="Producción">
        <p className="text-muted text-sm">Cuando empiecen a salir números se llena solo.</p>
      </Card>
    );
  }
  return (
    <Card title="Producción" right="recursos cobrados en tiradas">
      <div className="space-y-4">
        {players.map((p, pi) => {
          const s = stats[pi];
          return (
            <div key={pi}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-bold flex items-center gap-1.5" style={{ color: COLORS[p.ci]?.h }}>
                  {playerMark(p.ci)} <span className="text-slate-200">{p.name}</span>
                </span>
                <span className="text-slate-400 text-xs">
                  {s.producedTotal} cartas
                  {s.blocked > 0 && <span className="text-red-400"> · −{s.blocked} por el ladrón</span>}
                </span>
              </div>
              {/* Escala compartida entre jugadores: las barras se comparan entre sí */}
              <div className="space-y-1">
                {RES.map(r => (
                  <Bar key={r.id} mark={r.e} value={s.produced[r.id] || 0} max={max}
                    color={GOLD} label={r.n} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}


// ═══════════════════════════════════════════════
//  RANKING FINAL — cómo cerró la partida y de dónde salió cada punto
//
//  El total lo manda `finalScores` (la misma cuenta que decide el ganador);
//  las columnas lo desarman en sus fuentes, así se ve por qué ganó quien ganó
//  y no solo el número.
// ═══════════════════════════════════════════════
const MEDALS = ["🥇", "🥈", "🥉"];

function Ranking({ stats, players, finalScores, scoreOrder, longestRoad, largestArmy }) {
  const order = scoreOrder && scoreOrder.length === players.length
    ? scoreOrder
    : players.map((_, i) => i).sort((a, b) => finalScores[b] - finalScores[a]);

  return (
    <Card title="Cómo cerró la partida" right="de dónde salió cada punto">
      <div className="space-y-2">
        {order.map((i, pos) => {
          const p = players[i];
          const s = stats[i];
          const vpCards = p.devCards.filter(c => c === "victoria").length;
          // Las fuentes de puntos, en el orden en que suman.
          const parts = [
            { n: s.settlementsNow, pts: s.settlementsNow, e: "🏠", label: "poblados" },
            { n: s.citiesNow, pts: s.citiesNow * 2, e: "🏙️", label: "ciudades" },
            { n: vpCards, pts: vpCards, e: "🏆", label: "cartas de punto" },
            { n: longestRoad === i ? 1 : 0, pts: 2, e: "🛤️", label: "camino más largo", title: true },
            { n: largestArmy === i ? 1 : 0, pts: 2, e: "⚔️", label: "ejército más grande", title: true },
          ].filter(x => x.n > 0);

          return (
            <div key={i} className={`rounded-2xl p-3 ${pos === 0 ? "bg-amber-500/10 ring-1 ring-amber-500/40" : "bg-slate-700/30"}`}>
              <div className="flex items-center gap-2.5">
                <span className="text-lg w-6 text-center" aria-hidden="true">{MEDALS[pos] || pos + 1}</span>
                <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: COLORS[p.ci]?.h }} />
                <span className="flex-1 min-w-0 text-slate-100 font-bold truncate" title={p.name}>{p.name}</span>
                <span className="text-amber-300 text-2xl font-black tabular-nums leading-none">{finalScores[i]}</span>
                <span className="text-muted text-[10px] uppercase">pts</span>
              </div>

              {/* Desglose: cada fuente con cuántos puntos aportó */}
              <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                {parts.length === 0 ? (
                  <span className="text-muted text-xs">Sin puntos cargados</span>
                ) : parts.map(x => (
                  <span key={x.label} title={`${x.label}: ${x.pts} ${x.pts === 1 ? "punto" : "puntos"}`}
                    className="text-[11px] bg-slate-800/80 text-slate-300 rounded-lg px-2 py-1 whitespace-nowrap">
                    {/* Los títulos son uno solo: se nombran; el resto se cuenta. */}
                    {x.e} {x.title ? x.label : x.n}{" "}
                    <span className="text-slate-100 font-bold">+{x.pts}</span>
                  </span>
                ))}
              </div>

              {/* Lo que no da puntos pero explica la partida */}
              <div className="text-muted text-[11px] mt-1.5 ml-8">
                🛤️ {s.roads} camino{s.roads === 1 ? "" : "s"} · ⚔️ {s.knights} caballero{s.knights === 1 ? "" : "s"} jugado{s.knights === 1 ? "" : "s"} · 🃏 {s.devBought} carta{s.devBought === 1 ? "" : "s"} comprada{s.devBought === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════
//  TABLA POR JUGADOR — el detalle, en números
// ═══════════════════════════════════════════════
function PlayerTable({ stats, players, finalScores, scoreOrder, longestRoad, largestArmy }) {
  const ROWS = [
    { k: "Puntos", get: (s, i) => finalScores[i], strong: true },
    { k: "🏠 Poblados", get: s => s.settlementsNow },
    { k: "🏙️ Ciudades", get: s => s.citiesNow },
    { k: "🛤️ Caminos", get: s => s.roads },
    { k: "🎲 Dados", get: s => s.pips, help: true },
    { k: "📦 Producido", get: s => s.producedTotal },
    { k: "⛔ Bloqueado", get: s => s.blocked },
    { k: "🃏 Cartas compradas", get: s => s.devBought },
    { k: "⚔️ Caballeros", get: s => s.knights },
    { k: "🔄 Con el banco", get: s => s.tradesBank },
    { k: "🤝 Con jugadores", get: s => s.tradesPlayer },
    { k: "🦹 Le robaron", get: s => s.robbedByOthers },
    { k: "🗑️ Descartó", get: s => s.discarded },
    { k: "✋ En mano", get: s => s.handSize },
  ];
  const order = scoreOrder && scoreOrder.length === players.length
    ? scoreOrder
    : players.map((_, i) => i);

  return (
    <Card title="Detalle por jugador">
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left text-muted text-[10px] uppercase tracking-wider font-medium pb-2 pr-2 sticky left-0 bg-slate-800">
                &nbsp;
              </th>
              {order.map(i => (
                <th key={i} className="pb-2 px-1 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="w-3 h-3 rounded-full" style={{ background: COLORS[players[i].ci]?.h }} />
                    <span className="text-slate-300 text-[11px] font-bold max-w-[64px] truncate"
                      title={players[i].name}>{players[i].name}</span>
                    <span className="flex gap-0.5 text-[9px]">
                      {longestRoad === i && <span title="Camino más largo">🛤️</span>}
                      {largestArmy === i && <span title="Ejército más grande">⚔️</span>}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => (
              <tr key={row.k} className="border-t border-slate-700/40">
                <td className={`py-1.5 pr-2 text-[11px] whitespace-nowrap sticky left-0 bg-slate-800 ${row.strong ? "text-slate-200 font-bold" : "text-slate-400"}`}>
                  {row.k}
                </td>
                {(() => {
                  const best = Math.max(...order.map(j => row.get(stats[j], j)));
                  return order.map(i => {
                  const v = row.get(stats[i], i);
                  return (
                    <td key={i} className={`py-1.5 px-1 text-center tabular-nums ${row.strong
                      ? "text-amber-300 text-lg font-black"
                      : v === best && v > 0 ? "text-slate-100 font-bold" : "text-slate-400"}`}>
                      {v}
                    </td>
                  );
                  });
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted text-[11px] mt-3">
        <strong className="text-slate-400">🎲 Dados</strong> son los puntos de probabilidad de tus hexágonos
        (un 6 vale 5, un 2 vale 1; las ciudades cuentan doble): cuánta producción esperás por tirada.
        Los caminos son los que se cargaron en la app, no los del tablero.
      </p>
    </Card>
  );
}

// ═══════════════════════════════════════════════
//  PANEL COMPLETO
// ═══════════════════════════════════════════════
export default function StatsPanel({
  stats, players, finalScores, scoreOrder, longestRoad, largestArmy,
  diceHistory = [], winningScore = 10, showDice = true,
}) {
  if (!stats || players.length === 0) return null;

  const ps = stats.players;
  const leader = scoreOrder && scoreOrder.length ? scoreOrder[0] : 0;
  const topProducer = ps.reduce((best, s, i) => (s.producedTotal > ps[best].producedTotal ? i : best), 0);
  const totalProduced = ps.reduce((a, s) => a + s.producedTotal, 0);

  return (
    <div className="space-y-4">
      {/* Titulares: los números que se miran de un vistazo */}
      <div className="grid grid-cols-4 gap-2">
        <Tile label="Líder" value={finalScores[leader]} sub={players[leader]?.name} />
        <Tile label="Ronda" value={stats.round ?? "—"} sub={`${stats.rollCount ?? 0} tiradas`} />
        <Tile label="Producido" value={totalProduced} sub="en la mesa" />
        <Tile label="Más produjo" value={ps[topProducer].producedTotal} sub={players[topProducer]?.name} />
      </div>

      <Ranking stats={ps} players={players} finalScores={finalScores}
        scoreOrder={scoreOrder} longestRoad={longestRoad} largestArmy={largestArmy} />

      <ScoreRace timeline={stats.timeline} players={players} finalScores={finalScores}
        winningScore={winningScore} />

      <PlayerTable stats={ps} players={players} finalScores={finalScores}
        scoreOrder={scoreOrder} longestRoad={longestRoad} largestArmy={largestArmy} />

      <Production stats={ps} players={players} />

      {showDice && <DiceStats dice={stats.dice} round={stats.round} history={diceHistory} />}
    </div>
  );
}
