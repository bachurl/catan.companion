// Merge del log canónico del servidor con acciones locales que todavía no
// llegaron a la base (inserts en vuelo o en cola offline). El orden canónico
// manda; las locales pendientes van al final (eran las últimas acá también).
// Es una función pura para poder testearla sin Supabase.
export const mergeWithLocal = (serverActions, localExtras) => {
  const have = new Set(serverActions.map(a => a.uid));
  const extras = [];
  for (const a of localExtras) {
    if (!a?.uid || have.has(a.uid)) continue;
    have.add(a.uid); // dedupe también entre extras (en vuelo + cola)
    extras.push(a);
  }
  return [...serverActions, ...extras];
};
