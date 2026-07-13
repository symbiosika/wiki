# Workarounds

- **Framework submodule unreachable (cloud session):** The framework is published as a ZIP release on this repo. Download + extract into `backend/framework` with `.scripts/fetch-framework.sh` (also runs automatically in the SessionStart hook when the submodule checkout fails). The ZIP is built by the `.github/workflows/framework-release.yml` workflow.
