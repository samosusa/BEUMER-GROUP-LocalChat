"""Retrieval and conversation settings that the conversation benchmark compares.

Each switch keeps the previous behaviour reachable, so a benchmark can measure an
improvement against what it replaced on the same corpus and the same model instead of
against memory. Defaults are the current behaviour; environment variables override them
for a whole process, and `override()` changes them temporarily for one benchmark variant.

  history_mode     "compact" - the query rewriter sees only the subject of each earlier
                   question and the first sentence of each earlier answer; the answer
                   prompt keeps the questions but also shortens the answers.
                   "full" - every earlier question and answer verbatim.
  fusion           "rrf" - a rewritten follow-up searches both the rewrite and the user's
                   own words and merges the two rankings with reciprocal rank fusion.
                   "fallback" - search the rewrite, and only if it finds nothing usable
                   retry with the user's words.
  hybrid           True - keyword (BM25) and vector search, merged with RRF.
                   False - vector search only.
  selection        "adaptive" - always fetch `candidate_pool` passages and keep those
                   scoring at least `relative_cutoff` x the best one, between
                   `min_chunks` and `max_chunks`.
                   "tiered" - guess the passage count from the question's complexity tier.

`override()` mutates process-wide state. It exists for benchmarks and tests, which run
one variant at a time; it is not meant to be toggled per request in the running service.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass, replace
from typing import Iterator

HISTORY_MODES = ("compact", "full")
FUSION_MODES = ("rrf", "fallback")
SELECTION_MODES = ("adaptive", "tiered")


@dataclass(frozen=True)
class RagSettings:
    history_mode: str = "compact"
    fusion: str = "rrf"
    hybrid: bool = True
    selection: str = "adaptive"
    candidate_pool: int = 10
    relative_cutoff: float = 0.85
    min_chunks: int = 2
    max_chunks: int = 8
    # The constant from the original RRF paper (Cormack et al., 2009). It damps the
    # difference between rank 1 and rank 2 so that one list cannot dominate the merge.
    rrf_k: int = 60

    def __post_init__(self) -> None:
        if self.history_mode not in HISTORY_MODES:
            raise ValueError(f"history_mode must be one of {HISTORY_MODES}, got {self.history_mode!r}")
        if self.fusion not in FUSION_MODES:
            raise ValueError(f"fusion must be one of {FUSION_MODES}, got {self.fusion!r}")
        if self.selection not in SELECTION_MODES:
            raise ValueError(f"selection must be one of {SELECTION_MODES}, got {self.selection!r}")
        if not 0 < self.relative_cutoff <= 1:
            raise ValueError("relative_cutoff must be in (0, 1]")
        if not 1 <= self.min_chunks <= self.max_chunks <= self.candidate_pool:
            raise ValueError("need 1 <= min_chunks <= max_chunks <= candidate_pool")


def _from_env() -> RagSettings:
    defaults = RagSettings()
    hybrid_env = os.getenv("LOCALCHAT_HYBRID")
    return RagSettings(
        history_mode=os.getenv("LOCALCHAT_HISTORY_MODE", defaults.history_mode),
        fusion=os.getenv("LOCALCHAT_FUSION", defaults.fusion),
        hybrid=defaults.hybrid if hybrid_env is None else hybrid_env.strip().lower() not in ("0", "false", "no"),
        selection=os.getenv("LOCALCHAT_SELECTION", defaults.selection),
    )


_settings = _from_env()


def get() -> RagSettings:
    return _settings


@contextmanager
def override(**changes) -> Iterator[RagSettings]:
    global _settings
    previous = _settings
    _settings = replace(previous, **changes)
    try:
        yield _settings
    finally:
        _settings = previous
