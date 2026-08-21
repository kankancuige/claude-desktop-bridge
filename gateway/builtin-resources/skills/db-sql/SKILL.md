---
name: db-sql
description: Use when writing or tuning database access code — SQL queries, query optimization, indexing, ORM operations, schema changes, migrations, connection management. Triggers on keywords: SQL, SqlSugar, MyBatis, MyBatis-Plus, database, table, query, select, insert, update, delete, transaction, connection string, DbContext, repository, MySQL, SQL Server, SqlServer, SQLite, ADO.NET, pagination, tuning, optimize, slow query, index, EXPLAIN, execution plan, 数据库, 分页, 调优, 优化, 索引, 慢查询.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are a database access specialist. Every database operation must be production-grade.

## 0. Stack → Database Mapping (default conventions)
| Layer | ORM | Default DBMS |
|-------|-----|--------------|
| **C# (WinForms / Avalonia)** | SqlSugar (or raw ADO.NET in legacy) | **SQL Server** |
| **Java (Spring Boot)** | MyBatis-Plus (芋道) / MyBatis (JeeSite) | **MySQL** |
| **uni-app (standalone Android)** | `plus.sqlite` (HTML5+ native) | **SQLite** (on-device offline DB — see `uniapp-android` skill) |
| C# WinForms logs | Serilog | SQLite (small, logs only) |

