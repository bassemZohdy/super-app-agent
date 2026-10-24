"""CPU-only speech data plane. No cloud fallback, cloning, raw-audio retention or tool execution."""
import base64
import io
import json
import os
import re
import subprocess
import threading
from pathlib import Path
from typing import Literal

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(os.environ.get("VOICE_MODEL_DIR", "/models"))
MANIFEST = json.loads(Path(__file__).with_name("models.json").read_text())
VOICES = ("Jasper", "Bruno", "Hugo", "Luna")
app = FastAPI(title="Cityside local speech", docs_url=None, redoc_url=None)
lock = threading.Lock()
tts = None
asr = None


def ready(kind: str) -> bool:
    folder = ROOT / kind
    try:
        return (folder / "cityside-revision").read_text() == MANIFEST[kind]["revision"] and all((folder / f).is_file() for f in MANIFEST[kind]["files"])
    except OSError:
        return False


@app.middleware("http")
async def bounds(request: Request, call_next):
    if request.headers.get("origin"):
        return Response(status_code=403)
    # This service is private to core; do not accept unbounded chunked uploads.
    if request.method == "POST" and not request.headers.get("content-length"):
        return Response(status_code=411)
    try:
        if int(request.headers.get("content-length", "0")) > 65536:
            return Response(status_code=413)
    except ValueError:
        return Response(status_code=400)
    return await call_next(request)


class Speech(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=480)
    voice: Literal["Jasper", "Bruno", "Hugo", "Luna"] = "Jasper"
    speed: float = Field(default=1.0, ge=0.8, le=1.2, allow_inf_nan=False)
    language: Literal["en-US"] = "en-US"


class Recording(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audioBase64: str = Field(min_length=16, max_length=60000)
    format: Literal["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"]
    language: Literal["en-US", "ar-AE"] = "en-US"


@app.get("/health")
def health():
    return {"status": "ok", "ttsReady": ready("tts"), "asrReady": ready("asr"), "localOnly": True}


@app.post("/speech")
def speech(body: Speech):
    global tts
    if not ready("tts"):
        raise HTTPException(503, "Local speech models have not been prepared.")
    if not body.text.strip() or re.search(r"[\u0600-\u06ff]", body.text):
        raise HTTPException(422, "This preset speaks English. Arabic replies remain available as text.")
    if not lock.acquire(blocking=False):
        raise HTTPException(429, "Local voice is busy. Try again shortly.")
    try:
        if tts is None:
            from kitten_cpu import KittenCPU
            tts = KittenCPU(ROOT / "tts")
        if any(len(word) > 48 for word in body.text.split()):
            raise HTTPException(422, "Use a shorter spoken reply; long references stay on screen.")
        try:
            audio = tts.generate(body.text, voice=body.voice, speed=body.speed)
        except ValueError:
            raise HTTPException(422, "Shorten this spoken reply; the full details remain on screen.")
        if not audio.size or audio.size > 24000 * 45 or not np.isfinite(audio).all():
            raise HTTPException(422, "The spoken reply exceeded the local playback limit.")
        output = io.BytesIO()
        sf.write(output, audio, 24000, format="WAV", subtype="PCM_16")
        return Response(output.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})
    finally:
        lock.release()


@app.post("/transcribe")
def transcribe(body: Recording):
    global asr
    if not ready("asr"):
        raise HTTPException(503, "Local dictation models have not been prepared.")
    try:
        data = base64.b64decode(body.audioBase64, validate=True)
    except ValueError:
        raise HTTPException(422, "Invalid audio encoding.")
    if not 32 <= len(data) <= 45000:
        raise HTTPException(413, "Keep microphone drafts short.")
    signatures = {"audio/webm": data.startswith(b"\x1a\x45\xdf\xa3"), "audio/ogg": data.startswith(b"OggS"), "audio/wav": data.startswith(b"RIFF") and data[8:12] == b"WAVE", "audio/mp4": data[4:8] == b"ftyp"}
    if not signatures[body.format]:
        raise HTTPException(422, "Audio does not match its declared format.")
    if not lock.acquire(blocking=False):
        raise HTTPException(429, "Local voice is busy. Try again shortly.")
    try:
        try:
            # No shell, files, or unlimited decode: cap even highly compressed malicious input at 16 seconds.
            input_format = {"audio/webm": "matroska", "audio/ogg": "ogg", "audio/mp4": "mov", "audio/wav": "wav"}[body.format]
            decoded = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "pipe", "-f", input_format, "-i", "pipe:0", "-t", "16", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, check=True).stdout
        except (subprocess.SubprocessError, OSError):
            raise HTTPException(422, "The microphone recording could not be decoded.")
        audio = np.frombuffer(decoded, dtype=np.float32)
        if audio.size > 15 * 16000:
            raise HTTPException(422, "Keep microphone drafts under 15 seconds.")
        if audio.size < 1600 or not np.isfinite(audio).all() or float(np.sqrt(np.mean(audio ** 2))) < 0.002:
            return {"text": "", "language": body.language, "localOnly": True}
        if asr is None:
            from faster_whisper import WhisperModel
            asr = WhisperModel(str(ROOT / "asr"), device="cpu", compute_type="int8", cpu_threads=2, num_workers=1, local_files_only=True)
        segments, _ = asr.transcribe(audio, language=body.language[:2], beam_size=1, condition_on_previous_text=False, vad_filter=False, initial_prompt="Dubai, Rashid, DEWA, Salik, Etisalat, Ejari.")
        text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob < 0.6 and segment.avg_logprob > -1.0).strip()[:4000]
        return {"text": text, "language": body.language, "localOnly": True}
    finally:
        lock.release()
