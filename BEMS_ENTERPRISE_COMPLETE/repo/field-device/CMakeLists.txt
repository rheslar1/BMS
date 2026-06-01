cmake_minimum_required(VERSION 3.16)
project(bems_field_device LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(bems_field_device
  src/field_device_firmware.cpp
  src/simulated_drivers.cpp
)
target_include_directories(bems_field_device PUBLIC include src)

add_executable(bems_field_device_firmware src/main.cpp)
target_link_libraries(bems_field_device_firmware PRIVATE bems_field_device)

enable_testing()
add_executable(field_device_simulator_test tests/field_device_simulator_test.cpp)
target_link_libraries(field_device_simulator_test PRIVATE bems_field_device)
add_test(NAME field_device_simulator_test COMMAND field_device_simulator_test)
