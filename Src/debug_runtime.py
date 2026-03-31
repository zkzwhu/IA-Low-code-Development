def find_start(nodes_data):
    for node in nodes_data:
        if node.get('type') == 'start':
            return node
    return None


def node_name(node):
    props = node.get('properties', {}) or {}
    return props.get('name') or f"{node.get('type', 'node')}#{node.get('id')}"


def safe_int(value, default=1, minimum=1):
    try:
        value = int(value)
    except Exception:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def create_session(nodes_data):
    start = find_start(nodes_data)
    if not start:
        raise ValueError('no start node')

    return {
        "nodes_map": {node['id']: node for node in nodes_data},
        "current_id": start['id'],
        "vars": {},
        "callstack": [],
        "continuations": [],
    }


def _frame_text(frame):
    if not frame:
        return None

    if frame.get('kind') == 'loop':
        total = len(frame.get('body_ids') or [])
        if total == 0:
            return f"循环 {node_name(frame['node'])}（空循环体）"
        current_index = min(frame.get('body_index', 1), total)
        return f"循环 {node_name(frame['node'])}：第 {frame.get('iteration', 1)}/{frame.get('loop_count', 1)} 次，第 {current_index}/{total} 个节点"

    if frame.get('kind') == 'branch':
        total = len(frame.get('body_ids') or [])
        return f"分支 {node_name(frame['node'])}：{frame.get('branch_label', '未知')}，剩余 {max(total - frame.get('body_index', 0), 0)} 个节点"

    return None


def _node_debug_summary(node):
    if not node:
        return "（调试已结束）"

    props = node.get('properties', {}) or {}
    lines = [
        f"ID: {node.get('id')}",
        f"类型: {node.get('type', 'node')}",
        f"名称: {node_name(node)}"
    ]

    ntype = node.get('type')
    if ntype == 'print':
        lines.append(f"message = {props.get('message', '')!r}")
    elif ntype == 'sequence':
        lines.append(f"comment = {props.get('comment', '')!r}")
    elif ntype == 'loop':
        if props.get('loopConditionType') == 'expr':
            lines.append(f"loopExpr = {props.get('loopConditionExpr', '')!r}")
        else:
            lines.append(f"loopCount = {safe_int(props.get('loopCount', 1))}")
        lines.append(f"bodyNodeIds = {props.get('bodyNodeIds') or []}")
    elif ntype == 'branch':
        lines.append(f"condition = {bool(props.get('branchCondition', True))}")
        lines.append(f"trueBodyNodeIds = {props.get('trueBodyNodeIds') or []}")
        lines.append(f"falseBodyNodeIds = {props.get('falseBodyNodeIds') or []}")

    if props.get('nextNodeId') is not None:
        lines.append(f"nextNodeId = {props.get('nextNodeId')}")
    if props.get('breakpoint') is True:
        lines.append("breakpoint = true")

    return "\n".join(lines)


def serialize_state(session):
    current_id = session.get('current_id')
    nodes_map = session.get('nodes_map', {})
    current_node = nodes_map.get(current_id) if current_id is not None else None
    history = session.get('callstack', [])
    continuations = session.get('continuations', [])
    vars_ = session.get('vars', {})

    stack_lines = []
    if current_node is None:
        stack_lines.append("当前: （调试已结束）")
    else:
        stack_lines.append(f"当前: {node_name(current_node)} (#{current_id})")

    frame_lines = [_frame_text(frame) for frame in continuations]
    frame_lines = [line for line in frame_lines if line]
    if frame_lines:
        stack_lines.append("执行上下文:")
        for line in reversed(frame_lines[-5:]):
            stack_lines.append(f"  {line}")

    if history:
        stack_lines.append("最近执行:")
        for item in history[-8:]:
            stack_lines.append(f"  {item}")

    vars_lines = []
    if not vars_:
        vars_lines.append("（无变量）")
    else:
        for key in sorted(vars_.keys()):
            vars_lines.append(f"{key} = {vars_[key]!r}")

    loop_lines = [line for line in frame_lines if line.startswith("循环 ")]
    loop_text = loop_lines[-1] if loop_lines else "（无循环上下文）"

    return {
        "currentId": current_id,
        "currentNode": None if current_node is None else {
            "id": current_node.get('id'),
            "type": current_node.get('type'),
            "name": node_name(current_node)
        },
        "currentNodeText": _node_debug_summary(current_node),
        "stackText": "\n".join(stack_lines),
        "varsText": "\n".join(vars_lines),
        "loopText": loop_text,
        "statusText": "调试已结束" if current_node is None else f"暂停在 {node_name(current_node)}"
    }


