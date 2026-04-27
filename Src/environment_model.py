from __future__ import annotations

import json
from datetime import datetime
from typing import Any


ENVIRONMENT_INDICATORS = [
    "temperature",
    "humidity",
    "light_lux",
    "soil_moisture",
    "pm25",
    "pm10",
    "atmospheric_pressure",
    "co2",
]


def _safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_round(value: Any, digits: int = 2) -> float | None:
    numeric = _safe_float(value)
    if numeric is None:
        return None
    return round(numeric, digits)


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def _parse_jsonish(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def normalize_sensor_record(row: dict[str, Any]) -> dict[str, Any]:
    """Convert sensor/database rows to the workflow sensor data contract."""
    raw = row or {}
    raw_json = _parse_jsonish(raw.get("raw_json"))
    properties: dict[str, Any] = {}
    if isinstance(raw_json, dict):
        services = raw_json.get("services") or {}
        if isinstance(services, list) and services:
            properties = services[0].get("properties") or {}
        elif isinstance(services, dict):
            properties = services.get("properties") or {}

    def pick(*keys: str) -> Any:
        for key in keys:
            if key in raw and raw.get(key) is not None:
                return raw.get(key)
            if key in properties and properties.get(key) is not None:
                return properties.get(key)
        return None

    return {
        "temperature": _safe_round(pick("temperature")),
        "humidity": _safe_round(pick("humidity")),
        "light_lux": _safe_round(pick("light_lux", "light"), 0),
        "soil_moisture": _safe_round(pick("soil_moisture", "soil_humidity")),
        "pm25": _safe_round(pick("pm25", "PM25"), 0),
        "pm10": _safe_round(pick("pm10", "PM10"), 0),
        "atmospheric_pressure": _safe_round(pick("atmospheric_pressure")),
        "co2": _safe_round(pick("co2", "CO2")),
        "timestamp": str(pick("timestamp") or datetime.now().isoformat()),
        "device_id": str(pick("device_id") or ""),
    }


def build_data_packet(
    *,
    source_node_type: str,
    source_name: str,
    records: Any,
) -> dict[str, Any]:
    if isinstance(records, dict):
        rows = [records]
    elif isinstance(records, list):
        rows = [row for row in records if isinstance(row, dict)]
    else:
        rows = []

    normalized_records = [normalize_sensor_record(row) for row in rows]
    latest = normalized_records[0] if normalized_records else {}
    return {
        "contract": "ia.workflow.data_packet.v1",
        "sourceNodeType": source_node_type,
        "sourceName": source_name,
        "timestamp": datetime.now().isoformat(),
        "schema": {
            "temperature": "number, Celsius",
            "humidity": "number, percent",
            "light_lux": "number, lux",
            "soil_moisture": "number, percent",
            "pm25": "number, ug/m3",
            "pm10": "number, ug/m3",
            "atmospheric_pressure": "number, hPa",
            "co2": "number, ppm",
            "timestamp": "ISO datetime",
        },
        "latest": latest,
        "records": normalized_records,
    }


def extract_records(payload: Any) -> list[dict[str, Any]]:
    data = _parse_jsonish(payload)
    if isinstance(data, dict):
        records = data.get("records")
        if isinstance(records, list):
            return [normalize_sensor_record(row) for row in records if isinstance(row, dict)]
        latest = data.get("latest")
        if isinstance(latest, dict):
            return [normalize_sensor_record(latest)]
        return [normalize_sensor_record(data)]
    if isinstance(data, list):
        return [normalize_sensor_record(row) for row in data if isinstance(row, dict)]
    return []


def _avg(records: list[dict[str, Any]], key: str) -> float | None:
    values = [_safe_float(row.get(key)) for row in records]
    values = [value for value in values if value is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _stability(records: list[dict[str, Any]], keys: list[str]) -> float:
    values: list[float] = []
    for key in keys:
        values.extend(value for value in (_safe_float(row.get(key)) for row in records) if value is not None)
    if len(values) < 2:
        return 100.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    cv = (variance ** 0.5) / (abs(mean) or 1.0)
    return _clamp(100.0 - cv * 100.0)


def score_interval(value: float | None, low: float, high: float, hard_low: float, hard_high: float) -> float:
    if value is None:
        return 0.0
    if low <= value <= high:
        return 100.0
    if value < low:
        return _clamp((value - hard_low) / max(low - hard_low, 1e-6) * 100.0)
    return _clamp((hard_high - value) / max(hard_high - high, 1e-6) * 100.0)


def score_negative(value: float | None, excellent: float, unacceptable: float) -> float:
    if value is None:
        return 100.0
    if value <= excellent:
        return 100.0
    return _clamp((unacceptable - value) / max(unacceptable - excellent, 1e-6) * 100.0)


def build_environment_model(input_payload: Any, method: str = "weighted_index") -> dict[str, Any]:
    records = extract_records(input_payload)
    if not records:
        return {
            "status": "insufficient-data",
            "message": "environment_model 未收到上游数据包，请从 get_sensor_info 或 db_query 连线输入标准化数据。",
            "environmentScore": 0,
            "environmentLevel": "无数据",
            "riskType": "无数据流",
            "mainLimitingFactors": ["缺少上游传感器或数据库数据"],
            "suggestions": ["请先连接 get_sensor_info 或 db_query 节点，再连接 environment_model。"],
            "indicatorScores": {},
        }

    indicators = {key: _avg(records, key) for key in ENVIRONMENT_INDICATORS}
    temperature_score = score_interval(indicators["temperature"], 20.0, 28.0, 10.0, 38.0)
    humidity_score = score_interval(indicators["humidity"], 55.0, 75.0, 25.0, 95.0)
    light_score = score_interval(indicators["light_lux"], 12000.0, 26000.0, 2000.0, 42000.0)
    soil_score = score_interval(indicators["soil_moisture"], 42.0, 62.0, 18.0, 82.0)
    pm25_score = score_negative(indicators["pm25"], 35.0, 115.0)
    pm10_score = score_negative(indicators["pm10"], 70.0, 180.0)
    pressure_score = score_interval(indicators["atmospheric_pressure"], 1000.0, 1025.0, 960.0, 1050.0)
    co2_score = score_interval(indicators["co2"], 400.0, 1200.0, 250.0, 1800.0) if indicators["co2"] is not None else 85.0

    score_temp_humidity = temperature_score * 0.55 + humidity_score * 0.45
    score_air_quality = pm25_score * 0.55 + pm10_score * 0.35 + co2_score * 0.10
    score_stability = _stability(records, ["temperature", "humidity", "soil_moisture", "light_lux"])
    indicator_scores = {
        "temperatureHumidity": round(score_temp_humidity, 2),
        "light": round(light_score, 2),
        "soilMoisture": round(soil_score, 2),
        "airQuality": round(score_air_quality, 2),
        "pressure": round(pressure_score, 2),
        "stability": round(score_stability, 2),
    }

    weights = {
        "temperatureHumidity": 0.25,
        "light": 0.18,
        "soilMoisture": 0.24,
        "airQuality": 0.18,
        "pressure": 0.05,
        "stability": 0.10,
    }
    environment_score = sum(indicator_scores[key] * weights[key] for key in weights)

    if environment_score >= 85:
        level = "优秀"
    elif environment_score >= 70:
        level = "良好"
    elif environment_score >= 55:
        level = "一般"
    else:
        level = "较差"

    limiting_map = {
        "temperatureHumidity": "温湿度适宜度不足",
        "light": "光照不足或过强",
        "soilMoisture": "土壤湿度偏离适宜区间",
        "airQuality": "空气质量压力偏高",
        "pressure": "气压偏离稳定区间",
        "stability": "环境波动较大",
    }
    limiting = [
        limiting_map[key]
        for key, value in sorted(indicator_scores.items(), key=lambda item: item[1])
        if value < 75
    ][:3]

    suggestions = []
    if indicator_scores["soilMoisture"] < 75:
        suggestions.append("建议根据土壤湿度执行分区灌溉或排水。")
    if indicator_scores["light"] < 75:
        suggestions.append("建议调整遮阳、补光或作物冠层管理。")
    if indicator_scores["temperatureHumidity"] < 75:
        suggestions.append("建议联动通风、喷雾或保温设备稳定温湿度。")
    if indicator_scores["airQuality"] < 75:
        suggestions.append("建议检查过滤、通风和粉尘来源。")
    if not suggestions:
        suggestions.append("当前环境整体可控，建议保持监测频率。")

    if indicator_scores["soilMoisture"] < 60:
        risk_type = "轻度干旱风险" if (indicators["soil_moisture"] or 0) < 42 else "渍害风险"
    elif indicator_scores["airQuality"] < 60:
        risk_type = "空气质量风险"
    elif indicator_scores["temperatureHumidity"] < 60:
        risk_type = "温湿度胁迫风险"
    else:
        risk_type = "低风险"

    return {
        "status": "ok",
        "contract": "ia.workflow.environment_model.v1",
        "method": method if method in {"weighted_index", "entropy_weight", "topsis", "grey_relation"} else "weighted_index",
        "methodImplemented": "weighted_index",
        "sampleCount": len(records),
        "environmentScore": round(environment_score, 2),
        "environmentLevel": level,
        "riskType": risk_type,
        "mainLimitingFactors": limiting or ["暂无明显限制因子"],
        "suggestions": suggestions,
        "indicatorValues": {key: _safe_round(value) for key, value in indicators.items()},
        "indicatorScores": indicator_scores,
        "modelBasis": {
            "literatureIndicatorSources": [
                "设施农业与温室环境监测常用温度、湿度、光照、土壤水分、CO2、颗粒物和气压等传感器指标。",
                "耕地质量评价通常从土壤理化性状、水分、养分、有机质、pH、灌溉排水能力、清洁程度和障碍因素构建指标体系。",
                "农业绿色发展评价常使用熵权法、TOPSIS、灰色关联分析和综合指数法进行多指标综合评价。",
            ],
            "indicatorSystem": {
                "microclimate": ["temperature", "humidity", "light_lux", "atmospheric_pressure", "co2"],
                "soilWater": ["soil_moisture"],
                "airQuality": ["pm25", "pm10"],
                "stability": ["temperature", "humidity", "soil_moisture", "light_lux"],
            },
            "scoreRules": {
                "interval": "适宜区间型指标在适宜区间得 100 分，向硬阈值线性衰减到 0 分。",
                "negative": "负向指标低于优良阈值得 100 分，向不可接受阈值线性衰减到 0 分。",
                "weightedIndex": weights,
            },
        },
        "screen_contract": {
            "overview": {
                "score": round(environment_score, 2),
                "level": level,
                "riskType": risk_type,
                "summary": f"环境综合评分 {round(environment_score, 2)}，等级为{level}，主要风险为{risk_type}。",
            },
            "indicator_bars": [
                {"key": key, "label": label, "score": indicator_scores[key]}
                for key, label in [
                    ("temperatureHumidity", "温湿度"),
                    ("light", "光照"),
                    ("soilMoisture", "土壤水分"),
                    ("airQuality", "空气质量"),
                    ("stability", "稳定性"),
                ]
            ],
            "suggestions": suggestions,
        },
    }


def build_environment_analysis_summary(input_payload: Any, analysis_type: str = "overview") -> dict[str, Any]:
    data = _parse_jsonish(input_payload)
    if not isinstance(data, dict) or "environmentScore" not in data:
        data = build_environment_model(data)

    if analysis_type == "alerts":
        return {
            "status": data.get("status", "ok"),
            "alerts": [
                {
                    "level": "high" if data.get("environmentScore", 0) < 55 else "medium",
                    "riskType": data.get("riskType"),
                    "factors": data.get("mainLimitingFactors", []),
                }
            ] if data.get("riskType") not in {None, "低风险"} else [],
        }
    if analysis_type == "recommendations":
        return {
            "status": data.get("status", "ok"),
            "recommendations": data.get("suggestions", []),
            "mainLimitingFactors": data.get("mainLimitingFactors", []),
        }
    return {
        "status": data.get("status", "ok"),
        "analysisType": analysis_type,
        "environmentScore": data.get("environmentScore"),
        "environmentLevel": data.get("environmentLevel"),
        "riskType": data.get("riskType"),
        "indicatorScores": data.get("indicatorScores", {}),
        "summary": (data.get("screen_contract") or {}).get("overview", {}).get("summary"),
    }
