# AI Life OS External Intake

External assistants should push only actionable life updates into AIOS.

## ChatGPT

Use a Custom GPT Action with `integrations/chatgpt-actions/openapi.yaml`.

Paste `integrations/chatgpt-actions/custom-gpt-instructions.md` into the Custom GPT instructions.

The GPT should call `POST /api/lifeos/intake` when the user mentions:

- a task
- a deadline
- an event
- a goal or milestone
- a current state change
- a constraint
- a planning decision

## Claude

Use a Claude custom connector / remote MCP server exposing the tool described in `integrations/claude-mcp/lifeos-tool.json`.

Use `integrations/claude-mcp/claude-instructions.md` as the connector usage instruction.

Claude should call `lifeos_intake` under the same conditions as ChatGPT.

## Current Limitation

The Expo Go app stores state locally on the phone. A public ChatGPT Action or Claude Connector cannot directly write that local AsyncStorage state.

Current prototype flow:

1. External assistants call `POST /api/lifeos/intake`.
2. The deployed API keeps an intake queue.
3. The mobile app polls `GET /api/lifeos/intake`.
4. The app parses fresh intakes into Now Card and Today Timeline.

The included standalone server persists intakes to a JSON file. For deployment instructions, see `server/DEPLOY.md`.
