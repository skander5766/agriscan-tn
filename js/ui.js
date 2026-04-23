// ================================================
//  AgriScan TN — UI Manager
// ================================================

class AgriScanUI {
  constructor() {
    this.$msgs  = document.getElementById("messagesContainer");
    this.$area  = document.getElementById("messagesArea");
    this.$dot   = document.getElementById("statusDot");
    this.$stxt  = document.getElementById("statusText");
    this._typing = null;
  }

  // ---- Welcome ----

  showWelcome() {
    const el = document.createElement("div");
    el.className = "welcome-screen";
    el.innerHTML = `
      <div class="welcome-leaf">🌱</div>
      <h2 class="welcome-title">Bienvenue sur AgriScan TN</h2>
      <p class="welcome-sub">
        Votre expert agronome IA spécialisé en agriculture tunisienne.<br>
        Posez une question ou uploadez une photo de sol pour obtenir un diagnostic précis.
      </p>
      <div class="welcome-chips">
        <span class="chip">🔍 Diagnostic sol</span>
        <span class="chip">📸 Analyse photo</span>
        <span class="chip">💊 Recommandations</span>
        <span class="chip">📊 Score de santé /10</span>
        <span class="chip">🌿 Cultures adaptées</span>
      </div>
    `;
    this.$msgs.appendChild(el);
  }

  // ---- Messages ----

  addMessage(role, text, images = []) {
    // Remove welcome screen on first real message
    const welcome = this.$msgs.querySelector(".welcome-screen");
    if (welcome) welcome.remove();

    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = role === "bot" ? "🌿" : "👤";

    const body = document.createElement("div");
    body.className = "msg-body";

    // Image thumbnails (user messages only)
    if (images.length && role === "user") {
      const imgBox = document.createElement("div");
      imgBox.className = "msg-img";
      for (const img of images) {
        const el = document.createElement("img");
        el.src = `data:${img.mediaType};base64,${img.base64}`;
        el.alt = img.name || "Image envoyée";
        imgBox.appendChild(el);
      }
      body.appendChild(imgBox);
    }

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (role === "bot") {
      bubble.innerHTML = this._renderMarkdown(text);
      const score = this._extractScore(text);
      if (score !== null) bubble.appendChild(this._scoreWidget(score));
    } else {
      bubble.textContent = text;
    }

    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = this._time();

    body.appendChild(bubble);
    body.appendChild(time);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    this.$msgs.appendChild(wrap);

    this._scrollBottom();
    return wrap;
  }

  // ---- Typing indicator ----

  showTyping() {
    if (this._typing) return;
    const row = document.createElement("div");
    row.className = "typing-row";
    row.innerHTML = `
      <div class="msg-avatar" style="background:linear-gradient(135deg,#122510,#1e4018);border:1px solid rgba(106,191,94,.22);">🌿</div>
      <div class="typing-bubble">
        <div class="t-dot"></div>
        <div class="t-dot"></div>
        <div class="t-dot"></div>
      </div>
    `;
    this.$msgs.appendChild(row);
    this._typing = row;
    this._scrollBottom();
  }

  hideTyping() {
    if (this._typing) { this._typing.remove(); this._typing = null; }
  }

  // ---- Status ----

  setStatus(online) {
    if (online) {
      this.$dot.classList.remove("offline");
      this.$stxt.textContent = "En ligne";
    } else {
      this.$dot.classList.add("offline");
      this.$stxt.textContent = "Hors ligne";
    }
  }

  // ---- Error messages ----

  showError(errorCode) {
    let html;

    if (errorCode === "API_KEY_MISSING") {
      html = `
        ⚠️ <strong>Clé API manquante</strong><br><br>
        Pour utiliser AgriScan TN, configurez votre clé Anthropic dans <code>js/config.js</code> :<br><br>
        1. Ouvrez <code>js/config.js</code><br>
        2. Remplacez <code>VOTRE_CLE_ICI</code> par votre clé API<br>
        3. Rechargez la page<br><br>
        Obtenez une clé sur <strong>console.anthropic.com</strong>
      `;
    } else if (errorCode.startsWith("API_ERROR:401")) {
      html = `🔑 <strong>Clé API invalide</strong><br>Vérifiez votre clé dans <code>js/config.js</code> et assurez-vous qu'elle est active sur console.anthropic.com.`;
    } else if (errorCode.startsWith("API_ERROR:403")) {
      html = `🚫 <strong>Accès refusé</strong><br>Votre clé n'a pas les permissions nécessaires ou l'accès direct depuis le navigateur est désactivé.`;
    } else if (errorCode.startsWith("API_ERROR:429")) {
      html = `⏱️ <strong>Limite de débit atteinte</strong><br>Trop de requêtes envoyées. Attendez quelques secondes et réessayez.`;
    } else if (errorCode.startsWith("API_ERROR:529")) {
      html = `🔄 <strong>Service temporairement surchargé</strong><br>L'API Anthropic est temporairement surchargée. Réessayez dans quelques instants.`;
    } else if (errorCode === "NETWORK_ERROR") {
      html = `📡 <strong>Erreur réseau</strong><br>Vérifiez votre connexion internet et réessayez.`;
    } else {
      html = `❌ <strong>Erreur inattendue</strong><br>Une erreur s'est produite lors de la connexion à l'API. Détail : <code>${this._esc(errorCode)}</code>`;
    }

    const wrap = document.createElement("div");
    wrap.className = "msg bot";

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = "⚠️";
    avatar.style.cssText = "background:rgba(212,80,58,.15);border:1px solid rgba(212,80,58,.3)";

    const body = document.createElement("div");
    body.className = "msg-body";

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble error-box";
    bubble.innerHTML = html;

    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = this._time();

    body.appendChild(bubble);
    body.appendChild(time);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    this.$msgs.appendChild(wrap);

    this._scrollBottom();
    this.setStatus(false);
  }

