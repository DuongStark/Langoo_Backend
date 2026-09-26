# API: Health

## GET /v1/health

Kiểm tra API hoạt động và kết nối được cơ sở dữ liệu (truy vấn `SELECT 1`).

- **Auth:** không cần.
- **Input:** không có.

### Ví dụ (bash / curl)

```bash
curl -s http://localhost:3000/v1/health
```

### Ví dụ (PowerShell)

```powershell
Invoke-RestMethod http://localhost:3000/v1/health
```

### Response 200 — bình thường

```json
{
  "status": "ok",
  "db": "ok",
  "db_latency_ms": 3,
  "uptime_s": 42,
  "time": "2026-09-26T12:00:00.000Z"
}
```

### Response 503 — không kết nối được DB

```json
{
  "code": "DB_UNAVAILABLE",
  "message": "Không kết nối được cơ sở dữ liệu"
}
```

Swagger UI: `http://localhost:3000/docs` (nhóm **health**).
