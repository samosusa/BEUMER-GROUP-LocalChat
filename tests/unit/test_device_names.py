"""
Hardware identification across the machines this actually runs on.

Every probe is mocked: the point is that the code picks the right tool for the platform and
reads its output correctly, which cannot be tested by running it on one developer's laptop.
The lspci and rocm-smi samples are real output, not invented shapes.
"""

from __future__ import annotations

import pytest

from src import benchmark


@pytest.fixture(autouse=True)
def _clear_caches():
    """The probes are cached for the length of a run; tests must not inherit each other's."""
    benchmark._gpu_device_name.cache_clear()
    benchmark._cpu_device_name.cache_clear()
    yield
    benchmark._gpu_device_name.cache_clear()
    benchmark._cpu_device_name.cache_clear()


def _probes(monkeypatch, answers: dict[str, str | None], system: str = "Linux"):
    """Answer each probe by its command name; anything unlisted behaves as not installed."""

    def fake_probe(command: list[str]) -> str | None:
        return answers.get(command[0])

    monkeypatch.setattr(benchmark, "_probe", fake_probe)
    monkeypatch.setattr(benchmark.platform, "system", lambda: system)


# --- GPU -------------------------------------------------------------------


def test_gpu_prefers_nvidia_smi(monkeypatch):
    _probes(monkeypatch, {"nvidia-smi": "NVIDIA GeForce RTX 3060\n"})
    assert benchmark._gpu_device_name() == "NVIDIA GeForce RTX 3060"


def test_gpu_falls_back_to_rocm(monkeypatch):
    _probes(
        monkeypatch,
        {"rocm-smi": "device,Card series\ncard0,Radeon RX 7900 XTX\n"},
    )
    assert benchmark._gpu_device_name() == "Radeon RX 7900 XTX"


def test_gpu_on_macos_asks_about_the_display_not_the_cpu(monkeypatch):
    """
    machdep.cpu.brand_string names the GPU correctly on Apple Silicon by accident, because
    both sit on one die - and names the wrong component entirely on an Intel Mac.
    """
    _probes(
        monkeypatch,
        {
            "system_profiler": "Graphics/Displays:\n\n    Apple M2 Pro:\n\n"
            "      Chipset Model: Apple M2 Pro\n      Type: GPU\n",
            "sysctl": "Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz",
        },
        system="Darwin",
    )
    assert benchmark._gpu_device_name() == "Apple M2 Pro"


def test_gpu_on_linux_reads_lspci_without_tearing_the_name(monkeypatch):
    """
    -mm quotes each field but leaves an unquoted revision between them, so splitting on
    '" "' cuts the device name in half and glues the subsystem vendor onto it.
    """
    _probes(
        monkeypatch,
        {
            "lspci": (
                '00:00.0 "Host bridge" "Intel Corporation" "Device 1234" "" ""\n'
                '01:00.0 "VGA compatible controller" "NVIDIA Corporation" '
                '"GA106 [GeForce RTX 3060]" -ra1 "Gigabyte Technology Co., Ltd" "Device 4067"\n'
            )
        },
    )
    assert benchmark._gpu_device_name() == "NVIDIA Corporation GA106 [GeForce RTX 3060]"


def test_gpu_is_none_when_nothing_identifies_one(monkeypatch):
    """A machine with no GPU tooling reports nothing, rather than guessing from the CPU."""
    _probes(monkeypatch, {})
    assert benchmark._gpu_device_name() is None


def test_gpu_probe_runs_once_per_process(monkeypatch):
    """run_one asks per model, per device, per prompt - that is 18 subprocesses for one answer."""
    calls: list[list[str]] = []

    def counting_probe(command: list[str]) -> str | None:
        calls.append(command)
        return "NVIDIA GeForce RTX 3060" if command[0] == "nvidia-smi" else None

    monkeypatch.setattr(benchmark, "_probe", counting_probe)
    monkeypatch.setattr(benchmark.platform, "system", lambda: "Linux")

    for _ in range(5):
        benchmark._gpu_device_name()
    assert len(calls) == 1


# --- CPU -------------------------------------------------------------------


def test_cpu_on_macos_uses_sysctl(monkeypatch):
    _probes(monkeypatch, {"sysctl": "Apple M2 Pro\n"}, system="Darwin")
    assert benchmark._cpu_device_name() == "Apple M2 Pro"


def test_cpu_on_linux_prefers_lscpu(monkeypatch):
    """
    /proc/cpuinfo carries no "model name" on ARM, so the obvious probe finds nothing on
    exactly the machines whose names are most worth recording.
    """
    _probes(
        monkeypatch,
        {"lscpu": "Architecture:  x86_64\nModel name:    Intel(R) Core(TM) Ultra 7 165H\n"},
    )
    assert benchmark._cpu_device_name() == "Intel(R) Core(TM) Ultra 7 165H"


def test_cpu_falls_back_to_platform_rather_than_failing(monkeypatch):
    _probes(monkeypatch, {})
    monkeypatch.setattr(benchmark.platform, "processor", lambda: "")
    monkeypatch.setattr(benchmark.platform, "machine", lambda: "aarch64")
    assert benchmark._cpu_device_name() == "aarch64"


# --- VRAM ------------------------------------------------------------------


def test_vram_reads_nvidia_mebibytes(monkeypatch):
    _probes(monkeypatch, {"nvidia-smi": "5243\n"})
    assert benchmark._gpu_vram_used_mb() == pytest.approx(5243)


def test_vram_converts_rocm_bytes(monkeypatch):
    _probes(monkeypatch, {"rocm-smi": "device,GPU memory use (B)\ncard0,1073741824\n"})
    assert benchmark._gpu_vram_used_mb() == pytest.approx(1024)


def test_vram_is_none_on_unified_memory(monkeypatch):
    """
    Apple Silicon and integrated graphics share one pool with the CPU: there is no separate
    VRAM figure to report, and peak_mem_mb already covers what was spent. None is the honest
    answer, and the interface renders a missing figure rather than inventing one.
    """
    _probes(monkeypatch, {"sysctl": "Apple M2 Pro"}, system="Darwin")
    assert benchmark._gpu_vram_used_mb() is None
