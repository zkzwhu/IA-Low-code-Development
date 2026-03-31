import os
import uuid
import time
from flask import Flask, render_template, request, jsonify
from debug_runtime import create_session, serialize_state, step_once

current_dir = os.path.dirname(os.path.abspath(__file__))
template_dir = os.path.join(current_dir, '..', 'templates')
static_dir = os.path.join(current_dir, '..', 'static')

app = Flask(__name__,
            template_folder=template_dir,
            static_folder=static_dir)

# 内存存储当前工作流
current_workflow = {
    "nodes": [],
    "next_id": 100
}

# 简易调试会话（内存）
debug_sessions = {}

def _find_start(nodes_data):
    for n in nodes_data:
        if n.get('type') == 'start':
            return n
    return None

def _node_name(node):
    props = node.get('properties', {}) or {}
    return props.get('name') or f"{node.get('type','node')}#{node.get('id')}"

def _session_state_text(sess):
    cur = sess.get('current_id')
    stack = sess.get('callstack', [])
    vars_ = sess.get('vars', {})
    stack_lines = []
    if cur is None:
        stack_lines.append("（已结束）")
    else:
        stack_lines.append(f"当前: {cur}")
    if stack:
        stack_lines.append("栈:")
        for s in stack[-10:]:
            stack_lines.append("  " + s)
    vars_lines = []
    if not vars_:
        vars_lines.append("（无变量）")
    else:
        for k in sorted(vars_.keys()):
            vars_lines.append(f"{k} = {vars_[k]!r}")
    return {
        "stackText": "\n".join(stack_lines),
        "varsText": "\n".join(vars_lines)
    }

def _step_once(sess):
    nodes_map = sess['nodes_map']
    cur_id = sess.get('current_id')
    logs = []
    if cur_id is None:
        return logs, True
    node = nodes_map.get(cur_id)
    if not node:
        logs.append(f"⚠️ 节点 {cur_id} 不存在，结束")
        sess['current_id'] = None
        return logs, True

    props = node.get('properties', {}) or {}
    ntype = node.get('type')
    name = _node_name(node)
    logs.append(f"▶ 单步执行 [{ntype}] {name}")

    # 断点：continue 会处理；step 总是执行当前节点
    vars_ = sess.setdefault('vars', {})

    def goto(nid):
        sess['current_id'] = nid

    if ntype == 'start':
        goto(props.get('nextNodeId'))
    elif ntype == 'sequence':
        goto(props.get('nextNodeId'))
    elif ntype == 'print':
        msg = props.get('message', '')
        logs.append(f"🖨️ 打印: {msg}")
        goto(props.get('nextNodeId'))
    elif ntype == 'loop':
        # 调试：用 loopFrame 保存迭代状态
        frame = sess.get('loop_frame')
        cond_type = props.get('loopConditionType', 'count')
        loop_count = props.get('loopCount', 1)
        body_ids = props.get('bodyNodeIds', []) or []
        next_id = props.get('nextNodeId')
        if cond_type == 'expr':
            logs.append(f"🔁 expr 条件未执行化，按 1 次处理: {props.get('loopConditionExpr','')}")
            loop_count = 1
        try:
            loop_count = int(loop_count)
        except Exception:
            loop_count = 1
        loop_count = max(1, loop_count)

        if not frame:
            frame = {"i": 1, "j": 0, "loop_count": loop_count, "body": body_ids, "next": next_id}
            sess['loop_frame'] = frame
            logs.append(f"🔄 进入循环: 共 {loop_count} 次")

        if not frame["body"]:
            logs.append("⚠️ 循环体为空")
            # 直接结束循环
            sess['loop_frame'] = None
            goto(frame["next"])
        else:
            # 执行循环体中的一个节点（按列表逐个 step）
            bid = frame["body"][frame["j"]]
            logs.append(f"  ↻ 循环第 {frame['i']} 次 · 第 {frame['j']+1}/{len(frame['body'])} 个节点")
            frame["j"] += 1
            if frame["j"] >= len(frame["body"]):
                frame["j"] = 0
                frame["i"] += 1
                if frame["i"] > frame["loop_count"]:
                    logs.append("✅ 循环结束")
                    sess['loop_frame'] = None
                    goto(frame["next"])
                    return logs, False
            goto(bid)
    elif ntype == 'branch':
        cond = props.get('branchCondition', True)
        t_list = props.get('trueBodyNodeIds') or []
        f_list = props.get('falseBodyNodeIds') or []
        t = t_list[0] if t_list else props.get('trueBranchId')
        f = f_list[0] if f_list else props.get('falseBranchId')
        logs.append(f"🌿 分支判断: {cond}")
        goto(t if cond else f)
    else:
        logs.append(f"⚠️ 未实现的节点类型: {ntype}，结束")
        goto(None)

    # 记录调用信息（简化版）
    sess.setdefault('callstack', []).append(f"{ntype}:{name}")
    # 是否结束
    return logs, sess.get('current_id') is None

