#pragma once

#include <chrono>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>

enum class LogLevel {
    Info,
    Warning,
    Error,
};

class Logger final {
public:
    static void info(const std::string &message) { write(LogLevel::Info, message); }
    static void warning(const std::string &message) { write(LogLevel::Warning, message); }
    static void error(const std::string &message) { write(LogLevel::Error, message); }

private:
    static const char *label(LogLevel level) {
        switch (level) {
        case LogLevel::Info:
            return "info";
        case LogLevel::Warning:
            return "warning";
        case LogLevel::Error:
            return "error";
        }
        return "unknown";
    }

    static std::string timestamp() {
        const auto now = std::chrono::system_clock::now();
        const auto seconds = std::chrono::system_clock::to_time_t(now);
        std::tm tm{};
#if defined(_WIN32)
        localtime_s(&tm, &seconds);
#else
        localtime_r(&seconds, &tm);
#endif
        std::ostringstream out;
        out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S");
        return out.str();
    }

    static void write(LogLevel level, const std::string &message) {
        static std::mutex logMutex;
        std::lock_guard<std::mutex> lock(logMutex);
        auto &stream = level == LogLevel::Error ? std::cerr : std::cout;
        stream << "[" << timestamp() << "]"
               << "[edge-core]"
               << "[" << label(level) << "] "
               << message << std::endl;
    }
};
