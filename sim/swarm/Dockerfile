# The live sim bridge (sim/swarm/bridge.py): MAVLink from the PX4 swarm in, JSON for the console out.
FROM python:3.12-slim
RUN pip install --no-cache-dir pymavlink==2.4.50
WORKDIR /bridge
COPY plan.py bridge.py ./
EXPOSE 8765
ENTRYPOINT ["python3", "-u", "bridge.py", "--listen", "0.0.0.0:8765"]
