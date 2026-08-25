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

- [ ] **A1** Refactor a `useReducer` + log de acciones; split del monolito en módulos. Sin cambios visuales.
- [ ] **A2** Autosave en localStorage + pantalla "Continuar partida" al abrir.
- [ ] **A3** Botón **Deshacer** (última acción, con confirmación).
- [ ] **A4** Hardening PWA: cache del SW versionado por build, banner "nueva versión disponible", error boundary con recuperación de partida.
- [ ] **A5** Wake lock (la pantalla no se apaga en partida) + vibración al tirar dados.

## Fase B — Multijugador online (Supabase)

- [ ] **B1** Proyecto Supabase, auth anónima, tablas `rooms` + `actions` con RLS y secuencia por sala.
- [ ] **B2** Crear sala / unirse con código corto + QR; lobby con presencia.
- [ ] **B3** Sync de acciones: local → Supabase → Realtime → todos. Cola offline, indicador online/offline.
- [ ] **B4** Vista por jugador: cada celular se asocia a un jugador (ve su mano, actúa en su turno). El modo "un solo dispositivo en la mesa" sigue existiendo.

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
