#include "energy_ai.h"
#include <cmath>

EnergyAI::EnergyAI() {}

bool EnergyAI::initialize() {
    // Placeholder for loading a real energy prediction model.
    return true;
}

std::vector<EnergyPrediction> EnergyAI::forecastHourly(int hours) const {
    std::vector<EnergyPrediction> results;
    double base = 12.5;
    for (int i = 1; i <= hours; ++i) {
        double multiplier = 1.0 + 0.05 * std::sin(i * 0.75);
        results.push_back({
            "hour_" + std::to_string(i),
            std::round((base * multiplier) * 10.0) / 10.0,
            std::round((base * multiplier * 0.14) * 100.0) / 100.0,
            (i % 2 == 0) ? "Maintain current schedule" : "Consider reducing cooling by 1°C"
        });
    }
    return results;
}

double EnergyAI::predictedDailyUsage() const {
    return 12.5 * 24.0 * 1.02;
}

std::string EnergyAI::optimizeSetpoint(double currentSetpoint, double indoorTemperature) const {
    double recommended = currentSetpoint;
    if (indoorTemperature > 24.0) {
        recommended = currentSetpoint - 1.0;
    } else if (indoorTemperature < 20.0) {
        recommended = currentSetpoint + 1.0;
    }
    return "Setpoint recommendation: " + std::to_string(recommended) + "°C";
}
