from __future__ import annotations

import os
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from atexit import register
from pathlib import Path
from typing import Any

try:
    import cv2
except ModuleNotFoundError:
    cv2 = None

from flask import Flask, Response, jsonify, render_template, request, send_file, session

from analytics.advanced_predict_decision import (
    DEFAULT_OUTPUT_ROOT as ADVANCED_ANALYTICS_OUTPUT_ROOT,
    VALID_COLUMNS as ADVANCED_VALID_COLUMNS,
    load_prediction_artifacts,
    run_prediction_analysis,
)
from debug_runtime import create_session, serialize_state, step_once
from database import SensorDatabase
from start_mqtt_listener import start_mqtt_listener
from workflow_prediction_service import (
    attach_prediction_file_urls,
    run_workflow_prediction,
)


current_dir = os.path.dirname(os.path.abspath(__file__))
template_dir = os.path.join(current_dir, '..', 'templates')
static_dir = os.path.join(current_dir, '..', 'static')

app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'ia-low-code-dev-secret-key')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    TEMPLATES_AUTO_RELOAD=True,
    SEND_FILE_MAX_AGE_DEFAULT=0,
)
app.jinja_env.auto_reload = True

current_workflow = {
    'nodes': [],
    'next_id': 100,
    'workflow_variables': [],
    'workflow_ports': []
}

debug_sessions: dict[str, dict[str, Any]] = {}
sensor_db = SensorDatabase()
mqtt_db: SensorDatabase | None = None
mqtt_handler = None
camera_capture = None
advanced_analytics_output_root = Path(ADVANCED_ANALYTICS_OUTPUT_ROOT)


def start_app_mqtt() -> None:
    global mqtt_db, mqtt_handler
    mqtt_db, mqtt_handler = start_mqtt_listener()


def stop_app_mqtt() -> None:
    global mqtt_db, mqtt_handler
    if mqtt_handler:
        mqtt_handler.stop()
        mqtt_handler = None
    if mqtt_db:
        mqtt_db.close()
        mqtt_db = None


register(stop_app_mqtt)


def stop_camera_capture() -> None:
    global camera_capture
    if camera_capture is not None:
        camera_capture.release()
        camera_capture = None


register(stop_camera_capture)


def json_error(message: str, status_code: int = 400, error_code: str = 'REQUEST_ERROR'):
    return jsonify({
        'status': 'error',
        'message': message,
        'error_code': error_code,
    }), status_code


@app.after_request
def disable_frontend_cache(response: Response) -> Response:
    should_disable_cache = request.method == 'GET' and (
        request.path.startswith('/static/')
        or response.mimetype in {'text/html', 'text/css', 'application/javascript', 'text/javascript'}
    )
    if should_disable_cache:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response


def get_current_user() -> dict[str, Any] | None:
    user_id = session.get('user_id')
    if user_id is None:
        return None
    user = sensor_db.get_user_by_id(user_id)
    if not user:
        session.pop('user_id', None)
        return None
    return user


def require_login() -> tuple[dict[str, Any] | None, Any | None]:
    user = get_current_user()
    if user:
        return user, None
    return None, json_error('请先登录后再访问该功能。', 401, 'AUTH_REQUIRED')


