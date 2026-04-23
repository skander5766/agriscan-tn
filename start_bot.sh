#!/usr/bin/env bash
# ================================================
#  AgriScan TN — Lancement du bot Telegram
# ================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Vérifie que .env existe
if [ ! -f ".env" ]; then
  echo "❌ Fichier .env introuvable."
  echo "   Créez-le avec :"
  echo "   echo 'TELEGRAM_TOKEN=votre_token' >> .env"
  echo "   echo 'ANTHROPIC_API_KEY=votre_cle' >> .env"
  exit 1
fi

# Vérifie que python3 est disponible
if ! command -v python3 &>/dev/null; then
  echo "❌ python3 introuvable. Installez Python 3.10+."
  exit 1
fi

# Installe les dépendances si nécessaire
if ! python3 -c "import telegram" &>/dev/null 2>&1; then
  echo "📦 Installation des dépendances…"
  pip install -r requirements.txt --quiet
fi

echo "🌱 AgriScan TN Bot — démarrage…"
echo "   Ctrl+C pour arrêter"
echo ""

exec python3 telegram_bot.py
