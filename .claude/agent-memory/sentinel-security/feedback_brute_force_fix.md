---
name: Brute-Force-Schutz für SQLite-Apps
description: Sessionbasierter exponentieller Delay als Brute-Force-Schutz ohne Cache-Layer
type: feedback
---

Für Ankerkladde (SQLite, kein Redis/Memcached) ist ein sessionbasierter Fehlversuchs-Counter mit exponentiellem usleep()-Delay die korrekte Lösung für Login-Brute-Force-Schutz.

**Why:** Kein persistenter Cache verfügbar; DB-basiertes Rate-Limiting wäre bei Login-Traffic ein Deadlock-Risiko auf SQLite.

**How to apply:** $_SESSION['login_failures'] zählen. Ab Versuch 6 (LOGIN_ATTEMPT_DELAY_FREE = 5): usleep(min(1_000_000 * 2^(n-5), 30_000_000)). Delay vor password_verify() einsetzen, nicht danach. Bei Erfolg Counter zurücksetzen. Implementiert in public/login.php v4.2.14.
