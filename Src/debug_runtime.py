from __future__ import annotations

from typing import Any
import json

from database import SensorDatabase

sensor_db = SensorDatabase()


def find_start(nodes_data: list[dict[str, Any]]) -> dict[str, Any] | None:
    for node in nodes_data:
        if node.get('type') == 'start':
            return node
    return None


def node_name(node: dict[str, Any]) -> str:
    props = node.get('properties', {}) or {}
    return props.get('name') or f"{node.get('type', 'node')}#{node.get('id')}"


def safe_int(value: Any, default: int = 1, minimum: int | None = 1) -> int:
    try:
        value = int(value)
    except Exception:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def normalize_variable_defs(variable_defs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = []
    for index, variable in enumerate(variable_defs or []):
        raw_data_type = variable.get('dataType')
        data_type = 'int' if raw_data_type == 'int' else ('csv' if raw_data_type == 'csv' else 'string')
        default_value = safe_int(variable.get('defaultValue'), 0, None) if data_type == 'int' else str(variable.get('defaultValue', ''))
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
    value = variable_values.get(variable['id'], variable['defaultValue'])
    if variable['dataType'] == 'int':
        return safe_int(value, safe_int(variable['defaultValue'], 0, None), None)
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
        converted = safe_int(raw_value, safe_int(variable.get('defaultValue'), 0, None), None)
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


def create_session(payload: dict[str, Any] | list[dict[str, Any]]) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else {'nodes': payload}
    nodes_data = data.get('nodes', []) or []
    start = find_start(nodes_data)
    if not start:
        raise ValueError('no start node')

    variable_defs = normalize_variable_defs(data.get('workflow_variables'))
    variable_values, variables_by_id = build_initial_variables(variable_defs)

    return {
        'nodes_map': {node['id']: node for node in nodes_data},
        'current_id': start['id'],
        'vars': variable_values,
        'variables_by_id': variables_by_id,
        'callstack': [],
        'continuations': [],
        'outputs': {},
    }


def _frame_text(frame: dict[str, Any] | None) -> str | None:
    if not frame:
        return None

    if frame.get('kind') == 'loop':
        total = len(frame.get('body_ids') or [])
        if total == 0:
            return f"循环 {node_name(frame['node'])}（空循环体）"
        current_index = min(frame.get('body_index', 1), total)
        return f"循环 {node_name(frame['node'])}: 第 {frame.get('iteration', 1)}/{frame.get('loop_count', 1)} 次，第 {current_index}/{total} 个节点"

    if frame.get('kind') == 'branch':
        total = len(frame.get('body_ids') or [])
        return f"分支 {node_name(frame['node'])}: {frame.get('branch_label', '未知')}，剩余 {max(total - frame.get('body_index', 0), 0)} 个节点"

    return None


def _node_debug_summary(node: dict[str, Any] | None, variables_by_id: dict[str, dict[str, Any]]) -> str:
    if not node:
        return '（调试已结束）'

    props = node.get('properties', {}) or {}
    lines = [
        f"ID: {node.get('id')}",
        f"类型: {node.get('type', 'node')}",
        f"名称: {node_name(node)}",
    ]

    node_type = node.get('type')
    if node_type == 'print':
        if props.get('messageSource') == 'variable':
            variable = variables_by_id.get(str(props.get('variableId')))
            lines.append(f"messageSource = variable ({variable.get('name') if variable else 'unknown'})")
        else:
            lines.append(f"message = {props.get('message', '')!r}")
    elif node_type == 'sequence':
        lines.append(f"comment = {props.get('comment', '')!r}")
    elif node_type == 'loop':
        if props.get('loopConditionType') == 'expr':
            lines.append(f"loopExpr = {props.get('loopConditionExpr', '')!r}")
        else:
            lines.append(f"loopCount = {safe_int(props.get('loopCount', 1))}")
        lines.append(f"bodyNodeIds = {props.get('bodyNodeIds') or []}")
    elif node_type == 'branch':
        lines.append(f"condition = {bool(props.get('branchCondition', True))}")
        lines.append(f"trueBodyNodeIds = {props.get('trueBodyNodeIds') or []}")
        lines.append(f"falseBodyNodeIds = {props.get('falseBodyNodeIds') or []}")
    elif node_type == 'output':
        variable = variables_by_id.get(str(props.get('variableId')))
        lines.append(f"variable = {variable.get('name') if variable else 'unknown'}")
    elif node_type == 'get_sensor_info':
        lines.append(f"source = {props.get('source', 'list_sensors')}")
        lines.append(f"deviceId = {props.get('deviceId', '')!r}")
        lines.append(f"limit = {safe_int(props.get('limit', 5))}")
        variable = variables_by_id.get(str(props.get('targetVariableId')))
        lines.append(f"targetVariable = {variable.get('name') if variable else 'unknown'}")
    elif node_type == 'db_query':
        lines.append(f"sql = {props.get('sql', '')!r}")
        variable = variables_by_id.get(str(props.get('targetVariableId')))
        lines.append(f"targetVariable = {variable.get('name') if variable else 'unknown'}")

    if props.get('nextNodeId') is not None:
        lines.append(f"nextNodeId = {props.get('nextNodeId')}")
    if props.get('breakpoint') is True:
        lines.append('breakpoint = true')

    return '\n'.join(lines)


def serialize_state(session: dict[str, Any]) -> dict[str, Any]:
    current_id = session.get('current_id')
    nodes_map = session.get('nodes_map', {})
    current_node = nodes_map.get(current_id) if current_id is not None else None
    history = session.get('callstack', [])
    continuations = session.get('continuations', [])
    vars_ = session.get('vars', {})
    variables_by_id = session.get('variables_by_id', {})

    stack_lines = []
    if current_node is None:
        stack_lines.append('当前: （调试已结束）')
    else:
        stack_lines.append(f"当前: {node_name(current_node)} (#{current_id})")

    frame_lines = [_frame_text(frame) for frame in continuations]
    frame_lines = [line for line in frame_lines if line]
    if frame_lines:
        stack_lines.append('执行上下文:')
        for line in reversed(frame_lines[-5:]):
            stack_lines.append(f"  {line}")

    if history:
        stack_lines.append('最近执行:')
        for item in history[-8:]:
            stack_lines.append(f"  {item}")

    vars_lines = []
    if not vars_:
        vars_lines.append('（无变量）')
    else:
        for variable_id, value in vars_.items():
            variable = variables_by_id.get(variable_id)
            variable_name = variable.get('name') if variable else variable_id
            vars_lines.append(f"{variable_name} = {value!r}")

    loop_lines = [line for line in frame_lines if line.startswith('循环 ')]
    loop_text = loop_lines[-1] if loop_lines else '（无循环上下文）'

    return {
        'currentId': current_id,
        'currentNode': None if current_node is None else {
            'id': current_node.get('id'),
            'type': current_node.get('type'),
            'name': node_name(current_node),
        },
        'currentNodeText': _node_debug_summary(current_node, variables_by_id),
        'stackText': '\n'.join(stack_lines),
        'varsText': '\n'.join(vars_lines),
        'loopText': loop_text,
        'statusText': '调试已结束' if current_node is None else f"暂停在 {node_name(current_node)}",
    }


def _advance_after_subflow(session: dict[str, Any]) -> list[str]:
    logs = []
    continuations = session.setdefault('continuations', [])

    while continuations:
        frame = continuations[-1]
        body_ids = frame.get('body_ids') or []
        next_index = frame.get('body_index', 0)

        if next_index < len(body_ids):
            next_id = body_ids[next_index]
            frame['body_index'] = next_index + 1
            session['current_id'] = next_id

            if frame.get('kind') == 'loop':
                logs.append(f"进入循环：第 {frame.get('iteration', 1)} 次，第 {frame['body_index']}/{len(body_ids)} 个节点")
            elif frame.get('kind') == 'branch':
                logs.append(f"进入分支：{frame.get('branch_label', '未知')}，第 {frame['body_index']}/{len(body_ids)} 个节点")
            return logs

        if frame.get('kind') == 'loop' and frame.get('iteration', 1) < frame.get('loop_count', 1):
            frame['iteration'] += 1
            frame['body_index'] = 0
            logs.append(f"进入循环第 {frame['iteration']}/{frame['loop_count']} 次")
            continue

        continuations.pop()
        if frame.get('kind') == 'loop':
            logs.append(f"循环结束: {node_name(frame['node'])}")
        elif frame.get('kind') == 'branch':
            logs.append(f"分支结束: {node_name(frame['node'])}")

        after_id = frame.get('after_id')
        if after_id is not None:
            session['current_id'] = after_id
            return logs

    session['current_id'] = None
    return logs


def _goto(session: dict[str, Any], next_id: Any) -> list[str]:
    if next_id is not None:
        session['current_id'] = next_id
        return []
    return _advance_after_subflow(session)


def step_once(session: dict[str, Any]) -> tuple[list[str], bool]:
    nodes_map = session['nodes_map']
    current_id = session.get('current_id')
    logs: list[str] = []

    if current_id is None:
        return logs, True

    node = nodes_map.get(current_id)
    if not node:
        logs.append(f'警告：节点 {current_id} 不存在，调试结束。')
        session['current_id'] = None
        return logs, True

    props = node.get('properties', {}) or {}
    node_type = node.get('type')
    variables_by_id = session.get('variables_by_id', {})
    variable_values = session.setdefault('vars', {})

    logs.append(f"执行节点 [{node_type}] {node_name(node)}")

    if node_type == 'start':
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'sequence':
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'print':
        if props.get('messageSource') == 'variable':
            value = resolve_variable_value(props.get('variableId'), variable_values, variables_by_id)
            logs.append(f"打印: {value}")
        else:
            logs.append(f"打印: {props.get('message', '')}")
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'output':
        variable = variables_by_id.get(str(props.get('variableId')))
        value = resolve_variable_value(props.get('variableId'), variable_values, variables_by_id)
        session.setdefault('outputs', {})[str(node.get('id'))] = value
        logs.append(f"输出端口: {(variable or {}).get('name', '未绑定变量')} = {value}")
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'get_sensor_info':
        source = props.get('source', 'list_sensors')
        limit = max(1, min(safe_int(props.get('limit', 5)), 100))
        device_id = str(props.get('deviceId') or '').strip() or 'SmartAgriculture_thermometer'
        payload: Any = []
        try:
            if source == 'latest_data':
                payload = sensor_db.get_latest_sensor_data(device_id, limit)
                logs.append(f"读取传感器最近数据: device={device_id}, rows={len(payload)}")
            else:
                payload = sensor_db.list_sensors()
                logs.append(f"读取传感器设备列表: rows={len(payload)}")
        except Exception as exc:
            payload = []
            logs.append(f"读取传感器信息失败: {exc}")
        written, converted = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variables_by_id)
        if written:
            logs.append(f"写入变量成功: {converted if isinstance(converted, int) else 'JSON文本'}")
        else:
            logs.append('未写入变量：未绑定 targetVariableId')
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'db_query':
        sql = str(props.get('sql') or '').strip()
        payload: Any = []
        try:
            payload = run_readonly_query(sql)
            logs.append(f"数据库查询成功: rows={len(payload)}")
        except Exception as exc:
            payload = []
            logs.append(f"数据库查询失败: {exc}")
        written, converted = assign_variable_value(props.get('targetVariableId'), payload, variable_values, variables_by_id)
        if written:
            logs.append(f"写入变量成功: {converted if isinstance(converted, int) else 'JSON文本'}")
        else:
            logs.append('未写入变量：未绑定 targetVariableId')
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'loop':
        body_ids = props.get('bodyNodeIds', []) or []
        next_id = props.get('nextNodeId')
        if props.get('loopConditionType') == 'expr':
            loop_count = 1
            logs.append(f"表达式循环暂按 1 次处理: {props.get('loopConditionExpr', '')}")
        else:
            loop_count = safe_int(props.get('loopCount', 1))

        if not body_ids:
            logs.append('循环体为空，直接跳过')
            logs.extend(_goto(session, next_id))
        else:
            session.setdefault('continuations', []).append({
                'kind': 'loop',
                'node': node,
                'body_ids': body_ids,
                'body_index': 1,
                'iteration': 1,
                'loop_count': loop_count,
                'after_id': next_id,
            })
            session['current_id'] = body_ids[0]
            logs.append(f"进入循环，共 {loop_count} 次")
    elif node_type == 'branch':
        cond = bool(props.get('branchCondition', True))
        branch_label = 'True' if cond else 'False'
        body_ids = (props.get('trueBodyNodeIds') or []) if cond else (props.get('falseBodyNodeIds') or [])
        fallback_id = props.get('trueBranchId') if cond else props.get('falseBranchId')
        next_id = props.get('nextNodeId')
        logs.append(f"分支判断: {cond}")

        if body_ids:
            session.setdefault('continuations', []).append({
                'kind': 'branch',
                'node': node,
                'body_ids': body_ids,
                'body_index': 1,
                'branch_label': branch_label,
                'after_id': next_id,
            })
            session['current_id'] = body_ids[0]
            logs.append(f"进入 {branch_label} 分支")
        elif fallback_id is not None:
            session['current_id'] = fallback_id
            logs.append(f"跳转到 {branch_label} 分支节点 #{fallback_id}")
        else:
            logs.append('当前分支没有可执行节点，直接进入后续节点')
            logs.extend(_goto(session, next_id))
    else:
        logs.append(f"警告：未知节点类型 {node_type}，调试结束")
        session['current_id'] = None

    session.setdefault('callstack', []).append(f"{node_type}:{node_name(node)}")
    return logs, session.get('current_id') is None