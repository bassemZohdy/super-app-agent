import base64
import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
import app as service


class SpeechTests(unittest.TestCase):
    def setUp(self):
        self.ready = patch.object(service, "ready", return_value=True)
        self.ready.start()
        self.addCleanup(self.ready.stop)
        self.previous_tts, self.previous_asr = service.tts, service.asr
        self.addCleanup(lambda: setattr(service, "tts", self.previous_tts))
        self.addCleanup(lambda: setattr(service, "asr", self.previous_asr))
        service.tts = SimpleNamespace(generate=lambda *args, **kwargs: np.full(2400, 0.1, dtype=np.float32))
        service.asr = SimpleNamespace(transcribe=lambda *args, **kwargs: (iter([SimpleNamespace(text="Show my wallet balance", no_speech_prob=0.01, avg_logprob=-0.1)]), None))
        self.client = TestClient(service.app)

    def test_only_reviewed_preset_and_language_are_accepted(self):
        for extra in ({"voice": "alloy"}, {"language": "ar-AE"}, {"speed": 2}, {"model": "remote-provider"}):
            self.assertEqual(self.client.post("/speech", json={"text": "Hello", **extra}).status_code, 422)
        response = self.client.post("/speech", json={"text": "Marhaba. Your details are on screen.", "voice": "Jasper"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content[:4], b"RIFF")
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_audio_formats_and_decoded_duration_are_bounded(self):
        bad = base64.b64encode(b"#EXTM3U\nhttps://example.invalid/private" * 2).decode()
        with patch.object(service.subprocess, "run") as command:
            self.assertEqual(self.client.post("/transcribe", json={"audioBase64": bad, "format": "audio/webm"}).status_code, 422)
            command.assert_not_called()
        wave = io.BytesIO()
        sf.write(wave, np.full(4000, 0.05), 16000, format="WAV", subtype="PCM_16")
        body = {"audioBase64": base64.b64encode(wave.getvalue()).decode(), "format": "audio/wav"}
        response = self.client.post("/transcribe", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "Show my wallet balance")
        with patch.object(service.subprocess, "run", return_value=SimpleNamespace(stdout=np.ones(16 * 16000, dtype=np.float32).tobytes())):
            self.assertEqual(self.client.post("/transcribe", json=body).status_code, 422)

    def test_silence_produces_no_hallucinated_draft_and_no_retained_file(self):
        wave = io.BytesIO()
        sf.write(wave, np.zeros(4000), 16000, format="WAV", subtype="PCM_16")
        response = self.client.post("/transcribe", json={"audioBase64": base64.b64encode(wave.getvalue()).decode(), "format": "audio/wav"})
        self.assertEqual(response.json()["text"], "")

    def test_browser_origin_missing_models_and_busy_engine_fail_closed(self):
        self.assertEqual(self.client.get("/health", headers={"Origin": "https://other.invalid"}).status_code, 403)
        with patch.object(service, "ready", return_value=False):
            self.assertEqual(self.client.post("/speech", json={"text": "Hello"}).status_code, 503)
        service.lock.acquire()
        try:
            self.assertEqual(self.client.post("/speech", json={"text": "Hello"}).status_code, 429)
        finally:
            service.lock.release()


if __name__ == "__main__":
    unittest.main()
