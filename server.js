require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname)));

app.post("/api/messages", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === "VOTRE_CLE_ICI") {
    return res.status(500).json({
      error: { message: "ANTHROPIC_API_KEY non configurée sur le serveur." },
    });
  }

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("Erreur proxy Anthropic:", err.message);
    res.status(502).json({
      error: { message: "Impossible de joindre l'API Anthropic." },
    });
  }
});

app.listen(PORT, () => {
  console.log(`AgriScan TN — http://localhost:${PORT}`);
});
