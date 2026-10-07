#!/usr/bin/env bash
# Tes akses anon (tanpa login) ke Supabase e-RTLH Ngawi.
# Pemakaian:
#   export SUPA_URL="https://oiygddbzugipepatswxi.supabase.co"
#   export ANON_KEY="<kunci anon dari index.html>"
#   bash test-anon.sh
# Skrip ini hanya MEMBACA (GET / list). Tidak membuat atau mengubah data.

set -u
: "${SUPA_URL:?isi SUPA_URL}"
: "${ANON_KEY:?isi ANON_KEY}"

TABLES=(admin_users rtlh nik_database rtlh_dokumen rtlh_dokumen_link
        rtlh_dokumen_kabupaten rtlh_pdf_scan_results rtlh_verifikasi rtlh_riwayat)
BUCKETS=(dokumen-kab rtlh-dokumen rtlh-photos)

tmp=$(mktemp)
leaks=0

echo "== Tabel (harus: [] atau ditolak) =="
for t in "${TABLES[@]}"; do
  code=$(curl -s -o "$tmp" -w "%{http_code}" \
    "$SUPA_URL/rest/v1/$t?select=*&limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
  body=$(cat "$tmp")
  if [[ "$code" == "200" && "$body" != "[]" ]]; then
    echo "BOCOR   $t  (HTTP $code, data terbaca)"; leaks=$((leaks+1))
  elif [[ "$code" == "200" ]]; then
    echo "ok      $t  (HTTP 200 tapi kosong - cek apakah tabel memang kosong atau RLS memfilter)"
  else
    echo "ok      $t  (HTTP $code ditolak)"
  fi
done

echo
echo "== Bucket storage - daftar file (harus: kosong atau ditolak) =="
for b in "${BUCKETS[@]}"; do
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
    "$SUPA_URL/storage/v1/object/list/$b" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prefix":"","limit":3}')
  body=$(cat "$tmp")
  if [[ "$code" == "200" && "$body" != "[]" ]]; then
    echo "BOCOR   $b  (daftar file terbaca)"; leaks=$((leaks+1))
  else
    echo "ok      $b  (HTTP $code)"
  fi
done

echo
echo "== Bucket publik? =="
echo "Tes manual: buka satu URL dokumen/foto dari aplikasi di jendela incognito."
echo "Jika file terbuka tanpa login, bucket itu masih publik (lihat Tahap D)."

echo
echo "== Pendaftaran pengguna baru =="
settings=$(curl -s "$SUPA_URL/auth/v1/settings" -H "apikey: $ANON_KEY")
if echo "$settings" | grep -q '"disable_signup":true'; then
  echo "ok      pendaftaran dimatikan"
else
  echo "PERIKSA pendaftaran publik tampaknya masih aktif (disable_signup bukan true)"
  leaks=$((leaks+1))
fi

rm -f "$tmp"
echo
if [[ $leaks -eq 0 ]]; then echo "Hasil: tidak ada kebocoran terdeteksi."
else echo "Hasil: $leaks temuan perlu diperbaiki."; fi
