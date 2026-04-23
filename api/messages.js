const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method Not Allowed" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
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
};

// Augmente la limite du body parser Vercel pour les images base64 (3 × ~4 MB)
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};
