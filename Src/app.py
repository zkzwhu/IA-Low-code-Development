from __future__ import annotations

import os
import json
from atexit import register
from typing import Any

try:
    import cv2
except ModuleNotFoundError:
    cv2 = None

from flask import Flask, Response, jsonify, render_template, request

from debug_runtime import create_session, serialize_state, step_once
from database import SensorDatabase
from start_mqtt_listener import start_mqtt_listener


current_dir = os.path.dirname(os.path.abspath(__file__))
template_dir = os.path.join(current_dir, '..', 'templates')
static_dir = os.path.join(current_dir, '..', 'static')

app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)

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
    data = request.get_json() or {}
    try:
        session = create_session(data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    session_id = os.urandom(12).hex()
    debug_sessions[session_id] = session
    return jsonify({'session_id': session_id, 'state': serialize_state(session)})


@app.route('/api/debug/step', methods=['POST'])
def debug_step():
    data = request.get_json() or {}
    session_id = data.get('session_id')
    session = debug_sessions.get(session_id)
    if not session:
        return jsonify({'error': 'invalid session'}), 400
    logs, finished = step_once(session)
    return jsonify({'logs': logs, 'finished': finished, 'state': serialize_state(session)})


@app.route('/api/debug/continue', methods=['POST'])
def debug_continue():
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
