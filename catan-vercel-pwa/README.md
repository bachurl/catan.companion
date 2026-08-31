# Catán Companion

PWA para acompañar partidas de Catán: dados (aleatorios o manuales, ideal para tirar
dados físicos y repartir desde la app), distribución de recursos, construcciones,
cartas de desarrollo, puntaje, y multijugador online multidispositivo: el host crea la
sala apenas elige modo y cantidad, cada jugador se une con el código, carga su nombre y
sus poblados iniciales desde su celular, y en el juego cada celular controla a su
jugador en su turno (construir, comerciar, terminar turno); el resto del tiempo sigue
la partida en vivo.

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
3. Habilitar Anonymous sign-ins (Authentication → Providers)
4. Setear `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (sin marcar "Sensitive" en Vercel)

Sin esas variables la app funciona en modo local/offline y el UI online queda oculto.

## Consultor de reglas con IA (opcional)

El botón **❓ Reglas** responde dudas puntuales en medio de la partida. La app es
estática, así que la consulta pasa por una Vercel Function ([api/rules.js](api/rules.js))
que llama a la API de Claude con la key guardada del lado del servidor.

Para activarlo: crear una API key en [console.anthropic.com](https://console.anthropic.com)
y cargarla en Vercel como `ANTHROPIC_API_KEY` (marcada como *Sensitive*: nunca llega al
navegador). Sin la variable, el botón explica cómo configurarlo y no gasta nada.
`CATAN_RULES_MODEL` permite cambiar el modelo (por defecto `claude-opus-5`).

## Arquitectura

El estado del juego es un **log de acciones** aplicado por un reducer puro
(`src/game/reducer.js`). La aleatoriedad resuelta viaja dentro de cada acción, así el
replay es determinístico. Sobre esa base:

- **Persistencia**: el log se autosavea en localStorage (`src/game/useGameLog.js`)
- **Deshacer**: marcador `UNDO` en el log
- **Online**: el log se replica en Supabase y Realtime lo broadcastea
  (`src/online/useOnlineRoom.js`), con cola offline que resincroniza al reconectar
