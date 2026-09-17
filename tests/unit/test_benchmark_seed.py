from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.benchmark_seed import seed_from_csv
from src.db import Base
from src.models.benchmark_job import BenchmarkJob
from src.models.eval_result import EvalResult

FIXTURE = Path(__file__).parent / "fixtures" / "merged_benchmarks.csv"


def _session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_seed_from_csv_creates_one_job_per_machine():
    with _session() as db:
        inserted = seed_from_csv(db, FIXTURE)

        assert inserted == 4
        jobs = db.query(BenchmarkJob).order_by(BenchmarkJob.id).all()
        assert len(jobs) == 2
        assert all(job.status == "completed" for job in jobs)


def test_seed_from_csv_marks_ok_and_missing_measurements():
    with _session() as db:
        seed_from_csv(db, FIXTURE)

        rows = {(row.model, row.device): row for row in db.query(EvalResult).all()}

        measured = rows[("Llama-3.2-1B-Instruct-Q5_K_M.gguf", "gpu")]
        assert measured.status == "ok"
        assert measured.tok_s == 208.1
        assert measured.device_name == "Apple M3 Max"
        assert measured.detail is None

        blank = rows[("gemma-2-27b-it-Q5_K_M.gguf", "gpu")]
        assert blank.status == "error"
        assert blank.tok_s is None
        assert blank.detail is not None

        # This CSV is a prompt-sweep summary, not a single measured question.
        assert measured.prompt_label is None
        assert measured.question is None


def test_seed_from_csv_falls_back_to_source_file_for_a_blank_machine_column():
    with _session() as db:
        seed_from_csv(db, FIXTURE)

        jobs = db.query(BenchmarkJob).all()
        # This fixture row has no "machine" value, so its label comes from
        # source_file="results_nomachine.csv" -> "nomachine", in its own job rather than
        # merging into the other machine's.
        assert any(job.models == ["gemma-2-27b-it-Q5_K_M.gguf"] for job in jobs)


def test_seed_from_csv_is_a_noop_once_every_machine_is_already_represented():
    with _session() as db:
        seed_from_csv(db, FIXTURE)
        first_count = db.query(EvalResult).count()
        assert first_count > 0

        seed_from_csv(db, FIXTURE)
        assert db.query(EvalResult).count() == first_count


def test_seed_from_csv_skips_a_machine_whose_hardware_already_has_real_results():
    """The actual bug this file exists to catch: a developer's own machine already has real
    benchmark history (this is the common case, not an empty database), and the old
    "only seed an empty table" gate meant the OTHER machine's rows in the CSV never got
    imported at all - not just that this machine's rows were skipped."""
    with _session() as db:
        # A real (non-seeded) row already sitting in eval_results for the fixture's
        # "patrik-macbook" hardware, as if that machine had run its own benchmark.
        job = BenchmarkJob(
            status="completed",
            devices=["cpu"],
            models=["some-other-model.gguf"],
            total_runs=1,
            completed_runs=1,
            created_at=datetime.utcnow(),
        )
        db.add(job)
        db.flush()
        db.add(
            EvalResult(
                benchmark_job_id=job.id,
                model="some-other-model.gguf",
                device="cpu",
                device_name="Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz",
                status="ok",
                tok_s=12.0,
                run_at=datetime.utcnow(),
            )
        )
        db.commit()

        inserted = seed_from_csv(db, FIXTURE)

        # The "nomachine" group's hardware (Intel i7-9700K / RTX 2070) is already present,
        # so only the other group's 2 rows (Llama-3.2-1B on patrik-macbook) get imported.
        assert inserted == 2
        models = {row.model for row in db.query(EvalResult).all()}
        assert "Llama-3.2-1B-Instruct-Q5_K_M.gguf" in models
        assert "gemma-2-27b-it-Q5_K_M.gguf" not in models
