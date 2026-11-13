#!/usr/bin/env bash
# =============================================================================
# Menjalankan semua migration + seed + tes Absensi di Postgres LOKAL sementara.
# Tidak menyentuh Supabase. Butuh PostgreSQL 15+ (initdb, pg_ctl, psql).
#
#   bash supabase/tests/local/run.sh
#
# Database dibuat di folder sementara dan dihapus setelah selesai.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"

cleanup() {
    "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

run() { echo "→ $1"; "${PSQL[@]}" -f "$2"; }

run "Tiruan Supabase"                "$HERE/bootstrap.sql"
run "Migration Data Siswa"           "$ROOT/supabase/migrations/20261022000001_student_information_system.sql"
run "Migration CRUD Data Siswa"      "$ROOT/supabase/migrations/20261023000001_student_crud.sql"
run "Data fiktif"                    "$HERE/fixtures.sql"
run "Migration Absensi Fase 0"       "$ROOT/supabase/migrations/20261112000001_attendance_foundation.sql"
run "Migration Absensi (ulang, idempotent)" "$ROOT/supabase/migrations/20261112000001_attendance_foundation.sql"
run "Migration tutup fungsi internal" "$ROOT/supabase/migrations/20261112000002_revoke_internal_functions.sql"
run "Migration Absensi Fase 1"       "$ROOT/supabase/migrations/20261112000003_attendance_phase1.sql"
run "Seed penugasan 2026/2027"       "$ROOT/supabase/seed/20261112_penugasan_2026_2027.sql"
run "Seed (ulang, idempotent)"       "$ROOT/supabase/seed/20261112_penugasan_2026_2027.sql"
run "Migration Akademik & Hari Libur" "$ROOT/supabase/migrations/20261113000001_attendance_akademik.sql"
run "Migration Akademik (ulang, idempotent)" "$ROOT/supabase/migrations/20261113000001_attendance_akademik.sql"
run "Migration Laporan"              "$ROOT/supabase/migrations/20261113000002_attendance_laporan.sql"
run "Migration absen tanggal bebas"   "$ROOT/supabase/migrations/20261113000003_attendance_any_date.sql"

echo "→ Tes Absensi"
{
    echo "begin;"
    cat "$HERE/attendance_test.sql"
    echo "rollback;"
} | "${PSQL[@]}" -P pager=off
