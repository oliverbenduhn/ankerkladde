## 2024-11-23 - [Added Rate Limiting to Login Endpoint]
**Vulnerability:** Missing rate limiting on sensitive endpoints.
**Learning:** The application lacked rate limiting on the login endpoint, which could allow brute-force attacks against user accounts.
**Prevention:** Always implement rate limiting on sensitive endpoints, such as login or password reset, to mitigate brute-force attacks.
