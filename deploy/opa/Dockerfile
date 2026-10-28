FROM openpolicyagent/opa:0.70.0
COPY policies /policies
CMD ["run", "--server", "--addr=0.0.0.0:8181", "--log-format=json", "/policies"]
