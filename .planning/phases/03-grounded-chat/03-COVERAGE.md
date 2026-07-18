# Phase 3 provider capability audit

Audited 2026-07-18 before adapter work.

| Provider | Capability used | Official source |
| --- | --- | --- |
| OpenAI | Responses API `text.format` JSON Schema with `strict: true` | https://developers.openai.com/api/docs/guides/structured-outputs and https://github.com/openai/openai-node |
| Anthropic | Messages API `output_config.format` JSON Schema output | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| Gemini | GenerateContent JSON response MIME type and JSON Schema | https://ai.google.dev/gemini-api/docs/structured-output |

## Package gate

`npm view openai repository version scripts --json` reported version `6.48.0`, repository
`git+https://github.com/openai/openai-node.git`, and no install/postinstall script. The
repository HEAD resolved successfully from that official GitHub repository. `openai@6.48.0`
is therefore the only provider package admitted; Anthropic and Gemini use server-side native
`fetch` and add no SDKs.

## Runtime policy

- Provider order: OpenAI GPT-5.6 (`OPENAI_API_KEY`, optional `OPENAI_MODEL`) then Anthropic
  (`ANTHROPIC_API_KEY`) then Gemini (`GEMINI_API_KEY`).
- Only timeout, network errors, HTTP 408, 429, and 5xx are transient and may advance the
  chain. Invalid output, insufficiency/refusal, and other 4xx responses are terminal.
- Keys and adapters remain Node-only. Status exposes availability labels only.

## Deliberate Phase 3 opt-outs

No tools, web/file search, streaming, provider/model selector, agent/tracing/RAG framework,
browser keys, automatic retry, hidden ingestion, or conversation-history prompt. This phase
answers from one server-derived six-record packet; each opt-out preserves that closed evidence
boundary and keeps the no-key demo deterministic.
