import React from "react";
import { reportError, formatErrorsForReport } from "./telemetry.js";

// Ante un crash de render muestra una pantalla de recuperación en lugar de
// una página en blanco. La partida está autosaveada en localStorage, así que
// recargar la restaura desde "Continuar partida".
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, showDetail: false, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Error de render:", error, info);
    // Queda registrado en el dispositivo (y se envía si hay endpoint), así el
    // crash no se pierde en la consola de un celular que nadie va a abrir.
    reportError(error, { type: "render", componentStack: String(info?.componentStack || "").split("\n").slice(0, 5).join("\n") });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(to bottom, #78350f, #92400e, #713f12)", padding: 16,
        fontFamily: "'Nunito', system-ui, sans-serif",
      }}>
        <div style={{
          background: "rgba(15,23,42,.92)", borderRadius: 24, padding: 32, maxWidth: 420,
          textAlign: "center", border: "1px solid rgba(212,168,83,.35)", color: "#f0e6d3",
        }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>😵</div>
          <h1 style={{ color: "#f0d48a", fontSize: 22, margin: "0 0 8px" }}>Algo salió mal</h1>
          <p style={{ color: "#a89278", fontSize: 14, margin: "0 0 20px" }}>
            Tranquilo: la partida se guarda automáticamente. Recargá la app y elegí
            "Continuar" para retomarla donde estaba.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "linear-gradient(135deg,#d4a853,#b8902e)", color: "#0f172a", border: "none",
              borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 800, cursor: "pointer",
            }}>
            🔄 Recargar
          </button>

          {/* El detalle del error, a mano: sirve para pegarlo en un issue en vez
              de tener que reproducir el crash contándolo de memoria. */}
          <div style={{ marginTop: 20, textAlign: "left" }}>
            <button
              onClick={() => this.setState(st => ({ showDetail: !st.showDetail }))}
              style={{
                background: "none", border: "none", color: "#a89278", fontSize: 12,
                cursor: "pointer", padding: 0, textDecoration: "underline",
              }}>
              {this.state.showDetail ? "Ocultar detalle" : "Ver detalle del error"}
            </button>
            {this.state.showDetail && (
              <>
                <pre style={{
                  marginTop: 10, maxHeight: 160, overflow: "auto", background: "rgba(0,0,0,.35)",
                  borderRadius: 10, padding: 10, fontSize: 10, color: "#c9b48f", whiteSpace: "pre-wrap",
                }}>{String(this.state.error?.message || this.state.error)}
{String(this.state.error?.stack || "").split("\n").slice(0, 6).join("\n")}</pre>
                <button
                  onClick={() => {
                    const text = formatErrorsForReport();
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(text).then(
                        () => this.setState({ copied: true }),
                        () => this.setState({ copied: false }),
                      );
                    }
                  }}
                  style={{
                    marginTop: 8, background: "rgba(212,168,83,.18)", border: "1px solid rgba(212,168,83,.45)",
                    color: "#f0d48a", borderRadius: 10, padding: "8px 14px", fontSize: 12,
                    fontWeight: 700, cursor: "pointer",
                  }}>
                  {this.state.copied ? "✓ Copiado" : "Copiar para reportar"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
