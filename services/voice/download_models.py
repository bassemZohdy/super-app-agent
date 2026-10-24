"""Explicit, revision-pinned setup. Runtime never downloads an arbitrary model."""
import json
import os
import hashlib
from pathlib import Path
from huggingface_hub import snapshot_download

root = Path(os.environ.get("VOICE_MODEL_DIR", "/models"))
manifest = json.loads(Path(__file__).with_name("models.json").read_text())
for kind in ("tts", "asr", "llm"):
    model = manifest[kind]
    snapshot_download(repo_id=model["repo"], revision=model["revision"], allow_patterns=model["files"], local_dir=root / kind)
    (root / kind / "cityside-revision").write_text(model["revision"])
    receipt = {"repo": model["repo"], "revision": model["revision"], "license": model["license"], "sha256": {}}
    for filename in model["files"]:
        digest = hashlib.sha256()
        with (root / kind / filename).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1048576), b""):
                digest.update(chunk)
        receipt["sha256"][filename] = digest.hexdigest()
    (root / kind / "cityside-receipt.json").write_text(json.dumps(receipt, indent=2))
    print(f"Installed {kind}: {model['repo']} at {model['revision']} ({model['license']}).")
