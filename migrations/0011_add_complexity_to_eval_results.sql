-- migrate:up
-- Benchmark runs now sweep a small suite of prompts spanning complexity tiers (see
-- src/benchmark.py) instead of a single fixed question, so latency/throughput can be
-- correlated against how hard a prompt is, per model/device.
ALTER TABLE eval_results ADD COLUMN prompt_label TEXT;
ALTER TABLE eval_results ADD COLUMN complexity_tier TEXT;
ALTER TABLE eval_results ADD COLUMN complexity_score REAL;

-- migrate:down
ALTER TABLE eval_results DROP COLUMN prompt_label;
ALTER TABLE eval_results DROP COLUMN complexity_tier;
ALTER TABLE eval_results DROP COLUMN complexity_score;
