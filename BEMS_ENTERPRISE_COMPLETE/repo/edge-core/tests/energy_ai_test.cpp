#include "energy_ai.h"

#include <cassert>
#include <string>

void testForecastShape() {
    EnergyAI ai;
    assert(ai.initialize());

    const auto forecast = ai.forecastHourly(4);
    assert(forecast.size() == 4);
    assert(forecast[0].interval == "hour_1");
    assert(forecast[3].interval == "hour_4");
    assert(forecast[0].predictedKwh > 0.0);
    assert(forecast[0].estimatedCost > 0.0);
    assert(!forecast[0].recommendation.empty());

    const auto emptyForecast = ai.forecastHourly(0);
    assert(emptyForecast.empty());
}

void testOptimizationRecommendations() {
    EnergyAI ai;

    const auto warmZone = ai.optimizeSetpoint(22.0, 25.0);
    assert(warmZone.find("21.000000") != std::string::npos);

    const auto coldZone = ai.optimizeSetpoint(22.0, 19.0);
    assert(coldZone.find("23.000000") != std::string::npos);

    const auto comfortableZone = ai.optimizeSetpoint(22.0, 21.5);
    assert(comfortableZone.find("22.000000") != std::string::npos);
}

void testDailyUsage() {
    EnergyAI ai;
    assert(ai.predictedDailyUsage() > 300.0);
}

int main() {
    testForecastShape();
    testOptimizationRecommendations();
    testDailyUsage();
    return 0;
}

