import unittest

import app


class AiServiceTests(unittest.TestCase):
    def setUp(self):
        app.Q_VALUES.clear()

    def test_feedback_updates_q_value(self):
        result = app.feedback({"zoneId": 1, "action": 0.5, "reward": 1.0})

        self.assertEqual(result["zoneId"], 1)
        self.assertEqual(result["action"], 0.5)
        self.assertAlmostEqual(result["qValue"], 0.22)

    def test_optimize_hydrates_persisted_policy(self):
        result = app.optimize({
            "mode": {"profile": "Normal"},
            "rlPolicy": [{"zoneId": 7, "action": 1.5, "qValue": 3.0}],
            "rows": [{
                "zoneId": 7,
                "zoneName": "Lab",
                "buildingName": "Research",
                "deviceId": 42,
                "deviceName": "Lab VAV",
                "value": 50.0,
                "configuration": {
                    "setpoint": 50.0,
                    "minSetpoint": 35.0,
                    "maxSetpoint": 80.0,
                },
            }],
        })

        self.assertEqual(result["zonePlans"][0]["learnedAction"], 1.5)
        self.assertEqual(result["learning"]["stateCount"], 1)
        self.assertGreater(result["objective"]["estimatedSavingsKwh"], 0)
        self.assertEqual(result["coordination"]["strategy"], "whole_building_multi_zone_action_scoring")
        self.assertIn("globalState", result)

    def test_whole_building_optimizer_coordinates_multiple_zones(self):
        result = app.optimize({
            "mode": {"profile": "Aggressive"},
            "context": {
                "weather": {"outdoorTemperature": 31.0, "solarRadiation": 620},
                "pricing": {"pricePerKwh": 0.31, "currentDemandKw": 88, "demandLimitKw": 100},
            },
            "rows": [
                {
                    "zoneId": 1,
                    "zoneName": "North Office",
                    "buildingName": "Tower",
                    "deviceId": 101,
                    "deviceName": "North VAV",
                    "zoneTemperature": 23.5,
                    "occupancy": "occupied",
                    "configuration": {"setpoint": 22.0, "minSetpoint": 20.0, "maxSetpoint": 26.0},
                },
                {
                    "zoneId": 2,
                    "zoneName": "South Office",
                    "buildingName": "Tower",
                    "deviceId": 102,
                    "deviceName": "South VAV",
                    "zoneTemperature": 24.0,
                    "occupancy": "occupied",
                    "configuration": {"setpoint": 22.0, "minSetpoint": 20.0, "maxSetpoint": 26.0},
                },
            ],
        })

        self.assertEqual(result["globalState"]["zoneCount"], 2)
        self.assertEqual(result["globalState"]["occupiedZones"], 2)
        self.assertEqual(len(result["zonePlans"]), 2)
        self.assertGreaterEqual(result["objective"]["buildingReward"], -10)
        self.assertIn("peak_demand", result["coordination"]["constraints"])

    def test_demand_response_guard_blocks_deep_cooling_actions(self):
        result = app.optimize({
            "mode": {"profile": "Aggressive"},
            "context": {
                "pricing": {"currentDemandKw": 99, "demandLimitKw": 100, "demandResponseActive": True},
                "weather": {"outdoorTemperature": 34.0},
            },
            "rlPolicy": [{"zoneId": 7, "action": -1.5, "qValue": 10.0}],
            "rows": [{
                "zoneId": 7,
                "zoneName": "Critical Lab",
                "buildingName": "Research",
                "deviceId": 42,
                "deviceName": "Lab VAV",
                "zoneTemperature": 23.0,
                "configuration": {
                    "setpoint": 22.0,
                    "minSetpoint": 18.0,
                    "maxSetpoint": 26.0,
                },
            }],
        })

        self.assertTrue(result["coordination"]["demandResponseGuard"])
        self.assertGreaterEqual(result["zonePlans"][0]["coordinatedDelta"], -0.5)
        self.assertGreaterEqual(result["objective"]["estimatedPeakReliefKw"], 0)


if __name__ == "__main__":
    unittest.main()
