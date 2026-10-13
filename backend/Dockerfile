FROM python:3.12
WORKDIR /app
COPY server.py .
COPY requirements.txt .
RUN pip install -r requirements.txt
EXPOSE 8000
CMD ["python3","server.py"]
