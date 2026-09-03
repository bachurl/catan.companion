# Catán Companion

PWA para acompañar partidas de Catán: dados (aleatorios o manuales, ideal para tirar
dados físicos y repartir desde la app), distribución de recursos, construcciones,
cartas de desarrollo, puntaje, y multijugador online multidispositivo: el host crea la
sala apenas elige modo y cantidad, cada jugador se une con el código, carga su nombre y
sus poblados iniciales desde su celular, y en el juego cada celular controla a su
jugador en su turno (construir, comerciar, terminar turno); el resto del tiempo sigue
la partida en vivo. Las estadísticas están disponibles durante toda la partida (tab 📊)
y las partidas terminadas quedan guardadas en el historial.

## Desarrollo

```bash
npm install
npm run dev          # servidor local
npm run build        # build de producción (dist/)
npm run test:reducer # tests del motor de juego
```

## Deploy (Vercel)

- **Root Directory**: `catan-vercel-pwa`
- **Framework**: Vite (build `npm run build`, output `dist`)

## Multijugador online (opcional)

Requiere un proyecto Supabase. Pasos en [.env.example](.env.example):

1. Crear proyecto en supabase.com
2. Correr [supabase/schema.sql](supabase/schema.sql) en el SQL Editor
   (y [supabase/history.sql](supabase/history.sql) para el historial de partidas)
3. Habilitar Anonymous sign-ins (Authentication → Providers)
4. Setear `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (sin marcar "Sensitive" en Vercel)

Sin esas variables la app funciona en modo local/offline y el UI online queda oculto.

## Historial de partidas

Una partida terminada se archiva sola y se reabre desde **📚 Partidas anteriores**, con las mismas
estadísticas que se vieron jugando.

- **En el dispositivo** (`src/game/history.js`): se guarda el **log completo** de las últimas 20
  partidas, así el detalle se reconstruye entero (no es una foto recortada). Funciona sin Supabase.
- **En base de datos** (`src/history/`, opcional): además se sube el **resumen** de cada partida
  (jugadores, puntajes, duración, rondas y todas las tiradas con su número y de quién fue) a las
  tablas de [supabase/history.sql](supabase/history.sql) — `games`, `game_players`, `game_rolls`,
  `game_participants`, `profiles`. Las partidas jugadas desde otro celular de la sala aparecen en
  la misma pantalla, bajo ☁️.

**Sin login**: la sesión anónima de Supabase identifica al dispositivo (`auth.uid()`) y el nombre
visible se elige en esa misma pantalla. Cada uno ve solo las partidas que jugó. Si más adelante se
agrega login real, se linkea contra el mismo uid.

El resumen se deriva del log con `summarizeGame` (`src/game/summary.js`) y el id de la partida es el
uid de su primera acción, así que guardar dos veces la misma partida reescribe sus filas en vez de
duplicarlas.

## Consultor de reglas con IA (opcional)

El botón **❓ Reglas** responde dudas puntuales en medio de la partida. La app es
estática, así que la consulta pasa por una Vercel Function ([api/rules.js](api/rules.js))
que llama a la API de Claude con la key guardada del lado del servidor.

Para activarlo: crear una API key en [console.anthropic.com](https://console.anthropic.com)
y cargarla en Vercel como `ANTHROPIC_API_KEY` (marcada como *Sensitive*: nunca llega al
navegador). Sin la variable, el botón explica cómo configurarlo y no gasta nada.
`CATAN_RULES_MODEL` permite cambiar el modelo (por defecto `claude-opus-5`).

La misma key habilita **cargar el tablero sacándole una foto** ([api/vision.js](api/vision.js)):
la foto se achica en el celular, se manda al endpoint y vuelve qué recurso y qué número tiene
cada hexágono. Es un borrador: la app lo muestra sobre el mapa, marca los hexágonos que leyó con
dudas y no deja usarlo hasta que el tablero cierre con las piezas de la caja. La imagen no se
guarda en ningún lado. `CATAN_VISION_MODEL` cambia el modelo.

## Estadísticas e historial

El tab **📊 Stats** está disponible en cualquier momento de la partida, no solo al final:
carrera de puntos por ronda, producción por jugador y recurso, bloqueos del ladrón,
comercios, robos y la distribución de tiradas vs. lo esperado. La pantalla de fin de
partida muestra el mismo panel.

Todo se deriva del log de acciones (`src/game/stats.js`), no de contadores en el estado:
por eso deshacer y el resync online funcionan sin código extra, y una partida guardada
muestra su historial completo hacia atrás.

Al ganarse una partida se archiva con su log completo (`src/game/history.js`, últimas 20
en el dispositivo) y se puede reabrir desde **📚 Partidas anteriores** con las mismas
estadísticas que se vieron jugando.

## Diagnóstico (opcional)

Los errores se registran **siempre en el dispositivo** (últimos 10) y se pueden copiar
desde la app: si hubo alguno aparece una tarjeta en la pantalla de inicio, y la pantalla
de recuperación tiene "Ver detalle del error". Eso no necesita configurar nada y no manda
nada a ninguna parte.

Para recibirlos además en algún lado, setear `VITE_ERROR_ENDPOINT` (un endpoint que acepte
POST con JSON). `VITE_ANALYTICS_ENDPOINT` habilita eventos de producto
(`partida_iniciada` / `partida_terminada`: cuántos jugadores, qué modo, si fue online) sin
id de usuario, cookies ni nombres. Sin esas variables no se hace ninguna request.

## Imagen al compartir el link

`public/og.png` es la imagen de Open Graph. La URL absoluta se resuelve en el build
(`vite.config.js`): usa `SITE_URL` si se setea, si no el dominio que expone Vercel.

## Accesibilidad

Lighthouse mobile: accesibilidad 100, best-practices 100, SEO 100, performance 98.
Sin violaciones de axe-core (WCAG 2.1 AA) en las 13 pantallas.

Dos cosas a tener en cuenta al tocar estilos:

- El texto tenue usa la clase `.text-muted` (`src/index.css`), no `text-slate-500`:
  ese gris no llegaba al contraste mínimo sobre las cards oscuras.
- Los botones sobre ámbar, esmeralda y verde llevan etiqueta oscura (`text-slate-900`),
  no blanca: blanco sobre esos fondos queda en ~2.2:1.

## Arquitectura

El estado del juego es un **log de acciones** aplicado por un reducer puro
(`src/game/reducer.js`). La aleatoriedad resuelta viaja dentro de cada acción, así el
replay es determinístico. Sobre esa base:

- **Persistencia**: el log se autosavea en localStorage (`src/game/useGameLog.js`)
- **Deshacer**: marcador `UNDO` en el log
- **Online**: el log se replica en Supabase y Realtime lo broadcastea
  (`src/online/useOnlineRoom.js`), con cola offline que resincroniza al reconectar
- **Estadísticas** (`src/game/stats.js`), **historial local** (`src/game/history.js`) y **resumen
  para la nube** (`src/game/summary.js`): funciones puras del log, así que acompañan deshacer y
  resync sin lógica propia; `src/history/` sube ese resumen a Supabase
