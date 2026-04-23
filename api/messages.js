const RAILWAY_URL =
  "https://web-production-1403a.up.railway.app/api/messages";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method Not Allowed" } });
  }

  try {
    const upstream = await fetch(RAILWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("Erreur proxy Railway:", err.message);
    res.status(502).json({
      error: { message: "Impossible de joindre le backend Railway." },
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
