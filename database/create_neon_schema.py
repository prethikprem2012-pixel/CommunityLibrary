from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_FILE = Path(__file__).with_name("schema.sql")
EXPECTED_TABLES = {
    "books",
    "borrow_request_events",
    "borrow_requests",
    "return_requests",
    "user_sessions",
    "users",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create the Community Library tables in a Neon PostgreSQL database."
    )
    parser.parse_args(argv)

    load_dotenv(PROJECT_ROOT / ".env")
    database_url = os.environ.get("NEON_DATABASE_URL")
    if not database_url:
        print(
            f"NEON_DATABASE_URL is not set. Add your Neon connection URL to "
            f"{PROJECT_ROOT / '.env'} or set it in the environment. "
            "The local app's DATABASE_URL is intentionally not used.",
            file=sys.stderr,
        )
        return 1

    connection_info = urlsplit(database_url)
    if connection_info.scheme not in {"postgres", "postgresql"}:
        print("NEON_DATABASE_URL must be a PostgreSQL connection URL.", file=sys.stderr)
        return 1

    host = connection_info.hostname or ""
    database_name = connection_info.path.lstrip("/")
    if not host.endswith(".neon.tech"):
        print(
            "Safety check failed: this script only runs against Neon hosts "
            "ending in .neon.tech.",
            file=sys.stderr,
        )
        return 1
    if not database_name:
        print("DATABASE_URL must include a database name.", file=sys.stderr)
        return 1

    if not SCHEMA_FILE.is_file():
        print(f"Schema file not found: {SCHEMA_FILE}", file=sys.stderr)
        return 1

    schema_sql = SCHEMA_FILE.read_text(encoding="utf-8")
    print(f"Target Neon host: {host}")
    print(f"Target database: {database_name}")
    print("This will create tables in the library schema; it will not delete data.")
    confirmation = input('Type "CREATE" to continue: ').strip()
    if confirmation != "CREATE":
        print("Cancelled.")
        return 1

    try:
        with psycopg.connect(database_url, autocommit=True) as connection:
            existing_tables = connection.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'library'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            ).fetchall()
            if existing_tables:
                table_names = ", ".join(row[0] for row in existing_tables)
                print(
                    "The library schema already contains tables; refusing to run "
                    f"the fresh-database schema. Found: {table_names}",
                    file=sys.stderr,
                )
                return 1

            connection.execute(schema_sql, prepare=False)
            created_tables = connection.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'library'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            ).fetchall()
    except (OSError, psycopg.Error) as error:
        print(f"Database schema setup failed: {error}", file=sys.stderr)
        return 1

    table_names = {row[0] for row in created_tables}
    if table_names != EXPECTED_TABLES:
        missing = sorted(EXPECTED_TABLES - table_names)
        unexpected = sorted(table_names - EXPECTED_TABLES)
        print(
            f"Schema ran, but table verification failed. Missing: {missing}; "
            f"unexpected: {unexpected}",
            file=sys.stderr,
        )
        return 1

    print("Schema created and verified:")
    for table_name in sorted(table_names):
        print(f"  library.{table_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