  // ---- Private helpers ----

  _renderMarkdown(text) {
    const lines = text.split("\n");
    let html = "";
    let inUl = false;
    let inOl = false;

    const closeList = () => {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (inOl) { html += "</ol>"; inOl = false; }
    };

    const inline = (s) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>");

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      // Horizontal rule
      if (/^---+$/.test(line)) {
        closeList();
        html += "<hr>";
        continue;
      }

      // Headings
      const h3 = line.match(/^#{1,3}\s+(.+)$/);
      if (h3) {
        closeList();
        html += `<h3>${inline(h3[1])}</h3>`;
        continue;
      }

      // Unordered list
      const ul = line.match(/^[-•*]\s+(.+)$/);
      if (ul) {
        if (!inUl) { if (inOl) { html += "</ol>"; inOl = false; } html += "<ul>"; inUl = true; }
        html += `<li>${inline(ul[1])}</li>`;
        continue;
      }

      // Ordered list
      const ol = line.match(/^\d+\.\s+(.+)$/);
      if (ol) {
        if (!inOl) { if (inUl) { html += "</ul>"; inUl = false; } html += "<ol>"; inOl = true; }
        html += `<li>${inline(ol[1])}</li>`;
        continue;
      }

      // Empty line
      if (!line) {
        closeList();
        html += "<br>";
        continue;
      }

      // Paragraph
      closeList();
      html += `<p>${inline(line)}</p>`;
    }

    closeList();

    // Clean consecutive <br> into single break
    html = html.replace(/(<br>){3,}/g, "<br><br>");

    return html;
  }

  _extractScore(text) {
    const patterns = [
      /Score de santé\s*[:\-–—]?\s*\*{0,2}(\d+(?:[.,]\d+)?)\s*\/\s*10\*{0,2}/i,
      /Score\s*[:\-–—]?\s*\*{0,2}(\d+(?:[.,]\d+)?)\s*\/\s*10\*{0,2}/i,
      /📊.*?(\d+(?:[.,]\d+)?)\s*\/\s*10/,
      /(\d+(?:[.,]\d+)?)\s*\/\s*10/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const v = parseFloat(m[1].replace(",", "."));
        if (v >= 0 && v <= 10) return v;
      }
    }
    return null;
  }

  _scoreWidget(score) {
    const color   = score >= 7 ? "#3a7d44" : score >= 4.5 ? "#c4a030" : "#d4503a";
    const verdict = score >= 7 ? "Sol sain ✓" : score >= 4.5 ? "Sol dégradé" : "Sol critique";
    const r       = 28;
    const circ    = +(2 * Math.PI * r).toFixed(3);

    const div = document.createElement("div");
    div.className = "health-widget";
    div.innerHTML = `
      <div class="hw-circle-wrap">
        <svg class="hw-svg" viewBox="0 0 80 80" aria-hidden="true">
          <circle class="hw-track" cx="40" cy="40" r="${r}"/>
          <circle class="hw-ring" cx="40" cy="40" r="${r}"
            stroke="${color}"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${circ}"/>
        </svg>
        <div class="hw-score" style="color:${color}">${score}<span class="hw-denom">/10</span></div>
      </div>
      <div class="hw-details">
        <div class="hw-title">📊 Score de santé</div>
        <div class="hw-verdict" style="color:${color}">${verdict}</div>
      </div>
    `;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ring = div.querySelector(".hw-ring");
      if (ring) ring.style.strokeDashoffset = circ * (1 - score / 10);
    }));

    return div;
  }

  addMetricsWidget(images) {
    const m = images.find(img => img.metrics)?.metrics;
    if (!m) return;

    const gauge = (label, val, max, color) => {
      const pct     = Math.min(100, (val / max) * 100).toFixed(1);
      const display = max === 10 ? `${val}/10` : `${val}%`;
      return `
        <div class="mw-gauge">
          <span class="mw-label">${label}</span>
          <div class="mw-track"><div class="mw-fill" style="background:${color}" data-pct="${pct}"></div></div>
          <span class="mw-value">${display}</span>
        </div>`;
    };

    const div = document.createElement("div");
    div.className = "metrics-widget";
    div.innerHTML = `
      <div class="mw-header">🔬 Pré-analyse PIL / OpenCV</div>
      <div class="mw-gauges">
        ${gauge("🌿 Végétation", m.greenPct,   100, "#3a7d44")}
        ${gauge("🏜️ Sol sec",    m.brownPct,   100, "#c9a96e")}
        ${gauge("☀️ Luminosité", m.brightness, 100, "#dab840")}
        ${gauge("💧 Stress",     m.stress,      10, "#d4503a")}
      </div>
    `;

    this.$msgs.appendChild(div);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      div.querySelectorAll(".mw-fill").forEach(el => {
        el.style.width = el.dataset.pct + "%";
      });
    }));

    this._scrollBottom();
  }

  _scrollBottom() {
    requestAnimationFrame(() => { this.$area.scrollTop = this.$area.scrollHeight; });
  }

  _time() {
    return new Date().toLocaleTimeString("fr-TN", { hour: "2-digit", minute: "2-digit" });
  }

  _esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
