#pragma once

#include <string>
#include <vector>

struct EnergyPrediction {
    std::string interval;
    double predictedKwh;
    double estimatedCost;
    std::string recommendation;
};

class EnergyAI {
public:
    EnergyAI();
    bool initialize();
    std::vector<EnergyPrediction> forecastHourly(int hours) const;
    double predictedDailyUsage() const;
    std::string optimizeSetpoint(double currentSetpoint, double indoorTemperature) const;
};
