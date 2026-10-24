# Open-source attribution

## Adapted source

`kitten_cpu.py` adapts [KittenML/KittenTTS 0.8.1, kittentts/onnx_model.py](https://github.com/KittenML/KittenTTS/blob/0.8.1/kittentts/onnx_model.py), Apache License 2.0. The upstream licence is preserved in [licenses/KittenTTS-LICENSE](licenses/KittenTTS-LICENSE). The inspected official 0.8.1 wheel has SHA-256 `482a436c4f1f3192153710376e459ff3689517ebcda7c2b051e2fd4187b41851`.

Modifications remove unused neural/Spacy dependencies and automatic downloads, preserve model symbol IDs, restrict execution to CPU/local files, bound text/tokens, prepare spoken numbers and remove source text/file logging. The adapter and its modifications are available as source in this repository. This is not an endorsement by KittenML. VoiceStudio is not included.

## Weights and inference

[models.json](models.json) records reviewed model repositories, immutable revisions, allowlisted files and licences. [The setup guide](../../docs/development/local-ai.md) links each authoritative model card. KittenTTS mini 0.8 and Qwen2.5-1.5B-Instruct GGUF are Apache-2.0; faster-whisper base is MIT. Weights remain in the Docker volume with their upstream cards/licence material and generated file-hash receipts.

Runtime sources include [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), [ONNX Runtime](https://github.com/microsoft/onnxruntime) (MIT), [FastAPI](https://github.com/fastapi/fastapi) (MIT), [tokenizers](https://github.com/huggingface/tokenizers) (Apache-2.0), NumPy (BSD and bundled permissive notices), SoundFile/PyAV (BSD), phonemizer-fork/eSpeak NG (GPL), num2words (LGPL), and Debian FFmpeg/libsndfile (LGPL/GPL components). Exact Python versions/hashes are locked in [uv.lock](uv.lock); the installed-image metadata inventory is [licenses/python-packages.json](licenses/python-packages.json). Metadata is supplemented by upstream licences where fields are missing. Debian package copyright/source locations remain in the image under `/usr/share/doc`; Debian source packages and upstream repositories provide corresponding source. Python wheels retain their own licence files.

These are open-source components with different redistribution obligations. Preserve copyright/licence notices and supply corresponding source for GPL/LGPL components when distributing modified binaries/images. This inventory is for the demo's text/speech additions; it is not a replacement for upstream terms or a full application SBOM.

## Demo sample

[The public WAV sample](../../docs/assets/voice/rashid-preview.wav) is synthesized locally from an original Cityside greeting with the reviewed Jasper preset. It contains no recorded person, copied dialogue, music, customer data or cloned identity. No proprietary voice service is used.
