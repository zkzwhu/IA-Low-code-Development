"""
MQTT处理模块 - 处理MQTT连接和数据接收
"""
import os

import paho.mqtt.client as mqtt
import json
import logging
import threading
import time
import subprocess
import socket
import platform
from datetime import datetime
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class MQTTHandler:
    """MQTT处理器"""

    def __init__(self, broker_ip: str = None, port: int = 1883, db_instance=None):
        """初始化MQTT处理器"""
        self.broker_ip = broker_ip or self._get_local_ip()
        self.port = port
        self.db_instance = db_instance
        self.client = None
        self.running = False
        self.thread = None
        self.connected = False  # 添加连接状态
        self.last_message_time = None  # 最后收到消息的时间

        # MQTT配置
        self.topic = "$oc/devices/SmartAgriculture_thermometer/sys/properties/report"
        self.device_config = {
            "username": "SmartAgriculture_thermometer",
            "password": "7884a00e068ff526da5230dbedb909de09e0f377f9093e1bbad3098c3d666865"
        }

    def _get_local_ip(self):
        """获取本地IP地址"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except:
            return "127.0.0.1"

    def check_mqtt_broker(self) -> bool:
        """检查MQTT代理是否运行"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((self.broker_ip, self.port))
            sock.close()
            return result == 0
        except Exception:
            return False

    def start_mqtt_broker(self) -> bool:
        """启动MQTT代理（mosquitto）- 修复僵死问题"""
        system = platform.system()
        logger.info(f"正在尝试启动MQTT代理 ({system})...")

        try:
            # 获取项目根目录的config/mosquitto.conf配置文件
            config_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),  # 从src回到项目根目录
                "config",
                "mosquitto.conf"
            )
            config_path = os.path.abspath(config_path)  # 转为绝对路径

            logger.info(f"使用配置文件: {config_path}")

            if not os.path.exists(config_path):
                logger.error(f"MQTT配置文件不存在: {config_path}")
                logger.error("请确保项目包含 config/mosquitto.conf 文件")
                return False

            # 检查配置文件内容
            try:
                with open(config_path, 'r', encoding='utf-8') as f: 
                    config_content = f.read()

                # 确保配置文件有基本的监听设置
                if "listener" not in config_content:
                    logger.warning("配置文件中缺少 'listener' 设置，添加默认监听配置")
                    # 创建一个临时配置文件
                    temp_config = config_path + ".tmp"
                    with open(temp_config, 'w') as f:
                        f.write("listener 1883 0.0.0.0\n")
                        f.write("allow_anonymous true\n")
                        f.write(config_content)
                    config_path = temp_config
            except Exception as e:
                logger.error(f"读取配置文件失败: {e}")

            if system == "Windows":
                # Windows启动
                subprocess.Popen(
                    ["mosquitto", "-c", config_path, "-v"],
                    creationflags=subprocess.CREATE_NEW_CONSOLE)
            elif system == "Linux":
                # Linux启动 - 使用正确的守护进程参数
                cmd = ["mosquitto", "-c", config_path]
                logger.info(f"启动命令: {' '.join(cmd)}")

                # 方法1: 使用nohup避免僵死
                try:
                    # 创建日志文件
                    log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
                    os.makedirs(log_dir, exist_ok=True)
                    log_file = os.path.join(log_dir, "mosquitto.log")

                    # 使用nohup启动，避免僵死
                    with open(log_file, 'a') as log_f:
                        process = subprocess.Popen(
                            cmd,
                            stdout=log_f,
                            stderr=subprocess.STDOUT,
                            preexec_fn=os.setpgrp,  # 创建新的进程组
                            start_new_session=True  # 新会话
                        )

                    logger.info(f"Mosquitto进程PID: {process.pid}")

                except Exception as e:
                    logger.error(f"方法1启动失败: {e}")

                    # 方法2: 尝试使用系统服务
                    logger.info("尝试使用系统服务启动mosquitto...")
                    try:
                        subprocess.run(["sudo", "systemctl", "start", "mosquitto"],
                                       check=True, capture_output=True, text=True)
                        logger.info("使用系统服务启动成功")
                    except subprocess.CalledProcessError as e:
                        logger.error(f"系统服务启动失败: {e.stderr}")

                        # 方法3: 直接在前台运行（用于调试）
                        logger.info("尝试在前台运行mosquitto...")
                        try:
                            process = subprocess.Popen(
                                ["mosquitto", "-c", config_path, "-v"],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True
                            )
                            # 等待几秒检查输出
                            time.sleep(2)
                            if process.poll() is not None:
                                output, _ = process.communicate(timeout=1)
                                logger.error(f"Mosquitto启动失败，输出: {output[:200]}")
                                return False
                        except Exception as e2:
                            logger.error(f"前台运行也失败: {e2}")
                            return False

            elif system == "Darwin":  # macOS
                subprocess.Popen(["mosquitto", "-c", config_path, "-d"])

            # 等待启动
            time.sleep(3)
            if self.check_mqtt_broker():
                logger.info("MQTT代理启动成功")
                return True
            else:
                logger.error("MQTT代理启动后无法连接")
                return False

        except Exception as e:
            logger.error(f"启动MQTT代理失败: {e}")
            logger.error("请确保已安装mosquitto: sudo apt install mosquitto")
            return False

    def install_mqtt_broker(self):
        """指导用户安装MQTT代理"""
        system = platform.system()
        logger.warning("MQTT代理未安装，请按以下步骤安装:")

        if system == "Windows":
            print("""
            1. 下载mosquitto:
               访问: https://mosquitto.org/download/
               选择 Windows 版本下载

            2. 安装步骤:
               a. 运行安装程序
               b. 将mosquitto添加到PATH
               c. 安装完成后重启电脑

            3. 启动mosquitto:
               在命令提示符中运行: mosquitto -v
            """)
        elif system == "Linux":
            print("""
            安装命令:
            sudo apt update
            sudo apt install mosquitto mosquitto-clients

            启动服务:
            sudo systemctl start mosquitto
            """)
        elif system == "Darwin":  # macOS
            print("""
            安装命令:
            brew install mosquitto

            启动服务:
            brew services start mosquitto
            """)

    def on_connect(self, client, userdata, flags, rc):
        """MQTT连接回调函数"""
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if rc == 0:
            self.connected = True  # 更新连接状态
            logger.info(f"成功连接到MQTT代理")
            logger.info(f"订阅主题: {self.topic}")
            client.subscribe(self.topic)

            print(f"""
            📋 MQTT连接信息:
                代理地址: {self.broker_ip}:{self.port}
                订阅主题: {self.topic}
                客户端ID: {self.device_config['username']}
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

            # 更新最后收到消息的时间
            self.last_message_time = datetime.now()

            # 解析数据
            data = json.loads(payload)

            # 存储到数据库
            if self.db_instance:
                try:
                    data_id = self.db_instance.store_sensor_data(
                        "SmartAgriculture_thermometer", data
                    )
                    logger.debug(f"数据存储成功，ID: {data_id}")
                except Exception as e:
                    logger.error(f"数据存储失败: {e}")

            # 打印数据摘要
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
        self.connected = False  # 更新连接状态
        if rc != 0:
            logger.warning("连接断开，正在尝试重连...")

    def start(self):
        """启动MQTT监听"""
        # 检查并启动MQTT代理
        if not self.check_mqtt_broker():
            logger.info("MQTT代理未运行，正在尝试启动...")
            if not self.start_mqtt_broker():
                self.install_mqtt_broker()
                return False

        # 创建MQTT客户端
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        self.client.username_pw_set(
            self.device_config["username"],
            self.device_config["password"]
        )

        try:
            logger.info(f"连接到MQTT代理: {self.broker_ip}:{self.port}")
            self.client.connect(self.broker_ip, self.port, 60)
            self.running = True

            # 启动MQTT循环
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
            'topic': self.topic
        }

        # 计算连接稳定性
        if self.last_message_time:
            time_diff = (datetime.now() - self.last_message_time).total_seconds()
            if time_diff < 60:  # 60秒内有消息
                status['stability'] = '优秀'
            elif time_diff < 300:  # 5分钟内有消息
                status['stability'] = '良好'
            else:
                status['stability'] = '一般'
        else:
            status['stability'] = '无数据'

        return status