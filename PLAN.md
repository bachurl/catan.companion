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

- [x] **C1a** Estadísticas **en vivo** (tab 📊, disponible durante toda la partida) + la misma pantalla al terminar:
  carrera de puntos por ronda, producción por jugador y recurso, detalle por jugador (dados, bloqueos del
  ladrón, comercios, robos) y distribución de tiradas vs. lo esperado. Se derivan del log de acciones, así que
  acompañan deshacer/resync y las partidas ya guardadas muestran el historial completo hacia atrás.
- [x] **C1b** Historial de partidas terminadas: cada partida ganada se archiva con su log completo
  (últimas 20, en el dispositivo) y se puede reabrir con las mismas estadísticas que se vieron jugando.
  Antes una partida terminada se descartaba en silencio al recargar.
- [x] **C2** Meta tags + Open Graph (imagen propia en `public/og.png`, URL absoluta resuelta en build).
  Diagnóstico: los errores se registran en el dispositivo y se pueden copiar desde la app; con
  `VITE_ERROR_ENDPOINT` / `VITE_ANALYTICS_ENDPOINT` además se envían, y sin ellas no se hace ninguna
  request ni entra ningún tercero.
- [x] **C3** Lighthouse mobile: accesibilidad 75 → **100**, best-practices 96 → **100**, SEO 91 → **100**,
  performance **98**. Cero violaciones de axe-core (WCAG 2.1 AA) en las 13 pantallas de la app.

### Pendiente de Fase C

- [ ] **C2b** Dominio propio (comprarlo y apuntarlo en Vercel). Con `SITE_URL` seteada, la imagen de
  Open Graph lo toma sola.
- [ ] **C2c** Si se quiere recibir los errores: levantar un endpoint (o poner Sentry) y setear
  `VITE_ERROR_ENDPOINT`. Hoy el registro es local.
- [ ] **C3b** QA en dispositivos reales: sigue siendo lo único que no se puede automatizar desde acá
  (iOS/Android reales, PWA instalada, pantalla que no se apaga, vibración, 2+ celulares en una sala).

## Completado

- [x] Borrar `catan-vercel/` duplicado (PR #2)
- [x] Dado manual 2-12 (PR #3)
- [x] Selector de modo Completo/Simple (PR #4)
- [x] Modo Simple: construcción libre, dado manual, sin dev cards (PR #5)
- [x] Reordenar jugadores / orden de turnos en setup y en juego (PR #6)
- [x] Alerta de descartes al salir 7 + badge de mano >7 cartas (PR #7)

## Configuración (estado real)

Supabase está en producción desde las partidas del 30/8: las salas online, el sync entre celulares y
la cola offline funcionan, y los logs de partidas quedan en la tabla de acciones. El desfase de
sincronización que apareció jugando se corrigió en el PR #35 (issue #24).

- [x] Proyecto Supabase creado, `supabase/schema.sql` corrido, anonymous sign-ins habilitado
- [x] `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` seteadas en Vercel
- [x] Proyecto Vercel duplicado (`bachurl-catan.companion`) borrado — fallaba en cada deploy porque
      apuntaba a la raíz del repo, donde no hay `package.json`, y mandaba un mail de error por push
- [ ] `ANTHROPIC_API_KEY` en Vercel — sin ella el consultor de reglas (❓ Reglas) se reporta no
      disponible y el resto de la app anda igual
- [ ] QA con 2 dispositivos reales (crear sala / unirse / sync / cola offline / undo remoto)

Todas las variables están documentadas en `catan-vercel-pwa/.env.example`.
