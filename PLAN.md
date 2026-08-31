# Plan de mejoras — Catán Companion

Objetivo: llevar la app a producción con soporte de acciones **online y offline**,
**multijugador** y **multidispositivo**.

## Arquitectura clave: log de acciones (event sourcing)

Cada jugada es una acción (`ROLL`, `BUILD_ROAD`, `END_TURN`, ...) aplicada por un
reducer puro. El estado del juego = replay del log. La aleatoriedad (dados, mazo)
viaja resuelta dentro de la acción, así el replay es determinístico.

Esto habilita con una sola pieza:

- **Persistencia**: guardar el log en localStorage → al reabrir, replay y la partida sigue.
- **Deshacer**: sacar la última acción y replay.
- **Offline**: las acciones se aplican local siempre, sin esperar red.
- **Online multidispositivo**: la acción se inserta en Supabase (secuencia por sala =
  orden canónico) y Realtime la broadcastea; los demás dispositivos la aplican.
  Cola offline con replay al reconectar.

## Fase A — Base técnica + jugabilidad offline

- [x] **A1** Refactor a `useReducer` + log de acciones; split del monolito en módulos. Sin cambios visuales.
- [x] **A2** Autosave en localStorage + pantalla "Continuar partida" al abrir.
- [x] **A3** Botón **Deshacer** (última acción, con confirmación).
- [x] **A4** Hardening PWA: cache del SW versionado por build, banner "nueva versión disponible", error boundary con recuperación de partida.
- [x] **A5** Wake lock (la pantalla no se apaga en partida) + vibración al tirar dados.

## Fase B — Multijugador online (Supabase)

