// ================================================
//  AgriScan TN — Anthropic API Client
// ================================================

class AgriScanAPI {
  constructor() {
    // Conversation history (multi-turn)
    this.history = [];
  }

  // Main entry point: sends a message (with optional images) to Claude
  async send(userText, images = []) {
    const content = this._buildContent(userText, images);

    this.history.push({ role: "user", content });

    let assistantText;
    try {
      const raw = await this._fetch(this.history);
      assistantText = raw.content[0].text;
    } catch (err) {
      // Pop the user message on failure so history stays consistent
      this.history.pop();
      throw err;
    }

    this.history.push({ role: "assistant", content: assistantText });

    return assistantText;
  }

  // Clear conversation history
  reset() {
    this.history = [];
  }

  // ---- private ----

  _buildContent(userText, images) {
    const content = [];

    for (const img of images) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }

    content.push({
      type: "text",
      text: userText || "Analyse ces images de sol ou de plante et fournis un diagnostic complet.",
    });

    return content;
  }

  async _fetch(messages) {
    const response = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        system: CONFIG.systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const err = await response.json();
        detail = err?.error?.message || "";
      } catch (_) {}

      const code = response.status;

      if (code === 401) throw new Error("API_ERROR:401:" + detail);
      if (code === 403) throw new Error("API_ERROR:403:" + detail);
      if (code === 429) throw new Error("API_ERROR:429:" + detail);
      if (code === 529) throw new Error("API_ERROR:529:" + detail);
      throw new Error(`API_ERROR:${code}:${detail || "Erreur inconnue"}`);
    }

    return response.json();
  }
}
