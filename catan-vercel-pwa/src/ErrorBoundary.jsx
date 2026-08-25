import React from "react";

// Ante un crash de render muestra una pantalla de recuperación en lugar de
// una página en blanco. La partida está autosaveada en localStorage, así que
// recargar la restaura desde "Continuar partida".
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Error de render:", error, info);
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
              background: "linear-gradient(135deg,#d4a853,#b8902e)", color: "#fff", border: "none",
              borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 800, cursor: "pointer",
            }}>
            🔄 Recargar
          </button>
        </div>
      </div>
    );
  }
}
