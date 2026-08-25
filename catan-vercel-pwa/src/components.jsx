import { RM } from "./game/constants";

// Dice face SVG
export const DiceFace = ({ value, rolling }) => {
  const dots = {
    1: [[50,50]], 2: [[25,25],[75,75]], 3: [[25,25],[50,50],[75,75]],
    4: [[25,25],[75,25],[25,75],[75,75]], 5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
    6: [[25,20],[75,20],[25,50],[75,50],[25,80],[75,80]],
  };
  return (
    <div className={`w-16 h-16 bg-white rounded-xl shadow-lg flex items-center justify-center ${rolling ? "animate-bounce" : ""}`}>
      <svg viewBox="0 0 100 100" className="w-12 h-12">
        {(dots[value] || []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={10} fill="#1e293b" />
        ))}
      </svg>
    </div>
  );
};

// Resource badge
export const ResBadge = ({ id, count, small }) => {
  const r = RM[id];
  if (!r) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${r.bg} ${r.tx} ${small ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"} rounded-full font-medium`}>
      {r.e} {count !== undefined && <span>{count}</span>}
    </span>
  );
};