def serialize_user_payload(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    return {
        'id': user.get('id'),
        'username': user.get('username'),
        'display_name': user.get('display_name'),
        'created_at': user.get('created_at'),
        'updated_at': user.get('updated_at'),
        'last_login_at': user.get('last_login_at'),
    }

smart_agriculture_mock_data = {
    'sensor': {
        'title': '智慧农业监测总览',
        'sensors': [
            {'name': '温度传感器', 'value': '24.6', 'unit': '°C', 'status': '正常'},
            {'name': '湿度传感器', 'value': '68', 'unit': '%', 'status': '正常'},
            {'name': '光照传感器', 'value': '18500', 'unit': 'Lux', 'status': '正常'},
            {'name': '土壤湿度', 'value': '45', 'unit': '%', 'status': '正常'}
        ]
    }
}


def get_runtime_status() -> dict[str, Any]:
    status = {
        'connected': False,
        'last_message_time': None,
        'broker': '未连接',
        'topic': '',
        'stability': '演示模式',
    }
    if mqtt_handler and hasattr(mqtt_handler, 'get_connection_status'):
        try:
            status.update(mqtt_handler.get_connection_status())
        except Exception:
            pass
    return status


def build_live_sensor_section() -> dict[str, Any]:
    try:
        overview = sensor_db.get_agriculture_overview()
        latest = overview.get('latest_reading') or {}
        sensors = [
            {
                'name': '温度传感器',
                'value': str(latest.get('temperature') if latest.get('temperature') is not None else '--'),
                'unit': '°C',
                'status': '告警' if overview.get('risk_score', 0) >= 75 else '正常',
            },
            {
                'name': '湿度传感器',
                'value': str(latest.get('humidity') if latest.get('humidity') is not None else '--'),
                'unit': '%',
                'status': '正常',
            },
            {
                'name': '光照传感器',
                'value': str(latest.get('light_lux') if latest.get('light_lux') is not None else '--'),
                'unit': 'Lux',
                'status': '正常',
            },
            {
                'name': '土壤湿度',
                'value': str(latest.get('soil_humidity') if latest.get('soil_humidity') is not None else '--'),
                'unit': '%',
                'status': '告警' if (latest.get('soil_humidity') or 0) <= 35 else '正常',
            },
        ]
        return {
            'title': '智慧农业监测总览',
            'subtitle': overview.get('observation', ''),
            'riskScore': overview.get('risk_score'),
            'updatedAt': latest.get('timestamp'),
            'sensors': sensors,
        }
    except Exception:
        return {
            **smart_agriculture_mock_data['sensor'],
        }


def build_smart_agriculture_payload() -> dict[str, dict[str, Any]]:
    return {
        'sensor': {
            **build_live_sensor_section(),
        },
    }


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default





def get_camera_capture(index: int = 0):
    global camera_capture
    if cv2 is None:
        raise RuntimeError('未安装 opencv-python，请先执行 pip install opencv-python')
    if camera_capture is None or not camera_capture.isOpened():
        camera_capture = cv2.VideoCapture(index)
    if camera_capture is None or not camera_capture.isOpened():
        raise RuntimeError('无法打开本地摄像头，请检查摄像头是否被其他程序占用')
    return camera_capture


def capture_snapshot_bytes() -> bytes:
    capture = get_camera_capture(safe_int(os.getenv('CAMERA_INDEX'), 0))
    ok, frame = capture.read()
    if not ok or frame is None:
        raise RuntimeError('本地摄像头抓拍失败')
    ok, encoded = cv2.imencode('.jpg', frame)
    if not ok:
        raise RuntimeError('摄像头图片编码失败')
    return encoded.tobytes()


def node_name(node: dict[str, Any]) -> str:
    props = node.get('properties', {}) or {}
    return props.get('name') or f"{node.get('type', 'node')}#{node.get('id')}"


def normalize_variable_defs(variable_defs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = []
    for index, variable in enumerate(variable_defs or []):
        raw_data_type = variable.get('dataType')
        data_type = 'int' if raw_data_type == 'int' else ('csv' if raw_data_type == 'csv' else 'string')
        default_value = safe_int(variable.get('defaultValue'), 0) if data_type == 'int' else str(variable.get('defaultValue', ''))
        normalized.append({
            'id': str(variable.get('id') or f'workflow-variable-{index}'),
            'name': str(variable.get('name') or f'变量{index + 1}'),
            'dataType': data_type,
            'defaultValue': default_value,
        })
    return normalized


def build_initial_variables(variable_defs: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    values = {}
    by_id = {}
    for variable in variable_defs:
        by_id[variable['id']] = variable
        values[variable['id']] = variable['defaultValue']
    return values, by_id


def resolve_variable_value(variable_id: str | None, variable_values: dict[str, Any], variable_defs_by_id: dict[str, dict[str, Any]]) -> Any:
    if not variable_id:
        return ''
    variable = variable_defs_by_id.get(str(variable_id))
    if not variable:
        return ''
    value = variable_values.get(variable['id'], variable.get('defaultValue'))
    if variable.get('dataType') == 'int':
        return safe_int(value, safe_int(variable.get('defaultValue'), 0))
    return '' if value is None else str(value)


def to_csv_text(raw_value: Any) -> str:
    if isinstance(raw_value, list) and raw_value and isinstance(raw_value[0], dict):
        headers = list(raw_value[0].keys())
        rows = [','.join(str(row.get(key, '')) for key in headers) for row in raw_value]
        return ','.join(headers) + ('\n' + '\n'.join(rows) if rows else '')
    if isinstance(raw_value, dict):
        headers = list(raw_value.keys())
        return ','.join(headers) + ('\n' + ','.join(str(raw_value.get(key, '')) for key in headers) if headers else '')
    return '' if raw_value is None else str(raw_value)


def assign_variable_value(variable_id: str | None, raw_value: Any, variable_values: dict[str, Any], variable_defs_by_id: dict[str, dict[str, Any]]) -> tuple[bool, Any]:
    variable = variable_defs_by_id.get(str(variable_id)) if variable_id else None
    if not variable:
        return False, raw_value
    if variable.get('dataType') == 'int':
        converted = safe_int(raw_value, safe_int(variable.get('defaultValue'), 0))
        variable_values[variable['id']] = converted
        return True, converted
    if variable.get('dataType') == 'csv':
        converted = to_csv_text(raw_value)
        variable_values[variable['id']] = converted
        return True, converted
    if isinstance(raw_value, (dict, list)):
        converted = json.dumps(raw_value, ensure_ascii=False)
    else:
        converted = '' if raw_value is None else str(raw_value)
    variable_values[variable['id']] = converted
    return True, converted


def run_readonly_query(sql: str) -> list[dict[str, Any]]:
    normalized = str(sql or '').strip()
    lowered = normalized.lower()
    if not lowered.startswith('select '):
        raise ValueError('仅支持 SELECT 查询')
    if ';' in normalized:
        raise ValueError('SQL 中不允许使用分号')
    conn = sensor_db._get_connection()
    cursor = conn.cursor()
    cursor.execute(normalized)
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


def get_analysis_request_args() -> tuple[str, int, int]:
    device_id = str(request.args.get('device_id') or 'SmartAgriculture_thermometer').strip() or 'SmartAgriculture_thermometer'
    hours = max(1, min(safe_int(request.args.get('hours'), 48), 168))
    limit = max(1, min(safe_int(request.args.get('limit'), 8), 50))
    return device_id, hours, limit


def get_model_request_args() -> tuple[str, int, int, str]:
    device_id, hours, _ = get_analysis_request_args()
    min_points = max(12, min(safe_int(request.args.get('min_points'), 24), 240))
    target = str(request.args.get('target') or 'all').strip() or 'all'
    return device_id, hours, min_points, target


def parse_string_list_query(name: str) -> list[str]:
    values = request.args.getlist(name)
    if len(values) == 1 and ',' in values[0]:
        values = [item.strip() for item in values[0].split(',')]
    return [str(item).strip() for item in values if str(item).strip()]


def get_advanced_prediction_request_args() -> dict[str, Any]:
    device_id, _, _ = get_analysis_request_args()
    target = str(request.args.get('target') or 'soil_humidity').strip() or 'soil_humidity'
    resample = str(request.args.get('resample') or 'D').strip() or 'D'
    window = max(12, min(safe_int(request.args.get('window'), 120), 720))
    lags = max(1, min(safe_int(request.args.get('lags'), 7), 30))
    forecast_steps = max(1, min(safe_int(request.args.get('forecast'), 7), 60))
    low_threshold = _parse_query_float('low_threshold')
    high_threshold = _parse_query_float('high_threshold')
    feature_cols = parse_string_list_query('features')
    refresh_text = str(request.args.get('refresh') or 'true').strip().lower()
    refresh = refresh_text not in {'0', 'false', 'no'}

    return {
        'device_id': device_id,
        'target': target,
        'feature_cols': feature_cols or None,
        'resample': resample,
        'window': window,
        'lags': lags,
        'forecast_steps': forecast_steps,
        'low_threshold': low_threshold,
        'high_threshold': high_threshold,
        'refresh': refresh,
    }


def attach_advanced_prediction_file_urls(payload: dict[str, Any]) -> dict[str, Any]:
    return attach_prediction_file_urls(payload)


def run_analysis_task(analysis_type: str, device_id: str, hours: int, limit: int) -> Any:
    return sensor_db.run_analysis_task(
        analysis_type=analysis_type,
        device_id=device_id or 'SmartAgriculture_thermometer',
        hours=max(1, hours),
        limit=max(1, limit),
    )


@app.route('/')
def home():
    return render_template('home.html')


@app.route('/workflow-editor')
def workflow_editor():
    return render_template('workflow_editor.html')


@app.route('/screen-editor')
def screen_editor():
    return render_template('screen_editor.html')


OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'


def _parse_query_float(name: str) -> float | None:
    raw = request.args.get(name)
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        value = float(text.replace(',', '.'))
    except (TypeError, ValueError, AttributeError):
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    return value


@app.route('/api/weather/forecast', methods=['GET'])
def proxy_open_meteo_forecast():
    lat = _parse_query_float('latitude')
    lon = _parse_query_float('longitude')
    if lat is None or lon is None:
        return jsonify({
            'status': 'error',
            'message': '缺少或无法解析 latitude、longitude（例如 ?latitude=30.6&longitude=114.3）'
        }), 400

    lat = max(-90.0, min(90.0, lat))
    lon = max(-180.0, min(180.0, lon))
    params = urllib.parse.urlencode({
        'latitude': lat,
        'longitude': lon,
        'current': 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
        'timezone': 'auto',
    })
    upstream = f'{OPEN_METEO_FORECAST_URL}?{params}'

    try:
        req = urllib.request.Request(
            upstream,
            headers={
                'User-Agent': 'IA-Low-code-Development/1.0',
                'Accept-Encoding': 'identity',
            },
            method='GET',
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read()
            if not body or not body.strip():
                return jsonify({'status': 'error', 'message': '上游天气接口返回空内容'}), 502
            return Response(body, mimetype='application/json', headers={'Cache-Control': 'no-store'})
    except urllib.error.HTTPError as error:
        return jsonify({'status': 'error', 'message': f'上游 HTTP {error.code}'}), 502
    except Exception as error:
        return jsonify({'status': 'error', 'message': str(error)}), 502


@app.route('/api/agriculture/dashboard', methods=['GET'])
def get_agriculture_dashboard():
    return jsonify({'status': 'ok', 'data': build_smart_agriculture_payload()})


@app.route('/api/agriculture/sensor', methods=['GET'])
def get_agriculture_sensor():
    return jsonify({'status': 'ok', 'data': build_smart_agriculture_payload()['sensor']})


@app.route('/api/agriculture/camera/snapshot', methods=['GET'])
def get_agriculture_camera_snapshot():
    try:
        image_bytes = capture_snapshot_bytes()
    except RuntimeError as error:
        return jsonify({'status': 'error', 'message': str(error)}), 500

    return Response(
        image_bytes,
        mimetype='image/jpeg',
        headers={
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
        },
    )


@app.route('/api/agriculture/mock/update', methods=['POST'])
def update_agriculture_mock():
    payload = request.get_json() or {}
    section = str(payload.get('section') or '').strip()
    data = payload.get('data') or {}

    if section not in smart_agriculture_mock_data:
        return jsonify({'status': 'error', 'message': 'invalid section'}), 400
    if not isinstance(data, dict):
        return jsonify({'status': 'error', 'message': 'data must be an object'}), 400

    for key, value in data.items():
        if key == 'sensors' and isinstance(value, list):
            smart_agriculture_mock_data[section][str(key)] = value
        else:
            smart_agriculture_mock_data[section][str(key)] = '' if value is None else str(value)

    return jsonify({'status': 'ok', 'data': build_smart_agriculture_payload()[section]})


@app.route('/api/agriculture/analytics/overview', methods=['GET'])
def get_agriculture_overview():
    device_id, _, _ = get_analysis_request_args()
    overview = sensor_db.get_agriculture_overview(device_id=device_id)
    overview['runtime'] = get_runtime_status()
    overview['database'] = sensor_db.get_database_summary()
    return jsonify({'status': 'ok', 'data': overview})


@app.route('/api/agriculture/analytics/timeline', methods=['GET'])
def get_agriculture_timeline():
    device_id, hours, _ = get_analysis_request_args()
    timeline = sensor_db.get_agriculture_timeline(device_id=device_id, hours=hours, bucket_minutes=120)
    return jsonify({'status': 'ok', 'data': timeline})


@app.route('/api/agriculture/analytics/alerts', methods=['GET'])
def get_agriculture_alerts():
    device_id, hours, limit = get_analysis_request_args()
    alerts = sensor_db.get_agriculture_alerts(device_id=device_id, hours=hours, limit=limit)
    return jsonify({'status': 'ok', 'data': alerts})


@app.route('/api/agriculture/analytics/recommendations', methods=['GET'])
def get_agriculture_recommendations():
    device_id, _, _ = get_analysis_request_args()
    recommendations = sensor_db.get_agriculture_recommendations(device_id=device_id)
    return jsonify({'status': 'ok', 'data': recommendations})


@app.route('/api/agriculture/analytics/report', methods=['GET'])
def get_agriculture_report():
    device_id, _, _ = get_analysis_request_args()
    report = sensor_db.get_agriculture_report_payload(device_id=device_id)
    report['runtime'] = get_runtime_status()
    return jsonify({'status': 'ok', 'data': report})


@app.route('/api/agriculture/analytics/forecast', methods=['GET'])
def get_agriculture_forecast():
    device_id, hours, _ = get_analysis_request_args()
    forecast = sensor_db.get_agriculture_forecast(device_id=device_id, hours=hours)
    return jsonify({'status': 'ok', 'data': forecast})


@app.route('/api/agriculture/analytics/yield', methods=['GET'])
def get_agriculture_yield():
    device_id, hours, _ = get_analysis_request_args()
    prediction = sensor_db.get_agriculture_yield_prediction(device_id=device_id, hours=max(72, hours))
    return jsonify({'status': 'ok', 'data': prediction})


@app.route('/api/agriculture/analytics/decision', methods=['GET'])
def get_agriculture_decision():
    device_id, hours, _ = get_analysis_request_args()
    decision = sensor_db.get_agriculture_decision_engine(device_id=device_id, hours=hours)
    return jsonify({'status': 'ok', 'data': decision})


@app.route('/api/agriculture/analytics/advanced-prediction', methods=['GET'])
def get_agriculture_advanced_prediction():
    args = get_advanced_prediction_request_args()
    if args['target'] not in ADVANCED_VALID_COLUMNS:
        return json_error(
            f"不支持的预测字段：{args['target']}",
            400,
            'ADVANCED_PREDICTION_TARGET_INVALID',
        )

    try:
        if args['refresh']:
            result = run_prediction_analysis(
                db_path=sensor_db.db_path,
                device_id=args['device_id'],
                target=args['target'],
                feature_cols=args['feature_cols'],
                resample=args['resample'],
                window=args['window'],
                lags=args['lags'],
                forecast_steps=args['forecast_steps'],
                low_threshold=args['low_threshold'],
                high_threshold=args['high_threshold'],
            )
        else:
            result = load_prediction_artifacts(
                target=args['target'],
                device_id=args['device_id'],
            )
            if not result:
                return json_error(
                    '当前还没有已生成的高级预测分析结果，请先带默认参数访问一次接口生成结果。',
                    404,
                    'ADVANCED_PREDICTION_NOT_FOUND',
                )
    except Exception as error:
        fallback = load_prediction_artifacts(
            target=args['target'],
            device_id=args['device_id'],
        )
        if fallback:
            fallback['message'] = f"本次重新生成失败，已返回最近一次结果：{error}"
            return jsonify({'status': 'ok', 'data': attach_advanced_prediction_file_urls(fallback)})
        return json_error(str(error), 500, 'ADVANCED_PREDICTION_ERROR')

    return jsonify({'status': 'ok', 'data': attach_advanced_prediction_file_urls(result)})


@app.route('/api/agriculture/analytics/generated/<path:relative_path>', methods=['GET'])
def get_generated_analytics_file(relative_path: str):
    root = advanced_analytics_output_root.resolve()
    normalized_relative_path = str(relative_path or '').replace('\\', '/').lstrip('/')
    candidate = (root / normalized_relative_path).resolve()

    if candidate != root and root not in candidate.parents:
        return json_error('请求的文件路径无效。', 400, 'ADVANCED_PREDICTION_PATH_INVALID')
    if not candidate.exists() or not candidate.is_file():
        return json_error('请求的分析文件不存在。', 404, 'ADVANCED_PREDICTION_FILE_NOT_FOUND')

    return send_file(candidate, conditional=True, max_age=0)


@app.route('/api/agriculture/model', methods=['GET'])
def get_agriculture_model():
    device_id, hours, min_points, _ = get_model_request_args()
    model = sensor_db.build_abstract_data_model(device_id=device_id, hours=hours, min_points=min_points)
    return jsonify({'status': 'ok', 'data': model})


@app.route('/api/agriculture/model/predict', methods=['GET'])
def predict_agriculture_model():
    device_id, hours, min_points, target = get_model_request_args()
    prediction = sensor_db.predict_from_abstract_data_model(
        device_id=device_id,
        hours=hours,
        min_points=min_points,
        target=target,
    )
    return jsonify({'status': 'ok', 'data': prediction})


@app.route('/api/auth/session', methods=['GET'])
def get_auth_session():
    user = get_current_user()
    return jsonify({
        'status': 'ok',
        'authenticated': bool(user),
        'user': serialize_user_payload(user),
    })


@app.route('/api/auth/register', methods=['POST'])
def register_user():
    payload = request.get_json() or {}
    username = str(payload.get('username') or '').strip()
    password = str(payload.get('password') or '')
    display_name = str(payload.get('display_name') or '').strip()

    try:
        user = sensor_db.create_user(
            username=username,
            password=password,
            display_name=display_name or username,
        )
    except ValueError as exc:
        return json_error(str(exc), 400, 'VALIDATION_ERROR')

    session['user_id'] = user.get('id')
    return jsonify({
        'status': 'ok',
        'message': '注册成功',
        'user': serialize_user_payload(user),
    })


@app.route('/api/auth/login', methods=['POST'])
def login_user():
    payload = request.get_json() or {}
    username = str(payload.get('username') or '').strip()
    password = str(payload.get('password') or '')
    user = sensor_db.authenticate_user(username=username, password=password)
    if not user:
        return json_error('用户名或密码错误。', 401, 'INVALID_CREDENTIALS')

    session['user_id'] = user.get('id')
    return jsonify({
        'status': 'ok',
        'message': '登录成功',
        'user': serialize_user_payload(user),
    })


@app.route('/api/auth/logout', methods=['POST'])
def logout_user():
    session.pop('user_id', None)
    return jsonify({
        'status': 'ok',
        'message': '已退出登录',
    })


@app.route('/api/user-projects', methods=['GET'])
def list_user_projects():
    user, error_response = require_login()
    if error_response:
        return error_response

    project_type = str(request.args.get('type') or '').strip().lower() or None
    try:
        projects = sensor_db.list_user_projects(user_id=int(user['id']), project_type=project_type)
    except ValueError as exc:
        return json_error(str(exc), 400, 'VALIDATION_ERROR')

    return jsonify({
        'status': 'ok',
        'projects': projects,
    })


@app.route('/api/user-projects/<int:project_id>', methods=['GET'])
def get_user_project(project_id: int):
    user, error_response = require_login()
    if error_response:
        return error_response

    project = sensor_db.get_user_project(user_id=int(user['id']), project_id=project_id, include_data=True)
    if not project:
        return json_error('未找到对应的数据库项目。', 404, 'PROJECT_NOT_FOUND')

    return jsonify({
        'status': 'ok',
        'project': project,
    })


@app.route('/api/user-projects', methods=['POST'])
def save_user_project():
    user, error_response = require_login()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    project_id = payload.get('project_id')
    project_type = str(payload.get('project_type') or '').strip().lower()
    project_name = str(payload.get('name') or '').strip()
    project_data = payload.get('data')

    normalized_project_id = None
    if project_id not in (None, ''):
        try:
            normalized_project_id = int(project_id)
        except (TypeError, ValueError):
            return json_error('project_id 格式无效。', 400, 'VALIDATION_ERROR')

    try:
        project = sensor_db.save_user_project(
            user_id=int(user['id']),
            project_type=project_type,
            project_name=project_name,
            project_data=project_data,
            project_id=normalized_project_id,
        )
    except ValueError as exc:
        return json_error(str(exc), 400, 'VALIDATION_ERROR')
    except LookupError:
        return json_error('未找到对应的数据库项目。', 404, 'PROJECT_NOT_FOUND')

    return jsonify({
        'status': 'ok',
        'message': '项目已保存到数据库',
        'project': project,
    })


@app.route('/api/workflow/save', methods=['POST'])
def save_workflow():
    data = request.get_json() or {}
    current_workflow['nodes'] = data.get('nodes', [])
    current_workflow['next_id'] = data.get('next_id', 100)
    current_workflow['workflow_variables'] = data.get('workflow_variables', [])
    current_workflow['workflow_ports'] = data.get('workflow_ports', [])
    return jsonify({'status': 'ok'})


@app.route('/api/workflow/load', methods=['GET'])
def load_workflow():
    return jsonify(current_workflow)


@app.route('/api/workflow/execute', methods=['POST'])
def execute_workflow():
    data = request.get_json() or {}
    nodes_data = data.get('nodes', []) or []
    variable_defs = normalize_variable_defs(data.get('workflow_variables'))
    workflow_ports = data.get('workflow_ports', []) or []

    if not nodes_data:
        return jsonify({'logs': ['错误：没有节点数据。'], 'outputs': {}, 'port_values': {}})

    nodes_map = {node['id']: node for node in nodes_data}
    start_node = next((node for node in nodes_data if node.get('type') == 'start'), None)
    if not start_node:
        return jsonify({'logs': ['错误：未找到开始节点。'], 'outputs': {}, 'port_values': {}})

    variable_values, variable_defs_by_id = build_initial_variables(variable_defs)
    outputs: dict[str, Any] = {}
    logs: list[str] = []
    step_limit = 500

    def add_log(message: str) -> None:
        logs.append(message)

    def exec_node(node_id: Any, depth: int = 0) -> None:
        nonlocal step_limit
        if step_limit <= 0:
            add_log('错误：执行步数超限，可能存在死循环。')
            return
        step_limit -= 1

        if node_id is None:
            return

        node = nodes_map.get(node_id)
        if not node:
            add_log(f'警告：节点 {node_id} 不存在。')
            return

        indent = '  ' * depth
        props = node.get('properties', {}) or {}
        node_type = node.get('type', 'unknown')
        add_log(f"{indent}执行节点 [{node_type}] {node_name(node)}")

        if node_type == 'start':
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'sequence':
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'print':
            if props.get('messageSource') == 'variable':
                value = resolve_variable_value(props.get('variableId'), variable_values, variable_defs_by_id)
                add_log(f"{indent}打印: {value}")
            else:
                add_log(f"{indent}打印: {props.get('message', '')}")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'output':
            variable_id = props.get('variableId')
            value = resolve_variable_value(variable_id, variable_values, variable_defs_by_id)
            outputs[str(node.get('id'))] = value
            variable_name = variable_defs_by_id.get(str(variable_id), {}).get('name', '未绑定变量')
            add_log(f"{indent}输出端口: {variable_name} = {value}")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'get_sensor_info':
            source = props.get('source', 'list_sensors')
            limit = max(1, min(safe_int(props.get('limit', 5), 5), 100))
            device_id = str(props.get('deviceId') or '').strip() or 'SmartAgriculture_thermometer'
            payload: Any = []
            try:
                if source == 'latest_data':
                    payload = sensor_db.get_latest_sensor_data(device_id, limit)
                    add_log(f"{indent}读取传感器最近数据: device={device_id}, rows={len(payload)}")
                else:
                    payload = sensor_db.list_sensors()
                    add_log(f"{indent}读取传感器设备列表: rows={len(payload)}")
            except Exception as exc:
                payload = []
                add_log(f"{indent}读取传感器信息失败: {exc}")

            written, converted = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variable_defs_by_id)
            if written:
                add_log(f"{indent}写入变量成功: {converted if isinstance(converted, int) else 'JSON文本'}")
            else:
                add_log(f"{indent}未写入变量：未绑定 targetVariableId")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'db_query':
            sql = str(props.get('sql') or '').strip()
            payload: Any = []
            try:
                payload = run_readonly_query(sql)
                add_log(f"{indent}数据库查询成功: rows={len(payload)}")
            except Exception as exc:
                payload = []
                add_log(f"{indent}数据库查询失败: {exc}")

            written, converted = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variable_defs_by_id)
            if written:
                add_log(f"{indent}写入变量成功: {converted if isinstance(converted, int) else 'JSON文本'}")
            else:
                add_log(f"{indent}未写入变量：未绑定 targetVariableId")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'analytics_summary':
            analysis_type = str(props.get('analysisType') or 'overview').strip() or 'overview'
            device_id = str(props.get('deviceId') or '').strip() or 'SmartAgriculture_thermometer'
            hours = max(1, min(safe_int(props.get('hours'), 48), 168))
            limit = max(1, min(safe_int(props.get('limit'), 8), 50))
            payload: Any = []
            try:
                payload = run_analysis_task(analysis_type, device_id, hours, limit)
                result_size = len(payload) if isinstance(payload, list) else len(payload.keys()) if isinstance(payload, dict) else 1
                add_log(f"{indent}分析任务完成: type={analysis_type}, size={result_size}")
            except Exception as exc:
                payload = []
                add_log(f"{indent}分析任务失败: {exc}")

            written, converted = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variable_defs_by_id)
            if written:
                add_log(f"{indent}写入变量成功: {converted if isinstance(converted, int) else 'JSON文本'}")
            else:
                add_log(f"{indent}未写入变量：未绑定 targetVariableId")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'abstract_data_model':
            device_id = str(props.get('deviceId') or '').strip() or 'SmartAgriculture_thermometer'
            hours = max(24, min(safe_int(props.get('hours'), 168), 336))
            min_points = max(12, min(safe_int(props.get('minPoints'), 24), 240))
            payload: Any = {}
            try:
                payload = sensor_db.build_abstract_data_model(
                    device_id=device_id,
                    hours=hours,
                    min_points=min_points,
                )
                status = payload.get('status', 'unknown') if isinstance(payload, dict) else 'unknown'
                model_name = payload.get('model_name', '未知模型') if isinstance(payload, dict) else '未知模型'
                add_log(f"{indent}抽象数据模型构建完成: status={status}, model={model_name}")
            except Exception as exc:
                payload = {'status': 'error', 'message': str(exc)}
                add_log(f"{indent}抽象数据模型构建失败: {exc}")

            written, converted = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variable_defs_by_id)
            if written:
                add_log(f"{indent}写入变量成功: {converted if isinstance(converted, int) else 'JSON文本'}")
            else:
                add_log(f"{indent}未写入变量：未绑定 targetVariableId")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'advanced_prediction':
            output_kind = str(props.get('outputKind') or 'forecast_plot_url').strip() or 'forecast_plot_url'
            payload: Any = ''
            try:
                prediction = run_workflow_prediction(sensor_db, props)
                payload = prediction['payload']
                add_log(
                    f"{indent}高级预测完成: target={prediction['target']}, output={prediction['output_label']}, source={'重新生成' if prediction['source'] == 'generated' else '缓存结果'}"
                )
                if prediction['warning_message']:
                    add_log(f"{indent}{prediction['warning_message']}")
            except Exception as exc:
                payload = '' if output_kind.endswith('_url') or output_kind.endswith('_csv') else {'status': 'error', 'message': str(exc)}
                add_log(f"{indent}高级预测失败: {exc}")

            written, _ = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variable_defs_by_id)
            if written:
                add_log(f"{indent}鍐欏叆鍙橀噺鎴愬姛: {('图片地址' if output_kind.endswith('_url') else ('CSV文本' if output_kind.endswith('_csv') else 'JSON文本'))}")
            else:
                add_log(f"{indent}鏈啓鍏ュ彉閲忥細鏈粦瀹?targetVariableId")
            exec_node(props.get('nextNodeId'), depth)
            return

        if node_type == 'loop':
            cond_type = props.get('loopConditionType', 'count')
            loop_count = safe_int(props.get('loopCount', 1), 1)
            body_ids = props.get('bodyNodeIds', []) or []
            next_id = props.get('nextNodeId')

            if cond_type == 'expr':
                add_log(f"{indent}循环条件(expr) 尚未执行化，先按 1 次运行：{props.get('loopConditionExpr', '')}")
                loop_count = 1
            loop_count = max(loop_count, 1)

            add_log(f"{indent}循环开始，共 {loop_count} 次")
            for i in range(1, loop_count + 1):
                add_log(f"{indent}  第 {i} 次")
                if body_ids:
                    for body_id in body_ids:
                        exec_node(body_id, depth + 1)
                else:
                    add_log(f"{indent}  循环体为空")
            add_log(f"{indent}循环结束")
            exec_node(next_id, depth)
            return

        if node_type == 'branch':
            condition = bool(props.get('branchCondition', True))
            true_body_ids = props.get('trueBodyNodeIds') or []
            false_body_ids = props.get('falseBodyNodeIds') or []
            true_branch = true_body_ids[0] if true_body_ids else props.get('trueBranchId')
            false_branch = false_body_ids[0] if false_body_ids else props.get('falseBranchId')
            add_log(f"{indent}分支判断: {'真' if condition else '假'}")
            if condition and (true_body_ids or true_branch):
                if true_body_ids:
                    for body_id in true_body_ids:
                        exec_node(body_id, depth + 1)
                else:
                    exec_node(true_branch, depth + 1)
            elif (not condition) and (false_body_ids or false_branch):
                if false_body_ids:
                    for body_id in false_body_ids:
                        exec_node(body_id, depth + 1)
                else:
                    exec_node(false_branch, depth + 1)
            else:
                add_log(f"{indent}没有有效的分支节点")
            exec_node(props.get('nextNodeId'), depth)
            return

        add_log(f"{indent}警告：未知节点类型 {node_type}")

    add_log('========== 开始执行工作流 ==========')
    try:
        exec_node(start_node['id'])
        add_log('========== 工作流执行完成 ==========')
    except Exception as exc:  # pragma: no cover
        add_log(f'错误：{exc}')

    port_values = {}
    for port in workflow_ports:
        port_name = str(port.get('name') or '').strip()
        if not port_name:
            continue
        node = nodes_map.get(port.get('nodeId'))
        if not node or node.get('type') != 'output':
            continue
        value = resolve_variable_value(node.get('properties', {}).get('variableId'), variable_values, variable_defs_by_id)
        port_values[port_name] = value

    return jsonify({'logs': logs, 'outputs': outputs, 'port_values': port_values})


