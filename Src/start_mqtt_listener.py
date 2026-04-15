from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from database import SensorDatabase
from mqtt_handler import MQTTHandler


CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "mqtt_cloud.json"
DEFAULT_CONFIG = {
    "broker_ip": "u0114811.ala.cn-hangzhou.emqxsl.cn",
    "broker_port": 8883,
    "username": "smart_agri_client",
    "password": "SmartAgri@2026",
    "topic": "$oc/devices/SmartAgriculture_thermometer/sys/properties/report",
    "client_id": "ia-lowcode-app-01",
    "use_tls": True,
}


def load_mqtt_config() -> dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("r", encoding="utf-8") as f:
            file_config = json.load(f)
        if isinstance(file_config, dict):
            config.update({k: v for k, v in file_config.items() if v is not None})
    return config


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def env_bool(name: str, default: bool = False) -> bool:
    value = str(os.getenv(name, str(default))).strip().lower()
    return value in {"1", "true", "yes", "on"}


def create_mqtt_listener() -> tuple[SensorDatabase, MQTTHandler]:
    mqtt_config = load_mqtt_config()
    db = SensorDatabase(db_path=os.getenv("SENSOR_DB_PATH") or None)
    handler = MQTTHandler(
        broker_ip=os.getenv("MQTT_BROKER_IP", str(mqtt_config["broker_ip"])) or str(mqtt_config["broker_ip"]),
        port=env_int("MQTT_BROKER_PORT", int(mqtt_config["broker_port"])),
        db_instance=db,
        username=os.getenv("MQTT_USERNAME", str(mqtt_config["username"])) or str(mqtt_config["username"]),
        password=os.getenv("MQTT_PASSWORD", str(mqtt_config["password"])) or str(mqtt_config["password"]),
        topic=os.getenv("MQTT_TOPIC", str(mqtt_config["topic"])) or str(mqtt_config["topic"]),
        client_id=os.getenv("MQTT_CLIENT_ID", str(mqtt_config["client_id"])) or str(mqtt_config["client_id"]),
        use_tls=env_bool("MQTT_USE_TLS", bool(mqtt_config["use_tls"])),
    )
    return db, handler


def start_mqtt_listener() -> tuple[SensorDatabase | None, MQTTHandler | None]:
    db, handler = create_mqtt_listener()
    ok = handler.start()
    if not ok:
        db.close()
        return None, None
    return db, handler


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger = logging.getLogger("mqtt_starter")

    db, handler = start_mqtt_listener()
    if not db or not handler:
        logger.error("MQTT 监听启动失败，请检查 broker 与配置。")
        return

    logger.info("MQTT 监听已启动，按 Ctrl+C 停止。")
    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        logger.info("收到停止信号，准备退出...")
    finally:
        handler.stop()
        db.close()
        logger.info("MQTT 监听已停止。")


if __name__ == "__main__":
    main()
