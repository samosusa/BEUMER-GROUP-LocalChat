"""Conversation benchmark CLI: compares retrieval/history settings on scripted multi-turn
conversations and on the single-question set. See src/conversation_benchmark.py for what is
measured and why.

Runs in its own database and vector directory under data/eval_runs/<timestamp>/, so it never
touches the app's documents: the demo corpus in data/demo-inputs/ is ingested there fresh,
each document titled by its file stem (the same title the app gives an upload), which is
what the datasets' expected sources refer to.

Usage:
    python scripts/conversation_benchmark.py                      # retrieval scores, all variants
    python scripts/conversation_benchmark.py --answers --device gpu   # + generated answers, judged
    python scripts/conversation_benchmark.py --answers --device gpu --judge-model Qwen2.5-7B-Instruct-Q5_K_M.gguf
    python scripts/conversation_benchmark.py --variants baseline improved
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEMO_INPUTS = ROOT / "data" / "demo-inputs"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variants", nargs="+", help="Settings variants to compare (default: all)")
    parser.add_argument("--answers", action="store_true", help="Also generate and judge every conversation turn")
    parser.add_argument("--skip-questions", action="store_true", help="Skip the single-question retrieval pass")
    parser.add_argument("--skip-conversations", action="store_true", help="Skip the conversation pass")
    parser.add_argument("--model", help="GGUF file in data/models/ (default: the app's default model)")
    parser.add_argument("--judge-model", help="GGUF that grades the answers (default: the answering model)")
    parser.add_argument("--device", choices=("cpu", "gpu"), default="cpu")
    parser.add_argument("--out", type=Path, help="Run directory (default: data/eval_runs/<timestamp>)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_dir = args.out or ROOT / "data" / "eval_runs" / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    # Before any src import: the retriever and vector store read these when they run.
    os.environ["LOCALCHAT_VECTOR_DIR"] = str(run_dir / "vectors")

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src import conversation_benchmark as bench
    from src import llm_adapter as llm
    from src.db import Base
    from src.ingest.pipeline import run_pipeline
    from src.models.ingestion_job import IngestionJob
    from src.models.project import Project  # noqa: F401 - registers `projects`; Document FKs into it
    from src.rag_eval import judge

    variants = args.variants or list(bench.VARIANTS)
    unknown = [name for name in variants if name not in bench.VARIANTS]
    if unknown:
        sys.exit(f"Unknown variant(s) {unknown}; choose from {list(bench.VARIANTS)}")

    engine = create_engine(f"sqlite:///{run_dir / 'benchmark.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()

    print(f"Ingesting demo corpus into {run_dir}")
    for path in sorted(DEMO_INPUTS.rglob("*.*")):
        job = IngestionJob(status="running", offset=0, total_chunks=0, created_at=datetime.utcnow())
        db.add(job)
        db.commit()
        run_pipeline(db, job.id, path.stem, path)

    needs_llm = not args.skip_conversations
    if needs_llm:
        model = args.model or llm.DEFAULT_MODEL_PATH.name
        print(f"Loading {model} on {args.device}")
        llm.llm_adapter.set_active(model, args.device)

    results: dict = {"run_dir": str(run_dir), "variants": {name: bench.settings_for(name) for name in variants},
                     "answers": args.answers, "model": llm.llm_adapter.active if needs_llm else None,
                     "conversations": {}, "questions": {}}
    turn_rows, question_rows = [], []

    if not args.skip_questions:
        dataset = bench.load_questions()
        for name in variants:
            scores = bench.run_questions(db, dataset, name)
            question_rows += scores
            results["questions"][name] = bench.summarize(scores, group_by=("difficulty", "type"))
            print(f"[questions] {name}: {results['questions'][name]['overall']}")

    if not args.skip_conversations:
        conversations = bench.load_conversations()
        for name in variants:
            # Generate everything first and judge afterwards, so the judge can be a different
            # (stronger) model without swapping models on the GPU for every turn.
            turn_rows += bench.run_conversations(db, conversations, name, answers=args.answers)
            print(f"[conversations] {name}: done")
        if args.answers:
            if args.judge_model:
                print(f"Loading judge {args.judge_model} on {args.device}")
                llm.llm_adapter.set_active(args.judge_model, args.device)
            results["judge_model"] = llm.llm_adapter.active
            bench.judge_turns(turn_rows, conversations, judge)
        for name in variants:
            scores = [row for row in turn_rows if row.variant == name]
            results["conversations"][name] = bench.summarize(scores, group_by=("kind",))
            print(f"[conversations] {name}: {results['conversations'][name]['overall']}")

    (run_dir / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    for filename, rows in (("turns.csv", turn_rows), ("questions.csv", question_rows)):
        if rows:
            with (run_dir / filename).open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(asdict(rows[0])))
                writer.writeheader()
                writer.writerows(asdict(row) for row in rows)
    (run_dir / "summary.md").write_text(render_summary(results), encoding="utf-8")
    print(f"\nWrote {run_dir / 'summary.md'}")
    print(render_summary(results))


def _pct(value) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def render_summary(results: dict) -> str:
    lines = ["# Conversation benchmark", ""]
    if results["model"]:
        lines += [f"Model: {results['model']['model']} ({results['model']['device']}); "
                  f"generated answers: {'yes' if results['answers'] else 'no'}", ""]
    if results.get("judge_model"):
        lines += [f"Judge: {results['judge_model']['model']}", ""]
    lines += ["| Variant | history | fusion | hybrid | selection |", "|---|---|---|---|---|"]
    for name, settings in results["variants"].items():
        lines.append(f"| {name} | {settings['history_mode']} | {settings['fusion']} | "
                     f"{settings['hybrid']} | {settings['selection']} |")
    if results["conversations"]:
        judged = any("judge_correct" in s["overall"] for s in results["conversations"].values())
        lines += ["", "## Conversations (all turns)", "",
                  "| Variant | Source hit | Top-1 | Evidence hit | Precision | Chunks | Refused unanswerable"
                  + (" | Judge correct | Judge partial |" if judged else " |"),
                  "|---|---|---|---|---|---|---" + ("|---|---|" if judged else "|")]
        for name, summary in results["conversations"].items():
            o = summary["overall"]
            row = (f"| {name} | {_pct(o['source_hit'])} | {_pct(o['top1_hit'])} | {_pct(o['evidence_hit'])} | "
                   f"{_pct(o['precision'])} | {o['selected']} | {_pct(o.get('refused_unanswerable'))}")
            row += f" | {_pct(o.get('judge_correct'))} | {_pct(o.get('judge_partial'))} |" if judged else " |"
            lines.append(row)
        lines += ["", "## Conversations: follow-up turns only", "",
                  "| Variant | Source hit | Top-1 | Evidence hit | Precision | Chunks | Rewritten |",
                  "|---|---|---|---|---|---|---|"]
        for name, summary in results["conversations"].items():
            f = summary["by_kind"].get("followup")
            if f:
                lines.append(f"| {name} | {_pct(f['source_hit'])} | {_pct(f['top1_hit'])} | "
                             f"{_pct(f['evidence_hit'])} | {_pct(f['precision'])} | {f['selected']} | "
                             f"{_pct(f['rewritten'])} |")
    if results["questions"]:
        lines += ["", "## Single questions (retrieval only)", "",
                  "| Variant | Source hit | Top-1 | Evidence hit | Precision | Chunks |",
                  "|---|---|---|---|---|---|"]
        for name, summary in results["questions"].items():
            o = summary["overall"]
            lines.append(f"| {name} | {_pct(o['source_hit'])} | {_pct(o['top1_hit'])} | "
                         f"{_pct(o['evidence_hit'])} | {_pct(o['precision'])} | {o['selected']} |")
        lines += ["", "### By difficulty: evidence hit / precision / chunks", "",
                  "| Variant | easy | medium | hard |", "|---|---|---|---|"]
        for name, summary in results["questions"].items():
            cells = []
            for level in ("easy", "medium", "hard"):
                b = summary["by_difficulty"].get(level)
                cells.append("-" if not b else f"{_pct(b['evidence_hit'])} / {_pct(b['precision'])} / {b['selected']}")
            lines.append(f"| {name} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
