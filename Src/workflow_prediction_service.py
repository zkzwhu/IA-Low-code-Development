from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

from analytics.advanced_predict_decision import (
    VALID_COLUMNS as ADVANCED_VALID_COLUMNS,
    load_prediction_artifacts,
    run_prediction_analysis,
)


DEFAULT_WORKFLOW_DEVICE_ID = "SmartAgriculture_thermometer"
DEFAULT_OUTPUT_KIND = "forecast_plot_url"

ADVANCED_PREDICTION_OUTPUT_LABELS = {
    "forecast_plot_url": "预测曲线图",
    "raw_plot_url": "原始趋势图",
    "feature_importance_plot_url": "特征重要性图",
    "corr_heatmap_plot_url": "相关性热力图",
    "anomaly_plot_url": "异常检测图",
    "model_compare_csv": "模型对比 CSV",
    "forecast_series_csv": "预测序列 CSV",
    "decision_report_json": "决策报告 JSON",
    "full_result_json": "完整分析结果",
}

IMAGE_OUTPUT_KEYS = {
    "forecast_plot_url": "forecast_plot",
    "raw_plot_url": "raw_plot",
    "feature_importance_plot_url": "feature_importance_plot",
    "corr_heatmap_plot_url": "corr_heatmap_plot",
    "anomaly_plot_url": "anomaly_plot",
}


def safe_int(value: Any, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        result = default
    if minimum is not None:
        result = max(minimum, result)
    if maximum is not None:
        result = min(maximum, result)
    return result


def safe_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_feature_columns(raw_value: Any) -> list[str] | None:
    if raw_value is None:
        return None

    if isinstance(raw_value, (list, tuple, set)):
        values = [str(item).strip() for item in raw_value if str(item).strip()]
        return values or None

    text = str(raw_value).replace("\n", ",")
    values = [item.strip() for item in text.split(",") if item.strip()]
    return values or None


def build_generated_file_url(relative_file: str) -> str:
    relative_path = str(relative_file or "").replace("\\", "/").lstrip("/")
    quoted_path = quote(relative_path, safe="/")
    return f"/api/agriculture/analytics/generated/{quoted_path}"


def attach_prediction_file_urls(payload: dict[str, Any]) -> dict[str, Any]:
    relative_files = payload.get("relative_files")
    if not isinstance(relative_files, dict):
        return payload

    payload["file_urls"] = {
        key: build_generated_file_url(value)
        for key, value in relative_files.items()
        if value and ":" not in str(value)
    }
    return payload


def enrich_prediction_result_from_manifest(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return payload

    files = payload.get("files") or {}
    manifest_path = files.get("manifest_json")
    if not manifest_path:
        return payload

    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return payload

    for key, value in manifest.items():
        payload.setdefault(key, value)
    return payload


def records_to_csv_text(records: Any) -> str:
    if isinstance(records, list) and records and isinstance(records[0], dict):
        headers = list(records[0].keys())
        lines = [",".join(headers)]
        for row in records:
            lines.append(",".join(str(row.get(header, "")) for header in headers))
        return "\n".join(lines)

    if isinstance(records, dict):
        headers = list(records.keys())
        return ",".join(headers) + ("\n" + ",".join(str(records.get(header, "")) for header in headers) if headers else "")

    return "" if records is None else str(records)


def normalize_output_kind(raw_value: Any) -> str:
    value = str(raw_value or DEFAULT_OUTPUT_KIND).strip() or DEFAULT_OUTPUT_KIND
    return value if value in ADVANCED_PREDICTION_OUTPUT_LABELS else DEFAULT_OUTPUT_KIND


def extract_prediction_output_payload(result: dict[str, Any], output_kind: str) -> Any:
    output_kind = normalize_output_kind(output_kind)

    if output_kind in IMAGE_OUTPUT_KEYS:
        file_key = IMAGE_OUTPUT_KEYS[output_kind]
        file_urls = result.get("file_urls") or {}
        image_url = file_urls.get(file_key)
        if not image_url:
            raise ValueError(f"当前结果中缺少 {ADVANCED_PREDICTION_OUTPUT_LABELS[output_kind]} 文件。")
        return str(image_url)

    if output_kind == "model_compare_csv":
        return records_to_csv_text(result.get("model_compare") or [])

    if output_kind == "forecast_series_csv":
        forecast_series = result.get("forecast_series")
        if not forecast_series:
            raise ValueError("当前结果中缺少预测序列数据，请先重新生成高级预测结果。")
        return records_to_csv_text(forecast_series)

    if output_kind == "decision_report_json":
        return result.get("decision_report") or {}

    return result


def run_workflow_prediction(sensor_db: Any, properties: dict[str, Any]) -> dict[str, Any]:
    target = str(properties.get("target") or "soil_humidity").strip() or "soil_humidity"
    if target not in ADVANCED_VALID_COLUMNS:
        raise ValueError(f"不支持的预测字段: {target}")

    output_kind = normalize_output_kind(properties.get("outputKind"))
    device_id = str(properties.get("deviceId") or "").strip() or DEFAULT_WORKFLOW_DEVICE_ID
    refresh_assets = str(properties.get("refreshAssets") if properties.get("refreshAssets") is not None else "true").strip().lower() not in {"0", "false", "no"}
    feature_cols = parse_feature_columns(properties.get("featureColumns"))

    args = {
        "db_path": sensor_db.db_path,
        "device_id": device_id,
        "target": target,
        "feature_cols": feature_cols,
        "resample": str(properties.get("resample") or "D").strip() or "D",
        "window": safe_int(properties.get("window"), 120, 12, 720),
        "lags": safe_int(properties.get("lags"), 7, 1, 30),
        "forecast_steps": safe_int(properties.get("forecastSteps"), 7, 1, 60),
        "low_threshold": safe_float(properties.get("lowThreshold")),
        "high_threshold": safe_float(properties.get("highThreshold")),
    }

    result: dict[str, Any] | None = None
    warning_message = ""
    source = "generated"

    if refresh_assets:
        try:
            result = run_prediction_analysis(**args)
        except Exception as exc:
            result = load_prediction_artifacts(target=target, device_id=device_id)
            if not result:
                raise
            warning_message = f"重新生成失败，已回退到最近一次结果：{exc}"
            source = "cached"
    else:
        result = load_prediction_artifacts(target=target, device_id=device_id)
        if result:
            source = "cached"
        else:
            result = run_prediction_analysis(**args)
            source = "generated"

    if not result:
        raise ValueError("未找到可用的高级预测结果。")

    result = enrich_prediction_result_from_manifest(result)
    result = attach_prediction_file_urls(result)
    payload = extract_prediction_output_payload(result, output_kind)

    return {
        "payload": payload,
        "result": result,
        "source": source,
        "warning_message": warning_message,
        "output_kind": output_kind,
        "output_label": ADVANCED_PREDICTION_OUTPUT_LABELS[output_kind],
        "target": target,
        "device_id": device_id,
    }
