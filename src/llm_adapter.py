from __future__ import annotations

import os
from pathlib import Path
from threading import Lock
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_PATH = ROOT / "data" / "models" / "Phi-4-mini-instruct-Q4_K_M.gguf"


class LLMAdapter:
    def __init__(self, model_path: str | Path | None = None):
        self.model_path = Path(model_path or os.getenv("LOCALCHAT_LLM_MODEL", DEFAULT_MODEL_PATH))
        self._model: Any = None
        self._lock = Lock()

    def load_model(self) -> Any:
        if self._model is None:
            with self._lock:
                if self._model is None:
                    if not self.model_path.is_file():
                        raise FileNotFoundError(
                            f"Phi-4 Mini model not found at {self.model_path}. "
                            "Set LOCALCHAT_LLM_MODEL to the GGUF file path."
                        )
                    from llama_cpp import Llama

                    self._model = Llama(
                        model_path=str(self.model_path),
                        n_gpu_layers=0,
                        verbose=False,
                    )
        return self._model

    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        result = self.load_model()(prompt, max_tokens=max_tokens, temperature=0.1, top_p=0.9)
        return str(result["choices"][0]["text"]).strip()


llm_adapter = LLMAdapter()


def load_model() -> Any:
    return llm_adapter.load_model()


def generate(prompt: str, max_tokens: int = 512) -> str:
    return llm_adapter.generate(prompt, max_tokens=max_tokens)