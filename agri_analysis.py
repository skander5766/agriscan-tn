"""
Shared image analysis logic (PIL + OpenCV).
Imported by both main.py (FastAPI) and telegram_bot.py.
"""
from __future__ import annotations

import base64
import copy
import io
from typing import Optional

import cv2
import numpy as np
from PIL import Image


def analyze_image(b64_data: str) -> Optional[dict]:
    """
    Compute 4 soil health metrics from a base64-encoded image.
    Returns None if analysis fails.
    """
    try:
        raw = base64.b64decode(b64_data)
        pil_img = Image.open(io.BytesIO(raw)).convert("RGB")
        pil_img.thumbnail((640, 640), Image.LANCZOS)

        img_rgb = np.array(pil_img, dtype=np.uint8)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

        total = img_hsv.shape[0] * img_hsv.shape[1]

        # Vegetation green: H:[35–85] S:[40–255] V:[40–255]
        mask_green = cv2.inRange(
            img_hsv,
            np.array([35,  40,  40], dtype=np.uint8),
            np.array([85, 255, 255], dtype=np.uint8),
        )
        green_pct = round(float(np.count_nonzero(mask_green)) / total * 100, 1)

        # Dry/brown soil: H:[8–25] S:[30–200] V:[50–210]
        mask_brown = cv2.inRange(
            img_hsv,
            np.array([ 8, 30,  50], dtype=np.uint8),
            np.array([25, 200, 210], dtype=np.uint8),
        )
        brown_pct = round(float(np.count_nonzero(mask_brown)) / total * 100, 1)

        # Average brightness (V channel, normalised 0–100 %)
        brightness = round(float(np.mean(img_hsv[:, :, 2])) / 255 * 100, 1)

        # Water-stress index (0 = no stress, 10 = extreme stress)
        veg_total    = green_pct + brown_pct
        color_ratio  = brown_pct / veg_total if veg_total > 0 else 0.5
        bright_stress = 1.0 - (brightness / 100.0)
        stress_index  = round(min(10.0, color_ratio * 7.0 + bright_stress * 3.0), 1)

        return {
            "green_pct":    green_pct,
            "brown_pct":    brown_pct,
            "brightness":   brightness,
            "stress_index": stress_index,
        }

    except Exception as exc:
        print(f"[analyze_image] failed: {exc}")
        return None


def build_metrics_text(metrics_list: list[dict]) -> str:
    """Format metrics as structured text for injection into the Claude prompt."""
    lines = ["📊 [Pré-analyse automatique PIL/OpenCV]"]
    for i, m in enumerate(metrics_list):
        prefix = f"Image {i + 1} — " if len(metrics_list) > 1 else ""
        lines += [
            f"{prefix}Végétation verte    : {m['green_pct']} %",
            f"{prefix}Sol sec / brun      : {m['brown_pct']} %",
            f"{prefix}Luminosité moyenne  : {m['brightness']} %",
            f"{prefix}Stress hydrique     : {m['stress_index']} / 10",
        ]
    lines.append(
        "Utilise ces données objectives pour affiner ton diagnostic "
        "et les mentionner explicitement dans ta réponse."
    )
    return "\n".join(lines)


def enrich_messages(messages: list) -> list:
    """
    Inject PIL/OpenCV metrics into the last user message that contains images,
    just before forwarding to Claude.
    """
    messages = copy.deepcopy(messages)

    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue

        images = [
            blk for blk in content
            if blk.get("type") == "image"
            and blk.get("source", {}).get("type") == "base64"
        ]
        if not images:
            continue

        results = [analyze_image(img["source"]["data"]) for img in images]
        results = [r for r in results if r is not None]
        if not results:
            break

        metrics_text = build_metrics_text(results)

        text_block = next((b for b in content if b.get("type") == "text"), None)
        if text_block:
            text_block["text"] = metrics_text + "\n\n" + text_block["text"]
        else:
            content.append({"type": "text", "text": metrics_text})
        break

    return messages
