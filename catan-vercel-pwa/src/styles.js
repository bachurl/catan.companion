export const STYLE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Nunito:wght@400;600;700;800&display=swap');

:root{
  --wood:#8B4513; --brick:#C0392B; --wheat:#F4D03F; --sheep:#27AE60; --ore:#7F8C8D;
  --bg:#1a0f0a; --bg2:#2c1810; --bg3:#3d2317;
  --gold:#d4a853; --gold-light:#f0d48a;
  --text:#f0e6d3; --text-dim:#a89278;
  --card-bg:rgba(44,24,16,.85);
  --danger:#e74c3c; --success:#2ecc71;
}

.catan-app{
  min-height:100vh;
  background:linear-gradient(to bottom, #78350f, #92400e, #713f12);
  color:var(--text);
  font-family:'Nunito',system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial;
  position:relative;
}

.catan-app::before{
  content:'';
  position:fixed;
  inset:0;
  background:
    radial-gradient(ellipse at 20% 20%, rgba(212,168,83,0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 80%, rgba(139,69,19,0.10) 0%, transparent 50%),
    url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0L60 17.32v34.64L30 60 0 51.96V17.32z' fill='none' stroke='rgba(212,168,83,0.04)' stroke-width='1'/%3E%3C/svg%3E");
  pointer-events:none;
  z-index:0;
}

.catan-container{
  max-width: 980px;
  margin: 0 auto;
  padding: 16px;
  position:relative;
  z-index:1;
}

.center-screen{
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
}

.catan-title{
  font-family:'Cinzel',serif;
  letter-spacing:4px;
  color:var(--gold);
  text-shadow:0 2px 20px rgba(212,168,83,.25);
}

.panel{
  background:var(--card-bg);
  border:1px solid rgba(212,168,83,.15);
  border-radius:16px;
  padding:18px;
  backdrop-filter: blur(10px);
}

.panel-title{
  font-family:'Cinzel',serif;
  color:var(--gold);
  display:flex;
  align-items:center;
  gap:10px;
}

.btn{
  font-weight:800;
  border:none;
  border-radius:12px;
  padding:12px 18px;
  cursor:pointer;
  transition:all .2s;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
}

.btn:active{ transform:scale(.97); }

.btn-primary{
  background:linear-gradient(135deg,var(--gold),#b8902e);
  color:#fff;
  border:1px solid rgba(240,212,138,.55);
  box-shadow:0 10px 30px rgba(212,168,83,.30);
  font-size:1.15rem;
  padding:16px 32px;
  text-shadow:0 1px 3px rgba(0,0,0,.4);
}


.btn-secondary{
  background:var(--bg3);
  color:var(--gold);
  border:1px solid rgba(212,168,83,.30);
}

.die{
  width:72px; height:72px;
  background:linear-gradient(145deg,#faf3e6,#e8dcc8);
  border-radius:16px;
  display:flex; align-items:center; justify-content:center;
  font-family:'Cinzel',serif;
  font-size:2rem; font-weight:900;
  color:var(--bg);
  box-shadow:0 6px 20px rgba(0,0,0,.4), inset 0 2px 4px rgba(255,255,255,.3);
}

.distribution-item{
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px 12px;
  border-radius:12px;
  background:rgba(46,204,113,.14);
  border:1px solid rgba(46,204,113,.18);
  border-left:3px solid var(--success);
  color:var(--text);
}


.log-entry{
  font-size:.85rem;
  padding:8px 10px;
  border-bottom:1px solid rgba(212,168,83,.06);
  color:var(--text-dim);
}

.log-entry b{ color:var(--gold); font-weight:800; }

.roll-status{color:rgba(240,230,211,.82);} 

.quick-nav{
  width:100%;
  padding:18px 16px;
  border-radius:16px;
  background:rgba(0,0,0,.08);
  border:2px solid rgba(240,212,138,.55);
  color:var(--text);
  font-weight:900;
  font-size:18px;
  letter-spacing:.2px;
  transition:all .15s ease;
}
.quick-nav:hover{
  background:rgba(212,168,83,.12);
  border-color:rgba(240,212,138,.85);
}


/* --- Contrast & no-tailwind critical UI --- */
.dice-sum{
  font-size:44px;
  font-weight:900;
  color:var(--gold-light);
  text-shadow:0 2px 18px rgba(212,168,83,.25);
  margin-top:6px;
}

.die-unknown{
  width:72px;
  height:72px;
  border-radius:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:rgba(255,255,255,.10);
  border:1px solid rgba(240,212,138,.25);
  color:rgba(240,230,211,.85);
  font-size:30px;
  font-weight:900;
}

.quick-actions{
  width:100%;
  max-width:720px;
  margin:18px auto 0;
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
}

.roll-status{
  color:rgba(240,230,211,.92);
  font-weight:700;
  letter-spacing:.2px;
}

.btn-primary{
  box-shadow:0 14px 34px rgba(212,168,83,.35);
}

.quick-nav{
  background:rgba(240,212,138,.16);
  border:2px solid rgba(240,212,138,.85);
  color:var(--text);
  box-shadow:0 10px 26px rgba(0,0,0,.35);
}

.quick-nav:hover{
  background:rgba(240,212,138,.24);
}
`;
