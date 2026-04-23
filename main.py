import json
import os
from pathlib import Path

import anthropic as anthropic_sdk
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from agri_analysis import enrich_messages

load_dotenv()

app = FastAPI()
BASE_DIR = Path(__file__).parent

# ---- Fichiers statiques ----
app.mount("/css", StaticFiles(directory=BASE_DIR / "css"), name="css")
app.mount("/js",  StaticFiles(directory=BASE_DIR / "js"),  name="js")

@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html")


# ================================================================
#  Endpoint proxy Anthropic
# ================================================================

@app.post("/api/messages")
async def proxy_messages(request: Request):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or api_key == "VOTRE_CLE_ICI":
        return JSONResponse(
            status_code=500,
            content={"error": {"message": "ANTHROPIC_API_KEY non configurée sur le serveur."}},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "Corps de requête JSON invalide."}},
        )

    # Enrichir les messages avec la pré-analyse si des images sont présentes
    enriched_messages = enrich_messages(body["messages"])

    client = anthropic_sdk.AsyncAnthropic(api_key=api_key)

    try:
        response = await client.messages.create(
            model=body["model"],
            max_tokens=body["max_tokens"],
            system=body.get("system", ""),
            messages=enriched_messages,
        )
        return JSONResponse(content=json.loads(response.model_dump_json()))

    except anthropic_sdk.APIStatusError as e:
        msg = getattr(e, "message", str(e))
        return JSONResponse(
            status_code=e.status_code,
            content={"error": {"message": msg}},
        )
    except anthropic_sdk.APIConnectionError:
        return JSONResponse(
            status_code=502,
            content={"error": {"message": "Impossible de joindre l'API Anthropic."}},
        )
    except Exception as e:
        print(f"Erreur inattendue : {e}")
        return JSONResponse(
            status_code=502,
            content={"error": {"message": "Erreur interne du serveur."}},
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 3000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
