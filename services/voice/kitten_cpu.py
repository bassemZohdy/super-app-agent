"""Minimal CPU adapter for KittenTTS 0.8 ONNX weights.

Adapted from KittenML/KittenTTS 0.8.1, kittentts/onnx_model.py (Apache-2.0).
Changes: remove unused neural/Spacy dependencies, bounded tokens, explicit CPU
threads, local pinned files, number preparation and no text/file logging.
Original source and notice are recorded in THIRD_PARTY.md and licenses/.
"""
import json
import re
from decimal import Decimal
from pathlib import Path
import numpy as np
import onnxruntime as ort
from num2words import num2words
from phonemizer.backend import EspeakBackend


class KittenCPU:
    def __init__(self, folder: Path):
        config = json.loads((folder / "config.json").read_text())
        self.voices = np.load(folder / config["voices"], allow_pickle=False)
        self.aliases = config["voice_aliases"]
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(folder / config["model_file"]), sess_options=options, providers=["CPUExecutionProvider"])
        self.phonemizer = EspeakBackend(language="en-us", preserve_punctuation=True, with_stress=True)
        # Preserve the published model's exact symbol IDs, including repeated symbols.
        symbols = "$" + ';:,.!?¡¿—…"«»"" ' + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" + "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ"
        self.symbols = {symbol: index for index, symbol in enumerate(symbols)}

    def _chunk(self, text: str, voice: str, speed: float) -> np.ndarray:
        phonemes = self.phonemizer.phonemize([text])[0]
        phonemes = " ".join(re.findall(r"\w+|[^\w\s]", phonemes))
        tokens = [0] + [self.symbols[c] for c in phonemes if c in self.symbols] + [10, 0]
        if len(tokens) > 500:
            words = text.split()
            if len(words) < 2:
                raise ValueError("Speech token bound exceeded")
            mid = len(words) // 2
            return np.concatenate([self._chunk(" ".join(words[:mid]), voice, speed), self._chunk(" ".join(words[mid:]), voice, speed)])
        style = self.voices[self.aliases[voice]]
        ref = min(len(text), style.shape[0] - 1)
        result = self.session.run(None, {"input_ids": np.array([tokens], dtype=np.int64), "style": style[ref:ref + 1], "speed": np.array([speed], dtype=np.float32)})[0]
        return np.asarray(result[..., :-5000]).reshape(-1)

    def generate(self, text: str, voice: str, speed: float) -> np.ndarray:
        text = re.sub(r"\bAED\s*([0-9][0-9,.]*)", r"\1 dirhams", text)
        text = re.sub(r"\d[\d,]*(?:\.\d+)?", lambda m: num2words(Decimal(m[0].replace(",", ""))), text)
        if len(text) > 800:
            raise ValueError("Expanded speech exceeds the bounded local request")
        chunks = []
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            words = sentence.split()
            chunks.extend(" ".join(words[i:i + 14]) for i in range(0, len(words), 14))
        return np.concatenate([self._chunk(chunk, voice, speed) for chunk in chunks])
