from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from src.errors import AppError
from src.llm_adapter import (
    ModelNotFoundError,
    UnsupportedDeviceError,
    VALID_DEVICES,
    gpu_available,
    list_model_files,
    llm_adapter,
)


router = APIRouter()


class ModelInfo(BaseModel):
    name: str
    size_bytes: int
    family: str


class ActiveModelResponse(BaseModel):
    model: str | None
    device: str | None
    gpu_available: bool


class SetActiveModelRequest(BaseModel):
    model: str
    device: str = "cpu"


@router.get("/models", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    return [ModelInfo(**item) for item in list_model_files()]


@router.get("/models/active", response_model=ActiveModelResponse)
def get_active_model() -> ActiveModelResponse:
    active = llm_adapter.active
    return ActiveModelResponse(
        model=active["model"] if active else None,
        device=active["device"] if active else None,
        gpu_available=gpu_available(),
    )


@router.post("/models/active", response_model=ActiveModelResponse)
def set_active_model(payload: SetActiveModelRequest) -> ActiveModelResponse:
    # Model + device are one combined load operation, not two independent toggles:
    # this call blocks until the swap is complete (unload current, load requested
    # model onto the requested device) and returns the confirmed active selection -
    # no separate "loading" status to poll, so /query never races an in-flight swap.
    if payload.device not in VALID_DEVICES:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"device": f"must be one of {list(VALID_DEVICES)}"},
        )
    if payload.device == "gpu" and not gpu_available():
        raise AppError(
            "ERR_GPU_UNAVAILABLE",
            "device=\"gpu\" was requested but this build of llama-cpp-python has no "
            "CUDA/GPU offload support installed. Install the CUDA-enabled wheel, or use device=\"cpu\".",
            {"device": "gpu"},
            status_code=422,
        )
    try:
        active = llm_adapter.set_active(payload.model, payload.device)
    except ModelNotFoundError as error:
        raise AppError("ERR_NOT_FOUND", str(error), {"model": payload.model}, status_code=404) from error
    except UnsupportedDeviceError as error:
        raise AppError("ERR_GPU_UNAVAILABLE", str(error), {"device": payload.device}, status_code=422) from error
    except Exception as error:
        raise AppError(
            "ERR_MODEL_LOAD_FAILED",
            f"Failed to load model '{payload.model}' on {payload.device}: {error}",
            {"model": payload.model, "device": payload.device},
            status_code=500,
        ) from error
    return ActiveModelResponse(model=active["model"], device=active["device"], gpu_available=gpu_available())
