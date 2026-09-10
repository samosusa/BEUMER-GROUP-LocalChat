from src.benchmark import BENCHMARK_PROMPTS, run_one
from src.complexity import TIERS, measure_complexity


def test_benchmark_prompts_cover_every_complexity_tier():
    labels = {spec["label"] for spec in BENCHMARK_PROMPTS}
    assert labels == set(TIERS)


def test_benchmark_prompts_actually_land_on_their_labelled_tier():
    for spec in BENCHMARK_PROMPTS:
        assert measure_complexity(spec["question"]).tier == spec["label"]


def test_run_one_skips_gpu_without_support_but_still_tags_complexity(monkeypatch):
    monkeypatch.setattr("src.benchmark.gpu_available", lambda: False)
    prompt_spec = BENCHMARK_PROMPTS[0]

    from pathlib import Path

    row = run_one(Path("fake-model.gguf"), "gpu", prompt_spec)

    assert row.status == "skipped"
    assert row.prompt_label == prompt_spec["label"]
    assert row.complexity_tier == prompt_spec["label"]