- [x] **B1** Proyecto Supabase, auth anónima, tablas `rooms` + `actions` con RLS y secuencia por sala.
- [x] **B2** Crear sala / unirse con código corto + QR; lobby con presencia.
- [x] **B3** Sync de acciones: local → Supabase → Realtime → todos. Cola offline, indicador online/offline.
- [x] **B4** Vista por jugador: cada celular reclama un jugador, ve su mano, sus cartas de desarrollo y el aviso de su turno.
- [x] **B5** Gating por turno: con jugador reclamado solo se actúa en el turno propio (ingresar/tirar dados, construir, comerciar, jugar cartas, terminar turno). El host puede corregir siempre (ajustes manuales, deshacer, reordenar); un celular sin jugador reclamado controla la mesa completa (fallback si se apaga un teléfono).
- [x] **B6** UX multi-celular: botón grande "Terminar mi turno", vibración + aviso al empezar tu turno, teclado de dados manual recordado (para dados físicos), compartir código de sala con link `?sala=CODIGO` que precarga el código.
- [x] **B7** Lobby online: la sala se crea apenas el host elige modo y cantidad (código compartible al instante); cada jugador se une, reclama su asiento, pone nombre/color y carga sus propios poblados iniciales desde su celular; el host (o un celular mesa) comienza la partida. El setup en un solo celular sigue disponible ("Cargar todo en este celular").
- [x] **B8** Convergencia de sync (issue #24): resync canónico (refetch + merge con acciones locales en vuelo/cola) en cada señal de riesgo — reconexión del canal, vuelta a foreground, recuperar red, evento fuera de orden — más heartbeat periódico. Evita que un celular quede desfasado por eventos Realtime perdidos.

Decisión v1: el creador de la sala carga el setup (nombres, poblados); los demás se unen y juegan.

## Fase D — Feedback de las primeras partidas reales (30/8)

- [x] **D1** (#24) Convergencia de sync — ver B8.
- [x] **D2** (#25) El ladrón bloquea un hexágono (número + recurso), no todos los del número.
- [x] **D3** (#26) Cartas de desarrollo jugables antes de tirar (caballero para mover el ladrón).
- [x] **D4** (#27) Puntaje real: al comprar se elige la carta que salió del mazo físico, y se pueden corregir cartas de desarrollo por jugador.
- [x] **D5** (#28) Correcciones: agregar/marcar ciudad además de poblado.
- [x] **D6** (#29) Barra superior ordenada por puntos (incluye cartas de victoria y títulos).
- [x] **D7** (#30) Contador de rondas y de tiradas acumulado en el estado.
- [x] **D8** (#31) Insights de tiradas: salido vs. esperado, más/menos frecuentes, tiradas sin 7.
- [x] **D9** (#32) Camino más largo / ejército: ajuste de caminos y caballeros, y asignación manual del título.
- [x] **D10** (#33) Expansión 5-6: fase de construcción especial (construir en turno ajeno).
- [x] **D11** (#34) Consultor de reglas con IA vía Vercel Function (`api/rules.js`).

## Fase C — Pulido pre-lanzamiento

- [x] **C1a** Historial de partidas ("Mis partidas"): resumen derivado del log, local +
      Supabase, con jugadores, puntajes, duración y tiradas.
- [ ] **C1b** Pantalla de fin de partida con estadísticas (usa el mismo resumen).
- [ ] **C2** Error reporting (Sentry o similar) + analytics básico, meta tags/OG, dominio.
- [ ] **C3** QA en dispositivos reales + Lighthouse.

## Completado

- [x] Borrar `catan-vercel/` duplicado (PR #2)
- [x] Dado manual 2-12 (PR #3)
- [x] Selector de modo Completo/Simple (PR #4)
- [x] Modo Simple: construcción libre, dado manual, sin dev cards (PR #5)
- [x] Reordenar jugadores / orden de turnos en setup y en juego (PR #6)
- [x] Alerta de descartes al salir 7 + badge de mano >7 cartas (PR #7)

## Base de datos de usuarios y partidas (sin login)

Identidad: la sesión anónima de Supabase (`auth.uid()`, persistida en el navegador)
identifica al dispositivo; el nombre visible es local y se sube a `profiles`. No hay
contraseña ni email. Si en algún momento se agrega login, se linkea el mismo uid y
los datos ya guardados siguen siendo válidos.

**Fase 1 — hecha** (`supabase/history.sql`, `src/game/summary.js`, `src/history/`)

- `profiles(user_id, display_name, last_seen_at)`
- `games(id, owner_id, room_code, mode, expansion, player_count, status, started_at,
  ended_at, duration_seconds, turns, roll_count, dice_totals, winner_index, winner_name)`
- `game_players(game_id, player_index, name, color_index, user_id, vp, settlements,
  cities, roads_built, knights, dev_cards, longest_road, largest_army)`
- `game_rolls(game_id, seq, d1, d2, total, player_index, manual, rolled_at)`
- `game_participants(game_id, user_id)` — qué dispositivos jugaron cada partida
- El `id` de la partida es el uid de su acción de creación: guardar dos veces es
  idempotente. Escribe el dueño (host o el propio celular); los demás se registran
  como participantes.
- RLS: cada dispositivo lee solo las partidas propias o donde participó.

**Fase 2 — próximos pasos**

1. **Cola offline del historial**: hoy si falla el push queda solo el local; agregar
   reintento (igual que `catan.onlinePending.v1` del log online).
2. **Jugadores recurrentes**: tabla `people(id, owner_id, name)` + `game_players.person_id`
   para que "Beto" sea el mismo entre partidas y se puedan calcular records
   (winrate, PV promedio, suerte con los dados).
3. **Pantalla de estadísticas**: acumulado por persona y por número (¿el 8 sale menos
   de lo que debería?), sobre `game_rolls`.
4. **Fin de partida**: guardar `ended_at` real al detectar ganador (hoy es el ts de la
   última acción) y mostrar el resumen post-partida.
5. **Retención/limpieza**: borrar partidas en estado `lobby` sin actividad y ofrecer
   exportar a JSON/CSV.
6. **Login opcional (más adelante)**: magic link de Supabase; al linkear, `update` de
   `owner_id`/`user_id` del uid anónimo al definitivo.

## Pendiente de acción manual (bloqueante para online)

1. Crear proyecto Supabase (gratis) — pasos en `catan-vercel-pwa/.env.example`
2. Correr `catan-vercel-pwa/supabase/schema.sql` y `catan-vercel-pwa/supabase/history.sql`
   en el SQL Editor
3. Habilitar Anonymous sign-ins (Authentication → Providers)
4. Setear `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel
5. QA con 2 dispositivos reales (crear sala / unirse / sync / cola offline / undo remoto)
