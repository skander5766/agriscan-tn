#!/bin/bash
set -e

# Lance le bot Telegram en arrière-plan
python3.11 telegram_bot.py &
BOT_PID=$!

# Lance le serveur web FastAPI au premier plan (Railway suit ce processus)
python3.11 -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}

# Si uvicorn s'arrête, on coupe le bot aussi
kill $BOT_PID 2>/dev/null || true
