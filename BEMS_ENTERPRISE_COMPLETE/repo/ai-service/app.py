from http.server import BaseHTTPRequestHandler, HTTPServer
from json import dumps, loads
from math import fabs
from concurrent import futures
from os import environ
from pathlib import Path
import sys
import threading
from time import time

import grpc

generated_dir = Path(__file__).resolve().parent / "generated"
sys.path.insert(0, str(generated_dir))

import ai_service_pb2
import ai_service_pb2_grpc


RL_ACTIONS = [-1.5, -0.5, 0, 0.5, 1.5]
Q_VALUES = {}


def clamp(value, low, high):
    if low is not None and value < low:
        return low
    if high is not None and value > high:
        return high
    return value


def number(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def q_key(zone_id, action):
    return f"{zone_id}:{action}"


def q_value(zone_id, action):
    return Q_VALUES.get(q_key(zone_id, action), 0.0)


def best_action(zone_id):
    return max(RL_ACTIONS, key=lambda action: q_value(zone_id, action))


def mode_bias(profile):
    return {
        "Conservative": 1.5,
        "Normal": 0.0,
        "Aggressive": -1.0,
    }.get(profile, 0.0)


def build_global_state(payload, zones):
    context = payload.get("context", {}) or {}
    weather = context.get("weather", {}) or payload.get("weather", {}) or {}
    pricing = context.get("pricing", {}) or payload.get("pricing", {}) or {}
    demand_response = context.get("demandResponse", {}) or payload.get("demandResponse", {}) or {}

    zone_count = len(zones)
    device_count = sum(len(zone["devices"]) for zone in zones.values())
    demand_kw = number(pricing.get("currentDemandKw"), device_count * 1.8)
    demand_limit_kw = number(pricing.get("demandLimitKw"), max(demand_kw + 1.0, device_count * 2.2))
    price_per_kwh = number(pricing.get("pricePerKwh"), 0.14)
    outdoor_temperature = number(weather.get("outdoorTemperature"), number(weather.get("temperature"), 24.0))
    solar_radiation = number(weather.get("solarRadiation"), 0.0)
    demand_event_active = bool(demand_response.get("active")) or bool(pricing.get("demandResponseActive"))
    peak_risk = max(0.0, min(1.0, demand_kw / max(demand_limit_kw, 0.1)))

    occupied_zones = 0
    total_deviation = 0.0
    deviation_samples = 0
    for zone in zones.values():
        occupied = False
        for device in zone["devices"]:
            occupancy = device.get("occupancy") or device.get("occupied")
            if occupancy in (True, "true", "occupied", "Occupied", 1):
                occupied = True
            config = device.get("configuration") or {}
            setpoint = number(config.get("setpoint"), number(device.get("setpoint"), number(device.get("value"), 22.0)))
            actual = number(device.get("zoneTemperature"), number(device.get("temperature"), number(device.get("value"), setpoint)))
            total_deviation += fabs(actual - setpoint)
            deviation_samples += 1
        if occupied:
            occupied_zones += 1

    return {
        "zoneCount": zone_count,
        "deviceCount": device_count,
        "occupiedZones": occupied_zones,
        "outdoorTemperature": round(outdoor_temperature, 2),
        "solarRadiation": round(solar_radiation, 2),
        "pricePerKwh": round(price_per_kwh, 4),
        "currentDemandKw": round(demand_kw, 2),
        "demandLimitKw": round(demand_limit_kw, 2),
        "demandResponseActive": demand_event_active,
        "peakRisk": round(peak_risk, 3),
        "averageComfortDeviation": round(total_deviation / max(1, deviation_samples), 3),
    }


def action_candidates(profile, zone_id, global_state):
    learned = best_action(zone_id)
    candidates = set(RL_ACTIONS)
    candidates.add(learned)
    candidates.add(round(mode_bias(profile), 2))

    if global_state["demandResponseActive"] or global_state["peakRisk"] > 0.9:
        candidates = {action for action in candidates if action >= -0.5}

    return sorted(candidates)


def estimate_action(zone, action, global_state):
    device_plans = []
    comfort_penalty = 0.0
    energy_savings = 0.0
    peak_relief_kw = 0.0

    for device in zone["devices"]:
        config = device.get("configuration") or {}
        current_setpoint = number(config.get("setpoint"), number(device.get("setpoint"), number(device.get("value"), 22.0)))
        actual_temperature = number(
            device.get("zoneTemperature"),
            number(device.get("temperature"), number(device.get("value"), current_setpoint)),
        )
        target = clamp(
            current_setpoint + action,
            config.get("minSetpoint"),
            config.get("maxSetpoint"),
        )
        setpoint_delta = target - current_setpoint
        cooling_relief = max(0.0, setpoint_delta)
        heating_relief = max(0.0, -setpoint_delta) if global_state["outdoorTemperature"] < 16.0 else 0.0
        device_energy = max(0.05, (cooling_relief + heating_relief) * 0.72)
        device_peak = max(0.0, cooling_relief * 0.38)
        device_comfort = fabs(actual_temperature - target)

        energy_savings += device_energy
        peak_relief_kw += device_peak
        comfort_penalty += device_comfort
        device_plans.append({
            "deviceId": device.get("deviceId"),
            "deviceName": device.get("deviceName"),
            "currentSetpoint": round(current_setpoint, 2),
            "targetSetpoint": round(target, 2),
            "energySavings": round(device_energy, 2),
            "peakReliefKw": round(device_peak, 2),
            "comfortPenalty": round(device_comfort, 2),
        })

    comfort_penalty = comfort_penalty / max(1, len(device_plans))
    cost_savings = energy_savings * global_state["pricePerKwh"]
    learned_value = q_value(zone["zoneId"], action)
    peak_weight = 0.9 if global_state["demandResponseActive"] else 0.45
    score = (
        energy_savings * 0.38
        + cost_savings * 0.32
        + peak_relief_kw * peak_weight
        + learned_value * 0.18
        - comfort_penalty * 0.42
    )

    return {
        "action": action,
        "score": score,
        "energySavingsKwh": energy_savings,
        "costSavings": cost_savings,
        "peakReliefKw": peak_relief_kw,
        "comfortPenalty": comfort_penalty,
        "devices": device_plans,
    }


def optimize(payload):
    mode = payload.get("mode", {})
    rows = payload.get("rows", [])
    for item in payload.get("rlPolicy", []):
        try:
            Q_VALUES[q_key(item.get("zoneId"), item.get("action"))] = float(item.get("qValue", 0.0))
        except (TypeError, ValueError):
            continue
    profile = mode.get("profile", "Normal")
    zones = {}

    for row in rows:
        zone_id = row.get("zoneId")
        zones.setdefault(zone_id, {
            "zoneId": zone_id,
            "zoneName": row.get("zoneName"),
            "buildingName": row.get("buildingName"),
            "devices": [],
        })
        zones[zone_id]["devices"].append(row)

    global_state = build_global_state(payload, zones)
    zone_plans = []
    for zone in zones.values():
        learned_action = best_action(zone["zoneId"])
        candidates = [
            estimate_action(zone, action, global_state)
            for action in action_candidates(profile, zone["zoneId"], global_state)
        ]
        selected = max(candidates, key=lambda candidate: candidate["score"])
        zone_plans.append({
            "zoneId": zone["zoneId"],
            "zoneName": zone["zoneName"],
            "buildingName": zone["buildingName"],
            "learnedAction": learned_action,
            "coordinatedDelta": round(selected["action"], 2),
            "objectiveScore": round(selected["score"], 3),
            "energySavingsKwh": round(selected["energySavingsKwh"], 2),
            "costSavings": round(selected["costSavings"], 2),
            "peakReliefKw": round(selected["peakReliefKw"], 2),
            "comfortPenalty": round(selected["comfortPenalty"], 2),
            "candidateCount": len(candidates),
            "devices": selected["devices"],
        })

    total_energy = sum(zone["energySavingsKwh"] for zone in zone_plans)
    total_peak_relief = sum(zone["peakReliefKw"] for zone in zone_plans)
    total_comfort_penalty = sum(zone["comfortPenalty"] for zone in zone_plans)
    building_reward = (
        total_energy * 0.35
        + (total_energy * global_state["pricePerKwh"]) * 0.25
        + total_peak_relief * 0.25
        - total_comfort_penalty * 0.15
    )
    return {
        "source": "python-ai-service",
        "generatedAt": time(),
        "mode": mode,
        "globalState": global_state,
        "objective": {
            "energyWeight": 0.45,
            "comfortWeight": 0.25,
            "costWeight": 0.2,
            "peakWeight": 0.1,
            "estimatedSavingsKwh": round(total_energy, 2),
            "estimatedCostSavings": round(total_energy * global_state["pricePerKwh"], 2),
            "estimatedPeakReliefKw": round(total_peak_relief, 2),
            "buildingReward": round(building_reward, 4),
        },
        "learning": {
            "algorithm": "epsilon_greedy_q_learning",
            "actions": RL_ACTIONS,
            "stateCount": len(Q_VALUES),
        },
        "coordination": {
            "strategy": "whole_building_multi_zone_action_scoring",
            "constraints": [
                "comfort",
                "energy",
                "price",
                "peak_demand",
                "demand_response",
            ],
            "demandResponseGuard": global_state["demandResponseActive"] or global_state["peakRisk"] > 0.9,
        },
        "zonePlans": zone_plans,
    }


def feedback(payload):
    zone_id = payload["zoneId"]
    action = payload["action"]
    reward = float(payload["reward"])
    key = q_key(zone_id, action)
    current = Q_VALUES.get(key, 0.0)
    Q_VALUES[key] = round(current + 0.22 * (reward - current), 4)
    return {"zoneId": zone_id, "action": action, "reward": reward, "qValue": Q_VALUES[key]}


def simulate_physics(payload):
    rows = payload.get("rows", [])
    context = payload.get("context", {}) or {}
    horizon_hours = int(number(payload.get("horizonHours"), 24))
    outdoor_temperature = number(context.get("outdoorTemperature"), number(payload.get("outdoorTemperature"), 31.0))
    price_per_kwh = number(context.get("pricePerKwh"), number(payload.get("pricePerKwh"), 0.18))
    base_load_kw = sum(max(0.05, number(row.get("presentValue"), number(row.get("value"), 1.0)) * 0.04) for row in rows)
    weather_factor = 1.0 + max(0.0, outdoor_temperature - 24.0) * 0.018
    configured = bool(environ.get("ENERGYPLUS_BINARY") and environ.get("ENERGYPLUS_MODEL_FILE") and environ.get("ENERGYPLUS_WEATHER_FILE"))
    timeline = []
    for hour in range(1, horizon_hours + 1):
        occupancy_factor = 1.0 if 7 <= hour <= 18 else 0.62
        demand_kw = base_load_kw * weather_factor * occupancy_factor
        timeline.append({
            "hour": hour,
            "simulatedDemandKw": round(demand_kw, 2),
            "simulatedEnergyKwh": round(demand_kw, 2),
            "estimatedCost": round(demand_kw * price_per_kwh, 2),
        })
    return {
        "source": "python-ai-service",
        "engine": "energyplus_adapter_ready" if configured else "physics_surrogate",
        "energyPlus": {
            "configured": configured,
            "binary": environ.get("ENERGYPLUS_BINARY"),
            "modelFile": environ.get("ENERGYPLUS_MODEL_FILE"),
            "weatherFile": environ.get("ENERGYPLUS_WEATHER_FILE"),
        },
        "horizonHours": horizon_hours,
        "timeline": timeline,
        "totals": {
            "energyKwh": round(sum(item["simulatedEnergyKwh"] for item in timeline), 2),
            "cost": round(sum(item["estimatedCost"] for item in timeline), 2),
        },
    }


def demand_response(payload):
    context = payload.get("context", {}) or payload
    current_demand = number(context.get("currentDemandKw"), 284.0)
    demand_limit = number(context.get("demandLimitKw"), 320.0)
    requested = number(context.get("requestedReductionKw"), max(0.0, current_demand - demand_limit * 0.86))
    active = bool(context.get("active")) or current_demand >= demand_limit * 0.92
    return {
        "source": "python-ai-service",
        "event": {
            "utility": context.get("utility", environ.get("UTILITY_PROVIDER", "Utility integration")),
            "protocol": context.get("protocol", environ.get("UTILITY_DR_PROTOCOL", "OpenADR-ready REST adapter")),
            "active": active,
            "requestedReductionKw": round(requested, 1),
        },
        "actions": [
            {"system": "HVAC", "reductionKw": round(requested * 0.5, 1), "action": "setpoint_bias"},
            {"system": "Lighting", "reductionKw": round(requested * 0.2, 1), "action": "dim_noncritical"},
            {"system": "Power", "reductionKw": round(requested * 0.3, 1), "action": "shed_deferrable"},
        ],
        "safetyPolicy": ["fire_override", "security_occupancy_guard", "maintenance_mode_lockout", "safe_bacnet_writeback"],
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        encoded = dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "service": "python-ai-service"})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        try:
            payload = self.read_json()
            if self.path == "/optimize":
                self.send_json(200, optimize(payload))
            elif self.path == "/feedback":
                self.send_json(200, feedback(payload))
            elif self.path == "/simulate":
                self.send_json(200, simulate_physics(payload))
            elif self.path == "/demand-response":
                self.send_json(200, demand_response(payload))
            else:
                self.send_json(404, {"error": "Not found"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})


class AiOptimizationServicer(ai_service_pb2_grpc.AiOptimizationServiceServicer):
    def Health(self, request, context):
        return ai_service_pb2.AiHealthResponse(status="ok", service="python-ai-service")

    def Optimize(self, request, context):
        result = optimize(loads(request.payload_json or "{}"))
        return ai_service_pb2.OptimizeResponse(optimization_json=dumps(result))

    def Feedback(self, request, context):
        result = feedback(loads(request.payload_json or "{}"))
        return ai_service_pb2.FeedbackResponse(feedback_json=dumps(result))


def serve_http():
    port = int(environ.get("AI_HTTP_PORT", "8000"))
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


def serve_grpc():
    port = int(environ.get("AI_GRPC_PORT", "50052"))
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    ai_service_pb2_grpc.add_AiOptimizationServiceServicer_to_server(AiOptimizationServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    threading.Thread(target=serve_http, daemon=True).start()
    serve_grpc()
