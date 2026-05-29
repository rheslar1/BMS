#!/bin/bash
echo "Installing BEMS..."
docker-compose -f docker/docker-compose.yml up --build
