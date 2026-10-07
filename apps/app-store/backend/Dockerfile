FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml /app/
RUN uv pip install --system -e .

COPY app /app/app

EXPOSE 8000
# No access log from the server. It writes the whole request line, query
# included, and one request of this API carries something that is nobody's to
# read in a log: the callback of a store sign-in, whose query is the sign-in
# code. The application logs each request's method and path itself
# (app/core/logging_middleware.py).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
