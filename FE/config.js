// Cấu hình FE.
// apiBase: địa chỉ BE (Flask). Để trống thì khi mở ở localhost tự dùng http://localhost:8000.
// Khi deploy, đặt biến môi trường API_BASE trên Vercel (scripts/build-fe.sh sẽ ghi đè file này),
// ví dụ: https://id-scan-api.example.com
window.APP_CONFIG = { apiBase: "" };
