"""Padel Coach on Modal: serves the static PWA (ar-coach), the ideal-swing engine (strikes) and the on-device
pose model (coach/models) over HTTPS, which phones need for camera access. All analysis runs in the phone browser.

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
)
app = modal.App("padel-coach", image=image)


def create_app():
    import mimetypes
    from fastapi import FastAPI
    from fastapi.responses import RedirectResponse
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

    api.mount("/", StaticFiles(directory=SITE, html=True, follow_symlink=True), name="site")
    return api


SITE = "/site"


@app.function(scaledown_window=300, timeout=600)
@modal.asgi_app()
def web():
    return create_app()


if __name__ == "__main__":  # local test without Modal: python deploy/modal_app.py  ->  http://127.0.0.1:8099/
    import os, shutil, tempfile, uvicorn
    tmp = tempfile.mkdtemp()
    for src, dst in [("ar-coach", "ar-coach"), ("strikes", "strikes"), ("coach/models", "coach/models")]:
        os.makedirs(os.path.dirname(os.path.join(tmp, dst)) or tmp, exist_ok=True)
        os.symlink(ROOT / src, os.path.join(tmp, dst))
    SITE = tmp
    uvicorn.run(create_app(), host="127.0.0.1", port=8099)