Before writing RAW SQL, confirm the actual DBMS from the project config. SqlSugar: set `DbType.SqlServer` (C#) — MyBatis-Plus auto-detects from the JDBC URL.

## Mandatory Rules

### 1. Connection Strings
- C#: read from `app.config` — never hard-code. SqlSugar `ConnectionConfig` with `DbType.SqlServer`.
- Java: read from `application.yml` — never hard-code.
- Connection pool: enable pooling, set MinPoolSize/MaxPoolSize (C#) / Druid·Hikari pool size (Java) explicitly.

### 2. Query Rules
- NEVER `SELECT *` — list columns explicitly.
- Every query MUST have a WHERE or explicit row limit — never return unbounded result sets.
- Pagination (per stack):
  - SqlSugar (C#): `.ToPageList(pageIndex, pageSize)`.
  - MyBatis-Plus (芋道): `IPage<T>` + `selectPage(page, wrapper)` / `BaseMapperX`.
  - Classic MyBatis (JeeSite): `PageHelper` / `Page<T>`.
- Parameterized queries ALWAYS — never string-concatenate user input.

### 3. Cross-Dialect Raw SQL — SQL Server (C#) vs MySQL (Java)
The ORM abstracts most differences, but RAW SQL does NOT. Confirm the target DBMS first; never apply one dialect's syntax to the other.
| Concern | MySQL (Java default) | SQL Server (C# default) |
|---------|----------------------|--------------------------|
| Pagination | `LIMIT offset, count` | `OFFSET n ROWS FETCH NEXT m ROWS ONLY` (2012+) / `TOP` |
| Identifier quote | `` `col` `` | `[col]` |
| Top-N | `LIMIT n` | `TOP n` |
| Auto key / last id | `AUTO_INCREMENT` / `LAST_INSERT_ID()` | `IDENTITY` / `SCOPE_IDENTITY()` |
| String concat | `CONCAT(a, b)` | `a + b` or `CONCAT(a, b)` |
| Current time | `NOW()` | `GETDATE()` |
| Null fallback | `IFNULL(x, y)` | `ISNULL(x, y)` |
| Bulk insert | batch `INSERT` / `MySqlBulkLoader` | `SqlBulkCopy` |
| Deadlock error code | 1213 | 1205 |

### 4. Transaction Rules
- Multi-table writes MUST be in a transaction. Scope as narrow as possible — never hold a transaction across an HTTP call or user wait.
- C# (SqlSugar):
  ```csharp
  // SIDE_EFFECT: writes to DB within transaction
  db.Ado.BeginTran();
  try { /* ... */ db.Ado.CommitTran(); }
  catch { db.Ado.RollbackTran(); throw; }
  ```
- Java: `@Transactional(rollbackFor = Exception.class)`.

### 5. Performance Rules
- No N+1: `.Includes()` (SqlSugar) / `<association>` (MyBatis) for eager loading.
- Batch inserts: `.InsertRange()` (SqlSugar) / `saveBatch` (MyBatis-Plus) / `SqlBulkCopy` (raw SQL Server) — never loop single inserts.
- Large tables: ensure indexed columns appear in WHERE / JOIN clauses.

### 6. Error Handling
- SqlSugar: catch `SqlSugarException`, log with full stack trace.
- Connection failures: throw an explicit exception with server IP + error code.
- Deadlock retry: high-contention writes retry up to 3× with 100ms delay (SQL Server error 1205 / MySQL 1213).

### 7. Legacy / Raw ADO.NET (no ORM)
- Some older C# projects use raw ADO.NET (no SqlSugar) on SQL Server — MATCH that, don't force SqlSugar (see CLAUDE.md "Existing / Legacy Project Override").
- Still parameterize via `SqlParameter` (never string-concat user input), wrap `SqlConnection`/`SqlCommand` in `using`, set `CommandTimeout`.

### 8. SQL Tuning (query optimization)
For slow queries or large/time-series tables (e.g. tightening `result` records), apply BEFORE shipping:
- **Sargable WHERE** — keep indexed columns "bare": NO function/calc on the column (`WHERE DATE(ts)=...` ✗ → range on `ts` ✓), NO implicit type conversion (don't compare a varchar column to a number), NO leading-wildcard `LIKE '%x'` (index unusable).
- **Composite index leftmost-prefix** — a `(a,b,c)` index serves `WHERE a=`, `a= AND b=`, but NOT `WHERE b=` alone. Order columns: equality / high-selectivity first, range column last.
- **Covering index** — select only the columns you need; if the index covers them, the engine skips the table lookup. (Another reason `SELECT *` is banned.)
- **Deep pagination** — `LIMIT 1000000, 20` scans a million rows. Use keyset/seek pagination: `WHERE id > :lastId ORDER BY id LIMIT 20` (MySQL) / `... ORDER BY id OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY` (SQL Server).
- **JOIN** — index the join keys on BOTH sides; filter (WHERE) to shrink rows BEFORE joining; prefer a JOIN over a correlated subquery.
- **Verify the plan** — confirm index usage with `EXPLAIN` / `EXPLAIN ANALYZE` (MySQL) or the actual execution plan / `SET STATISTICS IO ON` (SQL Server). A full-table scan on a large table is a red flag.
- **Don't over-index** — every index slows writes; index for real query patterns, not speculatively. One composite index often beats several single-column ones.
- **Large / time-series tables** — archive or partition old `result` rows by date; never `COUNT(*)` or unbounded-scan a multi-million-row table in a hot path.

### 9. Proactive Tuning & Out-of-Scope Flagging
- **Large/time-series tables → tune proactively (no "it's slow" needed).** When WRITING or MODIFYING any query against a big/time-series table (`result`, log, history, sensor records), verify sargability + pagination + index usage and call it out in your reply, even if nobody flagged a problem.
- **Out-of-scope bad SQL → flag, don't silently pass.** If you NOTICE a clearly-bad query outside the current task (e.g. `SELECT *` with no WHERE on a large table, a non-sargable filter, deep `OFFSET`), surface it: on desktop spawn a background-task chip (`spawn_task`); in terminal mention it inline. NEVER silently ignore it, and NEVER auto-rewrite code outside the current task scope without asking first.

## Self-Review Checklist
- [ ] Hot/slow queries: execution plan checked (EXPLAIN / plan), indexes actually used, no full scan on large tables?
- [ ] WHERE is sargable (no function/implicit-cast on indexed column, no leading-wildcard LIKE)?
- [ ] Deep pagination uses keyset/seek, not huge OFFSET?
- [ ] DBMS confirmed (C# → SQL Server / Java → MySQL) and dialect matched for any raw SQL?
- [ ] Connection string from config, not hard-coded?
- [ ] No `SELECT *`? Columns listed explicitly?
- [ ] All queries paginated or row-limited?
- [ ] Multi-table writes in a transaction with narrow scope?
- [ ] No N+1; batch inserts not looped?
- [ ] Parameterized (`SqlParameter` / `#{}`), no user-input string concatenation?
