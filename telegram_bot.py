#!/usr/bin/env python3
"""
AgriScan TN — Telegram Bot
Lancement : python telegram_bot.py  (ou ./start_bot.sh)
Variables d'environnement requises dans .env :
  TELEGRAM_TOKEN=<votre token BotFather>
  ANTHROPIC_API_KEY=<votre clé Anthropic>
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import re
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")  # must run before any code that reads os.environ

import anthropic
from telegram import Update
from telegram.constants import ChatAction, ParseMode
from telegram.error import TelegramError
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from agri_analysis import analyze_image, build_metrics_text

# ── Configuration ────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s — %(levelname)s — %(name)s — %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

TELEGRAM_TOKEN     = os.environ.get("TELEGRAM_TOKEN", "")
ANTHROPIC_API_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL              = "claude-sonnet-4-6"
MAX_TOKENS         = 2048
PHOTO_WAIT_SECONDS = 20   # secondes d'attente pour une 2ᵉ photo
MAX_HISTORY        = 8    # messages conservés par utilisateur (4 échanges)

SYSTEM_PROMPT = """Tu es AgriScan TN, un expert agronome de haut niveau spécialisé dans l'agriculture tunisienne. Tu combines expertise scientifique et connaissance terrain du contexte agricole tunisien.

Tu connais deux parcelles de référence :

🔴 TERRE MALADE — Béja (Nord Tunisie) :
• Sol argileux-sableux, sec et fissuré en surface
• Champignon pathogène Fusarium oxysporum détecté
• Stress hydrique sévère — déficit hydrique chronique
• pH très acide : 4.8 (optimal cultures : 6.0–7.0)
• Carence sévère en azote (N) et potassium (K)
• Matière organique très faible : < 1%
• Score de santé estimé : 2.5/10

🟢 TERRE SAINE — Nabeul (Cap Bon) :
• Sol limoneux-sableux, structure granulaire équilibrée
• Aucune maladie fongique ou bactérienne détectée
• Bonne capacité de rétention d'eau
• pH optimal : 6.5 — idéal pour la majorité des cultures
• Matière organique : 3.8% — excellent (norme > 3%)
• Riche en nutriments : N, P, K en quantités optimales
• Score de santé estimé : 8.5/10

COMPORTEMENT LORS D'UNE ANALYSE PHOTO :
Quand une photo de sol ou de plante est envoyée, produis un diagnostic structuré EXACTEMENT ainsi :

