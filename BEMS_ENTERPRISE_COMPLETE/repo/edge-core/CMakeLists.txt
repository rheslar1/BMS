cmake_minimum_required(VERSION 3.16)
project(edge_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(edge-core
  src/main.cpp
  src/bacnet_client.cpp
  src/device_manager.cpp
  src/discovery_service.cpp
  src/edge_runtime.cpp
  src/energy_ai.cpp
  src/bacnet_interface.cpp
  src/bacnet_object_database.cpp
  src/modbus_rtu_interface.cpp
  src/canbus_interface.cpp
  src/fieldbus_gateway.cpp
  src/writeback_controller.cpp
  src/hvac_control.cpp
)

target_include_directories(edge-core PRIVATE
  src
)

target_link_libraries(edge-core PRIVATE
  Threads::Threads
)

enable_testing()

add_executable(edge-core-tests
  tests/writeback_controller_test.cpp
  src/writeback_controller.cpp
)

target_include_directories(edge-core-tests PRIVATE src)

add_test(NAME edge-core-tests COMMAND edge-core-tests)

add_executable(edge-core-bacnet-simulator-tests
  tests/bacnet_simulator_test.cpp
  src/bacnet_interface.cpp
  src/bacnet_object_database.cpp
)

target_include_directories(edge-core-bacnet-simulator-tests PRIVATE src)

add_test(NAME edge-core-bacnet-simulator-tests COMMAND edge-core-bacnet-simulator-tests)

add_executable(edge-core-bacnet-object-database-tests
  tests/bacnet_object_database_test.cpp
  src/bacnet_object_database.cpp
  src/bacnet_interface.cpp
)

target_include_directories(edge-core-bacnet-object-database-tests PRIVATE src)

add_test(NAME edge-core-bacnet-object-database-tests COMMAND edge-core-bacnet-object-database-tests)

add_executable(edge-core-fieldbus-tests
  tests/fieldbus_interface_test.cpp
  src/modbus_rtu_interface.cpp
  src/canbus_interface.cpp
  src/fieldbus_gateway.cpp
)

target_include_directories(edge-core-fieldbus-tests PRIVATE src)

add_test(NAME edge-core-fieldbus-tests COMMAND edge-core-fieldbus-tests)

add_executable(edge-core-energy-ai-tests
  tests/energy_ai_test.cpp
  src/energy_ai.cpp
)

target_include_directories(edge-core-energy-ai-tests PRIVATE src)

add_test(NAME edge-core-energy-ai-tests COMMAND edge-core-energy-ai-tests)

add_executable(edge-core-discovery-tests
  tests/discovery_service_test.cpp
  src/discovery_service.cpp
)

target_include_directories(edge-core-discovery-tests PRIVATE src)

add_test(NAME edge-core-discovery-tests COMMAND edge-core-discovery-tests)

add_executable(edge-core-hvac-control-tests
  tests/hvac_control_test.cpp
  src/hvac_control.cpp
)

target_include_directories(edge-core-hvac-control-tests PRIVATE src)

add_test(NAME edge-core-hvac-control-tests COMMAND edge-core-hvac-control-tests)
