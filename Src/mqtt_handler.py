"""
MQTT处理模块 - 处理MQTT连接和数据接收
"""
import os

try:
    import paho.mqtt.client as mqtt
except ModuleNotFoundError:
    mqtt = None
import json
import logging
import threading
import time
import socket
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class MQTTHandler:
    """MQTT处理器"""

    def __init__(
        self,
        broker_ip: str = None,
        port: int = 1883,
        db_instance=None,
        username: str = None,
        password: str = None,
        topic: str = None,
        client_id: str = None,
        use_tls: bool = False,
    ):
        """初始化MQTT处理器"""
        self.broker_ip = broker_ip or self._get_local_ip()
        self.port = port
        self.db_instance = db_instance
        self.client = None
        self.running = False
        self.thread = None
        self.connected = False
        self.last_message_time = None
        self.use_tls = use_tls
        self.topic = topic or "$oc/devices/SmartAgriculture_thermometer/sys/properties/report"
        self.client_id = client_id or f"ia-lowcode-app-{int(time.time())}"
        self.device_config = {
            "username": username or "",
            "password": password or "",
        }

    def _get_local_ip(self):
        """获取本地IP地址"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    def on_connect(self, client, userdata, flags, rc):
        """MQTT连接回调函数"""
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if rc == 0:
            self.connected = True
            logger.info("成功连接到MQTT代理")
            logger.info(f"订阅主题: {self.topic}")
            client.subscribe(self.topic)

            print(f"""
            📋 MQTT连接信息:
                代理地址: {self.broker_ip}:{self.port}
                订阅主题: {self.topic}
                客户端ID: {self.client_id}
                用户名: {self.device_config['username'] or '(未设置)'}
                TLS: {'开启' if self.use_tls else '关闭'}
                连接时间: {current_time}
                状态: 在线 ✅
            """)

        elif rc == 4:
            self.connected = False
            logger.error("认证失败: 错误的用户名或密码")
        else:
            self.connected = False
            logger.error(f"连接失败，错误码: {rc}")

    def on_message(self, client, userdata, msg):
        """MQTT消息接收回调函数"""
        try:
            payload = msg.payload.decode('utf-8', errors='ignore')
            logger.debug(f"收到MQTT消息: {msg.topic}")
            self.last_message_time = datetime.now()
            data = json.loads(payload)

            if self.db_instance:
                try:
                    data_id = self.db_instance.store_sensor_data(
                        "SmartAgriculture_thermometer", data
                    )
                    logger.debug(f"数据存储成功，ID: {data_id}")
                except Exception as e:
                    logger.error(f"数据存储失败: {e}")

            if "services" in data and len(data["services"]) > 0:
                service_data = data["services"][0]
                properties = service_data.get("properties", {})

                print(f"""
                📊 传感器数据 [{datetime.now().strftime('%H:%M:%S')}]:
                    🌡️  温度: {properties.get('temperature', 'N/A')} °C
                    💧 湿度: {properties.get('humidity', 'N/A')} %
                    💨 PM2.5: {properties.get('PM25', 'N/A')} μg/m³
                    💡 光照: {properties.get('light', 'N/A')} lux
                """)

        except json.JSONDecodeError:
            logger.warning(f"收到非JSON格式数据: {payload[:100]}")
        except Exception as e:
            logger.error(f"处理MQTT消息失败: {e}")

    def on_disconnect(self, client, userdata, rc):
        """MQTT断开连接回调函数"""
        self.connected = False
        if rc != 0:
            logger.warning("连接断开，正在尝试重连...")

    def start(self):
        """启动MQTT监听"""
        if mqtt is None:
            logger.error("Missing dependency: paho-mqtt. Install with: pip install paho-mqtt")
            return False

        self.client = mqtt.Client(client_id=self.client_id)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect

        if self.device_config["username"]:
            self.client.username_pw_set(
                self.device_config["username"],
                self.device_config["password"],
            )

        if self.use_tls:
            self.client.tls_set()

        try:
            logger.info(f"连接到MQTT代理: {self.broker_ip}:{self.port} (TLS={'on' if self.use_tls else 'off'})")
            self.client.connect(self.broker_ip, self.port, 60)
            self.running = True
            self.client.loop_start()
            logger.info("MQTT监听已启动")
            return True
        except Exception as e:
            logger.error(f"MQTT连接失败: {e}")
            return False

    def start_in_background(self):
        """在后台线程中启动MQTT监听"""
        if self.thread and self.thread.is_alive():
            logger.warning("MQTT监听已在运行")
            return

        self.thread = threading.Thread(target=self.start, daemon=True)
        self.thread.start()

    def stop(self):
        """停止MQTT监听"""
        self.running = False
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()
            logger.info("MQTT监听已停止")

    def get_connection_status(self):
        """获取连接状态"""
        status = {
            'connected': self.connected,
            'last_message_time': self.last_message_time.isoformat() if self.last_message_time else None,
            'broker': f"{self.broker_ip}:{self.port}",
            'topic': self.topic,
        }

        if self.last_message_time:
            time_diff = (datetime.now() - self.last_message_time).total_seconds()
            if time_diff < 60:
                status['stability'] = '优秀'
            elif time_diff < 300:
                status['stability'] = '良好'
            else:
                status['stability'] = '一般'
        else:
            status['stability'] = '无数据'

        return status