🔍 *État général du sol*
[Description de l'apparence, texture, couleur, humidité]

🦠 *Maladies / problèmes détectés*
[Pathogènes visibles, symptômes, déficiences]

✅ *Points positifs*
[Ce qui est bien ou récupérable]

💊 *Recommandations concrètes*
[Actions prioritaires, produits, doses, calendrier]

📊 *Score de santé : X/10*
[Justification du score]

COMPORTEMENT LORS D'UNE COMPARAISON (2 photos) :
Compare les deux terres côte à côte. Structure ta réponse :
• Photo 1 — diagnostic rapide + score
• Photo 2 — diagnostic rapide + score
• Comparaison et recommandations

FORMAT TELEGRAM :
• Utilise *texte* (une étoile) pour le gras
• Utilise _texte_ pour l'italique
• Utilise des emojis pour structurer les sections
• Réponds TOUJOURS en français
• Sois précis, pratique et bienveillant
• Adapte tes conseils au contexte tunisien (climat méditerranéen semi-aride)"""

WELCOME_TEXT = """🌱 *Bienvenue sur AgriScan TN\!*

Je suis votre expert agronome IA spécialisé en agriculture tunisienne\.

*Comment m'utiliser :*
📸 Envoyez une *photo de sol* → diagnostic complet
📸📸 Envoyez *2 photos* → comparaison des deux terres
💬 Posez une *question* → réponse d'expert

*Mes spécialités :*
• 🔍 Diagnostic sol & maladies
• 📊 Score de santé /10
• 💊 Recommandations de traitement
• 🌿 Cultures adaptées à la Tunisie

Tapez /aide pour le guide complet\."""

AIDE_TEXT = """📖 *Guide d\'utilisation AgriScan TN*

*Analyse photo :*
• Envoyez une photo de votre sol ou plante
• Je détecte maladies, carences et stress hydriques
• Je vous donne un score de santé /10 avec recommandations

*Comparaison de deux terres :*
• Envoyez une première photo → j'attends
• Envoyez une 2ᵉ photo dans les {} secondes
• Je compare automatiquement les deux parcelles

*Questions textuelles :*
• pH, fertilisation, cultures adaptées…
• Traitements spécifiques, calendrier agricole
• Analyse des terres de Béja et Nabeul

*Commandes :*
/start — Message de bienvenue
/aide — Ce guide

*Conseils pour de meilleures analyses :*
• Prenez la photo en pleine lumière naturelle
• Cadrez le sol de près \(50–100 cm\)
• Incluez les racines si vous suspectez une maladie fongique""".format(PHOTO_WAIT_SECONDS)

# ── État en mémoire ───────────────────────────────────────────────
# {user_id: [{"b64": str, "metrics": dict|None}]}
photo_buffers: dict[int, list] = {}
# {user_id: asyncio.Task}  — tâches de temporisation
analysis_tasks: dict[int, asyncio.Task] = {}
# {user_id: [{"role": "user"|"assistant", "content": ...}]}
conversation_histories: dict[int, list] = {}


# ── Helpers ───────────────────────────────────────────────────────

def to_telegram_md(text: str) -> str:
    """Convert Claude markdown to Telegram MarkdownV2-safe text."""
    # **bold** → *bold*
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)
    # ### Heading → *Heading*
    text = re.sub(r"^#{1,3}\s+(.+)$", r"*\1*", text, flags=re.MULTILINE)
    # Remove horizontal rules
    text = re.sub(r"^-{3,}$", "", text, flags=re.MULTILINE)
    # Clean excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_message(text: str, max_len: int = 4000) -> list[str]:
    """Split long text at paragraph boundaries to fit Telegram's 4096-char limit."""
    if len(text) <= max_len:
        return [text]

    chunks: list[str] = []
    current = ""
    for para in text.split("\n\n"):
        segment = ("\n\n" if current else "") + para
        if len(current) + len(segment) <= max_len:
            current += segment
        else:
            if current:
                chunks.append(current)
            current = para
    if current:
        chunks.append(current)
    return chunks or [text[:max_len]]


async def reply_safe(message, text: str) -> None:
    """Send a Markdown message, falling back to plain text on parse errors."""
    md_text = to_telegram_md(text)
    for chunk in split_message(md_text):
        try:
            await message.reply_text(chunk, parse_mode=ParseMode.MARKDOWN)
        except TelegramError:
            await message.reply_text(chunk)


async def ask_claude(
    user_id: int,
    content: list | str,
    *,
    ephemeral: bool = False,
) -> str:
    """
    Call Claude with conversation history.
    content : list of Anthropic content blocks, or a plain string.
    ephemeral: if True, the exchange is NOT added to history (photo analyses).
    """
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    history = conversation_histories.setdefault(user_id, [])

    if isinstance(content, str):
        content = [{"type": "text", "text": content}]

    history.append({"role": "user", "content": content})

    # Trim to MAX_HISTORY (always keep pairs: user+assistant)
    if len(history) > MAX_HISTORY:
        history[:] = history[-MAX_HISTORY:]

    response = await client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=history,
    )
    reply_text = response.content[0].text

    if ephemeral:
        history.pop()  # remove the user message we just added
    else:
        history.append({"role": "assistant", "content": reply_text})

    return reply_text


async def download_photo_b64(update: Update, context: ContextTypes.DEFAULT_TYPE) -> str:
    """Download the highest-resolution photo from a Telegram message, return base64."""
    photo = update.message.photo[-1]  # last element = largest size
    tg_file = await context.bot.get_file(photo.file_id)
    buf = io.BytesIO()
    await tg_file.download_to_memory(buf)
    return base64.b64encode(buf.getvalue()).decode()


# ── Photo analysis helpers ────────────────────────────────────────

def _build_photo_content(photos: list[dict], prompt: str) -> list:
    """Build a list of Anthropic content blocks for one or two photos."""
    blocks: list = []
    for p in photos:
        blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": p["b64"]},
        })
    # Prepend PIL/OpenCV metrics to the text prompt
    valid_metrics = [p["metrics"] for p in photos if p.get("metrics")]
    if valid_metrics:
        prompt = build_metrics_text(valid_metrics) + "\n\n" + prompt
    blocks.append({"type": "text", "text": prompt})
    return blocks


async def _analyse_single(update: Update, context: ContextTypes.DEFAULT_TYPE, photo: dict) -> None:
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=ChatAction.TYPING)
    content = _build_photo_content(
        [photo],
        "Analyse cette image de sol ou de plante. Produis un diagnostic complet avec score de santé /10.",
    )
    try:
        reply = await ask_claude(update.effective_user.id, content, ephemeral=True)
    except anthropic.APIStatusError as exc:
        await update.message.reply_text(
            f"⚠️ Erreur API Anthropic ({exc.status_code}) : {exc.message}"
        )
        return
    except Exception as exc:
        logger.exception("Erreur inattendue lors de l'analyse")
        await update.message.reply_text(f"⚠️ Erreur inattendue : {exc}")
        return
    await reply_safe(update.message, reply)