def _advance_after_subflow(session):
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
                logs.append(f"↪ 循环继续：第 {frame.get('iteration', 1)} 次，第 {frame['body_index']}/{len(body_ids)} 个节点")
            elif frame.get('kind') == 'branch':
                logs.append(f"↪ 分支继续：{frame.get('branch_label', '未知')} 分支第 {frame['body_index']}/{len(body_ids)} 个节点")
            return logs

        if frame.get('kind') == 'loop' and frame.get('iteration', 1) < frame.get('loop_count', 1):
            frame['iteration'] += 1
            frame['body_index'] = 0
            logs.append(f"↻ 进入循环第 {frame['iteration']}/{frame['loop_count']} 次")
            continue

        continuations.pop()
        if frame.get('kind') == 'loop':
            logs.append(f"✓ 循环结束: {node_name(frame['node'])}")
        elif frame.get('kind') == 'branch':
            logs.append(f"✓ 分支结束: {node_name(frame['node'])}")

        after_id = frame.get('after_id')
        if after_id is not None:
            session['current_id'] = after_id
            return logs

    session['current_id'] = None
    return logs


def _goto(session, next_id):
    if next_id is not None:
        session['current_id'] = next_id
        return []
    return _advance_after_subflow(session)


def step_once(session):
    nodes_map = session['nodes_map']
    current_id = session.get('current_id')
    logs = []

    if current_id is None:
        return logs, True

    node = nodes_map.get(current_id)
    if not node:
        logs.append(f"⚠ 节点 {current_id} 不存在，调试结束")
        session['current_id'] = None
        return logs, True

    props = node.get('properties', {}) or {}
    node_type = node.get('type')
    name = node_name(node)
    logs.append(f"▶ 执行节点 [{node_type}] {name}")

    if node_type == 'start':
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'sequence':
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'print':
        logs.append(f"🖨 打印: {props.get('message', '')}")
        logs.extend(_goto(session, props.get('nextNodeId')))
    elif node_type == 'loop':
        body_ids = props.get('bodyNodeIds', []) or []
        next_id = props.get('nextNodeId')
        if props.get('loopConditionType') == 'expr':
            loop_count = 1
            logs.append(f"🔁 表达式循环暂按 1 次处理: {props.get('loopConditionExpr', '')}")
        else:
            loop_count = safe_int(props.get('loopCount', 1))

        if not body_ids:
            logs.append("⚠ 循环体为空，直接跳过")
            logs.extend(_goto(session, next_id))
        else:
            session.setdefault('continuations', []).append({
                "kind": "loop",
                "node": node,
                "body_ids": body_ids,
                "body_index": 1,
                "iteration": 1,
                "loop_count": loop_count,
                "after_id": next_id
            })
            session['current_id'] = body_ids[0]
            logs.append(f"🔁 进入循环，共 {loop_count} 次")
            logs.append(f"↪ 循环第 1/{loop_count} 次，第 1/{len(body_ids)} 个节点")
    elif node_type == 'branch':
        cond = bool(props.get('branchCondition', True))
        branch_label = 'True' if cond else 'False'
        body_ids = (props.get('trueBodyNodeIds') or []) if cond else (props.get('falseBodyNodeIds') or [])
        fallback_id = props.get('trueBranchId') if cond else props.get('falseBranchId')
        next_id = props.get('nextNodeId')
        logs.append(f"🌿 分支判断: {cond}")

        if body_ids:
            session.setdefault('continuations', []).append({
                "kind": "branch",
                "node": node,
                "body_ids": body_ids,
                "body_index": 1,
                "branch_label": branch_label,
                "after_id": next_id
            })
            session['current_id'] = body_ids[0]
            logs.append(f"↪ 进入 {branch_label} 分支，第 1/{len(body_ids)} 个节点")
        elif fallback_id is not None:
            session['current_id'] = fallback_id
            logs.append(f"↪ 跳转到 {branch_label} 分支目标节点 #{fallback_id}")
        else:
            logs.append("⚠ 当前分支没有可执行节点，直接进入后续节点")
            logs.extend(_goto(session, next_id))
    else:
        logs.append(f"⚠ 未实现的节点类型: {node_type}，调试结束")
        session['current_id'] = None

    session.setdefault('callstack', []).append(f"{node_type}:{name}")
    return logs, session.get('current_id') is None
