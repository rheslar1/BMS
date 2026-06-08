cmake_minimum_required(VERSION 3.16)
project(edge_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

option(BEMS_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer for edge-core targets" OFF)
option(BEMS_ENABLE_THREAD_SANITIZER "Enable ThreadSanitizer for edge-core targets" OFF)
option(BEMS_ENABLE_STATIC_ANALYSIS "Enable clang-tidy static analysis for edge-core targets when available" OFF)
option(BEMS_WARNINGS_AS_ERRORS "Treat edge-core compiler warnings as errors" OFF)

find_package(Threads REQUIRED)

if(BEMS_ENABLE_STATIC_ANALYSIS)
  find_program(CLANG_TIDY_EXE NAMES clang-tidy)
  if(CLANG_TIDY_EXE)
    set(CMAKE_CXX_CLANG_TIDY "${CLANG_TIDY_EXE};--checks=bugprone-*,performance-*,readability-*,modernize-*")
  else()
    message(WARNING "BEMS_ENABLE_STATIC_ANALYSIS is ON, but clang-tidy was not found")
  endif()
endif()

function(configure_bems_cpp_target target_name)
  target_compile_features(${target_name} PRIVATE cxx_std_17)
  target_compile_options(${target_name} PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow -Wdouble-promotion -Wformat=2 -Wnull-dereference -Wold-style-cast -Woverloaded-virtual -Wpessimizing-move -Wredundant-move>
    $<$<CXX_COMPILER_ID:MSVC>:/W4 /permissive->
  )
  if(BEMS_WARNINGS_AS_ERRORS)
    target_compile_options(${target_name} PRIVATE
      $<$<CXX_COMPILER_ID:GNU,Clang>:-Werror>
      $<$<CXX_COMPILER_ID:MSVC>:/WX>
    )
  endif()
  if(BEMS_ENABLE_SANITIZERS AND BEMS_ENABLE_THREAD_SANITIZER)
    message(FATAL_ERROR "BEMS_ENABLE_SANITIZERS and BEMS_ENABLE_THREAD_SANITIZER are mutually exclusive")
  endif()
  if(BEMS_ENABLE_SANITIZERS AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(${target_name} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(${target_name} PRIVATE -fsanitize=address,undefined)
  endif()
  if(BEMS_ENABLE_THREAD_SANITIZER AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(${target_name} PRIVATE -fsanitize=thread -fno-omit-frame-pointer)
    target_link_options(${target_name} PRIVATE -fsanitize=thread)
  endif()
endfunction()

set(EDGE_CORE_SERVICE_SOURCES
  src/bacnet_client.cpp
  src/bacnet_interface.cpp
  src/bacnet_object_database.cpp
  src/device_manager.cpp
  src/discovery_service.cpp
  src/edge_service.cpp
  src/edge_runtime.cpp
  src/energy_ai.cpp
  src/writeback_controller.cpp
)

add_library(edge-core-service-shared SHARED
  ${EDGE_CORE_SERVICE_SOURCES}
)

target_include_directories(edge-core-service-shared PUBLIC src)
target_link_libraries(edge-core-service-shared PRIVATE Threads::Threads)
target_compile_definitions(edge-core-service-shared PRIVATE BEMS_EDGE_CORE_BUILD)
set_target_properties(edge-core-service-shared PROPERTIES OUTPUT_NAME edge-core-service)
configure_bems_cpp_target(edge-core-service-shared)

add_executable(edge-core
  src/main.cpp
  src/bacnet_client.cpp
  src/device_manager.cpp
  src/discovery_service.cpp
  src/edge_service.cpp
  src/edge_runtime.cpp
  src/energy_ai.cpp
  src/bacnet_interface.cpp
  src/bacnet_object_database.cpp
  src/modbus_rtu_interface.cpp
  src/serial_port.cpp
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
configure_bems_cpp_target(edge-core)

enable_testing()

add_executable(edge-core-tests
  tests/writeback_controller_test.cpp
  src/writeback_controller.cpp
)

target_include_directories(edge-core-tests PRIVATE src)
configure_bems_cpp_target(edge-core-tests)

add_test(NAME edge-core-tests COMMAND edge-core-tests)

add_executable(edge-core-bacnet-simulator-tests
  tests/bacnet_simulator_test.cpp
  src/bacnet_interface.cpp
  src/bacnet_object_database.cpp
)

target_include_directories(edge-core-bacnet-simulator-tests PRIVATE src)
configure_bems_cpp_target(edge-core-bacnet-simulator-tests)

add_test(NAME edge-core-bacnet-simulator-tests COMMAND edge-core-bacnet-simulator-tests)

add_executable(edge-core-bacnet-object-database-tests
  tests/bacnet_object_database_test.cpp
  src/bacnet_object_database.cpp
  src/bacnet_interface.cpp
)

target_include_directories(edge-core-bacnet-object-database-tests PRIVATE src)
configure_bems_cpp_target(edge-core-bacnet-object-database-tests)

add_test(NAME edge-core-bacnet-object-database-tests COMMAND edge-core-bacnet-object-database-tests)

add_executable(edge-core-fieldbus-tests
  tests/fieldbus_interface_test.cpp
  src/modbus_rtu_interface.cpp
  src/canbus_interface.cpp
  src/fieldbus_gateway.cpp
)

target_include_directories(edge-core-fieldbus-tests PRIVATE src)
configure_bems_cpp_target(edge-core-fieldbus-tests)

add_test(NAME edge-core-fieldbus-tests COMMAND edge-core-fieldbus-tests)

add_executable(edge-core-energy-ai-tests
  tests/energy_ai_test.cpp
  src/energy_ai.cpp
)

target_include_directories(edge-core-energy-ai-tests PRIVATE src)
configure_bems_cpp_target(edge-core-energy-ai-tests)

add_test(NAME edge-core-energy-ai-tests COMMAND edge-core-energy-ai-tests)

add_executable(edge-core-discovery-tests
  tests/discovery_service_test.cpp
  src/discovery_service.cpp
)

target_include_directories(edge-core-discovery-tests PRIVATE src)
configure_bems_cpp_target(edge-core-discovery-tests)

add_test(NAME edge-core-discovery-tests COMMAND edge-core-discovery-tests)

add_executable(edge-core-hvac-control-tests
  tests/hvac_control_test.cpp
  src/hvac_control.cpp
)

target_include_directories(edge-core-hvac-control-tests PRIVATE src)
configure_bems_cpp_target(edge-core-hvac-control-tests)

add_test(NAME edge-core-hvac-control-tests COMMAND edge-core-hvac-control-tests)

add_executable(edge-core-unique-fd-tests
  tests/unique_fd_test.cpp
)

target_include_directories(edge-core-unique-fd-tests PRIVATE src)
configure_bems_cpp_target(edge-core-unique-fd-tests)

add_test(NAME edge-core-unique-fd-tests COMMAND edge-core-unique-fd-tests)

add_executable(edge-core-serial-port-tests
  tests/serial_port_test.cpp
  src/serial_port.cpp
)

target_include_directories(edge-core-serial-port-tests PRIVATE src)
configure_bems_cpp_target(edge-core-serial-port-tests)

add_test(NAME edge-core-serial-port-tests COMMAND edge-core-serial-port-tests)

add_executable(edge-core-service-tests
  tests/edge_service_test.cpp
  ${EDGE_CORE_SERVICE_SOURCES}
)

target_include_directories(edge-core-service-tests PRIVATE src)
target_link_libraries(edge-core-service-tests PRIVATE Threads::Threads)
configure_bems_cpp_target(edge-core-service-tests)

add_test(NAME edge-core-service-tests COMMAND edge-core-service-tests)

add_executable(edge-core-bounded-queue-tests
  tests/bounded_queue_test.cpp
)

target_include_directories(edge-core-bounded-queue-tests PRIVATE src)
target_link_libraries(edge-core-bounded-queue-tests PRIVATE Threads::Threads)
configure_bems_cpp_target(edge-core-bounded-queue-tests)

add_test(NAME edge-core-bounded-queue-tests COMMAND edge-core-bounded-queue-tests)
