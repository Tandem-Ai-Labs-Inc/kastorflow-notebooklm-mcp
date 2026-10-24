# KastorFlow NotebookLM MCP

**A free, local MCP server for NotebookLM (now Gemini Notebook).** Connect Claude Desktop, Claude Code, Cursor or any
other MCP client to your notebooks through the [KastorFlow](https://kastorflow.com) Chrome extension.

> **Status:** this works with the next KastorFlow update, which turns AI agents on. The KastorFlow version in the
> Chrome Web Store today can't connect to it yet, and the npm package `kastorflow-notebooklm-mcp` is published with that update.
> Watch this repository for the release.

Google has no public API for notebooklm.google.com. kastorflow-notebooklm-mcp is an unofficial, local way in for AI agents: it runs on
your computer, and every call goes through the KastorFlow extension in your own signed-in Chrome. Your agent can list
notebooks; read sources, notes and artifacts; get a notebook's summary; create notebooks and add links or text; start
research; rename, tag and write notes; and generate one Studio artifact at a time. These are the tools of KastorFlow's
Free plan.

KastorFlow is independent. It is not affiliated with, endorsed by or sponsored by Google. NotebookLM and Gemini are
trademarks of Google LLC.

AI agents work on every KastorFlow plan. This client lists the Free-plan tools only; for Pro and Pro+ tools KastorFlow's
full companion, `kastorflow-mcp`, comes with the same update. The extension checks your plan on every call either way,
so this client's list is what it shows, not what decides.

This repository is generated from KastorFlow's own source and published here. Open issues here.

## How it works

```
your agent app ──stdio──▶ kastorflow-notebooklm-mcp ──local socket──▶ native host ──Chrome──▶ KastorFlow extension ──▶ NotebookLM
```

Nothing listens on a network port and nothing passes through a server. Both companions register the same native host
(`com.kastorflow.mcp`) in the same folder, so installing this one replaces the full companion's registration, and
installing the full one replaces this one's.

## Set up

1. **Install the bridge once** (Node.js 20 or later): `npx kastorflow-notebooklm-mcp setup`
2. **Connect an agent in KastorFlow:** Settings → AI agents → Connect an agent. Choose the notebooks and what the agent
   may do; KastorFlow shows the setup for your agent app.
3. **Add it to your agent app**, with `kastorflow-notebooklm-mcp` in place of `kastorflow-mcp`:

   ```json
   {
     "mcpServers": {
       "kastorflow": {
         "command": "npx",
         "args": ["-y", "kastorflow-notebooklm-mcp"],
         "env": {
           "KASTORFLOW_PROFILE_NONCE": "…",
           "KASTORFLOW_PAIRING_TOKEN": "…"
         }
       }
     }
   }
   ```

   On Windows use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "kastorflow-notebooklm-mcp"]`. Claude Code:
   `claude mcp add kastorflow -e KASTORFLOW_PROFILE_NONCE=… -e KASTORFLOW_PAIRING_TOKEN=… -- npx -y kastorflow-notebooklm-mcp`

Chrome must be open with KastorFlow for calls to work.

## The tools

| What you allow | Tools |
|---|---|
| Read | `list_notebooks`, `list_sources`, `read_source`, `describe_notebook`, `list_notes`, `list_artifacts`, `read_artifact`, `list_tags` |
| Add | `create_notebook`, `add_sources` |
| Organize | `rename_notebook`, `rename_source`, `write_note`, `tag_sources` |
| Research | `start_research` |
| Create | `generate_artifacts` |
| Send or share | `share_notebook` |
| Local records | `save_research`, `find_records`, `read_record`, `read_history`, `propose_decision`, `revise_proposal`, `publish_record`, `publication_status` |
| Always | `connection_status`, `job_status`, `request_status` |

A tool not on this list answers that this client has Free-plan tools only. Sharing a notebook asks you in KastorFlow
first. Deleting, merging, moving and refreshing are not agent tools.

## Stop or remove

- **Pause or revoke** a connection in KastorFlow → Settings → AI agents. It stops on its next call.
- **Uninstall the bridge:** `npx kastorflow-notebooklm-mcp uninstall`.

## Questions

**Is there a NotebookLM API?** Google has no public API for notebooklm.google.com. This client gives AI agents an
unofficial, local one through the KastorFlow extension.

**Does it work with Gemini Notebook?** Yes. NotebookLM is now Gemini Notebook (notebook.google.com); it is the same
service and the same notebooks.

**Is it free?** Yes. The client is Apache-2.0, and every tool it lists is on KastorFlow's Free plan.

**Where does my data go?** It stays on your computer. The client talks only to the KastorFlow extension over a local
pipe or socket. What your agent reads goes to your agent app, and that app's own privacy policy applies.

## License

Apache-2.0 (see LICENSE).
