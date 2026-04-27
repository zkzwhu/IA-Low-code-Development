from __future__ import annotations

from typing import Any


DATA_SOURCE_TYPES = {"get_sensor_info", "db_query"}
DATA_CONSUMER_TYPES = {"environment_model", "analytics_summary", "abstract_data_model", "advanced_prediction", "output"}


def _props(node: dict[str, Any]) -> dict[str, Any]:
    return node.get("properties", {}) or {}


def _node_label(node: dict[str, Any]) -> str:
    props = _props(node)
    return f"{props.get('name') or node.get('type', 'node')}#{node.get('id')}"


def _edge_targets(node: dict[str, Any]) -> list[Any]:
    props = _props(node)
    targets: list[Any] = []
    for key in ("nextNodeId", "trueBranchId", "falseBranchId"):
        if props.get(key) is not None:
            targets.append(props.get(key))
    for key in ("bodyNodeIds", "trueBodyNodeIds", "falseBodyNodeIds"):
        value = props.get(key)
        if isinstance(value, list):
            targets.extend(item for item in value if item is not None)
    return targets


def build_workflow_edges(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nodes_map = {node.get("id"): node for node in nodes}
    edges: list[dict[str, Any]] = []
    for node in nodes:
        source_id = node.get("id")
        props = _props(node)
        for field in ("nextNodeId", "trueBranchId", "falseBranchId"):
            target_id = props.get(field)
            if target_id is not None and target_id in nodes_map:
                edges.append({"from": source_id, "to": target_id, "field": field, "kind": "control-data"})
        for field in ("bodyNodeIds", "trueBodyNodeIds", "falseBodyNodeIds"):
            value = props.get(field)
            if not isinstance(value, list):
                continue
            for target_id in value:
                if target_id is not None and target_id in nodes_map:
                    edges.append({"from": source_id, "to": target_id, "field": field, "kind": "control-data"})
    return edges


def topological_order(nodes: list[dict[str, Any]]) -> tuple[list[Any], list[str]]:
    nodes_map = {node.get("id"): node for node in nodes}
    indegree = {node_id: 0 for node_id in nodes_map}
    adjacency = {node_id: [] for node_id in nodes_map}
    for edge in build_workflow_edges(nodes):
        source_id = edge["from"]
        target_id = edge["to"]
        adjacency[source_id].append(target_id)
        indegree[target_id] += 1

    ready = sorted([node_id for node_id, degree in indegree.items() if degree == 0], key=lambda item: str(item))
    order: list[Any] = []
    while ready:
        node_id = ready.pop(0)
        order.append(node_id)
        for target_id in adjacency.get(node_id, []):
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                ready.append(target_id)
                ready.sort(key=lambda item: str(item))

    warnings: list[str] = []
    if len(order) != len(nodes_map):
        cyclic_ids = [node_id for node_id, degree in indegree.items() if degree > 0]
        warnings.append("静态检测：工作流连线存在环或无法拓扑排序的结构：" + "、".join(str(item) for item in cyclic_ids[:8]))
    return order, warnings


def _reachable_nodes(start_id: Any, nodes_map: dict[Any, dict[str, Any]]) -> set[Any]:
    seen: set[Any] = set()
    stack = [start_id]
    while stack:
        node_id = stack.pop()
        if node_id in seen:
            continue
        node = nodes_map.get(node_id)
        if not node:
            continue
        seen.add(node_id)
        stack.extend(_edge_targets(node))
    return seen


def validate_workflow_static(nodes: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    messages: list[str] = []
    if not nodes:
        return False, ["错误：没有节点数据。"]

    nodes_map = {node.get("id"): node for node in nodes}
    start = next((node for node in nodes if node.get("type") == "start"), None)
    if not start:
        return False, ["错误：未找到开始节点。"]

    reachable = _reachable_nodes(start.get("id"), nodes_map)
    unreachable = [node for node in nodes if node.get("id") not in reachable]
    if unreachable:
        labels = "、".join(_node_label(node) for node in unreachable[:5])
        messages.append(f"静态检测：存在未连入工作流的数据孤岛：{labels}")

    _, topo_warnings = topological_order([node for node in nodes if node.get("id") in reachable])
    messages.extend(topo_warnings)

    source_nodes = [node for node in nodes if node.get("type") in DATA_SOURCE_TYPES and node.get("id") in reachable]
    if not source_nodes:
        messages.append("静态检测：工作流没有动态数据源，必须至少包含 get_sensor_info 或 db_query。")

    env_nodes = [node for node in nodes if node.get("type") == "environment_model" and node.get("id") in reachable]
    if not env_nodes:
        messages.append("静态检测：缺少环境建模节点 environment_model，目标链路必须为 数据采集 → 建模 → 分析 → 输出 → 可视化。")

    output_nodes = [node for node in nodes if node.get("type") == "output" and node.get("id") in reachable]
    if not output_nodes:
        messages.append("静态检测：缺少 output 节点，大屏只能绑定 output 节点暴露的数据。")

    for node in nodes:
        if node.get("id") not in reachable:
            continue
        node_type = node.get("type")
        props = _props(node)
        if node_type in DATA_SOURCE_TYPES:
            if not props.get("targetVariableId"):
                messages.append(f"静态检测：数据源节点 {_node_label(node)} 未配置输出变量，后续节点无法通过连线获得数据。")
        elif node_type == "environment_model":
            if not props.get("inputVariableId"):
                messages.append(f"静态检测：{_node_label(node)} 缺少 inputVariableId，不能直接凭经验建模。")
            if not props.get("targetVariableId"):
                messages.append(f"静态检测：{_node_label(node)} 未配置输出变量，分析节点无法继续消费模型结果。")
        elif node_type in {"analytics_summary", "abstract_data_model", "advanced_prediction"}:
            if not props.get("inputVariableId"):
                messages.append(f"静态检测：{_node_label(node)} 缺少上游输入变量，禁止直接访问 API / 数据库。")
        elif node_type == "output" and not props.get("variableId"):
            messages.append(f"静态检测：输出节点 {_node_label(node)} 未绑定模型或分析结果变量。")

    if source_nodes and env_nodes:
        source_ids = {node.get("id") for node in source_nodes}
        reaches_env = False
        for source in source_nodes:
            downstream = _reachable_nodes(source.get("id"), nodes_map)
            if any(env.get("id") in downstream for env in env_nodes):
                reaches_env = True
                break
        if not reaches_env:
            messages.append("静态检测：数据获取节点未通过连线流向 environment_model。")

    if env_nodes and output_nodes:
        reaches_output = False
        for env in env_nodes:
            downstream = _reachable_nodes(env.get("id"), nodes_map)
            if any(output.get("id") in downstream for output in output_nodes):
                reaches_output = True
                break
        if not reaches_output:
            messages.append("静态检测：environment_model 未通过分析/输出链路流向 output 节点。")

    return not messages, messages


def detect_static_workflow(
    nodes: list[dict[str, Any]],
    previous_port_values: dict[str, Any] | None = None,
    current_port_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reasons: list[str] = []
    if not nodes:
        return {"isStatic": True, "reasons": ["工作流没有节点"], "topologicalOrder": [], "edges": []}

    nodes_map = {node.get("id"): node for node in nodes}
    edges = build_workflow_edges(nodes)
    order, topo_warnings = topological_order(nodes)
    if topo_warnings:
        reasons.extend(topo_warnings)

    source_nodes = [node for node in nodes if node.get("type") in DATA_SOURCE_TYPES]
    if not source_nodes:
        reasons.append("未检测到数据源节点")

    if not edges:
        reasons.append("节点未建立数据连接")

    data_written_variables = {
        str(_props(node).get("targetVariableId"))
        for node in source_nodes
        if _props(node).get("targetVariableId")
    }
    dynamic_variables = set(data_written_variables)
    changed = True
    while changed:
        changed = False
        for node in nodes:
            props = _props(node)
            input_id = props.get("inputVariableId")
            target_id = props.get("targetVariableId")
            if input_id and target_id and str(input_id) in dynamic_variables and str(target_id) not in dynamic_variables:
                dynamic_variables.add(str(target_id))
                changed = True

    output_nodes = [node for node in nodes if node.get("type") == "output"]
    if output_nodes:
        for output in output_nodes:
            variable_id = _props(output).get("variableId")
            if not variable_id or str(variable_id) not in dynamic_variables:
                reasons.append(f"输出节点 {_node_label(output)} 不依赖上游动态数据")
    else:
        reasons.append("未检测到输出节点")

    dynamic_input_nodes = [
        node for node in nodes
        if node.get("type") in DATA_CONSUMER_TYPES
        and (_props(node).get("inputVariableId") or _props(node).get("variableId"))
    ]
    if not dynamic_input_nodes and not source_nodes:
        reasons.append("所有节点输入均为固定值")

    if previous_port_values is not None and current_port_values is not None and previous_port_values == current_port_values:
        reasons.append("数据未发生变化，运行结果恒定")

    return {
        "isStatic": bool(reasons),
        "reasons": reasons,
        "topologicalOrder": order,
        "edges": edges,
        "nodeCount": len(nodes_map),
    }