@app.route('/api/debug/start', methods=['POST'])
def debug_start():
    data = request.get_json() or {}
    nodes_data = data.get('nodes', [])
    if not nodes_data:
        return jsonify({"error": "no nodes"}), 400
    sid = str(uuid.uuid4())
    try:
        session = create_session(nodes_data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    session["created_at"] = time.time()
    debug_sessions[sid] = session
    return jsonify({"session_id": sid, "state": serialize_state(session)})

@app.route('/api/debug/step', methods=['POST'])
def debug_step():
    data = request.get_json() or {}
    sid = data.get('session_id')
    sess = debug_sessions.get(sid)
    if not sess:
        return jsonify({"error": "invalid session"}), 400
    logs, finished = step_once(sess)
    return jsonify({"logs": logs, "finished": finished, "state": serialize_state(sess)})

@app.route('/api/debug/continue', methods=['POST'])
def debug_continue():
    data = request.get_json() or {}
    sid = data.get('session_id')
    sess = debug_sessions.get(sid)
    if not sess:
        return jsonify({"error": "invalid session"}), 400
    logs_all = []
    # 连续执行：遇到断点（当前节点 breakpoint=true 且不是第一次）就停
    first = True
    for _ in range(500):
        cur = sess.get('current_id')
        if cur is None:
            break
        node = sess['nodes_map'].get(cur) or {}
        bp = (node.get('properties') or {}).get('breakpoint') is True
        if bp and not first:
            logs_all.append(f"⛔ 命中断点: {cur}")
            break
        first = False
        logs, finished = step_once(sess)
        logs_all.extend(logs)
        if finished:
            break
    return jsonify({"logs": logs_all, "finished": sess.get('current_id') is None, "state": serialize_state(sess)})

@app.route('/api/debug/stop', methods=['POST'])
def debug_stop():
    data = request.get_json() or {}
    sid = data.get('session_id')
    if sid in debug_sessions:
        debug_sessions.pop(sid, None)
    return jsonify({"status": "ok"})

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/workflow/save', methods=['POST'])
def save_workflow():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    current_workflow['nodes'] = data.get('nodes', [])
    current_workflow['next_id'] = data.get('next_id', 100)
    return jsonify({"status": "ok"})

@app.route('/api/workflow/load', methods=['GET'])
def load_workflow():
    return jsonify(current_workflow)

@app.route('/api/workflow/execute', methods=['POST'])
def execute_workflow():
    data = request.get_json()
    nodes_data = data.get('nodes', [])
    if not nodes_data:
        return jsonify({"logs": ["❌ 错误：没有节点数据"]})

    nodes_map = {node['id']: node for node in nodes_data}

    start_node = None
    for node in nodes_data:
        if node.get('type') == 'start':
            start_node = node
            break

    if not start_node:
        return jsonify({"logs": ["❌ 错误：未找到开始节点"]})

    logs = []
    step_limit = 500

    def add_log(msg):
        logs.append(msg)

    def exec_node(node_id, depth=0):
        nonlocal step_limit
        if step_limit <= 0:
            add_log("❌ 执行步数超限，可能死循环")
            return
        step_limit -= 1

        if node_id is None:
            return
        node = nodes_map.get(node_id)
        if not node:
            add_log(f"⚠️ 警告：节点 {node_id} 不存在")
            return

        indent = "  " * depth
        node_type = node.get('type', 'unknown')
        add_log(f"{indent}▶ 执行节点 [{node_type}] ID:{node_id}")

        props = node.get('properties', {})

        if node_type == 'print':
            msg = props.get('message', '(空消息)')
            add_log(f"{indent}🖨️ 打印: {msg}")
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        elif node_type == 'sequence':
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        elif node_type == 'start':
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        elif node_type == 'loop':
            cond_type = props.get('loopConditionType', 'count')
            loop_count = props.get('loopCount', 1)
            body_ids = props.get('bodyNodeIds', []) or []
            next_id = props.get('nextNodeId')

            # 目前执行器只实现 count 模式；expr 模式先按 1 次执行并提示
            if cond_type == 'expr':
                add_log(f"{indent}🔁 循环条件(expr) 尚未执行化，先按 1 次运行：{props.get('loopConditionExpr', '')}")
                loop_count = 1
            try:
                loop_count = int(loop_count)
            except Exception:
                loop_count = 1
            if loop_count < 1:
                loop_count = 1

            add_log(f"{indent}🔄 循环开始: 共 {loop_count} 次")
            for i in range(1, loop_count + 1):
                add_log(f"{indent}   ↻ 循环第 {i} 次")
                if body_ids:
                    for bid in body_ids:
                        exec_node(bid, depth + 1)
                else:
                    add_log(f"{indent}  ⚠️ 循环体为空")
            add_log(f"{indent}✅ 循环结束")
            exec_node(next_id, depth)

        elif node_type == 'branch':
            condition = props.get('branchCondition', True)
            true_branch_ids = props.get('trueBodyNodeIds') or []
            false_branch_ids = props.get('falseBodyNodeIds') or []
            true_branch = true_branch_ids[0] if true_branch_ids else props.get('trueBranchId')
            false_branch = false_branch_ids[0] if false_branch_ids else props.get('falseBranchId')
            add_log(f"{indent}🌿 分支判断: 条件 = {'真' if condition else '假'}")
            if condition and (true_branch_ids or true_branch):
                if true_branch_ids:
                    for bid in true_branch_ids:
                        exec_node(bid, depth + 1)
                else:
                    exec_node(true_branch, depth + 1)
            elif not condition and (false_branch_ids or false_branch):
                if false_branch_ids:
                    for bid in false_branch_ids:
                        exec_node(bid, depth + 1)
                else:
                    exec_node(false_branch, depth + 1)
            else:
                add_log(f"{indent}  No valid branch selected")
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        else:
            add_log(f"{indent}⚠️ 未知节点类型: {node_type}")

    try:
        add_log("========== 开始执行工作流 ==========")
        exec_node(start_node['id'])
        add_log("========== 工作流执行完毕 ==========")
    except Exception as e:
        add_log(f"❌ 执行错误: {str(e)}")

    return jsonify({"logs": logs})

if __name__ == '__main__':
    app.run(debug=True)
