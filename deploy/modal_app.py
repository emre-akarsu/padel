"""Padel Coach on Modal: serves the static PWA (ar-coach), the ideal-swing engine (strikes) and the on-device
pose model (coach/models) over HTTPS, which phones need for camera access. All analysis runs in the phone browser.

Feedback sink: POST /api/feedback (schema padel.feedback/1, from feedback/feedback.js on GitHub Pages or here) is written
to the Modal Volume "padel-feedback" as items/<YYYY-MM-DD>/<id>.json. Read it with
    modal volume get padel-feedback items ./feedback_dump   then   python feedback/tools/aggregate.py ./feedback_dump

Deploy (from the repo root, gh-pages branch):  modal deploy deploy/modal_app.py
Local check:                                    modal serve deploy/modal_app.py
"""
import pathlib
import modal

ROOT = pathlib.Path(__file__).resolve().parent.parent
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi[standard]==0.115.6")
    .add_local_dir(ROOT / "ar-coach", "/site/ar-coach")
    .add_local_dir(ROOT / "strikes", "/site/strikes")
    .add_local_dir(ROOT / "coach" / "models", "/site/coach/models")
    .add_local_dir(ROOT / "feedback", "/site/feedback", ignore=["tools/**", "*.md"])
)
app = modal.App("padel-coach", image=image)
feedback_vol = modal.Volume.from_name("padel-feedback", create_if_missing=True)
FB_DIR = "/fb"
FB_ORIGINS = ["https://emre-akarsu.github.io", "http://localhost:8099", "http://127.0.0.1:8099", "http://127.0.0.1:8770", "http://localhost:8000"]


def create_app():
    import mimetypes
    import datetime, json, os, re
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, RedirectResponse
    from fastapi.staticfiles import StaticFiles

    for ext, typ in {".onnx": "application/octet-stream", ".glb": "model/gltf-binary", ".usdz": "model/vnd.usdz+zip",
                     ".webmanifest": "application/manifest+json", ".mjs": "text/javascript", ".wasm": "application/wasm"}.items():
        mimetypes.add_type(typ, ext)
    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @api.get("/")
    def root():
        return RedirectResponse("/ar-coach/")

    @api.get("/healthz")
    def health():
        return {"ok": True}

    api.add_middleware(CORSMiddleware, allow_origins=FB_ORIGINS, allow_methods=["POST", "GET"], allow_headers=["Content-Type"])

    @api.get("/api/feedback")
    def feedback_ping():  # write-only sink: nothing is listed over HTTP
        return {"ok": True, "schema": "padel.feedback/1"}

    @api.post("/api/feedback")
    async def feedback(req: Request):
        raw = await req.body()
        if len(raw) > 900_000:
            return JSONResponse({"ok": False, "error": "too large"}, 413)
        try:
            rec = json.loads(raw)
        except ValueError:
            return JSONResponse({"ok": False, "error": "not json"}, 400)
        rid = str(rec.get("id", ""))
        fb = rec.get("feedback") or {}
        if rec.get("schema") != "padel.feedback/1" or not re.fullmatch(r"[A-Za-z0-9-]{6,64}", rid) \
                or not isinstance(fb.get("tags", []), list) or len(str(fb.get("text", ""))) > 5000:
            return JSONResponse({"ok": False, "error": "bad record"}, 400)
        shot = (rec.get("attachments") or {}).get("screenshot")
        if shot and not (isinstance(shot, str) and shot.startswith("data:image/") and len(shot) < 800_000):
            rec["attachments"]["screenshot"] = None
        day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        d = os.path.join(FB_DIR, "items", day)
        os.makedirs(d, exist_ok=True)
        if len(os.listdir(d)) > 5000:
            return JSONResponse({"ok": False, "error": "daily cap"}, 429)
        rec["received"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with open(os.path.join(d, rid + ".json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False)
        if FB_DIR == "/fb":
            feedback_vol.commit()
        return {"ok": True, "id": rid}

    api.mount("/", StaticFiles(directory=SITE, html=True, follow_symlink=True), name="site")
    return api


SITE = "/site"


@app.function(scaledown_window=300, timeout=600, volumes={FB_DIR: feedback_vol})
@modal.asgi_app()
def web():
    return create_app()


if __name__ == "__main__":  # local test without Modal: python deploy/modal_app.py  ->  http://127.0.0.1:8099/
    import os, shutil, tempfile, uvicorn
    tmp = tempfile.mkdtemp()
    for src, dst in [("ar-coach", "ar-coach"), ("strikes", "strikes"), ("coach/models", "coach/models"), ("feedback", "feedback")]:
        os.makedirs(os.path.dirname(os.path.join(tmp, dst)) or tmp, exist_ok=True)
        os.symlink(ROOT / src, os.path.join(tmp, dst))
    SITE = tmp
    FB_DIR = os.environ.get("FB_DIR", os.path.join(tmp, "_fb"))
    uvicorn.run(create_app(), host="127.0.0.1", port=8099)