@app.route('/api/debug/start', methods=['POST'])
def debug_start():
    try:
        data = request.get_json() or {}
        session = create_session(data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        app.logger.exception('debug_start failed')
        return jsonify({'error': f'进入调试失败: {exc}'}), 500

    try:
        session_id = os.urandom(12).hex()
        debug_sessions[session_id] = session
        return jsonify({'session_id': session_id, 'state': serialize_state(session)})
    except Exception as exc:
        app.logger.exception('debug_start serialize failed')
        return jsonify({'error': f'进入调试失败: {exc}'}), 500


@app.route('/api/debug/step', methods=['POST'])
def debug_step():
    try:
        data = request.get_json() or {}
        session_id = data.get('session_id')
        session = debug_sessions.get(session_id)
        if not session:
            return jsonify({'error': 'invalid session'}), 400
        logs, finished = step_once(session)
        return jsonify({'logs': logs, 'finished': finished, 'state': serialize_state(session)})
    except Exception as exc:
        app.logger.exception('debug_step failed')
        return jsonify({'error': f'单步执行失败: {exc}'}), 500


@app.route('/api/debug/continue', methods=['POST'])
def debug_continue():
    try:
        data = request.get_json() or {}
        session_id = data.get('session_id')
        session = debug_sessions.get(session_id)
        if not session:
            return jsonify({'error': 'invalid session'}), 400

        logs_all: list[str] = []
        first = True
        for _ in range(500):
            current_id = session.get('current_id')
            if current_id is None:
                break
            node = session['nodes_map'].get(current_id) or {}
            breakpoint_on = (node.get('properties') or {}).get('breakpoint') is True
            if breakpoint_on and not first:
                logs_all.append(f'命中断点: {current_id}')
                break
            first = False
            logs, finished = step_once(session)
            logs_all.extend(logs)
            if finished:
                break

        return jsonify({'logs': logs_all, 'finished': session.get('current_id') is None, 'state': serialize_state(session)})
    except Exception as exc:
        app.logger.exception('debug_continue failed')
        return jsonify({'error': f'继续执行失败: {exc}'}), 500


@app.route('/api/debug/stop', methods=['POST'])
def debug_stop():
    data = request.get_json() or {}
    session_id = data.get('session_id')
    debug_sessions.pop(session_id, None)
    return jsonify({'status': 'ok'})





if __name__ == '__main__':
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_app_mqtt()
    app.run(host='0.0.0.0', port=5000, debug=True)