async def _compare_two(update: Update, context: ContextTypes.DEFAULT_TYPE, photos: list[dict]) -> None:
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=ChatAction.TYPING)
    content = _build_photo_content(
        photos,
        "Compare ces deux terres. Pour chacune : diagnostic rapide + score de santé /10. "
        "Conclus avec une recommandation comparative.",
    )
    try:
        reply = await ask_claude(update.effective_user.id, content, ephemeral=True)
    except anthropic.APIStatusError as exc:
        await update.message.reply_text(
            f"⚠️ Erreur API Anthropic ({exc.status_code}) : {exc.message}"
        )
        return
    except Exception as exc:
        logger.exception("Erreur inattendue lors de la comparaison")
        await update.message.reply_text(f"⚠️ Erreur inattendue : {exc}")
        return
    await reply_safe(update.message, reply)


async def _debounce_single(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    user_id: int,
) -> None:
    """Wait PHOTO_WAIT_SECONDS, then analyse the buffered single photo."""
    await asyncio.sleep(PHOTO_WAIT_SECONDS)
    photos = photo_buffers.pop(user_id, [])
    analysis_tasks.pop(user_id, None)
    if photos:
        await _analyse_single(update, context, photos[0])


# ── Command handlers ──────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(WELCOME_TEXT, parse_mode=ParseMode.MARKDOWN_V2)


async def cmd_aide(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(AIDE_TEXT, parse_mode=ParseMode.MARKDOWN_V2)


# ── Message handlers ──────────────────────────────────────────────

async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id

    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_PHOTO)

    try:
        b64 = await download_photo_b64(update, context)
    except TelegramError as exc:
        await update.message.reply_text(f"⚠️ Impossible de télécharger la photo : {exc}")
        return

    # Run PIL/OpenCV analysis in a thread (CPU-bound)
    loop = asyncio.get_event_loop()
    metrics = await loop.run_in_executor(None, analyze_image, b64)

    photo_info = {"b64": b64, "metrics": metrics}
    buffer = photo_buffers.setdefault(user_id, [])
    buffer.append(photo_info)

    if len(buffer) >= 2:
        # Cancel any pending debounce and compare immediately
        task = analysis_tasks.pop(user_id, None)
        if task:
            task.cancel()
        photos = photo_buffers.pop(user_id)
        await update.message.reply_text("🔬 *2 photos reçues — comparaison en cours...*", parse_mode=ParseMode.MARKDOWN)
        await _compare_two(update, context, photos)

    else:
        # First photo — acknowledge and start debounce timer
        if metrics:
            metrics_preview = (
                f"📊 Pré-analyse rapide :\n"
                f"• Végétation : {metrics['green_pct']} %\n"
                f"• Sol sec : {metrics['brown_pct']} %\n"
                f"• Stress hydrique : {metrics['stress_index']}/10"
            )
            await update.message.reply_text(
                f"📸 *Photo reçue !*\n\n{metrics_preview}\n\n"
                f"_Envoyez une 2ᵉ photo pour comparer, ou attendez {PHOTO_WAIT_SECONDS}s pour l'analyse complète…_",
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await update.message.reply_text(
                f"📸 *Photo reçue !*\n_Envoyez une 2ᵉ photo pour comparer, ou attendez {PHOTO_WAIT_SECONDS}s pour l'analyse complète…_",
                parse_mode=ParseMode.MARKDOWN,
            )

        # Cancel previous debounce if any, then start a new one
        old_task = analysis_tasks.pop(user_id, None)
        if old_task:
            old_task.cancel()
        analysis_tasks[user_id] = asyncio.get_event_loop().create_task(
            _debounce_single(update, context, user_id)
        )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id
    text    = update.message.text.strip()

    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    try:
        reply = await ask_claude(user_id, text)
    except anthropic.APIStatusError as exc:
        await update.message.reply_text(
            f"⚠️ Erreur API ({exc.status_code}) : {exc.message}"
        )
        return
    except anthropic.APIConnectionError:
        await update.message.reply_text(
            "📡 Impossible de joindre l'API Anthropic. Vérifiez votre connexion."
        )
        return
    except Exception as exc:
        logger.exception("Erreur inattendue handle_text")
        await update.message.reply_text(f"⚠️ Erreur inattendue : {exc}")
        return

    await reply_safe(update.message, reply)


# ── Entry point ───────────────────────────────────────────────────

def main() -> None:
    if not TELEGRAM_TOKEN:
        raise SystemExit("❌ TELEGRAM_TOKEN manquant dans .env")
    if not ANTHROPIC_API_KEY:
        raise SystemExit("❌ ANTHROPIC_API_KEY manquant dans .env")

    masked_key = ANTHROPIC_API_KEY[:12] + "..." + ANTHROPIC_API_KEY[-4:]
    logger.info("ANTHROPIC_API_KEY chargée : %s (longueur : %d)", masked_key, len(ANTHROPIC_API_KEY))
    logger.info("Démarrage AgriScan TN Bot…")

    app = (
        Application.builder()
        .token(TELEGRAM_TOKEN)
        .build()
    )

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("aide",  cmd_aide))
    app.add_handler(MessageHandler(filters.PHOTO,                     handle_photo))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND,   handle_text))

    logger.info("Bot en écoute — Ctrl+C pour arrêter")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
