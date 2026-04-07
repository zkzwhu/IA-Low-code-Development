from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from flask import Flask, jsonify, render_template, request

from debug_runtime import create_session, serialize_state, step_once

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

smart_agriculture_mock_data = {
    'sensor': {
        'title': '传感器数据',
        'sensors': [
            {'name': '温度传感器', 'value': '24.6', 'unit': '°C', 'status': '正常'},
            {'name': '湿度传感器', 'value': '68', 'unit': '%', 'status': '正常'},
            {'name': '光照传感器', 'value': '18500', 'unit': 'Lux', 'status': '正常'},
            {'name': '土壤湿度', 'value': '45', 'unit': '%', 'status': '正常'}
        ]
    }
}


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def node_name(node: dict[str, Any]) -> str:
    props = node.get('properties', {}) or {}
    return props.get('name') or f"{node.get('type', 'node')}#{node.get('id')}"


def normalize_variable_defs(variable_defs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = []
    for index, variable in enumerate(variable_defs or []):
        data_type = 'int' if variable.get('dataType') == 'int' else 'string'
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


def current_time_text() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def build_smart_agriculture_payload() -> dict[str, dict[str, Any]]:
    sensor_data = {
        **smart_agriculture_mock_data['sensor'],
    }

    return {
        'sensor': sensor_data,
    }


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
        smart_agriculture_mock_data[section][str(key)] = '' if value is None else str(value)

    return jsonify({'status': 'ok', 'data': build_smart_agriculture_payload()[section]})


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
    app.run(debug=True)
