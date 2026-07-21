# OpenAI-kompatible KI-Endpoints

Der KI-Zugang wird um eine zweite Provider-Variante erweitert: OpenAI-kompatibel. Diese Variante spricht die OpenAI-Chat-Completions-API an und erlaubt dem Nutzer, die Basis-URL und das Modell frei zu wählen. Damit sind OpenAI direkt, OpenRouter, LiteLLM, selbstgehostete vLLM-/llama.cpp-/Ollama-Instanzen und weitere kompatible Endpoints ohne Code-Änderung nutzbar. Gemini bleibt als eigener Provider mit hartcodierter URL und Modell-Whitelist bestehen, da sein Endpunkt nicht OpenAI-kompatibel ist.

Die freie Basis-URL wird auf `https://`-URLs sowie `http://localhost` und `http://127.0.0.1` beschränkt. Damit sind lokale Endpoints erreichbar, aber SSRF-Angriffe gegen Cloud-Metadata-Endpunkte blockiert. Ein API-Key ist optional; lokale Endpoints kommen ohne Key aus.

OpenRouter als bisher eigener Provider entfällt. Bestehende OpenRouter-Konfigurationen werden einmalig in den OpenAI-kompatiblen Provider überführt: `openrouter_api_key` wird zu `openai_compatible_api_key`, `openrouter_model` zu `openai_compatible_model`, `ai_provider` zu `openai_compatible`, Basis-URL auf `https://openrouter.ai/api/v1` gesetzt.

Begründung: OpenRouter ist OpenAI-kompatibel; eine eigene Code-Variante für OpenRouter bedeutet Duplikatpflege für identische Request- und Response-Form. Die Whitelist-Modelle für OpenRouter fallen ersatzlos weg, weil LiteLLM-kompatible Endpoints andere Modellnamen führen und eine globale Whitelist ohnehin nicht sinnvoll ist. Gemini bleibt getrennt, weil seine API-Form abweicht und ein Anpassungs-Aufwand ohne erkennbaren Nutzen wäre.

Bewusst nicht umgesetzt: automatischer Modell-Discovery per `GET {url}/models` (YAGNI, wird erst relevant, wenn ein Nutzer regelmäßig mehrere eigene Endpoints parallel pflegt), DNS-Resolve-basierter Schutz gegen Private-IP-SSRF (für eine Single-User-PWA überdimensioniert), und ein gemeinsamer Auth-Header-Editor pro Provider (jeder Provider hat seinen eigenen Header-Style — Gemini `x-goog-api-key`, OpenAI `Authorization: Bearer` — und die Form ist in den Provider-Funktionen besser aufgehoben als in einer Konfiguration).
