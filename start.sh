#!/bin/bash
set -e

# Lance le bot Telegram en arrière-plan
python3 telegram_bot.py &
BOT_PID=$!

# Lance le serveur web FastAPI au premier plan (Railway suit ce processus)
python3 main.py

# Si main.py s'arrête, on coupe le bot aussi
kill $BOT_PID 2>/dev/null || true
