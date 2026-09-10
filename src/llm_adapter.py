from __future__ import annotations

import gc
import os
import re
from pathlib import Path
from threading import RLock
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "data" / "models"
DEFAULT_MODEL_PATH = ROOT / "data" / "models" / "Llama-3.2-3B-Instruct-Q5_K_M.gguf"
DEFAULT_DEVICE = "cpu"
DEFAULT_N_CTX = 4096
VALID_DEVICES = ("cpu", "gpu")

# Stops generation before the model starts hallucinating extra turns: small models
# tend to keep going past a real answer by falling back into "Question: ... Answer:
# ..." style completions once the real content runs out.
STOP_SEQUENCES = ["\nQuestion:", "\nQ:"]

_FAMILY_SUFFIX = re.compile(r"[-_][Qq]\d.*$")


class ModelNotFoundError(FileNotFoundError):
    pass


class UnsupportedDeviceError(Exception):
    pass


def list_model_files(models_dir: str | Path | None = None) -> list[dict[str, Any]]:
    """Enumerate GGUF files available for selection. Cheap filesystem scan, no model load."""
    directory = Path(models_dir or MODELS_DIR)
    if not directory.is_dir():
        return []
    files = []
    for path in sorted(directory.glob("*.gguf")):
        files.append(
            {
                "name": path.name,
                "size_bytes": path.stat().st_size,
                "family": _FAMILY_SUFFIX.sub("", path.stem),
            }
        )
    return files


def gpu_available() -> bool:
    """True only if the installed llama-cpp-python build actually has CUDA/GPU offload
    support compiled in. Never guess: a wrong "yes" here would let device="gpu" silently
    fall back to CPU with no indication anything went wrong."""
    try:
        import llama_cpp
    except ImportError:
        return False
    return bool(llama_cpp.llama_supports_gpu_offload())


class LLMAdapter:
    def __init__(self, model_path: str | Path | None = None, models_dir: str | Path | None = None) -> None:
        self.model_path = Path(model_path or os.getenv("LOCALCHAT_LLM_MODEL", DEFAULT_MODEL_PATH))
        self.models_dir = Path(models_dir or MODELS_DIR)
        self._model: Any = None
        self._model_name: str | None = None
        self._device: str = DEFAULT_DEVICE
        self._lock = RLock()

    @property
    def active(self) -> dict[str, str] | None:
        """Whatever is currently loaded and answering /query, or None if nothing is."""
        with self._lock:
            if self._model is None:
                return None
            return {"model": self._model_name or self.model_path.name, "device": self._device}

    def list_models(self) -> list[dict[str, Any]]:
        return list_model_files(self.models_dir)

    def _unload_locked(self) -> None:
        if self._model is not None:
            close = getattr(self._model, "close", None)
            if callable(close):
                close()
            self._model = None
            self._model_name = None
        gc.collect()

    def unload(self) -> None:
        """Frees the currently loaded model (if any) so its RAM/VRAM is released before
        something else - a device swap, or a benchmark run - needs that memory."""
        with self._lock:
            self._unload_locked()

    def _load_locked(self, path: Path, device: str) -> None:
        if not path.is_file():
            raise ModelNotFoundError(
                f"Model not found at {path}. Set LOCALCHAT_LLM_MODEL, or choose one from GET /models."
            )
        if device == "gpu" and not gpu_available():
            raise UnsupportedDeviceError(
                "device=\"gpu\" was requested but this build of llama-cpp-python has no "
                "CUDA/GPU offload support installed. Install the CUDA-enabled wheel, or use device=\"cpu\"."
            )
        from llama_cpp import Llama

        self._unload_locked()
        n_gpu_layers = -1 if device == "gpu" else 0
        self._model = Llama(
            model_path=str(path),
            n_gpu_layers=n_gpu_layers,
            n_ctx=DEFAULT_N_CTX,
            verbose=False,
        )
        self.model_path = path
        self._model_name = path.name
        self._device = device

    def set_active(self, model_name: str, device: str) -> dict[str, str]:
        """The one place a model/device swap happens: unloads whatever is currently loaded
        (if anything) and loads the requested model onto the requested device, returning
        only once it is ready to answer queries."""
        if device not in VALID_DEVICES:
            raise ValueError(f"device must be one of {VALID_DEVICES}, got {device!r}")
        path = self.models_dir / model_name
        if not path.is_file() or path.suffix.lower() != ".gguf":
            raise ModelNotFoundError(f"Model '{model_name}' not found in {self.models_dir}")

        with self._lock:
            if self._model is not None and self._model_name == model_name and self._device == device:
                return {"model": self._model_name, "device": self._device}
            self._load_locked(path, device)
            return {"model": self._model_name, "device": self._device}

    def load_model(self) -> Any:
        """Lazy default load used by generate()/startup preload: activates whatever
        self.model_path currently points at if nothing has been loaded yet."""
        with self._lock:
            if self._model is not None:
                return self._model
            self._load_locked(self.model_path, self._device)
            return self._model

    def count_tokens(self, text: str) -> int:
        """Exact token count via the active model's own tokenizer (loads the default model
        first if nothing is loaded yet - the same lazy load generate() would trigger anyway,
        so counting before generating adds no extra load)."""
        model = self.load_model()
        return len(model.tokenize(text.encode("utf-8"), add_bos=True))

    def context_size(self) -> int:
        """The active model's configured context window, in tokens."""
        model = self.load_model()
        return int(model.n_ctx())

    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        # NOTE: create_chat_completion() (which applies the model's own chat template and
        # stops at its trained end-of-turn token) segfaults the whole process here - it runs
        # cleanly in isolated single-threaded/threaded repro scripts, but crashes reliably
        # once actually called through FastAPI's real async/threadpool request path. Back to
        # raw completion until that's root-caused; see the conversation this was tried in.
        result = self.load_model()(
            prompt,
            max_tokens=max_tokens,
            temperature=0.1,
            top_p=0.9,
            # At this low a temperature, small models easily fall into repeating the
            # same sentence block once they run out of real content; this penalizes
            # re-using recently generated tokens to break that loop.
            repeat_penalty=1.3,
            stop=STOP_SEQUENCES,
        )
        return str(result["choices"][0]["text"]).strip()


llm_adapter = LLMAdapter()


def load_model() -> Any:
    return llm_adapter.load_model()


def generate(prompt: str, max_tokens: int = 512) -> str:
    return llm_adapter.generate(prompt, max_tokens=max_tokens)


def count_tokens(text: str) -> int:
    return llm_adapter.count_tokens(text)


def context_size() -> int:
    return llm_adapter.context_size()
