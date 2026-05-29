cmake_minimum_required(VERSION 3.16)
project(edge_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(edge-core
  src/main.cpp
  src/bacnet_client.cpp
  src/device_manager.cpp
  src/discovery_service.cpp
  src/edge_runtime.cpp
  src/energy_ai.cpp
  src/bacnet_interface.cpp
  src/writeback_controller.cpp
)

target_include_directories(edge-core PRIVATE src)
