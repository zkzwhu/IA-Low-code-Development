from __future__ import annotations

import logging
import os
import time

from database import SensorDatabase
from mqtt_handler import MQTTHandler


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def create_mqtt_listener() -> tuple[SensorDatabase, MQTTHandler]:
    db = SensorDatabase(db_path=os.getenv("SENSOR_DB_PATH") or None)
    handler = MQTTHandler(
        broker_ip=os.getenv("MQTT_BROKER_IP") or None,
        port=env_int("MQTT_BROKER_PORT", 1883),
        db_instance=db,
    )
    topic = os.getenv("MQTT_TOPIC")
    if topic:
        handler.topic = topic
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
