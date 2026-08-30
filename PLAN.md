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

Decisión v1: el creador de la sala carga el setup (nombres, poblados); los demás se unen y juegan.

## Fase C — Pulido pre-lanzamiento

- [ ] **C1** Pantalla de fin de partida con estadísticas + historial de partidas guardadas.
- [ ] **C2** Error reporting (Sentry o similar) + analytics básico, meta tags/OG, dominio.
- [ ] **C3** QA en dispositivos reales + Lighthouse.

## Completado

- [x] Borrar `catan-vercel/` duplicado (PR #2)
- [x] Dado manual 2-12 (PR #3)
- [x] Selector de modo Completo/Simple (PR #4)
- [x] Modo Simple: construcción libre, dado manual, sin dev cards (PR #5)
- [x] Reordenar jugadores / orden de turnos en setup y en juego (PR #6)
- [x] Alerta de descartes al salir 7 + badge de mano >7 cartas (PR #7)

## Pendiente de acción manual (bloqueante para online)

1. Crear proyecto Supabase (gratis) — pasos en `catan-vercel-pwa/.env.example`
2. Correr `catan-vercel-pwa/supabase/schema.sql` en el SQL Editor
3. Habilitar Anonymous sign-ins (Authentication → Providers)
4. Setear `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel
5. QA con 2 dispositivos reales (crear sala / unirse / sync / cola offline / undo remoto)
